/* ============================================================
 * P5 Phase5 Module A: AI Insights & Audit
 * ----------------------------------------------------------------
 * Feature 2: AI proactive action suggestions (pure rule engine,
 *            NO AI call, derived from S.customers / S.sendRecords /
 *            S.emailAccounts / S.drafts).
 * Feature 3: AI decision audit log (records AI-generated outreach
 *            outputs, human approve / modify / reject, stats).
 * - Pure frontend module, loaded AFTER app.js and phase modules.
 * - HARD RULE: this module NEVER sends any email / WhatsApp.
 * - No paid API. Feature 2 & 3 do NOT call callAI at all.
 * - All new CSS classes use the p5- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ──────────────────────────────────────────────
  if(!Array.isArray(S.p5ActionSuggestions)) S.p5ActionSuggestions = [];
  if(!S.p5SuggestionMeta) S.p5SuggestionMeta = { lastGenerated:null, generationCount:0 };
  if(!Array.isArray(S.p5AuditLogs)) S.p5AuditLogs = [];

  // ── Local helpers ──────────────────────────────────────────
  function p5NowISO(){ return new Date().toISOString(); }

  function p5TodayStr(){
    if(typeof p2TodayStr === 'function') return p2TodayStr();
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p5FmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p5FmtTime(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return p5FmtDate(iso)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  function p5FindCustomer(id){
    return (S.customers||[]).find(function(x){ return x.id===id; }) || null;
  }

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({key:'aiSuggestions', icon:'💡', label:'AI行动建议', title:'AI主动行动建议', crumb:'数据驱动 · 可执行建议 · 一键跳转'});
  NAV.push({key:'aiAudit', icon:'🔍', label:'AI决策审计', title:'AI决策审计日志', crumb:'人工审核门控 · 通过率统计 · 修改对比'});

  // ═══════════════════════════════════════════════════════════
  //  FEATURE 2: RULE ENGINE — generate action suggestions
  // ═══════════════════════════════════════════════════════════
  var P5_SUG_TYPE_META = {
    high_intent:  { icon:'🔥', label:'高意向待跟进', actionLabel:'前往客户台账' },
    follow_up:    { icon:'📅', label:'到期跟进',     actionLabel:'前往客户台账' },
    no_reply:     { icon:'⏳', label:'超7天无回复',  actionLabel:'查看发送记录' },
    high_open:    { icon:'👀', label:'高打开未回复', actionLabel:'查看发送记录' },
    quota_warning:{ icon:'⚠️', label:'邮箱配额预警',  actionLabel:'前往每日发送' },
    pending_draft:{ icon:'📝', label:'待审核草稿',   actionLabel:'前往开发信' }
  };

  // Rule 1: high-intent customers who are not followed up on time.
  function p5RuleHighIntent(){
    var now = new Date();
    var list = (S.customers||[]).filter(function(c){
      if(c.status === '已回复') return false;
      var isHot = (c.highIntent === true) || (Number(c.dynamicIntentScore) >= 70);
      if(!isHot) return false;
      if(!c.nextFollowUp) return true; // no follow-up date set -> due
      return new Date(c.nextFollowUp) <= now;
    });
    if(!list.length) return null;
    return {
      type: list.length >= 3 ? 'high_intent' : 'follow_up',
      priority: 'high',
      title: '本周有 '+list.length+' 个高意向客户待跟进',
      detail: '客户：'+list.slice(0,5).map(function(c){return c.company||(c.contact&&c.contact.name)||'未命名';}).join('、')+(list.length>5?' 等':'')+'。建议今天优先联系，避免高意向线索流失。',
      customerId: list[0].id,
      actionView: 'customers'
    };
  }

  // Rule 2: last outreach sent > 7 days ago, still no reply.
  function p5RuleNoReply(){
    var cutoff = Date.now() - 7*24*3600*1000;
    var byCustomer = {};
    (S.sendRecords||[]).forEach(function(r){
      if(!r || !r.customerId || !r.sentAt) return;
      var t = new Date(r.sentAt).getTime();
      if(isNaN(t)) return;
      if(!byCustomer[r.customerId] || t > byCustomer[r.customerId]) byCustomer[r.customerId] = t;
    });
    var names = [];
    Object.keys(byCustomer).forEach(function(cid){
      if(byCustomer[cid] > cutoff) return; // last send within 7 days -> not stale
      // replied flag check: any record for this customer with replied=true
      var replied = (S.sendRecords||[]).some(function(r){ return r.customerId===cid && r.replied === true; });
      if(replied) return;
      var c = p5FindCustomer(cid);
      if(c && c.status === '已回复') return;
      names.push(c ? (c.company||(c.contact&&c.contact.name)||cid) : cid);
    });
    if(!names.length) return null;
    return {
      type: 'no_reply',
      priority: 'medium',
      title: names.length+' 个客户发送超过7天仍无回复',
      detail: '客户：'+names.slice(0,5).join('、')+(names.length>5?' 等':'')+'。建议发送第二封跟进邮件（换角度/加价值点）。',
      customerId: null,
      actionView: 'sendHistory'
    };
  }

  // Rule 3: opened the email >= 3 times but never replied.
  function p5RuleHighOpen(){
    var hits = [];
    (S.sendRecords||[]).forEach(function(r){
      if(!r || !r.customerId || r.replied === true) return;
      if(Number(r.opens||0) >= 3){
        var c = p5FindCustomer(r.customerId);
        if(c && c.status === '已回复') return;
        hits.push(c ? (c.company||(c.contact&&c.contact.name)||r.customerId) : r.customerId);
      }
    });
    if(!hits.length) return null;
    return {
      type: 'high_open',
      priority: 'medium',
      title: hits.length+' 个客户已打开邮件3次以上但未回复',
      detail: '客户：'+hits.slice(0,5).join('、')+(hits.length>5?' 等':'')+'。高打开=有兴趣但犹豫，建议电话或WhatsApp直接联系。',
      customerId: null,
      actionView: 'sendHistory'
    };
  }

  // Rule 4: email daily quota nearly exhausted.
  function p5RuleQuota(){
    var alerts = [];
    (S.emailAccounts||[]).forEach(function(a){
      var limit = Number(a.dailyLimit||0);
      var used = Number(a.dailySentCount||0);
      if(limit > 0 && used >= limit - 1){
        alerts.push({ email:a.email||a.id, left: Math.max(0, limit-used) });
      }
    });
    if(!alerts.length) return null;
    var worst = alerts[0];
    return {
      type: 'quota_warning',
      priority: 'high',
      title: alerts.length+' 个邮箱今日配额即将用完',
      detail: alerts.map(function(x){ return x.email+'（剩'+x.left+'封）'; }).join('；')+'。建议启用备用邮箱或明日再发，避免触发发送限制。',
      customerId: null,
      actionView: 'dailySend'
    };
  }

  // Rule 5: drafts waiting for review.
  function p5RulePendingDrafts(){
    var list = (S.drafts||[]).filter(function(d){ return d.status === '待检查' || d.status === '待审核'; });
    if(!list.length) return null;
    return {
      type: 'pending_draft',
      priority: 'low',
      title: '有 '+list.length+' 封开发信待质检/审核',
      detail: '待审核草稿堆积会拖慢发送节奏，建议今天完成质检并人工终审。',
      customerId: null,
      actionView: 'drafts'
    };
  }

  // Run all rules and rebuild today's suggestion list.
  window.p5GenerateSuggestions = function(force){
    var today = p5TodayStr();
    var meta = S.p5SuggestionMeta;
    if(!force && meta.lastGenerated){
      var d = new Date(meta.lastGenerated);
      var elapsedMs = Date.now() - d.getTime();
      // same day already generated AND within 4 hours -> keep existing
      if(p5FmtDate(d) === today && elapsedMs < 4*3600*1000){
        return;
      }
    }
    var raw = [ p5RuleHighIntent(), p5RuleNoReply(), p5RuleHighOpen(), p5RuleQuota(), p5RulePendingDrafts() ];
    var now = p5NowISO();
    var list = [];
    raw.forEach(function(r){
      if(!r) return;
      var m = P5_SUG_TYPE_META[r.type] || { icon:'📌', label:'建议', actionLabel:'前往处理' };
      list.push({
        id: uid(),
        type: r.type,
        priority: r.priority,
        title: r.title,
        detail: r.detail,
        customerId: r.customerId,
        actionLabel: m.actionLabel,
        actionView: r.actionView,
        createdAt: now,
        dismissed: false
      });
    });
    var order = { high:0, medium:1, low:2 };
    list.sort(function(a,b){ return (order[a.priority]-order[b.priority]) || (a.createdAt<b.createdAt?1:-1); });
    S.p5ActionSuggestions = list;
    meta.lastGenerated = now;
    meta.generationCount = (meta.generationCount||0) + 1;
    persist();
  };

  // Manual refresh button.
  window.p5RefreshSuggestions = function(){
    p5GenerateSuggestions(true);
    toast('建议已重新生成（'+S.p5ActionSuggestions.length+' 条）');
    renderView();
  };

  // Dismiss one suggestion.
  window.p5DismissSuggestion = function(id){
    (S.p5ActionSuggestions||[]).forEach(function(s){ if(s.id===id) s.dismissed = true; });
    persist();
    renderView();
  };

  // Jump to the target view.
  window.p5HandleSuggestion = function(id){
    var s = (S.p5ActionSuggestions||[]).find(function(x){ return x.id===id; });
    if(!s) return;
    go(s.actionView, s.customerId ? { q:'' } : undefined);
  };

  // ── View: AI Suggestions ──────────────────────────────────
  window.viewAiSuggestions = function(root){
    p5GenerateSuggestions(false); // auto-generate if stale / empty
    var list = (S.p5ActionSuggestions||[]).filter(function(s){ return !s.dismissed; });
    var meta = S.p5SuggestionMeta;

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">💡 AI 主动行动建议</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">基于客户台账 / 发送记录 / 邮箱配额实时计算 · 每4小时自动刷新一次 · 不消耗AI额度</div></div>';
    h += '  <button class="btn btn-primary" onclick="p5RefreshSuggestions()">🔄 刷新建议</button>';
    h += '</div>';

    h += '<div class="p5-meta-bar">上次生成：'+p5FmtTime(meta.lastGenerated)+' · 累计生成 '+ (meta.generationCount||0) +' 次 · 当前待处理 '+list.length+' 条</div>';

    if(!list.length){
      h += '<div class="p5-empty">🎉 暂无行动建议，继续保持！系统每天会自动扫描客户跟进、发送记录和邮箱配额。</div>';
      root.innerHTML = h;
      return;
    }

    var prioMeta = {
      high:   { cls:'high',   label:'高优先级' },
      medium: { cls:'medium', label:'中优先级' },
      low:    { cls:'low',    label:'低优先级' }
    };
    h += '<div class="p5-sug-list">';
    list.forEach(function(s){
      var pm = prioMeta[s.priority] || prioMeta.low;
      var tm = P5_SUG_TYPE_META[s.type] || { icon:'📌' };
      var c = s.customerId ? p5FindCustomer(s.customerId) : null;
      h += '<div class="p5-sug-card '+pm.cls+'">';
      h += '  <div class="p5-sug-icon">'+tm.icon+'</div>';
      h += '  <div class="p5-sug-body">';
      h += '    <div class="p5-sug-title">'+esc(s.title)+' <span class="p5-prio-tag '+pm.cls+'">'+pm.label+'</span></div>';
      h += '    <div class="p5-sug-detail">'+esc(s.detail)+'</div>';
      if(c) h += '    <div class="p5-sug-cust">关联客户：'+esc(c.company||(c.contact&&c.contact.name)||'—')+'</div>';
      h += '  </div>';
      h += '  <div class="p5-sug-actions">';
      h += '    <button class="btn btn-primary btn-sm" onclick="p5HandleSuggestion(\''+s.id+'\')">'+esc(s.actionLabel)+' →</button>';
      h += '    <button class="btn btn-outline btn-sm" onclick="p5DismissSuggestion(\''+s.id+'\')">忽略</button>';
      h += '  </div>';
      h += '</div>';
    });
    h += '</div>';
    root.innerHTML = h;
  };

  // ═══════════════════════════════════════════════════════════
  //  FEATURE 3: AI DECISION AUDIT LOG
  // ═══════════════════════════════════════════════════════════

  // Create a pending audit record for an AI-generated output.
  // opts: {contentType, customerId, customerName, aiOutput, aiFullContent, model, refId, refType}
  window.p5LogAudit = function(opts){
    opts = opts || {};
    var id = uid();
    var rec = {
      id: id,
      contentType: opts.contentType || '开发信',
      customerId: opts.customerId || null,
      customerName: opts.customerName || '',
      aiOutput: String(opts.aiOutput || '').slice(0, 200),
      aiFullContent: opts.aiFullContent ? String(opts.aiFullContent).slice(0, 4000) : (opts.aiOutput ? String(opts.aiOutput).slice(0, 4000) : ''),
      humanAction: 'pending', // pending | approved | modified | rejected
      modifiedContent: '',
      changeSummary: '',
      rejectedReason: '',
      sentAt: null,
      createdAt: opts.createdAt || p5NowISO(),
      reviewedAt: null,
      model: opts.model || 'AI',
      refId: opts.refId || null,   // link back to S.drafts / replyDrafts / wakeupDrafts
      refType: opts.refType || null
    };
    S.p5AuditLogs.push(rec);
    persist();
    return id;
  };

  // Update an audit record after human review.
  // opts: {humanAction, modifiedContent, changeSummary, rejectedReason, sentAt}
  window.p5UpdateAudit = function(id, opts){
    opts = opts || {};
    var rec = (S.p5AuditLogs||[]).find(function(x){ return x.id===id; });
    if(!rec) return;
    if(opts.humanAction) rec.humanAction = opts.humanAction;
    if(opts.modifiedContent !== undefined) rec.modifiedContent = String(opts.modifiedContent||'').slice(0,4000);
    if(opts.changeSummary !== undefined) rec.changeSummary = String(opts.changeSummary||'').slice(0,500);
    if(opts.rejectedReason !== undefined) rec.rejectedReason = String(opts.rejectedReason||'').slice(0,500);
    if(opts.sentAt !== undefined) rec.sentAt = opts.sentAt || null;
    if(rec.humanAction !== 'pending') rec.reviewedAt = p5NowISO();
    persist();
  };

  // ── Polling: auto-capture NEW drafts / replyDrafts / wakeupDrafts ──
  // Track seen ids so we never double-log. Existing items at load time
  // are pre-seeded (not logged retroactively).
  var p5Seen = {};
  function p5MarkSeen(list, type){
    (list||[]).forEach(function(it){ if(it && it.id) p5Seen[type+'::'+it.id] = true; });
  }
  p5MarkSeen(S.drafts, '开发信');
  p5MarkSeen(S.replyDrafts, 'AI回复');
  p5MarkSeen(S.wakeupDrafts, '唤醒话术');

  function p5ScanList(list, type){
    (list||[]).forEach(function(it){
      if(!it || !it.id) return;
      var key = type+'::'+it.id;
      if(p5Seen[key]) return;
      p5Seen[key] = true;
      var content = String(it.subject||it.title||'')+'\n'+String(it.body||it.content||it.message||'');
      if(content.trim().length < 5) return;
      // skip duplicates already recorded (e.g. manual entry)
      var dup = (S.p5AuditLogs||[]).some(function(a){ return a.refType===type && a.refId===it.id; });
      if(dup) return;
      var cName = '';
      if(it.customerId){
        var c = p5FindCustomer(it.customerId);
        cName = c ? (c.company||(c.contact&&c.contact.name)||'') : '';
      }
      window.p5LogAudit({
        contentType: type,
        customerId: it.customerId || null,
        customerName: cName,
        aiOutput: content.slice(0,200),
        aiFullContent: content.slice(0,4000),
        model: it.aiModel || it.model || 'AI',
        refId: it.id,
        refType: type,
        createdAt: it.createdAt || p5NowISO()
      });
    });
  }
  setInterval(function(){
    try {
      p5ScanList(S.drafts, '开发信');
      p5ScanList(S.replyDrafts, 'AI回复');
      p5ScanList(S.wakeupDrafts, '唤醒话术');
    } catch(e){ /* never break the app */ }
  }, 5000);

  // ── Audit view helpers ─────────────────────────────────────
  var P5_ACTION_META = {
    approved: { t:'通过', icon:'✅', color:'#38a169' },
    modified: { t:'修改后通过', icon:'✏️', color:'#d69e2e' },
    rejected: { t:'拒绝', icon:'❌', color:'#c53030' },
    pending:  { t:'待审核', icon:'⏳', color:'#a0aec0' }
  };

  function p5AuditStats(){
    var logs = S.p5AuditLogs||[];
    var total = logs.length;
    var approved = logs.filter(function(l){return l.humanAction==='approved';}).length;
    var modified = logs.filter(function(l){return l.humanAction==='modified';}).length;
    var rejected = logs.filter(function(l){return l.humanAction==='rejected';}).length;
    var pending = logs.filter(function(l){return l.humanAction==='pending';}).length;
    var audited = approved+modified+rejected;
    var passRate = audited ? Math.round(approved/audited*100) : 0;
    var modRate  = audited ? Math.round(modified/audited*100) : 0;
    return { total:total, approved:approved, modified:modified, rejected:rejected, pending:pending, passRate:passRate, modRate:modRate };
  }

  // ── View: AI Audit ────────────────────────────────────────
  window.viewAiAudit = function(root){
    var st = p5AuditStats();
    var fType = window._p5AuditType || '';
    var fAct  = window._p5AuditAction || '';

    var logs = (S.p5AuditLogs||[]).slice().reverse(); // newest first
    if(fType) logs = logs.filter(function(l){ return l.contentType===fType; });
    if(fAct)  logs = logs.filter(function(l){ return l.humanAction===fAct; });

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">🔍 AI 决策审计日志</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">每一封AI生成的开发信/回复/唤醒话术都在此留痕 · 人工审核门控 · 自动监听草稿新增</div></div>';
    h += '  <button class="btn btn-primary" onclick="p5AuditManualModal()">📝 手动记录AI输出</button>';
    h += '</div>';

    // stats cards
    h += '<div class="p5-audit-stats">';
    h += '  <div class="p5-a-stat"><div class="p5-a-num">'+st.total+'</div><div class="p5-a-lbl">总记录</div></div>';
    h += '  <div class="p5-a-stat"><div class="p5-a-num" style="color:#38a169">'+st.passRate+'%</div><div class="p5-a-lbl">通过率（直接通过）</div></div>';
    h += '  <div class="p5-a-stat"><div class="p5-a-num" style="color:#d69e2e">'+st.modRate+'%</div><div class="p5-a-lbl">修改后通过率</div></div>';
    h += '  <div class="p5-a-stat"><div class="p5-a-num" style="color:#c53030">'+st.rejected+'</div><div class="p5-a-lbl">拒绝数（待审核 '+st.pending+'）</div></div>';
    h += '</div>';

    // filters
    h += '<div class="p5-audit-filter">';
    h += '  <label>内容类型</label><select class="form-control" onchange="p5SetAuditFilter(\'type\',this.value)">';
    h += '  <option value="">全部</option>';
    ['开发信','AI回复','唤醒话术'].forEach(function(t){
      h += '<option value="'+t+'"'+(fType===t?' selected':'')+'>'+t+'</option>';
    });
    h += '  </select>';
    h += '  <label>审核状态</label><select class="form-control" onchange="p5SetAuditFilter(\'action\',this.value)">';
    h += '  <option value="">全部</option>';
    Object.keys(P5_ACTION_META).forEach(function(k){
      h += '<option value="'+k+'"'+(fAct===k?' selected':'')+'>'+P5_ACTION_META[k].icon+' '+P5_ACTION_META[k].t+'</option>';
    });
    h += '  </select>';
    h += '</div>';

    if(!logs.length){
      h += '<div class="p5-empty">暂无审计记录。当AI生成新的开发信/回复/唤醒话术时，系统会每5秒自动捕获并记录在这里。</div>';
      root.innerHTML = h;
      return;
    }

    h += '<div class="p5-audit-list">';
    logs.forEach(function(l){
      var am = P5_ACTION_META[l.humanAction] || P5_ACTION_META.pending;
      h += '<div class="p5-audit-card" style="border-left:4px solid '+am.color+'">';
      h += '  <div class="p5-audit-head" onclick="p5AuditDetail(\''+l.id+'\')" style="cursor:pointer">';
      h += '    <div class="p5-audit-who"><span class="p5-tag">'+esc(l.contentType)+'</span> <b>'+esc(l.customerName||'未关联客户')+'</b></div>';
      h += '    <div class="p5-audit-time">'+p5FmtTime(l.createdAt)+'</div>';
      h += '    <span class="p5-a-badge" style="background:'+am.color+'">'+am.icon+' '+am.t+'</span>';
      h += '  </div>';
      h += '  <div class="p5-audit-summary">'+esc(l.aiOutput||'（无内容摘要）')+'</div>';
      h += '</div>';
    });
    h += '</div>';
    root.innerHTML = h;
  };

  window.p5SetAuditFilter = function(which, val){
    if(which==='type') window._p5AuditType = val;
    else window._p5AuditAction = val;
    renderView();
  };

  // ── Audit detail modal (AI vs human comparison + actions) ──
  window.p5AuditDetail = function(id){
    var l = (S.p5AuditLogs||[]).find(function(x){ return x.id===id; });
    if(!l) return;
    var am = P5_ACTION_META[l.humanAction] || P5_ACTION_META.pending;

    var h = '';
    h += '<div class="modal-head"><h3>审计详情 · '+esc(l.contentType)+'</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body">';
    h += '<div class="p5-a-meta"><span class="p5-tag">'+esc(l.customerName||'未关联客户')+'</span> <span class="p5-a-badge" style="background:'+am.color+'">'+am.icon+' '+am.t+'</span> <span class="text-muted">模型：'+esc(l.model||'—')+'</span></div>';
    h += '<div class="p5-a-times">生成：'+p5FmtTime(l.createdAt)+' · 审核：'+p5FmtTime(l.reviewedAt)+(l.sentAt?' · 发送：'+p5FmtTime(l.sentAt):'')+'</div>';

    // AI output vs human edited comparison
    h += '<div class="p5-cmp">';
    h += '  <div class="p5-cmp-col"><div class="p5-cmp-title">🤖 AI 原始输出</div>';
    h += '    <pre class="p5-cmp-text">'+esc(l.aiFullContent||l.aiOutput||'—')+'</pre></div>';
    if(l.humanAction === 'modified'){
      h += '  <div class="p5-cmp-col"><div class="p5-cmp-title">✏️ 人工修改后</div>';
      h += '    <pre class="p5-cmp-text edited">'+esc(l.modifiedContent||'—')+'</pre></div>';
    }
    h += '</div>';

    if(l.changeSummary) h += '<div class="p5-a-note">📝 修改说明：'+esc(l.changeSummary)+'</div>';
    if(l.rejectedReason) h += '<div class="p5-a-note err">❌ 拒绝原因：'+esc(l.rejectedReason)+'</div>';

    // Pending records: show decision buttons
    if(l.humanAction === 'pending'){
      h += '<div class="p5-a-actions">';
      h += '  <button class="btn btn-primary btn-sm" onclick="p5AuditDecide(\''+l.id+'\',\'approved\')">✅ 直接通过</button>';
      h += '  <button class="btn btn-outline btn-sm" onclick="p5AuditModifyModal(\''+l.id+'\')">✏️ 修改后通过</button>';
      h += '  <button class="btn btn-outline btn-sm" style="color:#c53030" onclick="p5AuditRejectModal(\''+l.id+'\')">❌ 拒绝</button>';
      h += '</div>';
    } else {
      h += '<div class="p5-a-actions">';
      h += '  <button class="btn btn-outline btn-sm" onclick="p5AuditMarkSent(\''+l.id+'\')">'+(l.sentAt?'更新发送时间':'📤 标记已发送')+'</button>';
      h += '</div>';
    }
    h += '</div>';
    openModal(h, true);
  };

  window.p5AuditDecide = function(id, action){
    window.p5UpdateAudit(id, { humanAction: action });
    toast(action==='approved' ? '已标记为直接通过' : '操作完成');
    closeModal();
    renderView();
  };

  window.p5AuditMarkSent = function(id){
    window.p5UpdateAudit(id, { sentAt: p5NowISO() });
    toast('已记录发送时间');
    closeModal();
    renderView();
  };

  window.p5AuditModifyModal = function(id){
    var l = (S.p5AuditLogs||[]).find(function(x){ return x.id===id; });
    if(!l) return;
    var h = '';
    h += '<div class="modal-head"><h3>修改后通过</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body">';
    h += '<div class="p5-field"><label>修改后的内容</label>';
    h += '<textarea class="form-control" id="p5_amod" rows="8">'+esc(l.aiFullContent||l.aiOutput||'')+'</textarea></div>';
    h += '<div class="p5-field"><label>修改说明（简述改了什么，用于统计高频修改点）</label>';
    h += '<input class="form-control" id="p5_achg" placeholder="如：删除了未证实的MOQ声明 / 补充了客户公司名"></div>';
    h += '</div>';
    h += '<div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">取消</button>';
    h += '<button class="btn btn-primary" onclick="p5AuditModifySave(\''+id+'\')">保存并标记修改后通过</button></div>';
    openModal(h, true);
  };

  window.p5AuditModifySave = function(id){
    var content = document.getElementById('p5_amod').value;
    var summary = document.getElementById('p5_achg').value.trim();
    window.p5UpdateAudit(id, { humanAction:'modified', modifiedContent:content, changeSummary:summary });
    toast('已记录修改后通过');
    closeModal();
    renderView();
  };

  window.p5AuditRejectModal = function(id){
    var h = '';
    h += '<div class="modal-head"><h3>拒绝该AI输出</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body">';
    h += '<div class="p5-field"><label>拒绝原因（用于统计常见拒绝原因分布）</label>';
    h += '<input class="form-control" id="p5_arej" placeholder="如：内容空泛 / 含未证实数据 / 语气不当"></div>';
    h += '</div>';
    h += '<div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">取消</button>';
    h += '<button class="btn btn-primary" style="background:#c53030" onclick="p5AuditRejectSave(\''+id+'\')">确认拒绝</button></div>';
    openModal(h, false);
  };

  window.p5AuditRejectSave = function(id){
    var reason = document.getElementById('p5_arej').value.trim();
    window.p5UpdateAudit(id, { humanAction:'rejected', rejectedReason: reason || '未填写原因' });
    toast('已拒绝该AI输出');
    closeModal();
    renderView();
  };

  // Manual entry form (when polling misses an AI output).
  window.p5AuditManualModal = function(){
    var h = '';
    h += '<div class="modal-head"><h3>手动记录AI输出</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body">';
    h += '<div class="p5-row">';
    h += '  <div class="p5-field"><label>内容类型</label>';
    h += '  <select class="form-control" id="p5_mtype"><option>开发信</option><option>AI回复</option><option>唤醒话术</option></select></div>';
    h += '  <div class="p5-field"><label>客户名称（可选）</label>';
    h += '  <input class="form-control" id="p5_mcust" placeholder="客户公司名"></div>';
    h += '</div>';
    h += '<div class="p5-field"><label>AI生成内容</label>';
    h += '<textarea class="form-control" id="p5_mcontent" rows="6" placeholder="粘贴AI生成的开发信/回复全文"></textarea></div>';
    h += '<div class="p5-field"><label>使用模型（可选）</label>';
    h += '<input class="form-control" id="p5_mmodel" placeholder="如：GPT-4o / Claude"></div>';
    h += '</div>';
    h += '<div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">取消</button>';
    h += '<button class="btn btn-primary" onclick="p5AuditManualSave()">保存记录</button></div>';
    openModal(h, true);
  };

  window.p5AuditManualSave = function(){
    var type = document.getElementById('p5_mtype').value;
    var cust = document.getElementById('p5_mcust').value.trim();
    var content = document.getElementById('p5_mcontent').value.trim();
    var model = document.getElementById('p5_mmodel').value.trim();
    if(content.length < 5){ toast('请填写AI生成内容','err'); return; }
    window.p5LogAudit({
      contentType: type,
      customerName: cust,
      aiOutput: content.slice(0,200),
      aiFullContent: content.slice(0,4000),
      model: model || '手动录入'
    });
    toast('已记录到审计日志');
    closeModal();
    renderView();
  };

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'aiSuggestions'){
      window.viewAiSuggestions(document.getElementById('mainContent'));
      return;
    }
    if(currentView === 'aiAudit'){
      window.viewAiAudit(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (p5- prefixed, responsive) ─────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p5-empty{padding:40px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.p5-meta-bar{background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;font-size:12.5px;color:#4a5568;margin-bottom:16px;}'
    // suggestions
    + '.p5-sug-list{display:flex;flex-direction:column;gap:12px;}'
    + '.p5-sug-card{display:flex;align-items:flex-start;gap:14px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;border-left:4px solid #a0aec0;}'
    + '.p5-sug-card.high{border-left-color:#c53030;}'
    + '.p5-sug-card.medium{border-left-color:#d69e2e;}'
    + '.p5-sug-card.low{border-left-color:#38a169;}'
    + '.p5-sug-icon{font-size:26px;line-height:1;}'
    + '.p5-sug-body{flex:1;min-width:0;}'
    + '.p5-sug-title{font-weight:700;font-size:14px;color:#2d3748;margin-bottom:4px;}'
    + '.p5-sug-detail{font-size:12.5px;color:#4a5568;line-height:1.5;}'
    + '.p5-sug-cust{font-size:12px;color:#2b6cb0;margin-top:4px;font-weight:600;}'
    + '.p5-sug-actions{display:flex;flex-direction:column;gap:6px;flex-shrink:0;}'
    + '.p5-prio-tag{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;vertical-align:middle;}'
    + '.p5-prio-tag.high{background:#fff5f5;color:#c53030;}'
    + '.p5-prio-tag.medium{background:#fffaf0;color:#c05621;}'
    + '.p5-prio-tag.low{background:#f0fff4;color:#2f855a;}'
    // audit
    + '.p5-audit-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}'
    + '.p5-a-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.p5-a-num{font-size:24px;font-weight:800;color:#2d3748;}'
    + '.p5-a-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    + '.p5-audit-filter{display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:13px;flex-wrap:wrap;}'
    + '.p5-audit-filter .form-control{width:auto;}'
    + '.p5-audit-list{display:flex;flex-direction:column;gap:10px;}'
    + '.p5-audit-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;}'
    + '.p5-audit-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;}'
    + '.p5-audit-who{font-weight:600;font-size:13.5px;display:flex;align-items:center;gap:6px;}'
    + '.p5-audit-time{font-size:12px;color:#a0aec0;margin-left:auto;}'
    + '.p5-a-badge{font-size:11px;color:#fff;padding:2px 8px;border-radius:10px;font-weight:600;}'
    + '.p5-audit-summary{font-size:12.5px;color:#4a5568;background:#f7fafc;border-radius:8px;padding:8px 10px;white-space:pre-wrap;}'
    + '.p5-tag{font-size:11px;padding:2px 8px;border-radius:10px;background:#edf2f7;color:#4a5568;}'
    + '.p5-a-meta{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;}'
    + '.p5-a-times{font-size:12px;color:#718096;margin-bottom:12px;}'
    + '.p5-cmp{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}'
    + '.p5-cmp-title{font-size:12px;font-weight:700;color:#4a5568;margin-bottom:6px;}'
    + '.p5-cmp-text{background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:12px;white-space:pre-wrap;max-height:260px;overflow:auto;font-family:inherit;margin:0;}'
    + '.p5-cmp-text.edited{background:#f0fff4;border-color:#c6f6d5;}'
    + '.p5-a-note{font-size:12.5px;background:#fffaf0;border:1px solid #feebc8;border-radius:8px;padding:8px 12px;margin-bottom:10px;color:#975a16;}'
    + '.p5-a-note.err{background:#fff5f5;border-color:#feb2b2;color:#c53030;}'
    + '.p5-a-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}'
    + '.p5-field{margin-bottom:12px;}'
    + '.p5-field label{display:block;font-size:12px;color:#4a5568;margin-bottom:4px;font-weight:600;}'
    + '.p5-row{display:flex;gap:16px;}'
    + '.p5-row>.p5-field{flex:1;}'
    + '@media (max-width:768px){'
    + '  .p5-audit-stats{grid-template-columns:repeat(2,1fr);}'
    + '  .p5-cmp{grid-template-columns:1fr;}'
    + '  .p5-sug-card{flex-direction:column;}'
    + '  .p5-sug-actions{flex-direction:row;width:100%;}'
    + '  .p5-row{flex-direction:column;gap:0;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
