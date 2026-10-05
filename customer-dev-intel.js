/* ============================================================
 * Customer Development Intelligence Workbench (customer-dev-intel.js)
 * ----------------------------------------------------------------
 * Phase 1 of the 外贸客户开发工作台:
 *   Feature 1.2  Enhanced 8-dimension AI customer briefing
 *   Feature 1.3  Customer profiling (intent / type / country tier /
 *                category match / priority score / recommended strategy)
 *   Feature 1.5  Customer information completeness score (0-100)
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp — only drafts content + reminders.
 *   - Fully client-side free implementation, no paid services.
 *   - Does NOT modify any other module. Original p6 briefing untouched.
 *
 * All new CSS classes use the cd- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  if(!Array.isArray(S.cdIntelHistory)) S.cdIntelHistory = [];

  // Make sure every existing customer has the new sub-objects
  (S.customers || []).forEach(function(c){
    if(!c.cdProfile) c.cdProfile = {};
    if(!c.cdCompleteness) c.cdCompleteness = null;
  });

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'customerDevIntel',
    icon: '📋',
    label: '客户背调画像',
    title: 'AI背调 · 客户画像 · 完整度',
    crumb: '8维度背调 · 智能画像 · 信息完整度'
  });

  // ============================================================
  // Local helpers
  // ============================================================
  function cdNowISO(){ return new Date().toISOString(); }

  function cdFmtDate(ts){
    var d = new Date(ts);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function cdFmtTime(ts){
    var d = new Date(ts);
    if(isNaN(d.getTime())) return '—';
    return cdFmtDate(ts)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  function cdFindCustomer(id){
    return (S.customers || []).find(function(x){ return x.id === id; }) || null;
  }

  function cdFindCustomerByName(name){
    if(!name) return null;
    var n = String(name).trim().toLowerCase();
    return (S.customers || []).find(function(x){
      var cn = (x.company || x.name || '').trim().toLowerCase();
      return cn && (cn === n || cn.indexOf(n) >= 0 || n.indexOf(cn) >= 0);
    }) || null;
  }

  // ── Unified field access (supports both legacy and new schemas) ──
  function cdContact(c){
    if(!c.contact || typeof c.contact !== 'object') c.contact = {};
    return c.contact;
  }
  function cdGetName(c){ return c.company || c.name || ''; }
  function cdGetEmail(c){
    var ct = cdContact(c);
    return ct.email || c.email || '';
  }
  function cdGetPhone(c){
    var ct = cdContact(c);
    return ct.phone || c.phone || '';
  }
  function cdGetWhatsapp(c){
    var ct = cdContact(c);
    return ct.whatsapp || c.whatsapp || '';
  }
  function cdGetDMName(c){
    var ct = cdContact(c);
    return ct.name || (c.decisionMaker && c.decisionMaker.name) || '';
  }
  function cdGetDMTitle(c){
    var ct = cdContact(c);
    return ct.title || (c.decisionMaker && c.decisionMaker.title) || '';
  }
  function cdGetDMMail(c){
    var ct = cdContact(c);
    return ct.email || (c.decisionMaker && c.decisionMaker.email) || '';
  }
  function cdGetCategory(c){
    return c.productCategory || (Array.isArray(c.products) ? c.products.join(', ') : (c.products || ''));
  }
  function cdGetSize(c){
    return c.companySize || c.size || '';
  }

  // Robust JSON extraction from AI response
  function cdParseAIJSON(content){
    if(!content) return null;
    try{
      var m = content.match(/```json\s*([\s\S]*?)```/);
      if(m && m[1]) return JSON.parse(m[1]);
      m = content.match(/\{[\s\S]*\}/);
      if(m) return JSON.parse(m[0]);
      return null;
    }catch(e){
      console.warn('[cd] AI JSON parse failed:', e);
      return null;
    }
  }

  // ── Country tier classification (S/A/B/C) ───────────────────
  var CD_TIER_S = ['美国','United States','USA','US','America','德国','Germany','英国','UK','United Kingdom','Britain','法国','France','日本','Japan'];
  var CD_TIER_A = ['加拿大','Canada','澳大利亚','Australia','荷兰','Netherlands','意大利','Italy','西班牙','Spain','瑞典','Sweden','挪威','Norway','丹麦','Denmark','芬兰','Finland'];
  var CD_TIER_B = ['阿联酋','UAE','United Arab Emirates','沙特','Saudi Arabia','Saudi','越南','Vietnam','泰国','Thailand','印尼','Indonesia','印度尼西亚','巴西','Brazil','墨西哥','Mexico'];
  var CD_TIER_C = ['尼日利亚','Nigeria','南非','South Africa','肯尼亚','Kenya'];

  function cdCountryTier(country){
    if(!country) return 'C';
    var c = String(country).trim().toLowerCase();
    if(!c) return 'C';
    if(CD_TIER_S.some(function(x){ return c === x.toLowerCase() || c.indexOf(x.toLowerCase()) >= 0; })) return 'S';
    if(CD_TIER_A.some(function(x){ return c === x.toLowerCase() || c.indexOf(x.toLowerCase()) >= 0; })) return 'A';
    if(CD_TIER_B.some(function(x){ return c === x.toLowerCase() || c.indexOf(x.toLowerCase()) >= 0; })) return 'B';
    return 'C';
  }

  var CD_TIER_LABEL = {'S':'S级 核心市场','A':'A级 成熟市场','B':'B级 新兴市场','C':'C级 待评估市场'};
  var CD_TIER_SCORE = {'S':100,'A':75,'B':50,'C':25};

  // ============================================================
  // Feature 1.3: Customer profile computation
  // ============================================================
  var CD_INTENT_SCORE = {'高':100,'中':60,'低':30};
  var CD_CATEGORY_OPTIONS = ['户外刀','厨房刀','剪刀','厨房用品'];

  function cdComputeProfile(c){
    if(!c.cdProfile || typeof c.cdProfile !== 'object') c.cdProfile = {};
    var p = c.cdProfile;
    p.countryTier = cdCountryTier(c.country);
    if(!Array.isArray(p.categoryMatch)) p.categoryMatch = [];

    var intentScore = CD_INTENT_SCORE[p.intentLevel] || 0;
    // Fallback: derive a default intent from existing intel
    if(!p.intentLevel && c.cdIntel && c.cdIntel.dimensions){
      var pi = c.cdIntel.dimensions.purchaseIntent || {};
      var cat = String(pi.categories || '').toLowerCase();
      if(cat && cat !== '无' && cat !== '未知') intentScore = 60; // medium default
    }
    var catScore = Math.round(p.categoryMatch.length / CD_CATEGORY_OPTIONS.length * 100);
    p.priorityScore = Math.round(intentScore * 0.4 + CD_TIER_SCORE[p.countryTier] * 0.3 + catScore * 0.3);

    // Recommended development strategy
    if(p.countryTier === 'S' && p.intentLevel === '高'){
      p.strategy = 'S级国家+高意向：深度定制 + 品牌打造 + 工厂宣传片打客户Logo';
    }else if((p.countryTier === 'A') && (p.intentLevel === '中' || p.intentLevel === '高')){
      p.strategy = 'A级国家+中意向：标准OEM + 免费营销素材套餐 + 样品试单';
    }else{
      p.strategy = 'B/C级国家：价格优势 + 现货 + 低MOQ（50pcs起）';
    }
    return p;
  }

  // ============================================================
  // Feature 1.5: Completeness scoring
  // ============================================================
  function cdComputeCompleteness(c){
    var rows = [];
    // 1. Basic info (20)
    rows.push({key:'name',    label:'公司名',   earned: cdGetName(c) ? 5 : 0, max:5});
    rows.push({key:'country', label:'国家',     earned: c.country ? 5 : 0,      max:5});
    rows.push({key:'website', label:'官网',     earned: c.website ? 10 : 0,     max:10});
    // 2. Contacts (20)
    rows.push({key:'email',    label:'邮箱',     earned: cdGetEmail(c) ? 8 : 0,    max:8});
    rows.push({key:'phone',    label:'电话',     earned: cdGetPhone(c) ? 6 : 0,   max:6});
    rows.push({key:'whatsapp', label:'WhatsApp', earned: cdGetWhatsapp(c) ? 6 : 0, max:6});
    // 3. Decision maker (20)
    rows.push({key:'dmName',  label:'决策人姓名', earned: cdGetDMName(c) ? 7 : 0, max:7});
    rows.push({key:'dmTitle', label:'决策人职位', earned: cdGetDMTitle(c) ? 7 : 0, max:7});
    rows.push({key:'dmEmail', label:'决策人邮箱', earned: cdGetDMMail(c) ? 6 : 0, max:6});
    // 4. Business info (20)
    var piText = (c.cdIntel && c.cdIntel.dimensions && c.cdIntel.dimensions.purchaseIntent)
      ? (c.cdIntel.dimensions.purchaseIntent.categories || '') : '';
    rows.push({key:'category', label:'采购品类', earned: cdGetCategory(c) ? 7 : 0, max:7});
    rows.push({key:'size',     label:'公司规模', earned: cdGetSize(c) ? 6 : 0,     max:6});
    rows.push({key:'intent',   label:'采购意向', earned: (piText || c.purchaseIntent) ? 7 : 0, max:7});
    // 5. AI briefing (20)
    var ic = c.cdIntel ? c.cdIntel.confidence : '';
    var intelEarned = ic === 'high' ? 20 : (ic === 'medium' ? 12 : (ic === 'low' ? 6 : 0));
    rows.push({key:'intel', label:'AI背调报告', earned: intelEarned, max:20});

    var total = rows.reduce(function(a, r){ return a + r.earned; }, 0);
    var missing = rows.filter(function(r){ return r.earned === 0; }).map(function(r){ return r.label; });
    var result = { score: total, rows: rows, missing: missing, updatedAt: cdNowISO() };
    c.cdCompleteness = result;
    return result;
  }

  // ============================================================
  // Route / state resolution
  // ============================================================
  function cdAdoptPending(){
    // Support hand-off from the prospect-search module
    if(window._cdPendingIntel && !window._cdAdoptedPending){
      window._cdAdoptedPending = true;
      window._cdForm = {
        name:    window._cdPendingIntel.name    || '',
        website: window._cdPendingIntel.website || '',
        country: window._cdPendingIntel.country || ''
      };
      // Auto-select matching customer if it already exists
      var mc = cdFindCustomerByName(window._cdPendingIntel.name || '');
      if(mc) window._cdSelectedCid = mc.id;
      toast('已从搜客模块带入待背调客户，请点击「开始背调」');
    }
    if(!window._cdForm || typeof window._cdForm !== 'object') window._cdForm = {name:'', website:'', country:''};
  }

  function cdResolveCustomerId(){
    var list = S.customers || [];
    if(window._cdSelectedCid && cdFindCustomer(window._cdSelectedCid)) return window._cdSelectedCid;
    if(list.length){ window._cdSelectedCid = list[0].id; return list[0].id; }
    return null;
  }

  function cdResolveTab(){
    var t = window._cdTab || 'intel';
    if(['intel','profile','completeness'].indexOf(t) < 0) t = 'intel';
    return t;
  }

  // ============================================================
  // Feature 1.2: 8-dimension AI briefing
  // ============================================================
  var CD_SELLING_POINTS = [
    '阳江产业带：中国约75%的刀剪产自阳江，我方立足阳江本地供应链',
    '4家家族股权合作工厂直供（Amber/Yeyu/Homeful/Keenhope），另整合36家归档工厂资源',
    '创始人Leo Li直接对接客户，返乡创业青年，获政府背书（广东"百千万工程"青年创业大赛初创组二等奖、广东新闻频道《品牌发布》栏目报道）',
    '阳江市五金刀剪行业协会资源，可整合大厂产能',
    '免费营销素材套餐：产品图、产品视频、工厂视频、产业链视频；工厂宣传片可打客户自有Logo',
    '支持OEM / ODM / Private Label代工',
    '认证齐全：SGS LFGB、FDA、RoHS、CE、FSC、amfori BSCI',
    '工厂直供价，低于贸易商约20%；MOQ低至50pcs试单',
    '产品出口130+国家；四大品类：厨房刀具、专业剪刀、户外刀具、厨房用品',
    '终身质保 / 10年刃口 / 2年装配'
  ].join('；');

  function cdBuildSystemPrompt(){
    return '你是KaiLionCrafts（阳江市锴利国际贸易有限公司）资深B2B外贸客户开发背调分析师，专注五金刀剪与厨具品类出海。\n\n'
      + '我方核心卖点（在"切入点建议"维度必须结合这些卖点）：\n- ' + CD_SELLING_POINTS + '\n\n'
      + '任务：根据客户官网抓取内容、联网搜索结果与已知信息，输出严格JSON，不要输出任何额外文字、解释或markdown代码块。\n'
      + '不知道的字段填空字符串""，数组空则[]。竞品/供应商/采购量等推断信息必须基于行业常识合理推测，并在对应字段标注"（AI推测，需验证）"。';
  }

  function cdBuildUserPrompt(name, country, website, webContent, searchText){
    return '客户公司：' + name + '\n'
      + '国家/地区：' + (country || '未知') + '\n'
      + '官网：' + (website || '未提供') + '\n\n'
      + '【官网抓取内容】（可能为空）：\n' + (webContent ? webContent.slice(0, 5000) : '（未抓取或抓取失败）') + '\n\n'
      + '【联网搜索结果】（可能为空）：\n' + (searchText || '（无搜索结果）') + '\n\n'
      + '请输出以下结构的JSON（字段名必须完全一致）：\n'
      + '{\n'
      + '  "companyOverview":{"name":"","founded":"","size":"","address":"","website":"","businessScope":""},\n'
      + '  "decisionMakers":[{"name":"","title":"","email":"","linkedin":"","authority":""}],\n'
      + '  "contacts":{"email":"","phone":"","whatsapp":"","social":""},\n'
      + '  "painPoints":{"supplierIssues":"","costPressure":"","qualityIssues":"","deliveryIssues":"","categoryGap":""},\n'
      + '  "purchaseIntent":{"categories":"","volume":"","cycle":"","budget":"","decisionProcess":""},\n'
      + '  "competitorAnalysis":{"currentSuppliers":"","priceRange":"","prosCons":"","ourOpportunity":""},\n'
      + '  "supplyChain":{"hasChinaSupplier":"","regions":"","oemOdmExperience":""},\n'
      + '  "entryStrategy":{"bestAngle":"","recommendedSellingPoints":"","recommendedProducts":"","firstMessageScript":""},\n'
      + '  "confidence":"high|medium|low",\n'
      + '  "sources":["url1","url2"]\n'
      + '}\n'
      + '要求：\n'
      + '- firstMessageScript 用英文写一段可直接发送的首次开发信开场白（80词以内），结合我方卖点。\n'
      + '- confidence 由你判断：有官网+多来源验证填high，单一来源填medium，纯推理填low。\n'
      + '- sources 列出你实际参考到的URL。';
  }

  window.cdUpdateForm = function(key, val){
    if(!window._cdForm) window._cdForm = {name:'',website:'',country:''};
    window._cdForm[key] = val;
  };

  window.cdRunIntel = async function(){
    var name = (window._cdForm.name || '').trim();
    var website = (window._cdForm.website || '').trim();
    var country = (window._cdForm.country || '').trim();
    if(!name){ toast('请输入客户公司名称', 'err'); return; }

    window._cdStep = 1; // 1=fetch, 2=search, 3=AI, 4=done
    window._cdStepMsg = '正在抓取客户官网…';
    renderView();

    var sources = [];
    var webContent = '';

    // Step 1: fetch official website
    if(website){
      try{
        var u = website.indexOf('http') === 0 ? website : 'https://' + website;
        var resp = await fetch('/api/fetch', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ url: u })
        });
        var data = await resp.json();
        webContent = (data && (data.text || data.content || data.html || '')) || '';
        if(webContent) sources.push(u);
      }catch(e){ console.warn('[cd] website fetch failed:', e); }
    }

    window._cdStep = 2;
    window._cdStepMsg = '正在联网搜索客户信息…';
    renderView();

    // Step 2: web search
    var searchText = '';
    try{
      var q = name + ' ' + (country || '') + ' company products contact wholesale';
      var sresp = await fetch('/api/search', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ query: q, maxResults: 8, searchDepth: 'basic' })
      });
      var sdata = await sresp.json();
      if(sdata && Array.isArray(sdata.results)){
        searchText = sdata.results.map(function(r){
          return '- ' + (r.title || '') + ' | ' + (r.url || '') + ' | ' + (r.snippet || r.content || '');
        }).join('\n');
        sdata.results.forEach(function(r){ if(r.url) sources.push(r.url); });
      }
    }catch(e){ console.warn('[cd] web search failed:', e); }

    window._cdStep = 3;
    window._cdStepMsg = 'AI正在分析并生成8维度背调报告…';
    renderView();

    // Step 3: AI analysis
    try{
      var r = await callAI(
        [
          { role: 'system', content: cdBuildSystemPrompt() },
          { role: 'user',   content: cdBuildUserPrompt(name, country, website, webContent, searchText) }
        ],
        { purpose: 'cd_intel_8dim', timeout: 90000, temperature: 0.3, model: 'gpt-5.6-terra' }
      );
      if(r.error){ toast('AI分析失败：' + (r.error || '未知错误'), 'err'); window._cdStep = 0; renderView(); return; }
      var data = cdParseAIJSON(r.content);
      if(!data){ toast('AI返回格式异常，无法解析JSON', 'err'); window._cdStep = 0; renderView(); return; }

      // Confidence: high = website content + >=2 sources; medium = at least one source; low = inference only
      var conf = data.confidence || 'low';
      if(webContent && sources.length >= 2) conf = 'high';
      else if(webContent || sources.length >= 1) conf = conf === 'low' ? 'medium' : conf;
      if(!sources.length) conf = 'low';

      // Find or create the customer record
      var c = cdFindCustomerByName(name);
      var createdNew = false;
      if(!c){
        c = {
          id: uid(), company: name, website: website, country: country,
          contact: { name:'', title:'', email:'', phone:'', whatsapp:'', linkedin:'' },
          status: '待联系', source: 'AI背调', createdAt: cdNowISO()
        };
        S.customers.unshift(c);
        createdNew = true;
      }else{
        // Keep basic fields fresh
        if(website && !c.website) c.website = website;
        if(country && !c.country) c.country = country;
      }
      window._cdSelectedCid = c.id;

      // Preserve previous version in history before overwrite
      if(c.cdIntel){
        S.cdIntelHistory.push({
          id: uid(), customerId: c.id, customerName: c.company,
          version: 'old', confidence: c.cdIntel.confidence,
          createdAt: c.cdIntel.createdAt
        });
      }

      c.cdIntel = {
        dimensions: {
          companyOverview:   data.companyOverview   || {},
          decisionMakers:    Array.isArray(data.decisionMakers) ? data.decisionMakers : [],
          contacts:          data.contacts          || {},
          painPoints:        data.painPoints       || {},
          purchaseIntent:    data.purchaseIntent   || {},
          competitorAnalysis: data.competitorAnalysis || {},
          supplyChain:       data.supplyChain      || {},
          entryStrategy:     data.entryStrategy    || {}
        },
        confidence: conf,
        sources: Array.isArray(data.sources) ? data.sources : sources,
        createdAt: cdNowISO(),
        updatedAt: cdNowISO()
      };

      S.cdIntelHistory.push({
        id: uid(), customerId: c.id, customerName: c.company,
        version: 'new', confidence: conf, createdAt: c.cdIntel.createdAt
      });

      // Auto-fill customer contacts if empty
      var ct = cdContact(c);
      var con = c.cdIntel.dimensions.contacts || {};
      if(!ct.email && con.email) ct.email = con.email;
      if(!ct.phone && con.phone) ct.phone = con.phone;
      if(!ct.whatsapp && con.whatsapp) ct.whatsapp = con.whatsapp;
      var dms = c.cdIntel.dimensions.decisionMakers || [];
      if(dms.length){
        var dm = dms[0];
        if(!ct.name && dm.name) ct.name = dm.name;
        if(!ct.title && dm.title) ct.title = dm.title;
        if(!ct.linkedin && dm.linkedin) ct.linkedin = dm.linkedin;
      }

      // Recompute derived data
      cdComputeProfile(c);
      cdComputeCompleteness(c);
      persist();

      window._cdStep = 4;
      window._cdStepMsg = '背调完成';
      toast((createdNew ? '✅ 已新建客户并完成背调' : '✅ 8维度背调已完成'));
      renderView();
    }catch(e){
      console.warn('[cd] intel failed:', e);
      toast('背调出错：' + (e.message || e), 'err');
      window._cdStep = 0;
      renderView();
    }
  };

  function cdConfBadge(conf){
    if(conf === 'high')   return '<span class="cd-badge cd-conf-high">高置信</span>';
    if(conf === 'medium') return '<span class="cd-badge cd-conf-mid">中置信</span>';
    return '<span class="cd-badge cd-conf-low">低置信（AI推测）</span>';
  }

  function cdStepIndicator(){
    var step = window._cdStep || 0;
    if(!step) return '';
    var steps = [
      {n:1, label:'抓取官网'},
      {n:2, label:'联网搜索'},
      {n:3, label:'AI分析'},
      {n:4, label:'完成'}
    ];
    var h = '<div class="cd-steps">';
    steps.forEach(function(s){
      var cls = s.n < step ? ' done' : (s.n === step ? ' on' : '');
      h += '<div class="cd-step' + cls + '"><span class="cd-step-dot">' + (s.n < step ? '✓' : s.n) + '</span>' + esc(s.label) + '</div>';
    });
    h += '</div>';
    if(window._cdStepMsg) h += '<div class="cd-step-msg">' + esc(window._cdStepMsg) + '</div>';
    return h;
  }

  function cdKv(k, v){
    return '<tr><td class="cd-k">' + esc(k) + '</td><td class="cd-v">'
      + (v ? esc(v) : '<span class="text-muted">—</span>') + '</td></tr>';
  }

  function cdRenderIntelTab(c){
    var h = '';
    var running = (window._cdStep || 0) >= 1 && (window._cdStep || 0) <= 3;

    // Input form (prefilled from selector or pending hand-off)
    var form = window._cdForm || {name:'',website:'',country:''};
    if(c && !form.name){ form.name = cdGetName(c); form.website = c.website || ''; form.country = c.country || ''; }

    h += '<div class="cd-card">';
    h += '  <div class="cd-card-t">🔍 背调输入</div>';
    h += '  <div class="cd-form-grid">';
    h += '    <label>客户公司名称<input class="cd-input" value="' + esc(form.name) + '" ' + (running?'disabled':'') + ' oninput="cdUpdateForm(\'name\',this.value)" placeholder="例如 Kitchen Universe Inc."></label>';
    h += '    <label>客户官网（可选）<input class="cd-input" value="' + esc(form.website) + '" ' + (running?'disabled':'') + ' oninput="cdUpdateForm(\'website\',this.value)" placeholder="example.com"></label>';
    h += '    <label>国家/地区（可选）<input class="cd-input" value="' + esc(form.country) + '" ' + (running?'disabled':'') + ' oninput="cdUpdateForm(\'country\',this.value)" placeholder="美国 / Germany"></label>';
    h += '  </div>';
    h += '  <div class="cd-form-actions">';
    h += '    <button class="btn btn-primary" onclick="cdRunIntel()" ' + (running?'disabled':'') + '>'
      + (running ? '⏳ 背调进行中…' : '🚀 开始8维度背调') + '</button>';
    h += '    <span class="cd-hint">流程：抓取官网 → 联网搜索 → AI生成 · 全部本地免费实现</span>';
    h += '  </div>';
    h += cdStepIndicator();
    h += '</div>';

    // Existing intel result
    if(c && c.cdIntel){
      var d = c.cdIntel.dimensions || {};
      var co = d.companyOverview || {};
      var dms = Array.isArray(d.decisionMakers) ? d.decisionMakers : [];
      var con = d.contacts || {};
      var pp = d.painPoints || {};
      var pi = d.purchaseIntent || {};
      var ca = d.competitorAnalysis || {};
      var sc = d.supplyChain || {};
      var es = d.entryStrategy || {};

      h += '<div class="cd-card cd-result">';
      h += '  <div class="cd-card-t">📄 8维度背调报告 ' + cdConfBadge(c.cdIntel.confidence);
      h += '    <span class="cd-time">更新于 ' + cdFmtTime(c.cdIntel.updatedAt || c.cdIntel.createdAt) + '</span></div>';

      // 1 company overview
      h += '<div class="cd-sec"><div class="cd-sec-t">🏢 1. 公司概况</div><table class="cd-kv"><tbody>'
        + cdKv('公司名', co.name || cdGetName(c))
        + cdKv('成立时间', co.founded) + cdKv('规模', co.size)
        + cdKv('地址', co.address) + cdKv('官网', co.website || c.website)
        + cdKv('业务范围', co.businessScope)
        + '</tbody></table></div>';

      // 2 decision makers
      h += '<div class="cd-sec"><div class="cd-sec-t">👤 2. 决策人信息</div>';
      if(dms.length){
        dms.forEach(function(p){
          h += '<div class="cd-dm">'
            + '<b>' + esc(p.name || '未知') + '</b> · ' + esc(p.title || '')
            + (p.email ? '<br>✉️ ' + esc(p.email) : '')
            + (p.linkedin ? '<br>💼 ' + esc(p.linkedin) : '')
            + (p.authority ? '<br>采购决策权：' + esc(p.authority) : '')
            + '</div>';
        });
      }else{
        h += '<div class="text-sm text-muted">未识别到具体决策人，建议通过官网/LinkedIn进一步挖掘。</div>';
      }
      h += '</div>';

      // 3 contacts
      h += '<div class="cd-sec"><div class="cd-sec-t">📞 3. 联系方式</div><table class="cd-kv"><tbody>'
        + cdKv('邮箱', con.email) + cdKv('电话', con.phone)
        + cdKv('WhatsApp', con.whatsapp) + cdKv('社媒账号', con.social)
        + '</tbody></table></div>';

      // 4 pain points
      h += '<div class="cd-sec"><div class="cd-sec-t">😣 4. 痛点分析</div><table class="cd-kv"><tbody>'
        + cdKv('现有供应商问题', pp.supplierIssues)
        + cdKv('成本压力', pp.costPressure)
        + cdKv('品质问题', pp.qualityIssues)
        + cdKv('交期问题', pp.deliveryIssues)
        + cdKv('品类缺口', pp.categoryGap)
        + '</tbody></table></div>';

      // 5 purchase intent
      h += '<div class="cd-sec"><div class="cd-sec-t">🎯 5. 采购意向</div><table class="cd-kv"><tbody>'
        + cdKv('采购品类', pi.categories)
        + cdKv('采购量', pi.volume)
        + cdKv('采购周期', pi.cycle)
        + cdKv('预算范围', pi.budget)
        + cdKv('决策流程', pi.decisionProcess)
        + '</tbody></table></div>';

      // 6 competitor
      h += '<div class="cd-sec"><div class="cd-sec-t">🏁 6. 竞品分析 <span class="cd-ai-note">AI推测，需验证</span></div><table class="cd-kv"><tbody>'
        + cdKv('当前供应商', ca.currentSuppliers)
        + cdKv('竞品价格带', ca.priceRange)
        + cdKv('竞品优劣势', ca.prosCons)
        + cdKv('我方差异化机会', ca.ourOpportunity)
        + '</tbody></table></div>';

      // 7 supply chain
      h += '<div class="cd-sec"><div class="cd-sec-t">🔗 7. 供应链现状</div><table class="cd-kv"><tbody>'
        + cdKv('是否有中国供应商', sc.hasChinaSupplier)
        + cdKv('采购地区', sc.regions)
        + cdKv('OEM/ODM经验', sc.oemOdmExperience)
        + '</tbody></table></div>';

      // 8 entry strategy
      h += '<div class="cd-sec"><div class="cd-sec-t">🚀 8. 切入点建议</div>';
      h += '  <div class="cd-angle"><b>最佳沟通角度：</b>' + esc(es.bestAngle || '') + '</div>';
      h += '  <div class="cd-angle"><b>推荐卖点：</b>' + esc(es.recommendedSellingPoints || '') + '</div>';
      h += '  <div class="cd-angle"><b>推荐产品：</b>' + esc(es.recommendedProducts || '') + '</div>';
      if(es.firstMessageScript){
        h += '  <div class="cd-script"><div class="cd-script-t">✉️ 首次沟通话术（英文草稿，未发送）</div><div class="cd-script-b">' + esc(es.firstMessageScript) + '</div></div>';
      }
      h += '</div>';

      // Sources
      if(Array.isArray(c.cdIntel.sources) && c.cdIntel.sources.length){
        h += '<div class="cd-sec"><div class="cd-sec-t">📚 信息来源（' + c.cdIntel.sources.length + '）</div><ul class="cd-src">';
        c.cdIntel.sources.forEach(function(s){ h += '<li><a href="' + esc(s) + '" target="_blank" rel="noopener">' + esc(s) + '</a></li>'; });
        h += '</ul></div>';
      }
      h += '</div>';
    }
    return h;
  }

  // ============================================================
  // Feature 1.3: Profile tab
  // ============================================================
  window.cdSetProfile = function(field, val){
    var c = cdFindCustomer(window._cdSelectedCid);
    if(!c) return;
    if(!c.cdProfile) c.cdProfile = {};
    if(field === 'categoryMatch'){
      // toggle from checkbox
      var arr = Array.isArray(c.cdProfile.categoryMatch) ? c.cdProfile.categoryMatch : [];
      var i = arr.indexOf(val);
      if(i >= 0) arr.splice(i, 1); else arr.push(val);
      c.cdProfile.categoryMatch = arr;
    }else{
      c.cdProfile[field] = val;
    }
    cdComputeProfile(c);
    persist();
    renderView();
  };

  window.cdGenProfile = async function(){
    var c = cdFindCustomer(window._cdSelectedCid);
    if(!c){ toast('未找到客户', 'err'); return; }
    toast('AI正在根据背调结果生成画像…');
    try{
      var intel = c.cdIntel ? JSON.stringify(c.cdIntel.dimensions).slice(0, 4000) : '(暂无背调)';
      var r = await callAI(
        [
          { role:'system', content:'你是外贸客户画像分析师。根据客户背调数据，判断客户画像，只输出JSON。' },
          { role:'user', content:
            '客户：' + cdGetName(c) + '（' + (c.country||'') + '）\n'
            + '背调数据：' + intel + '\n\n'
            + '请输出JSON：{"intentLevel":"高|中|低","customerType":"Brand|Importer|Distributor|E-commerce|Retailer","categoryMatch":["户外刀","厨房刀","剪刀","厨房用品"]}\n'
            + 'categoryMatch 只从给定4个选项中选，可多选；只输出JSON。' }
        ],
        { purpose:'cd_profile', timeout:60000, temperature:0.2, model:'gpt-5.6-terra' }
      );
      if(r.error){ toast('AI画像失败：' + r.error, 'err'); return; }
      var j = cdParseAIJSON(r.content) || {};
      if(!c.cdProfile) c.cdProfile = {};
      if(j.intentLevel && ['高','中','低'].indexOf(j.intentLevel) >= 0) c.cdProfile.intentLevel = j.intentLevel;
      if(j.customerType) c.cdProfile.customerType = j.customerType;
      if(Array.isArray(j.categoryMatch)) c.cdProfile.categoryMatch = j.categoryMatch.filter(function(x){ return CD_CATEGORY_OPTIONS.indexOf(x) >= 0; });
      cdComputeProfile(c);
      persist();
      toast('✅ 画像已生成');
      renderView();
    }catch(e){
      toast('AI画像出错：' + (e.message||e), 'err');
    }
  };

  function cdRenderProfileTab(c){
    if(!c) return '<div class="cd-empty">客户台账为空，请先在背调页生成客户。</div>';
    var p = cdComputeProfile(c);
    var h = '';

    // Priority gauge
    var pscore = p.priorityScore || 0;
    var pcolor = pscore >= 70 ? '#38a169' : (pscore >= 45 ? '#d69e2e' : '#e53e3e');
    h += '<div class="cd-card cd-pri-card">';
    h += '  <div><div class="cd-pri-num" style="color:' + pcolor + '">' + pscore + '<small>/100</small></div>';
    h += '  <div class="cd-pri-label">开发优先级</div></div>';
    h += '  <div class="cd-pri-bar"><div class="cd-pri-fill" style="width:' + pscore + '%;background:' + pcolor + '"></div></div>';
    h += '  <div class="cd-pri-tiers">意向40% · 国家30% · 品类30%</div>';
    h += '</div>';

    // Editable fields
    h += '<div class="cd-card"><div class="cd-card-t">🏷️ 画像维度（可手动调整）</div>';
    h += '<table class="cd-profile-table"><tbody>';
    // intent
    h += '<tr><td class="cd-k">意向等级</td><td>'
      + cdSelect('intentLevel', p.intentLevel || '', [['','未设置'],['高','高意向'],['中','中意向'],['低','低意向']])
      + '</td></tr>';
    // customer type
    h += '<tr><td class="cd-k">客户类型</td><td>'
      + cdSelect('customerType', p.customerType || '', [['','未设置'],['Brand','品牌商 Brand'],['Importer','进口商 Importer'],['Distributor','分销商 Distributor'],['E-commerce','电商卖家 E-commerce'],['Retailer','零售商 Retailer']])
      + '</td></tr>';
    // country tier (auto, read-only display)
    h += '<tr><td class="cd-k">国家等级（自动）</td><td><span class="cd-badge cd-tier-' + p.countryTier + '">' + CD_TIER_LABEL[p.countryTier] + '</span> <span class="text-sm text-muted">来自国家字段：' + esc(c.country || '未知') + '</span></td></tr>';
    // category match multi
    h += '<tr><td class="cd-k">品类匹配</td><td>';
    CD_CATEGORY_OPTIONS.forEach(function(cat){
      var on = (p.categoryMatch || []).indexOf(cat) >= 0;
      h += '<label class="cd-cat-check"><input type="checkbox" ' + (on?'checked':'') + ' onchange="cdSetProfile(\'categoryMatch\',\'' + cat + '\')"> ' + cat + '</label>';
    });
    h += '</td></tr>';
    // strategy
    h += '<tr><td class="cd-k">推荐开发策略</td><td><div class="cd-angle">' + esc(p.strategy || '') + '</div></td></tr>';
    h += '</tbody></table>';
    h += '<div class="cd-form-actions"><button class="btn btn-primary" onclick="cdGenProfile()">🤖 AI自动生成画像</button></div>';
    h += '</div>';

    // All customers overview
    h += '<div class="cd-card"><div class="cd-card-t">📊 全部客户画像总览（按优先级排序）</div>';
    var list = (S.customers || []).map(function(x){ return cdComputeProfile(x); });
    var rows = (S.customers || []).slice().sort(function(a,b){
      return (b.cdProfile.priorityScore||0) - (a.cdProfile.priorityScore||0);
    });
    h += '<table class="cd-table"><thead><tr><th>客户</th><th>国家</th><th>等级</th><th>意向</th><th>类型</th><th>优先级</th></tr></thead><tbody>';
    rows.forEach(function(x){
      var pp = x.cdProfile || {};
      h += '<tr class="' + (x.id === c.id ? 'cd-row-on' : '') + '" onclick="cdSelectCustomer(\'' + x.id + '\')" style="cursor:pointer">'
        + '<td>' + esc(cdGetName(x) || '未命名') + '</td>'
        + '<td>' + esc(x.country || '—') + '</td>'
        + '<td><span class="cd-badge cd-tier-' + (pp.countryTier||'C') + '">' + (pp.countryTier||'C') + '</span></td>'
        + '<td>' + esc(pp.intentLevel || '—') + '</td>'
        + '<td>' + esc(pp.customerType || '—') + '</td>'
        + '<td><b>' + (pp.priorityScore||0) + '</b></td>'
        + '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  function cdSelect(field, cur, options){
    var h = '<select class="cd-select" onchange="cdSetProfile(\'' + field + '\',this.value)">';
    options.forEach(function(o){
      h += '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    });
    h += '</select>';
    return h;
  }

  // ============================================================
  // Feature 1.5: Completeness tab
  // ============================================================
  window.cdEnrich = async function(cid){
    var c = cdFindCustomer(cid);
    if(!c) return;
    var comp = cdComputeCompleteness(c);
    if(!comp.missing.length){ toast('该客户信息已完整，无需补充'); return; }
    toast('AI正在搜索补充：' + comp.missing.join('、'));
    try{
      // 1) web search
      var q = cdGetName(c) + ' ' + (c.country||'') + ' contact email purchasing manager phone';
      var sresp = await fetch('/api/search', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ query: q, maxResults: 6, searchDepth:'basic' })
      });
      var sdata = await sresp.json();
      var sText = (sdata && Array.isArray(sdata.results))
        ? sdata.results.map(function(r){ return '- ' + (r.title||'') + ' | ' + (r.url||'') + ' | ' + (r.snippet||r.content||''); }).join('\n')
        : '(无结果)';

      // 2) AI extraction
      var r = await callAI(
        [
          { role:'system', content:'你是外贸客户信息提取助手。从搜索结果中提取客户公开联系与业务信息，只输出JSON。' },
          { role:'user', content:
            '客户公司：' + cdGetName(c) + '（' + (c.country||'') + '）\n'
            + '搜索结果：\n' + sText + '\n\n'
            + '请输出JSON：{"email":"","phone":"","whatsapp":"","contactName":"","contactTitle":"","productCategory":"","companySize":"","purchaseIntent":""}\n'
            + '提取不到的字段填空字符串，不要编造。只输出JSON。' }
        ],
        { purpose:'cd_enrich', timeout:60000, temperature:0.1, model:'gpt-5.6-terra' }
      );
      if(r.error){ toast('AI补充失败：' + r.error, 'err'); return; }
      var j = cdParseAIJSON(r.content) || {};
      var ct = cdContact(c);
      var filled = [];
      if(j.email && !ct.email){ ct.email = j.email; filled.push('邮箱'); }
      if(j.phone && !ct.phone){ ct.phone = j.phone; filled.push('电话'); }
      if(j.whatsapp && !ct.whatsapp){ ct.whatsapp = j.whatsapp; filled.push('WhatsApp'); }
      if(j.contactName && !ct.name){ ct.name = j.contactName; filled.push('决策人姓名'); }
      if(j.contactTitle && !ct.title){ ct.title = j.contactTitle; filled.push('决策人职位'); }
      if(j.productCategory && !c.productCategory){ c.productCategory = j.productCategory; filled.push('采购品类'); }
      if(j.companySize && !c.companySize){ c.companySize = j.companySize; filled.push('公司规模'); }
      if(j.purchaseIntent && !c.purchaseIntent){ c.purchaseIntent = j.purchaseIntent; filled.push('采购意向'); }

      cdComputeCompleteness(c);
      cdComputeProfile(c);
      persist();
      toast(filled.length ? '✅ 已补充：' + filled.join('、') : '未发现新的公开信息');
      renderView();
    }catch(e){
      toast('补充信息出错：' + (e.message||e), 'err');
    }
  };

  function cdRenderCompletenessTab(){
    var list = (S.customers || []).map(function(c){
      return { c: c, comp: cdComputeCompleteness(c) };
    });
    // low score first
    list.sort(function(a,b){ return a.comp.score - b.comp.score; });

    var avg = list.length ? Math.round(list.reduce(function(s,x){ return s + x.comp.score; },0) / list.length) : 0;
    var h = '';

    // Stat cards
    h += '<div class="cd-stats">';
    h += '  <div class="cd-stat"><div class="cd-stat-num">' + list.length + '</div><div class="cd-stat-l">客户总数</div></div>';
    h += '  <div class="cd-stat"><div class="cd-stat-num" style="color:' + (avg>=70?'#38a169':(avg>=45?'#d69e2e':'#e53e3e')) + '">' + avg + '</div><div class="cd-stat-l">平均完整度</div></div>';
    h += '  <div class="cd-stat"><div class="cd-stat-num">' + list.filter(function(x){ return x.comp.score < 60; }).length + '</div><div class="cd-stat-l">待补充(&lt;60分)</div></div>';
    h += '</div>';

    if(!list.length){
      h += '<div class="cd-empty">客户台账为空。请先在「背调」页生成客户。</div>';
      return h;
    }

    h += '<div class="cd-card"><div class="cd-card-t">📋 客户信息完整度（低分优先）</div>';
    list.forEach(function(x){
      var c = x.c, comp = x.comp;
      var color = comp.score >= 80 ? '#38a169' : (comp.score >= 60 ? '#d69e2e' : (comp.score >= 40 ? '#dd6b20' : '#e53e3e'));
      h += '<div class="cd-comp-row">';
      h += '  <div class="cd-comp-head">';
      h += '    <div class="cd-comp-name">' + esc(cdGetName(c) || '未命名') + ' <span class="text-muted">· ' + esc(c.country || '未知') + '</span></div>';
      h += '    <div class="cd-comp-score" style="color:' + color + '">' + comp.score + '<small>/100</small></div>';
      h += '  </div>';
      h += '  <div class="cd-comp-bar"><div class="cd-comp-fill" style="width:' + comp.score + '%;background:' + color + '"></div></div>';
      // sub-row scores
      h += '  <div class="cd-comp-sub">';
      comp.rows.forEach(function(r){
        var on = r.earned > 0;
        h += '<span class="cd-sub-chip' + (on ? '' : ' off') + '" title="' + esc(r.label) + ' ' + r.earned + '/' + r.max + '">' + esc(r.label) + ' ' + (on ? r.earned + '/' + r.max : '缺') + '</span>';
      });
      h += '  </div>';
      if(comp.missing.length){
        h += '  <div class="cd-comp-miss">⚠️ 缺失：' + comp.missing.map(esc).join('、') + '</div>';
      }
      h += '  <div class="cd-comp-actions"><button class="btn btn-outline btn-sm" onclick="cdEnrich(\'' + c.id + '\')">✨ AI自动补充缺失信息</button></div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  // ============================================================
  // Main view
  // ============================================================
  window.cdSelectCustomer = function(cid){
    window._cdSelectedCid = cid;
    var c = cdFindCustomer(cid);
    if(c){ window._cdForm = { name: cdGetName(c), website: c.website || '', country: c.country || '' }; }
    renderView();
  };

  window.cdSetTab = function(t){ window._cdTab = t; renderView(); };

  function cdRenderPage(root){
    cdAdoptPending();
    var customers = S.customers || [];
    var cid = cdResolveCustomerId();
    var tab = cdResolveTab();
    var c = cid ? cdFindCustomer(cid) : null;

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">📋 客户背调画像工作台</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">8维度AI背调 · 智能画像 · 信息完整度评分</div></div>';
    h += '</div>';

    // Customer selector (drives intel result + profile)
    h += '<div class="cd-selector"><label class="cd-sel-label">选择客户：</label>';
    h += '<select class="cd-sel" onchange="cdSelectCustomer(this.value)">';
    customers.forEach(function(x){
      h += '<option value="' + esc(x.id) + '"' + (x.id === cid ? ' selected' : '') + '>'
        + esc(cdGetName(x) || ('未命名 ' + x.id)) + '（' + esc(x.country || '未知') + '）</option>';
    });
    h += '</select></div>';

    // Tabs
    h += '<div class="cd-tabs">';
    h += '<div class="cd-tab' + (tab==='intel' ? ' on' : '') + '" onclick="cdSetTab(\'intel\')">🔍 AI背调（8维度）</div>';
    h += '<div class="cd-tab' + (tab==='profile' ? ' on' : '') + '" onclick="cdSetTab(\'profile\')">🏷️ 客户画像</div>';
    h += '<div class="cd-tab' + (tab==='completeness' ? ' on' : '') + '" onclick="cdSetTab(\'completeness\')">📊 信息完整度</div>';
    h += '</div>';

    if(tab === 'intel')         h += cdRenderIntelTab(c);
    else if(tab === 'profile')  h += cdRenderProfileTab(c);
    else                        h += cdRenderCompletenessTab();

    root.innerHTML = h;
  }

  // ── renderView interception ───────────────────────────────
  var _cdOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'customerDevIntel'){
      cdRenderPage(document.getElementById('mainContent'));
      return;
    }
    _cdOrigRV.apply(this, arguments);
  };

  // ── Styles (cd- prefixed, responsive) ─────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-empty{padding:36px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.cd-selector{display:flex;align-items:center;gap:10px;margin-bottom:16px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;}'
    + '.cd-sel-label{font-size:13px;color:#4a5568;font-weight:600;}'
    + '.cd-sel{flex:1;max-width:420px;padding:7px 10px;border:1px solid #cbd5e0;border-radius:8px;font-size:13px;background:#fff;}'
    + '.cd-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}'
    + '.cd-tab{padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;color:#4a5568;}'
    + '.cd-tab.on{background:#3182ce;color:#fff;border-color:#3182ce;font-weight:600;}'
    + '.cd-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04);}'
    + '.cd-card-t{font-size:15px;font-weight:700;color:#2d3748;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.cd-time{font-size:12px;color:#a0aec0;font-weight:400;margin-left:auto;}'
    + '.cd-form-grid{display:grid;grid-template-columns:1.4fr 1.2fr .8fr;gap:10px;margin-bottom:12px;}'
    + '.cd-form-grid label{font-size:12px;color:#4a5568;display:flex;flex-direction:column;gap:4px;}'
    + '.cd-input{padding:8px 10px;border:1px solid #cbd5e0;border-radius:8px;font-size:13px;}'
    + '.cd-form-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:4px;}'
    + '.cd-hint{font-size:12px;color:#a0aec0;}'
    // Step indicator
    + '.cd-steps{display:flex;gap:6px;margin-top:14px;flex-wrap:wrap;}'
    + '.cd-step{display:flex;align-items:center;gap:6px;font-size:12px;color:#a0aec0;}'
    + '.cd-step-dot{width:20px;height:20px;border-radius:50%;background:#edf2f7;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;}'
    + '.cd-step.on{color:#3182ce;font-weight:600;}'
    + '.cd-step.on .cd-step-dot{background:#bee3f8;color:#2b6cb0;}'
    + '.cd-step.done{color:#38a169;}'
    + '.cd-step.done .cd-step-dot{background:#c6f6d5;color:#22543d;}'
    + '.cd-step-msg{font-size:12.5px;color:#3182ce;margin-top:8px;}'
    // Result sections
    + '.cd-sec{margin-top:14px;}'
    + '.cd-sec-t{font-size:13.5px;font-weight:700;color:#2d3748;margin-bottom:6px;}'
    + '.cd-kv{width:100%;border-collapse:collapse;font-size:13px;}'
    + '.cd-kv td{padding:5px 8px;border-bottom:1px solid #edf2f7;vertical-align:top;}'
    + '.cd-kv td.cd-k{width:130px;color:#718096;}'
    + '.cd-kv td.cd-v{color:#2d3748;}'
    + '.cd-dm{background:#f7fafc;border-radius:8px;padding:8px 12px;margin:4px 0;font-size:13px;color:#2d3748;line-height:1.6;}'
    + '.cd-angle{background:#ebf8ff;border-left:3px solid #3182ce;padding:8px 12px;font-size:13px;color:#2a4365;border-radius:4px;margin:6px 0;line-height:1.6;}'
    + '.cd-script{background:#f0fff4;border-left:3px solid #38a169;border-radius:4px;padding:10px 12px;margin-top:8px;}'
    + '.cd-script-t{font-size:12px;font-weight:700;color:#22543d;margin-bottom:4px;}'
    + '.cd-script-b{font-size:13px;color:#22543d;white-space:pre-wrap;line-height:1.6;font-style:italic;}'
    + '.cd-src{margin:4px 0 0;padding-left:18px;font-size:12px;}'
    + '.cd-src a{color:#3182ce;}'
    + '.cd-ai-note{font-size:11px;font-weight:400;color:#c05621;background:#fffaf0;padding:2px 8px;border-radius:8px;margin-left:6px;}'
    // Badges
    + '.cd-badge{font-size:11.5px;font-weight:600;padding:2px 10px;border-radius:10px;}'
    + '.cd-conf-high{background:#f0fff4;color:#22543d;}'
    + '.cd-conf-mid{background:#fffaf0;color:#c05621;}'
    + '.cd-conf-low{background:#fff5f5;color:#c53030;}'
    + '.cd-tier-S{background:#fff5f5;color:#c53030;}'
    + '.cd-tier-A{background:#fffaf0;color:#c05621;}'
    + '.cd-tier-B{background:#ebf8ff;color:#2b6cb0;}'
    + '.cd-tier-C{background:#edf2f7;color:#4a5568;}'
    // Profile
    + '.cd-pri-card{display:flex;align-items:center;gap:18px;flex-wrap:wrap;}'
    + '.cd-pri-num{font-size:38px;font-weight:700;line-height:1;}'
    + '.cd-pri-num small{font-size:14px;color:#a0aec0;}'
    + '.cd-pri-label{font-size:12px;color:#718096;margin-top:4px;}'
    + '.cd-pri-bar{flex:1;min-width:180px;height:12px;background:#edf2f7;border-radius:6px;overflow:hidden;}'
    + '.cd-pri-fill{height:100%;}'
    + '.cd-pri-tiers{font-size:11.5px;color:#a0aec0;}'
    + '.cd-profile-table{width:100%;border-collapse:collapse;font-size:13px;}'
    + '.cd-profile-table td{padding:8px;border-bottom:1px solid #edf2f7;vertical-align:top;}'
    + '.cd-profile-table td.cd-k{width:120px;color:#718096;font-weight:600;}'
    + '.cd-select{padding:6px 10px;border:1px solid #cbd5e0;border-radius:8px;font-size:13px;background:#fff;}'
    + '.cd-cat-check{margin-right:12px;font-size:13px;color:#2d3748;}'
    // Data table
    + '.cd-table{width:100%;border-collapse:collapse;font-size:12.5px;}'
    + '.cd-table th,.cd-table td{padding:7px 10px;border-bottom:1px solid #edf2f7;text-align:left;}'
    + '.cd-table th{background:#f7fafc;color:#4a5568;font-weight:600;}'
    + '.cd-table tr.cd-row-on{background:#ebf8ff;}'
    // Completeness
    + '.cd-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;}'
    + '.cd-stat{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;text-align:center;}'
    + '.cd-stat-num{font-size:28px;font-weight:700;color:#2d3748;}'
    + '.cd-stat-l{font-size:12px;color:#718096;margin-top:2px;}'
    + '.cd-comp-row{border:1px solid #edf2f7;border-radius:10px;padding:12px 14px;margin-bottom:10px;}'
    + '.cd-comp-head{display:flex;justify-content:space-between;align-items:center;}'
    + '.cd-comp-name{font-size:14px;font-weight:600;color:#2d3748;}'
    + '.cd-comp-score{font-size:22px;font-weight:700;}'
    + '.cd-comp-score small{font-size:12px;color:#a0aec0;}'
    + '.cd-comp-bar{height:8px;background:#edf2f7;border-radius:4px;overflow:hidden;margin:8px 0;}'
    + '.cd-comp-fill{height:100%;}'
    + '.cd-comp-sub{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;}'
    + '.cd-sub-chip{font-size:11px;padding:2px 8px;border-radius:8px;background:#f0fff4;color:#22543d;}'
    + '.cd-sub-chip.off{background:#fff5f5;color:#c53030;}'
    + '.cd-comp-miss{font-size:12px;color:#c53030;margin:4px 0;}'
    + '.cd-comp-actions{margin-top:6px;}'
    // Responsive
    + '@media (max-width:768px){'
    + '  .cd-selector{flex-direction:column;align-items:stretch;}'
    + '  .cd-sel{max-width:100%;}'
    + '  .cd-form-grid{grid-template-columns:1fr;}'
    + '  .cd-card{padding:14px;}'
    + '  .cd-pri-card{flex-direction:column;align-items:flex-start;}'
    + '  .cd-stats{grid-template-columns:1fr;}'
    + '  .cd-table{font-size:11.5px;}'
    + '  .cd-kv td.cd-k{width:100px;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
