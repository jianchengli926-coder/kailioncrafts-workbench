/* ============================================================
 * P4 Phase4: WhatsApp Outreach Management (基础版)
 * ----------------------------------------------------------------
 * - Pure frontend module, loaded AFTER app.js.
 * - Manages WhatsApp accounts, reusable message templates, a daily
 *   manual outreach task list and send records.
 * - HARD RULE: this module NEVER sends any WhatsApp message.
 *   It only PREPARES message text and tasks. The user must manually
 *   copy the text and paste it inside the WhatsApp app / WhatsApp Web.
 * - NO WhatsApp Business API, NO paid gateway, NO external dependency.
 * - All new CSS classes use the p4- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init (persist keys already registered in app.js) ──
  if(!Array.isArray(S.whatsappAccounts)) S.whatsappAccounts = [];
  if(!Array.isArray(S.whatsappTemplates)) S.whatsappTemplates = [];
  if(!Array.isArray(S.whatsappTasks)) S.whatsappTasks = [];
  if(!Array.isArray(S.whatsappRecords)) S.whatsappRecords = [];

  // Category dictionary mirrors the global P2 category dictionary.
  var P4_CATS = [
    {id:'outdoor_knives',        label:'户外刀',   en:'outdoor knives'},
    {id:'kitchen_knives',        label:'厨房刀',   en:'kitchen knives'},
    {id:'professional_scissors', label:'剪刀',     en:'professional scissors'},
    {id:'kitchen_accessories',   label:'厨房用品', en:'kitchen tools'}
  ];
  // Only these customer statuses are eligible for a new WA outreach task.
  var P4_ELIGIBLE_STATUS = ['待联系', '跟进中'];
  // Max tasks generated per day, max messages per account per day (default).
  var P4_DAILY_MAX_TASKS = 15;
  var P4_DEFAULT_ACC_LIMIT = 20;

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({key:'whatsappManage', icon:'💬', label:'WhatsApp', title:'WhatsApp触达管理', crumb:'账户管理 · 消息模板 · 手动发送任务'});

  // ── Local helpers ──────────────────────────────────────────
  function p4NowISO(){ return new Date().toISOString(); }

  function p4TodayStr(){
    // Reuse the global P2 helper when available, otherwise compute locally.
    if(typeof p2TodayStr === 'function') return p2TodayStr();
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p4FmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p4FmtTime(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return p4FmtDate(iso)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  function p4CatLabel(catId){
    for(var i=0;i<P4_CATS.length;i++) if(P4_CATS[i].id===catId) return P4_CATS[i].label;
    return catId==='all' ? '全部品类' : (catId || '全部');
  }
  function p4CatEn(catId){
    for(var i=0;i<P4_CATS.length;i++) if(P4_CATS[i].id===catId) return P4_CATS[i].en;
    return 'our products';
  }

  // Normalize a raw phone string to pure digits for wa.me links.
  // Keeps an optional leading '+' stripped, removes spaces, dashes,
  // parentheses and any other non-digit characters.
  function p4NormalizeWa(raw){
    if(!raw) return '';
    return String(raw).replace(/[^\d]/g, '');
  }

  // Resolve a customer's WhatsApp number: prefer contact.whatsapp,
  // fall back to contact.phone, then a top-level whatsapp field.
  // Returns {raw:'+86138...', norm:'86138...'}
  function p4CustomerWa(c){
    if(!c) return {raw:'', norm:''};
    var raw = (c.contact && (c.contact.whatsapp || c.contact.phone)) || c.whatsapp || '';
    return { raw: String(raw||'').trim(), norm: p4NormalizeWa(raw) };
  }

  function p4FindAccount(id){
    for(var i=0;i<S.whatsappAccounts.length;i++) if(S.whatsappAccounts[i].id===id) return S.whatsappAccounts[i];
    return null;
  }
  function p4FindTemplate(id){
    for(var i=0;i<S.whatsappTemplates.length;i++) if(S.whatsappTemplates[i].id===id) return S.whatsappTemplates[i];
    return null;
  }
  function p4FindTask(id){
    for(var i=0;i<S.whatsappTasks.length;i++) if(S.whatsappTasks[i].id===id) return S.whatsappTasks[i];
    return null;
  }
  function p4FindCustomer(id){
    return (S.customers||[]).find(function(x){return x.id===id;}) || null;
  }

  // Reset each account's daily counter when the calendar day changes.
  function p4ResetDailyCounters(){
    var today = p4TodayStr();
    var changed = false;
    (S.whatsappAccounts||[]).forEach(function(a){
      if(a.dailySentDate !== today){
        a.dailySentCount = 0;
        a.dailySentDate = today;
        changed = true;
      }
    });
    if(changed) persist();
  }

  // ── Seed the 4 built-in templates on first run ─────────────
  function p4SeedTemplates(){
    if(S.whatsappTemplates.length) return;
    var now = p4NowISO();
    S.whatsappTemplates = [
      { id: uid(), name:'Initial Outreach', category:'all',
        content:"Hi {name}, this is Leo from KaiLionCrafts. We specialize in {product} OEM/ODM from Yangjiang. May I share our catalog?",
        useCount:0, builtin:true, createdAt:now },
      { id: uid(), name:'Follow-up', category:'all',
        content:"Hi {name}, just checking if you received my previous message about {product}. Any interest?",
        useCount:0, builtin:true, createdAt:now },
      { id: uid(), name:'Catalog Share', category:'all',
        content:"Hi {name}, here is our latest {product} catalog: [link]. MOQ from 100pcs, OEM supported.",
        useCount:0, builtin:true, createdAt:now },
      { id: uid(), name:'Holiday Greeting', category:'all',
        content:"Hi {name}, Merry Christmas! Wishing you a wonderful holiday season. - Leo from KaiLionCrafts",
        useCount:0, builtin:true, createdAt:now }
    ];
  }

  // ── Template variable substitution ─────────────────────────
  // Supported variables: {name}, {company}, {product}, {category}
  function p4FillMessage(tpl, c){
    var cat = normalizeCatId(c.productCategory);
    var prod = p4CatEn(cat);
    var contactName = (c.contact && c.contact.name) ? c.contact.name : (c.company || 'there');
    var s = tpl.content || '';
    s = s.split('{name}').join(contactName);
    s = s.split('{company}').join(c.company || 'your company');
    s = s.split('{product}').join(prod);
    s = s.split('{category}').join(prod);
    return s;
  }

  // Pick the best template for a customer: category match first,
  // then 'all'; prefer follow-up wording if the customer was already
  // contacted on WhatsApp before.
  function p4PickTemplate(customer, hasPriorRecord){
    var cat = normalizeCatId(customer.productCategory);
    var best = null, bestScore = -1;
    (S.whatsappTemplates||[]).forEach(function(t){
      var score = 0;
      if(t.category === cat) score += 2;
      if(t.category === 'all') score += 1;
      var n = (t.name||'').toLowerCase();
      if(hasPriorRecord && /follow/i.test(n)) score += 1;
      if(!hasPriorRecord && /initial|outreach/i.test(n)) score += 1;
      if(score > bestScore){ bestScore = score; best = t; }
    });
    return best || S.whatsappTemplates[0] || null;
  }

  // Round-robin assign an active account that still has daily quota.
  function p4AssignAccount(idx){
    var avail = (S.whatsappAccounts||[]).filter(function(a){
      return a.status === 'active' && (a.dailySentCount||0) < (a.dailyLimit||P4_DEFAULT_ACC_LIMIT);
    });
    if(!avail.length) return null;
    avail.sort(function(a,b){ return (a.dailySentCount||0) - (b.dailySentCount||0); });
    return avail[idx % avail.length];
  }

  function p4HasWaRecord(customerId){
    return (S.whatsappRecords||[]).some(function(r){ return r.customerId === customerId; });
  }

  // ── Generate today's tasks (no sending, ever) ──────────────
  window.p4GenerateTasks = function(){
    p4ResetDailyCounters();
    var today = p4TodayStr();

    // Same-day guard: do not regenerate tasks that already exist.
    var existing = (S.whatsappTasks||[]).filter(function(t){ return t.date === today; });
    if(existing.length){
      toast('今日任务已生成（'+existing.length+' 条），请直接处理');
      return;
    }

    // Eligible customers: has a usable WhatsApp number, status in the
    // outreach bucket, not blacklisted / unsubscribed.
    var eligible = (S.customers||[]).filter(function(c){
      var wa = p4CustomerWa(c);
      if(!wa.norm) return false;
      if(c.blacklisted || c.unsubscribe) return false;
      if(P4_ELIGIBLE_STATUS.indexOf(c.status) === -1) return false;
      return true;
    });

    // Group by category for balanced distribution.
    var byCat = { outdoor_knives:[], kitchen_knives:[], professional_scissors:[], kitchen_accessories:[] };
    eligible.forEach(function(c){
      var cat = normalizeCatId(c.productCategory);
      if(byCat[cat]) byCat[cat].push(c);
    });
    // Sort each group by lead score (higher first).
    Object.keys(byCat).forEach(function(cat){
      byCat[cat].sort(function(a,b){
        var sa = a.leadScore || (a.scores && a.scores.total) || 0;
        var sb = b.leadScore || (b.scores && b.scores.total) || 0;
        return sb - sa;
      });
    });

    var tasks = [];
    var catOrder = ['outdoor_knives','kitchen_knives','professional_scissors','kitchen_accessories'];
    var catIdx = 0, safety = 0;
    while(tasks.length < P4_DAILY_MAX_TASKS && safety < 400){
      safety++;
      var cat = catOrder[catIdx % 4];
      catIdx++;
      var picked = byCat[cat].splice(0,1)[0];
      if(!picked) continue;

      var wa = p4CustomerWa(picked);
      var tpl = p4PickTemplate(picked, p4HasWaRecord(picked.id));
      if(!tpl) continue; // no template configured -> skip rather than crash
      var account = p4AssignAccount(tasks.length);
      tasks.push({
        id: uid(),
        date: today,
        customerId: picked.id,
        customerName: picked.company || (picked.contact && picked.contact.name) || '未知客户',
        phone: wa.norm,
        country: picked.country || '',
        category: cat,
        templateId: tpl.id,
        templateName: tpl.name,
        message: p4FillMessage(tpl, picked),
        assignedAccountId: account ? account.id : null,
        assignedAccountPhone: account ? account.phone : null,
        status: 'pending',   // pending | sent
        sentAt: null,
        replied: false
      });
    }

    S.whatsappTasks = (S.whatsappTasks||[]).concat(tasks);
    persist();
    if(!tasks.length){
      toast('没有符合条件的客户（需要WhatsApp号码 + 状态为待联系/跟进中）','err');
    }else{
      toast('已生成今日 '+tasks.length+' 条手动任务，请逐条复制消息后在WhatsApp发送');
    }
    renderView();
  };

  // ── Action: copy prepared message to clipboard ─────────────
  window.p4CopyMessage = function(taskId){
    var t = p4FindTask(taskId);
    if(!t) return;
    var done = function(){ toast('消息已复制，请在WhatsApp中粘贴发送'); };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(t.message).then(done).catch(function(){ p4FallbackCopy(t.message, done); });
    }else{
      p4FallbackCopy(t.message, done);
    }
  };
  function p4FallbackCopy(text, cb){
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); if(cb) cb(); }catch(e){ toast('复制失败，请手动长按选择','err'); }
    document.body.removeChild(ta);
  }

  // ── Action: open wa.me chat (user sends MANUALLY — no auto send) ──
  window.p4OpenWa = function(phone){
    var norm = p4NormalizeWa(phone);
    if(!norm){ toast('号码无效','err'); return; }
    // Plain wa.me link: opens an empty chat window. The user pastes the
    // copied text themselves. We NEVER prefill or auto-send.
    window.open('https://wa.me/'+norm, '_blank');
  };

  // ── Action: mark a task as manually sent ────────────────────
  window.p4MarkSent = function(taskId){
    var t = p4FindTask(taskId);
    if(!t) return;
    if(t.status === 'sent'){ toast('该任务已标记为已发送'); return; }
    confirmDlg('确认你已在WhatsApp中手动发送给「'+esc(t.customerName)+'」吗？', function(){
      t.status = 'sent';
      t.sentAt = p4NowISO();
      S.whatsappRecords.push({
        id: uid(),
        customerId: t.customerId,
        customerName: t.customerName,
        phone: t.phone,
        accountId: t.assignedAccountId,
        message: t.message,
        templateId: t.templateId,
        status: 'sent',
        sentAt: t.sentAt,
        replied: false,
        repliedAt: null
      });
      var acc = t.assignedAccountId ? p4FindAccount(t.assignedAccountId) : null;
      if(acc) acc.dailySentCount = (acc.dailySentCount||0) + 1;
      var tpl = t.templateId ? p4FindTemplate(t.templateId) : null;
      if(tpl) tpl.useCount = (tpl.useCount||0) + 1;
      persist();
      toast('已标记发送，记录已归档，账户发送量 +1');
      renderView();
    });
  };

  // ── Action: mark a send record as replied ──────────────────
  window.p4MarkReplied = function(recId){
    var r = (S.whatsappRecords||[]).find(function(x){ return x.id === recId; });
    if(!r) return;
    if(r.replied){ toast('该记录已标记为回复'); return; }
    r.replied = true;
    r.repliedAt = p4NowISO();
    var c = p4FindCustomer(r.customerId);
    if(c) c.status = '已回复';
    // Sync the related task as well so the task list stays consistent.
    (S.whatsappTasks||[]).forEach(function(t){
      if(t.customerId === r.customerId && t.status === 'sent') t.replied = true;
    });
    persist();
    toast('已标记回复，客户状态已更新为「已回复」');
    renderView();
  };

  // ═══════════════════════════════════════════════════════════
  //  MAIN VIEW
  // ═══════════════════════════════════════════════════════════
  window.viewWhatsappManage = function(root){
    p4ResetDailyCounters();
    p4SeedTemplates();
    var tab = window._p4Tab || 'tasks';

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">💬 WhatsApp 触达管理</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">手动触达工作台 · 生成消息任务 → 复制文本 → 在WhatsApp人工发送（本系统不自动发送）</div></div>';
    h += '  <button class="btn btn-primary" onclick="p4GenerateTasks()">⚡ 生成今日发送任务</button>';
    h += '</div>';

    // ── Stats strip ──
    h += p4StatsStrip();

    // ── Tabs ──
    h += '<div class="p4-tabs">';
    h += p4TabBtn('tasks',    '📋 任务清单（'+p4TodayPendingCount()+'）', tab);
    h += p4TabBtn('accounts', '📱 账户（'+S.whatsappAccounts.length+'）', tab);
    h += p4TabBtn('templates','✍️ 模板（'+S.whatsappTemplates.length+'）', tab);
    h += p4TabBtn('contacts', '👥 客户号码', tab);
    h += p4TabBtn('records',  '🗂 发送记录', tab);
    h += '</div>';

    if(tab === 'accounts')   h += p4RenderAccounts();
    else if(tab === 'templates') h += p4RenderTemplates();
    else if(tab === 'contacts') h += p4RenderContacts();
    else if(tab === 'records')  h += p4RenderRecords();
    else                          h += p4RenderTasks();

    root.innerHTML = h;
  };

  window.p4SetTab = function(t){ window._p4Tab = t; renderView(); };

  function p4TabBtn(key, label, cur){
    return '<div class="p4-tab'+(cur===key?' on':'')+'" onclick="p4SetTab(\''+key+'\')">'+label+'</div>';
  }

  function p4TodayPendingCount(){
    var today = p4TodayStr();
    return (S.whatsappTasks||[]).filter(function(t){ return t.date===today && t.status==='pending'; }).length;
  }

  function p4StatsStrip(){
    var today = p4TodayStr();
    var nowTs = Date.now();
    var weekMs = 7*24*3600*1000;
    var recs = S.whatsappRecords||[];
    var sentToday = recs.filter(function(r){ return p4FmtDate(r.sentAt) === today; }).length;
    var sentWeek  = recs.filter(function(r){ return r.sentAt && (nowTs - new Date(r.sentAt).getTime()) <= weekMs; }).length;
    var sentTotal = recs.length;
    var replied   = recs.filter(function(r){ return r.replied; }).length;
    return '<div class="p4-stats">'
      + '<div class="p4-stat"><div class="p4-stat-num">'+sentToday+'</div><div class="p4-stat-lbl">今日发送</div></div>'
      + '<div class="p4-stat"><div class="p4-stat-num">'+sentWeek+'</div><div class="p4-stat-lbl">近7天发送</div></div>'
      + '<div class="p4-stat"><div class="p4-stat-num">'+sentTotal+'</div><div class="p4-stat-lbl">累计发送</div></div>'
      + '<div class="p4-stat"><div class="p4-stat-num" style="color:#25D366">'+replied+'</div><div class="p4-stat-lbl">客户回复</div></div>'
      + '</div>';
  }

  // ── Tab: Tasks ─────────────────────────────────────────────
  function p4RenderTasks(){
    var today = p4TodayStr();
    var tasks = (S.whatsappTasks||[]).filter(function(t){ return t.date === today; })
      .sort(function(a,b){ return a.status === b.status ? 0 : (a.status==='pending' ? -1 : 1); });

    var h = '';
    if(!tasks.length){
      h += '<div class="p4-empty">今日还没有发送任务。点击右上角「⚡ 生成今日发送任务」，系统会从客户台账中挑选有WhatsApp号码的待联系/跟进中客户，按品类均衡生成最多 15 条手动任务。</div>';
      return h;
    }
    var pending = tasks.filter(function(t){return t.status==='pending';}).length;
    h += '<div class="p4-progress">今日任务 <b>'+tasks.length+'</b> 条 · 待发送 <b style="color:#d69e2e">'+pending+'</b> · 已发送 <b style="color:#38a169">'+(tasks.length-pending)+'</b></div>';
    h += '<div class="p4-task-list">';
    tasks.forEach(function(t){
      h += '<div class="p4-task-card'+(t.status==='sent'?' sent':'')+'">';
      h += '  <div class="p4-task-head">';
      h += '    <div class="p4-task-who">'+esc(t.customerName)+' <small>'+esc(t.country||'')+'</small></div>';
      h += '    <div class="p4-task-tags">';
      h += '      <span class="p4-tag">'+p4CatLabel(t.category)+'</span>';
      h += '      <span class="p4-tag blue">'+esc(t.templateName||'')+'</span>';
      if(t.assignedAccountPhone) h += '<span class="p4-tag gray">发件号：'+esc(t.assignedAccountPhone)+'</span>';
      else h += '<span class="p4-tag warn">⚠️ 未分配账户</span>';
      h += '    </div>';
      h += '  </div>';
      h += '  <div class="p4-task-msg">'+esc(t.message)+'</div>';
      h += '  <div class="p4-task-actions">';
      h += '    <span class="p4-phone">📱 +'+esc(t.phone)+'</span>';
      if(t.status === 'pending'){
        h += '    <button class="btn btn-outline btn-sm" onclick="p4CopyMessage(\''+t.id+'\')">📋 复制消息</button>';
        h += '    <button class="btn btn-outline btn-sm" onclick="p4OpenWa(\''+t.phone+'\')">💬 打开WhatsApp</button>';
        h += '    <button class="btn btn-primary btn-sm" onclick="p4MarkSent(\''+t.id+'\')">✅ 标记已发送</button>';
      }else{
        h += '    <span class="p4-sent-badge">✅ 已于 '+p4FmtTime(t.sentAt)+' 发送</span>';
        if(t.replied) h += '<span class="p4-replied-badge">💚 客户已回复</span>';
      }
      h += '  </div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  // ── Tab: Accounts ───────────────────────────────────────────
  function p4AccountStatusBadge(st){
    var map = { active:{t:'正常',c:'#38a169'}, pending:{t:'待验证',c:'#d69e2e'}, disabled:{t:'已停用',c:'#a0aec0'} };
    var m = map[st] || {t:st||'?', c:'#999'};
    return '<span class="p4-badge" style="background:'+m.c+'">'+m.t+'</span>';
  }

  function p4RenderAccounts(){
    var accs = S.whatsappAccounts||[];
    var h = '';
    h += '<div class="flex-between mb16"><div class="text-sm text-muted">每个号码每日发送上限默认 '+P4_DEFAULT_ACC_LIMIT+' 条（防风控），可按需调整。仅「正常」状态账户会被自动分配任务。</div>';
    h += '<button class="btn btn-primary" onclick="p4AccountModal()">➕ 添加账户</button></div>';
    if(!accs.length){
      h += '<div class="p4-empty">还没有WhatsApp账户。点击「添加账户」录入你的WhatsApp手机号（带国家码，例如 +86138xxxx）。</div>';
      return h;
    }
    h += '<div class="p4-acc-list">';
    accs.forEach(function(a){
      var limit = a.dailyLimit || P4_DEFAULT_ACC_LIMIT;
      var used = a.dailySentCount||0;
      h += '<div class="p4-acc-card">';
      h += '  <div class="p4-acc-main">';
      h += '    <div class="p4-acc-phone">📱 '+esc(a.phone)+' '+p4AccountStatusBadge(a.status)+'</div>';
      h += '    <div class="p4-acc-meta">'+(esc(a.note||'')||'<span class="text-muted">无备注</span>')+' · 添加于 '+p4FmtDate(a.createdAt)+'</div>';
      h += '  </div>';
      h += '  <div class="p4-acc-quota">';
      h += '    <div class="p4-quota-bar"><div class="p4-quota-fill" style="width:'+Math.min(100,Math.round(used/limit*100))+'%"></div></div>';
      h += '    <div class="p4-quota-num">今日 '+used+' / '+limit+' 条</div>';
      h += '  </div>';
      h += '  <div class="p4-acc-op">';
      h += '    <button class="btn btn-outline btn-sm" onclick="p4AccountModal(\''+a.id+'\')">编辑</button>';
      h += '    <button class="btn btn-outline btn-sm" style="color:#e53e3e" onclick="p4DeleteAccount(\''+a.id+'\')">删除</button>';
      h += '  </div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  window.p4AccountModal = function(id){
    var a = id ? p4FindAccount(id) : null;
    var h = '';
    h += '<div class="modal-head"><h3>'+(a?'编辑':'添加')+'WhatsApp账户</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body">';
    h += '<div class="p4-field"><label>手机号（带国家码，如 +8613800000000）</label>';
    h += '<input class="form-control" id="p4f_aphone" value="'+(a?esc(a.phone):'')+'" placeholder="+86138..."></div>';
    h += '<div class="p4-field"><label>备注 / 标签</label>';
    h += '<input class="form-control" id="p4f_anote" value="'+(a?esc(a.note):'')+'" placeholder="如：主号 / 备用号 / 欧洲客户专用"></div>';
    h += '<div class="p4-row">';
    h += '  <div class="p4-field"><label>状态</label>';
    h += '  <select class="form-control" id="p4f_astatus">';
    h += '  <option value="active"'+(a&&a.status==='active'?' selected':'')+'>正常</option>';
    h += '  <option value="pending"'+(a&&a.status==='pending'?' selected':'')+'>待验证</option>';
    h += '  <option value="disabled"'+(a&&a.status==='disabled'?' selected':'')+'>已停用</option>';
    h += '  </select></div>';
    h += '  <div class="p4-field"><label>每日发送上限（条）</label>';
    h += '  <input class="form-control" type="number" id="p4f_alimit" min="1" max="200" value="'+(a?(a.dailyLimit||P4_DEFAULT_ACC_LIMIT):P4_DEFAULT_ACC_LIMIT)+'"></div>';
    h += '</div>';
    h += '<div class="text-sm text-muted">⚠️ 本系统仅记录账户信息与手动发送统计，不通过任何API自动发送消息。</div>';
    h += '</div>';
    h += '<div class="modal-foot">';
    h += '<button class="btn btn-outline" onclick="closeModal()">取消</button>';
    h += '<button class="btn btn-primary" onclick="p4SaveAccount(\''+(a?a.id:'')+'\')">保存</button>';
    h += '</div>';
    openModal(h, true);
  };

  window.p4SaveAccount = function(id){
    var phone = document.getElementById('p4f_aphone').value.trim();
    var note  = document.getElementById('p4f_anote').value.trim();
    var status = document.getElementById('p4f_astatus').value;
    var limit = parseInt(document.getElementById('p4f_alimit').value, 10) || P4_DEFAULT_ACC_LIMIT;

    var digits = p4NormalizeWa(phone);
    if(digits.length < 8){ toast('请输入有效手机号（至少8位数字，带国家码）','err'); return; }
    if(limit < 1){ limit = 1; }

    if(id){
      var a = p4FindAccount(id);
      if(a){ a.phone = phone; a.note = note; a.status = status; a.dailyLimit = limit; }
    }else{
      S.whatsappAccounts.push({
        id: uid(), phone: phone, note: note, status: status,
        dailyLimit: limit, dailySentCount: 0, dailySentDate: p4TodayStr(),
        createdAt: p4NowISO()
      });
    }
    persist(); closeModal();
    toast('账户已保存');
    renderView();
  };

  window.p4DeleteAccount = function(id){
    var a = p4FindAccount(id);
    if(!a) return;
    confirmDlg('确定删除账户「'+esc(a.phone)+'」吗？历史发送记录会保留。', function(){
      S.whatsappAccounts = S.whatsappAccounts.filter(function(x){ return x.id !== id; });
      persist(); toast('账户已删除'); renderView();
    });
  };

  // ── Tab: Templates ──────────────────────────────────────────
  function p4RenderTemplates(){
    var list = S.whatsappTemplates||[];
    var h = '';
    h += '<div class="flex-between mb16"><div class="text-sm text-muted">支持变量：{name} 客户称呼 · {company} 公司名 · {product} 品类英文 · {category} 品类英文。</div>';
    h += '<button class="btn btn-primary" onclick="p4TemplateModal()">➕ 新增模板</button></div>';
    if(!list.length){ h += '<div class="p4-empty">还没有模板。</div>'; return h; }
    h += '<div class="p4-tpl-grid">';
    list.forEach(function(t){
      h += '<div class="p4-tpl-card">';
      h += '  <div class="p4-tpl-name">'+esc(t.name)+' <span class="p4-tag blue">'+p4CatLabel(t.category)+'</span></div>';
      h += '  <div class="p4-tpl-body">'+esc(t.content)+'</div>';
      h += '  <div class="p4-tpl-foot">使用 <b>'+(t.useCount||0)+'</b> 次';
      h += '    <button class="btn btn-outline btn-sm" onclick="p4TemplateModal(\''+t.id+'\')">编辑</button>';
      h += '    <button class="btn btn-outline btn-sm" style="color:#e53e3e" onclick="p4DeleteTemplate(\''+t.id+'\')">删除</button>';
      h += '  </div></div>';
    });
    h += '</div>';
    return h;
  }

  window.p4TemplateModal = function(id){
    var t = id ? p4FindTemplate(id) : null;
    var h = '';
    h += '<div class="modal-head"><h3>'+(t?'编辑':'新增')+'消息模板</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body">';
    h += '<div class="p4-row">';
    h += '  <div class="p4-field"><label>模板名称</label>';
    h += '  <input class="form-control" id="p4f_tname" value="'+(t?esc(t.name):'')+'" placeholder="如：Initial Outreach"></div>';
    h += '  <div class="p4-field"><label>适用品类</label>';
    h += '  <select class="form-control" id="p4f_tcat">';
    h += '  <option value="all"'+(t&&t.category==='all'?' selected':'')+'>全部品类</option>';
    P4_CATS.forEach(function(c){ h += '<option value="'+c.id+'"'+(t&&t.category===c.id?' selected':'')+'>'+c.label+'</option>'; });
    h += '  </select></div></div>';
    h += '<div class="p4-field"><label>消息内容（支持 {name} {company} {product} {category} 变量）</label>';
    h += '<textarea class="form-control" id="p4f_tcontent" rows="5" placeholder="Hi {name}, ...">'+(t?esc(t.content):'')+'</textarea></div>';
    h += '</div>';
    h += '<div class="modal-foot">';
    h += '<button class="btn btn-outline" onclick="closeModal()">取消</button>';
    h += '<button class="btn btn-primary" onclick="p4SaveTemplate(\''+(t?t.id:'')+'\')">保存</button>';
    h += '</div>';
    openModal(h, true);
  };

  window.p4SaveTemplate = function(id){
    var name = document.getElementById('p4f_tname').value.trim();
    var cat  = document.getElementById('p4f_tcat').value;
    var content = document.getElementById('p4f_tcontent').value.trim();
    if(!name){ toast('请填写模板名称','err'); return; }
    if(!content){ toast('请填写消息内容','err'); return; }
    if(id){
      var t = p4FindTemplate(id);
      if(t){ t.name = name; t.category = cat; t.content = content; }
    }else{
      S.whatsappTemplates.push({ id:uid(), name:name, category:cat, content:content, useCount:0, createdAt:p4NowISO() });
    }
    persist(); closeModal(); toast('模板已保存'); renderView();
  };

  window.p4DeleteTemplate = function(id){
    var t = p4FindTemplate(id);
    if(!t) return;
    confirmDlg('确定删除模板「'+esc(t.name)+'」吗？', function(){
      S.whatsappTemplates = S.whatsappTemplates.filter(function(x){ return x.id !== id; });
      persist(); toast('模板已删除'); renderView();
    });
  };

  // ── Tab: Customer WhatsApp numbers ──────────────────────────
  function p4RenderContacts(){
    var list = (S.customers||[]).map(function(c){
      var wa = p4CustomerWa(c);
      return { c:c, wa:wa };
    }).filter(function(x){ return x.wa.norm; });

    var h = '';
    h += '<div class="flex-between mb16"><div class="text-sm text-muted">共 <b>'+list.length+'</b> 个客户存有WhatsApp号码（来源：客户台账 contact.whatsapp / contact.phone）。点击号码在新窗口打开wa.me（不自动发送）。</div>';
    h += '<button class="btn btn-outline" onclick="p4SyncContacts()">🔄 从客户台账同步</button></div>';
    if(!list.length){
      h += '<div class="p4-empty">客户台账中还没有WhatsApp号码。请先在客户详情中填写 contact.whatsapp（或 contact.phone），然后点「从客户台账同步」。</div>';
      return h;
    }
    h += '<table class="p4-table"><thead><tr><th>客户</th><th>国家</th><th>品类</th><th>状态</th><th>WhatsApp</th></tr></thead><tbody>';
    list.forEach(function(x){
      var c = x.c;
      h += '<tr>';
      h += '  <td>'+esc(c.company || (c.contact&&c.contact.name) || '未知')+'</td>';
      h += '  <td>'+esc(c.country||'—')+'</td>';
      h += '  <td>'+p4CatLabel(normalizeCatId(c.productCategory))+'</td>';
      h += '  <td>'+esc(c.status||'—')+'</td>';
      h += '  <td><a class="p4-wa-link" href="https://wa.me/'+x.wa.norm+'" target="_blank" rel="noopener">+'+esc(x.wa.norm)+'</a></td>';
      h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  // Sync: for customers who only have a phone, copy it into contact.whatsapp.
  window.p4SyncContacts = function(){
    var total = 0, filled = 0;
    (S.customers||[]).forEach(function(c){
      var wa = p4CustomerWa(c);
      if(!wa.norm) return;
      total++;
      if(!(c.contact && c.contact.whatsapp) && c.contact && c.contact.phone){
        c.contact.whatsapp = '+'+wa.norm;
        filled++;
      }
    });
    persist();
    toast('同步完成：'+total+' 个客户有号码，补全 '+filled+' 条WhatsApp字段');
    renderView();
  };

  // ── Tab: Send records / history ─────────────────────────────
  function p4RenderRecords(){
    var recs = (S.whatsappRecords||[]).slice().reverse(); // newest first
    var h = '';
    h += '<div class="p4-rec-filter"><label>按日期筛选：</label>';
    h += '<input type="date" class="form-control" id="p4_recdate" value="'+(window._p4RecDate||'')+'" onchange="p4SetRecDate(this.value)">';
    if(window._p4RecDate) h += ' <button class="btn btn-outline btn-sm" onclick="p4SetRecDate(\'\')">清除</button>';
    h += '</div>';
    if(window._p4RecDate){
      recs = recs.filter(function(r){ return p4FmtDate(r.sentAt) === window._p4RecDate; });
    }
    if(!recs.length){
      h += '<div class="p4-empty">该条件下暂无发送记录。生成今日任务并逐条「标记已发送」后，记录会自动归档在这里。</div>';
      return h;
    }
    h += '<div class="p4-rec-list">';
    recs.forEach(function(r){
      h += '<div class="p4-rec-card'+(r.replied?' replied':'')+'">';
      h += '  <div class="p4-rec-head">';
      h += '    <div class="p4-rec-who">'+esc(r.customerName)+' <small>+'+esc(r.phone)+'</small></div>';
      h += '    <div class="p4-rec-time">'+p4FmtTime(r.sentAt)+'</div>';
      h += '  </div>';
      h += '  <div class="p4-rec-msg">'+esc(r.message)+'</div>';
      h += '  <div class="p4-rec-foot">';
      if(r.replied){
        h += '<span class="p4-replied-badge">💚 已回复'+(r.repliedAt?' · '+p4FmtTime(r.repliedAt):'')+'</span>';
      }else{
        h += '<button class="btn btn-outline btn-sm" onclick="p4MarkReplied(\''+r.id+'\')">💚 客户已回复</button>';
      }
      h += '  </div></div>';
    });
    h += '</div>';
    return h;
  }

  window.p4SetRecDate = function(v){ window._p4RecDate = v; renderView(); };

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'whatsappManage'){
      window.viewWhatsappManage(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p4- prefixed, responsive) ─────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p4-empty{padding:40px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.p4-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}'
    + '.p4-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.p4-stat-num{font-size:26px;font-weight:700;color:#2d3748;}'
    + '.p4-stat-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    + '.p4-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}'
    + '.p4-tab{padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;color:#4a5568;}'
    + '.p4-tab.on{background:#25D366;color:#fff;border-color:#25D366;font-weight:600;}'
    + '.p4-progress{background:#f0fff4;border:1px solid #c6f6d5;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:12px;}'
    + '.p4-task-list{display:flex;flex-direction:column;gap:12px;}'
    + '.p4-task-card{background:#fff;border:1px solid #e2e8f0;border-left:4px solid #25D366;border-radius:10px;padding:14px 16px;}'
    + '.p4-task-card.sent{border-left-color:#cbd5e0;opacity:.85;}'
    + '.p4-task-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;}'
    + '.p4-task-who{font-weight:600;font-size:14px;}'
    + '.p4-task-who small{color:#a0aec0;font-weight:400;margin-left:6px;}'
    + '.p4-task-tags{display:flex;gap:6px;flex-wrap:wrap;}'
    + '.p4-tag{font-size:11px;padding:2px 8px;border-radius:10px;background:#edf2f7;color:#4a5568;}'
    + '.p4-tag.blue{background:#ebf8ff;color:#2b6cb0;}'
    + '.p4-tag.gray{background:#e2e8f0;color:#718096;}'
    + '.p4-tag.warn{background:#fffaf0;color:#c05621;}'
    + '.p4-task-msg{background:#f7fafc;border-radius:8px;padding:10px 12px;font-size:13px;white-space:pre-wrap;color:#2d3748;margin-bottom:10px;}'
    + '.p4-task-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.p4-phone{font-size:12px;color:#2b6cb0;font-weight:600;margin-right:auto;}'
    + '.p4-sent-badge{font-size:12px;color:#38a169;font-weight:600;}'
    + '.p4-replied-badge{font-size:12px;color:#25D366;font-weight:700;}'
    + '.p4-acc-list{display:flex;flex-direction:column;gap:10px;}'
    + '.p4-acc-card{display:flex;align-items:center;gap:16px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;}'
    + '.p4-acc-main{flex:1;min-width:180px;}'
    + '.p4-acc-phone{font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;}'
    + '.p4-acc-meta{font-size:12px;color:#718096;margin-top:3px;}'
    + '.p4-acc-quota{width:180px;}'
    + '.p4-quota-bar{background:#edf2f7;border-radius:6px;height:8px;overflow:hidden;}'
    + '.p4-quota-fill{height:100%;background:#25D366;}'
    + '.p4-quota-num{font-size:11px;color:#718096;margin-top:4px;text-align:right;}'
    + '.p4-acc-op{display:flex;gap:6px;}'
    + '.p4-badge{font-size:11px;color:#fff;padding:2px 8px;border-radius:10px;font-weight:500;}'
    + '.p4-tpl-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;}'
    + '.p4-tpl-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px;}'
    + '.p4-tpl-name{font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;}'
    + '.p4-tpl-body{font-size:12.5px;color:#4a5568;white-space:pre-wrap;background:#f7fafc;border-radius:8px;padding:10px;flex:1;}'
    + '.p4-tpl-foot{display:flex;align-items:center;gap:8px;font-size:12px;color:#718096;}'
    + '.p4-tpl-foot .btn{margin-left:auto;}'
    + '.p4-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;}'
    + '.p4-table th,.p4-table td{padding:8px 12px;border-bottom:1px solid #edf2f7;text-align:left;}'
    + '.p4-table th{background:#f7fafc;color:#4a5568;}'
    + '.p4-wa-link{color:#25D366;font-weight:600;text-decoration:none;}'
    + '.p4-wa-link:hover{text-decoration:underline;}'
    + '.p4-rec-filter{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:13px;}'
    + '.p4-rec-filter .form-control{width:auto;}'
    + '.p4-rec-list{display:flex;flex-direction:column;gap:10px;}'
    + '.p4-rec-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;}'
    + '.p4-rec-card.replied{border-left:4px solid #25D366;}'
    + '.p4-rec-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}'
    + '.p4-rec-who{font-weight:600;font-size:13px;}'
    + '.p4-rec-who small{color:#a0aec0;font-weight:400;margin-left:6px;}'
    + '.p4-rec-time{font-size:12px;color:#a0aec0;}'
    + '.p4-rec-msg{font-size:12.5px;color:#4a5568;white-space:pre-wrap;background:#f7fafc;border-radius:8px;padding:8px 10px;margin-bottom:8px;}'
    + '.p4-rec-foot{display:flex;align-items:center;}'
    + '.p4-field{margin-bottom:12px;}'
    + '.p4-field label{display:block;font-size:12px;color:#4a5568;margin-bottom:4px;font-weight:600;}'
    + '.p4-row{display:flex;gap:16px;}'
    + '.p4-row>.p4-field{flex:1;}'
    + '@media (max-width:768px){'
    + '  .p4-stats{grid-template-columns:repeat(2,1fr);}'
    + '  .p4-tpl-grid{grid-template-columns:1fr;}'
    + '  .p4-acc-card{flex-direction:column;align-items:flex-start;}'
    + '  .p4-acc-quota{width:100%;}'
    + '  .p4-row{flex-direction:column;gap:0;}'
    + '  .p4-task-head{flex-direction:column;align-items:flex-start;}'
    + '  .p4-table{display:block;overflow-x:auto;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
