/**
 * CampaignTaskResilience - Campaign Task 队列增强 + SLA 计时
 * 扩展现有 Campaign Task，不重建新任务系统
 * 规则版本: 1.0.0
 *
 * 新增字段:
 * - taskStatus: pending/running/succeeded/failed/retry_scheduled/overdue/blocked
 * - retryCount, maxRetries, lastAttemptAt, nextRetryAt, lastError, failureCategory
 * - taskHistory: [{at, from, to, actor, action, note}]
 * - dueAt, overdueAt, owner, priorityScore, estimatedMinutes
 *
 * SLA 字段:
 * - receivedAt, firstRespondedAt, slaTargetMinutes, slaStatus, elapsedMinutes, remainingMinutes
 */
(function(global){
  'use strict';

  const RULE_VERSION = '1.0.0';

  // 可重试的临时错误
  const RETRYABLE_ERRORS = ['timeout', '429', '5xx', '500', '502', '503', '504',
    'connection_refused', 'econnrefused', 'network_error', 'enotfound',
    'rate_limited', 'service_unavailable', 'slow_response', 'abort'];

  // 不可重试的配置错误
  const NON_RETRYABLE_ERRORS = ['400', '401', '403', '422', 'invalid_api_key',
    'invalid_parameter', 'content_moderation', 'bad_request', 'unauthorized',
    'forbidden', 'validation_error'];

  // 失败分类
  const FAILURE_CATEGORIES = {
    TEMPORARY: 'temporary',
    CONFIG: 'config',
    DATA: 'data',
    UNKNOWN: 'unknown'
  };

  // SLA 默认值（分钟）
  const SLA_DEFAULTS = {
    high_priority_inquiry: 60,
    normal_inquiry: 240,
    customer_reply: 240,
    campaign_task: 480,
    follow_up: 1440
  };

  // ── 工具函数 ──────────────────────────────────────────────
  function now(){ return new Date().toISOString(); }
  function nowMs(){ return Date.now(); }

  function isRetryableError(error){
    if(!error) return false;
    const err = String(error).toLowerCase();
    return RETRYABLE_ERRORS.some(e => err.includes(e.toLowerCase()));
  }

  function isNonRetryableError(error){
    if(!error) return false;
    const err = String(error).toLowerCase();
    return NON_RETRYABLE_ERRORS.some(e => err.includes(e.toLowerCase()));
  }

  function classifyFailure(error){
    if(isNonRetryableError(error)) return FAILURE_CATEGORIES.CONFIG;
    if(isRetryableError(error)) return FAILURE_CATEGORIES.TEMPORARY;
    if(error && /data|invalid|missing|not found/i.test(String(error))) return FAILURE_CATEGORIES.DATA;
    return FAILURE_CATEGORIES.UNKNOWN;
  }

  function calculateBackoff(retryCount){
    // 指数退避: 1min, 5min, 15min
    const delays = [60000, 300000, 900000];
    return delays[Math.min(retryCount, delays.length - 1)];
  }

  // ── Task 增强 ─────────────────────────────────────────────

  /**
   * 初始化 Task 增强字段（兼容旧数据）
   */
  function initTaskEnhancedFields(task){
    if(!task) return task;
    if(!task.taskStatus) task.taskStatus = 'pending';
    if(task.retryCount === undefined) task.retryCount = 0;
    if(task.maxRetries === undefined) task.maxRetries = 3;
    if(!task.lastAttemptAt) task.lastAttemptAt = null;
    if(!task.nextRetryAt) task.nextRetryAt = null;
    if(!task.lastError) task.lastError = null;
    if(!task.failureCategory) task.failureCategory = null;
    if(!Array.isArray(task.taskHistory)) task.taskHistory = [];
    if(!task.dueAt) task.dueAt = null;
    if(!task.overdueAt) task.overdueAt = null;
    if(!task.owner) task.owner = 'Leo';
    if(task.priorityScore === undefined) task.priorityScore = 50;
    if(task.estimatedMinutes === undefined) task.estimatedMinutes = 15;
    return task;
  }

  /**
   * 记录任务历史
   */
  function addTaskHistory(task, from, to, actor, action, note){
    initTaskEnhancedFields(task);
    task.taskHistory.push({
      at: now(),
      from: from || task.taskStatus,
      to: to,
      actor: actor || 'system',
      action: action,
      note: note || ''
    });
    // 限制历史记录最多50条
    if(task.taskHistory.length > 50){
      task.taskHistory = task.taskHistory.slice(-50);
    }
  }

  /**
   * 标记任务开始执行
   */
  function markTaskRunning(task, actor){
    initTaskEnhancedFields(task);
    const from = task.taskStatus;
    task.taskStatus = 'running';
    task.lastAttemptAt = now();
    addTaskHistory(task, from, 'running', actor || 'system', 'task_start', '任务开始执行');
    return task;
  }

  /**
   * 标记任务成功
   */
  function markTaskSucceeded(task, actor, note){
    initTaskEnhancedFields(task);
    const from = task.taskStatus;
    task.taskStatus = 'succeeded';
    task.lastError = null;
    task.failureCategory = null;
    task.nextRetryAt = null;
    addTaskHistory(task, from, 'succeeded', actor || 'system', 'task_success', note || '任务执行成功');
    return task;
  }

  /**
   * 标记任务失败（自动判断是否可重试）
   */
  function markTaskFailed(task, error, actor){
    initTaskEnhancedFields(task);
    const from = task.taskStatus;
    const category = classifyFailure(error);
    task.lastError = String(error || '未知错误').substring(0, 500);
    task.failureCategory = category;

    if(category === FAILURE_CATEGORIES.TEMPORARY && task.retryCount < task.maxRetries){
      // 可重试：安排重试
      task.retryCount++;
      const backoff = calculateBackoff(task.retryCount);
      task.nextRetryAt = new Date(nowMs() + backoff).toISOString();
      task.taskStatus = 'retry_scheduled';
      addTaskHistory(task, from, 'retry_scheduled', actor || 'system', 'task_retry_scheduled',
        '临时错误，第'+task.retryCount+'次重试，延迟'+Math.round(backoff/60000)+'分钟: '+task.lastError);
      return { task: task, willRetry: true, retryAt: task.nextRetryAt };
    } else {
      // 不可重试或超过重试次数
      task.taskStatus = 'failed';
      task.nextRetryAt = null;
      addTaskHistory(task, from, 'failed', actor || 'system', 'task_failed',
        (category === FAILURE_CATEGORIES.CONFIG ? '配置错误，不自动重试: ' :
         task.retryCount >= task.maxRetries ? '超过最大重试次数: ' : '') + task.lastError);
      return { task: task, willRetry: false };
    }
  }

  /**
   * 手动重试任务
   */
  function retryTaskManually(task, actor){
    initTaskEnhancedFields(task);
    const from = task.taskStatus;
    task.taskStatus = 'pending';
    task.nextRetryAt = null;
    task.lastError = null;
    addTaskHistory(task, from, 'pending', actor || 'user', 'task_manual_retry', '手动触发重试');
    return task;
  }

  /**
   * 标记任务阻断
   */
  function markTaskBlocked(task, reason, actor){
    initTaskEnhancedFields(task);
    const from = task.taskStatus;
    task.taskStatus = 'blocked';
    task.lastError = reason || '被阻断';
    addTaskHistory(task, from, 'blocked', actor || 'system', 'task_blocked', reason);
    return task;
  }

  /**
   * 检查并更新逾期状态
   */
  function checkOverdue(task){
    initTaskEnhancedFields(task);
    if(!task.dueAt) return false;
    const dueTime = new Date(task.dueAt).getTime();
    if(isNaN(dueTime)) return false;
    if(nowMs() > dueTime && !['succeeded','failed','blocked'].includes(task.taskStatus)){
      if(task.taskStatus !== 'overdue'){
        const from = task.taskStatus;
        task.taskStatus = 'overdue';
        task.overdueAt = now();
        addTaskHistory(task, from, 'overdue', 'system', 'task_overdue', '任务已超过截止时间');
      }
      return true;
    }
    return false;
  }

  /**
   * 获取待重试的任务（到了重试时间）
   */
  function getDueRetryTasks(tasks){
    const nowTime = nowMs();
    return (tasks||[]).filter(t => {
      initTaskEnhancedFields(t);
      return t.taskStatus === 'retry_scheduled' &&
             t.nextRetryAt && new Date(t.nextRetryAt).getTime() <= nowTime;
    });
  }

  /**
   * 获取逾期任务
   */
  function getOverdueTasks(tasks){
    return (tasks||[]).filter(t => {
      initTaskEnhancedFields(t);
      return t.taskStatus === 'overdue';
    });
  }

  /**
   * 获取失败任务
   */
  function getFailedTasks(tasks){
    return (tasks||[]).filter(t => {
      initTaskEnhancedFields(t);
      return t.taskStatus === 'failed';
    });
  }

  // ── SLA 计时 ──────────────────────────────────────────────

  /**
   * 初始化 SLA 字段
   */
  function initSlaFields(obj, type){
    if(!obj) return obj;
    if(!obj.receivedAt) obj.receivedAt = now();
    if(!obj.firstRespondedAt) obj.firstRespondedAt = null;
    if(!obj.slaTargetMinutes){
      obj.slaTargetMinutes = SLA_DEFAULTS[type] || SLA_DEFAULTS.normal_inquiry;
    }
    if(!obj.slaStatus) obj.slaStatus = 'on_track';
    return obj;
  }

  /**
   * 计算 SLA 状态
   */
  function calculateSla(obj){
    if(!obj || !obj.receivedAt) return { slaStatus: 'not_applicable', elapsedMinutes: 0, remainingMinutes: null };
    const received = new Date(obj.receivedAt).getTime();
    if(isNaN(received)) return { slaStatus: 'not_applicable', elapsedMinutes: 0, remainingMinutes: null };

    // 已响应
    if(obj.firstRespondedAt){
      const responded = new Date(obj.firstRespondedAt).getTime();
      const elapsed = Math.round((responded - received) / 60000);
      const target = obj.slaTargetMinutes || 240;
      return {
        slaStatus: elapsed <= target ? 'met' : 'breached',
        elapsedMinutes: elapsed,
        remainingMinutes: 0,
        responseMinutes: elapsed
      };
    }

    // 未响应
    const elapsed = Math.round((nowMs() - received) / 60000);
    const target = obj.slaTargetMinutes || 240;
    const remaining = target - elapsed;
    let status = 'on_track';
    if(remaining <= 0) status = 'breached';
    else if(remaining <= target * 0.25) status = 'due_soon';

    return {
      slaStatus: status,
      elapsedMinutes: elapsed,
      remainingMinutes: Math.max(0, remaining)
    };
  }

  /**
   * 标记首次响应
   */
  function markFirstResponse(obj, actor){
    initSlaFields(obj);
    obj.firstRespondedAt = now();
    const sla = calculateSla(obj);
    obj.slaStatus = sla.slaStatus;
    obj.elapsedMinutes = sla.elapsedMinutes;
    obj.remainingMinutes = 0;
    return obj;
  }

  /**
   * 更新 SLA 状态（调用时刷新）
   */
  function refreshSla(obj){
    initSlaFields(obj);
    const sla = calculateSla(obj);
    obj.slaStatus = sla.slaStatus;
    obj.elapsedMinutes = sla.elapsedMinutes;
    obj.remainingMinutes = sla.remainingMinutes;
    return obj;
  }

  /**
   * 检查是否在工作时间（简单判断：周一到周五 9:00-18:00）
   */
  function isWorkingHours(date){
    const d = date || new Date();
    const day = d.getDay();
    const hour = d.getHours();
    return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
  }

  // ── 渲染辅助 ─────────────────────────────────────────────

  /**
   * 渲染任务状态徽章
   */
  function renderTaskStatusBadge(task){
    initTaskEnhancedFields(task);
    const statusColors = {
      pending: {bg:'#fef3c7', color:'#92400e', label:'⏳ 待执行'},
      running: {bg:'#dbeafe', color:'#1e40af', label:'🔄 执行中'},
      succeeded: {bg:'#dcfce7', color:'#166534', label:'✅ 成功'},
      failed: {bg:'#fee2e2', color:'#991b1b', label:'❌ 失败'},
      retry_scheduled: {bg:'#fef9c3', color:'#854d0e', label:'🔁 待重试'},
      overdue: {bg:'#fee2e2', color:'#991b1b', label:'⚠️ 逾期'},
      blocked: {bg:'#f3f4f6', color:'#4b5563', label:'🚫 阻断'}
    };
    const s = statusColors[task.taskStatus] || statusColors.pending;
    return `<span class="badge" style="background:${s.bg};color:${s.color};font-weight:600;font-size:11px">${s.label}</span>`;
  }

  /**
   * 渲染 SLA 状态徽章
   */
  function renderSlaBadge(obj){
    if(!obj || !obj.receivedAt) return '<span class="badge badge-gray" style="font-size:11px">N/A</span>';
    const sla = calculateSla(obj);
    const colors = {
      on_track: {bg:'#dcfce7', color:'#166534', label:'✅ 正常'},
      due_soon: {bg:'#fef9c3', color:'#854d0e', label:'⏰ 即将超时'},
      breached: {bg:'#fee2e2', color:'#991b1b', label:'❌ 已超时'},
      met: {bg:'#dcfce7', color:'#166534', label:'✅ 已响应'},
      not_applicable: {bg:'#f3f4f6', color:'#4b5563', label:'N/A'}
    };
    const s = colors[sla.slaStatus] || colors.not_applicable;
    const timeText = sla.remainingMinutes !== null && sla.remainingMinutes > 0
      ? ' 剩余'+sla.remainingMinutes+'分钟'
      : sla.elapsedMinutes > 0 ? ' 已用'+sla.elapsedMinutes+'分钟' : '';
    return `<span class="badge" style="background:${s.bg};color:${s.color};font-weight:600;font-size:11px">${s.label}${timeText}</span>`;
  }

  /**
   * 渲染任务详情面板（用于今日工作和审核队列）
   */
  function renderTaskResiliencePanel(task){
    initTaskEnhancedFields(task);
    let html = '<div class="card card-pad" style="background:#f8fafc;margin-bottom:8px;padding:10px 14px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
    html += '<div style="display:flex;align-items:center;gap:8px">';
    html += renderTaskStatusBadge(task);
    if(task.retryCount > 0){
      html += `<span class="badge" style="background:#fef3c7;color:#92400e;font-size:11px">重试 ${task.retryCount}/${task.maxRetries}</span>`;
    }
    if(task.estimatedMinutes){
      html += `<span class="text-sm text-muted">预计 ${task.estimatedMinutes} 分钟</span>`;
    }
    html += '</div>';
    if(task.taskStatus === 'retry_scheduled' && task.nextRetryAt){
      html += `<button class="btn btn-xs btn-gold" onclick="CampaignTaskResilience.manualRetryById('${task.taskId}')">立即重试</button>`;
    }
    if(task.taskStatus === 'failed'){
      html += `<button class="btn btn-xs btn-outline" onclick="CampaignTaskResilience.manualRetryById('${task.taskId}')">手动重试</button>`;
    }
    html += '</div>';
    if(task.lastError){
      html += `<div style="font-size:11px;color:#991b1b;margin-top:6px;background:#fef2f2;padding:6px 10px;border-radius:4px">❌ ${escHtml(task.lastError.substring(0,150))}</div>`;
    }
    if(task.dueAt && task.taskStatus === 'overdue'){
      html += `<div style="font-size:11px;color:#991b1b;margin-top:4px">⚠️ 截止时间: ${fmtDate(task.dueAt)}</div>`;
    }
    if(task.taskHistory && task.taskHistory.length > 0){
      const last = task.taskHistory[task.taskHistory.length - 1];
      html += `<div style="font-size:10px;color:#6b7280;margin-top:4px">最近: ${fmtDate(last.at)} ${escHtml(last.note || last.action || '')}</div>`;
    }
    html += '</div>';
    return html;
  }

  function escHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso){
    if(!iso) return '';
    try {
      const d = new Date(iso);
      return d.getMonth()+1 + '/' + d.getDate() + ' ' +
        String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    } catch(e){ return ''; }
  }

  // ── 批量操作 ─────────────────────────────────────────────

  /**
   * 批量初始化所有任务的增强字段
   */
  function initAllTasks(tasks){
    (tasks||[]).forEach(t => initTaskEnhancedFields(t));
    return tasks;
  }

  /**
   * 批量检查逾期
   */
  function checkAllOverdue(tasks){
    let overdueCount = 0;
    (tasks||[]).forEach(t => { if(checkOverdue(t)) overdueCount++; });
    return overdueCount;
  }

  /**
   * 获取任务统计
   */
  function getTaskStats(tasks){
    initAllTasks(tasks);
    return {
      total: tasks.length,
      pending: tasks.filter(t=>t.taskStatus==='pending').length,
      running: tasks.filter(t=>t.taskStatus==='running').length,
      succeeded: tasks.filter(t=>t.taskStatus==='succeeded').length,
      failed: tasks.filter(t=>t.taskStatus==='failed').length,
      retryScheduled: tasks.filter(t=>t.taskStatus==='retry_scheduled').length,
      overdue: tasks.filter(t=>t.taskStatus==='overdue').length,
      blocked: tasks.filter(t=>t.taskStatus==='blocked').length
    };
  }

  // 导出
  global.CampaignTaskResilience = {
    RULE_VERSION: RULE_VERSION,
    initTaskEnhancedFields: initTaskEnhancedFields,
    addTaskHistory: addTaskHistory,
    markTaskRunning: markTaskRunning,
    markTaskSucceeded: markTaskSucceeded,
    markTaskFailed: markTaskFailed,
    retryTaskManually: retryTaskManually,
    markTaskBlocked: markTaskBlocked,
    checkOverdue: checkOverdue,
    getDueRetryTasks: getDueRetryTasks,
    getOverdueTasks: getOverdueTasks,
    getFailedTasks: getFailedTasks,
    initSlaFields: initSlaFields,
    calculateSla: calculateSla,
    markFirstResponse: markFirstResponse,
    refreshSla: refreshSla,
    isWorkingHours: isWorkingHours,
    renderTaskStatusBadge: renderTaskStatusBadge,
    renderSlaBadge: renderSlaBadge,
    renderTaskResiliencePanel: renderTaskResiliencePanel,
    initAllTasks: initAllTasks,
    checkAllOverdue: checkAllOverdue,
    getTaskStats: getTaskStats,
    isRetryableError: isRetryableError,
    classifyFailure: classifyFailure,
    SLA_DEFAULTS: SLA_DEFAULTS,
    manualRetryById: function(taskId){
      // 由 app.js 覆盖实现（需要访问 S.campaignCustomerTasks）
      if(global._manualRetryById) global._manualRetryById(taskId);
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
