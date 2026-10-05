/* ============================================================
 * P6 Phase6 Module: Customer Intelligence Workbench
 * ----------------------------------------------------------------
 * Feature 10: Customer AI one-page briefing (背调一页纸)
 * Feature 15: Unified cross-channel customer timeline
 * Feature 17: Lead score trace (为什么这么评)
 *
 * HARD RULE: This module NEVER sends any email / WhatsApp message.
 * Briefing generation, timeline aggregation and score trace are all
 * read-only / analyze-only. No outbound action is triggered here.
 *
 * All new CSS classes use the p6- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  if(!Array.isArray(S.p6BriefingHistory)) S.p6BriefingHistory = [];
  if(!S.p6ScoreTraceCache) S.p6ScoreTraceCache = {};

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'customerIntel',
    icon: '🔍',
    label: '客户背调',
    title: '客户背调与智能分析',
    crumb: '一页纸背调 · 跨渠道时间线 · 评分溯源'
  });

  // ── Local helpers ──────────────────────────────────────────
  function p6NowISO(){ return new Date().toISOString(); }

  // Normalize any timestamp (ISO string or epoch number) to epoch ms
  function p6TS(v){
    if(!v) return 0;
    if(typeof v === 'number') return v;
    var t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }

  function p6FmtDate(ts){
    var d = new Date(ts);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p6FmtTime(ts){
    var d = new Date(ts);
    if(isNaN(d.getTime())) return '—';
    return p6FmtDate(ts)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  function p6FindCustomer(id){
    return (S.customers||[]).find(function(x){ return x.id === id; }) || null;
  }

  // Robust JSON extraction from AI response (may be wrapped in ```json ...```)
  function p6ParseAIJSON(content){
    if(!content) return null;
    try{
      var m = content.match(/```json\s*([\s\S]*?)```/);
      if(m && m[1]) return JSON.parse(m[1]);
      m = content.match(/\{[\s\S]*\}/);
      if(m) return JSON.parse(m[0]);
      return null;
    }catch(e){
      console.warn('[p6] AI JSON parse failed:', e, content);
      return null;
    }
  }

  // Channel meta: icon + label
  var P6_CHANNEL = {
    email:    {icon:'📧', label:'邮件'},
    whatsapp: {icon:'💬', label:'WhatsApp'},
    call:     {icon:'📞', label:'电话'},
    meeting:  {icon:'🤝', label:'会议'},
    social:   {icon:'💼', label:'社媒'},
    other:    {icon:'🔗', label:'其他'}
  };

  function p6ChannelFromType(type){
    if(type==='email' || type==='followup') return 'email';
    if(type==='whatsapp') return 'whatsapp';
    if(type==='call' || type==='phone') return 'call';
    if(type==='meeting') return 'meeting';
    if(type==='linkedin' || type==='social') return 'social';
    return 'other';
  }

  // Adopt routeParams exactly once per navigation entry, so that the user's
  // later manual tab/customer picks are not overwritten on every re-render.
  function p6AdoptRoute(){
    if(typeof routeParams === 'undefined' || !routeParams) return;
    if(routeParams.customerId && routeParams.customerId !== window._p6AdoptedCust){
      window._p6CustomerId = routeParams.customerId;
      window._p6AdoptedCust = routeParams.customerId;
    }
    if(routeParams.tab && routeParams.tab !== window._p6AdoptedTab){
      window._p6IntelTab = routeParams.tab;
      window._p6AdoptedTab = routeParams.tab;
    }
  }

  // Resolve the currently selected customer id
  function p6ResolveCustomerId(){
    var list = S.customers || [];
    if(window._p6CustomerId && p6FindCustomer(window._p6CustomerId)){
      return window._p6CustomerId;
    }
    if(list.length){
      window._p6CustomerId = list[0].id;
      return list[0].id;
    }
    return null;
  }

  // Resolve active tab
  function p6ResolveTab(){
    var t = window._p6IntelTab || 'briefing';
    if(['briefing','timeline','scoreTrace'].indexOf(t) < 0) t = 'briefing';
    return t;
  }

  // ============================================================
  // Feature 10: Customer AI one-page briefing
  // ============================================================
  function p6FindWebsiteEvidences(c){
    var site = (c.website||'').replace(/^https?:\/\//,'').replace(/^www\./,'').toLowerCase();
    return (S.websiteEvidences||[]).filter(function(e){
      if(e.customerId && e.customerId === c.id) return true;
      if(site && e.finalUrl && e.finalUrl.toLowerCase().indexOf(site) >= 0) return true;
      if(site && e.sourceUrl && e.sourceUrl.toLowerCase().indexOf(site) >= 0) return true;
      return false;
    });
  }

  function p6BuildBriefingPrompt(c){
    var cf = S.companyFacts || {};
    var evs = p6FindWebsiteEvidences(c).slice(0,3);
    var evText = evs.map(function(e){
      return '- '+(e.pageTitle||e.finalUrl||'')
        + ' | 产品: '+((e.detectedProducts||[]).join(', ')||'—')
        + ' | 市场: '+((e.detectedMarkets||[]).join(', ')||'—')
        + ' | 摘要: '+((e.excerpt||'').slice(0,150)||'—');
    }).join('\n');

    return '你是资深B2B外贸客户背调分析师。请根据以下客户信息生成一页纸客户背调，输出严格JSON。\n'
      + '客户公司：'+(c.company||'')+'\n'
      + '国家/地区：'+(c.country||'')+' '+(c.city||'')+'\n'
      + '官网：'+(c.website||'')+'\n'
      + '客户类型：'+(c.customerType||'')+'\n'
      + '主营/采购品类：'+(c.productCategory||c.products||'')+'\n'
      + '获客来源：'+(c.source||'')+'\n'
      + '联系人：'+((c.contact&&c.contact.name)||'')+' / '+((c.contact&&c.contact.title)||'')+'\n'
      + 'LinkedIn：'+((c.contact&&c.contact.linkedin)||'')+'\n'
      + '官网采集证据：\n'+(evText||'(无)')+'\n'
      + '我方公司：'+(cf.brandName||cf.companyName||'KaiLionCrafts')
        + '，主营品类：'+((cf.categories||[]).join('、')||'刀剪厨具')+'\n'
      + '\n输出JSON结构（缺项填空字符串，数组空则[]）：\n'
      + '{\n'
      + '  "summary":"一句话总体判断（50字内）",\n'
      + '  "companyBasics":{"industry":"所属行业","sizeEstimate":"规模推测","market":"目标市场","website":"官网链接"},\n'
      + '  "decisionMaker":{"name":"姓名","title":"职位","background":"背景线索","linkedin":"LinkedIn链接"},\n'
      + '  "procurementSignals":{"likelyProcure":"是/可能/不确定","evidence":"采购信号依据","detail":"详情说明"},\n'
      + '  "competitors":{"likelySuppliers":["现有/可能供应商1","供应商2"],"note":"AI推测，需验证"},\n'
      + '  "entryPoint":{"angle":"推荐沟通角度","detail":"2-3句切入建议"}\n'
      + '}\n'
      + '要求：竞品与供应商信息必须基于行业+地区合理推测并标注为AI推测；只输出JSON，不要任何额外文字。';
  }

  window.p6GenerateBriefing = async function(cid){
    cid = cid || window._p6CustomerId;
    var c = p6FindCustomer(cid);
    if(!c){ toast('未找到客户', 'err'); return; }

    toast('AI正在生成「'+(c.company||'')+'」背调一页纸...');
    try{
      var r = await callAI(
        [{ role:'user', content: p6BuildBriefingPrompt(c) }],
        { purpose:'customerBriefing', timeout:60000, temperature:0.3, model:'gpt-5.6-terra' }
      );
      if(r.error){ toast('AI生成失败：'+(r.error||'未知错误'), 'err'); return; }
      var data = p6ParseAIJSON(r.content);
      if(!data){ toast('AI返回格式异常，无法解析JSON', 'err'); return; }

      c.p6Briefing = {
        generatedAt: p6NowISO(),
        sections: {
          companyBasics:   data.companyBasics || {},
          decisionMaker:    data.decisionMaker || {},
          procurementSignals: data.procurementSignals || {},
          competitors:      data.competitors || {likelySuppliers:[], note:'AI推测，需验证'},
          entryPoint:       data.entryPoint || {}
        },
        summary: data.summary || (data.entryPoint && data.entryPoint.detail) || ''
      };

      S.p6BriefingHistory.push({
        id: uid(),
        customerId: c.id,
        customerName: c.company,
        generatedAt: c.p6Briefing.generatedAt,
        summary: c.p6Briefing.summary
      });

      persist();
      toast('✅ 背调一页纸已生成');
      renderView();
    }catch(e){
      console.warn('[p6] briefing failed:', e);
      toast('生成背调时出错：'+(e.message||e), 'err');
    }
  };

  function p6RenderBriefingTab(c){
    var h = '';
    var b = c.p6Briefing;

    h += '<div class="p6-toolbar">';
    h += '  <button class="btn btn-primary" onclick="p6GenerateBriefing()">'
      + (b ? '🔄 重新生成背调' : '🤖 生成背调一页纸') + '</button>';
    if(b){
      h += '  <button class="btn btn-outline" onclick="window.print()">🖨️ 打印</button>';
      h += '  <span class="p6-gen-time">生成于 ' + p6FmtTime(p6TS(b.generatedAt)) + '</span>';
    }
    h += '</div>';

    if(!b){
      h += '<div class="p6-empty">尚未生成背调。点击上方「生成背调一页纸」，AI 将结合客户资料与官网证据自动输出公司概况、决策人、采购信号、竞品格局与切入建议。</div>';
      return h;
    }

    var s = b.sections || {};
    var db = s.decisionMaker || {};
    var ps = s.procurementSignals || {};
    var cp = s.competitors || {};
    var ep = s.entryPoint || {};
    var cb = s.companyBasics || {};
    var suppliers = Array.isArray(cp.likelySuppliers) ? cp.likelySuppliers : [];

    h += '<div class="p6-print-area">';
    h += '<div class="p6-brief-card">';
    // Header
    h += '  <div class="p6-brief-head">';
    h += '    <div class="p6-brief-co">'+esc(c.company||'未知客户')+'</div>';
    h += '    <div class="p6-brief-sub">'+esc(c.country||'')+(c.website?' · '+esc(c.website):'')+'</div>';
    h += '  </div>';
    if(b.summary){
      h += '  <div class="p6-brief-summary">'+esc(b.summary)+'</div>';
    }

    // Section 1: company basics
    h += '  <div class="p6-sec"><div class="p6-sec-t">🏢 公司概况</div>';
    h += '    <table class="p6-kv"><tbody>'
      + p6KvRow('行业', cb.industry)
      + p6KvRow('规模推测', cb.sizeEstimate)
      + p6KvRow('市场/地区', cb.market || c.country)
      + p6KvRow('官网', cb.website || c.website)
      + p6KvRow('客户类型', c.customerType)
      + '    </tbody></table></div>';

    // Section 2: decision maker
    h += '  <div class="p6-sec"><div class="p6-sec-t">👤 决策人</div>';
    h += '    <table class="p6-kv"><tbody>'
      + p6KvRow('姓名', db.name || (c.contact && c.contact.name))
      + p6KvRow('职位', db.title || (c.contact && c.contact.title))
      + p6KvRow('背景线索', db.background)
      + p6KvRow('LinkedIn', db.linkedin || (c.contact && c.contact.linkedin))
      + '    </tbody></table></div>';

    // Section 3: procurement signals
    h += '  <div class="p6-sec"><div class="p6-sec-t">🎯 采购信号</div>';
    var likelyCls = (ps.likelyProcure==='是')?'p6-tag-pos':(ps.likelyProcure==='不确定'?'p6-tag-mid':'p6-tag-neg');
    h += '    <div class="p6-proc">'
      + '<span class="p6-tag '+likelyCls+'">'+esc(ps.likelyProcure||'待判断')+'</span> '
      + '<span class="p6-proc-ev">'+esc(ps.evidence||'')+'</span></div>';
    if(ps.detail){ h += '    <div class="p6-proc-detail">'+esc(ps.detail)+'</div>'; }
    h += '  </div>';

    // Section 4: competitors (AI-inferred)
    h += '  <div class="p6-sec"><div class="p6-sec-t">🏁 竞品格局 <span class="p6-ai-mark">'+esc(cp.note||'AI推测，需验证')+'</span></div>';
    if(suppliers.length){
      h += '    <ul class="p6-sup-list">';
      suppliers.forEach(function(sp){ h += '<li>'+esc(sp)+'</li>'; });
      h += '    </ul>';
    }else{
      h += '    <div class="text-sm text-muted">暂无足够证据推断现有供应商。</div>';
    }
    h += '  </div>';

    // Section 5: entry point
    h += '  <div class="p6-sec"><div class="p6-sec-t">🚀 切入建议</div>';
    h += '    <div class="p6-angle">'+(ep.angle?('<b>'+esc(ep.angle)+'</b><br>'):'')+esc(ep.detail||'')+'</div>';
    h += '  </div>';

    h += '</div>'; // .p6-brief-card
    h += '</div>'; // .p6-print-area
    return h;
  }

  function p6KvRow(k, v){
    return '<tr><td class="p6-k">' + esc(k) + '</td><td class="p6-v">'
      + (v ? esc(v) : '<span class="text-muted">—</span>') + '</td></tr>';
  }

  // ============================================================
  // Feature 15: Unified cross-channel customer timeline
  // ============================================================
  function p6BuildTimeline(c){
    var items = [];

    // 1) events already on the customer timeline
    (c.timeline||[]).forEach(function(ev){
      items.push({
        channel: p6ChannelFromType(ev.type),
        type: ev.type || '',
        title: ev.title || '',
        detail: ev.detail || '',
        ts: p6TS(ev.timestamp)
      });
    });

    // 2) sent emails (outbound)
    (S.sendRecords||[]).forEach(function(r){
      if(r.customerId !== c.id) return;
      var extra = '';
      if(r.openStatus === 'opened') extra = ' · 客户已打开';
      if(r.clickStatus === 'clicked') extra += (extra?'、':' · ') + '客户已点击链接';
      items.push({
        channel: 'email', type: 'sent',
        title: '开发信已发送：' + (r.subject || '(无主题)'),
        detail: '通过 ' + (r.emailAccountAddress || '邮箱') + extra,
        ts: p6TS(r.sentAt)
      });
    });

    // 3) received replies (inbound)
    (S.inbox||[]).forEach(function(i){
      if(i.customerId !== c.id) return;
      items.push({
        channel: 'email', type: 'received',
        title: '收到回复：' + (i.subject || '(无主题)'),
        detail: (i.body || '').slice(0, 140),
        ts: p6TS(i.receivedAt)
      });
    });

    // 4) WhatsApp records (match by id or company name)
    (S.whatsappRecords||[]).forEach(function(w){
      var match = (w.customerId && w.customerId === c.id)
        || (w.customerName && c.company && w.customerName === c.company);
      if(!match) return;
      items.push({
        channel: 'whatsapp', type: w.replied ? 'replied' : 'sent',
        title: w.replied ? 'WhatsApp 客户回复' : 'WhatsApp 已发送',
        detail: (w.message || '').slice(0, 140),
        ts: p6TS(w.repliedAt || w.sentAt)
      });
    });

    // 5) LinkedIn / social interactions (match flexibly)
    var li = S.linkedin || {};
    (li.interactions||[]).forEach(function(x){
      var match = (x.customerId && x.customerId === c.id)
        || (x.customerName && c.company && x.customerName === c.company)
        || (x.company && c.company && x.company === c.company);
      if(!match) return;
      items.push({
        channel: 'social', type: 'linkedin',
        title: x.title || x.type || 'LinkedIn 互动',
        detail: x.detail || x.note || '',
        ts: p6TS(x.timestamp || x.createdAt || x.time)
      });
    });

    // newest first
    items.sort(function(a,b){ return b.ts - a.ts; });
    return items;
  }

  function p6RenderTimelineTab(c){
    var filter = window._p6ChannelFilter || 'all';
    var all = p6BuildTimeline(c);
    var items = filter === 'all' ? all : all.filter(function(x){ return x.channel === filter; });

    var h = '';
    h += '<div class="p6-filter-bar">';
    h += p6FilterBtn('all', '全部', filter, all.length);
    h += p6FilterBtn('email', '邮件', filter, all.filter(function(x){return x.channel==='email';}).length);
    h += p6FilterBtn('whatsapp', 'WhatsApp', filter, all.filter(function(x){return x.channel==='whatsapp';}).length);
    h += p6FilterBtn('call', '电话', filter, all.filter(function(x){return x.channel==='call';}).length);
    h += p6FilterBtn('meeting', '会议', filter, all.filter(function(x){return x.channel==='meeting';}).length);
    h += p6FilterBtn('social', '社媒', filter, all.filter(function(x){return x.channel==='social';}).length);
    h += '</div>';

    if(!items.length){
      h += '<div class="p6-empty">该客户暂无' + (filter==='all'?'':'「'+(P6_CHANNEL[filter]?P6_CHANNEL[filter].label:'')+'」') + '跨渠道记录。发送邮件、WhatsApp 或记录电话/会议后会自动汇总到这里。</div>';
      return h;
    }

    h += '<div class="p6-tl">';
    items.forEach(function(it){
      var ch = P6_CHANNEL[it.channel] || P6_CHANNEL.other;
      h += '<div class="p6-tl-item">';
      h += '  <div class="p6-tl-icon">' + ch.icon + '</div>';
      h += '  <div class="p6-tl-body">';
      h += '    <div class="p6-tl-title"><span class="p6-ch-tag">' + ch.label + '</span> ' + esc(it.title) + '</div>';
      if(it.detail){ h += '    <div class="p6-tl-detail">' + esc(it.detail) + '</div>'; }
      h += '  </div>';
      h += '  <div class="p6-tl-time">' + p6FmtTime(it.ts) + '</div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function p6FilterBtn(key, label, cur, count){
    return '<button class="p6-chip' + (cur===key?' on':'') + '" onclick="p6SetChannel(\''+key+'\')">'
      + label + ' <span class="p6-chip-n">' + (count||0) + '</span></button>';
  }

  window.p6SetChannel = function(ch){ window._p6ChannelFilter = ch; renderView(); };

  // ============================================================
  // Feature 17: Lead score trace
  // ============================================================
  function p6ComputeScore(c, reason){
    var rows = []; // {label, pts, explanation}
    var sent = (S.sendRecords||[]).filter(function(r){ return r.customerId === c.id; });
    var inbox = (S.inbox||[]).filter(function(i){ return i.customerId === c.id; });
    var email = (c.contact && c.contact.email) || '';

    // ── Base: customer type ──
    var ct = c.customerType || '';
    var ctScore, ctNote;
    if(ct==='进口商' || ct==='品牌商' || ct==='分销商'){ ctScore=25; ctNote='渠道型客户，批量采购潜力大'; }
    else if(ct==='电商卖家'){ ctScore=20; ctNote='电商渠道，复购灵活'; }
    else if(ct==='零售商'){ ctScore=15; ctNote='零售端，单量相对较小'; }
    else { ctScore=10; ctNote='客户类型未明确，按基础分'; }
    rows.push({label:'客户类型：' + (ct||'未填写'), pts:ctScore, explanation:ctNote});

    // ── Base: market / country ──
    var country = c.country || '';
    var hiMarkets = ['美国','德国','英国','澳大利亚'];
    var devMarkets = ['加拿大','法国','意大利','西班牙','荷兰','日本','韩国','新加坡','新西兰','瑞典','挪威','丹麦','瑞士','奥地利','比利时'];
    if(hiMarkets.indexOf(country) >= 0){
      rows.push({label:'市场：'+country, pts:10, explanation:'高价值成熟市场，客单价与采购量高'});
    }else if(devMarkets.indexOf(country) >= 0){
      rows.push({label:'市场：'+country, pts:5, explanation:'其他发达市场'});
    }else if(country){
      rows.push({label:'市场：'+country, pts:0, explanation:'新兴/待评估市场，暂不加分'});
    }

    // ── Bonus items ──
    if(c.website){ rows.push({label:'有官方网站', pts:10, explanation:'经营实体可在线核验'}); }
    if(c.contact && c.contact.linkedin){ rows.push({label:'有 LinkedIn', pts:5, explanation:'可做背景调研与触达'}); }
    if(c.contact && c.contact.name && c.contact.title){
      rows.push({label:'决策人明确', pts:10, explanation:'已有姓名+职位，可直接定向沟通'});
    }
    if(c.contact && c.contact.whatsapp){ rows.push({label:'有 WhatsApp', pts:5, explanation:'即时沟通渠道可用'}); }
    if(c.productCategory || c.products){
      rows.push({label:'采购品类明确', pts:5, explanation:'需求清晰，便于匹配产品'});
    }

    // ── Behavior score ──
    var opens = sent.filter(function(r){ return r.openStatus === 'opened'; }).length;
    if(opens > 0){
      var openPts = Math.min(opens*5, 15);
      rows.push({label:'邮件打开 '+opens+' 次', pts:openPts, explanation:'每次打开 +5，上限 15'});
    }
    var clicks = sent.filter(function(r){ return r.clickStatus === 'clicked'; }).length;
    if(clicks > 0){
      var clickPts = Math.min(clicks*8, 16);
      rows.push({label:'链接点击 '+clicks+' 次', pts:clickPts, explanation:'每次点击 +8，上限 16'});
    }
    if(inbox.length > 0){
      rows.push({label:'收到客户回复', pts:20, explanation:'已有双向沟通，意向明确'});
      // fast reply < 24h?
      var fast = false;
      inbox.forEach(function(ib){
        var rt = p6TS(ib.receivedAt);
        sent.forEach(function(s){
          var st = p6TS(s.sentAt);
          if(st && rt && rt >= st && (rt - st) < 24*3600*1000){ fast = true; }
        });
      });
      if(fast){ rows.push({label:'24小时内快速回复', pts:15, explanation:'回复时效高，采购迫切度高'}); }
    }

    // ── Deductions ──
    if(/@(gmail|yahoo|hotmail|outlook|icloud|aol|protonmail)\.com/i.test(email)){
      rows.push({label:'免费邮箱', pts:-10, explanation:'使用 Gmail/Yahoo 等免费邮箱，企业可信度较低'});
    }
    var tempDomains = ['mailinator','tempmail','10minutemail','guerrillamail','throwaway','yopmail','trashmail','fakeinbox','dispostable'];
    var edom = (email.split('@')[1]||'').toLowerCase();
    if(tempDomains.some(function(d){ return edom.indexOf(d) >= 0; })){
      rows.push({label:'临时邮箱域名', pts:-15, explanation:'疑似一次性邮箱，真实性存疑'});
    }
    var li = p6TS(c.lastInteraction) || p6TS(c.createdAt);
    if(li){
      var idleDays = (Date.now() - li) / 86400000;
      if(idleDays >= 30){
        rows.push({label:'30天以上无互动', pts:-10, explanation:'已沉默 '+Math.round(idleDays)+' 天，需重新激活'});
      }
    }
    var unsub = sent.some(function(r){ return r.followUpStatus === 'unsubscribed'; }) || c.status === '退订';
    if(unsub){
      rows.push({label:'已退订', pts:-20, explanation:'客户已退订，禁止继续营销'});
    }

    // ── Finalize ──
    var total = 0;
    rows.forEach(function(r){ total += r.pts; });
    total = Math.max(0, Math.min(100, total));
    var grade = total>=80 ? 'A' : (total>=60 ? 'B' : (total>=40 ? 'C' : 'D'));

    var changed = !c.p6ScoreTrace || c.p6ScoreTrace.final !== total;
    if(changed){
      if(!Array.isArray(c.p6ScoreHistory)) c.p6ScoreHistory = [];
      var last = c.p6ScoreHistory[c.p6ScoreHistory.length-1];
      if(!last || last.score !== total){
        c.p6ScoreHistory.push({date: p6NowISO(), score: total, reason: reason || '评分计算'});
      }
      c.p6ScoreTrace = {final: total, grade: grade, rows: rows, computedAt: p6NowISO()};
      c.leadScore = total;
      persist();
    }
    return c.p6ScoreTrace;
  }

  window.p6RecalcScore = function(){
    var c = p6FindCustomer(window._p6CustomerId);
    if(!c) return;
    p6ComputeScore(c, '手动重新计算');
    toast('评分已重新计算');
    renderView();
  };

  function p6RenderScoreTab(c){
    var trace = p6ComputeScore(c, '页面加载自动计算');
    var h = '';

    // Gauge
    var gCls = 'g-'+trace.grade.toLowerCase();
    h += '<div class="p6-gauge '+gCls+'">';
    h += '  <div class="p6-gauge-num">'+trace.final+'<small>分</small></div>';
    h += '  <div class="p6-gauge-grade">等级 '+trace.grade+'</div>';
    h += '  <div class="p6-gauge-bar"><div class="p6-gauge-fill" style="width:'+trace.final+'%"></div></div>';
    h += '  <button class="btn btn-outline btn-sm" onclick="p6RecalcScore()" style="margin-top:8px">🔄 重新计算</button>';
    h += '</div>';

    // Breakdown table
    h += '<table class="p6-score-table"><thead><tr><th>评分项</th><th style="width:70px;text-align:center">分值</th><th>说明</th></tr></thead><tbody>';
    trace.rows.forEach(function(r){
      var pos = r.pts >= 0;
      h += '<tr>'
        + '<td>'+esc(r.label)+'</td>'
        + '<td style="text-align:center" class="'+(pos?'pos':'neg')+'">'+(pos?'+':'')+r.pts+'</td>'
        + '<td class="text-muted">'+esc(r.explanation||'')+'</td>'
        + '</tr>';
    });
    h += '</tbody><tfoot><tr><td><b>总分（0-100）</b></td><td style="text-align:center"><b>'+trace.final+'</b></td><td>等级 '+trace.grade+'</td></tr></tfoot></table>';

    // History
    var hist = c.p6ScoreHistory || [];
    h += '<div class="p6-sec-t" style="margin:18px 0 8px">📈 评分变化历史（'+hist.length+'）</div>';
    if(!hist.length){
      h += '<div class="text-sm text-muted">暂无评分历史记录。重新计算后若分数变化会自动记录。</div>';
    }else{
      var maxScore = 100;
      h += '<div class="p6-hist">';
      hist.slice().reverse().forEach(function(it){
        var w = Math.max(4, Math.round((it.score||0)/maxScore*100));
        h += '<div class="p6-hist-row">'
          + '<div class="p6-hist-label">'+p6FmtDate(p6TS(it.date))+'</div>'
          + '<div class="p6-hist-bar"><div class="p6-hist-fill" style="width:'+w+'%"></div></div>'
          + '<div class="p6-hist-score">'+it.score+'分</div>'
          + '<div class="p6-hist-reason">'+esc(it.reason||'')+'</div>'
          + '</div>';
      });
      h += '</div>';
    }
    return h;
  }

  // ============================================================
  // Main View
  // ============================================================
  function p6RenderIntelPage(root){
    p6AdoptRoute();
    var cid = p6ResolveCustomerId();
    var tab = p6ResolveTab();
    var customers = S.customers || [];

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">🔍 客户背调与智能分析</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">AI一页纸背调 · 跨渠道统一时间线 · 评分溯源</div></div>';
    h += '</div>';

    // Customer selector
    h += '<div class="p6-selector">';
    h += '  <label class="p6-sel-label">选择客户：</label>';
    h += '  <select class="p6-sel" onchange="p6SelectCustomer(this.value)">';
    customers.forEach(function(c){
      var sel = (c.id === cid) ? ' selected' : '';
      h += '<option value="'+esc(c.id)+'"'+sel+'>'+esc(c.company||('未知客户 '+c.id))+'（'+esc(c.country||'')+'）</option>';
    });
    h += '  </select>';
    h += '</div>';

    if(!cid){
      h += '<div class="p6-empty">客户台账为空，请先添加客户。</div>';
      root.innerHTML = h;
      return;
    }
    var c = p6FindCustomer(cid);

    // Tabs
    h += '<div class="p6-tabs">';
    h += p6TabBtn('briefing', '📄 背调一页纸', tab);
    h += p6TabBtn('timeline', '🕒 跨渠道时间线', tab);
    h += p6TabBtn('scoreTrace', '🧮 评分溯源', tab);
    h += '</div>';

    if(tab === 'timeline')      h += p6RenderTimelineTab(c);
    else if(tab === 'scoreTrace') h += p6RenderScoreTab(c);
    else                          h += p6RenderBriefingTab(c);

    root.innerHTML = h;
  }

  window.p6SelectCustomer = function(cid){
    window._p6CustomerId = cid;
    renderView();
  };

  window.p6SetIntelTab = function(t){ window._p6IntelTab = t; renderView(); };

  function p6TabBtn(key, label, cur){
    return '<div class="p6-tab'+(cur===key?' on':'')+'" onclick="p6SetIntelTab(\''+key+'\')">'+label+'</div>';
  }

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'customerIntel'){
      p6RenderIntelPage(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p6- prefixed, responsive + print-friendly) ──
  var style = document.createElement('style');
  style.textContent = ''
    + '.p6-empty{padding:36px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.p6-selector{display:flex;align-items:center;gap:10px;margin-bottom:16px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;}'
    + '.p6-sel-label{font-size:13px;color:#4a5568;font-weight:600;}'
    + '.p6-sel{flex:1;max-width:420px;padding:7px 10px;border:1px solid #cbd5e0;border-radius:8px;font-size:13px;background:#fff;}'
    + '.p6-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}'
    + '.p6-tab{padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;color:#4a5568;}'
    + '.p6-tab.on{background:#805ad5;color:#fff;border-color:#805ad5;font-weight:600;}'
    + '.p6-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;}'
    + '.p6-gen-time{font-size:12px;color:#a0aec0;}'
    // Briefing card
    + '.p6-brief-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px 26px;max-width:820px;box-shadow:0 1px 3px rgba(0,0,0,.04);}'
    + '.p6-brief-head{border-bottom:2px solid #2d3748;padding-bottom:10px;margin-bottom:10px;}'
    + '.p6-brief-co{font-size:22px;font-weight:700;color:#1a202c;}'
    + '.p6-brief-sub{font-size:13px;color:#718096;margin-top:2px;}'
    + '.p6-brief-summary{background:#ebf8ff;border-left:3px solid #3182ce;padding:8px 12px;font-size:13px;color:#2a4365;border-radius:4px;margin:10px 0;}'
    + '.p6-sec{margin-top:16px;}'
    + '.p6-sec-t{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:8px;}'
    + '.p6-ai-mark{font-size:11px;font-weight:400;color:#c05621;background:#fffaf0;padding:2px 8px;border-radius:8px;margin-left:6px;}'
    + '.p6-kv{width:100%;border-collapse:collapse;font-size:13px;}'
    + '.p6-kv td{padding:5px 8px;border-bottom:1px solid #edf2f7;}'
    + '.p6-kv td.p6-k{width:120px;color:#718096;}'
    + '.p6-kv td.p6-v{color:#2d3748;}'
    + '.p6-proc{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.p6-tag{font-size:12px;font-weight:600;padding:2px 10px;border-radius:10px;}'
    + '.p6-tag-pos{background:#f0fff4;color:#22543d;}'
    + '.p6-tag-mid{background:#fffaf0;color:#c05621;}'
    + '.p6-tag-neg{background:#fff5f5;color:#c53030;}'
    + '.p6-proc-ev{font-size:13px;color:#2d3748;}'
    + '.p6-proc-detail{font-size:12.5px;color:#718096;margin-top:6px;}'
    + '.p6-sup-list{margin:6px 0 0;padding-left:20px;font-size:13px;color:#2d3748;}'
    + '.p6-angle{background:#f7fafc;border-radius:8px;padding:10px 12px;font-size:13px;color:#2d3748;line-height:1.6;}'
    // Timeline
    + '.p6-filter-bar{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;}'
    + '.p6-chip{padding:5px 12px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;font-size:12.5px;cursor:pointer;color:#4a5568;}'
    + '.p6-chip.on{background:#3182ce;color:#fff;border-color:#3182ce;}'
    + '.p6-chip-n{opacity:.7;font-size:11px;}'
    + '.p6-tl{display:flex;flex-direction:column;gap:8px;}'
    + '.p6-tl-item{display:flex;align-items:flex-start;gap:12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;}'
    + '.p6-tl-icon{font-size:18px;flex-shrink:0;}'
    + '.p6-tl-body{flex:1;min-width:0;}'
    + '.p6-tl-title{font-size:13.5px;color:#2d3748;}'
    + '.p6-ch-tag{font-size:11px;background:#edf2f7;color:#4a5568;padding:1px 8px;border-radius:8px;margin-right:6px;}'
    + '.p6-tl-detail{font-size:12.5px;color:#718096;margin-top:3px;white-space:pre-wrap;}'
    + '.p6-tl-time{font-size:11.5px;color:#a0aec0;white-space:nowrap;}'
    // Score trace
    + '.p6-gauge{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;margin-bottom:16px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;}'
    + '.p6-gauge-num{font-size:40px;font-weight:700;line-height:1;}'
    + '.p6-gauge-num small{font-size:16px;color:#a0aec0;}'
    + '.p6-gauge.g-a .p6-gauge-num{color:#38a169;}'
    + '.p6-gauge.g-b .p6-gauge-num{color:#3182ce;}'
    + '.p6-gauge.g-c .p6-gauge-num{color:#d69e2e;}'
    + '.p6-gauge.g-d .p6-gauge-num{color:#e53e3e;}'
    + '.p6-gauge-grade{font-size:14px;color:#4a5568;}'
    + '.p6-gauge-bar{flex:1;min-width:160px;height:10px;background:#edf2f7;border-radius:5px;overflow:hidden;}'
    + '.p6-gauge-fill{height:100%;background:linear-gradient(90deg,#48bb78,#38a169);}'
    + '.p6-score-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:13px;}'
    + '.p6-score-table th,.p6-score-table td{padding:8px 12px;border-bottom:1px solid #edf2f7;text-align:left;}'
    + '.p6-score-table th{background:#f7fafc;color:#4a5568;font-weight:600;}'
    + '.p6-score-table td.pos{color:#38a169;font-weight:700;}'
    + '.p6-score-table td.neg{color:#e53e3e;font-weight:700;}'
    + '.p6-score-table tfoot td{background:#f7fafc;font-weight:600;}'
    + '.p6-hist{display:flex;flex-direction:column;gap:8px;}'
    + '.p6-hist-row{display:flex;align-items:center;gap:10px;font-size:12.5px;}'
    + '.p6-hist-label{width:90px;color:#718096;flex-shrink:0;}'
    + '.p6-hist-bar{flex:1;height:12px;background:#edf2f7;border-radius:6px;overflow:hidden;}'
    + '.p6-hist-fill{height:100%;background:#805ad5;}'
    + '.p6-hist-score{width:44px;text-align:right;font-weight:700;color:#4a5568;}'
    + '.p6-hist-reason{width:140px;color:#a0aec0;font-size:11.5px;}'
    // Responsive
    + '@media (max-width:768px){'
    + '  .p6-selector{flex-direction:column;align-items:stretch;}'
    + '  .p6-sel{max-width:100%;}'
    + '  .p6-brief-card{padding:16px;}'
    + '  .p6-tl-item{flex-wrap:wrap;}'
    + '  .p6-tl-time{width:100%;}'
    + '  .p6-gauge{flex-direction:column;align-items:flex-start;}'
    + '  .p6-hist-reason{display:none;}'
    + '  .p6-score-table{font-size:12px;}'
    + '}'
    // Print: only show the briefing card
    + '@media print{'
    + '  body *{visibility:hidden;}'
    + '  .p6-print-area, .p6-print-area *{visibility:visible;}'
    + '  .p6-print-area{position:absolute;left:0;top:0;width:100%;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
