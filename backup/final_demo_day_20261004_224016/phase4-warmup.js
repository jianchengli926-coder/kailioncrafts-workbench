/* ============================================================
 * P4 Phase4: Email Warmup Module (邮箱预热基础版)
 * ----------------------------------------------------------------
 * - Pure frontend module, loaded AFTER app.js.
 * - Selects multiple email accounts, generates ring-robin warmup
 *   tasks (A→B, B→C, C→A), tracks per-account warmup progress
 *   over a 14-day cycle, and lets the user copy subject/body to
 *   send MANUALLY from their own webmail.
 * - HARD RULE: this module NEVER sends email. It only generates
 *   tasks and content drafts for manual sending.
 * - All new CSS classes use the p4- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init (load from DB if not already present) ────
  if(typeof S.warmupConfig === 'undefined' || S.warmupConfig === null) S.warmupConfig = DB.load('warmupConfig') || {};
  if(typeof S.warmupTasks  === 'undefined' || S.warmupTasks  === null) S.warmupTasks  = DB.load('warmupTasks')  || [];
  if(typeof S.warmupProgress === 'undefined' || S.warmupProgress === null) S.warmupProgress = DB.load('warmupProgress') || {};

  // ── Default templates (English B2B warm-up style) ──────
  var P4_DEFAULT_TEMPLATES = {
    industry_news: {
      label: 'Industry News Sharing',
      subject: 'Interesting cutlery industry update – {date}',
      body: 'Hi {recipient},\n\nJust wanted to share an interesting piece I came across recently about the cutlery and kitchen tools industry. Thought it might be relevant to your sourcing work.\n\nNo action needed — just keeping our communication channel active.\n\nBest regards,\n{sender}'
    },
    product_update: {
      label: 'Product Update',
      subject: 'Quick product update from KaiLionCrafts – {date}',
      body: 'Hi {recipient},\n\nHope you are doing well. We have been refining our product range and wanted to keep you in the loop on what is new.\n\nFeel free to reach out whenever you would like to discuss potential cooperation or request a spec sheet.\n\nBest regards,\n{sender}'
    },
    holiday_greeting: {
      label: 'Holiday Greeting',
      subject: 'Season\u2019s greetings from KaiLionCrafts – {date}',
      body: 'Hi {recipient},\n\nWishing you and your team a great day ahead. A quick note to stay in touch and let you know we are here whenever you need support on cutlery, scissors or kitchen tool sourcing.\n\nNo action required on your side.\n\nWarm regards,\n{sender}'
    },
    business_checkin: {
      label: 'Business Check-in',
      subject: 'Checking in – {sender} – {date}',
      body: 'Hi {recipient},\n\nHope business is treating you well. I am reaching out briefly to maintain our connection and see if there is anything on your radar where we could support your sourcing needs.\n\nReply whenever convenient.\n\nBest,\n{sender}'
    }
  };

  // Ensure config defaults exist
  if(!S.warmupConfig.accountIds)   S.warmupConfig.accountIds = [];
  if(!S.warmupConfig.dailyCount)   S.warmupConfig.dailyCount = 2;
  if(!S.warmupConfig.templateIds)  S.warmupConfig.templateIds = ['industry_news','product_update'];
  if(!S.warmupConfig.cycleDays)    S.warmupConfig.cycleDays = 14;
  if(!S.warmupConfig.startDate)    S.warmupConfig.startDate = null;
  if(!S.warmupConfig.templates)    S.warmupConfig.templates = JSON.parse(JSON.stringify(P4_DEFAULT_TEMPLATES));

  // ── Nav injection ──────────────────────────────────────
  NAV.push({key:'emailWarmup', icon:'🔥', label:'邮箱预热', title:'邮箱预热管理', crumb:'多邮箱互发预热 · 信誉提升 · 手动发送'});

  // ── Local helpers ──────────────────────────────────────
  function p4TodayStr(){
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p4FindAccount(id){
    var accs = S.emailAccounts || [];
    for(var i=0;i<accs.length;i++) if(accs[i].id===id) return accs[i];
    return null;
  }

  function p4SelectedAccounts(){
    var ids = S.warmupConfig.accountIds || [];
    var out = [];
    ids.forEach(function(id){
      var a = p4FindAccount(id);
      if(a) out.push(a);
    });
    return out;
  }

  // Replace {sender} {recipient} {date} placeholders in template text
  function p4RenderTpl(tplStr, fromEmail, toEmail, dateStr){
    if(!tplStr) return '';
    return String(tplStr)
      .replace(/\{sender\}/g, fromEmail)
      .replace(/\{recipient\}/g, toEmail)
      .replace(/\{date\}/g, dateStr);
  }

  // Reset todaySent when the local date changes
  function p4ResetDailyCounters(){
    var today = p4TodayStr();
    var prog = S.warmupProgress || {};
    Object.keys(prog).forEach(function(email){
      if(prog[email].todayDate !== today){
        prog[email].todaySent = 0;
        prog[email].todayDate = today;
      }
    });
  }

  // Warmup score: daysActive/14*60 + sentCount/140*40, cap 100
  function p4CalcScore(email){
    var p = (S.warmupProgress || {})[email];
    if(!p) return 0;
    var daysScore = (p.daysActive || 0) / 14 * 60;
    var sentScore = Math.min((p.sentCount || 0) / 140, 1) * 40;
    return Math.min(100, Math.round(daysScore + sentScore));
  }

  function p4EnsureProgress(email){
    if(!S.warmupProgress[email]){
      S.warmupProgress[email] = {
        sentCount: 0,
        daysActive: 0,
        todaySent: 0,
        todayDate: p4TodayStr(),
        lastActiveDate: null
      };
    }
    return S.warmupProgress[email];
  }

  function p4EscEmail(e){ return esc(e); }

  // ── Task generation: ring-robin ────────────────────────
  function p4GenerateTodayTasks(){
    var cfg = S.warmupConfig;
    var accounts = p4SelectedAccounts();
    var today = p4TodayStr();

    // Check if tasks already exist for today
    var existing = (S.warmupTasks || []).filter(function(t){ return t.date === today; });
    if(existing.length > 0) return existing;

    if(accounts.length < 2){ toast('至少需要选择2个邮箱账户才能形成环形互发','err'); return []; }

    var tplKeys = (cfg.templateIds || []).filter(function(k){ return cfg.templates[k]; });
    if(tplKeys.length === 0){ toast('请至少选择1套预热模板','err'); return []; }

    // If this is the very first task batch, stamp the start date
    if(!cfg.startDate) cfg.startDate = today;

    var N = accounts.length;
    var rounds = Math.max(1, Math.min(cfg.dailyCount || 2, 10));
    var tasks = [];

    for(var r = 0; r < rounds; r++){
      for(var i = 0; i < N; i++){
        var from = accounts[i];
        // Offset recipient: round 0 → next in ring, round 1 → skip one, etc.
        var toIdx = (i + 1 + r) % N;
        var to = accounts[toIdx];
        var tplKey = tplKeys[(i + r) % tplKeys.length];
        var tpl = cfg.templates[tplKey];

        tasks.push({
          id: uid(),
          date: today,
          fromEmail: from.email,
          toEmail: to.email,
          subject: p4RenderTpl(tpl.subject, from.email, to.email, today),
          body: p4RenderTpl(tpl.body, from.email, to.email, today),
          templateId: tplKey,
          status: 'pending',
          createdAt: new Date().toISOString()
        });
      }
    }

    S.warmupTasks = (S.warmupTasks || []).concat(tasks);
    persist();
    toast('已生成今日预热任务 '+tasks.length+' 个，请按提示手动发送');
    return tasks;
  }

  // ── Mark a task as done, update progress counters ──────
  window.p4MarkDone = function(taskId){
    var task = null;
    for(var i=0;i<(S.warmupTasks||[]).length;i++){
      if(S.warmupTasks[i].id===taskId){ task = S.warmupTasks[i]; break; }
    }
    if(!task){ toast('任务不存在','err'); return; }
    if(task.status === 'done'){ toast('该任务已完成'); return; }

    task.status = 'done';
    task.doneAt = new Date().toISOString();

    var today = p4TodayStr();
    var p = p4EnsureProgress(task.fromEmail);
    p.sentCount = (p.sentCount || 0) + 1;
    p.todaySent = (p.todaySent || 0) + 1;
    p.todayDate = today;
    // If this is the first completion today, count a new active day
    if(p.lastActiveDate !== today){
      p.daysActive = (p.daysActive || 0) + 1;
      p.lastActiveDate = today;
    }

    persist();
    toast('已标记完成：'+task.fromEmail+' → '+task.toEmail);
    renderView();
  };

  // ── Copy helpers ───────────────────────────────────────
  window.p4CopyText = function(text, label){
    // Use a temp textarea for broader browser compatibility
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try{
      document.execCommand('copy');
      toast('已复制'+(label||''));
    }catch(e){
      toast('复制失败，请手动复制','err');
    }
    document.body.removeChild(ta);
  };

  window.p4CopySubject = function(taskId){
    var task = null;
    for(var i=0;i<(S.warmupTasks||[]).length;i++){
      if(S.warmupTasks[i].id===taskId){ task = S.warmupTasks[i]; break; }
    }
    if(task) p4CopyText(task.subject, '主题');
  };

  window.p4CopyBody = function(taskId){
    var task = null;
    for(var i=0;i<(S.warmupTasks||[]).length;i++){
      if(S.warmupTasks[i].id===taskId){ task = S.warmupTasks[i]; break; }
    }
    if(task) p4CopyText(task.body, '正文');
  };

  // ── Save config from the form on the main view ─────────
  window.p4SaveConfig = function(){
    var accChecks = document.querySelectorAll('.p4-acc-check:checked');
    var ids = [];
    accChecks.forEach(function(cb){ ids.push(cb.value); });

    var dailyCount = parseInt(document.getElementById('p4f_dailyCount').value) || 2;
    dailyCount = Math.max(2, Math.min(10, dailyCount));

    var tplChecks = document.querySelectorAll('.p4-tpl-check:checked');
    var tplIds = [];
    tplChecks.forEach(function(cb){ tplIds.push(cb.value); });

    if(ids.length < 2){ toast('至少选择2个邮箱账户形成环形互发','err'); return; }
    if(tplIds.length === 0){ toast('至少选择1套预热模板','err'); return; }

    // If the account set changed, reset progress and start date
    var prevIds = JSON.stringify(S.warmupConfig.accountIds || []);
    S.warmupConfig.accountIds = ids;
    S.warmupConfig.dailyCount = dailyCount;
    S.warmupConfig.templateIds = tplIds;
    S.warmupConfig.cycleDays = 14;

    if(JSON.stringify(ids) !== prevIds){
      // Account roster changed — start a fresh cycle
      S.warmupConfig.startDate = null;
      // Keep progress but it will naturally reflect new sends
    }

    persist();
    toast('预热配置已保存');
    renderView();
  };

  // ── Generate today's tasks ────────────────────────────
  window.p4Generate = function(){
    p4GenerateTodayTasks();
    renderView();
  };

  // ── Template editor modal ──────────────────────────────
  window.p4EditTemplates = function(){
    var cfg = S.warmupConfig;
    var keys = Object.keys(cfg.templates);
    var h = '';
    h += '<div class="modal-head"><h3>✏️ 编辑预热内容模板</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body" style="max-height:75vh;overflow:auto">';
    h += '<div class="text-sm text-muted" style="margin-bottom:12px">可用变量：<code>{sender}</code> 发件邮箱 · <code>{recipient}</code> 收件邮箱 · <code>{date}</code> 当日日期</div>';

    keys.forEach(function(k){
      var t = cfg.templates[k];
      h += '<div class="p4-tpl-edit-card">';
      h += '  <div class="p4-tpl-edit-title">'+esc(t.label)+' <span class="text-muted text-sm">('+k+')</span></div>';
      h += '  <label class="text-xs text-muted">Subject</label>';
      h += '  <input class="form-control" id="p4tpl_subj_'+k+'" value="'+esc(t.subject)+'">';
      h += '  <label class="text-xs text-muted" style="margin-top:8px;display:block">Body</label>';
      h += '  <textarea class="form-control" id="p4tpl_body_'+k+'" rows="5">'+esc(t.body)+'</textarea>';
      h += '</div>';
    });

    h += '</div>';
    h += '<div class="modal-foot">';
    h += '<button class="btn btn-outline" onclick="closeModal()">取消</button>';
    h += '<button class="btn btn-primary" onclick="p4SaveTemplates()">💾 保存模板</button>';
    h += '</div>';
    openModal(h, true);
  };

  window.p4SaveTemplates = function(){
    var cfg = S.warmupConfig;
    var keys = Object.keys(cfg.templates);
    keys.forEach(function(k){
      var sEl = document.getElementById('p4tpl_subj_'+k);
      var bEl = document.getElementById('p4tpl_body_'+k);
      if(sEl) cfg.templates[k].subject = sEl.value;
      if(bEl) cfg.templates[k].body = bEl.value;
    });
    persist();
    closeModal();
    toast('模板已保存');
    renderView();
  };

  // ── History expand/collapse toggle ────────────────────
  window._p4HistOpen = {};
  window.p4ToggleHist = function(date){
    window._p4HistOpen[date] = !window._p4HistOpen[date];
    renderView();
  };

  // ── Main view ─────────────────────────────────────────
  window.viewEmailWarmup = function(root){
    p4ResetDailyCounters();
    var cfg = S.warmupConfig;
    var accounts = p4SelectedAccounts();
    var allTasks = S.warmupTasks || [];
    var today = p4TodayStr();

    var todayTasks = allTasks.filter(function(t){ return t.date === today; });
    var todayDone = todayTasks.filter(function(t){ return t.status === 'done'; }).length;

    // Group history by date (oldest first for display, newest first in list)
    var dateMap = {};
    allTasks.forEach(function(t){
      if(!dateMap[t.date]) dateMap[t.date] = [];
      dateMap[t.date].push(t);
    });
    var dates = Object.keys(dateMap).sort().reverse();

    var h = '';

    // ── Header ──
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">🔥 邮箱预热管理</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">多邮箱环形互发 · 14天信誉养成 · 全部手动发送，工作台不会自动发邮件</div></div>';
    h += '  <button class="btn btn-primary" onclick="p4Generate()">⚡ 生成今日预热任务</button>';
    h += '</div>';

    // ── Warning if no email accounts at all ──
    if(!(S.emailAccounts || []).length){
      h += '<div class="p4-empty">⚠️ 还没有配置邮箱账户。请先到「设置」页面添加企业邮箱账户，再回来配置预热。</div>';
      root.innerHTML = h;
      return;
    }

    // ── Section 1: Config panel ──
    h += '<div class="p4-card">';
    h += '  <div class="p4-card-title">⚙️ 预热配置</div>';

    // Account multi-select
    h += '  <div class="p4-field"><label>参与预热的邮箱账户（至少选2个）</label><div class="p4-check-list">';
    (S.emailAccounts || []).forEach(function(a){
      var checked = (cfg.accountIds||[]).indexOf(a.id) !== -1;
      h += '<label class="p4-check"><input type="checkbox" class="p4-acc-check" value="'+esc(a.id)+'" '+(checked?'checked':'')+'> '+esc(a.email)+'</label>';
    });
    h += '  </div></div>';

    // Daily count slider
    h += '  <div class="p4-field"><label>每账户每日发送轮次（范围 2–10）：<b id="p4_dailyVal">'+(cfg.dailyCount||2)+'</b> 轮</label>';
    h += '  <input type="range" id="p4f_dailyCount" min="2" max="10" value="'+(cfg.dailyCount||2)+'" class="p4-slider" oninput="document.getElementById(\'p4_dailyVal\').textContent=this.value">';
    h += '  <div class="text-sm text-muted">每轮每个账户发1封，环形互发。例如3账户×2轮=每日6封预热邮件。</div></div>';

    // Template multi-select
    h += '  <div class="p4-field"><label>预热内容模板（可多选轮换）</label><div class="p4-check-list">';
    Object.keys(cfg.templates).forEach(function(k){
      var t = cfg.templates[k];
      var checked = (cfg.templateIds||[]).indexOf(k) !== -1;
      h += '<label class="p4-check"><input type="checkbox" class="p4-tpl-check" value="'+k+'" '+(checked?'checked':'')+'> '+esc(t.label)+'</label>';
    });
    h += '  </div></div>';

    // Cycle info
    h += '  <div class="p4-field"><label>预热周期</label>';
    h += '  <div class="text-sm text-muted">固定 <b>14 天</b> 为一个完整预热周期。连续14天正常发送且预热分数 &gt;80，即视为预热完成。</div></div>';

    h += '  <div style="display:flex;gap:8px;flex-wrap:wrap">';
    h += '    <button class="btn btn-primary" onclick="p4SaveConfig()">💾 保存配置</button>';
    h += '    <button class="btn btn-outline" onclick="p4EditTemplates()">✏️ 编辑模板内容</button>';
    h += '  </div>';
    h += '</div>';

    // ── Section 2: Progress cards ──
    h += '<div class="p4-card">';
    h += '  <div class="p4-card-title">📈 各邮箱预热进度';
    if(cfg.startDate) h += ' <span class="text-sm text-muted" style="font-weight:400">（周期开始：'+esc(cfg.startDate)+'）</span>';
    h += '  </div>';

    if(accounts.length === 0){
      h += '<div class="p4-empty" style="margin:10px 0">请先在上方配置中选择至少2个邮箱账户，然后保存配置。</div>';
    } else {
      h += '<div class="p4-prog-grid">';
      accounts.forEach(function(a){
        p4EnsureProgress(a.email);
        p4ResetDailyCounters();
        var p = S.warmupProgress[a.email];
        var score = p4CalcScore(a.email);
        var dayNum = Math.min(p.daysActive || 0, 14);
        var scoreColor = score >= 80 ? '#38a169' : score >= 50 ? '#d69e2e' : '#e53e3e';

        h += '<div class="p4-prog-card">';
        h += '  <div class="p4-prog-email">'+esc(a.email)+'</div>';
        h += '  <div class="p4-prog-day">第 '+dayNum+' / 14 天</div>';
        h += '  <div class="p4-prog-stats">';
        h += '    <div><span class="p4-stat-num">'+(p.sentCount||0)+'</span><span class="p4-stat-lbl">累计发送</span></div>';
        h += '    <div><span class="p4-stat-num">'+(p.todaySent||0)+'</span><span class="p4-stat-lbl">今日发送</span></div>';
        h += '    <div><span class="p4-stat-num" style="color:'+scoreColor+'">'+score+'</span><span class="p4-stat-lbl">预热分数</span></div>';
        h += '  </div>';
        h += '  <div class="p4-prog-bar"><div class="p4-prog-bar-fill" style="width:'+score+'%;background:'+scoreColor+'"></div></div>';
        if(score >= 80){
          h += '  <div class="p4-prog-done">✅ 预热达标（分数&gt;80）</div>';
        } else {
          h += '  <div class="p4-prog-hint">连续14天发送 + 分数&gt;80 = 预热完成</div>';
        }
        h += '</div>';
      });
      h += '</div>';
    }
    h += '</div>';

    // ── Section 3: Today's tasks ──
    h += '<div class="p4-card">';
    h += '  <div class="p4-card-title">📋 今日任务（'+today+'）';
    if(todayTasks.length) h += ' <span class="text-sm text-muted" style="font-weight:400">'+todayDone+'/'+todayTasks.length+' 已完成</span>';
    h += '  </div>';

    if(todayTasks.length === 0){
      h += '<div class="p4-empty" style="margin:10px 0">今日还没有预热任务。点击右上角「⚡ 生成今日预热任务」按钮生成。</div>';
    } else {
      h += '<div class="p4-task-list">';
      todayTasks.forEach(function(t){
        var done = t.status === 'done';
        h += '<div class="p4-task-card '+(done?'done':'')+'">';
        h += '  <div class="p4-task-head">';
        h += '    <span class="p4-task-arrow">'+esc(t.fromEmail)+' → '+esc(t.toEmail)+'</span>';
        h += '    <span class="p4-task-badge '+(done?'done':'pending')+'">'+(done?'✅ 已完成':'⏳ 待发送')+'</span>';
        h += '  </div>';
        h += '  <div class="p4-task-subj">'+esc(t.subject)+'</div>';
        h += '  <div class="p4-task-body">'+esc(t.body.slice(0,120))+(t.body.length>120?'…':'')+'</div>';
        h += '  <div class="p4-task-actions">';
        h += '    <button class="btn btn-sm btn-outline" onclick="p4CopySubject(\''+t.id+'\')">📋 复制主题</button>';
        h += '    <button class="btn btn-sm btn-outline" onclick="p4CopyBody(\''+t.id+'\')">📄 复制正文</button>';
        if(!done){
          h += '    <button class="btn btn-sm btn-primary" onclick="p4MarkDone(\''+t.id+'\')">✅ 标记已完成</button>';
        }
        h += '  </div>';
        h += '</div>';
      });
      h += '</div>';
    }
    h += '</div>';

    // ── Section 4: History by date ──
    if(dates.length > 1 || (dates.length === 1 && dates[0] !== today)){
      h += '<div class="p4-card">';
      h += '  <div class="p4-card-title">🗓️ 历史任务记录</div>';
      dates.forEach(function(date){
        if(date === today) return; // skip today (already shown above)
        var list = dateMap[date];
        var doneCount = list.filter(function(t){ return t.status === 'done'; }).length;
        var open = !!window._p4HistOpen[date];
        h += '<div class="p4-hist-item">';
        h += '  <div class="p4-hist-head" onclick="p4ToggleHist(\''+date+'\')">';
        h += '    <span>'+(open?'▼':'▶')+' '+esc(date)+'</span>';
        h += '    <span class="text-sm text-muted">'+doneCount+'/'+list.length+' 已完成</span>';
        h += '  </div>';
        if(open){
          h += '  <div class="p4-hist-body">';
          list.forEach(function(t){
            var done = t.status === 'done';
            h += '<div class="p4-task-card '+(done?'done':'')+'" style="margin-bottom:6px">';
            h += '  <div class="p4-task-head">';
            h += '    <span class="p4-task-arrow">'+esc(t.fromEmail)+' → '+esc(t.toEmail)+'</span>';
            h += '    <span class="p4-task-badge '+(done?'done':'pending')+'">'+(done?'✅ 已完成':'⏳ 待发送')+'</span>';
            h += '  </div>';
            h += '  <div class="p4-task-subj">'+esc(t.subject)+'</div>';
            h += '  <div class="p4-task-actions">';
            h += '    <button class="btn btn-sm btn-outline" onclick="p4CopySubject(\''+t.id+'\')">📋 复制主题</button>';
            h += '    <button class="btn btn-sm btn-outline" onclick="p4CopyBody(\''+t.id+'\')">📄 复制正文</button>';
            if(!done){
              h += '    <button class="btn btn-sm btn-primary" onclick="p4MarkDone(\''+t.id+'\')">✅ 标记已完成</button>';
            }
            h += '  </div>';
            h += '</div>';
          });
          h += '  </div>';
        }
        h += '</div>';
      });
      h += '</div>';
    }

    root.innerHTML = h;
  };

  // ── renderView interception ───────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'emailWarmup'){
      var el = document.getElementById('mainContent');
      if(el) window.viewEmailWarmup(el);
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p4- prefixed, responsive) ─────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p4-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin-bottom:16px;}'
    + '.p4-card-title{font-weight:600;font-size:15px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.p4-field{margin-bottom:14px;}'
    + '.p4-field label{display:block;font-size:13px;color:#4a5568;margin-bottom:6px;font-weight:600;}'
    + '.p4-check-list{display:flex;gap:14px;flex-wrap:wrap;}'
    + '.p4-check{font-size:13px;color:#4a5568;display:flex;align-items:center;gap:5px;cursor:pointer;background:#f7fafc;padding:6px 12px;border-radius:6px;border:1px solid #e2e8f0;}'
    + '.p4-slider{width:100%;max-width:360px;}'
    + '.p4-empty{padding:30px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'

    + '.p4-prog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}'
    + '.p4-prog-card{background:#f7fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;}'
    + '.p4-prog-email{font-weight:600;font-size:13px;color:#2d3748;word-break:break-all;}'
    + '.p4-prog-day{font-size:12px;color:#718096;margin-top:2px;}'
    + '.p4-prog-stats{display:flex;justify-content:space-around;margin:10px 0;}'
    + '.p4-prog-stats>div{text-align:center;}'
    + '.p4-stat-num{display:block;font-size:20px;font-weight:700;color:#2d3748;}'
    + '.p4-stat-lbl{font-size:11px;color:#718096;}'
    + '.p4-prog-bar{background:#e2e8f0;border-radius:6px;height:10px;overflow:hidden;margin:6px 0;}'
    + '.p4-prog-bar-fill{height:100%;border-radius:6px;transition:width .3s;}'
    + '.p4-prog-done{font-size:12px;color:#38a169;font-weight:600;margin-top:6px;}'
    + '.p4-prog-hint{font-size:11px;color:#a0aec0;margin-top:6px;}'

    + '.p4-task-list{display:flex;flex-direction:column;gap:10px;}'
    + '.p4-task-card{background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;}'
    + '.p4-task-card.done{opacity:.65;background:#f0fff4;border-color:#c6f6d5;}'
    + '.p4-task-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;}'
    + '.p4-task-arrow{font-size:13px;font-weight:600;color:#2d3748;word-break:break-all;}'
    + '.p4-task-badge{font-size:11px;padding:2px 8px;border-radius:10px;color:#fff;white-space:nowrap;}'
    + '.p4-task-badge.pending{background:#d69e2e;}'
    + '.p4-task-badge.done{background:#38a169;}'
    + '.p4-task-subj{font-size:13px;font-weight:600;color:#2d3748;margin:4px 0;}'
    + '.p4-task-body{font-size:12px;color:#718096;white-space:pre-wrap;margin-bottom:8px;line-height:1.5;}'
    + '.p4-task-actions{display:flex;gap:6px;flex-wrap:wrap;}'

    + '.p4-hist-item{border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px;overflow:hidden;}'
    + '.p4-hist-head{padding:10px 14px;background:#f7fafc;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600;}'
    + '.p4-hist-head:hover{background:#edf2f7;}'
    + '.p4-hist-body{padding:10px;}'

    + '.p4-tpl-edit-card{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px;}'
    + '.p4-tpl-edit-title{font-weight:600;font-size:13px;margin-bottom:8px;}'

    + '@media (max-width:768px){'
    + '  .p4-prog-grid{grid-template-columns:1fr;}'
    + '  .p4-task-head{flex-direction:column;align-items:flex-start;}'
    + '  .p4-task-actions .btn{font-size:12px;padding:4px 8px;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
