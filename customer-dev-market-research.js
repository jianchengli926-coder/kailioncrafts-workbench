/* ============================================================
 * Customer Development Market Research Workbench
 * (customer-dev-market-research.js)
 * ----------------------------------------------------------------
 * Phase 3 / Feature 3.3: Market Research
 *   - 4 categories x countries heat matrix
 *   - Category deep-dive
 *   - Emerging markets analysis
 *   - Rising / hit product (category x country) recommendations
 *   - Data source & confidence disclosure
 *   - Export report as Markdown / HTML (local Blob download)
 *
 * HARD RULES:
 *   - Fully client-side free implementation. No paid services.
 *   - Does NOT modify app.js / server.js / other cd-* modules.
 *   - All new CSS classes use the cd- prefix. Code comments in English.
 *   - Market figures are AI estimates (high/medium/low), never
 *     fabricated precise numbers. Every cell carries confidence.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  // S.cdMarketResearch = {
  //   generatedAt: ISO string,
  //   source: 'ai' | 'baseline',
  //   overview: { categoryKey: { global, topCountries, hotScenarios, opportunities, risks } },
  //   matrix:   { categoryKey: { countryCode: { marketSize, growth, competition,
  //                                             priceSensitivity, priority,
  //                                             hotScenarios, notes, confidence } } },
  //   emerging: { middle_east: { demand, priceSensitivity, recommendCategories, strategy }, ... }
  // }
  if(!S.cdMarketResearch || typeof S.cdMarketResearch !== 'object'){
    S.cdMarketResearch = { generatedAt: null, source: null, overview: {}, matrix: {}, emerging: {} };
  }

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'customerDevMarketResearch',
    icon: '📊',
    label: '市场研究',
    title: '四品类×国家热门度矩阵 · 爆款推荐 · 新兴市场',
    crumb: '品类国家热度矩阵 · 品类深度分析 · 新兴市场 · 爆款推荐'
  });

  // ============================================================
  // Constants
  // ============================================================

  // 4 product categories (KaiLionCrafts scope)
  var CD_CATEGORIES = [
    { key:'outdoor_knives', zh:'户外刀', en:'Outdoor Knives', color:'#c05621', icon:'🔪',
      hotCountries:['US','DE','JP','AU','CA'],
      hotTypes:['狩猎 Hunting','EDC 随身','战术 Tactical','露营 Camping'] },
    { key:'kitchen_knives', zh:'厨房刀', en:'Kitchen Knives', color:'#2b6cb0', icon:'🍴',
      hotCountries:['US','DE','UK','JP','FR'],
      hotTypes:['主厨刀 Chef','三德刀 Santoku','套刀 Block Set','斩骨刀 Cleaver'] },
    { key:'professional_scissors', zh:'剪刀', en:'Professional Scissors', color:'#2f855a', icon:'✂️',
      hotCountries:['US','DE','UK','JP','IT'],
      hotTypes:['园艺剪 Garden','厨房剪 Kitchen','工业剪 Industrial','裁缝剪 Tailor'] },
    { key:'kitchen_accessories', zh:'厨房用品', en:'Kitchen Accessories', color:'#975a16', icon:'🧰',
      hotCountries:['US','DE','UK','AU','CA'],
      hotTypes:['厨具 Cookware','砧板 Cutting Board','烧烤工具 BBQ','削皮器 Peeler'] }
  ];

  // Countries grouped by region (ISO-ish code as key)
  var CD_MARKET_COUNTRIES = [
    { region:'北美', regionEn:'North America', countries:[
      {code:'US', zh:'美国', en:'United States'},
      {code:'CA', zh:'加拿大', en:'Canada'}
    ]},
    { region:'欧洲', regionEn:'Europe', countries:[
      {code:'DE', zh:'德国', en:'Germany'},
      {code:'UK', zh:'英国', en:'United Kingdom'},
      {code:'FR', zh:'法国', en:'France'},
      {code:'IT', zh:'意大利', en:'Italy'},
      {code:'ES', zh:'西班牙', en:'Spain'},
      {code:'NL', zh:'荷兰', en:'Netherlands'},
      {code:'SE', zh:'瑞典', en:'Sweden'}
    ]},
    { region:'亚太', regionEn:'Asia-Pacific', countries:[
      {code:'JP', zh:'日本', en:'Japan'},
      {code:'AU', zh:'澳大利亚', en:'Australia'},
      {code:'KR', zh:'韩国', en:'South Korea'},
      {code:'IN', zh:'印度', en:'India'},
      {code:'VN', zh:'越南', en:'Vietnam'},
      {code:'TH', zh:'泰国', en:'Thailand'},
      {code:'ID', zh:'印度尼西亚', en:'Indonesia'}
    ]},
    { region:'中东', regionEn:'Middle East', countries:[
      {code:'AE', zh:'阿联酋', en:'UAE'},
      {code:'SA', zh:'沙特', en:'Saudi Arabia'}
    ]},
    { region:'拉美', regionEn:'Latin America', countries:[
      {code:'BR', zh:'巴西', en:'Brazil'},
      {code:'MX', zh:'墨西哥', en:'Mexico'},
      {code:'AR', zh:'阿根廷', en:'Argentina'}
    ]},
    { region:'非洲', regionEn:'Africa', countries:[
      {code:'ZA', zh:'南非', en:'South Africa'},
      {code:'NG', zh:'尼日利亚', en:'Nigeria'},
      {code:'KE', zh:'肯尼亚', en:'Kenya'}
    ]}
  ];

  // Emerging market cards (fallback baseline; AI may enrich)
  var CD_EMERGING_BASE = {
    middle_east: {
      zh:'中东 (UAE/沙特)',
      demand:'高端礼品厨具需求增长，斋月送礼场景旺盛，偏好不锈钢、礼盒包装。',
      priceSensitivity:'低（愿为品质和礼品包装付费）',
      recommendCategories:'厨房刀、厨房用品（礼品套装）、高端剪刀',
      strategy:'主打礼品包装+清真友好沟通；通过迪拜转口辐射海湾国家；强调LFGB/FDA认证。'
    },
    southeast_asia: {
      zh:'东南亚 (越南/泰国/印尼)',
      demand:'电商增速快，年轻消费者偏好性价比高的厨刀和小工具，Shopee/Lazada渠道兴起。',
      priceSensitivity:'高（价格敏感，走量）',
      recommendCategories:'厨房用品、削皮器、平价厨刀、家用剪刀',
      strategy:'走SKU组合+小批量现货；配合电商内容营销；避免高客单价战术刀。'
    },
    latin_america: {
      zh:'拉美 (巴西/墨西哥/阿根廷)',
      demand:'家庭厨房用具需求大，烤肉文化盛行带动烧烤工具；进口关税高。',
      priceSensitivity:'中高（重视性价比）',
      recommendCategories:'烧烤工具、厨房用品、厨房刀套刀',
      strategy:'通过墨西哥近岸转口；主打烧烤文化卖点；关注巴西进口关税与清关。'
    },
    africa: {
      zh:'非洲 (南非/尼日利亚/肯尼亚)',
      demand:'基础厨具更新换代，以低价现货和耐用型产品为主，品牌意识弱。',
      priceSensitivity:'高（价格敏感）',
      recommendCategories:'基础厨刀、厨房剪刀、耐用厨具',
      strategy:'主打耐用+低价现货；控制MOQ；通过约翰内斯堡/拉各斯转口；注意收款风险。'
    }
  };

  // Display dictionaries
  var CD_SIZE_LABEL   = { high:'高 High', medium:'中 Medium', low:'低 Low' };
  var CD_GROWTH_LABEL = { up:'↑ 上升 Up', flat:'→ 稳定 Flat', down:'↓ 下降 Down' };
  var CD_COMP_LABEL   = { high:'高 High', medium:'中 Medium', low:'低 Low' };
  var CD_PRICE_LABEL  = { high:'高 High', medium:'中 Medium', low:'低 Low' };
  var CD_CONF_LABEL   = { high:'高 High', medium:'中 Medium', low:'低 Low' };

  // ============================================================
  // Local helpers
  // ============================================================
  function nowISO(){ return new Date().toISOString(); }

  function fmtTime(ts){
    if(!ts) return '—';
    var d = new Date(ts);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')
      + ' ' + String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  function findCategory(key){
    return CD_CATEGORIES.find(function(c){ return c.key === key; }) || null;
  }

  function findCountry(code){
    for(var i=0;i<CD_MARKET_COUNTRIES.length;i++){
      var list = CD_MARKET_COUNTRIES[i].countries;
      for(var j=0;j<list.length;j++){ if(list[j].code === code) return list[j]; }
    }
    return null;
  }

  function regionOfCountry(code){
    for(var i=0;i<CD_MARKET_COUNTRIES.length;i++){
      var list = CD_MARKET_COUNTRIES[i].countries;
      for(var j=0;j<list.length;j++){ if(list[j].code === code) return CD_MARKET_COUNTRIES[i].region; }
    }
    return '';
  }

  function stars(n){
    n = Math.max(0, Math.min(5, parseInt(n, 10) || 0));
    var s = '';
    for(var i=0;i<5;i++) s += i < n ? '★' : '☆';
    return s;
  }

  // Cell color class by priority
  function cellClass(priority){
    var p = parseInt(priority, 10) || 0;
    if(p >= 4) return 'cd-mr-high';
    if(p === 3) return 'cd-mr-medium';
    return 'cd-mr-low';
  }

  // Robust JSON extraction from AI response
  function parseAIJSON(content){
    if(!content) return null;
    try{
      var m = content.match(/```json\s*([\s\S]*?)```/);
      if(m && m[1]) return JSON.parse(m[1]);
      m = content.match(/\{[\s\S]*\}/);
      if(m) return JSON.parse(m[0]);
      return null;
    }catch(e){
      console.warn('[cd-mr] AI JSON parse failed:', e);
      return null;
    }
  }

  // Safely get a matrix cell
  function getCell(catKey, countryCode){
    var m = (S.cdMarketResearch.matrix || {})[catKey];
    if(!m) return null;
    return m[countryCode] || null;
  }

  // All country codes in order
  function allCountryCodes(){
    var out = [];
    CD_MARKET_COUNTRIES.forEach(function(r){
      r.countries.forEach(function(c){ out.push(c.code); });
    });
    return out;
  }

  // ============================================================
  // Prompt building
  // ============================================================
  function buildCountryListText(){
    var lines = [];
    CD_MARKET_COUNTRIES.forEach(function(r){
      var cs = r.countries.map(function(c){ return c.code + '=' + c.zh + '(' + c.en + ')'; }).join(', ');
      lines.push('- ' + r.region + ' (' + r.regionEn + '): ' + cs);
    });
    return lines.join('\n');
  }

  function buildCategoryText(){
    return CD_CATEGORIES.map(function(c){
      return '- ' + c.key + ' (' + c.zh + ' / ' + c.en + '): hot countries [' + c.hotCountries.join(',')
        + '], hot types/scenarios: ' + c.hotTypes.join(' / ');
    }).join('\n');
  }

  function buildSystemPrompt(){
    return [
      'You are a senior export market analyst for KaiLionCrafts (阳江市锴利国际贸易有限公司),',
      'a Yangjiang (China) hardware knife & scissors industrial-cluster trading company doing OEM/ODM/private-label',
      'across 4 categories: outdoor knives, kitchen knives, professional scissors, kitchen accessories.',
      'Yangjiang supplies ~75% of China knives & scissors. The company targets B2B importers, distributors,',
      'brands and retailers; no online consumer payment. Certifications: SGS LFGB, FDA, RoHS, CE.',
      '',
      'Your job: estimate market attractiveness for EACH of the 4 categories across ALL listed countries.',
      'Use qualitative buckets ONLY (high/medium/low; up/flat/down; 1-5 stars). NEVER invent precise USD figures,',
      'sales volumes or market shares. Base estimates on general industry knowledge, export-channel intuition and',
      'B2B procurement logic. For every cell, give a confidence level (high = well-known mature market for this',
      'category; medium = reasonable inference; low = thin evidence / emerging market guess).',
      '',
      'Return STRICT JSON only, no prose outside the JSON. Schema:',
      '{',
      '  "overview": { "<categoryKey>": { "global":"<1-2 sentences global market overview>",',
      '                                   "topCountries":["<code>",...],',
      '                                   "hotScenarios":"<1 line>",',
      '                                   "opportunities":"<1 line>",',
      '                                   "risks":"<1 line>" } },',
      '  "matrix": {',
      '    "<categoryKey>": {',
      '       "<countryCode>": {',
      '         "marketSize":"high|medium|low",',
      '         "growth":"up|flat|down",',
      '         "competition":"high|medium|low",',
      '         "priceSensitivity":"high|medium|low",',
      '         "priority": <1-5 integer>,',
      '         "hotScenarios":"<comma separated, e.g. Hunting, EDC>",',
      '         "notes":"<1 short sentence opportunity / insight>",',
      '         "confidence":"high|medium|low"',
      '       }',
      '    }',
      '  },',
      '  "emerging": {',
      '    "middle_east":   { "demand":"...","priceSensitivity":"...","recommendCategories":"...","strategy":"..." },',
      '    "southeast_asia":{ "demand":"...","priceSensitivity":"...","recommendCategories":"...","strategy":"..." },',
      '    "latin_america": { "demand":"...","priceSensitivity":"...","recommendCategories":"...","strategy":"..." },',
      '    "africa":        { "demand":"...","priceSensitivity":"...","recommendCategories":"...","strategy":"..." }',
      '  }',
      '}',
      '',
      'Fill matrix for EVERY category x EVERY country code below. Do not skip countries. Keep notes concise.'
    ].join('\n');
  }

  function buildUserPrompt(){
    return [
      'Categories:',
      buildCategoryText(),
      '',
      'Countries by region (use these exact codes as JSON keys):',
      buildCountryListText(),
      '',
      'KaiLionCrafts context:',
      '- Yangjiang industrial cluster (~75% of China knives/scissors), OEM/ODM/private-label friendly.',
      '- B2B focus: importers, distributors, retail chains, e-commerce brands.',
      '- 4 categories only: outdoor_knives, kitchen_knives, professional_scissors, kitchen_accessories.',
      '',
      'Now produce the strict JSON for all 4 categories x all listed countries.'
    ].join('\n');
  }

  // ============================================================
  // AI generation
  // ============================================================
  window.cdMrGenerate = async function(){
    if(!confirm('确定要调用 AI 生成完整市场研究矩阵吗？\n（4品类 × 22国家，将覆盖现有缓存数据）')) return;

    window._cdMrBusy = true;
    window._cdMrStepMsg = 'AI正在分析四品类×22国家市场数据…';
    renderView();

    try{
      var r = await callAI(
        [
          { role:'system', content: buildSystemPrompt() },
          { role:'user',   content: buildUserPrompt() }
        ],
        { purpose:'cd_market_research', temperature:0.3, model:'gpt-5.6-terra', timeout:180000, taskType:'text', numCtx:16384 }
      );

      window._cdMrBusy = false;
      if(r.error){ toast('AI生成失败：' + (r.error||''), 'err'); window._cdMrStepMsg=''; renderView(); return; }

      var data = parseAIJSON(r.content);
      if(!data || !data.matrix){
        toast('AI返回格式异常，无法解析JSON，请重试', 'err');
        window._cdMrStepMsg=''; renderView(); return;
      }

      // Normalize: ensure every category x country has a cell with safe defaults
      var normalized = {};
      CD_CATEGORIES.forEach(function(cat){
        normalized[cat.key] = {};
        var srcCat = (data.matrix || {})[cat.key] || {};
        allCountryCodes().forEach(function(code){
          var cell = srcCat[code] || {};
          normalized[cat.key][code] = {
            marketSize:       ['high','medium','low'].indexOf(cell.marketSize) >= 0 ? cell.marketSize : 'medium',
            growth:           ['up','flat','down'].indexOf(cell.growth) >= 0 ? cell.growth : 'flat',
            competition:      ['high','medium','low'].indexOf(cell.competition) >= 0 ? cell.competition : 'medium',
            priceSensitivity:['high','medium','low'].indexOf(cell.priceSensitivity) >= 0 ? cell.priceSensitivity : 'medium',
            priority:         Math.max(1, Math.min(5, parseInt(cell.priority,10) || 3)),
            hotScenarios:     String(cell.hotScenarios || cat.hotTypes.join(', ')).slice(0,120),
            notes:            String(cell.notes || '').slice(0,200),
            confidence:       ['high','medium','low'].indexOf(cell.confidence) >= 0 ? cell.confidence : 'medium'
          };
        });
      });

      S.cdMarketResearch = {
        generatedAt: nowISO(),
        source: 'ai',
        overview: data.overview || {},
        matrix: normalized,
        emerging: data.emerging || JSON.parse(JSON.stringify(CD_EMERGING_BASE))
      };
      persist();
      toast('✅ 市场研究数据已生成并缓存');
    }catch(e){
      window._cdMrBusy = false;
      window._cdMrStepMsg = '';
      console.warn('[cd-mr] generate failed:', e);
      toast('生成出错：' + (e.message||e), 'err');
    }
    renderView();
  };

  // ============================================================
  // Filter / selection state
  // ============================================================
  window.cdMrSetTab = function(t){ window._cdMrTab = t; renderView(); };
  window.cdMrSetCatFilter = function(v){ window._cdMrCatF = v; renderView(); };
  window.cdMrSetRegionFilter = function(v){ window._cdMrRegionF = v; renderView(); };
  window.cdMrSetDeepCat = function(v){ window._cdMrDeepCat = v; renderView(); };
  window.cdMrSelectCell = function(catKey, code){
    var cur = window._cdMrSel || {};
    if(cur.cat === catKey && cur.code === code){ window._cdMrSel = null; }
    else { window._cdMrSel = { cat: catKey, code: code }; }
    renderView();
  };

  function curTab(){ return window._cdMrTab || 'matrix'; }
  function curCatF(){ return window._cdMrCatF || 'all'; }
  function curRegionF(){ return window._cdMrRegionF || 'all'; }
  function curDeepCat(){
    return window._cdMrDeepCat || (CD_CATEGORIES[0] && CD_CATEGORIES[0].key);
  }

  // ============================================================
  // Render: top header
  // ============================================================
  function renderHeader(){
    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">📊 市场研究工作台</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">四品类 × 22国热度矩阵 · 品类深度分析 · 新兴市场 · 爆款推荐</div></div>';
    h += '</div>';

    // Status bar
    var mr = S.cdMarketResearch || {};
    h += '<div class="cd-mr-status">';
    h += '  <div class="cd-mr-status-l">';
    if(mr.generatedAt){
      h += '    <span class="cd-mr-pill cd-mr-pill-ok">✅ 已生成</span>';
      h += '    <span class="cd-hint">最后更新：' + fmtTime(mr.generatedAt) + ' · 来源：' + (mr.source==='ai' ? 'AI联网分析+行业基准' : mr.source) + '</span>';
    }else{
      h += '    <span class="cd-mr-pill cd-mr-pill-warn">⚠️ 尚未生成数据</span>';
      h += '    <span class="cd-hint">点击右侧按钮，AI将基于行业知识估算四品类×22国市场热度</span>';
    }
    h += '  </div>';
    h += '  <div class="cd-mr-status-r">';
    h += '    <button class="btn" onclick="cdMrGenerate()" ' + (window._cdMrBusy ? 'disabled' : '') + '>'
      + (window._cdMrBusy ? '⏳ AI生成中…' : '🔄 ' + (mr.generatedAt ? '重新生成' : '🚀 一键生成市场研究')) + '</button>';
    h += '    <button class="btn" onclick="cdMrExport(\'md\')" ' + (!mr.generatedAt ? 'disabled' : '') + '>⬇️ 导出Markdown</button>';
    h += '    <button class="btn" onclick="cdMrExport(\'html\')" ' + (!mr.generatedAt ? 'disabled' : '') + '>⬇️ 导出HTML</button>';
    h += '  </div>';
    h += '</div>';

    if(window._cdMrBusy && window._cdMrStepMsg){
      h += '<div class="cd-mr-stepmsg">⏳ ' + esc(window._cdMrStepMsg) + '</div>';
    }
    return h;
  }

  // ============================================================
  // Tab: Matrix
  // ============================================================
  function renderMatrixTab(){
    var mr = S.cdMarketResearch || {};
    var hasData = !!mr.generatedAt;
    var h = '';

    if(!hasData){
      h += '<div class="cd-empty">';
      h += '  <div style="font-size:40px;margin-bottom:10px">📊</div>';
      h += '  <div style="font-weight:700;margin-bottom:6px">市场研究矩阵尚未生成</div>';
      h += '  <div class="cd-hint" style="max-width:520px;margin:0 auto 14px">';
      h += '  点击右上角「一键生成市场研究」，AI 将基于阳江刀剪产业带出口经验与行业基准，';
      h += '  输出四品类 × 22国的市场规模、增长趋势、竞争程度、价格敏感度与推荐优先级。';
      h += '  所有数据为高/中/低定性估算，附置信度，仅供决策参考。</div>';
      h += '</div>';
      return h;
    }

    // Filters
    h += '<div class="cd-mr-filters">';
    h += '  <label class="cd-mr-f-label">品类：</label>';
    h += '  <select class="cd-sel" onchange="cdMrSetCatFilter(this.value)">';
    h += '    <option value="all"' + (curCatF()==='all'?' selected':'') + '>全部四品类</option>';
    CD_CATEGORIES.forEach(function(c){
      h += '    <option value="' + c.key + '"' + (curCatF()===c.key?' selected':'') + '>' + c.icon + ' ' + c.zh + '</option>';
    });
    h += '  </select>';
    h += '  <label class="cd-mr-f-label">地区：</label>';
    h += '  <select class="cd-sel" onchange="cdMrSetRegionFilter(this.value)">';
    h += '    <option value="all"' + (curRegionF()==='all'?' selected':'') + '>全部地区</option>';
    CD_MARKET_COUNTRIES.forEach(function(r){
      h += '    <option value="' + r.region + '"' + (curRegionF()===r.region?' selected':'') + '>' + r.region + '</option>';
    });
    h += '  </select>';
    h += '  <span class="cd-mr-legend">';
    h += '    <span class="cd-mr-lg cd-mr-high"></span>高优先级(4-5★)';
    h += '    <span class="cd-mr-lg cd-mr-medium"></span>中(3★)';
    h += '    <span class="cd-mr-lg cd-mr-low"></span>低(1-2★)';
    h += '  </span>';
    h += '</div>';

    // Build visible category columns
    var catCols = CD_CATEGORIES.filter(function(c){ return curCatF()==='all' || c.key===curCatF(); });

    // Build visible regions
    var regions = CD_MARKET_COUNTRIES.filter(function(r){
      return curRegionF()==='all' || r.region===curRegionF();
    });

    // Matrix table
    h += '<div class="cd-mr-tablewrap">';
    h += '<table class="cd-mr-table">';
    h += '<thead><tr>';
    h += '<th class="cd-mr-corner">国家/地区</th>';
    catCols.forEach(function(c){
      h += '<th class="cd-mr-cath" style="border-top:3px solid ' + c.color + '">' + c.icon + ' ' + c.zh + '</th>';
    });
    h += '</tr></thead><tbody>';

    regions.forEach(function(region){
      // Region band row
      h += '<tr class="cd-mr-regionrow"><td colspan="' + (catCols.length+1) + '">🌐 ' + region.region + ' · ' + region.regionEn + '</td></tr>';
      region.countries.forEach(function(cty){
        h += '<tr>';
        h += '<td class="cd-mr-country"><b>' + esc(cty.zh) + '</b><span class="cd-mr-cc">' + cty.code + '</span></td>';
        catCols.forEach(function(cat){
          var cell = getCell(cat.key, cty.code);
          if(!cell){
            h += '<td class="cd-mr-cell cd-mr-low"><span class="cd-mr-na">—</span></td>';
            return;
          }
          var cls = cellClass(cell.priority);
          var selected = (window._cdMrSel && window._cdMrSel.cat===cat.key && window._cdMrSel.code===cty.code) ? ' sel' : '';
          h += '<td class="cd-mr-cell ' + cls + selected + '" onclick="cdMrSelectCell(\'' + cat.key + '\',\'' + cty.code + '\')" title="点击查看详情">';
          h += '  <div class="cd-mr-stars">' + stars(cell.priority) + '</div>';
          h += '  <div class="cd-mr-grow">' + ({up:'↑',flat:'→',down:'↓'})[cell.growth] + ' '
             + ({high:'高',medium:'中',low:'低'})[cell.marketSize] + '</div>';
          h += '</td>';
        });
        h += '</tr>';
      });
    });

    h += '</tbody></table></div>';

    // Selected cell detail
    var sel = window._cdMrSel;
    if(sel){
      var cell = getCell(sel.cat, sel.code);
      var cat = findCategory(sel.cat);
      var cty = findCountry(sel.code);
      if(cell && cat && cty){
        h += '<div class="cd-mr-detail">';
        h += '  <div class="cd-mr-detail-t">' + cat.icon + ' ' + cat.zh + ' × ' + esc(cty.zh) + ' (' + cty.code + ')</div>';
        h += '  <div class="cd-mr-detail-grid">';
        h += kv('推荐优先级', stars(cell.priority) + ' (' + cell.priority + '/5)');
        h += kv('市场规模', CD_SIZE_LABEL[cell.marketSize] || cell.marketSize);
        h += kv('增长趋势', CD_GROWTH_LABEL[cell.growth] || cell.growth);
        h += kv('竞争程度', CD_COMP_LABEL[cell.competition] || cell.competition);
        h += kv('价格敏感度', CD_PRICE_LABEL[cell.priceSensitivity] || cell.priceSensitivity);
        h += kv('数据置信度', CD_CONF_LABEL[cell.confidence] || cell.confidence);
        h += kv('热门场景/类型', esc(cell.hotScenarios || '—'));
        h += kv('机会点/备注', esc(cell.notes || '—'));
        h += '  </div>';
        h += '</div>';
      }
    }

    return h;
  }

  function kv(k, v){
    return '<div class="cd-mr-dkv"><span class="cd-mr-dk">' + k + '</span><span class="cd-mr-dv">' + v + '</span></div>';
  }

  // ============================================================
  // Tab: Category deep dive
  // ============================================================
  function renderCategoryTab(){
    var mr = S.cdMarketResearch || {};
    if(!mr.generatedAt) return '<div class="cd-empty">请先生成市场研究数据</div>';

    var h = '';
    h += '<div class="cd-mr-filters">';
    h += '  <label class="cd-mr-f-label">选择品类：</label>';
    h += '  <select class="cd-sel" onchange="cdMrSetDeepCat(this.value)">';
    CD_CATEGORIES.forEach(function(c){
      h += '    <option value="' + c.key + '"' + (curDeepCat()===c.key?' selected':'') + '>' + c.icon + ' ' + c.zh + ' / ' + c.en + '</option>';
    });
    h += '  </select>';
    h += '</div>';

    var cat = findCategory(curDeepCat());
    var ov = (mr.overview || {})[cat.key] || {};

    // Overview card
    h += '<div class="cd-mr-card">';
    h += '  <div class="cd-mr-card-t">' + cat.icon + ' ' + cat.zh + '全球市场概览</div>';
    h += '  <div class="cd-mr-overview">' + esc(ov.global || '（AI未返回该品类概览，以下为矩阵汇总）') + '</div>';
    h += '  <div class="cd-mr-ov-grid">';
    h += ovkv('热门场景/类型', ov.hotScenarios || cat.hotTypes.join(' / '));
    h += ovkv('推荐重点国家', Array.isArray(ov.topCountries) && ov.topCountries.length
      ? ov.topCountries.map(function(c){ var cc=findCountry(c); return cc?cc.zh:c; }).join('、') : '—');
    h += ovkv('机会点', ov.opportunities || '—');
    h += ovkv('风险', ov.risks || '—');
    h += '  </div>';
    h += '</div>';

    // Ranked country list by priority
    var rows = [];
    allCountryCodes().forEach(function(code){
      var cell = getCell(cat.key, code);
      if(cell) rows.push({ code:code, cell:cell });
    });
    rows.sort(function(a,b){ return (b.cell.priority - a.cell.priority) || (a.cell.growth==='up'?-1:0); });

    h += '<div class="cd-mr-card">';
    h += '  <div class="cd-mr-card-t">🏆 各国优先级排名（按推荐星级）</div>';
    h += '  <table class="cd-mr-rank"><thead><tr><th>#</th><th>国家</th><th>星级</th><th>规模</th><th>趋势</th><th>竞争</th><th>价格敏感</th><th>置信度</th><th>机会点</th></tr></thead><tbody>';
    rows.forEach(function(r, i){
      var cty = findCountry(r.code);
      h += '<tr>';
      h += '<td>' + (i+1) + '</td>';
      h += '<td><b>' + esc(cty.zh) + '</b><span class="cd-mr-cc">' + cty.code + '</span></td>';
      h += '<td class="' + cellClass(r.cell.priority) + '">' + stars(r.cell.priority) + '</td>';
      h += '<td>' + r.cell.marketSize + '</td>';
      h += '<td>' + ({up:'↑',flat:'→',down:'↓'})[r.cell.growth] + '</td>';
      h += '<td>' + r.cell.competition + '</td>';
      h += '<td>' + r.cell.priceSensitivity + '</td>';
      h += '<td>' + r.cell.confidence + '</td>';
      h += '<td class="cd-mr-notes">' + esc(r.cell.notes || '—') + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';

    return h;
  }

  function ovkv(k, v){
    return '<div class="cd-mr-ovkv"><div class="cd-mr-ovk">' + k + '</div><div class="cd-mr-ovv">' + esc(v) + '</div></div>';
  }

  // ============================================================
  // Tab: Emerging markets
  // ============================================================
  function renderEmergingTab(){
    var mr = S.cdMarketResearch || {};
    if(!mr.generatedAt) return '<div class="cd-empty">请先生成市场研究数据</div>';

    var em = mr.emerging || {};
    var order = ['middle_east','southeast_asia','latin_america','africa'];
    var icons = { middle_east:'🐪', southeast_asia:'🌴', latin_america:'🌮', africa:'🌍' };
    var h = '';
    h += '<div class="cd-mr-emgrid">';
    order.forEach(function(k){
      var data = em[k] || CD_EMERGING_BASE[k] || {};
      h += '<div class="cd-mr-emcard">';
      h += '  <div class="cd-mr-emt">' + (icons[k]||'🌏') + ' ' + esc(data.zh || CD_EMERGING_BASE[k].zh) + '</div>';
      h += '  ' + emRow('需求特点', data.demand);
      h += '  ' + emRow('价格敏感度', data.priceSensitivity);
      h += '  ' + emRow('推荐品类', data.recommendCategories);
      h += '  ' + emRow('进入策略', data.strategy);
      h += '</div>';
    });
    h += '</div>';
    return h;
  }
  function emRow(k, v){
    return '<div class="cd-mr-emrow"><span class="cd-mr-emk">' + k + '</span><span class="cd-mr-emv">' + esc(v || '—') + '</span></div>';
  }

  // ============================================================
  // Tab: Hit / rising products
  // ============================================================
  function renderHitTab(){
    var mr = S.cdMarketResearch || {};
    if(!mr.generatedAt) return '<div class="cd-empty">请先生成市场研究数据</div>';

    // rising = growth up AND priority >= 4
    var hits = [];
    CD_CATEGORIES.forEach(function(cat){
      allCountryCodes().forEach(function(code){
        var cell = getCell(cat.key, code);
        if(!cell) return;
        if(cell.growth === 'up' && cell.priority >= 4){
          hits.push({ cat:cat, code:code, cell:cell });
        }
      });
    });
    hits.sort(function(a,b){ return (b.cell.priority - a.cell.priority) || (a.cell.marketSize==='high'?-1:0); });

    var h = '';
    h += '<div class="cd-mr-card">';
    h += '  <div class="cd-mr-card-t">🔥 上升期爆款组合（增长↑ 且 优先级≥4★）共 ' + hits.length + ' 个</div>';
    if(!hits.length){
      h += '<div class="cd-hint" style="padding:10px">当前数据中没有同时满足「增长上升 + 优先级≥4星」的组合，可在矩阵中查看次优机会。</div>';
    }else{
      h += '<div class="cd-mr-hitlist">';
      hits.forEach(function(it, i){
        var cty = findCountry(it.code);
        h += '<div class="cd-mr-hit">';
        h += '  <div class="cd-mr-hit-rank">#' + (i+1) + '</div>';
        h += '  <div class="cd-mr-hit-main">';
        h += '    <div class="cd-mr-hit-t">' + it.cat.icon + ' ' + it.cat.zh + ' → ' + esc(cty.zh) + ' (' + cty.code + ') <span class="cd-mr-cc">' + regionOfCountry(it.code) + '</span></div>';
        h += '    <div class="cd-mr-hit-meta">' + stars(it.cell.priority)
             + ' · 规模' + it.cell.marketSize + ' · 趋势↑ · 竞争' + it.cell.competition + ' · 价格敏感' + it.cell.priceSensitivity + '</div>';
        h += '    <div class="cd-mr-hit-why">💡 ' + esc(it.cell.notes || ('热门场景：' + (it.cell.hotScenarios||it.cat.hotTypes.join(',')))) + '</div>';
        h += '  </div>';
        h += '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  // ============================================================
  // Tab: Sources & confidence
  // ============================================================
  function renderSourcesTab(){
    var mr = S.cdMarketResearch || {};
    var h = '';
    h += '<div class="cd-mr-card">';
    h += '  <div class="cd-mr-card-t">📚 数据来源与置信度说明</div>';
    h += '  <div class="cd-mr-src">';
    h += '    <p><b>数据来源：</b>AI 行业知识估算 + 阳江刀剪产业带出口经验基准 + 公司知识库（产品库/国家开发指南）。</p>';
    h += '    <p><b>数据性质：</b>所有市场规模 / 竞争程度 / 价格敏感度均为 <b>高/中/低定性估算</b>，<b>不包含任何精确美元金额、销量或市场份额</b>。</p>';
    h += '    <p><b>置信度标注：</b></p>';
    h += '    <ul>';
    h += '      <li><b>高 High</b>：该品类在该国为成熟、广为人知的主流市场（如美国户外刀、德国厨刀）。</li>';
    h += '      <li><b>中 Medium</b>：基于一般出口逻辑和渠道经验的合理推断。</li>';
    h += '      <li><b>低 Low</b>：新兴/小市场，证据有限，仅供方向参考。</li>';
    h += '    </ul>';
    h += '    <p class="cd-mr-disclaimer">⚠️ <b>免责声明：</b>本报告为 AI 分析估算，仅供内部方向参考。实际客户开发、报价、选品决策前，<br/>请结合海关数据（如 ITridge / Volza / 海关数据）、目标国进口商名录、Google Trends 及实际询盘反馈进一步验证。</p>';
    h += '  </div>';
    h += '</div>';

    // Confidence distribution
    if(mr.generatedAt){
      var counts = { high:0, medium:0, low:0, total:0 };
      CD_CATEGORIES.forEach(function(cat){
        allCountryCodes().forEach(function(code){
          var cell = getCell(cat.key, code);
          if(cell){ counts[cell.confidence] = (counts[cell.confidence]||0)+1; counts.total++; }
        });
      });
      h += '<div class="cd-mr-card">';
      h += '  <div class="cd-mr-card-t">📈 本次数据置信度分布（共 ' + counts.total + ' 个单元格）</div>';
      h += '  <div class="cd-mr-confbar">';
      h += confSeg('高', counts.high, counts.total, '#38a169');
      h += confSeg('中', counts.medium, counts.total, '#d69e2e');
      h += confSeg('低', counts.low, counts.total, '#a0aec0');
      h += '  </div>';
      h += '</div>';
    }
    return h;
  }
  function confSeg(label, n, total, color){
    var pct = total ? Math.round(n*100/total) : 0;
    return '<div class="cd-mr-confseg" style="flex:' + (n||0.001) + ';background:' + color + '" title="' + label + ' ' + n + ' (' + pct + '%)">'
      + (pct >= 8 ? label + ' ' + pct + '%' : '') + '</div>';
  }

  // ============================================================
  // Export
  // ============================================================
  window.cdMrExport = function(format){
    var mr = S.cdMarketResearch || {};
    if(!mr.generatedAt){ toast('请先生成数据再导出', 'err'); return; }
    var md = buildMarkdownReport();
    if(format === 'md'){
      downloadBlob(md, 'kailion-market-research.md', 'text/markdown;charset=utf-8');
    }else{
      var html = mdToHtmlReport(md);
      downloadBlob(html, 'kailion-market-research.html', 'text/html;charset=utf-8');
    }
    toast('✅ 报告已导出');
  };

  function downloadBlob(content, filename, mime){
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function buildMarkdownReport(){
    var mr = S.cdMarketResearch;
    var L = [];
    L.push('# KaiLionCrafts 市场研究报告');
    L.push('');
    L.push('- 生成时间：' + fmtTime(mr.generatedAt));
    L.push('- 数据来源：AI 行业知识估算 + 阳江刀剪产业带出口经验 + 公司知识库');
    L.push('- 数据性质：高/中/低定性估算，不含精确金额；仅供方向参考');
    L.push('');
    L.push('## 一、市场热度矩阵（推荐优先级星级）');
    L.push('');
    CD_MARKET_COUNTRIES.forEach(function(region){
      L.push('### ' + region.region);
      L.push('');
      L.push('| 国家 | ' + CD_CATEGORIES.map(function(c){ return c.zh; }).join(' | ') + ' |');
      L.push('|' + CD_CATEGORIES.map(function(){ return '---'; }).join('|') + '|');
      region.countries.forEach(function(cty){
        var row = [cty.zh];
        CD_CATEGORIES.forEach(function(cat){
          var cell = getCell(cat.key, cty.code);
          row.push(cell ? (cell.priority + '★ ' + ({up:'↑',flat:'→',down:'↓'})[cell.growth]) : '—');
        });
        L.push('| ' + row.join(' | ') + ' |');
      });
      L.push('');
    });

    L.push('## 二、品类深度分析');
    CD_CATEGORIES.forEach(function(cat){
      var ov = (mr.overview || {})[cat.key] || {};
      L.push('### ' + cat.icon + ' ' + cat.zh + ' / ' + cat.en);
      L.push('- 全球概览：' + (ov.global || '—'));
      L.push('- 热门场景/类型：' + (ov.hotScenarios || cat.hotTypes.join(' / ')));
      L.push('- 机会点：' + (ov.opportunities || '—'));
      L.push('- 风险：' + (ov.risks || '—'));
      L.push('');
    });

    L.push('## 三、新兴市场分析');
    var em = mr.emerging || {};
    ['middle_east','southeast_asia','latin_america','africa'].forEach(function(k){
      var d = em[k] || CD_EMERGING_BASE[k] || {};
      L.push('### ' + (d.zh || CD_EMERGING_BASE[k].zh));
      L.push('- 需求特点：' + (d.demand || '—'));
      L.push('- 价格敏感度：' + (d.priceSensitivity || '—'));
      L.push('- 推荐品类：' + (d.recommendCategories || '—'));
      L.push('- 进入策略：' + (d.strategy || '—'));
      L.push('');
    });

    L.push('## 四、上升期爆款组合（增长↑ 且 优先级≥4★）');
    var hits = [];
    CD_CATEGORIES.forEach(function(cat){
      allCountryCodes().forEach(function(code){
        var cell = getCell(cat.key, code);
        if(cell && cell.growth==='up' && cell.priority>=4) hits.push({cat:cat, code:code, cell:cell});
      });
    });
    hits.sort(function(a,b){ return b.cell.priority - a.cell.priority; });
    hits.forEach(function(it, i){
      var cty = findCountry(it.code);
      L.push((i+1) + '. ' + it.cat.zh + ' → ' + cty.zh + '（' + it.cell.priority + '★，'
        + '规模' + it.cell.marketSize + '，竞争' + it.cell.competition + '，价格敏感' + it.cell.priceSensitivity + '）— ' + (it.cell.notes||''));
    });
    if(!hits.length) L.push('- （当前无满足条件的组合）');
    L.push('');
    L.push('---');
    L.push('⚠️ 本报告由 AI 生成，为定性估算，实际决策请结合海关数据与询盘反馈验证。');
    return L.join('\n');
  }

  function mdToHtmlReport(md){
    // Minimal, safe HTML wrapper (content already plain text we control)
    var body = md
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/^### (.*)$/gm,'<h3>$1</h3>')
      .replace(/^## (.*)$/gm,'<h2>$1</h2>')
      .replace(/^# (.*)$/gm,'<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')
      .replace(/^- (.*)$/gm,'<li>$1</li>')
      .replace(/\n/g,'<br/>');
    return '<!doctype html><html lang="zh"><head><meta charset="utf-8">'
      + '<title>KaiLionCrafts 市场研究报告</title>'
      + '<style>body{font-family:-apple-system,"PingFang SC",sans-serif;max-width:900px;margin:30px auto;line-height:1.7;color:#2d3748;padding:0 20px}'
      + 'h1{color:#2b6cb0;border-bottom:2px solid #bee3f8;padding-bottom:8px}'
      + 'h2{color:#2c5282;margin-top:28px}'
      + 'h3{color:#4a5568;margin-top:18px}'
      + 'li{margin:3px 0}</style></head><body>'
      + body + '</body></html>';
  }

  // ============================================================
  // Main render
  // ============================================================
  function renderPage(root){
    var h = '';
    h += renderHeader();

    var tabs = [
      { key:'matrix',   label:'🔥 热度矩阵' },
      { key:'category', label:'🎯 品类深度分析' },
      { key:'emerging', label:'🌍 新兴市场' },
      { key:'hit',      label:'🚀 爆款推荐' },
      { key:'sources',  label:'📚 数据来源与置信度' }
    ];
    h += '<div class="cd-tabs">';
    tabs.forEach(function(t){
      h += '<div class="cd-tab' + (curTab()===t.key ? ' on' : '') + '" onclick="cdMrSetTab(\'' + t.key + '\')">' + t.label + '</div>';
    });
    h += '</div>';

    if(curTab()==='matrix')          h += renderMatrixTab();
    else if(curTab()==='category')   h += renderCategoryTab();
    else if(curTab()==='emerging')   h += renderEmergingTab();
    else if(curTab()==='hit')        h += renderHitTab();
    else                             h += renderSourcesTab();

    root.innerHTML = h;
  }

  // ── renderView interception ───────────────────────────────
  var _cdMrOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'customerDevMarketResearch'){
      renderPage(document.getElementById('mainContent'));
      return;
    }
    _cdMrOrigRV.apply(this, arguments);
  };

  // ── Styles (cd-mr- prefixed, responsive) ────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-empty{padding:40px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:12px;}'
    + '.cd-hint{font-size:12px;color:#a0aec0;}'
    // status bar
    + '.cd-mr-status{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin-bottom:14px;}'
    + '.cd-mr-status-l{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}'
    + '.cd-mr-status-r{display:flex;gap:8px;flex-wrap:wrap;}'
    + '.cd-mr-pill{font-size:12px;font-weight:700;padding:3px 10px;border-radius:10px;}'
    + '.cd-mr-pill-ok{background:#f0fff4;color:#22543d;border:1px solid #9ae6b4;}'
    + '.cd-mr-pill-warn{background:#fffaf0;color:#975a16;border:1px solid #fbd38d;}'
    + '.cd-mr-stepmsg{background:#ebf8ff;border:1px solid #bee3f8;color:#2a4365;padding:8px 12px;border-radius:8px;margin-bottom:12px;font-size:13px;}'
    // tabs
    + '.cd-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;border-bottom:2px solid #e2e8f0;padding-bottom:0;}'
    + '.cd-tab{padding:8px 14px;cursor:pointer;font-size:13px;color:#4a5568;border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0;}'
    + '.cd-tab.on{background:#ebf8ff;color:#2b6cb0;font-weight:700;border-color:#e2e8f0;}'
    // filters
    + '.cd-mr-filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin-bottom:14px;}'
    + '.cd-mr-f-label{font-size:13px;color:#4a5568;font-weight:600;}'
    + '.cd-sel{padding:6px 10px;border:1px solid #cbd5e0;border-radius:8px;font-size:13px;background:#fff;}'
    + '.cd-mr-legend{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:#4a5568;flex-wrap:wrap;}'
    + '.cd-mr-lg{display:inline-block;width:14px;height:14px;border-radius:3px;}'
    // matrix table
    + '.cd-mr-tablewrap{overflow-x:auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;}'
    + '.cd-mr-table{border-collapse:collapse;width:100%;min-width:640px;font-size:13px;}'
    + '.cd-mr-table th,.cd-mr-table td{border:1px solid #edf2f7;padding:6px 8px;text-align:center;}'
    + '.cd-mr-corner{background:#f7fafc;min-width:110px;}'
    + '.cd-mr-cath{background:#f7fafc;padding:8px;font-weight:700;color:#2d3748;}'
    + '.cd-mr-regionrow td{background:#edf2f7;font-weight:700;color:#2c5282;text-align:left;padding:5px 10px;font-size:12.5px;}'
    + '.cd-mr-country{text-align:left !important;background:#fdfdfd;}'
    + '.cd-mr-cc{font-size:10.5px;color:#a0aec0;margin-left:5px;font-weight:400;}'
    + '.cd-mr-cell{cursor:pointer;min-width:96px;transition:transform .08s;}'
    + '.cd-mr-cell:hover{transform:scale(1.04);}'
    + '.cd-mr-cell.sel{outline:3px solid #2b6cb0;}'
    + '.cd-mr-high{background:#c6f6d5;}'
    + '.cd-mr-medium{background:#fefcbf;}'
    + '.cd-mr-low{background:#e2e8f0;color:#718096;}'
    + '.cd-mr-stars{font-size:12px;letter-spacing:1px;color:#b7791f;}'
    + '.cd-mr-low .cd-mr-stars{color:#a0aec0;}'
    + '.cd-mr-grow{font-size:11px;color:#4a5568;margin-top:2px;}'
    + '.cd-mr-na{color:#cbd5e0;}'
    // detail panel
    + '.cd-mr-detail{background:#fff;border:1px solid #bee3f8;border-radius:10px;padding:14px;margin-top:14px;}'
    + '.cd-mr-detail-t{font-weight:700;color:#2b6cb0;margin-bottom:10px;font-size:14px;}'
    + '.cd-mr-detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;}'
    + '.cd-mr-dkv{display:flex;gap:8px;font-size:13px;border-bottom:1px dashed #e2e8f0;padding:4px 0;}'
    + '.cd-mr-dk{color:#718096;min-width:90px;font-weight:600;}'
    + '.cd-mr-dv{color:#2d3748;flex:1;}'
    // cards
    + '.cd-mr-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:14px;}'
    + '.cd-mr-card-t{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:10px;}'
    + '.cd-mr-overview{font-size:13px;color:#2d3748;line-height:1.7;background:#f7fafc;padding:10px 12px;border-radius:8px;margin-bottom:10px;}'
    + '.cd-mr-ov-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;}'
    + '.cd-mr-ovkv{background:#f7fafc;border-radius:8px;padding:8px 10px;}'
    + '.cd-mr-ovk{font-size:11.5px;color:#718096;font-weight:700;margin-bottom:3px;}'
    + '.cd-mr-ovv{font-size:13px;color:#2d3748;line-height:1.5;}'
    // rank table
    + '.cd-mr-rank{width:100%;border-collapse:collapse;font-size:12.5px;}'
    + '.cd-mr-rank th,.cd-mr-rank td{padding:6px 8px;border-bottom:1px solid #edf2f7;text-align:left;}'
    + '.cd-mr-rank th{background:#f7fafc;color:#4a5568;}'
    + '.cd-mr-notes{max-width:280px;color:#4a5568;}'
    // emerging
    + '.cd-mr-emgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;}'
    + '.cd-mr-emcard{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;border-top:4px solid #d69e2e;}'
    + '.cd-mr-emt{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:10px;}'
    + '.cd-mr-emrow{margin-bottom:8px;font-size:12.5px;line-height:1.6;}'
    + '.cd-mr-emk{display:inline-block;font-weight:700;color:#975a16;min-width:80px;}'
    + '.cd-mr-emv{color:#2d3748;}'
    // hit list
    + '.cd-mr-hitlist{display:flex;flex-direction:column;gap:10px;}'
    + '.cd-mr-hit{display:flex;gap:12px;background:#f7fafc;border-radius:10px;padding:10px 12px;border-left:4px solid #38a169;}'
    + '.cd-mr-hit-rank{font-size:18px;font-weight:800;color:#38a169;min-width:32px;}'
    + '.cd-mr-hit-t{font-size:13.5px;font-weight:700;color:#2d3748;}'
    + '.cd-mr-hit-meta{font-size:12px;color:#718096;margin:3px 0;}'
    + '.cd-mr-hit-why{font-size:12.5px;color:#2c5282;line-height:1.5;}'
    // sources
    + '.cd-mr-src{font-size:13px;color:#2d3748;line-height:1.8;}'
    + '.cd-mr-src ul{margin:6px 0 6px 20px;}'
    + '.cd-mr-disclaimer{background:#fff5f5;border:1px solid #fed7d7;border-radius:8px;padding:10px;color:#c53030;margin-top:10px;}'
    + '.cd-mr-confbar{display:flex;height:26px;border-radius:6px;overflow:hidden;border:1px solid #e2e8f0;}'
    + '.cd-mr-confseg{color:#fff;font-size:11.5px;display:flex;align-items:center;justify-content:center;}'
    // responsive
    + '@media (max-width:800px){'
    + '  .cd-mr-status{flex-direction:column;align-items:flex-start;}'
    + '  .cd-mr-legend{margin-left:0;}'
    + '  .cd-mr-emgrid{grid-template-columns:1fr;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
