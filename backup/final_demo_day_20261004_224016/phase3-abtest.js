/* ============================================================
 * P3 Phase3: A/B Testing Module (开发信 A/B 测试)
 * ----------------------------------------------------------------
 * - Pure frontend module, loaded AFTER app.js.
 * - Builds two draft versions (A/B), randomly assigns customers 50/50,
 *   tracks open / click / reply rates, runs a two-proportion Z-test,
 *   and lets the user promote a winning version as a reusable template.
 * - HARD RULE: this module NEVER sends email. It only generates drafts
 *   (status '待检查') that the user reviews and sends manually.
 * - All new CSS classes use the p3- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ────────────────────────────────────────────
  if(!S.abTests) S.abTests = [];

  // Category ids mirror the global P2 category dictionary.
  var P3_CATS = [
    {id:'outdoor_knives',        label:'户外刀'},
    {id:'kitchen_knives',        label:'厨房刀'},
    {id:'professional_scissors', label:'剪刀'},
    {id:'kitchen_accessories',   label:'厨房用品'}
  ];
  // Customer status values that make sense for cold-outreach testing.
  // '待联系' is treated as the "new customer" bucket.
  var P3_STATUSES = [
    {id:'待联系', label:'新客户（待联系）'},
    {id:'跟进中', label:'跟进中'}
  ];

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({key:'abTests', icon:'🧪', label:'A/B测试', title:'开发信A/B测试', crumb:'版本对比 · 数据追踪 · 优胜劣汰'});

  // ── Local helpers ──────────────────────────────────────────
  function p3NowISO(){ return new Date().toISOString(); }

  function p3FmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    var m = String(d.getMonth()+1).padStart(2,'0');
    var day = String(d.getDate()).padStart(2,'0');
    return d.getFullYear()+'-'+m+'-'+day;
  }

  function p3CatLabel(catId){
    for(var i=0;i<P3_CATS.length;i++) if(P3_CATS[i].id===catId) return P3_CATS[i].label;
    return catId==='all' ? '全部品类' : (catId || '全部');
  }

  function p3StatusBadge(st){
    var map = {
      draft:    {t:'草稿',   c:'#718096'},
      running:  {t:'进行中', c:'#3182ce'},
      completed:{t:'已结束', c:'#38a169'}
    };
    var m = map[st] || {t:st, c:'#999'};
    return '<span class="p3-badge" style="background:'+m.c+'">'+m.t+'</span>';
  }

  // Resolve which customers match a test's filter AND have a usable email.
  function p3MatchCustomers(catFilter, statuses){
    var list = S.customers || [];
    return list.filter(function(c){
      var cat = normalizeCatId(c.productCategory);
      if(catFilter && catFilter !== 'all' && cat !== catFilter) return false;
      if(statuses && statuses.length){
        if(statuses.indexOf(c.status) === -1) return false;
      }
      // A draft is only useful when the customer has a primary email.
      return !!getCustomerPrimaryEmail(c);
    });
  }

  function p3FindTest(id){
    for(var i=0;i<S.abTests.length;i++) if(S.abTests[i].id===id) return S.abTests[i];
    return null;
  }

  // Find the most recent send record for a customer that happened
  // AFTER the test started (fallback attribution when sendRecords
  // do not carry an explicit abTestId).
  function p3CustomerSend(test, customerId){
    var recs = S.sendRecords || [];
    var started = test.startedAt ? new Date(test.startedAt).getTime() : 0;
    var best = null;
    for(var i=0;i<recs.length;i++){
      var r = recs[i];
      if(r.customerId !== customerId) continue;
      // Prefer records tagged with this test; otherwise fall back to
      // time-window attribution.
      if(r.abTestId && r.abTestId !== test.id) continue;
      var t = r.sentAt ? new Date(r.sentAt).getTime() : 0;
      if(r.abTestId === test.id){ return r; }
      if(t >= started){ if(!best || t > new Date(best.sentAt).getTime()) best = r; }
    }
    return best;
  }

  function p3CustomerReplied(test, customerId){
    var inbox = S.inbox || [];
    var started = test.startedAt ? new Date(test.startedAt).getTime() : 0;
    for(var i=0;i<inbox.length;i++){
      var m = inbox[i];
      if(m.customerId !== customerId) continue;
      var t = m.receivedAt ? new Date(m.receivedAt).getTime() : 0;
      if(t >= started) return true;
    }
    return false;
  }

  // Compute stats for one group. n = actual sends (customers with a
  // qualifying send record), because you can only open/click an email
  // that was actually sent. assigned = eligible customers in the group.
  function p3GroupStats(test, group){
    var asg = (test.assignments||[]).filter(function(a){ return a.group===group; });
    var assigned = asg.length;
    var sent = 0, opens = 0, clicks = 0, replies = 0;
    asg.forEach(function(a){
      var rec = p3CustomerSend(test, a.customerId);
      if(!rec) return;            // not sent yet -> not counted in n
      sent++;
      if(rec.openStatus === 'opened') opens++;
      if(rec.clickStatus === 'clicked') clicks++;
      if(p3CustomerReplied(test, a.customerId)) replies++;
    });
    return {
      assigned: assigned,
      sent: sent,
      opens: opens,
      clicks: clicks,
      replies: replies,
      openRate:  sent ? opens/sent   : 0,
      clickRate: sent ? clicks/sent   : 0,
      replyRate: sent ? replies/sent : 0
    };
  }

  // Two-proportion Z-test on open rate (p<0.05 two-tailed, |z|>=1.96).
  function p3ZTest(sA, sB){
    var nA = sA.sent, nB = sB.sent;
    if(nA < 20 || nB < 20){
      return {
        ok:false,
        reason:'数据不足（每组发送量需 ≥20；当前 A组 '+nA+' / B组 '+nB+'），暂不下结论'
      };
    }
    var xA = sA.opens, xB = sB.opens;
    var pA = xA/nA, pB = xB/nB;
    var p = (xA+xB)/(nA+nB);
    var denom = Math.sqrt(p*(1-p)*(1/nA + 1/nB));
    if(denom === 0){
      return {ok:false, reason:'两组打开数相同，无差异可检验'};
    }
    var z = (pA - pB)/denom;
    var absZ = Math.abs(z);
    var zr = Math.round(z*100)/100;
    if(absZ < 1.96){
      return {ok:false, z:zr, reason:'无显著差异（z='+zr+'，p≥0.05），建议继续收集数据'};
    }
    if(z > 0){
      return {ok:true, z:zr, winner:'A', reason:'A版本打开率显著优于B版本（z='+zr+'，p<0.05）'};
    }
    return {ok:true, z:zr, winner:'B', reason:'B版本打开率显著优于A版本（z='+zr+'，p<0.05）'};
  }

  function p3GetAbStats(testId){
    var test = p3FindTest(testId);
    if(!test) return null;
    var sA = p3GroupStats(test, 'A');
    var sB = p3GroupStats(test, 'B');
    return { test:test, A:sA, B:sB, sig:p3ZTest(sA, sB) };
  }

  function p3Pct(r){ return (r*100).toFixed(1)+'%'; }

  // ── List view ──────────────────────────────────────────────
  window.viewAbTests = function(root){
    var tests = S.abTests || [];
    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">🧪 开发信 A/B 测试</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">测试主题行与正文变体 · 50/50随机分配 · 打开率/点击率/回复率对比 · 统计显著性判断</div></div>';
    h += '  <button class="btn btn-primary" onclick="p3CreateAbTest()">➕ 创建A/B测试</button>';
    h += '</div>';

    if(!tests.length){
      h += '<div class="p3-empty">还没有 A/B 测试。点击右上角「创建A/B测试」开始对比两版开发信的实际效果。</div>';
      root.innerHTML = h;
      return;
    }

    h += '<div class="p3-list">';
    tests.forEach(function(t){
      var st = p3GetAbStats(t.id) || {A:{openRate:0,sent:0,assigned:0}, B:{openRate:0,sent:0,assigned:0}};
      var totalAsg = (t.assignments||[]).length;
      h += '<div class="p3-list-card" onclick="go(\'abTestDetail\',{id:\''+t.id+'\'})">';
      h += '  <div class="p3-list-main">';
      h += '    <div class="p3-list-name">'+esc(t.name)+' '+p3StatusBadge(t.status)+'</div>';
      h += '    <div class="p3-list-meta">品类：'+p3CatLabel(t.category)+' · 创建：'+p3FmtDate(t.createdAt)+' · 分配客户：'+totalAsg+' 人</div>';
      h += '  </div>';
      h += '  <div class="p3-list-rates">';
      h += '    <div class="p3-rate-pill a">A组 打开率 '+p3Pct(st.A.openRate)+' <small>('+st.A.sent+'封已发)</small></div>';
      h += '    <div class="p3-rate-pill b">B组 打开率 '+p3Pct(st.B.openRate)+' <small>('+st.B.sent+'封已发)</small></div>';
      if(t.winner) h += '<div class="p3-winner-tag">🏆 优胜：'+t.winner+'版</div>';
      h += '  </div>';
      h += '</div>';
    });
    h += '</div>';
    root.innerHTML = h;
  };

  // ── Create modal ───────────────────────────────────────────
  window.p3CreateAbTest = function(){
    // Offer historical winners as a starting point for version A.
    var pastWinners = (S.abTests||[]).filter(function(t){ return t.winner && t.versionA && t.versionB; });
    var wh = '<option value="">不基于历史模板</option>';
    pastWinners.forEach(function(t){
      wh += '<option value="'+t.id+'">'+esc(t.name)+'（优胜 '+t.winner+'版）</option>';
    });

    var h = '';
    h += '<div class="modal-head"><h3>创建 A/B 测试</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body" style="max-height:70vh;overflow:auto">';

    h += '<div class="p3-field"><label>测试名称（必填）</label>';
    h += '<input class="form-control" id="p3f_name" placeholder="例如：户外刀开发信主题测试"></div>';

    h += '<div class="p3-field"><label>基于历史优胜版本</label>';
    h += '<select class="form-control" id="p3f_based" onchange="p3ApplyHistoryWinner()"><option value="">不基于历史模板</option>'+wh+'</select></div>';

    h += '<div class="p3-row">';
    h += '  <div class="p3-field"><label>客户品类</label>';
    h += '  <select class="form-control" id="p3f_cat" onchange="p3PreviewCount()">';
    h += '  <option value="all">全部品类</option>';
    P3_CATS.forEach(function(c){ h += '<option value="'+c.id+'">'+c.label+'</option>'; });
    h += '  </select></div>';
    h += '  <div class="p3-field"><label>客户状态</label><div class="p3-checks">';
    P3_STATUSES.forEach(function(s){
      h += '<label class="p3-check"><input type="checkbox" value="'+s.id+'" onchange="p3PreviewCount()"> '+s.label+'</label>';
    });
    h += '  </div><div class="text-sm text-muted">不勾选 = 全部状态</div></div>';
    h += '</div>';

    h += '<div class="p3-count-box">符合条件客户：<b id="p3f_count">0</b> 人（建议 ≥40，每组 ≥20 才有统计意义）</div>';

    h += '<div class="p3-ver-wrap">';
    h += '  <div class="p3-ver-card a">';
    h += '    <div class="p3-ver-title">📨 A 版本（对照）</div>';
    h += '    <input class="form-control" id="p3f_asubj" placeholder="主题行 Subject">';
    h += '    <textarea class="form-control" id="p3f_abody" rows="6" placeholder="开发信正文..."></textarea>';
    h += '  </div>';
    h += '  <div class="p3-ver-card b">';
    h += '    <div class="p3-ver-title">📨 B 版本（变体）</div>';
    h += '    <input class="form-control" id="p3f_bsubj" placeholder="主题行 Subject">';
    h += '    <textarea class="form-control" id="p3f_bbody" rows="6" placeholder="开发信正文..."></textarea>';
    h += '    <button class="btn btn-outline" id="p3f_aibtn" onclick="p3AiGenB()">🤖 AI生成B版本变体</button>';
    h += '  </div>';
    h += '</div>';

    h += '</div>';
    h += '<div class="modal-foot">';
    h += '<button class="btn btn-outline" onclick="closeModal()">取消</button>';
    h += '<button class="btn btn-primary" onclick="p3SaveAbTest()">创建测试</button>';
    h += '</div>';
    openModal(h, true);
    p3PreviewCount();
  };

  // Live-update the matching customer count as filters change.
  window.p3PreviewCount = function(){
    var cat = document.getElementById('p3f_cat').value;
    var sts = [];
    document.querySelectorAll('.p3-check input:checked').forEach(function(cb){ sts.push(cb.value); });
    var n = p3MatchCustomers(cat, sts).length;
    var el = document.getElementById('p3f_count');
    if(el) el.textContent = n;
  };

  // Fill version A (and leave B empty to be derived) from a past winner.
  window.p3ApplyHistoryWinner = function(){
    var id = document.getElementById('p3f_based').value;
    if(!id) return;
    var t = p3FindTest(id);
    if(!t) return;
    var win = t.winner === 'B' ? t.versionB : t.versionA;
    document.getElementById('p3f_asubj').value = win.subject || '';
    document.getElementById('p3f_abody').value  = win.body   || '';
    toast('已载入历史优胜 '+t.winner+'版作为A版本');
  };

  // AI-generate a strategically different B variant from version A.
  window.p3AiGenB = async function(){
    var aSubj = document.getElementById('p3f_asubj').value.trim();
    var aBody = document.getElementById('p3f_abody').value.trim();
    if(!aSubj && !aBody){ toast('请先填写A版本主题或正文','err'); return; }
    var btn = document.getElementById('p3f_aibtn');
    if(btn){ btn.disabled = true; btn.textContent = '🤖 生成中...'; }
    try{
      var prompt = 'You are a B2B cold-outreach copywriter for KaiLionCrafts, a Yangjiang cutlery (knives / scissors / kitchen tools) exporter.\n'
        + 'Based on the version A email below, write a DIFFERENT version B that:\n'
        + '- changes the subject line style (e.g. from a question to a benefit statement, or vice versa),\n'
        + '- shifts the selling-point emphasis (e.g. MOQ/flexibility vs. quality/certification vs. private-label/packaging),\n'
        + '- rephrases the CTA (e.g. "worth a 15-min call" vs "happy to send a spec sheet / sample").\n'
        + 'Keep a professional B2B tone. Do NOT invent numbers, certifications, MOQ, lead times, clients or orders — keep unknowns as "to be confirmed".\n'
        + 'Return STRICT JSON only, no markdown, in this exact shape:\n'
        + '{"subject":"...","body":"..."}\n\n'
        + 'Version A subject: ' + aSubj + '\nVersion A body:\n' + aBody;
      var res = await callAI([{role:'user', content:prompt}], {context:'kaiLionOutbound'});
      var txt = (res && res.content) ? String(res.content) : '';
      if(!txt){ toast('AI未返回内容','err'); return; }
      // Extract the first JSON object from the reply.
      var m = txt.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
      if(!m){ toast('AI返回格式异常，请手动编写B版本','err'); return; }
      var parsed = JSON.parse(m[0]);
      document.getElementById('p3f_bsubj').value = parsed.subject || '';
      document.getElementById('p3f_bbody').value  = parsed.body   || '';
      toast('B版本变体已生成，请检查后再创建');
    }catch(e){
      toast('AI生成失败：'+(e.message||e),'err');
    }finally{
      if(btn){ btn.disabled = false; btn.textContent = '🤖 AI生成B版本变体'; }
    }
  };

  window.p3SaveAbTest = function(){
    var name = document.getElementById('p3f_name').value.trim();
    var cat = document.getElementById('p3f_cat').value;
    var sts = [];
    document.querySelectorAll('.p3-check input:checked').forEach(function(cb){ sts.push(cb.value); });
    var aSubj = document.getElementById('p3f_asubj').value.trim();
    var aBody = document.getElementById('p3f_abody').value.trim();
    var bSubj = document.getElementById('p3f_bsubj').value.trim();
    var bBody = document.getElementById('p3f_bbody').value.trim();

    if(!name){ toast('请填写测试名称','err'); return; }
    if(!aSubj || !aBody){ toast('请填写完整的A版本（主题+正文）','err'); return; }
    if(!bSubj || !bBody){ toast('请填写完整的B版本（主题+正文）','err'); return; }

    var count = p3MatchCustomers(cat, sts).length;
    if(count === 0){ toast('当前筛选没有可分配的客户（需有邮箱）','err'); return; }
    if(count < 40){ toast('提示：符合客户仅 '+count+' 人，建议 ≥40 以保证统计意义，仍可创建','err'); }

    var test = {
      id: 'ab_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      name: name,
      status: 'draft',
      createdAt: p3NowISO(),
      startedAt: null,
      completedAt: null,
      category: cat,
      customerFilter: { statuses: sts, categories: [cat] },
      versionA: { subject: aSubj, body: aBody },
      versionB: { subject: bSubj, body: bBody },
      assignments: [],
      winner: null,
      winnerAppliedAt: null
    };
    S.abTests.unshift(test);
    persist();
    closeModal();
    toast('A/B测试已创建（草稿），进入详情后点击「开始测试」分配客户');
    go('abTestDetail', {id: test.id});
  };

  // ── Random 50/50 assignment + draft generation (NO sending) ─
  window.p3AssignGroup = function(testId){
    var test = p3FindTest(testId);
    if(!test) return;
    if(test.status !== 'draft'){ toast('只有草稿状态的测试可以开始分配','err'); return; }

    var customers = p3MatchCustomers(test.category, test.customerFilter.statuses);
    if(customers.length < 2){ toast('符合条件客户不足，无法分组','err'); return; }

    // Shuffle for a fair random split.
    var pool = customers.slice();
    for(var i=pool.length-1;i>0;i--){
      var j = Math.floor(Math.random()*(i+1));
      var tmp = pool[i]; pool[i]=pool[j]; pool[j]=tmp;
    }

    var assignments = [];
    var now = p3NowISO();
    pool.forEach(function(c, idx){
      // 50/50 via Math.random; odd remainder -> assign to group A.
      var group = (idx === pool.length-1 && pool.length % 2 === 1) ? 'A'
                : (Math.random() < 0.5 ? 'A' : 'B');
      assignments.push({ customerId: c.id, group: group, assignedAt: now });

      // Generate a review draft — the user sends it MANUALLY. No SMTP here.
      var ver = group === 'A' ? test.versionA : test.versionB;
      S.drafts.push({
        id: uid(),
        customerId: c.id,
        customerName: c.company,
        country: c.country || '',
        language: '英语',
        subject: ver.subject,
        body: ver.body,
        aiNotes: ['A/B测试 '+test.name+' · '+group+'版'],
        status: '待检查',
        category: test.category,
        abTestId: test.id,
        abVersion: group,
        createdAt: now,
        sentAt: null
      });
    });

    test.assignments = assignments;
    test.status = 'running';
    test.startedAt = now;
    persist();
    toast('已随机分配 '+pool.length+' 位客户（A组 '+assignments.filter(function(a){return a.group==='A';}).length+' / B组 '+assignments.filter(function(a){return a.group==='B';}).length+'），草稿已生成，请在开发信中人工审核发送');
    renderView();
  };

  // ── Detail view ────────────────────────────────────────────
  window.viewAbTestDetail = function(root){
    var test = p3FindTest(routeParams.id);
    if(!test){ root.innerHTML = '<div class="p3-empty">测试不存在。<button class="btn btn-outline" onclick="go(\'abTests\')">返回列表</button></div>'; return; }
    var st = p3GetAbStats(test.id);
    var sA = st.A, sB = st.B;

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">'+esc(test.name)+' '+p3StatusBadge(test.status)+'</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">品类：'+p3CatLabel(test.category)
        +' · 创建：'+p3FmtDate(test.createdAt)
        +(test.startedAt?' · 开始：'+p3FmtDate(test.startedAt):'')
        +(test.completedAt?' · 结束：'+p3FmtDate(test.completedAt):'')
        +' · 分配客户：'+(test.assignments||[]).length+' 人</div></div>';
    h += '  <div style="display:flex;gap:8px">';
    h += '    <button class="btn btn-outline" onclick="go(\'abTests\')">← 返回列表</button>';
    if(test.status==='draft'){
      h += '    <button class="btn btn-primary" onclick="p3AssignGroup(\''+test.id+'\')">🎲 开始测试并随机分配</button>';
    }
    if(test.status==='running'){
      h += '    <button class="btn btn-outline" onclick="p3CompleteTest(\''+test.id+'\')">🏁 结束测试</button>';
    }
    h += '  </div></div>';

    // ── Version comparison cards ──
    h += '<div class="p3-compare">';
    h += p3CompareCard('A', test.versionA, sA, '#3182ce');
    h += p3CompareCard('B', test.versionB, sB, '#d69e2e');
    h += '</div>';

    // ── Pure-CSS open-rate bar chart ──
    h += '<div class="p3-chart-box">';
    h += '<div class="p3-chart-title">打开率对比</div>';
    h += p3BarRow('A组', sA.openRate, '#3182ce');
    h += p3BarRow('B组', sB.openRate, '#d69e2e');
    h += '</div>';

    // ── Significance verdict ──
    var sigColor = st.sig.ok ? '#38a169' : '#718096';
    h += '<div class="p3-sig" style="border-left-color:'+sigColor+'">';
    h += '  <b>📊 统计判断（打开率 · 双比例Z检验 · p&lt;0.05）：</b> '+esc(st.sig.reason);
    if(st.sig.z) h += ' <span class="text-muted">（z='+st.sig.z+'）</span>';
    h += '</div>';

    // ── Winner buttons ──
    if(test.status !== 'draft'){
      h += '<div class="p3-winner-row">';
      h += '  <span class="text-sm text-muted">将优胜版本保存为推荐模板：</span>';
      h += '  <button class="btn btn-outline" onclick="p3ApplyWinner(\''+test.id+'\',\'A\')">🏆 应用A版本为优胜</button>';
      h += '  <button class="btn btn-outline" onclick="p3ApplyWinner(\''+test.id+'\',\'B\')">🏆 应用B版本为优胜</button>';
      if(test.winner) h += '  <span class="p3-winner-tag">当前优胜：'+test.winner+'版'+(test.winnerAppliedAt?'（'+p3FmtDate(test.winnerAppliedAt)+'）':'')+'</span>';
      h += '</div>';
    }

    // ── Assignment list with A/B tabs ──
    h += '<div class="p3-tabs">';
    h += '  <div class="p3-tab '+((window._p3Tab||'A')==='A'?'on':'')+'" onclick="p3SetTab(\'A\')">A组（'+sA.assigned+'）</div>';
    h += '  <div class="p3-tab '+((window._p3Tab||'A')==='B'?'on':'')+'" onclick="p3SetTab(\'B\')">B组（'+sB.assigned+'）</div>';
    h += '</div>';
    h += p3AssignmentTable(test, window._p3Tab || 'A');

    root.innerHTML = h;
  };

  function p3CompareCard(letter, ver, s, color){
    return '<div class="p3-cmp-card">'+
      '<div class="p3-cmp-head" style="background:'+color+'">'+letter+' 版本</div>'+
      '<div class="p3-cmp-subj">'+esc(ver.subject||'')+'</div>'+
      '<div class="p3-cmp-body">'+esc((ver.body||'').slice(0,160))+((ver.body||'').length>160?'…':'')+'</div>'+
      '<table class="p3-stat-table">'+
      '<tr><td>已分配</td><td>'+s.assigned+' 人</td></tr>'+
      '<tr><td>已发送</td><td>'+s.sent+' 封</td></tr>'+
      '<tr><td>打开 / 打开率</td><td>'+s.opens+' / '+p3Pct(s.openRate)+'</td></tr>'+
      '<tr><td>点击 / 点击率</td><td>'+s.clicks+' / '+p3Pct(s.clickRate)+'</td></tr>'+
      '<tr><td>回复 / 回复率</td><td>'+s.replies+' / '+p3Pct(s.replyRate)+'</td></tr>'+
      '</table></div>';
  }

  function p3BarRow(label, rate, color){
    var pct = Math.round(rate*1000)/10;
    return '<div class="p3-bar-row"><span class="p3-bar-label">'+label+'</span>'+
      '<div class="p3-bar-track"><div class="p3-bar-fill" style="width:'+Math.min(pct,100)+'%;background:'+color+'"></div></div>'+
      '<span class="p3-bar-val">'+pct.toFixed(1)+'%</span></div>';
  }

  window.p3SetTab = function(g){ window._p3Tab = g; renderView(); };

  function p3AssignmentTable(test, group){
    var asg = (test.assignments||[]).filter(function(a){ return a.group===group; });
    if(!asg.length) return '<div class="p3-empty">该组暂无客户。</div>';
    var rows = asg.map(function(a){
      var c = (S.customers||[]).find(function(x){ return x.id===a.customerId; });
      var rec = p3CustomerSend(test, a.customerId);
      var opened = rec && rec.openStatus==='opened';
      var replied = p3CustomerReplied(test, a.customerId);
      return '<tr>'+
        '<td>'+esc(c?c.company:a.customerId)+'</td>'+
        '<td>'+esc(c?(c.country||''):'')+'</td>'+
        '<td>'+(rec?'<span style="color:#38a169">✅ 已发</span>':'<span class="text-muted">未发送</span>')+'</td>'+
        '<td>'+(opened?'<span style="color:#38a169">已打开</span>':'<span class="text-muted">—</span>')+'</td>'+
        '<td>'+(replied?'<span style="color:#3182ce">已回复</span>':'<span class="text-muted">—</span>')+'</td>'+
        '</tr>';
    }).join('');
    return '<table class="p3-asg-table"><thead><tr><th>客户</th><th>国家</th><th>发送</th><th>打开</th><th>回复</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }

  window.p3CompleteTest = function(testId){
    var test = p3FindTest(testId);
    if(!test) return;
    confirmDlg('确定结束该测试吗？结束后将不再统计新数据。', function(){
      test.status = 'completed';
      test.completedAt = p3NowISO();
      persist();
      toast('测试已结束');
      renderView();
    });
  };

  // ── Apply winner as recommended template ──
  window.p3ApplyWinner = function(testId, version){
    var test = p3FindTest(testId);
    if(!test) return;
    confirmDlg('确认将 '+version+' 版本保存为优胜模板？后续创建A/B测试时可基于此模板起步。', function(){
      test.winner = version;
      test.winnerAppliedAt = p3NowISO();
      persist();
      toast('优胜版本（'+version+'版）已保存为推荐模板');
      renderView();
    });
  };

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'abTests'){ window.viewAbTests(document.getElementById('mainContent')); return; }
    if(currentView === 'abTestDetail'){ window.viewAbTestDetail(document.getElementById('mainContent')); return; }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p3- prefixed, responsive) ─────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p3-empty{padding:40px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.p3-list{display:flex;flex-direction:column;gap:10px;}'
    + '.p3-list-card{display:flex;justify-content:space-between;align-items:center;gap:16px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;cursor:pointer;transition:box-shadow .15s;}'
    + '.p3-list-card:hover{box-shadow:0 2px 10px rgba(0,0,0,.08);}'
    + '.p3-list-name{font-weight:600;font-size:15px;display:flex;align-items:center;gap:8px;}'
    + '.p3-list-meta{font-size:12px;color:#718096;margin-top:4px;}'
    + '.p3-list-rates{display:flex;flex-direction:column;gap:4px;align-items:flex-end;}'
    + '.p3-rate-pill{font-size:12px;padding:3px 10px;border-radius:20px;color:#fff;}'
    + '.p3-rate-pill.a{background:#3182ce;}.p3-rate-pill.b{background:#d69e2e;}'
    + '.p3-rate-pill small{opacity:.85;}'
    + '.p3-winner-tag{font-size:12px;color:#38a169;font-weight:600;margin-top:2px;}'
    + '.p3-badge{font-size:11px;color:#fff;padding:2px 8px;border-radius:10px;font-weight:500;}'
    + '.p3-field{margin-bottom:12px;}'
    + '.p3-field label{display:block;font-size:12px;color:#4a5568;margin-bottom:4px;font-weight:600;}'
    + '.p3-row{display:flex;gap:16px;}'
    + '.p3-row>.p3-field{flex:1;}'
    + '.p3-checks{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:4px;}'
    + '.p3-check{font-size:13px;color:#4a5568;display:flex;align-items:center;gap:4px;}'
    + '.p3-count-box{background:#ebf8ff;border:1px solid #bee3f8;border-radius:8px;padding:10px 14px;font-size:13px;margin:8px 0 14px;}'
    + '.p3-ver-wrap{display:flex;gap:14px;}'
    + '.p3-ver-card{flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;}'
    + '.p3-ver-card.a{border-top:3px solid #3182ce;}'
    + '.p3-ver-card.b{border-top:3px solid #d69e2e;}'
    + '.p3-ver-title{font-weight:600;font-size:13px;}'
    + '.p3-compare{display:flex;gap:16px;margin-bottom:16px;}'
    + '.p3-cmp-card{flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;}'
    + '.p3-cmp-head{color:#fff;padding:8px 14px;font-weight:600;}'
    + '.p3-cmp-subj{padding:10px 14px 4px;font-weight:600;font-size:13px;}'
    + '.p3-cmp-body{padding:0 14px 10px;font-size:12px;color:#718096;white-space:pre-wrap;}'
    + '.p3-stat-table{width:100%;border-top:1px solid #e2e8f0;font-size:13px;}'
    + '.p3-stat-table td{padding:7px 14px;border-top:1px solid #edf2f7;}'
    + '.p3-stat-table td:first-child{color:#718096;width:45%;}'
    + '.p3-chart-box{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px;}'
    + '.p3-chart-title{font-weight:600;font-size:13px;margin-bottom:10px;}'
    + '.p3-bar-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;}'
    + '.p3-bar-label{width:40px;font-size:12px;color:#4a5568;}'
    + '.p3-bar-track{flex:1;background:#edf2f7;border-radius:6px;height:16px;overflow:hidden;}'
    + '.p3-bar-fill{height:100%;border-radius:6px;}'
    + '.p3-bar-val{width:55px;font-size:12px;text-align:right;}'
    + '.p3-sig{background:#f7fafc;border-left:4px solid #718096;padding:12px 16px;border-radius:6px;font-size:13px;margin-bottom:16px;}'
    + '.p3-winner-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;}'
    + '.p3-tabs{display:flex;gap:4px;margin-bottom:10px;}'
    + '.p3-tab{padding:6px 16px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;}'
    + '.p3-tab.on{background:#2d3748;color:#fff;border-color:#2d3748;}'
    + '.p3-asg-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;}'
    + '.p3-asg-table th,.p3-asg-table td{padding:8px 12px;border-bottom:1px solid #edf2f7;text-align:left;}'
    + '.p3-asg-table th{background:#f7fafc;color:#4a5568;}'
    + '@media (max-width:768px){'
    + '  .p3-ver-wrap,.p3-compare{flex-direction:column;}'
    + '  .p3-row{flex-direction:column;gap:0;}'
    + '  .p3-list-card{flex-direction:column;align-items:flex-start;}'
    + '  .p3-list-rates{align-items:flex-start;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
