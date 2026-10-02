/**
 * model-router.js
 * P2.2B-2: Node.js 模型路由和故障转移
 *
 * 模型链：
 * - 普通文本：glm-4.7-flash → glm-4-flash → qwen3.5:9b → qwen2.5:7b
 * - 推理：glm-4.7-flash → qwen3.5:9b → deepseek-r1:7b
 * - 视觉：glm-4.6v-flash → qwen3.5:9b → qwen2.5vl:7b
 * - 生图：cogview-3-flash → x/flux2-klein:4b-fp4
 * - Embedding：nomic-embed-text:latest（固定）
 *
 * 故障转移：
 * - 允许：408、429、5xx、timeout、abort、connection refused、慢响应
 * - 禁止：400、401、403、422、内容审核拒绝、参数错误、手动模式
 */

'use strict';

const LocalModelLock = require('./local-model-lock');
const ModelTrace = require('./model-trace.js');

// ============================================================
// 模型链配置（集中定义，不重复硬编码）
// ============================================================

const MODEL_CHAINS = {
  text: ['glm-4.7-flash', 'glm-4-flash', 'qwen3.5:9b', 'qwen2.5:7b'],
  reasoning: ['glm-4.7-flash', 'qwen3.5:9b', 'deepseek-r1:7b'],
  vision: ['glm-4.6v-flash', 'qwen3.5:9b', 'qwen2.5vl:7b'],
  image: ['cogview-3-flash', 'x/flux2-klein:4b-fp4'],
  embedding: ['nomic-embed-text:latest']
};

// 云端模型列表
const CLOUD_MODELS = new Set([
  'glm-4.7-flash', 'glm-4-flash', 'glm-4.6v-flash',
  'cogview-3-flash', 'doubao-seed-2-1-turbo'
]);

// 本地模型列表
const LOCAL_MODELS = new Set([
  'qwen3.5:9b', 'qwen2.5:7b', 'qwen2.5vl:7b',
  'deepseek-r1:7b', 'x/flux2-klein:4b-fp4',
  'nomic-embed-text:latest'
]);

// 默认配置
const DEFAULT_CONFIG = {
  numCtx: 8192,
  numCtxLong: 16384,
  numCtxMax: 32768,
  keepAlive: 0,
  timeoutMs: 120000,
  temperature: 0.5,  // P2.2D-4: 稳定温度，平衡创造性和一致性
  maxOutputTokens: 400,  // P2.2D-4: 限制输出为120-180词邮件所需范围
  slowResponseSingleThreshold: 30000,  // 单次>30秒
  slowResponseConsecutiveThreshold: 15000, // 连续两次>15秒
  slowResponseExpiryMs: 300000, // 慢响应状态5分钟过期
  ollamaHost: '127.0.0.1',
  ollamaPort: 11434
};

// ============================================================
// 故障转移规则
// ============================================================

// 允许故障转移的错误码
const FAILOVER_ALLOWED_CODES = new Set([
  408, 429, 500, 502, 503, 504
]);

// 禁止故障转移的错误码
const FAILOVER_FORBIDDEN_CODES = new Set([
  400, 401, 403, 422
]);

// 允许故障转移的错误类型
const FAILOVER_ALLOWED_TYPES = new Set([
  'timeout', 'abort', 'connection_refused', 'econnrefused',
  'network_error', 'ollama_unavailable', 'slow_response',
  'rate_limited', 'service_unavailable'
]);

// 禁止故障转移的错误类型
const FAILOVER_FORBIDDEN_TYPES = new Set([
  'content_moderation', 'invalid_api_key', 'invalid_parameter',
  'bad_request', 'unauthorized', 'forbidden', 'unprocessable'
]);

/**
 * 判断是否允许故障转移
 * @param {Object} error - 错误对象
 * @param {number} [error.statusCode] - HTTP 状态码
 * @param {string} [error.type] - 错误类型
 * @param {string} [error.message] - 错误消息
 * @returns {boolean} 是否允许故障转移
 */
function shouldFailover(error) {
  if (!error) return false;

  // 检查状态码
  if (error.statusCode) {
    if (FAILOVER_FORBIDDEN_CODES.has(error.statusCode)) return false;
    if (FAILOVER_ALLOWED_CODES.has(error.statusCode)) return true;
    if (error.statusCode >= 500 && error.statusCode < 600) return true;
  }

  // 检查错误类型
  if (error.type) {
    const typeLower = error.type.toLowerCase();
    if (FAILOVER_FORBIDDEN_TYPES.has(typeLower)) return false;
    if (FAILOVER_ALLOWED_TYPES.has(typeLower)) return true;
  }

  // 检查错误消息
  if (error.message) {
    const msgLower = error.message.toLowerCase();
    if (msgLower.includes('content moderation') || msgLower.includes('内容审核')) return false;
    if (msgLower.includes('invalid api key') || msgLower.includes('api key')) return false;
    if (msgLower.includes('timeout') || msgLower.includes('超时')) return true;
    if (msgLower.includes('econnrefused') || msgLower.includes('connection refused')) return true;
    if (msgLower.includes('rate limit') || msgLower.includes('429')) return true;
  }

  return false;
}

// ============================================================
// 慢响应检测
// ============================================================

const slowResponseState = {
  modelResponseTimes: new Map(), // model -> [timestamp, ...]
  slowModels: new Map() // model -> {since, expiry}
};

/**
 * 记录模型响应时间
 * @param {string} model - 模型名称
 * @param {number} elapsedMs - 耗时（毫秒）
 */
function recordResponseTime(model, elapsedMs) {
  if (!slowResponseState.modelResponseTimes.has(model)) {
    slowResponseState.modelResponseTimes.set(model, []);
  }
  const times = slowResponseState.modelResponseTimes.get(model);
  times.push({ timestamp: Date.now(), elapsedMs });
  // 只保留最近10次
  if (times.length > 10) times.shift();
}

/**
 * 检查是否触发慢响应
 * @param {string} model - 模型名称
 * @param {number} elapsedMs - 当前耗时
 * @returns {Object} 慢响应检测结果
 */
function checkSlowResponse(model, elapsedMs) {
  const config = DEFAULT_CONFIG;

  // 单次超过30秒
  if (elapsedMs > config.slowResponseSingleThreshold) {
    markModelSlow(model);
    return {
      isSlow: true,
      reason: 'single_response_exceeds_30s',
      elapsedMs,
      threshold: config.slowResponseSingleThreshold
    };
  }

  // 检查连续两次超过15秒
  const times = slowResponseState.modelResponseTimes.get(model) || [];
  const recentTimes = times.slice(-2);
  if (recentTimes.length >= 2 &&
      recentTimes[0].elapsedMs > config.slowResponseConsecutiveThreshold &&
      recentTimes[1].elapsedMs > config.slowResponseConsecutiveThreshold) {
    markModelSlow(model);
    return {
      isSlow: true,
      reason: 'consecutive_responses_exceed_15s',
      elapsedMs,
      threshold: config.slowResponseConsecutiveThreshold
    };
  }

  return { isSlow: false, elapsedMs };
}

/**
 * 标记模型为慢响应
 * @param {string} model - 模型名称
 */
function markModelSlow(model) {
  slowResponseState.slowModels.set(model, {
    since: Date.now(),
    expiry: Date.now() + DEFAULT_CONFIG.slowResponseExpiryMs
  });
}

/**
 * 检查模型是否处于慢响应状态
 * @param {string} model - 模型名称
 * @returns {boolean} 是否慢
 */
function isModelSlow(model) {
  const state = slowResponseState.slowModels.get(model);
  if (!state) return false;
  if (Date.now() > state.expiry) {
    slowResponseState.slowModels.delete(model);
    return false;
  }
  return true;
}

/**
 * 清除慢响应状态（测试用）
 */
function clearSlowResponseState() {
  slowResponseState.modelResponseTimes.clear();
  slowResponseState.slowModels.clear();
}

// ============================================================
// 模型调用
// ============================================================

/**
 * 判断是否为云端模型
 * @param {string} model - 模型名称
 * @returns {boolean} 是否云端
 */
function isCloudModel(model) {
  return CLOUD_MODELS.has(model);
}

/**
 * 判断是否为本地模型
 * @param {string} model - 模型名称
 * @returns {boolean} 是否本地
 */
function isLocalModel(model) {
  return LOCAL_MODELS.has(model);
}

/**
 * 调用本地 Ollama 模型
 * @param {Object} options - 调用选项
 * @param {string} options.model - 模型名称
 * @param {string} options.prompt - 提示词
 * @param {Object} [options.images] - 图片（视觉模型）
 * @param {number} [options.numCtx] - 上下文大小
 * @param {number} [options.timeoutMs] - 超时
 * @param {Function} [options.mockProvider] - mock provider（测试用）
 * @returns {Promise<Object>} 调用结果
 */
async function callLocalModel(options) {
  const { model, prompt, numCtx, timeoutMs, mockProvider } = options;

  // 如果有 mock provider，使用 mock
  if (mockProvider) {
    return mockProvider({ model, prompt, numCtx, keepAlive: DEFAULT_CONFIG.keepAlive });
  }

  // 真实 Ollama 调用（生产环境）
  const http = require('http');
  // P2.2D-4: 性能优化 - 关闭 thinking、限制输出、稳定温度
  const postData = JSON.stringify({
    model,
    prompt,
    stream: false,
    keep_alive: DEFAULT_CONFIG.keepAlive,
    options: {
      num_ctx: numCtx || DEFAULT_CONFIG.numCtx,
      temperature: DEFAULT_CONFIG.temperature,
      num_predict: DEFAULT_CONFIG.maxOutputTokens
    },
    // Ollama 0.35.0: 显式关闭 thinking 模式（正确参数名为 think，不是 thinking）
    think: false
  });

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: DEFAULT_CONFIG.ollamaHost,
      port: DEFAULT_CONFIG.ollamaPort,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: timeoutMs || DEFAULT_CONFIG.timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // P2.2C: 优先使用正式 response 字段，不得把 thinking 当作正文
          const responseText = parsed.response || parsed.message?.content || '';
          const thinkingText = parsed.thinking || parsed.reasoning_content || parsed.analysis || '';

          // 如果正式 response 为空但 thinking 有内容，返回明确错误
          if (!responseText.trim() && thinkingText.trim()) {
            resolve({
              success: false,
              model,
              error: {
                type: 'empty_response_with_thinking',
                message: '模型只返回了内部推理(thinking)，没有正式响应正文，不得用作客户开发信内容',
                thinkingLength: thinkingText.length
              },
              raw: parsed,
              statusCode: res.statusCode
            });
            return;
          }

          resolve({
            success: true,
            model,
            response: responseText,
            thinking: thinkingText, // 仅作为内部诊断元数据，不进入正文
            raw: parsed,
            statusCode: res.statusCode
          });
        } catch (e) {
          reject({ type: 'parse_error', message: e.message, statusCode: res.statusCode });
        }
      });
    });

    req.on('error', (err) => {
      reject({
        type: err.code === 'ECONNREFUSED' ? 'connection_refused' : 'network_error',
        message: err.message,
        error: err
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject({ type: 'timeout', message: 'Request timeout' });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * 调用云端模型（mock 实现，不调用真实 API）
 * @param {Object} options - 调用选项
 * @returns {Promise<Object>} 调用结果
 */
async function callCloudModel(options) {
  const { model, prompt, mockProvider } = options;

  // 如果有 mock provider，使用 mock
  if (mockProvider) {
    return mockProvider({ model, prompt });
  }

  // 生产环境应调用真实云端 API，但本阶段使用 mock 避免真实调用
  return {
    success: false,
    model,
    error: {
      type: 'not_configured',
      message: 'Cloud model API not configured in this environment'
    }
  };
}

/**
 * 执行模型调用（带故障转移）
 * @param {Object} options - 调用选项
 * @param {string} [options.taskType='text'] - 任务类型
 * @param {string} options.prompt - 提示词
 * @param {string} [options.manualModel] - 手动指定模型（手动模式）
 * @param {Function} [options.mockProvider] - mock provider
 * @param {number} [options.numCtx] - 上下文大小
 * @param {Object} [options.images] - 图片
 * @returns {Promise<Object>} 调用结果
 */
async function generate(options = {}) {
  const {
    taskType = 'text',
    prompt,
    manualModel,
    mockProvider,
    numCtx,
    images
  } = options;

  const isManual = !!manualModel;
  const chain = isManual ? [manualModel] : (MODEL_CHAINS[taskType] || MODEL_CHAINS.text);

  // 创建 Trace
  const trace = ModelTrace.createTrace({
    sourceModel: chain[0],
    taskType,
    automatic: !isManual,
    request: { prompt: prompt ? prompt.substring(0, 200) : '', taskType }
  });

  let lastError = null;
  let lockOwner = null;

  try {
    for (let attempt = 0; attempt < chain.length; attempt++) {
      const model = chain[attempt];
      const startTime = Date.now();

      // 自动模式下检查慢响应
      if (!isManual && attempt === 0 && isModelSlow(model)) {
        // 跳过慢模型，直接尝试下一个
        ModelTrace.updateTrace(trace.traceId, {
          targetModel: chain[1] || model,
          reason: 'model_marked_slow',
          attempt: attempt + 1
        });
        continue;
      }

      // 本地模型需要获取锁
      if (LocalModelLock.requiresLock(model)) {
        lockOwner = `generate_${trace.traceId}_${attempt}`;
        const lockResult = await LocalModelLock.acquireLock(model, { owner: lockOwner });
        if (!lockResult.success) {
          lastError = { type: 'lock_timeout', message: 'Failed to acquire local model lock' };
          ModelTrace.markError(trace.traceId, 'lock_timeout', lastError, Date.now() - startTime);
          continue;
        }
      }

      try {
        // 调用模型
        let result;
        if (isLocalModel(model)) {
          result = await callLocalModel({ model, prompt, numCtx, mockProvider, images });
        } else {
          result = await callCloudModel({ model, prompt, mockProvider });
        }

        const elapsedMs = Date.now() - startTime;

        // 记录响应时间
        recordResponseTime(model, elapsedMs);

        // 检查慢响应
        const slowCheck = checkSlowResponse(model, elapsedMs);

        if (result.success) {
          // 成功
          ModelTrace.markSuccess(trace.traceId, result, elapsedMs);
          return {
            success: true,
            model,
            response: result.response,
            traceId: trace.traceId,
            elapsedMs,
            attempt: attempt + 1,
            failover: attempt > 0,
            failoverReason: attempt > 0 ? trace.reason : null,
            slowResponse: slowCheck.isSlow ? slowCheck.reason : null,
            manual: isManual
          };
        }

        // 调用失败
        lastError = result.error || { type: 'unknown', message: 'Model call failed' };

        // 手动模式不自动切换
        if (isManual) {
          ModelTrace.markError(trace.traceId, lastError.type || 'manual_error', lastError, elapsedMs);
          return {
            success: false,
            model,
            error: lastError,
            traceId: trace.traceId,
            elapsedMs,
            attempt: attempt + 1,
            failover: false,
            manual: true,
            reason: 'manual_mode_no_failover'
          };
        }

        // 检查是否允许故障转移
        if (!shouldFailover(lastError) && !slowCheck.isSlow) {
          ModelTrace.markError(trace.traceId, lastError.statusCode || lastError.type || 'error', lastError, elapsedMs);
          return {
            success: false,
            model,
            error: lastError,
            traceId: trace.traceId,
            elapsedMs,
            attempt: attempt + 1,
            failover: false,
            reason: 'failover_not_allowed_for_this_error'
          };
        }

        // 记录故障转移
        const nextModel = chain[attempt + 1];
        if (nextModel) {
          ModelTrace.markFailover(trace.traceId, nextModel,
            slowCheck.isSlow ? slowCheck.reason : (lastError.type || lastError.message),
            elapsedMs);
        }

      } finally {
        // 释放本地模型锁
        if (lockOwner && LocalModelLock.requiresLock(model)) {
          LocalModelLock.releaseLock(lockOwner);
          lockOwner = null;
        }
      }
    }

    // 所有模型都失败
    ModelTrace.markError(trace.traceId, 'all_models_failed', lastError, 0);
    return {
      success: false,
      error: lastError || { message: 'All models in chain failed' },
      traceId: trace.traceId,
      failover: true,
      attempts: chain.length
    };

  } catch (e) {
    ModelTrace.markError(trace.traceId, 'exception', { message: e.message }, 0);
    if (lockOwner) LocalModelLock.releaseLock(lockOwner);
    return {
      success: false,
      error: { type: 'exception', message: e.message },
      traceId: trace.traceId
    };
  }
}

// ============================================================
// 模型健康检查
// ============================================================

/**
 * 获取所有模型健康状态
 * @returns {Object} 模型健康状态
 */
function getModelHealth() {
  return {
    chains: { ...MODEL_CHAINS },
    cloudModels: Array.from(CLOUD_MODELS),
    localModels: Array.from(LOCAL_MODELS),
    slowModels: Array.from(slowResponseState.slowModels.entries()).map(([model, state]) => ({
      model,
      since: state.since,
      expiry: state.expiry
    })),
    lockState: LocalModelLock.getLockState(),
    traceStats: ModelTrace.getTraceStats(),
    config: {
      numCtx: DEFAULT_CONFIG.numCtx,
      numCtxLong: DEFAULT_CONFIG.numCtxLong,
      numCtxMax: DEFAULT_CONFIG.numCtxMax,
      keepAlive: DEFAULT_CONFIG.keepAlive,
      slowResponseSingleThreshold: DEFAULT_CONFIG.slowResponseSingleThreshold,
      slowResponseConsecutiveThreshold: DEFAULT_CONFIG.slowResponseConsecutiveThreshold
    }
  };
}

module.exports = {
  MODEL_CHAINS,
  CLOUD_MODELS,
  LOCAL_MODELS,
  DEFAULT_CONFIG,
  FAILOVER_ALLOWED_CODES,
  FAILOVER_FORBIDDEN_CODES,
  shouldFailover,
  recordResponseTime,
  checkSlowResponse,
  markModelSlow,
  isModelSlow,
  clearSlowResponseState,
  isCloudModel,
  isLocalModel,
  callLocalModel,
  callCloudModel,
  generate,
  getModelHealth
};
