/* ============================================================
 * Customer Development Today's Tasks Dashboard (customer-dev-tasks.js)
 * ----------------------------------------------------------------
 * Phase 4 — Feature 4.6 : Follow-up reminders + daily task board.
 *
 * Integrates 5 task streams into one daily dashboard:
 *   1. 📤 Pending sends (first + followup drafts ready to send)
 *   2. ⏰ Due follow-up rounds (Day3/7/14/21/30 reached)
 *   3. 💤 Dormant wake-up (customers idle 30+ days)
 *   4. 📨 Pending replies (customer wrote back, no AI draft yet)
 *   5. 📊 Daily quota (3 email accounts × 5 = 15/day)
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Tasks are reminders only.
 *   - 100% client-side free. No paid services.
 *   - All CSS classes use the cd- prefix. Code comments in English.
 *   - Does NOT modify app.js / server.js.
 * ============================================================ */
(function(){
  'use strict';

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'customerDevTasks',
    icon: '📋',
    label: '今日任务',
    title: '今日任务工作台 · 待发送/待跟进/待回复/沉睡唤醒/配额',
    crumb: '5类任务聚合 · 最佳发送时间排序 · 完成率进度条'
  });

  // ── Ephemeral UI state ─────────────────────────────────────
  if(!window._cdTasks) window._cdTasks = { tab:'all' };

  // ── Constants ───────────────────────────────────────────────
  var CD_TASK_TYPES = [
    { key:'send',    icon:'📤', label:'待发送',   color:'#3182ce' },
    { key:'followup',icon:'⏰', label:'待跟进',   color:'#dd6b20' },
    { key:'reply',   icon:'📨', label:'待回复',   color:'#d69e2e' },
    { key:'wakeup',  icon:'💤', label:'沉睡唤醒', color:'#805ad5' }
  ];

  var CD_QUOTA_PER_ACCOUNT = 5; // mirrors P2_PER_ACCOUNT_MAX in app.js

  // ============================================================
  // Helpers
  // ============================================================
  function cdFindCustomer(id){
    return (S.customers||[]).find(function(x){ return x.id === id; }) || null;
  }
  function cdCustName(c){ return c ? (c.company || c.name || '(未命名)') : ''; }

  function cdTodayStr(){
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function cdDaysSince(iso){
    if(!iso) return 9999;
    var d = new Date(iso);
    if(isNaN(d.getTime())) return 9999;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  // Per-day done/skip state (persisted)
  function cdTaskState(){
    if(!S.cdTasksState) S.cdTasksState = {};
    var today = cdTodayStr();
    if(!S.cdTasksState[today]) S.cdTasksState[today] = { done:[], skipped:[] };
    return S.cdTasksState[today];
  }

  // Best send time label — reuse sending-time module if available, else simple label
  function cdBestSendLabel(c){
    try{
      if(window.cdRecommendSendTime){
        var rec = window.cdRecommendSendTime(c.country || '');
        if(rec) return rec.label;
      }
    }catch(e){}
    return '建议工作时间发送';
  }

  // ============================================================
  // Task collectors
  // ============================================================

  // 1. Pending sends: generated/edited emails not yet sent
  function cdCollectPendingSends(){
    var tasks = [];
    (S.customers||[]).forEach(function(c){
      (c.cdEmails||[]).forEach(function(e){
        if(e && (e.status === 'generated' || e.status === 'edited')){
          tasks.push({
            id: 'send_' + c.id + '_' + e.type,
            type: 'send',
            customerId: c.id,
            customerName: cdCustName(c),
            country: c.country || '',
            productCategory: c.productCategory || '',
            emailType: e.type,
            emailTypeLabel: e.typeLabel || e.type,
            subject: e.subjectEn || '',
            bestSendTime: cdBestSendLabel(c),
            _email: e
          });
        }
      });
    });
    return tasks;
  }

  // 2. Due follow-up rounds
  function cdCollectDueFollowups(){
    if(typeof window.cdFollowupGetDueCustomers !== 'function') return [];
    return window.cdFollowupGetDueCustomers().map(function(d){
      return {
        id: 'followup_' + d.customerId + '_' + d.stepKey,
        type: 'followup',
        customerId: d.customerId,
        customerName: d.customerName,
        country: d.country,
        productCategory: d.productCategory,
        stepKey: d.stepKey,
        stepLabel: d.stepLabel,
        angle: d.angle,
        bestSendTime: cdBestSendLabel(cdFindCustomer(d.customerId) || { country:d.country }),
        _due: d
      };
    });
  }

  // 3. Dormant wake-up
  function cdCollectDormant(){
    // Prefer the dedicated dormant module if it exists
    try{
      if(typeof window.cdDormantGetList === 'function'){
        var list = window.cdDormantGetList() || [];
        return list.slice(0, 20).map(function(d){
          var c = cdFindCustomer(d.customerId || d.id);
          return {
            id: 'wakeup_' + (d.customerId || d.id),
            type: 'wakeup',
            customerId: d.customerId || d.id,
            customerName: d.customerName || cdCustName(c),
            country: (c && c.country) || '',
            productCategory: (c && c.productCategory) || '',
            days: d.days || (c ? cdDaysSince(c.lastContactAt || c.lastComm) : 0),
            recommendedAngle: d.recommendedAngle || '节日/新品问候',
            bestSendTime: cdBestSendLabel(c || {})
          };
        });
      }
    }catch(e){}
    // Fallback: scan customers idle 30+ days with no active sequence
    var out = [];
    (S.customers||[]).forEach(function(c){
      var days = cdDaysSince(c.lastContactAt || c.lastComm || c.lastInteraction);
      if(days >= 30 && days < 180){
        // skip if customer has an active followup sequence in progress
        if(c.cdFollowup && c.cdFollowup.active && !c.cdFollowup.paused) return;
        out.push({
          id: 'wakeup_' + c.id,
          type: 'wakeup',
          customerId: c.id,
          customerName: cdCustName(c),
          country: c.country || '',
          productCategory: c.productCategory || '',
          days: days,
          recommendedAngle: days >= 90 ? '节日问候+新品推荐' : '新品/行业动态分享',
          bestSendTime: cdBestSendLabel(c)
        });
      }
    });
    return out.slice(0, 20);
  }

  // 4. Pending replies: last conversation is from customer, no our reply after
  function cdCollectPendingReplies(){
    var out = [];
    (S.customers||[]).forEach(function(c){
      if(!Array.isArray(c.cdConversations) || !c.cdConversations.length) return;
      // Find last customer message that has no subsequent 'us' message
      var convs = c.cdConversations;
      var lastCustIdx = -1;
      for(var i = convs.length-1; i >= 0; i--){
        if(convs[i].role === 'customer'){ lastCustIdx = i; break; }
      }
      if(lastCustIdx < 0) return;
      // Check if there's any 'us' message after lastCustIdx
      var hasOurReply = false;
      for(var j = lastCustIdx+1; j < convs.length; j++){
        if(convs[j].role === 'us'){ hasOurReply = true; break; }
      }
      if(hasOurReply) return;
      var lastCust = convs[lastCustIdx];
      out.push({
        id: 'reply_' + c.id + '_' + (lastCust.id || lastCustIdx),
        type: 'reply',
        customerId: c.id,
        customerName: cdCustName(c),
        country: c.country || '',
        productCategory: c.productCategory || '',
        replySummary: String(lastCust.content || '').substring(0, 120),
        intent: lastCust.intent || '未分类',
        sentiment: lastCust.sentiment || 'neutral',
        timestamp: lastCust.timestamp,
        bestSendTime: cdBestSendLabel(c)
      });
    });
    return out;
  }

  // 5. Quota
  function cdGetQuota(){
    var accounts = S.emailAccounts || [];
    var today = cdTodayStr();
    var total = 0, used = 0;
    var perAccount = accounts.map(function(a){
      var usedToday = (a.dailySentDate === today) ? (a.dailySentCount || 0) : 0;
      total += CD_QUOTA_PER_ACCOUNT;
      used += usedToday;
      return {
        name: a.name || a.email || ('账号'+a.id),
        used: usedToday,
        max: CD_QUOTA_PER_ACCOUNT
      };
    });
    if(!accounts.length){
      // fallback: assume 3 accounts
      total = 3 * CD_QUOTA_PER_ACCOUNT;
    }
    return { total: total, used: used, remaining: Math.max(0, total - used), perAccount: perAccount };
  }

  // ============================================================
  // Public API
  // ============================================================
  window.cdTasksGetAll = function(){
    return {
      send: cdCollectPendingSends(),
      followup: cdCollectDueFollowups(),
      wakeup: cdCollectDormant(),
      reply: cdCollectPendingReplies(),
      quota: cdGetQuota(),
      date: cdTodayStr()
    };
  };

  window.cdTasksMarkDone = function(taskId){
    var st = cdTaskState();
    if(st.done.indexOf(taskId) < 0) st.done.push(taskId);
    persist();
    toast('✅ 任务已标记完成');
    renderView();
  };

  window.cdTasksSkip = function(taskId){
    var st = cdTaskState();
    if(st.skipped.indexOf(taskId) < 0) st.skipped.push(taskId);
    persist();
    toast('已跳过该任务');
    renderView();
  };

  window.cdTasksGetQuota = function(){
    return cdGetQuota();
  };

  // ============================================================
  // Rendering
  // ============================================================
  function cdTypeBadge(t){
    var def = CD_TASK_TYPES.find(function(x){ return x.key === t; }) || CD_TASK_TYPES[0];
    return '<span class="cd-badge" style="background:'+def.color+'22;color:'+def.color+'">'+def.icon+' '+def.label+'</span>';
  }

  function cdTaskRow(t, state){
    var done = state.done.indexOf(t.id) >= 0;
    var skipped = state.skipped.indexOf(t.id) >= 0;
    var h = '<div class="cd-task' + (done?' done':'') + (skipped?' skipped':'') + '">'
      + '<div class="cd-task-main">'
      + '<div class="cd-task-head">' + cdTypeBadge(t.type)
      + '<b style="margin-left:8px">' + esc(t.customerName) + '</b>'
      + '<span class="cd-task-meta">📍 ' + esc(t.country||'—') + ' · 🗂 ' + esc(t.productCategory||'—') + '</span>'
      + '</div>';
    // type-specific detail
    if(t.type === 'send'){
      h += '<div class="cd-task-detail">📧 ' + esc(t.emailTypeLabel||t.emailType)
        + (t.subject ? ' · 主题: ' + esc(t.subject.substring(0,50)) : '')
        + '</div>';
    }else if(t.type === 'followup'){
      h += '<div class="cd-task-detail">⏰ ' + esc(t.stepLabel) + ' · 角度: ' + esc(t.angle) + '</div>';
    }else if(t.type === 'reply'){
      h += '<div class="cd-task-detail">📥 客户回复: ' + esc(t.replySummary) + ' <small class="text-muted">(意图: ' + esc(t.intent) + ')</small></div>';
    }else if(t.type === 'wakeup'){
      h += '<div class="cd-task-detail">💤 已沉睡 ' + t.days + ' 天 · 推荐角度: ' + esc(t.recommendedAngle) + '</div>';
    }
    h += '<div class="cd-task-detail cd-task-time">🕐 ' + esc(t.bestSendTime||'') + '</div>';
    h += '</div>';
    // actions
    h += '<div class="cd-task-actions">';
    if(!done && !skipped){
      if(t.type === 'send'){
        h += '<button class="btn btn-primary btn-sm" onclick="cdTasksGoEmail(\'' + t.customerId + '\',\'' + (t.emailType||'') + '\')">✏️ 打开编辑</button>';
      }else if(t.type === 'followup'){
        h += '<button class="btn btn-primary btn-sm" onclick="cdTasksGoFollowup(\'' + t.customerId + '\',\'' + (t.stepKey||'') + '\')">✨ 生成跟进信</button>';
      }else if(t.type === 'reply'){
        h += '<button class="btn btn-primary btn-sm" onclick="cdTasksGoReply(\'' + t.customerId + '\')">📨 生成回复草稿</button>';
      }else if(t.type === 'wakeup'){
        h += '<button class="btn btn-primary btn-sm" onclick="cdTasksGoWakeup(\'' + t.customerId + '\')">💤 生成唤醒邮件</button>';
      }
      h += '<button class="btn btn-outline btn-sm" onclick="cdTasksMarkDone(\'' + t.id + '\')">✓ 完成</button>';
      h += '<button class="btn btn-outline btn-sm" onclick="cdTasksSkip(\'' + t.id + '\')" title="跳过今日">✖ 跳过</button>';
    }else if(done){
      h += '<span class="cd-badge" style="background:#38a16922;color:#38a169">✅ 已完成</span>';
    }else{
      h += '<span class="cd-badge" style="background:#a0aec022;color:#718096">⏭ 已跳过</span>';
    }
    h += '</div></div>';
    return h;
  }

  // Navigation helpers (jump to the right module page)
  window.cdTasksGoEmail = function(cid, type){
    if(typeof go === 'function') go('customerDevEmail', { customerId: cid });
    else if(window.location.hash) window.location.hash = '#customerDevEmail';
    toast('已跳转到开发信引擎，请手动发送（本工作台不自动发送）');
  };
  window.cdTasksGoFollowup = function(cid, stepKey){
    if(window.cfSelectCustomer) window.cfSelectCustomer(cid);
    if(window.cfToggleStep) window.cfToggleStep(stepKey);
    if(typeof go === 'function') go('customerDevFollowup');
    toast('已跳转到跟进序列，可生成对应轮次邮件');
  };
  window.cdTasksGoReply = function(cid){
    toast('回复草稿模块尚未启用，请在客户详情中手动记录并回复。');
  };
  window.cdTasksGoWakeup = function(cid){
    toast('沉睡唤醒模块尚未启用，建议直接到「开发信引擎」选择客户生成新邮件。');
  };

  function cdRenderQuota(q){
    var pct = q.total ? Math.round(q.used / q.total * 100) : 0;
    var h = '<div class="cd-quota">'
      + '<div class="cd-quota-head"><b>📊 今日发送配额</b> <span class="cd-hint">3个邮箱 × 5封 = 15封/天（防封禁）</span></div>'
      + '<div class="cd-quota-nums"><span class="cd-quota-used">' + q.used + '</span> / <span class="cd-quota-total">' + q.total + '</span> 已发送 · 剩余 <b>' + q.remaining + '</b> 封</div>'
      + '<div class="cd-quota-bar"><div class="cd-quota-fill" style="width:' + pct + '%"></div></div>';
    if(q.perAccount && q.perAccount.length){
      h += '<div class="cd-quota-accs">';
      q.perAccount.forEach(function(a){
        h += '<span class="cd-chip">' + esc(a.name) + ': ' + a.used + '/' + a.max + '</span>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function cdRenderPage(root){
    var all = window.cdTasksGetAll();
    var state = cdTaskState();
    var tab = window._cdTasks.tab;

    var allTasks = [].concat(all.send, all.followup, all.reply, all.wakeup);
    // filter out done/skipped from the main list unless tab=all shows them greyed
    var activeTasks = allTasks.filter(function(t){
      return state.done.indexOf(t.id) < 0 && state.skipped.indexOf(t.id) < 0;
    });
    var doneCount = allTasks.filter(function(t){ return state.done.indexOf(t.id) >= 0; }).length;
    var totalCount = allTasks.length;
    var pct = totalCount ? Math.round(doneCount / totalCount * 100) : 0;

    var h = '';
    h += '<div class="flex-between mb16">'
      + '<div><h2 style="margin:0">📋 今日任务工作台</h2>'
      + '<div class="text-sm text-muted" style="margin-top:4px">' + all.date + ' · 整合待发送/待跟进/待回复/沉睡唤醒/配额</div></div>'
      + '</div>';

    // Quota card
    h += cdRenderQuota(all.quota);

    // Progress
    h += '<div class="cd-progress-card">'
      + '<div class="cd-progress-head"><b>今日完成率</b> <span class="cd-hint">' + doneCount + ' / ' + totalCount + ' 项</span></div>'
      + '<div class="cd-quota-bar"><div class="cd-quota-fill" style="width:' + pct + '%;background:#38a169"></div></div>'
      + '</div>';

    // Tabs
    h += '<div class="cd-task-tabs">';
    var tabs = [['all','全部'],['send','📤 待发送'],['followup','⏰ 待跟进'],['reply','📨 待回复'],['wakeup','💤 沉睡唤醒']];
    tabs.forEach(function(t){
      var count = t[0]==='all' ? activeTasks.length : activeTasks.filter(function(x){ return x.type===t[0]; }).length;
      h += '<div class="cd-tasktab' + (tab===t[0]?' on':'') + '" onclick="cdTasksTab(\'' + t[0] + '\')">' + t[1]
        + ' <span class="cd-tasktab-n">' + count + '</span></div>';
    });
    h += '</div>';

    // Task list
    var filtered = tab === 'all' ? activeTasks : activeTasks.filter(function(t){ return t.type === tab; });
    if(!filtered.length){
      h += '<div class="cd-empty">🎉 该分类下今日暂无待办任务。<br><span class="cd-hint">完成的任务会保留在上方完成率统计中。</span></div>';
    }else{
      h += '<div class="cd-tasklist">';
      filtered.forEach(function(t){ h += cdTaskRow(t, state); });
      h += '</div>';
    }

    // Today's done/skipped summary
    var doneList = allTasks.filter(function(t){ return state.done.indexOf(t.id) >= 0 || state.skipped.indexOf(t.id) >= 0; });
    if(doneList.length){
      h += '<div class="cd-done-head">✅ 今日已处理（' + doneList.length + '）</div>';
      h += '<div class="cd-donelist">';
      doneList.forEach(function(t){ h += cdTaskRow(t, state); });
      h += '</div>';
    }

    // Safety footer
    h += '<div class="cd-footer-bar">'
      + '<span class="cd-hint">🔒 本工作台只聚合任务提醒，<b>绝不自动发送邮件/WhatsApp</b>。点击任务按钮跳转到对应模块手动生成/发送。'
      + '配额按邮箱日发送上限统计，避免触发 spam 风控。</span></div>';

    root.innerHTML = h;
  }

  window.cdTasksTab = function(t){ window._cdTasks.tab = t; renderView(); };

  // ── renderView interception ───────────────────────────────
  var _cdTasksOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'customerDevTasks'){
      cdRenderPage(document.getElementById('mainContent'));
      return;
    }
    _cdTasksOrigRV.apply(this, arguments);
  };

  // ── Styles (cd- prefixed, responsive) ─────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-quota{background:linear-gradient(135deg,#ebf8ff,#f0fff4);border:1px solid #bee3f8;border-radius:12px;padding:14px;margin-bottom:12px;}'
    + '.cd-quota-head{font-size:14px;color:#2d3748;margin-bottom:6px;}'
    + '.cd-quota-nums{font-size:13px;color:#4a5568;margin-bottom:8px;}'
    + '.cd-quota-used{font-size:22px;font-weight:700;color:#dd6b20;}'
    + '.cd-quota-total{font-size:16px;color:#718096;}'
    + '.cd-quota-bar{height:10px;background:#edf2f7;border-radius:5px;overflow:hidden;margin:6px 0;}'
    + '.cd-quota-fill{height:100%;background:#dd6b20;transition:width .3s;}'
    + '.cd-quota-accs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}'
    + '.cd-progress-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:14px;}'
    + '.cd-progress-head{font-size:13px;color:#2d3748;margin-bottom:6px;display:flex;justify-content:space-between;}'
    + '.cd-task-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}'
    + '.cd-tasktab{padding:6px 14px;border:1px solid #e2e8f0;border-radius:16px;cursor:pointer;font-size:13px;background:#fff;color:#4a5568;}'
    + '.cd-tasktab.on{background:#3182ce;color:#fff;border-color:#3182ce;font-weight:600;}'
    + '.cd-tasktab-n{font-size:11px;background:#edf2f7;border-radius:8px;padding:1px 7px;margin-left:4px;}'
    + '.cd-tasktab.on .cd-tasktab-n{background:rgba(255,255,255,.25);color:#fff;}'
    + '.cd-tasklist{display:flex;flex-direction:column;gap:10px;margin-bottom:16px;}'
    + '.cd-task{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;}'
    + '.cd-task.done{opacity:.55;border-style:dashed;}'
    + '.cd-task.skipped{opacity:.45;border-style:dashed;}'
    + '.cd-task-main{flex:1;min-width:0;}'
    + '.cd-task-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:14px;}'
    + '.cd-task-meta{font-size:12px;color:#718096;margin-left:auto;}'
    + '.cd-task-detail{font-size:12.5px;color:#4a5568;margin-top:5px;line-height:1.6;}'
    + '.cd-task-time{color:#2b6cb0;font-size:12px;}'
    + '.cd-task-actions{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;}'
    + '.cd-done-head{font-size:13px;font-weight:700;color:#38a169;margin:14px 0 8px;}'
    + '.cd-donelist{display:flex;flex-direction:column;gap:8px;margin-bottom:14px;}'
    + '.cd-chip{display:inline-block;font-size:11.5px;background:#ebf8ff;color:#2b6cb0;padding:2px 9px;border-radius:10px;}'
    + '@media (max-width:900px){'
    + '  .cd-task{flex-direction:column;}'
    + '  .cd-task-actions{justify-content:flex-start;}'
    + '  .cd-task-meta{margin-left:0;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
