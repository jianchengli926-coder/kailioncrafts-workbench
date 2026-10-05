/* ============================================================
 * P7 Phase7 Module: Prospect Enhanced Workbench
 * ----------------------------------------------------------------
 * Feature 23: Predictive Sending — per-customer best send time
 *             analysis based on historical open records.
 * Feature 24: OpenStreetMap Overpass free local merchant search
 *             (calls POST /api/osm/search, imports to S.customers).
 * Feature 25: Pluggable Data Sources registry (AI / Customs / OSM).
 * Feature 27: Market Rotation across Africa / Middle East / SEA /
 *             LATAM with AI-recommended next focus market.
 * Feature 34: Web Research Agent (simplified) — single-page fetch
 *             + AI summary, saved to S.p7WebResearch.
 *
 * HARD RULE: This module NEVER auto-sends email / WhatsApp.
 * Imported OSM results only create customer records — no send.
 * All CSS classes use the p7- prefix. Code comments English,
 * UI labels Chinese.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init (already wired into app.js load/persist) ──
  if(!S.p7BestSendTimes) S.p7BestSendTimes = {};
  if(!Array.isArray(S.p7OsmSearches)) S.p7OsmSearches = [];
  if(!S.p7OsmCache) S.p7OsmCache = {};
  if(!S.p7DataSources) S.p7DataSources = {
    ai_search: { enabled: true, name: 'AI搜索' },
    customs:   { enabled: true, name: '海关数据' },
    osm:       { enabled: true, name: 'OSM本地商家' }
  };
  if(!S.p7MarketRotation) S.p7MarketRotation = { currentMarket:'', stats:{}, lastRecommendation: null };
  if(!Array.isArray(S.p7WebResearch)) S.p7WebResearch = [];

  // ── Nav injection (5 entries, all reachable from sidebar) ──
  NAV.push({
    key: 'predictiveSending',
    icon: '⏰',
    label: '最佳发送时间',
    title: 'Predictive Sending · 按客户最佳时间发送',
    crumb: '历史打开分析 · 时段/星期推荐'
  });
  NAV.push({
    key: 'osmSearch',
    icon: '🗺️',
    label: 'OSM搜客',
    title: 'OpenStreetMap 本地商家搜客',
    crumb: '免费Overpass API · 按城市/品类搜商家'
  });
  NAV.push({
    key: 'dataSources',
    icon: '🔌',
    label: '数据源插件',
    title: '数据源插件化接口',
    crumb: 'AI搜索 · 海关 · OSM 统一管理'
  });
  NAV.push({
    key: 'marketRotation',
    icon: '🌍',
    label: '市场轮换',
    title: '新兴市场轮换找客',
    crumb: '非洲 · 中东 · 东南亚 · 拉美'
  });
  NAV.push({
    key: 'webResearch',
    icon: '🔎',
    label: '网站研究',
    title: '网页研究 Agent（简化版）',
    crumb: '抓取客户官网 + AI结构化摘要'
  });

  // ── Local helpers ───────────────────────────────────────────
  function p7NowISO(){ return new Date().toISOString(); }

  function p7FmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function p7FmtTime(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return p7FmtDate(iso)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }
  function p7FindCustomer(id){
    return (S.customers||[]).find(function(x){ return x.id === id; }) || null;
  }
  function p7CustomerCountry(c){
    return (c && (c.country || (c.address && c.address.country) || '')) || '';
  }
  function p7CustomerCity(c){
    return (c && (c.city || (c.address && c.address.city) || '')) || '';
  }

  // Robust JSON extraction from AI response (handles ```json blocks)
  function p7ParseAIJSON(content){
    if(!content) return null;
    try{
      var m = content.match(/```json\s*([\s\S]*?)```/);
      if(m && m[1]) return JSON.parse(m[1]);
      m = content.match(/\{[\s\S]*\}/);
      if(m) return JSON.parse(m[0]);
      return null;
    }catch(e){
      console.warn('[p7] AI JSON parse failed:', e, content);
      return null;
    }
  }

  // ── Feature 23: Predictive Sending ─────────────────────────
  // Country code → UTC offset (hours). Simple mapping for common B2B markets.
  var P7_TZ_MAP = {
    'US': -5, 'USA': -5, 'United States': -5, 'America': -5,
    'CA': -5, 'Canada': -5,
    'UK': 0, 'GB': 0, 'United Kingdom': 0, 'Britain': 0,
    'DE': 1, 'Germany': 1, 'FR': 1, 'France': 1, 'IT': 1, 'Italy': 1, 'ES': 1, 'Spain': 1, 'NL': 1, 'Netherlands': 1,
    'AU': 10, 'Australia': 10,
    'NZ': 12, 'New Zealand': 12,
    'JP': 9, 'Japan': 9,
    'KR': 9, 'Korea': 9, 'South Korea': 9,
    'UAE': 4, 'AE': 4, 'Dubai': 4,
    'SA': 3, 'Saudi': 3, 'Saudi Arabia': 3,
    'BR': -3, 'Brazil': -3,
    'ZA': 2, 'South Africa': 2,
    'NG': 1, 'Nigeria': 1,
    'KE': 3, 'Kenya': 3,
    'EG': 2, 'Egypt': 2,
    'VN': 7, 'Vietnam': 7,
    'TH': 7, 'Thailand': 7,
    'ID': 7, 'Indonesia': 7,
    'MY': 8, 'Malaysia': 8,
    'SG': 8, 'Singapore': 8,
    'PH': 8, 'Philippines': 8,
    'MX': -6, 'Mexico': -6,
    'CL': -4, 'Chile': -4,
    'AR': -3, 'Argentina': -3,
    'CO': -5, 'Colombia': -5,
    'IN': 5.5, 'India': 5.5,
    'PK': 5, 'Pakistan': 5,
    'TR': 3, 'Turkey': 3, 'Türkiye': 3,
    'RU': 3, 'Russia': 3,
    'PL': 1, 'Poland': 1,
    'SE': 1, 'Sweden': 1,
    'NO': 1, 'Norway': 1,
    'DK': 1, 'Denmark': 1,
    'FI': 2, 'Finland': 2,
    'CH': 1, 'Switzerland': 1,
    'AT': 1, 'Austria': 1,
    'BE': 1, 'Belgium': 1,
    'PT': 0, 'Portugal': 0,
    'GR': 2, 'Greece': 2,
    'CZ': 1, 'Czech': 1,
    'HU': 1, 'Hungary': 1,
    'RO': 2, 'Romania': 2,
    'IL': 2, 'Israel': 2,
    'QA': 3, 'Qatar': 3,
    'KW': 3, 'Kuwait': 3,
    'BH': 3, 'Bahrain': 3,
    'OM': 4, 'Oman': 4,
    'JO': 3, 'Jordan': 3,
    'LB': 2, 'Lebanon': 2,
    'BD': 6, 'Bangladesh': 6,
    'LK': 5.5, 'Sri Lanka': 5.5
  };

  function p7InferTz(country){
    if(!country) return { offset: 8, label: 'UTC+8 (default)' };
    var c = String(country).trim();
    // exact match
    if(P7_TZ_MAP[c] != null){
      var off = P7_TZ_MAP[c];
      return { offset: off, label: 'UTC' + (off>=0?'+':'') + off };
    }
    // case-insensitive contains
    var lower = c.toLowerCase();
    var keys = Object.keys(P7_TZ_MAP);
    for(var i=0;i<keys.length;i++){
      if(lower.indexOf(keys[i].toLowerCase()) >= 0){
        var o = P7_TZ_MAP[keys[i]];
        return { offset: o, label: 'UTC' + (o>=0?'+':'') + o };
      }
    }
    return { offset: 8, label: 'UTC+8 (fallback)' };
  }

  // Re-analyze one customer: bucket open hours in customer's local time
  function p7AnalyzeCustomerOpens(c){
    if(!c) return null;
    var tz = p7InferTz(p7CustomerCountry(c));
    var records = (S.sendRecords||[]).filter(function(r){
      return r.customerId === c.id && r.openStatus === 'opened' && r.openedAt;
    });
    if(records.length < 3){
      return {
        timezone: tz.label,
        offset: tz.offset,
        openTimes: [],
        bestHour: null,
        bestDay: null,
        confidence: 'low',
        openCount: records.length,
        lastUpdated: p7NowISO()
      };
    }
    // hour histogram 0-23 in customer local time
    var hourHist = new Array(24).fill(0);
    var dayHist = new Array(7).fill(0); // 0=Sun..6=Sat
    records.forEach(function(r){
      var d = new Date(r.openedAt);
      if(isNaN(d.getTime())) return;
      // UTC hour + offset → local hour (mod 24)
      var utcHours = d.getUTCHours() + d.getUTCMinutes()/60;
      var local = utcHours + tz.offset;
      var h = Math.floor(((local % 24) + 24) % 24);
      hourHist[h]++;
      dayHist[d.getUTCDay()]++;
    });
    // best hour = argmax
    var bestHour = 0, max = -1;
    for(var i=0;i<24;i++){ if(hourHist[i] > max){ max = hourHist[i]; bestHour = i; } }
    // best day = argmax
    var bestDay = 0, maxD = -1;
    for(var j=0;j<7;j++){ if(dayHist[j] > maxD){ maxD = dayHist[j]; bestDay = j; } }
    // confidence by sample size
    var conf = records.length >= 10 ? 'high' : (records.length >= 5 ? 'medium' : 'low');
    return {
      timezone: tz.label,
      offset: tz.offset,
      openTimes: hourHist,
      bestHour: bestHour,
      bestDay: bestDay,
      confidence: conf,
      openCount: records.length,
      lastUpdated: p7NowISO()
    };
  }

  window.p7ReanalyzeBestTimes = function(){
    var n = 0;
    (S.customers||[]).forEach(function(c){
      var r = p7AnalyzeCustomerOpens(c);
      if(r){ S.p7BestSendTimes[c.id] = r; n++; }
    });
    persist();
    toast('✅ 已重新分析 ' + n + ' 个客户的最佳发送时间');
    renderView();
  };

  function p7DayLabel(d){
    return ['周日','周一','周二','周三','周四','周五','周六'][d] || '—';
  }

  // ── Feature 24: OSM Search ─────────────────────────────────
  if(!window._p7OsmState) window._p7OsmState = { loading:false, results:[], sort:'name' };

  window.p7OsmSearch = async function(){
    if(window._p7OsmState.loading){ toast('搜索中，请等待约3秒…','err'); return; }
    var catEl = document.getElementById('p7_osm_cat');
    var cityEl = document.getElementById('p7_osm_city');
    var countryEl = document.getElementById('p7_osm_country');
    var radiusEl = document.getElementById('p7_osm_radius');
    var limitEl = document.getElementById('p7_osm_limit');
    var category = catEl ? catEl.value : 'general';
    var city = cityEl ? cityEl.value.trim() : '';
    var country = countryEl ? countryEl.value.trim() : '';
    var radius = parseInt(radiusEl && radiusEl.value, 10) || 5000;
    var limit = parseInt(limitEl && limitEl.value, 10) || 25;
    if(!city || !country){ toast('请填写城市和国家','err'); return; }

    // front-end cache
    var cacheKey = category + '|' + city.toLowerCase() + '|' + country.toLowerCase() + '|' + radius + '|' + limit;
    if(S.p7OsmCache[cacheKey]){
      window._p7OsmState.results = S.p7OsmCache[cacheKey];
      renderView();
      toast('✅ 命中本地缓存，共 ' + window._p7OsmState.results.length + ' 条');
      return;
    }

    window._p7OsmState.loading = true;
    renderView();
    toast('搜索中，免费API约需3秒，请耐心等待…');
    try{
      var resp = await fetch('/api/osm/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: category, city: city, country: country, radius: radius, limit: limit })
      });
      var data = await resp.json();
      if(!data.success){ throw new Error(data.error || 'OSM搜索失败'); }
      window._p7OsmState.results = data.results || [];
      S.p7OsmCache[cacheKey] = window._p7OsmState.results;
      S.p7OsmSearches.push({
        id: uid(),
        category: category,
        city: city,
        country: country,
        radius: radius,
        resultCount: (data.results||[]).length,
        createdAt: p7NowISO()
      });
      persist();
      toast('✅ 找到 ' + (data.results||[]).length + ' 条商家');
    }catch(e){
      console.warn('[p7] osm search failed', e);
      toast('OSM搜索失败：' + (e.message||e), 'err');
    }finally{
      window._p7OsmState.loading = false;
      renderView();
    }
  };

  window.p7OsmSort = function(mode){
    window._p7OsmState.sort = mode;
    renderView();
  };

  // Import one OSM result as a new customer record. NEVER auto-send.
  window.p7OsmImport = function(idx){
    var r = window._p7OsmState.results[idx];
    if(!r) return;
    // dedupe by website+name
    var dup = (S.customers||[]).find(function(c){
      if(r.website && c.website && c.website === r.website) return true;
      if(c.company === r.name && c.city === r.city) return true;
      return false;
    });
    if(dup){ toast('该商家已存在于客户台账：' + dup.company, 'err'); return; }
    var nc = {
      id: uid(),
      company: r.name || 'Unknown ' + (r.category||'merchant'),
      country: r.country || '',
      city: r.city || '',
      address: r.address || '',
      website: r.website || '',
      phone: r.phone || '',
      contact: { email: r.email || '', phone: r.phone || '' },
      source: 'OSM',
      tags: ['osm_found', r.category || 'merchant'],
      status: '新线索',
      notes: 'Imported from OpenStreetMap Overpass. Category: ' + (r.category||'') +
             '. Lat/Lon: ' + (r.lat||'') + ',' + (r.lon||'') +
             '. Imported at ' + p7NowISO(),
      createdAt: p7NowISO()
    };
    S.customers.push(nc);
    try{ addTimelineEvent(nc.id, 'customer_created', '从OSM导入新客户', nc.company + ' · ' + nc.city + ', ' + nc.country); }catch(e){}
    persist();
    toast('✅ 已导入客户台账（未发送任何邮件/WhatsApp）');
    renderView();
  };

  // ── Feature 25: Data Sources registry ──────────────────────
  // Unified interface: every source implements search(params) and getStats().
  var P7_DATA_SOURCES = {
    ai_search: {
      name: 'AI搜索',
      description: '基于大模型的全网公开信息搜索（已在工作台其他模块使用）',
      type: 'AI',
      search: async function(params){
        // placeholder — actual AI search lives elsewhere; this is a stub
        return { results: [], note: 'AI搜索请前往线索/客户背调模块使用' };
      },
      getStats: function(){
        var searches = (S.p6BriefingHistory||[]).length + (S.p7WebResearch||[]).length;
        return { calls: searches, results: searches, imported: 0 };
      }
    },
    customs: {
      name: '海关数据',
      description: '基于公开海关提单数据的采购商/供应商线索（本项目为只读示例）',
      type: 'Customs',
      search: async function(params){
        return { results: [], note: '海关数据接口暂未开放，仅作插件化占位' };
      },
      getStats: function(){
        // estimate from customers tagged customs
        var n = (S.customers||[]).filter(function(c){ return String(c.source||'').indexOf('海关')>=0; }).length;
        return { calls: n, results: n, imported: n };
      }
    },
    osm: {
      name: 'OSM本地商家',
      description: 'OpenStreetMap Overpass 免费API，按城市/品类搜索本地商家',
      type: 'OSM',
      search: async function(params){
        var resp = await fetch('/api/osm/search', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(params || {})
        });
        return await resp.json();
      },
      getStats: function(){
        var searches = (S.p7OsmSearches||[]).length;
        var results = (S.p7OsmSearches||[]).reduce(function(a,s){ return a + (s.resultCount||0); }, 0);
        var imported = (S.customers||[]).filter(function(c){ return c.source === 'OSM'; }).length;
        return { calls: searches, results: results, imported: imported };
      }
    }
  };

  window.p7ToggleDataSource = function(key){
    if(!S.p7DataSources[key]) return;
    S.p7DataSources[key].enabled = !S.p7DataSources[key].enabled;
    persist();
    toast((S.p7DataSources[key].enabled?'✅ 已启用 ':'⏸ 已禁用 ') + S.p7DataSources[key].name);
    renderView();
  };

  window.p7TestDataSource = async function(key){
    toast('测试连接：' + key + '…');
    try{
      var src = P7_DATA_SOURCES[key];
      if(!src){ toast('未知数据源','err'); return; }
      if(key === 'osm'){
        var r = await src.search({ category:'general', city:'London', country:'UK', radius:2000, limit:3 });
        toast('✅ OSM测试成功，返回 ' + ((r.results||[]).length) + ' 条');
      } else {
        toast('ℹ️ ' + src.name + ' 为本地/占位源，无需联网测试');
      }
    }catch(e){
      toast('测试失败：' + (e.message||e), 'err');
    }
  };

  // ── Feature 27: Market Rotation ─────────────────────────────
  var P7_MARKETS = {
    africa: {
      name: '非洲',
      emoji: '🌍',
      countries: [
        { city: 'Lagos', country: 'NG', label: '尼日利亚 · Lagos' },
        { city: 'Johannesburg', country: 'ZA', label: '南非 · Johannesburg' },
        { city: 'Nairobi', country: 'KE', label: '肯尼亚 · Nairobi' }
      ],
      keywords: ['cooking utensils supplier','kitchenware distributor','outdoor gear importer']
    },
    middleeast: {
      name: '中东',
      emoji: '🕌',
      countries: [
        { city: 'Dubai', country: 'AE', label: '阿联酋 · Dubai' },
        { city: 'Riyadh', country: 'SA', label: '沙特 · Riyadh' }
      ],
      keywords: ['kitchen equipment trader','hardware wholesale','outdoor camping supplier']
    },
    seasia: {
      name: '东南亚',
      emoji: '🏝️',
      countries: [
        { city: 'Ho Chi Minh', country: 'VN', label: '越南 · 胡志明' },
        { city: 'Bangkok', country: 'TH', label: '泰国 · Bangkok' },
        { city: 'Jakarta', country: 'ID', label: '印尼 · Jakarta' }
      ],
      keywords: ['kitchenware manufacturer','cutlery distributor','outdoor retailer']
    },
    latam: {
      name: '拉美',
      emoji: '🌮',
      countries: [
        { city: 'Sao Paulo', country: 'BR', label: '巴西 · São Paulo' },
        { city: 'Mexico City', country: 'MX', label: '墨西哥 · Mexico City' },
        { city: 'Santiago', country: 'CL', label: '智利 · Santiago' }
      ],
      keywords: ['utensilios de cocina mayorista','cuchillos importador','outdoor equipment distribuidor']
    }
  };

  // Map country code to customers in that market
  function p7MarketStats(marketKey){
    var m = P7_MARKETS[marketKey];
    if(!m) return { total:0, replied:0, won:0, replyRate:0, winRate:0 };
    var codes = m.countries.map(function(c){ return c.country; });
    var custs = (S.customers||[]).filter(function(c){
      var co = String(p7CustomerCountry(c)||'').toUpperCase();
      return codes.some(function(code){ return co === code || co.indexOf(code) >= 0; });
    });
    var total = custs.length;
    var replied = custs.filter(function(c){
      return c.status === '已回复' || c.status === 'replied';
    }).length;
    var won = custs.filter(function(c){
      return String(c.status||'').indexOf('成交') >= 0 || String(c.status||'').indexOf('won') >= 0;
    }).length;
    return {
      total: total,
      replied: replied,
      won: won,
      replyRate: total ? Math.round(replied/total*100) : 0,
      winRate: total ? Math.round(won/total*100) : 0
    };
  }

  window.p7SetCurrentMarket = function(key){
    S.p7MarketRotation.currentMarket = key;
    persist();
    toast('✅ 已将重点市场切换为：' + (P7_MARKETS[key] ? P7_MARKETS[key].name : key));
    renderView();
  };

  window.p7OsmSearchInMarket = function(city, country){
    // jump to OSM search page and prefill city/country via window state
    window._p7OsmPrefill = { city: city, country: country };
    go('osmSearch');
    toast('已跳转OSM搜客，城市/国家已预填，请点击搜索');
  };

  window.p7AIRecommendMarket = async function(){
    toast('AI 正在分析各市场客户覆盖度…');
    var statsSummary = {};
    Object.keys(P7_MARKETS).forEach(function(k){
      statsSummary[k] = { name: P7_MARKETS[k].name, stats: p7MarketStats(k) };
    });
    var prompt = '你是B2B外贸市场策略顾问。当前各新兴市场客户覆盖数据：\n'
      + JSON.stringify(statsSummary, null, 2) + '\n'
      + '请推荐"下一个重点市场"，要求：客户数最少但潜力大（关键词需求强、市场空白）。\n'
      + '只输出JSON：{"recommend":"marketKey","reason":"中文一句话理由"}。';
    try{
      var r = await callAI(
        [{ role:'user', content: prompt }],
        { purpose:'p7_market_rotation', timeout:45000, temperature:0.3, model:'gpt-5.6-terra' }
      );
      if(r.error){ toast('AI分析失败：' + (r.error||'未知错误'), 'err'); return; }
      var j = p7ParseAIJSON(r.content);
      if(!j || !j.recommend || !P7_MARKETS[j.recommend]){
        // fallback: pick market with lowest total customers
        var bestK = null, minN = 999999;
        Object.keys(statsSummary).forEach(function(k){
          if(statsSummary[k].stats.total < minN){ minN = statsSummary[k].stats.total; bestK = k; }
        });
        j = { recommend: bestK, reason: '（AI返回异常，按客户数最少自动推荐）' };
      }
      S.p7MarketRotation.lastRecommendation = {
        market: j.recommend,
        reason: j.reason,
        at: p7NowISO()
      };
      S.p7MarketRotation.currentMarket = j.recommend;
      persist();
      toast('✅ AI推荐下一重点市场：' + P7_MARKETS[j.recommend].name);
      renderView();
    }catch(e){
      console.warn('[p7] market recommend failed', e);
      toast('AI分析出错：' + (e.message||e), 'err');
    }
  };

  // ── Feature 34: Web Research Agent (simplified) ───────────
  window.p7RunWebResearch = async function(){
    var urlEl = document.getElementById('p7_wr_url');
    var cidEl = document.getElementById('p7_wr_cust');
    var url = urlEl ? urlEl.value.trim() : '';
    if(!url){ toast('请输入客户网站URL','err'); return; }
    if(url.indexOf('http') !== 0){ url = 'https://' + url; }
    var customerId = cidEl ? cidEl.value : '';
    var customer = customerId ? p7FindCustomer(customerId) : null;

    toast('正在抓取 ' + url + ' …');
    try{
      var resp = await fetch('/api/fetch', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url: url })
      });
      var data = await resp.json();
      var content = (data && (data.text || data.content || data.html || '')) || '';
      if(!content){ throw new Error('抓取内容为空'); }
      // trim to avoid huge prompts
      var clipped = content.replace(/\s+/g,' ').slice(0, 6000);

      toast('AI 正在生成结构化摘要…');
      var prompt = '你是B2B外贸客户背调分析师。以下是客户官网抓取内容：\n"""\n' + clipped + '\n"""\n'
        + '请用英文输出JSON，字段：business(一句话业务描述), products(主营产品范围), targetMarket(目标市场), '
        + 'contactInfo(提取到的邮箱/电话/地址,没有就空字符串), entryPoint(中文,建议的合作切入点1-2句)。'
        + '只输出JSON，不要其他文字。';
      var r = await callAI(
        [{ role:'user', content: prompt }],
        { purpose:'p7_web_research', timeout:60000, temperature:0.2, model:'gpt-5.6-terra' }
      );
      if(r.error){ toast('AI摘要失败：' + (r.error||'未知错误'), 'err'); return; }
      var j = p7ParseAIJSON(r.content) || {};
      var rec = {
        id: uid(),
        customerId: customerId || null,
        customerName: customer ? customer.company : '',
        url: url,
        summary: r.content,
        business: j.business || '',
        products: j.products || '',
        targetMarket: j.targetMarket || '',
        contactInfo: j.contactInfo || '',
        entryPoint: j.entryPoint || '',
        createdAt: p7NowISO()
      };
      S.p7WebResearch.push(rec);
      if(customer){
        try{ addTimelineEvent(customerId, 'web_research', '完成客户网站背调', url); }catch(e){}
      }
      persist();
      toast('✅ 研究完成，已保存到历史记录');
      renderView();
    }catch(e){
      console.warn('[p7] web research failed', e);
      toast('研究失败：' + (e.message||e), 'err');
    }
  };

  // Append AI summary to customer notes
  window.p7WrToNotes = function(rid){
    var rec = (S.p7WebResearch||[]).find(function(x){ return x.id === rid; });
    if(!rec || !rec.customerId){ toast('该研究未关联客户','err'); return; }
    var c = p7FindCustomer(rec.customerId);
    if(!c){ toast('客户不存在','err'); return; }
    var block = '\n\n[Website Research ' + p7FmtDate(rec.createdAt) + ']\nURL: ' + rec.url
      + '\nBusiness: ' + rec.business
      + '\nProducts: ' + rec.products
      + '\nTarget Market: ' + rec.targetMarket
      + '\nContact: ' + rec.contactInfo
      + '\nEntry Point: ' + rec.entryPoint + '\n';
    c.notes = (c.notes || '') + block;
    try{ addTimelineEvent(c.id, 'notes_updated', '背调摘要已写入客户备注', rec.url); }catch(e){}
    persist();
    toast('✅ 已追加到客户备注');
    renderView();
  };

  window.p7DeleteWr = function(rid){
    S.p7WebResearch = (S.p7WebResearch||[]).filter(function(x){ return x.id !== rid; });
    persist(); toast('已删除研究记录'); renderView();
  };

  // ── Tab state (for multi-view pages) ───────────────────────
  if(!window._p7WrTab) window._p7WrTab = 'form';
  window.p7SetWrTab = function(t){ window._p7WrTab = t; renderView(); };

  // ============================================================
  // RENDER: Feature 23 — Predictive Sending
  // ============================================================
  function p7RenderPredictive(root){
    // global hour histogram (UTC, across all opens)
    var globalHour = new Array(24).fill(0);
    (S.sendRecords||[]).forEach(function(r){
      if(r.openStatus === 'opened' && r.openedAt){
        var d = new Date(r.openedAt);
        if(!isNaN(d.getTime())) globalHour[d.getUTCHours()]++;
      }
    });
    var maxG = Math.max.apply(null, globalHour.concat([1]));

    // ensure bestSendTimes computed for all customers (lazy)
    (S.customers||[]).forEach(function(c){
      if(!S.p7BestSendTimes[c.id]) S.p7BestSendTimes[c.id] = p7AnalyzeCustomerOpens(c);
    });

    var h = '<div class="p7-page">';

    // stat cards
    var nCustomers = (S.customers||[]).length;
    var nEnough = (S.customers||[]).filter(function(c){
      var b = S.p7BestSendTimes[c.id];
      return b && b.openCount >= 3;
    }).length;
    var nHigh = (S.customers||[]).filter(function(c){
      var b = S.p7BestSendTimes[c.id];
      return b && b.confidence === 'high';
    }).length;
    h += '<div class="p7-stats">'
      + '<div class="p7-stat"><div class="p7-stat-num">' + nCustomers + '</div><div class="p7-stat-lbl">👥 客户总数</div></div>'
      + '<div class="p7-stat p7-a"><div class="p7-stat-num">' + nEnough + '</div><div class="p7-stat-lbl">📊 数据充足客户</div></div>'
      + '<div class="p7-stat p7-warn"><div class="p7-stat-num">' + nHigh + '</div><div class="p7-stat-lbl">🎯 高置信度客户</div></div>'
      + '<div class="p7-stat"><button class="btn btn-sm btn-primary" onclick="p7ReanalyzeBestTimes()">🔄 重新分析全部客户</button></div>'
      + '</div>';

    // global hour bar chart
    h += '<div class="p7-panel"><div class="p7-panel-head">📈 全局打开时段分布（UTC）</div>';
    h += '<div class="p7-barchart">';
    for(var i=0;i<24;i++){
      var hgt = Math.round(globalHour[i] / maxG * 100);
      h += '<div class="p7-bar-col" title="' + i + ':00 — ' + globalHour[i] + '次打开">'
        + '<div class="p7-bar-fill" style="height:' + hgt + '%"></div>'
        + '<div class="p7-bar-x">' + i + '</div></div>';
    }
    h += '</div>';
    h += '<div class="p7-hint">提示：柱子越高代表该小时打开次数越多。实际发送时请换算到客户本地时区。</div>';
    h += '</div>';

    // customer list
    h += '<div class="p7-panel"><div class="p7-panel-head">👥 各客户预测最佳发送时间</div>';
    var list = (S.customers||[]).slice().sort(function(a,b){
      var ba = S.p7BestSendTimes[a.id] || {}, bb = S.p7BestSendTimes[b.id] || {};
      return (bb.openCount||0) - (ba.openCount||0);
    });
    if(list.length === 0){
      h += '<div class="p7-empty">还没有客户，请先导入客户。</div>';
    } else {
      h += '<table class="p7-table"><thead><tr>'
        + '<th>客户</th><th>国家/时区</th><th>历史打开</th><th>最佳时段(本地)</th><th>最佳星期</th><th>置信度</th><th>建议</th>'
        + '</tr></thead><tbody>';
      list.forEach(function(c){
        var b = S.p7BestSendTimes[c.id] || { openCount:0, confidence:'low', bestHour:null, bestDay:null, timezone:'—' };
        var enough = b.openCount >= 3;
        var suggest = enough
          ? ('本地 ' + (b.bestHour!=null?String(b.bestHour).padStart(2,'0'):'—') + ':00 · ' + p7DayLabel(b.bestDay))
          : '数据不足，建议默认上午9-11点发送';
        var confBadge = b.confidence === 'high' ? '<span class="p7-badge green">高</span>'
          : (b.confidence === 'medium' ? '<span class="p7-badge blue">中</span>' : '<span class="p7-badge gray">低</span>');
        h += '<tr>'
          + '<td class="p7-cust-name">' + esc(c.company) + '</td>'
          + '<td>' + esc(p7CustomerCountry(c) || '—') + '<br><small>' + esc(b.timezone || '—') + '</small></td>'
          + '<td>' + (b.openCount||0) + ' 次</td>'
          + '<td>' + (enough ? (b.bestHour!=null?String(b.bestHour).padStart(2,'0')+':00':'—') : '—') + '</td>'
          + '<td>' + (enough ? p7DayLabel(b.bestDay) : '—') + '</td>'
          + '<td>' + confBadge + '</td>'
          + '<td class="p7-reason">' + esc(suggest) + '</td>'
          + '</tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div>';

    // Today's send tasks sorted by best time (if S.dailySendTasks exists)
    var tasks = (S.dailySendTasks && S.dailySendTasks.tasks) || [];
    if(tasks.length){
      h += '<div class="p7-panel"><div class="p7-panel-head">📌 今日发送任务（按最佳时间排序）</div>';
      var sorted = tasks.slice().sort(function(a,b){
        var ca = a.customerId && S.p7BestSendTimes[a.customerId];
        var cb = b.customerId && S.p7BestSendTimes[b.customerId];
        return ((ca&&ca.bestHour)||12) - ((cb&&cb.bestHour)||12);
      });
      h += '<div class="p7-tasklist">';
      sorted.forEach(function(t){
        var c = p7FindCustomer(t.customerId);
        var b = t.customerId && S.p7BestSendTimes[t.customerId];
        h += '<div class="p7-task-item">'
          + '<span class="p7-task-who">' + esc(c ? c.company : (t.email||'')) + '</span>'
          + '<span class="p7-task-when">' + (b && b.bestHour!=null ? '建议 ' + String(b.bestHour).padStart(2,'0') + ':00 ' + p7DayLabel(b.bestDay) : '默认上午9-11点') + '</span>'
          + '</div>';
      });
      h += '</div></div>';
    }

    h += '</div>';
    root.innerHTML = h;
  }

  // ============================================================
  // RENDER: Feature 24 — OSM Search
  // ============================================================
  function p7RenderOsm(root){
    // apply prefill from market rotation jump
    if(window._p7OsmPrefill){
      // we set defaults via value attribute below; just note
      var pre = window._p7OsmPrefill;
      setTimeout(function(){
        var cEl = document.getElementById('p7_osm_city');
        var coEl = document.getElementById('p7_osm_country');
        if(cEl) cEl.value = pre.city;
        if(coEl) coEl.value = pre.country;
        window._p7OsmPrefill = null;
      }, 0);
    }
    var st = window._p7OsmState;
    var h = '<div class="p7-page">';
    h += '<div class="p7-panel"><div class="p7-panel-head">🗺️ OpenStreetMap Overpass 免费搜客</div>';
    h += '<div class="p7-formgrid">'
      + '<label>品类<select class="p7-input" id="p7_osm_cat">'
      + '<option value="kitchen">厨房用品 (kitchen)</option>'
      + '<option value="knives">刀具 (knives)</option>'
      + '<option value="outdoor">户外用品 (outdoor)</option>'
      + '<option value="general">综合 (general)</option>'
      + '</select></label>'
      + '<label>城市<input class="p7-input" id="p7_osm_city" placeholder="如 Dubai" /></label>'
      + '<label>国家代码<input class="p7-input" id="p7_osm_country" placeholder="如 AE" /></label>'
      + '<label>半径(m)<input class="p7-input" id="p7_osm_radius" type="number" value="5000" /></label>'
      + '<label>结果数<input class="p7-input" id="p7_osm_limit" type="number" value="25" /></label>'
      + '</div>';
    h += '<div class="p7-actions">'
      + '<button class="btn btn-primary" onclick="p7OsmSearch()" ' + (st.loading?'disabled':'') + '>'
      + (st.loading ? '⏳ 搜索中（约3秒）…' : '🔍 开始搜索') + '</button>'
      + '<span class="p7-hint">免费API，搜索间隔约3秒，请耐心等待。导入仅创建客户记录，不会自动发送。</span>'
      + '</div>';
    h += '</div>';

    // results
    if(st.results.length){
      h += '<div class="p7-panel"><div class="p7-panel-head">📋 搜索结果 (' + st.results.length + ')'
        + '<span class="p7-actions">'
        + '<button class="btn btn-sm btn-outline" onclick="p7OsmSort(\'name\')" ' + (st.sort==='name'?'style="background:#3182ce;color:#fff"':'') + '>按名称</button>'
        + '</span></div>';
      h += '<div class="p7-osm-list">';
      st.results.forEach(function(r, idx){
        h += '<div class="p7-osm-card">'
          + '<div class="p7-osm-head"><b>' + esc(r.name||'(未命名)') + '</b>'
          + '<span class="p7-tag">' + esc(r.category||'merchant') + '</span></div>'
          + '<div class="p7-osm-addr">📍 ' + esc(r.address||'') + ', ' + esc(r.city||'') + ', ' + esc(r.country||'') + '</div>'
          + '<div class="p7-osm-meta">'
          + (r.lat ? '<span>🌐 ' + Number(r.lat).toFixed(4) + ',' + Number(r.lon).toFixed(4) + '</span>' : '')
          + (r.website ? '<span>🔗 <a href="' + esc(r.website) + '" target="_blank" rel="noopener">' + esc(r.website) + '</a></span>' : '')
          + (r.phone ? '<span>📞 ' + esc(r.phone) + '</span>' : '')
          + (r.email ? '<span>✉️ ' + esc(r.email) + '</span>' : '')
          + '</div>'
          + '<div class="p7-actions"><button class="btn btn-sm btn-primary" onclick="p7OsmImport(' + idx + ')">➕ 导入客户台账</button></div>'
          + '</div>';
      });
      h += '</div></div>';
    } else if(!st.loading){
      h += '<div class="p7-empty">输入城市/国家后点击"开始搜索"。</div>';
    }

    // search history
    var hist = (S.p7OsmSearches||[]).slice().reverse().slice(0, 10);
    if(hist.length){
      h += '<div class="p7-panel"><div class="p7-panel-head">🕘 最近搜索历史</div>';
      h += '<table class="p7-table"><thead><tr><th>时间</th><th>品类</th><th>城市</th><th>国家</th><th>半径</th><th>结果数</th></tr></thead><tbody>';
      hist.forEach(function(s){
        h += '<tr><td>' + p7FmtTime(s.createdAt) + '</td>'
          + '<td>' + esc(s.category||'') + '</td>'
          + '<td>' + esc(s.city||'') + '</td>'
          + '<td>' + esc(s.country||'') + '</td>'
          + '<td>' + (s.radius||0) + 'm</td>'
          + '<td>' + (s.resultCount||0) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }

    h += '</div>';
    root.innerHTML = h;
  }

  // ============================================================
  // RENDER: Feature 25 — Data Sources
  // ============================================================
  function p7RenderDataSources(root){
    var h = '<div class="p7-page">';
    h += '<div class="p7-panel"><div class="p7-panel-head">🔌 数据源插件化接口</div>'
      + '<div class="p7-hint">每个数据源统一实现 <code>search(params)</code> 与 <code>getStats()</code> 接口，可独立启停、测试、扩展。</div></div>';

    h += '<div class="p7-ds-grid">';
    Object.keys(P7_DATA_SOURCES).forEach(function(key){
      var src = P7_DATA_SOURCES[key];
      var cfg = S.p7DataSources[key] || { enabled: true, name: src.name };
      var stats = src.getStats();
      h += '<div class="p7-ds-card' + (cfg.enabled ? '' : ' off') + '">'
        + '<div class="p7-ds-head"><b>' + esc(src.name) + '</b>'
        + '<span class="p7-badge ' + (cfg.enabled?'green':'gray') + '">' + (cfg.enabled?'启用':'禁用') + '</span></div>'
        + '<div class="p7-ds-type">类型：' + esc(src.type) + '</div>'
        + '<div class="p7-ds-desc">' + esc(src.description) + '</div>'
        + '<div class="p7-ds-stats">'
        + '<div><span>🔍 调用</span><b>' + stats.calls + '</b></div>'
        + '<div><span>📋 结果</span><b>' + stats.results + '</b></div>'
        + '<div><span>👥 导入</span><b>' + stats.imported + '</b></div>'
        + '</div>'
        + '<div class="p7-actions">'
        + '<button class="btn btn-sm btn-outline" onclick="p7ToggleDataSource(\'' + key + '\')">' + (cfg.enabled?'⏸ 禁用':'▶ 启用') + '</button>'
        + '<button class="btn btn-sm btn-primary" onclick="p7TestDataSource(\'' + key + '\')">🧪 测试连接</button>'
        + '</div>'
        + '</div>';
    });
    h += '</div>';

    // register new source placeholder / interface spec
    h += '<div class="p7-panel"><div class="p7-panel-head">➕ 注册新数据源（占位 / 接口规范）</div>';
    h += '<div class="p7-hint">未来扩展新数据源时，按以下规范在 <code>P7_DATA_SOURCES</code> 中注册一个对象：</div>';
    h += '<pre class="p7-code">{\n'
      + '  key: \'my_source\',\n'
      + '  name: \'我的数据源\',\n'
      + '  type: \'Custom\',\n'
      + '  description: \'一句话描述\',\n'
      + '  search: async function(params){ return { results: [], total: 0 }; },\n'
      + '  getStats: function(){ return { calls:0, results:0, imported:0 }; }\n'
      + '}</pre>';
    h += '<div class="p7-hint">然后在 <code>S.p7DataSources</code> 中设置 <code>enabled:true</code>。本工作台所有数据源均为免费公开源，无需API Key。</div>';
    h += '</div>';

    h += '</div>';
    root.innerHTML = h;
  }

  // ============================================================
  // RENDER: Feature 27 — Market Rotation
  // ============================================================
  function p7RenderMarket(root){
    var h = '<div class="p7-page">';
    var lastRec = S.p7MarketRotation.lastRecommendation;
    h += '<div class="p7-panel"><div class="p7-panel-head">🌍 新兴市场轮换找客</div>'
      + '<div class="p7-actions">'
      + '<button class="btn btn-primary" onclick="p7AIRecommendMarket()">✨ AI 推荐下一重点市场</button>'
      + (lastRec ? '<span class="p7-hint">上次推荐：' + esc(P7_MARKETS[lastRec.market] ? P7_MARKETS[lastRec.market].name : lastRec.market) + ' — ' + esc(lastRec.reason || '') + ' (' + p7FmtDate(lastRec.at) + ')</span>' : '')
      + '</div>'
      + '</div>';

    h += '<div class="p7-mkt-grid">';
    Object.keys(P7_MARKETS).forEach(function(key){
      var m = P7_MARKETS[key];
      var st = p7MarketStats(key);
      var isCurrent = S.p7MarketRotation.currentMarket === key;
      h += '<div class="p7-mkt-card' + (isCurrent?' cur':'') + '">'
        + '<div class="p7-mkt-head">' + m.emoji + ' <b>' + esc(m.name) + '</b>'
        + (isCurrent ? '<span class="p7-badge blue">当前重点</span>' : '') + '</div>'
        + '<div class="p7-mkt-countries">' + m.countries.map(function(c){ return esc(c.label); }).join(' · ') + '</div>'
        + '<div class="p7-mkt-kw"><b>关键词：</b>' + m.keywords.map(function(k){ return '<code>'+esc(k)+'</code>'; }).join(' ') + '</div>'
        + '<div class="p7-mkt-stats">'
        + '<div><span>客户数</span><b>' + st.total + '</b></div>'
        + '<div><span>回复率</span><b>' + st.replyRate + '%</b></div>'
        + '<div><span>成交率</span><b>' + st.winRate + '%</b></div>'
        + '</div>'
        + '<div class="p7-actions">'
        + '<button class="btn btn-sm btn-primary" onclick="p7SetCurrentMarket(\'' + key + '\')">🎯 设为重点市场</button>'
        + '</div>'
        + '<div class="p7-mkt-cities">';
      m.countries.forEach(function(c){
        h += '<button class="btn btn-sm btn-outline" onclick="p7OsmSearchInMarket(\'' + esc(c.city) + '\',\'' + esc(c.country) + '\')">🗺️ ' + esc(c.city) + '</button>';
      });
      h += '</div></div>';
    });
    h += '</div>';

    h += '</div>';
    root.innerHTML = h;
  }

  // ============================================================
  // RENDER: Feature 34 — Web Research
  // ============================================================
  function p7RenderWr(root){
    var h = '<div class="p7-page">';
    h += '<div class="p7-tabs">'
      + '<div class="p7-tab' + (window._p7WrTab==='form'?' on':'') + '" onclick="p7SetWrTab(\'form\')">🔍 新建研究</div>'
      + '<div class="p7-tab' + (window._p7WrTab==='history'?' on':'') + '" onclick="p7SetWrTab(\'history\')">🕘 历史记录 (' + (S.p7WebResearch||[]).length + ')</div>'
      + '</div>';

    if(window._p7WrTab === 'form'){
      h += '<div class="p7-panel"><div class="p7-panel-head">🔎 输入客户网站URL，AI自动抓取并生成结构化摘要</div>';
      h += '<div class="p7-formgrid">'
        + '<label>客户网站 URL<input class="p7-input" id="p7_wr_url" placeholder="https://example.com" /></label>'
        + '<label>关联客户<select class="p7-input" id="p7_wr_cust"><option value="">（暂不关联）</option>'
        + (S.customers||[]).map(function(c){ return '<option value="'+c.id+'">'+esc(c.company)+'</option>'; }).join('')
        + '</select></label>'
        + '</div>';
      h += '<div class="p7-actions"><button class="btn btn-primary" onclick="p7RunWebResearch()">🚀 开始研究（抓取+AI摘要）</button>'
        + '<span class="p7-hint">单页抓取，非自主浏览Agent。结果自动保存，可一键写入客户备注。</span></div>';
      h += '</div>';
    } else {
      h += '<div class="p7-panel"><div class="p7-panel-head">🕘 研究历史</div>';
      var list = (S.p7WebResearch||[]).slice().reverse();
      if(list.length === 0){
        h += '<div class="p7-empty">暂无研究记录。从"新建研究"开始。</div>';
      } else {
        list.forEach(function(r){
          h += '<div class="p7-wr-card">'
            + '<div class="p7-wr-head"><b>' + esc(r.customerName||'(未关联)') + '</b>'
            + '<span class="p7-tag">' + p7FmtTime(r.createdAt) + '</span></div>'
            + '<div class="p7-wr-url">🔗 <a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.url) + '</a></div>'
            + (r.business ? '<div class="p7-wr-row"><b>业务：</b>' + esc(r.business) + '</div>' : '')
            + (r.products ? '<div class="p7-wr-row"><b>产品：</b>' + esc(r.products) + '</div>' : '')
            + (r.targetMarket ? '<div class="p7-wr-row"><b>目标市场：</b>' + esc(r.targetMarket) + '</div>' : '')
            + (r.contactInfo ? '<div class="p7-wr-row"><b>联系方式：</b>' + esc(r.contactInfo) + '</div>' : '')
            + (r.entryPoint ? '<div class="p7-wr-row p7-wr-entry"><b>合作切入点：</b>' + esc(r.entryPoint) + '</div>' : '')
            + '<div class="p7-actions">'
            + (r.customerId ? '<button class="btn btn-sm btn-primary" onclick="p7WrToNotes(\'' + r.id + '\')">📝 写入客户备注</button>' : '')
            + '<button class="btn btn-sm btn-outline" onclick="p7DeleteWr(\'' + r.id + '\')">🗑 删除</button>'
            + '</div>'
            + '</div>';
        });
      }
      h += '</div>';
    }

    h += '</div>';
    root.innerHTML = h;
  }

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    var main = document.getElementById('mainContent');
    if(!main){ _origRV.apply(this, arguments); return; }
    if(currentView === 'predictiveSending'){ p7RenderPredictive(main); return; }
    if(currentView === 'osmSearch'){ p7RenderOsm(main); return; }
    if(currentView === 'dataSources'){ p7RenderDataSources(main); return; }
    if(currentView === 'marketRotation'){ p7RenderMarket(main); return; }
    if(currentView === 'webResearch'){ p7RenderWr(main); return; }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p7- prefixed, responsive) ─────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p7-page{padding:4px;}'
    + '.p7-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}'
    + '.p7-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;display:flex;flex-direction:column;justify-content:center;align-items:center;}'
    + '.p7-stat-num{font-size:26px;font-weight:700;color:#2d3748;}'
    + '.p7-stat-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    + '.p7-stat.p7-a .p7-stat-num{color:#d69e2e;}'
    + '.p7-stat.p7-warn .p7-stat-num{color:#dd6b20;}'
    + '.p7-panel{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px;}'
    + '.p7-panel-head{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.p7-hint{font-size:12px;color:#718096;margin-top:8px;line-height:1.5;}'
    + '.p7-input{width:100%;padding:6px 8px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;box-sizing:border-box;}'
    + '.p7-formgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:10px;}'
    + '.p7-formgrid label{display:flex;flex-direction:column;font-size:12px;color:#718096;gap:4px;}'
    + '.p7-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;}'
    + '.p7-empty{padding:40px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.p7-badge{font-size:11px;padding:2px 10px;border-radius:10px;font-weight:600;color:#fff;}'
    + '.p7-badge.blue{background:#3182ce;}'
    + '.p7-badge.green{background:#38a169;}'
    + '.p7-badge.gray{background:#a0aec0;}'
    + '.p7-tag{font-size:11px;padding:2px 8px;border-radius:10px;background:#edf2f7;color:#4a5568;}'
    // bar chart (predictive)
    + '.p7-barchart{display:flex;align-items:flex-end;gap:4px;height:140px;padding:10px 4px 0;border-bottom:1px solid #e2e8f0;}'
    + '.p7-bar-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;}'
    + '.p7-bar-fill{width:100%;background:linear-gradient(180deg,#4299e1,#3182ce);border-radius:3px 3px 0 0;min-height:2px;}'
    + '.p7-bar-x{font-size:10px;color:#a0aec0;margin-top:4px;}'
    // table
    + '.p7-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:13px;}'
    + '.p7-table th{background:#f7fafc;text-align:left;padding:8px 10px;font-size:12px;color:#718096;border-bottom:1px solid #e2e8f0;}'
    + '.p7-table td{padding:8px 10px;border-bottom:1px solid #edf2f7;vertical-align:top;}'
    + '.p7-cust-name{font-weight:600;}'
    + '.p7-reason{color:#4a5568;font-size:12px;}'
    // task list
    + '.p7-tasklist{display:flex;flex-direction:column;gap:6px;}'
    + '.p7-task-item{display:flex;justify-content:space-between;padding:8px 10px;background:#f7fafc;border-radius:6px;font-size:13px;}'
    + '.p7-task-when{color:#3182ce;font-weight:600;}'
    // OSM cards
    + '.p7-osm-list{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}'
    + '.p7-osm-card{border:1px solid #e2e8f0;border-radius:8px;padding:10px;background:#fafcff;}'
    + '.p7-osm-head{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px;}'
    + '.p7-osm-addr{font-size:12px;color:#718096;margin:4px 0;}'
    + '.p7-osm-meta{font-size:12px;color:#4a5568;display:flex;gap:10px;flex-wrap:wrap;margin:6px 0;}'
    // data sources
    + '.p7-ds-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px;}'
    + '.p7-ds-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;border-top:4px solid #3182ce;}'
    + '.p7-ds-card.off{opacity:0.6;border-top-color:#a0aec0;}'
    + '.p7-ds-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}'
    + '.p7-ds-type{font-size:11px;color:#a0aec0;text-transform:uppercase;letter-spacing:1px;}'
    + '.p7-ds-desc{font-size:12px;color:#4a5568;margin:8px 0;line-height:1.5;}'
    + '.p7-ds-stats{display:flex;gap:10px;margin:10px 0;}'
    + '.p7-ds-stats div{flex:1;background:#f7fafc;border-radius:6px;padding:6px;text-align:center;}'
    + '.p7-ds-stats span{display:block;font-size:11px;color:#718096;}'
    + '.p7-ds-stats b{font-size:18px;color:#2d3748;}'
    + '.p7-code{background:#1a202c;color:#e2e8f0;padding:12px;border-radius:8px;font-size:12px;overflow:auto;}'
    // market
    + '.p7-mkt-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;}'
    + '.p7-mkt-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;border-left:4px solid #cbd5e0;}'
    + '.p7-mkt-card.cur{border-left-color:#d69e2e;box-shadow:0 0 0 2px rgba(214,158,46,.2);}'
    + '.p7-mkt-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:15px;}'
    + '.p7-mkt-countries{font-size:12px;color:#718096;margin-bottom:8px;}'
    + '.p7-mkt-kw{font-size:12px;color:#4a5568;margin-bottom:8px;line-height:1.8;}'
    + '.p7-mkt-kw code{background:#edf2f7;padding:1px 6px;border-radius:4px;font-size:11px;margin-right:4px;}'
    + '.p7-mkt-stats{display:flex;gap:10px;margin:10px 0;}'
    + '.p7-mkt-stats div{flex:1;background:#f7fafc;border-radius:6px;padding:6px;text-align:center;}'
    + '.p7-mkt-stats span{display:block;font-size:11px;color:#718096;}'
    + '.p7-mkt-stats b{font-size:18px;color:#2d3748;}'
    + '.p7-mkt-cities{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}'
    // web research
    + '.p7-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}'
    + '.p7-tab{padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;color:#4a5568;}'
    + '.p7-tab.on{background:#3182ce;color:#fff;border-color:#3182ce;font-weight:600;}'
    + '.p7-wr-card{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:10px;background:#fafcff;}'
    + '.p7-wr-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;}'
    + '.p7-wr-url{font-size:12px;color:#3182ce;margin-bottom:6px;}'
    + '.p7-wr-row{font-size:13px;color:#2d3748;margin:3px 0;}'
    + '.p7-wr-entry{background:#fefcbf;padding:6px 8px;border-radius:6px;}'
    // Responsive
    + '@media (max-width:768px){'
    + '  .p7-stats{grid-template-columns:1fr 1fr;}'
    + '  .p7-formgrid{grid-template-columns:1fr 1fr;}'
    + '  .p7-osm-list{grid-template-columns:1fr;}'
    + '  .p7-ds-grid{grid-template-columns:1fr;}'
    + '  .p7-mkt-grid{grid-template-columns:1fr;}'
    + '  .p7-table{display:block;overflow-x:auto;}'
    + '  .p7-actions{flex-direction:column;align-items:stretch;}'
    + '  .p7-barchart{height:100px;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
