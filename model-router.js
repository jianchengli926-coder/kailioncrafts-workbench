/**
 * model-router.js
 * P2.2B-2: Node.js 模型路由和故障转移
 *
 * Provider 优先级（api_config.json -> providerOrder）：
 *   openai_proxy（GPT中转站，OpenAI兼容） → glm（智谱） → ollama（本地）
 *
 * 模型链：
 * - 普通文本：gpt-4o → gpt-4o-mini → glm-4-flash → qwen3.5:9b → qwen2.5:7b
 * - 推理：gpt-4o → glm-4-flash → qwen3.5:9b → deepseek-r1:7b
 * - 视觉：gpt-4o → glm-4.6v-flash → qwen3.5:9b → qwen2.5vl:7b
 * - 生图：cogview-3-flash → x/flux2-klein:4b-fp4
 * - Embedding：nomic-embed-text:latest（固定）
 *
 * 故障转移：
 * - 允许：408、429、5xx、timeout、abort、connection refused、慢响应、未配置
 * - 禁止：400、401、403、422、invalid_api_key、内容审核拒绝、参数错误、手动模式
 */

'use strict';

const LocalModelLock = require('./local-model-lock');
const ModelTrace = require('./model-trace.js');

// ============================================================
// 模型链配置（集中定义，不重复硬编码）
// ============================================================

const MODEL_CHAINS = {
  text: ['gpt-4o', 'gpt-4o-mini', 'glm-4-flash', 'qwen3.5:9b', 'qwen2.5:7b'],
  reasoning: ['gpt-4o', 'glm-4-flash', 'qwen3.5:9b', 'deepseek-r1:7b'],
  vision: ['gpt-4o', 'glm-4.6v-flash', 'qwen3.5:9b', 'qwen2.5vl:7b'],
  image: ['cogview-3-flash', 'x/flux2-klein:4b-fp4'],
  embedding: ['nomic-embed-text:latest']
};

// 云端模型列表（GLM 官方）
const CLOUD_MODELS = new Set([
  'glm-4.7-flash', 'glm-4-flash', 'glm-4.6v-flash',
  'cogview-3-flash', 'doubao-seed-2-1-turbo'
]);

// GPT中转站（openai_proxy，OpenAI 兼容格式）提供的模型列表
const OPENAI_PROXY_MODELS = new Set([
  'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo',
  'claude-3-5-sonnet', 'gemini-2.0-flash'
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
  'rate_limited', 'service_unavailable', 'not_configured',
  'config_error', 'empty_response', 'parse_error',
  'model_not_available'  // 404: 该模型在当前账号/中转组不可用，应尝试链条下一个模型
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
 * 判断模型归属的 Provider
 * @param {string} model - 模型名称
 * @returns {'openai_proxy'|'glm'|'ollama'} provider 名称
 */
function getModelProvider(model) {
  if (OPENAI_PROXY_MODELS.has(model)) return 'openai_proxy';
  if (LOCAL_MODELS.has(model)) return 'ollama';
  return 'glm';
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
 * 读取 api_config.json（供云端 Provider 共用）
 * @returns {Object|null} 配置对象，读取失败返回 null
 */
function loadApiConfig() {
  try {
    const cfgPath = require('path').join(__dirname, 'api_config.json');
    return JSON.parse(require('fs').readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * 通用 OpenAI 兼容 chat/completions 调用（GLM 与 openai_proxy 共用）
 * 故障转移语义：
 *   - 401/403 → invalid_api_key（禁止故障转移，配置错误必须人工修正）
 *   - 429/5xx → 携带 statusCode，允许故障转移
 *   - timeout / 网络错误 → 允许故障转移
 *   - apiKey 为空 → not_configured，允许故障转移
 * @param {Object} options - 调用选项 { model, prompt, timeoutMs, mockProvider }
 * @param {Object} providerCfg - Provider 配置 { endpoint, apiKey, timeout, label }
 * @returns {Promise<Object>} 调用结果
 */
async function callOpenAICompatible(options, providerCfg) {
  const { model, prompt, timeoutMs, mockProvider } = options;

  // 如果有 mock provider，使用 mock（测试用）
  if (mockProvider) {
    return mockProvider({ model, prompt });
  }

  const label = providerCfg.label || 'provider';
  const apiKey = providerCfg.apiKey || '';
  const endpoint = (providerCfg.endpoint || '').replace(/\/$/, '');
  const timeout = timeoutMs || providerCfg.timeout || 30000;

  // API Key 为空时返回明确错误，触发故障转移
  if (!apiKey || apiKey.length === 0) {
    return {
      success: false,
      model,
      error: {
        type: 'not_configured',
        message: label + ' API Key 未配置，已自动故障转移到下一个模型',
        recoverable: true
      }
    };
  }

  // endpoint 未配置无法调用，触发故障转移
  if (!endpoint) {
    return {
      success: false,
      model,
      error: {
        type: 'not_configured',
        message: label + ' endpoint 未配置，已自动故障转移到下一个模型',
        recoverable: true
      }
    };
  }

  // 构建 OpenAI 兼容格式请求体
  const messages = typeof prompt === 'string'
    ? [{ role: 'user', content: prompt }]
    : (Array.isArray(prompt) ? prompt : [{ role: 'user', content: String(prompt) }]);

  const postData = JSON.stringify({
    model: model,
    messages: messages,
    temperature: 0.7,
    stream: false
  });

  // 解析 endpoint 获取 host 和 path
  const url = new URL(endpoint + '/chat/completions');
  const isHttps = url.protocol === 'https:';
  const httpModule = isHttps ? require('https') : require('http');

  return new Promise((resolve) => {
    const req = httpModule.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: timeout
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);

          // 401/403 → 认证失败，标记 invalid_api_key，禁止故障转移（配置错误）
          if (res.statusCode === 401 || res.statusCode === 403) {
            resolve({
              success: false,
              model,
              error: {
                type: 'invalid_api_key',
                message: label + ' 认证失败(' + res.statusCode + '): ' + ((parsed.error && parsed.error.message) || '请检查 API Key'),
                statusCode: res.statusCode
              },
              statusCode: res.statusCode
            });
            return;
          }

          // 处理其他错误响应
          if (parsed.error) {
            // 404 或 error.code 提示模型不存在 → model_not_available，允许故障转移到下一个模型
            const isModelNotFound = res.statusCode === 404 ||
              (parsed.error.code && /model|not_?found|not_?exist|invalid_?model/i.test(String(parsed.error.code)));
            resolve({
              success: false,
              model,
              error: {
                type: isModelNotFound ? 'model_not_available' : 'api_error',
                message: parsed.error.message || JSON.stringify(parsed.error),
                code: parsed.error.code,
                statusCode: res.statusCode
              },
              statusCode: res.statusCode
            });
            return;
          }
          // 解析 OpenAI 兼容格式响应
          const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message
            ? parsed.choices[0].message.content
            : '';
          if (!content || !content.trim()) {
            resolve({
              success: false,
              model,
              error: { type: 'empty_response', message: '模型返回空内容', statusCode: res.statusCode },
              statusCode: res.statusCode
            });
            return;
          }
          resolve({
            success: true,
            model,
            response: content,
            usage: parsed.usage || {},
            statusCode: res.statusCode,
            raw: parsed
          });
        } catch (e) {
          resolve({
            success: false,
            model,
            error: { type: 'parse_error', message: '响应解析失败: ' + e.message, statusCode: res.statusCode },
            statusCode: res.statusCode
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        success: false,
        model,
        error: {
          type: err.code === 'ECONNREFUSED' ? 'connection_refused' : 'network_error',
          message: err.message,
          code: err.code
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        model,
        error: { type: 'timeout', message: label + ' 请求超时（' + timeout + 'ms）', timeoutMs: timeout }
      });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * 调用智谱 GLM 云端模型（OpenAI 兼容格式）
 * @param {Object} options - 调用选项 { model, prompt, timeoutMs, mockProvider }
 * @returns {Promise<Object>} 调用结果
 */
async function callCloudModel(options) {
  const apiConfig = loadApiConfig();
  if (!apiConfig) {
    return {
      success: false,
      model: options.model,
      error: { type: 'config_error', message: '无法读取 api_config.json' }
    };
  }
  const glmCfg = apiConfig.glm || {};
  return callOpenAICompatible(options, {
    label: 'GLM',
    endpoint: glmCfg.endpoint || 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: glmCfg.apiKey,
    timeout: glmCfg.timeout
  });
}

/**
 * 调用 GPT 中转站（openai_proxy，OpenAI 兼容格式）
 * 支持 gpt-4o / gpt-4o-mini / gpt-4-turbo / claude-3-5-sonnet / gemini-2.0-flash
 * @param {Object} options - 调用选项 { model, prompt, timeoutMs, mockProvider }
 * @returns {Promise<Object>} 调用结果
 */
async function callOpenAIProxy(options) {
  const apiConfig = loadApiConfig();
  if (!apiConfig) {
    return {
      success: false,
      model: options.model,
      error: { type: 'config_error', message: '无法读取 api_config.json' }
    };
  }
  const proxyCfg = apiConfig.openai_proxy || {};
  return callOpenAICompatible(options, {
    label: 'OpenAI Proxy',
    endpoint: proxyCfg.endpoint || '',
    apiKey: proxyCfg.apiKey,
    timeout: proxyCfg.timeout
  });
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

      // 自动模式下检查慢响应 (M1: check on every attempt, not just the first)
      if (!isManual && isModelSlow(model)) {
        // 跳过慢模型，直接尝试下一个
        ModelTrace.updateTrace(trace.traceId, {
          targetModel: chain[attempt + 1] || model,
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
        // 调用模型：按 provider 分发（本地 Ollama / GPT中转站 / GLM）
        let result;
        if (isLocalModel(model)) {
          result = await callLocalModel({ model, prompt, numCtx, mockProvider, images });
        } else if (getModelProvider(model) === 'openai_proxy') {
          result = await callOpenAIProxy({ model, prompt, mockProvider });
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
  // 读取 provider 配置状态（不返回完整 apiKey，仅返回是否已配置）
  const apiConfig = loadApiConfig();
  const proxyCfg = (apiConfig && apiConfig.openai_proxy) || {};
  const glmCfg = (apiConfig && apiConfig.glm) || {};

  return {
    chains: { ...MODEL_CHAINS },
    cloudModels: Array.from(CLOUD_MODELS),
    openaiProxyModels: Array.from(OPENAI_PROXY_MODELS),
    localModels: Array.from(LOCAL_MODELS),
    providerOrder: (apiConfig && apiConfig.providerOrder) || ['glm', 'ollama'],
    providers: {
      openai_proxy: {
        enabled: proxyCfg.enabled !== false,
        configured: !!(proxyCfg.apiKey && proxyCfg.apiKey.length > 0),
        name: proxyCfg.name || 'GPT中转站',
        model: proxyCfg.model || null,
        models: proxyCfg.models || [],
        endpoint: proxyCfg.endpoint || null
      },
      glm: {
        enabled: glmCfg.enabled !== false,
        configured: !!(glmCfg.apiKey && glmCfg.apiKey.length > 0),
        model: glmCfg.model || null,
        endpoint: glmCfg.endpoint || null
      }
    },
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
  OPENAI_PROXY_MODELS,
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
  getModelProvider,
  callLocalModel,
  callCloudModel,
  callOpenAIProxy,
  generate,
  getModelHealth
};
