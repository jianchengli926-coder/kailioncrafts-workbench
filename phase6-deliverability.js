/* ============================================================
 * P6 Phase6: Deliverability Workbench
 * ----------------------------------------------------------------
 * Feature 12: ESP-based reputation view (Gmail/Outlook/Yahoo/企业邮箱)
 * Feature 13: Pre-send deliverability health check (SPF/DKIM/DMARC/黑名单)
 * Feature 14: Warmup multi-round dialogue simulation (manual reminders)
 *
 * HARD RULE: This module NEVER auto-sends any email. Warmup dialogue
 * creates task reminders only — the user performs every action manually
 * in their own email client.
 *
 * All new CSS classes use the p6- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  if(!Array.isArray(S.p6DeliverabilityReports)) S.p6DeliverabilityReports = [];
  if(!Array.isArray(S.p6WarmupDialogues))       S.p6WarmupDialogues       = [];

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'deliverability',
    icon: '📬',
    label: '送达体检',
    title: '送达率与邮箱健康',
    crumb: 'ESP reputation · SPF/DKIM/DMARC · 预热对话'
  });

  // ── Local helpers ──────────────────────────────────────────
  function p6NowISO(){ return new Date().toISOString(); }

  function p6FmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p6FmtTime(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return p6FmtDate(iso)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  function p6TodayStr(){
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p6FindAccount(id){
    return (S.emailAccounts || []).find(function(a){ return a.id === id; }) || null;
  }

  // Extract domain portion from an email address
  function p6ExtractDomain(email){
    if(!email || email.indexOf('@') === -1) return '';
    return email.split('@')[1].trim().toLowerCase();
  }

  // ── Feature 12: ESP detection from recipient email ────────
  function p6DetectESP(email){
    if(!email || email.indexOf('@') === -1) return '其他';
    var d = email.split('@')[1].trim().toLowerCase();
    if(/^gmail\.com$/.test(d)) return 'Gmail';
    if(/^(outlook|hotmail|live|msn)\.com$/.test(d)) return 'Outlook';
    if(/^yahoo\.com$/.test(d)) return 'Yahoo';
    // Non-free domains are treated as company / corporate mailboxes
    return '企业邮箱';
  }

  // ── Compute ESP reputation aggregates from S.sendRecords ──
  function p6ComputeEspReputation(){
    var groups = {};
    (S.sendRecords || []).forEach(function(r){
      var esp = p6DetectESP(r.email);
      if(!groups[esp]) groups[esp] = { esp: esp, sent: 0, opened: 0, bounced: 0, complaints: 0 };
      groups[esp].sent++;
      if(r.openStatus === 'opened') groups[esp].opened++;
      if(r.status === 'bounced' || r.followUpStatus === 'bounced') groups[esp].bounced++;
      if(r.status === 'complaint' || (r.metadata && r.metadata.complaint)) groups[esp].complaints++;
    });

    var list = Object.keys(groups).map(function(k){
      var g = groups[k];
      g.openRate      = g.sent > 0 ? g.opened    / g.sent : 0;
      g.bounceRate    = g.sent > 0 ? g.bounced  / g.sent : 0;
      g.complaintRate = g.sent > 0 ? g.complaints / g.sent : 0;
      return g;
    });
    list.sort(function(a,b){ return b.sent - a.sent; });

    var best = null, worst = null;
    list.forEach(function(g){
      if(g.sent === 0) return;
      if(!best  || g.openRate > best.openRate)   best  = g;
      if(!worst || g.openRate < worst.openRate)  worst = g;
    });
    return { list: list, best: best, worst: worst };
  }

  // ── Feature 13: API call for domain deliverability check ──
  async function p6CheckDomain(domain){
    try{
      var resp = await fetch('/api/deliverability/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domain })
      });
      return await resp.json();
    }catch(e){
      return { success: false, error: e.message };
    }
  }

  // Run check for a single email account
  async function p6RunCheckForAccount(acc){
    var domain = p6ExtractDomain(acc.email);
    if(!domain){ toast('无法提取域名: ' + acc.email, 'err'); return; }
    toast('正在检查 ' + domain + ' ...');
    var result = await p6CheckDomain(domain);
    if(!result || result.success === false){
      toast('检查失败: ' + domain + ' ' + (result && result.error ? result.error : ''), 'err');
      return;
    }
    S.p6DeliverabilityReports.push({
      id: uid(),
      emailAccountId: acc.id,
      email: acc.email,
      domain: domain,
      result: result,
      checkedAt: result.checkedAt || p6NowISO()
    });
    persist();
  }

  // Run all checks sequentially with 500ms delay between accounts
  window.p6RunAllChecks = async function(){
    var accounts = S.emailAccounts || [];
    if(!accounts.length){ toast('还没有配置邮箱账户', 'err'); return; }
    for(var i = 0; i < accounts.length; i++){
      await p6RunCheckForAccount(accounts[i]);
      if(i < accounts.length - 1){
        await new Promise(function(resolve){ setTimeout(resolve, 500); });
      }
    }
    toast('✅ 全部体检完成');
    renderView();
  };

  // Run check for a single account from the UI
  window.p6RunCheckOne = async function(accountId){
    var acc = p6FindAccount(accountId);
    if(!acc) return;
    await p6RunCheckForAccount(acc);
    renderView();
  };

  // Return the latest health report for a given email account (for cross-module use)
  window.p6GetAccountHealth = function(emailAccountId){
    var latest = null;
    (S.p6DeliverabilityReports || []).forEach(function(r){
      if(r.emailAccountId !== emailAccountId) return;
      if(!latest || new Date(r.checkedAt) > new Date(latest.checkedAt)) latest = r;
    });
    return latest;
  };

  // ── Feature 14: Warmup dialogue templates ──────────────────
  var P6_DIALOGUE_TEMPLATES = {
    industry_news: {
      label: '行业资讯讨论',
      sendSubject: [
        'Interesting industry news this week',
        'Saw this article — thought of you',
        'Market update worth sharing'
      ],
      sendBody: [
        'Hi,\n\nDid you see the latest news about recent trade policy changes? It could affect our supply chain planning for the coming quarter.\n\nBest regards,\nLeo'
      ],
      replySubject: [
        'Re: Interesting industry news',
        'Re: Saw this article',
        'Re: Market update'
      ],
      replyBody: [
        'Hi,\n\nThanks for sharing! I agree — this is something we should discuss further in our next call.\n\nBest'
      ]
    },
    product_inquiry: {
      label: '产品询价沟通',
      sendSubject: [
        'Quick question about your product range',
        'Product spec inquiry',
        'Need a quote for kitchen tools'
      ],
      sendBody: [
        'Hi,\n\nQuick question about your current product catalog. Do you have stock availability and updated pricing for this quarter?\n\nThanks'
      ],
      replySubject: [
        'Re: Quick question',
        'Re: Product spec inquiry',
        'Re: Need a quote'
      ],
      replyBody: [
        'Hi,\n\nThanks for reaching out. Yes, we have availability. I will send over the detailed catalog and pricing shortly.\n\nBest regards'
      ]
    },
    casual_greeting: {
      label: '日常问候寒暄',
      sendSubject: [
        'Hope you are doing well',
        'Checking in',
        'Quick catch-up'
      ],
      sendBody: [
        'Hi,\n\nHope you are having a good week! Just wanted to check in and see how things are going on your end.\n\nCheers'
      ],
      replySubject: [
        'Re: Hope you are doing well',
        'Re: Checking in',
        'Re: Quick catch-up'
      ],
      replyBody: [
        'Hi,\n\nDoing well, thanks for asking! Hope you are also having a productive week.\n\nCheers'
      ]
    }
  };

  // Push one dialogue task into S.p6WarmupDialogues
  function p6PushDialogueTask(round, fromAcc, toAcc, actionType, catKey){
    var tpl = P6_DIALOGUE_TEMPLATES[catKey] || P6_DIALOGUE_TEMPLATES.casual_greeting;
    var subject = '', body = '';
    if(actionType !== 'open_star'){
      var subjArr = (actionType === 'reply') ? tpl.replySubject : tpl.sendSubject;
      var bodyArr = (actionType === 'reply') ? tpl.replyBody : tpl.sendBody;
      subject = subjArr[Math.floor(Math.random() * subjArr.length)];
      body    = bodyArr[Math.floor(Math.random()    * bodyArr.length)];
    }
    S.p6WarmupDialogues.push({
      id: uid(),
      round: round,
      fromAccountId: fromAcc.id,
      toAccountId: toAcc.id,
      fromAccount: fromAcc.email,
      toAccount: toAcc.email,
      direction: fromAcc.email + ' → ' + toAcc.email,
      actionType: actionType,
      category: catKey,
      suggestedSubject: subject,
      suggestedBody: body,
      status: 'pending',
      createdAt: p6NowISO()
    });
  }

  // Build a multi-round dialogue between account A and account B
  function p6BuildDialoguePair(A, B, rounds){
    var catKeys = Object.keys(P6_DIALOGUE_TEMPLATES);
    for(var r = 1; r <= rounds; r++){
      var cat = catKeys[Math.floor(Math.random() * catKeys.length)];
      if(r === 1){
        // Round 1: A sends new email, B opens + stars (no reply yet)
        p6PushDialogueTask(r, A, B, 'send',      cat);
        p6PushDialogueTask(r, B, A, 'open_star', cat);
      } else if(r % 2 === 0){
        // Even round: B replies, A opens, A replies back
        p6PushDialogueTask(r, B, A, 'reply',     cat);
        p6PushDialogueTask(r, A, B, 'open_star', cat);
        p6PushDialogueTask(r, A, B, 'reply',     cat);
      } else {
        // Odd round (>1): A sends new topic, B opens, B replies
        p6PushDialogueTask(r, A, B, 'send',      cat);
        p6PushDialogueTask(r, B, A, 'open_star', cat);
        p6PushDialogueTask(r, B, A, 'reply',     cat);
      }
    }
  }

  // Generate the warmup dialogue plan (manual tasks only — NEVER auto-send)
  window.p6GenerateDialoguePlan = function(){
    var selectedIds = [];
    document.querySelectorAll('.p6-warmup-acc-check:checked').forEach(function(cb){
      selectedIds.push(cb.value);
    });
    if(selectedIds.length < 2){ toast('请至少选择2个邮箱账户', 'err'); return; }

    var roundsEl = document.getElementById('p6_warmup_rounds');
    var rounds = parseInt(roundsEl ? roundsEl.value : '3', 10) || 3;
    if(rounds < 1) rounds = 1;
    if(rounds > 10) rounds = 10;

    var accounts = (S.emailAccounts || []).filter(function(a){
      return selectedIds.indexOf(a.id) !== -1;
    });
    if(accounts.length < 2){ toast('所选账户不足2个', 'err'); return; }

    // Keep already-done tasks, clear pending ones for a fresh plan
    S.p6WarmupDialogues = (S.p6WarmupDialogues || []).filter(function(d){ return d.status === 'done'; });

    // Pair accounts: (0,1), (2,3), ... wrap last with first if odd count
    for(var i = 0; i < accounts.length; i += 2){
      var A = accounts[i];
      var B = accounts[i + 1] || accounts[0];
      p6BuildDialoguePair(A, B, rounds);
    }

    persist();
    toast('✅ 对话计划已生成 — 请在邮箱客户端手动执行每一步');
    renderView();
  };

  // Mark a dialogue task as done
  window.p6MarkDialogueDone = function(id){
    var t = (S.p6WarmupDialogues || []).find(function(x){ return x.id === id; });
    if(t){ t.status = 'done'; persist(); renderView(); }
  };

  // Reset all dialogue tasks back to pending
  window.p6ResetDialogues = function(){
    (S.p6WarmupDialogues || []).forEach(function(d){ d.status = 'pending'; });
    persist();
    renderView();
  };

  // AI-generate a variant copy for a given dialogue task
  window.p6AiVariant = async function(id){
    var t = (S.p6WarmupDialogues || []).find(function(x){ return x.id === id; });
    if(!t) return;
    toast('AI正在生成变体...');
    var catLabel = (P6_DIALOGUE_TEMPLATES[t.category] || {}).label || t.category;
    var prompt = '你是B2B外贸邮件写作助手。请为以下预热对话邮件生成一个自然的英文变体，保持商务专业语气但换一种表达方式。\n'
      + '类别：' + catLabel + '\n'
      + '当前主题：' + (t.suggestedSubject || '(无)') + '\n'
      + '当前正文：' + (t.suggestedBody || '(无)') + '\n'
      + '只输出JSON，不要其他文字：{"subject":"...","body":"..."}';
    try{
      var r = await callAI(
        [{ role: 'user', content: prompt }],
        { purpose: 'warmup_variant', timeout: 30000, temperature: 0.7 }
      );
      if(r.error){ toast('AI生成失败: ' + r.error, 'err'); return; }
      var m = r.content.match(/\{[\s\S]*\}/);
      if(m){
        var j = JSON.parse(m[0]);
        if(j.subject) t.suggestedSubject = j.subject;
        if(j.body)    t.suggestedBody    = j.body;
        persist();
        toast('✅ 变体已生成');
        renderView();
      } else {
        toast('AI返回格式异常', 'err');
      }
    }catch(e){
      toast('AI生成失败: ' + e.message, 'err');
    }
  };

  // Toggle warmup tab account checkbox UI state
  window.p6ToggleAllWarmupAccounts = function(checked){
    document.querySelectorAll('.p6-warmup-acc-check').forEach(function(cb){ cb.checked = checked; });
  };

  // ── Rendering helpers ─────────────────────────────────────
  function p6StatusIcon(status){
    if(status === 'pass') return '✅';
    if(status === 'warn') return '⚠️';
    if(status === 'fail') return '❌';
    return '—';
  }

  function p6OverallBadge(overall){
    if(overall === 'pass') return '<span class="p6-badge p6-pass">通过</span>';
    if(overall === 'warn') return '<span class="p6-badge p6-warn">警告</span>';
    if(overall === 'fail') return '<span class="p6-badge p6-fail">不通过</span>';
    return '<span class="p6-badge p6-none">未检查</span>';
  }

  function p6Pct(n){ return (n * 100).toFixed(1) + '%'; }

  // ── Tab 1: ESP Reputation ──────────────────────────────────
  function p6RenderEspTab(){
    var rep = p6ComputeEspReputation();
    var h = '';

    if(!rep.list.length){
      h += '<div class="p6-empty">📭 暂无发送记录。发送邮件后这里会自动统计各ESP的打开率、退信率和投诉率。</div>';
      return h;
    }

    // ESP cards
    h += '<div class="p6-esp-grid">';
    rep.list.forEach(function(g){
      var cardCls = 'p6-esp-card';
      if(rep.best && rep.best.esp === g.esp)  cardCls += ' best';
      if(rep.worst && rep.worst.esp === g.esp) cardCls += ' worst';
      h += '<div class="' + cardCls + '">';
      h += '  <div class="p6-esp-name">' + esc(g.esp);
      if(rep.best && rep.best.esp === g.esp)   h += ' <span class="p6-tag gold">🏆 最佳</span>';
      if(rep.worst && rep.worst.esp === g.esp) h += ' <span class="p6-tag red">⚠️ 最差</span>';
      h += '  </div>';
      h += '  <div class="p6-esp-metrics">';
      h += '    <div><span class="p6-esp-num">' + g.sent + '</span><span class="p6-esp-lbl">发送</span></div>';
      h += '    <div><span class="p6-esp-num" style="color:#38a169">' + g.opened + '</span><span class="p6-esp-lbl">已打开</span></div>';
      h += '    <div><span class="p6-esp-num" style="color:#d69e2e">' + g.bounced + '</span><span class="p6-esp-lbl">退信</span></div>';
      h += '    <div><span class="p6-esp-num" style="color:#e53e3e">' + g.complaints + '</span><span class="p6-esp-lbl">投诉</span></div>';
      h += '  </div>';
      h += '  <div class="p6-esp-rates">';
      h += '    <div>打开率 <b>' + p6Pct(g.openRate) + '</b></div>';
      h += '    <div>退信率 <b>' + p6Pct(g.bounceRate) + '</b></div>';
      h += '    <div>投诉率 <b>' + p6Pct(g.complaintRate) + '</b></div>';
      h += '  </div>';
      h += '</div>';
    });
    h += '</div>';

    // Comparison table
    h += '<div class="p6-card">';
    h += '  <div class="p6-card-title">📊 ESP 对比表</div>';
    h += '  <table class="p6-table">';
    h += '    <thead><tr><th>ESP</th><th>发送数</th><th>已打开</th><th>打开率</th><th>退信</th><th>退信率</th><th>投诉</th><th>投诉率</th></tr></thead>';
    h += '    <tbody>';
    rep.list.forEach(function(g){
      h += '<tr>';
      h += '  <td><b>' + esc(g.esp) + '</b></td>';
      h += '  <td>' + g.sent + '</td>';
      h += '  <td>' + g.opened + '</td>';
      h += '  <td>' + p6Pct(g.openRate) + '</td>';
      h += '  <td>' + g.bounced + '</td>';
      h += '  <td>' + p6Pct(g.bounceRate) + '</td>';
      h += '  <td>' + g.complaints + '</td>';
      h += '  <td>' + p6Pct(g.complaintRate) + '</td>';
      h += '</tr>';
    });
    h += '    </tbody>';
    h += '  </table>';
    h += '</div>';

    // Routing suggestion
    h += '<div class="p6-suggestion">';
    h += '  <div class="p6-suggestion-title">💡 路由建议</div>';
    h += '  <p>高信誉发件账户用于高价值客户（A类客户），预热中的账户优先发送低优先级联系人。</p>';
    if(rep.best)  h += '  <p>✅ 当前表现最佳：<b>' + esc(rep.best.esp) + '</b>（打开率 ' + p6Pct(rep.best.openRate) + '），适合发送给重点客户。</p>';
    if(rep.worst) h += '  <p>⚠️ 当前需关注：<b>' + esc(rep.worst.esp) + '</b>（打开率 ' + p6Pct(rep.worst.openRate) + '），建议加强预热并检查内容质量。</p>';
    h += '</div>';

    return h;
  }

  // ── Tab 2: Health Check (SPF/DKIM/DMARC) ──────────────────
  function p6RenderHealthTab(){
    var accounts = S.emailAccounts || [];
    var h = '';

    h += '<div class="p6-card">';
    h += '  <div class="p6-card-title">🔧 发送前体检';
    h += '    <button class="btn btn-primary" style="margin-left:12px" onclick="p6RunAllChecks()">🚀 一键检查全部账户</button>';
    h += '  </div>';
    h += '  <div class="text-sm text-muted" style="margin-bottom:10px">检测每个发件域名的 SPF / DKIM / DMARC 配置及黑名单状态，DNS 查询顺序执行以避免限流。</div>';
    h += '</div>';

    if(!accounts.length){
      h += '<div class="p6-empty">⚠️ 还没有配置邮箱账户。请先到「设置」添加企业邮箱。</div>';
      return h;
    }

    h += '<div class="p6-health-list">';
    accounts.forEach(function(acc){
      var report = window.p6GetAccountHealth(acc.id);
      var r = report ? report.result : null;
      var overall = r ? r.overall : null;
      var score = r ? r.score : null;
      var domain = p6ExtractDomain(acc.email);

      var cardCls = 'p6-health-card';
      if(overall === 'pass') cardCls += ' ok';
      else if(overall === 'warn') cardCls += ' warn';
      else if(overall === 'fail') cardCls += ' bad';

      h += '<div class="' + cardCls + '">';
      h += '  <div class="p6-health-head">';
      h += '    <div>';
      h += '      <div class="p6-health-email">' + esc(acc.email) + '</div>';
      h += '      <div class="text-sm text-muted">域名: ' + esc(domain || '—') + (report ? ' · 检查于 ' + p6FmtTime(report.checkedAt) : '') + '</div>';
      h += '    </div>';
      h += '    <div class="p6-health-right">';
      if(score !== null){
        h += '      <div class="p6-health-score" style="color:' + (overall==='pass'?'#38a169':overall==='warn'?'#d69e2e':'#e53e3e') + '">' + score + ' 分</div>';
      }
      h += '      ' + p6OverallBadge(overall);
      h += '      <button class="btn btn-outline" onclick="p6RunCheckOne(\'' + esc(acc.id) + '\')">🔄 重新检查</button>';
      h += '    </div>';
      h += '  </div>';

      if(r){
        h += '  <div class="p6-checks-grid">';
        // SPF
        h += p6CheckItem('SPF', r.spf);
        // DKIM
        h += p6CheckItem('DKIM', r.dkim);
        // DMARC
        h += p6CheckItem('DMARC', r.dmarc);
        // Blacklist
        h += p6CheckItem('黑名单', r.blacklist);
        h += '  </div>';
      } else {
        h += '  <div class="p6-health-pending">尚未检查。点击「重新检查」开始检测 DNS 配置。</div>';
      }
      h += '</div>';
    });
    h += '</div>';

    return h;
  }

  function p6CheckItem(name, item){
    if(!item) return '';
    var cls = 'p6-check-item';
    if(item.status === 'pass') cls += ' ok';
    else if(item.status === 'warn') cls += ' warn';
    else if(item.status === 'fail') cls += ' bad';

    var h = '<div class="' + cls + '">';
    h += '  <div class="p6-check-head">';
    h += '    <span class="p6-check-icon">' + p6StatusIcon(item.status) + '</span>';
    h += '    <b>' + name + '</b>';
    if(item.selector) h += ' <small class="text-muted">(' + esc(item.selector) + ')</small>';
    if(item.policy)   h += ' <small class="text-muted">p=' + esc(item.policy) + '</small>';
    h += '  </div>';
    h += '  <div class="p6-check-detail">' + esc(item.detail || '') + '</div>';
    if(item.fix){
      h += '  <div class="p6-check-fix">🔧 ' + esc(item.fix) + '</div>';
    }
    h += '</div>';
    return h;
  }

  // ── Tab 3: Warmup Dialogue ─────────────────────────────────
  function p6RenderWarmupTab(){
    var accounts = S.emailAccounts || [];
    var h = '';

    if(!accounts.length){
      h += '<div class="p6-empty">⚠️ 还没有配置邮箱账户。请先到「设置」添加企业邮箱。</div>';
      return h;
    }

    // Config panel
    h += '<div class="p6-card">';
    h += '  <div class="p6-card-title">⚙️ 预热对话配置</div>';
    h += '  <div class="text-sm text-muted" style="margin-bottom:10px">模拟两个邮箱账户之间的多轮自然对话（发信→打开标星→回复）。<b>所有步骤均为手动提醒，工作台不会自动发送邮件。</b></div>';

    h += '  <div class="p6-field"><label>参与对话的邮箱账户（至少选2个）';
    h += '    <button class="btn btn-outline" style="margin-left:8px;padding:2px 10px;font-size:12px" onclick="p6ToggleAllWarmupAccounts(true)">全选</button>';
    h += '    <button class="btn btn-outline" style="padding:2px 10px;font-size:12px" onclick="p6ToggleAllWarmupAccounts(false)">清空</button>';
    h += '  </label><div class="p6-check-list">';

    // Default: use S.warmupConfig.accountIds if available
    var defaultIds = (S.warmupConfig && S.warmupConfig.accountIds) || [];
    accounts.forEach(function(a){
      var checked = defaultIds.indexOf(a.id) !== -1;
      h += '<label class="p6-check"><input type="checkbox" class="p6-warmup-acc-check" value="' + esc(a.id) + '" ' + (checked ? 'checked' : '') + '> ' + esc(a.email) + '</label>';
    });
    h += '  </div></div>';

    h += '  <div class="p6-field"><label>对话轮数：<b id="p6_roundsVal">3</b> 轮</label>';
    h += '    <input type="range" id="p6_warmup_rounds" min="1" max="10" value="3" class="p6-slider" oninput="document.getElementById(\'p6_roundsVal\').textContent=this.value">';
    h += '  </div>';

    h += '  <div style="display:flex;gap:8px;flex-wrap:wrap">';
    h += '    <button class="btn btn-primary" onclick="p6GenerateDialoguePlan()">🎯 生成对话计划</button>';
    h += '    <button class="btn btn-outline" onclick="p6ResetDialogues()">🔄 重置全部任务</button>';
    h += '  </div>';
    h += '</div>';

    // Task list with progress
    var dialogues = S.p6WarmupDialogues || [];
    var doneCount = dialogues.filter(function(d){ return d.status === 'done'; }).length;
    var totalCount = dialogues.length;
    var pct = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;

    h += '<div class="p6-card">';
    h += '  <div class="p6-card-title">📋 对话任务列表';
    h += '    <span class="text-sm text-muted" style="font-weight:400">（' + doneCount + ' / ' + totalCount + ' 完成 · ' + pct + '%）</span>';
    h += '  </div>';

    if(totalCount > 0){
      h += '  <div class="p6-progress-bar"><div class="p6-progress-fill" style="width:' + pct + '%"></div></div>';
    }

    if(!totalCount){
      h += '<div class="p6-empty" style="margin:10px 0">还没有对话计划。选择至少2个账户、设置轮数，点击「生成对话计划」开始。</div>';
    } else {
      // Group by round
      var roundsMap = {};
      dialogues.forEach(function(d){
        if(!roundsMap[d.round]) roundsMap[d.round] = [];
        roundsMap[d.round].push(d);
      });
      var roundNums = Object.keys(roundsMap).sort(function(a,b){ return a - b; });

      roundNums.forEach(function(rn){
        var roundTasks = roundsMap[rn];
        var roundDone = roundTasks.filter(function(d){ return d.status === 'done'; }).length;
        h += '<div class="p6-round-block">';
        h += '  <div class="p6-round-title">第 ' + rn + ' 轮 <small class="text-muted">(' + roundDone + '/' + roundTasks.length + ')</small></div>';
        roundTasks.forEach(function(t){
          h += p6RenderDialogueTask(t);
        });
        h += '</div>';
      });
    }
    h += '</div>';

    return h;
  }

  function p6RenderDialogueTask(t){
    var actionLabel = { send: '📤 发送新邮件', open_star: '⭐ 打开并标星', reply: '↩️ 回复邮件' }[t.actionType] || t.actionType;
    var catLabel = (P6_DIALOGUE_TEMPLATES[t.category] || {}).label || t.category;
    var cls = 'p6-dialogue-item';
    if(t.status === 'done') cls += ' done';

    var h = '<div class="' + cls + '">';
    h += '  <div class="p6-dialogue-head">';
    h += '    <span class="p6-action-badge">' + actionLabel + '</span>';
    h += '    <span class="p6-tag">' + esc(catLabel) + '</span>';
    h += '    <span class="text-sm text-muted" style="margin-left:auto">' + esc(t.direction) + '</span>';
    h += '  </div>';

    if(t.actionType !== 'open_star'){
      h += '  <div class="p6-dialogue-content">';
      h += '    <div class="p6-dialogue-subject">📌 ' + esc(t.suggestedSubject || '(无主题)') + '</div>';
      h += '    <div class="p6-dialogue-body">' + esc(t.suggestedBody || '') + '</div>';
      h += '  </div>';
    } else {
      h += '  <div class="p6-dialogue-hint">💡 提醒：请在 ' + esc(t.fromAccount) + ' 的邮箱客户端中，打开来自 ' + esc(t.toAccount) + ' 的邮件，并标记为重要/星标。</div>';
    }

    h += '  <div class="p6-dialogue-actions">';
    if(t.status === 'done'){
      h += '    <span class="p6-done-badge">✅ 已完成</span>';
    } else {
      h += '    <button class="btn btn-primary" onclick="p6MarkDialogueDone(\'' + t.id + '\')">✓ 标记完成</button>';
      if(t.actionType !== 'open_star'){
        h += '    <button class="btn btn-outline" onclick="p6AiVariant(\'' + t.id + '\')">🤖 AI生成变体</button>';
      }
    }
    h += '  </div>';
    h += '</div>';
    return h;
  }

  // ── Main Page Renderer ────────────────────────────────────
  window.p6RenderDeliverabilityPage = function(root){
    var tab = window._p6DelivTab || 'esp';

    // Top stats
    var accounts = S.emailAccounts || [];
    var rep = p6ComputeEspReputation();

    // Average deliverability score across accounts with reports
    var scores = [];
    accounts.forEach(function(a){
      var r = window.p6GetAccountHealth(a.id);
      if(r && r.result && typeof r.result.score === 'number') scores.push(r.result.score);
    });
    var avgScore = scores.length ? Math.round(scores.reduce(function(a,b){ return a+b; },0) / scores.length) : '—';

    var bestEsp  = rep.best  ? rep.best.esp  : '—';
    var worstEsp = rep.worst ? rep.worst.esp : '—';

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">📬 送达率与邮箱健康</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">ESP 信誉分析 · SPF/DKIM/DMARC 体检 · 多轮预热对话模拟</div></div>';
    h += '</div>';

    // Top stat row
    h += '<div class="p6-stats">';
    h += '  <div class="p6-stat"><div class="p6-stat-num">' + accounts.length + '</div><div class="p6-stat-lbl">邮箱账户</div></div>';
    h += '  <div class="p6-stat"><div class="p6-stat-num">' + avgScore + '</div><div class="p6-stat-lbl">平均体检分</div></div>';
    h += '  <div class="p6-stat"><div class="p6-stat-num" style="color:#38a169">' + esc(bestEsp) + '</div><div class="p6-stat-lbl">最佳 ESP</div></div>';
    h += '  <div class="p6-stat"><div class="p6-stat-num" style="color:#e53e3e">' + esc(worstEsp) + '</div><div class="p6-stat-lbl">最差 ESP</div></div>';
    h += '</div>';

    // Tab bar
    h += '<div class="p6-tabs">';
    h += p6TabBtn('esp',       '📊 ESP 信誉',       tab);
    h += p6TabBtn('healthCheck', '🩺 送达体检',      tab);
    h += p6TabBtn('warmupDialogue', '💬 预热对话',   tab);
    h += '</div>';

    // Tab content
    if(tab === 'healthCheck')      h += p6RenderHealthTab();
    else if(tab === 'warmupDialogue') h += p6RenderWarmupTab();
    else                              h += p6RenderEspTab();

    root.innerHTML = h;
  };

  window.p6SetDelivTab = function(t){ window._p6DelivTab = t; renderView(); };

  function p6TabBtn(key, label, cur){
    return '<div class="p6-tab' + (cur === key ? ' on' : '') + '" onclick="p6SetDelivTab(\'' + key + '\')">' + label + '</div>';
  }

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'deliverability'){
      window.p6RenderDeliverabilityPage(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p6- prefixed, responsive) ─────────────────
  var style = document.createElement('style');
  style.textContent = ''
    // Stats row
    + '.p6-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}'
    + '.p6-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.p6-stat-num{font-size:24px;font-weight:700;color:#2d3748;}'
    + '.p6-stat-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    // Tabs
    + '.p6-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}'
    + '.p6-tab{padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;color:#4a5568;}'
    + '.p6-tab.on{background:#3182ce;color:#fff;border-color:#3182ce;font-weight:600;}'
    // Cards
    + '.p6-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:14px;}'
    + '.p6-card-title{font-size:15px;font-weight:700;color:#2d3748;margin-bottom:10px;}'
    + '.p6-empty{padding:30px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;margin:10px 0;}'
    // Tags & badges
    + '.p6-tag{font-size:11px;padding:2px 8px;border-radius:10px;background:#edf2f7;color:#4a5568;}'
    + '.p6-tag.gold{background:#f6e05e;color:#744210;}'
    + '.p6-tag.red{background:#fed7d7;color:#9b2c2c;}'
    + '.p6-badge{font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600;color:#fff;}'
    + '.p6-pass{background:#38a169;}'
    + '.p6-warn{background:#d69e2e;}'
    + '.p6-fail{background:#e53e3e;}'
    + '.p6-none{background:#a0aec0;}'
    // ESP cards
    + '.p6-esp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:14px;}'
    + '.p6-esp-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;border-top:4px solid #cbd5e0;}'
    + '.p6-esp-card.best{border-top-color:#38a169;box-shadow:0 0 0 2px #c6f6d5;}'
    + '.p6-esp-card.worst{border-top-color:#e53e3e;box-shadow:0 0 0 2px #fed7d7;}'
    + '.p6-esp-name{font-size:15px;font-weight:700;color:#2d3748;margin-bottom:10px;}'
    + '.p6-esp-metrics{display:flex;justify-content:space-around;margin-bottom:10px;}'
    + '.p6-esp-metrics div{text-align:center;}'
    + '.p6-esp-num{display:block;font-size:20px;font-weight:700;color:#2d3748;}'
    + '.p6-esp-lbl{font-size:11px;color:#718096;}'
    + '.p6-esp-rates{font-size:12px;color:#4a5568;border-top:1px solid #edf2f7;padding-top:8px;display:flex;justify-content:space-around;}'
    // Table
    + '.p6-table{width:100%;border-collapse:collapse;font-size:13px;}'
    + '.p6-table th{background:#f7fafc;padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0;color:#4a5568;font-weight:600;}'
    + '.p6-table td{padding:8px 10px;border-bottom:1px solid #edf2f7;}'
    // Suggestion box
    + '.p6-suggestion{background:#ebf8ff;border:1px solid #90cdf4;border-radius:10px;padding:14px;margin-top:14px;}'
    + '.p6-suggestion-title{font-weight:700;color:#2c5282;margin-bottom:6px;}'
    + '.p6-suggestion p{margin:4px 0;font-size:13px;color:#2d3748;}'
    // Health cards
    + '.p6-health-list{display:flex;flex-direction:column;gap:12px;}'
    + '.p6-health-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;border-left:4px solid #cbd5e0;}'
    + '.p6-health-card.ok{border-left-color:#38a169;}'
    + '.p6-health-card.warn{border-left-color:#d69e2e;}'
    + '.p6-health-card.bad{border-left-color:#e53e3e;}'
    + '.p6-health-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;}'
    + '.p6-health-email{font-size:14px;font-weight:700;color:#2d3748;}'
    + '.p6-health-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.p6-health-score{font-size:20px;font-weight:700;}'
    + '.p6-health-pending{color:#a0aec0;font-size:13px;padding:10px;background:#f7fafc;border-radius:6px;text-align:center;}'
    + '.p6-checks-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}'
    + '.p6-check-item{background:#f7fafc;border-radius:8px;padding:10px 12px;border-left:3px solid #cbd5e0;}'
    + '.p6-check-item.ok{border-left-color:#38a169;}'
    + '.p6-check-item.warn{border-left-color:#d69e2e;}'
    + '.p6-check-item.bad{border-left-color:#e53e3e;}'
    + '.p6-check-head{font-size:13px;margin-bottom:4px;}'
    + '.p6-check-detail{font-size:12px;color:#718096;margin-bottom:4px;}'
    + '.p6-check-fix{font-size:12px;color:#c05621;background:#fffaf0;padding:6px 8px;border-radius:4px;margin-top:4px;}'
    // Warmup dialogue
    + '.p6-field{margin-bottom:14px;}'
    + '.p6-field label{display:block;font-size:13px;font-weight:600;color:#2d3748;margin-bottom:6px;}'
    + '.p6-check-list{display:flex;flex-direction:column;gap:6px;}'
    + '.p6-check{display:flex;align-items:center;gap:6px;font-size:13px;color:#4a5568;cursor:pointer;}'
    + '.p6-slider{width:100%;margin-top:6px;}'
    + '.p6-progress-bar{background:#edf2f7;border-radius:10px;height:10px;overflow:hidden;margin:10px 0;}'
    + '.p6-progress-fill{background:#3182ce;height:100%;transition:width .3s;}'
    + '.p6-round-block{margin-bottom:14px;}'
    + '.p6-round-title{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #edf2f7;}'
    + '.p6-dialogue-item{background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px;}'
    + '.p6-dialogue-item.done{opacity:.55;}'
    + '.p6-dialogue-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}'
    + '.p6-action-badge{font-size:12px;font-weight:600;padding:3px 10px;border-radius:10px;background:#bee3f8;color:#2a4365;}'
    + '.p6-dialogue-content{background:#fff;border-radius:6px;padding:10px;margin-bottom:8px;border:1px solid #e2e8f0;}'
    + '.p6-dialogue-subject{font-weight:600;font-size:13px;color:#2d3748;margin-bottom:4px;}'
    + '.p6-dialogue-body{font-size:12.5px;color:#4a5568;white-space:pre-wrap;}'
    + '.p6-dialogue-hint{font-size:12.5px;color:#718096;background:#fffbeb;border:1px solid #fbd38d;padding:8px 10px;border-radius:6px;margin-bottom:8px;}'
    + '.p6-dialogue-actions{display:flex;gap:6px;align-items:flex-end;}'
    + '.p6-done-badge{font-size:13px;font-weight:600;color:#38a169;}'
    // Responsive
    + '@media (max-width:768px){'
    + '  .p6-stats{grid-template-columns:repeat(2,1fr);}'
    + '  .p6-esp-grid{grid-template-columns:1fr;}'
    + '  .p6-checks-grid{grid-template-columns:1fr;}'
    + '  .p6-health-head{flex-direction:column;align-items:flex-start;}'
    + '  .p6-table{font-size:12px;}'
    + '  .p6-table th,.p6-table td{padding:6px 6px;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
