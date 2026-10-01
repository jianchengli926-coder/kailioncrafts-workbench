/**
 * model-trace.js
 * P2.2B-2: 模型调用 Trace 记录模块
 *
 * 职责：
 * - 记录每次模型调用的完整链路
 * - 故障转移记录（源模型、目标模型、原因、耗时）
 * - 脱敏处理，不泄露 API Key、密码、完整请求正文
 * - 内存存储，不写入文件（避免提交 trace 文件）
 */

'use strict';

// 内存 Trace 存储（不持久化）
const traces = new Map();
const MAX_TRACES = 500;

// 敏感字段列表（脱敏时移除或替换）
const SENSITIVE_KEYS = [
  'apiKey', 'api_key', 'apikey',
  'authorization', 'Authorization',
  'token', 'accessToken', 'access_token',
  'password', 'passwd', 'secret',
  'cookie', 'set-cookie',
  'x-api-key', 'X-API-Key'
];

/**
 * 脱敏处理：移除敏感字段，截断长文本
 * @param {any} data - 待脱敏数据
 * @param {number} maxLength - 字符串最大长度
 * @returns {any} 脱敏后的数据
 */
function sanitize(data, maxLength = 500) {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    if (data.length > maxLength) return data.substring(0, maxLength) + '...[truncated]';
    return data;
  }
  if (typeof data === 'number' || typeof data === 'boolean') return data;
  if (Array.isArray(data)) {
    return data.map(item => sanitize(item, maxLength));
  }
  if (typeof data === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.some(s => lowerKey.includes(s.toLowerCase()))) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitize(value, maxLength);
      }
    }
    return result;
  }
  return String(data);
}

/**
 * 生成唯一 Trace ID
 * @returns {string} Trace ID
 */
function generateTraceId() {
  return 'trace_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
}

/**
 * 创建新的 Trace 记录
 * @param {Object} options - Trace 选项
 * @param {string} options.sourceModel - 源模型
 * @param {string} [options.targetModel] - 目标模型（故障转移时）
 * @param {string} [options.reason] - 故障转移原因
 * @param {number} [options.elapsedMs] - 耗时（毫秒）
 * @param {number} [options.attempt] - 尝试次数
 * @param {boolean} [options.automatic=true] - 是否自动模式
 * @param {string} [options.errorCode] - 错误码
 * @param {string} [options.localModelLockState] - 本地锁状态
 * @param {Object} [options.request] - 请求数据（脱敏存储）
 * @param {Object} [options.response] - 响应数据（脱敏存储）
 * @param {string} [options.taskType] - 任务类型（text/reasoning/vision/image/embedding）
 * @returns {Object} Trace 记录
 */
function createTrace(options = {}) {
  const traceId = generateTraceId();
  const trace = {
    traceId,
    sourceModel: options.sourceModel || 'unknown',
    targetModel: options.targetModel || null,
    reason: options.reason || null,
    elapsedMs: options.elapsedMs || 0,
    attempt: options.attempt || 1,
    automatic: options.automatic !== false,
    errorCode: options.errorCode || null,
    localModelLockState: options.localModelLockState || null,
    taskType: options.taskType || 'text',
    status: 'pending', // pending / success / error / failover
    request: sanitize(options.request || {}),
    response: sanitize(options.response || {}),
    failoverDetails: options.failoverDetails || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  traces.set(traceId, trace);

  // 限制存储数量
  if (traces.size > MAX_TRACES) {
    const oldestKey = traces.keys().next().value;
    traces.delete(oldestKey);
  }

  return trace;
}

/**
 * 更新 Trace 记录
 * @param {string} traceId - Trace ID
 * @param {Object} updates - 更新字段
 * @returns {Object|null} 更新后的 Trace
 */
function updateTrace(traceId, updates = {}) {
  const trace = traces.get(traceId);
  if (!trace) return null;

  Object.assign(trace, updates);
  trace.updatedAt = new Date().toISOString();

  // 如果是故障转移，记录详情
  if (updates.targetModel && updates.reason) {
    trace.failoverDetails.push({
      from: trace.sourceModel,
      to: updates.targetModel,
      reason: updates.reason,
      elapsedMs: updates.elapsedMs || trace.elapsedMs,
      at: new Date().toISOString()
    });
  }

  return trace;
}

/**
 * 标记 Trace 成功
 * @param {string} traceId - Trace ID
 * @param {Object} [response] - 响应数据
 * @param {number} [elapsedMs] - 耗时
 */
function markSuccess(traceId, response, elapsedMs) {
  return updateTrace(traceId, {
    status: 'success',
    response: sanitize(response || {}),
    elapsedMs: elapsedMs || 0
  });
}

/**
 * 标记 Trace 错误
 * @param {string} traceId - Trace ID
 * @param {string} errorCode - 错误码
 * @param {Object} [error] - 错误详情
 * @param {number} [elapsedMs] - 耗时
 */
function markError(traceId, errorCode, error, elapsedMs) {
  return updateTrace(traceId, {
    status: 'error',
    errorCode,
    response: sanitize({ error: error || errorCode }),
    elapsedMs: elapsedMs || 0
  });
}

/**
 * 标记 Trace 故障转移
 * @param {string} traceId - Trace ID
 * @param {string} targetModel - 目标模型
 * @param {string} reason - 转移原因
 * @param {number} [elapsedMs] - 耗时
 */
function markFailover(traceId, targetModel, reason, elapsedMs) {
  return updateTrace(traceId, {
    status: 'failover',
    targetModel,
    reason,
    elapsedMs: elapsedMs || 0
  });
}

/**
 * 获取 Trace 记录
 * @param {string} traceId - Trace ID
 * @returns {Object|null} Trace 记录
 */
function getTrace(traceId) {
  const trace = traces.get(traceId);
  return trace ? { ...trace } : null;
}

/**
 * 列出 Trace 记录
 * @param {Object} [filters] - 过滤条件
 * @param {string} [filters.status] - 状态过滤
 * @param {string} [filters.sourceModel] - 源模型过滤
 * @param {number} [filters.limit] - 返回数量限制
 * @returns {Array} Trace 列表
 */
function listTraces(filters = {}) {
  let result = Array.from(traces.values());

  if (filters.status) {
    result = result.filter(t => t.status === filters.status);
  }
  if (filters.sourceModel) {
    result = result.filter(t => t.sourceModel === filters.sourceModel);
  }
  if (filters.taskType) {
    result = result.filter(t => t.taskType === filters.taskType);
  }

  // 按创建时间倒序
  result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (filters.limit) {
    result = result.slice(0, filters.limit);
  }

  return result.map(t => ({ ...t }));
}

/**
 * 清空所有 Trace（测试用）
 */
function clearTraces() {
  traces.clear();
}

/**
 * 获取 Trace 统计
 * @returns {Object} 统计信息
 */
function getTraceStats() {
  const all = Array.from(traces.values());
  return {
    total: all.length,
    success: all.filter(t => t.status === 'success').length,
    error: all.filter(t => t.status === 'error').length,
    failover: all.filter(t => t.status === 'failover').length,
    pending: all.filter(t => t.status === 'pending').length
  };
}

module.exports = {
  sanitize,
  generateTraceId,
  createTrace,
  updateTrace,
  markSuccess,
  markError,
  markFailover,
  getTrace,
  listTraces,
  clearTraces,
  getTraceStats,
  SENSITIVE_KEYS
};
