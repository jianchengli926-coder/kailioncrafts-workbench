/**
 * local-model-lock.js
 * P2.2B-2: 本地模型互斥锁
 *
 * 职责：
 * - 进程级互斥锁，所有本地大模型共用同一把锁
 * - 同时只允许一个本地大模型执行
 * - 等待队列和超时处理
 * - 外部已运行模型不被静默卸载
 * - embedding 不视为普通大模型，不被错误卸载
 * - 无论成功、失败或故障转移，都必须释放锁
 */

'use strict';

const http = require('http');

// 大模型列表（需要锁控制）
const LARGE_MODELS = new Set([
  'qwen3.5:9b',
  'qwen2.5:7b',
  'qwen2.5vl:7b',
  'deepseek-r1:7b',
  'x/flux2-klein:4b-fp4'
]);

// embedding 模型（不参与锁）
const EMBEDDING_MODELS = new Set([
  'nomic-embed-text:latest',
  'nomic-embed-text'
]);

// 锁状态
let lockState = {
  locked: false,
  currentModel: null,
  lockOwner: null,
  acquiredAt: null,
  waitingQueue: [],
  externalModels: []
};

// 默认超时（毫秒）
const DEFAULT_LOCK_TIMEOUT = 120000; // 2分钟
const DEFAULT_WAIT_TIMEOUT = 60000; // 1分钟
const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;

/**
 * 检查模型是否需要锁
 * @param {string} model - 模型名称
 * @returns {boolean} 是否需要锁
 */
function requiresLock(model) {
  if (!model) return false;
  if (EMBEDDING_MODELS.has(model)) return false;
  return LARGE_MODELS.has(model) || model.includes('qwen') || model.includes('deepseek') || model.includes('flux');
}

/**
 * 检查模型是否为 embedding
 * @param {string} model - 模型名称
 * @returns {boolean} 是否为 embedding
 */
function isEmbeddingModel(model) {
  return EMBEDDING_MODELS.has(model) || model.includes('embed');
}

/**
 * 获取当前锁状态
 * @returns {Object} 锁状态快照
 */
function getLockState() {
  return {
    locked: lockState.locked,
    currentModel: lockState.currentModel,
    lockOwner: lockState.lockOwner,
    acquiredAt: lockState.acquiredAt,
    waitingCount: lockState.waitingQueue.length,
    externalModels: [...lockState.externalModels],
    heldDurationMs: lockState.acquiredAt ? Date.now() - new Date(lockState.acquiredAt).getTime() : 0
  };
}

/**
 * 获取锁（异步，支持等待）
 * @param {string} model - 模型名称
 * @param {Object} [options] - 选项
 * @param {string} [options.owner] - 锁所有者标识
 * @param {number} [options.waitTimeout] - 等待超时（毫秒）
 * @param {number} [options.lockTimeout] - 锁持有超时（毫秒）
 * @returns {Promise<Object>} 锁获取结果
 */
async function acquireLock(model, options = {}) {
  // embedding 模型不需要锁
  if (isEmbeddingModel(model)) {
    return {
      success: true,
      lockAcquired: false,
      reason: 'embedding_model_no_lock_required',
      model
    };
  }

  // 检查是否为大模型
  if (!requiresLock(model)) {
    return {
      success: true,
      lockAcquired: false,
      reason: 'model_not_in_large_model_list',
      model
    };
  }

  const owner = options.owner || `caller_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const waitTimeout = options.waitTimeout || DEFAULT_WAIT_TIMEOUT;
  const lockTimeout = options.lockTimeout || DEFAULT_LOCK_TIMEOUT;

  // Reentrant lock disabled: same owner acquiring twice would cause double-release bug.
  // Business logic is serial (no nested lock acquisition for the same model), so we error out.
  if (lockState.locked && lockState.lockOwner === owner) {
    return {
      success: false,
      lockAcquired: false,
      reason: 'reentrant_acquire_not_allowed',
      message: 'Same owner already holds the lock. Nested acquire is not supported to prevent double-release.',
      model,
      owner
    };
  }

  // 如果锁空闲，直接获取
  if (!lockState.locked) {
    lockState.locked = true;
    lockState.currentModel = model;
    lockState.lockOwner = owner;
    lockState.acquiredAt = new Date().toISOString();
    return {
      success: true,
      lockAcquired: true,
      reason: 'lock_acquired',
      model,
      owner
    };
  }

  // 锁被占用，加入等待队列
  return new Promise((resolve) => {
    const waitEntry = {
      model,
      owner,
      resolve,
      queuedAt: Date.now(),
      timeout: null
    };

    // 设置等待超时
    waitEntry.timeout = setTimeout(() => {
      const idx = lockState.waitingQueue.indexOf(waitEntry);
      if (idx >= 0) lockState.waitingQueue.splice(idx, 1);
      resolve({
        success: false,
        lockAcquired: false,
        reason: 'wait_timeout',
        model,
        owner,
        waitedMs: Date.now() - waitEntry.queuedAt,
        currentLockHolder: lockState.lockOwner
      });
    }, waitTimeout);

    lockState.waitingQueue.push(waitEntry);
  });
}

/**
 * 释放锁
 * @param {string} owner - 锁所有者
 * @returns {Object} 释放结果
 */
function releaseLock(owner) {
  // If lock is not held, reject (prevents double-release)
  if (!lockState.locked) {
    return {
      success: false,
      reason: 'lock_not_held',
      message: 'Lock is already free; cannot release.'
    };
  }

  // 如果不是当前所有者，拒绝释放
  if (lockState.lockOwner !== owner) {
    return {
      success: false,
      reason: 'not_lock_owner',
      currentOwner: lockState.lockOwner
    };
  }

  const releasedModel = lockState.currentModel;
  const heldDuration = lockState.acquiredAt ?
    Date.now() - new Date(lockState.acquiredAt).getTime() : 0;

  // 释放锁
  lockState.locked = false;
  lockState.currentModel = null;
  lockState.lockOwner = null;
  lockState.acquiredAt = null;

  // 唤醒等待队列中的下一个
  if (lockState.waitingQueue.length > 0) {
    const next = lockState.waitingQueue.shift();
    if (next.timeout) clearTimeout(next.timeout);

    // 授予锁给下一个等待者
    lockState.locked = true;
    lockState.currentModel = next.model;
    lockState.lockOwner = next.owner;
    lockState.acquiredAt = new Date().toISOString();

    next.resolve({
      success: true,
      lockAcquired: true,
      reason: 'lock_acquired_from_queue',
      model: next.model,
      owner: next.owner,
      waitedMs: Date.now() - next.queuedAt
    });
  }

  return {
    success: true,
    reason: 'lock_released',
    releasedModel,
    heldDurationMs: heldDuration
  };
}

/**
 * 检查 Ollama 当前运行的模型
 * @returns {Promise<Array>} 运行中的模型列表
 */
async function checkRunningModels() {
  return new Promise((resolve) => {
    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/ps',
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const models = (parsed.models || []).map(m => ({
            name: m.name,
            size: m.size,
            sizeVram: m.size_vram,
            digest: m.digest,
            expiresAt: m.expires_at
          }));
          resolve(models);
        } catch (e) {
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.end();
  });
}

/**
 * 检测外部运行的模型（非工作台加载的）
 * @param {string} currentModel - 当前工作台模型
 * @returns {Promise<Array>} 外部模型列表
 */
async function detectExternalModels(currentModel) {
  const running = await checkRunningModels();
  const external = running.filter(m => {
    if (isEmbeddingModel(m.name)) return false;
    if (currentModel && m.name === currentModel) return false;
    return true;
  });
  lockState.externalModels = external;
  return external;
}

/**
 * 尝试卸载模型（仅工作台自己加载的）
 * @param {string} model - 模型名称
 * @param {string} owner - 锁所有者
 * @returns {Promise<Object>} 卸载结果
 */
async function unloadModel(model, owner) {
  // 只允许卸载工作台自己加载的模型
  if (lockState.locked && lockState.lockOwner !== owner) {
    return { success: false, reason: 'not_lock_owner' };
  }

  // 不卸载 embedding 模型
  if (isEmbeddingModel(model)) {
    return { success: false, reason: 'embedding_model_protected' };
  }

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      model,
      keep_alive: 0
    });

    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          success: true,
          model,
          statusCode: res.statusCode,
          reason: 'keep_alive_0_sent'
        });
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, model, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, model, error: 'timeout' });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * 强制释放所有锁（紧急操作，测试用）
 */
function forceReleaseAll() {
  lockState.waitingQueue.forEach(w => {
    if (w.timeout) clearTimeout(w.timeout);
    w.resolve({
      success: false,
      lockAcquired: false,
      reason: 'force_release_all'
    });
  });
  lockState.waitingQueue = [];
  lockState.locked = false;
  lockState.currentModel = null;
  lockState.lockOwner = null;
  lockState.acquiredAt = null;
  lockState.externalModels = [];
}

module.exports = {
  requiresLock,
  isEmbeddingModel,
  getLockState,
  acquireLock,
  releaseLock,
  checkRunningModels,
  detectExternalModels,
  unloadModel,
  forceReleaseAll,
  LARGE_MODELS,
  EMBEDDING_MODELS,
  OLLAMA_HOST,
  OLLAMA_PORT
};
