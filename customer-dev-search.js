/* ============================================================
 * Customer Development Module: Search & Smart Filter
 * ----------------------------------------------------------------
 * Phase 1 — customer-dev-search.js
 *
 * Feature 1.1 : Multi-source web prospect discovery
 *   - POST /api/search (AI web search) + callAI structured extraction
 *   - Standalone-site mode / marketplace mode query wrapping
 *   - Built-in 4-category keyword matrix (outdoor/kitchen knives,
 *     scissors, kitchen accessories)
 *   - Batch multi-keyword search (one per line), merged & deduped
 *   - Result cards: 查看详情 / 导入台账 / AI背调
 *   - Search history persisted to S.cdSearchHistory
 *   - Import dedupe by website host / normalized company name
 *
 * Feature 1.4 : Smart customer filtering (over S.customers only,
 *               no mutation of existing ledger views)
 *   - Filters: category × region × customerType × intent × status
 *             × info-completeness × free keyword
 *   - Live stats: matched count, category mix, region mix
 *   - Saved smart groups to S.cdSmartGroups, one-click apply
 *
 * HARD RULES:
 *   - NEVER auto-send email / WhatsApp — this module only finds
 *     leads and creates customer records.
 *   - 100% free: only /api/search + /api/fetch + callAI, no paid APIs.
 *   - All CSS classes use the cd- prefix.
 *   - Code comments in English, UI labels in Chinese.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init (persisted via DB.load/persist in app.js) ──
  if(!Array.isArray(S.cdSearchHistory)) S.cdSearchHistory = [];
  if(!Array.isArray(S.cdSmartGroups)) S.cdSmartGroups = [];
  if(!Array.isArray(S.cdSearchResults)) S.cdSearchResults = [];
  // ephemeral UI state (not persisted)
  if(!window._cdState) window._cdState = { loading:false, log:[], sort:'score' };
  if(!window._cdFilter) window._cdFilter = {
    category:'all', region:'all', customerType:'all',
    intent:'all', status:'all', completeness:'all', keyword:''
  };

  // ── Nav injection ──
  NAV.push({
    key: 'customerDevSearch',
    icon: '🔍',
    label: '全网搜客',
    title: '全网搜客 · 多数据源客户发现',
    crumb: 'AI搜索 · 独立站 · 平台店铺 · 批量搜客'
  });
  NAV.push({
    key: 'customerDevFilter',
    icon: '🎯',
    label: '智能筛选',
    title: '客户智能筛选 · 多维客群',
    crumb: '品类×国家×类型×意向×状态'
  });

  // ============================================================
  // Constants
  // ============================================================

  // Four built-in category keyword matrices (English buyer-side queries).
  var CD_CATEGORIES = {
    outdoor_knives: {
      label: '户外刀',
      keywords: ['outdoor knife manufacturer','hunting knife supplier','EDC knife wholesale','tactical knife factory','pocket knife OEM']
    },
    kitchen_knives: {
      label: '厨房刀',
      keywords: ['kitchen knife manufacturer','chef knife supplier','kitchenware wholesale','knife set factory','santoku knife OEM']
    },
    professional_scissors: {
      label: '剪刀',
      keywords: ['scissors manufacturer','professional shears supplier','garden pruners wholesale','kitchen shears factory','tailor scissors OEM']
    },
    kitchen_accessories: {
      label: '厨房用品',
      keywords: ['kitchen accessories manufacturer','cooking utensils supplier','BBQ tools wholesale','cutting board factory','peeler grater OEM']
    }
  };

  // Region buckets → fuzzy country match keys (lowercase substring).
  var CD_REGIONS = {
    usa:        { label:'美国',   keys:['us','usa','united states','america','u.s.','u.s.a'] },
    europe:     { label:'欧洲',   keys:['germany','france','uk','united kingdom','britain','italy','spain','netherlands','holland','europe','poland','sweden','norway','denmark','finland','belgium','portugal','austria','switzerland','ireland','czech','hungary','luxembourg'] },
    middleeast: { label:'中东',   keys:['uae','emirates','dubai','saudi','israel','turkey','türkiye','qatar','kuwait','oman','jordan','lebanon','middle east','egypt','bahrain'] },
    seasia:     { label:'东南亚', keys:['vietnam','thailand','indonesia','malaysia','singapore','philippines','se asia','southeast asia'] },
    latam:      { label:'拉美',   keys:['brazil','mexico','chile','argentina','colombia','peru','latam'] },
    africa:     { label:'非洲',   keys:['nigeria','south africa','kenya','morocco','ghana','ethiopia','africa','tanzania','uganda','namibia'] }
  };

  var CD_CUSTOMER_TYPES = ['品牌商','进口商','分销商','电商卖家'];
  var CD_STATUSES = ['未开发','已开发','已回复','已报价','已成交','沉睡'];

  // ============================================================
  // Local helpers
  // ============================================================
  function cdNowISO(){ return new Date().toISOString(); }

  function cdFmtTime(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')
      +' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  // Robust extraction of a JSON array from an AI reply (```json blocks or bare [...] ).
  function cdParseAIArray(content){
    if(!content) return [];
    var raw = content;
    var m = content.match(/```json\s*([\s\S]*?)```/);
    if(m && m[1]) raw = m[1];
    // try to locate the first JSON array
    var arrMatch = raw.match(/\[[\s\S]*\]/);
    if(arrMatch){
      try {
        var arr = JSON.parse(arrMatch[0]);
        if(Array.isArray(arr)) return arr;
      } catch(e){ /* fall through */ }
    }
    // maybe AI wrapped it in an object
    var objMatch = raw.match(/\{[\s\S]*\}/);
    if(objMatch){
      try {
        var o = JSON.parse(objMatch[0]);
        if(Array.isArray(o)) return o;
        if(o && Array.isArray(o.results)) return o.results;
        if(o && Array.isArray(o.companies)) return o.companies;
      } catch(e){ /* fall through */ }
    }
    console.warn('[cd] AI array parse failed:', content);
    return [];
  }

  // Normalize a URL to its bare hostname for dedupe.
  function cdHost(url){
    if(!url) return '';
    var u = String(url).trim().toLowerCase();
    u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
    u = u.split('/')[0].split('?')[0].split('#')[0];
    return u;
  }

  // Best-guess display company name from a domain (fallback when AI gives nothing).
  function cdGuessName(url){
    var h = cdHost(url);
    if(!h) return 'Unknown Company';
    var parts = h.split('.');
    var word = parts[0] || h;
    return word.replace(/[-_]/g, ' ').replace(/\b\w/g, function(ch){ return ch.toUpperCase(); });
  }

  function cdFindCustomer(id){
    return (S.customers||[]).find(function(x){ return x.id === id; }) || null;
  }

  // Customer display name: spec field `name`, with legacy `company` fallback.
  function cdCustName(c){
    if(!c) return '';
    return c.name || c.company || '(未命名客户)';
  }
  function cdCustCountry(c){
    return (c && (c.country || (c.address && c.address.country) || '')) || '';
  }
  function cdCustType(c){
    if(!c) return '';
    return c.customerType || (c.cdProfile && c.cdProfile.customerType) || '';
  }
  function cdCustIntent(c){
    return (c && c.cdProfile && c.cdProfile.intentLevel) || '';
  }
  // Info-completeness score 0-100 for a customer record.
  function cdCustCompleteness(c){
    if(!c) return 0;
    if(c.cdCompleteness && typeof c.cdCompleteness.score === 'number') return c.cdCompleteness.score;
    var fields = ['email','phone','website','country','city','productCategory'];
    if(c.customerType || (c.cdProfile && c.cdProfile.customerType)) fields.push('customerType');
    if(c.decisionMaker) fields.push('decisionMaker');
    if(c.notes) fields.push('notes');
    var filled = fields.filter(function(f){
      var v = c[f];
      if(f === 'customerType') v = c.customerType || (c.cdProfile && c.cdProfile.customerType);
      if(f === 'notes') v = c.notes;
      return v && String(v).trim() !== '';
    }).length;
    return Math.round(filled / fields.length * 100);
  }

  // Map a free-text country to a region bucket key (or '').
  function cdRegionOf(country){
    if(!country) return '';
    var c = String(country).toLowerCase();
    var keys = Object.keys(CD_REGIONS);
    for(var i=0;i<keys.length;i++){
      var rk = keys[i];
      if(CD_REGIONS[rk].keys.some(function(k){ return c.indexOf(k) >= 0; })) return rk;
    }
    return '';
  }

  // Intent level inferred from a match score.
  function cdIntentOfScore(score){
    var s = Number(score) || 0;
    if(s >= 75) return '高';
    if(s >= 50) return '中';
    return '低';
  }

  // Completeness score of a raw search result card (used on import).
  function cdResultCompleteness(r){
    var filled = 0;
    var total = 6; // website, country, customerType, email, phone, name
    if(r.website) filled++;
    if(r.country) filled++;
    if(r.customerType) filled++;
    if(r.email) filled++;
    if(r.phone) filled++;
    if(r.name) filled++;
    return Math.round(filled / total * 100);
  }

  // ============================================================
  // Feature 1.1 — Search logic
  // ============================================================

  // Wrap the raw user keyword by the chosen search scope.
  function cdBuildQuery(keyword, scope){
    if(scope === 'standalone'){
      // Prefer independent brand/manufacturer sites, exclude marketplace giants.
      return '"' + keyword + '" -alibaba.com -amazon.com -made-in-china.com -indiamart.com -facebook.com -youtube.com';
    }
    if(scope === 'platform'){
      // Marketplace / platform listings (buyers, brand stores).
      return keyword + ' buyer wholesale site:alibaba.com OR site:amazon.com OR site:made-in-china.com';
    }
    return keyword;
  }

  // Search ONE keyword: /api/search → raw hits → callAI structured extraction.
  async function cdSearchOneKeyword(keyword, category, scope){
    var st = window._cdState;
    st.log.push('▶ 搜索：' + keyword);
    // 1) raw web search
    var query = cdBuildQuery(keyword, scope);
    var resp = await fetch('/api/search', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ query: query, maxResults: 10, searchDepth: 'basic' })
    });
    var data = await resp.json();
    if(data.error) throw new Error(data.error);
    var raw = data.results || [];
    if(raw.length === 0){
      st.log.push('  · 无搜索结果');
      return [];
    }
    // 2) compact digest for the LLM
    var digest = raw.map(function(r, i){
      return (i+1) + '. ' + (r.title||'') + ' | ' + (r.url||'') + '\n   ' + String(r.content || r.snippet || r.body || '').slice(0, 220);
    }).join('\n');

    var sys = 'You are a senior B2B export lead researcher for KaiLionCrafts, a Yangjiang (China) manufacturer '
      + 'specialized in outdoor knives, kitchen knives, scissors and kitchen accessories. We look for OVERSEAS '
      + 'buyers: brands, importers, distributors, e-commerce sellers — NOT Chinese suppliers, NOT news, NOT encyclopedias.';
    var user = 'Search keyword: "' + keyword + '"\n'
      + 'Category: ' + (CD_CATEGORIES[category] ? CD_CATEGORIES[category].label : category) + '\n\n'
      + 'Raw search results:\n' + digest + '\n\n'
      + 'From these results, extract real overseas companies that fit. Deduplicate. '
      + 'Return ONLY a JSON array (max 8 items). Each item fields:\n'
      + '[{"name":"company English name","website":"https://...","country":"USA/Germany/...",'
      + '"customerType":"品牌商|进口商|分销商|电商卖家 (pick one in Chinese)",'
      + '"email":"public email, empty string if none","phone":"public phone, empty string if none",'
      + '"matchedCategory":"outdoor_knives|kitchen_knives|professional_scissors|kitchen_accessories",'
      + '"matchScore":0-100 integer (relevance + contact richness),"source":"ai_search"}]\n'
      + 'If no good company exists, return []. No prose, only the JSON array.';

    var ai = await callAI(
      [{ role:'system', content: sys }, { role:'user', content: user }],
      { purpose:'cd_web_search', timeout:60000, temperature:0.2 }
    );
    if(ai.error){
      st.log.push('  ⚠ AI提取失败：' + ai.error + '，改用原始搜索结果兜底');
      // fallback: use raw hits directly as weak leads
      return raw.map(function(r){
        return {
          name: cdGuessName(r.url), website: r.url || '', country: '',
          customerType: '', email: '', phone: '',
          matchedCategory: category, matchScore: 35, source: 'web_hit',
          rawTitle: r.title || '', rawSnippet: r.content || r.snippet || ''
        };
      });
    }
    var list = cdParseAIArray(ai.content);
    st.log.push('  · 提取 ' + list.length + ' 家公司');
    return list;
  }

  // Main entry: read inputs, loop keywords, merge + dedupe, persist history.
  window.cdRunSearch = async function(){
    var st = window._cdState;
    if(st.loading){ toast('搜索中，请稍候…','err'); return; }
    var kwEl = document.getElementById('cd_kw');
    var catEl = document.getElementById('cd_cat');
    var scopeEl = document.getElementById('cd_scope');
    var text = kwEl ? kwEl.value.trim() : '';
    var category = catEl ? catEl.value : 'outdoor_knives';
    var scope = scopeEl ? scopeEl.value : 'web';
    if(!text){ toast('请输入至少一个关键词','err'); return; }

    // split multi-line keywords
    var keywords = text.split(/\r?\n/).map(function(s){ return s.trim(); }).filter(Boolean);
    if(keywords.length > 8){ toast('单次最多8个关键词，请精简','err'); return; }

    st.loading = true;
    st.log = [];
    S.cdSearchResults = [];
    renderView();

    var merged = [];
    var seenHost = {};
    for(var i=0;i<keywords.length;i++){
      try{
        var items = await cdSearchOneKeyword(keywords[i], category, scope);
        items.forEach(function(it){
          var h = cdHost(it.website);
          var key = h || String(it.name||'').toLowerCase();
          if(key && seenHost[key]){
            // merge: bump score if this one has richer contact info
            var existing = merged.find(function(m){ return (cdHost(m.website)||String(m.name||'').toLowerCase()) === key; });
            if(existing && cdResultCompleteness(it) > cdResultCompleteness(existing)){
              if(it.email && !existing.email) existing.email = it.email;
              if(it.phone && !existing.phone) existing.phone = it.phone;
              if(it.country && !existing.country) existing.country = it.country;
              existing.matchScore = Math.max(existing.matchScore||0, it.matchScore||0);
            }
            return;
          }
          if(key) seenHost[key] = true;
          it._kw = keywords[i];
          merged.push(it);
        });
      }catch(e){
        st.log.push('  ✕ 失败：' + (e.message||e));
        console.warn('[cd] keyword search failed:', keywords[i], e);
      }
    }

    S.cdSearchResults = merged;
    S.cdSearchHistory.push({
      keywords: keywords.join(' | '),
      category: category,
      scope: scope,
      resultCount: merged.length,
      timestamp: cdNowISO()
    });
    // keep history bounded
    if(S.cdSearchHistory.length > 50) S.cdSearchHistory = S.cdSearchHistory.slice(-50);
    persist();

    st.loading = false;
    toast('✅ 完成，共 ' + merged.length + ' 条线索');
    renderView();
  };

  window.cdSetSort = function(mode){ window._cdState.sort = mode; renderView(); };

  // Fill the keyword textarea with a built-in matrix chip.
  window.cdPickKeyword = function(kw){
    var el = document.getElementById('cd_kw');
    if(el) el.value = kw;
  };

  window.cdClearResults = function(){
    S.cdSearchResults = [];
    window._cdState.log = [];
    persist();
    toast('已清空结果');
    renderView();
  };
  window.cdClearHistory = function(){
    if(!confirm('确认清空全部搜索历史？')) return;
    S.cdSearchHistory = [];
    persist();
    toast('已清空搜索历史');
    renderView();
  };

  // ── Import one result card into S.customers ──
  window.cdImport = function(idx){
    var r = S.cdSearchResults[idx];
    if(!r) return;
    // dedupe against existing ledger: same website host OR same name+country
    var dup = (S.customers||[]).find(function(c){
      if(r.website && c.website && cdHost(c.website) === cdHost(r.website)) return true;
      if(cdCustName(c) && r.name && cdCustName(c).toLowerCase() === String(r.name).toLowerCase()) return true;
      return false;
    });
    if(dup){ toast('已存在于客户台账：' + cdCustName(dup), 'err'); return; }

    var score = Number(r.matchScore) || 0;
    var nc = {
      id: 'cust_' + Date.now() + '_' + Math.random().toString(36).substr(2,6),
      name: r.name || cdGuessName(r.website),
      company: r.name || cdGuessName(r.website), // legacy alias for other modules
      email: r.email || '',
      phone: r.phone || '',
      website: r.website || '',
      country: r.country || '',
      city: '',
      address: '',
      productCategory: r.matchedCategory || '',
      status: '未开发',
      leadScore: score,
      tags: ['cd_search', r.matchedCategory || ''].filter(Boolean),
      decisionMaker: '',
      companySize: '',
      customerType: r.customerType || '',
      source: 'cd_search',
      cdProfile: {
        customerType: r.customerType || '',
        intentLevel: cdIntentOfScore(score)
      },
      cdCompleteness: { score: cdResultCompleteness(r) },
      notes: 'Imported from 全网搜客工作台. Keyword: ' + (r._kw||'') +
             '. Source: ' + (r.source||'ai_search') +
             '. Matched category: ' + (r.matchedCategory||'') +
             '. Imported at ' + cdNowISO(),
      createdAt: cdNowISO()
    };
    S.customers.push(nc);
    try{ addTimelineEvent(nc.id, 'customer_created', '从全网搜客导入新客户', nc.name + ' · ' + (nc.country||'')); }catch(e){}
    r._imported = true;
    persist();
    toast('✅ 已导入客户台账（未发送任何邮件/WhatsApp）');
    renderView();
  };

  // ── Detail modal ──
  window.cdShowDetail = function(idx){
    var r = S.cdSearchResults[idx];
    if(!r) return;
    var old = document.getElementById('cd_modal');
    if(old) old.remove();
    var overlay = document.createElement('div');
    overlay.id = 'cd_modal';
    overlay.className = 'cd-modal-mask';
    overlay.onclick = function(e){ if(e.target === overlay) overlay.remove(); };
    var rows = [
      ['公司名称', r.name], ['网站', r.website], ['国家', r.country],
      ['客户类型', r.customerType], ['邮箱', r.email], ['电话', r.phone],
      ['匹配品类', r.matchedCategory], ['匹配度', (r.matchScore||0) + ' 分'],
      ['来源', r.source], ['搜索词', r._kw]
    ];
    var html = '<div class="cd-modal">'
      + '<div class="cd-modal-head"><b>🔍 ' + esc(r.name||'(未命名)') + '</b>'
      + '<button class="cd-modal-x" onclick="document.getElementById(\'cd_modal\').remove()">✕</button></div>'
      + '<table class="cd-dtable">';
    rows.forEach(function(p){
      html += '<tr><td class="cd-dk">' + esc(p[0]) + '</td><td class="cd-dv">'
        + (p[0]==='网站' && p[1] ? '<a href="'+esc(p[1])+'" target="_blank" rel="noopener">'+esc(p[1])+'</a>' : esc(p[1]||'—'))
        + '</td></tr>';
    });
    if(r.rawTitle || r.rawSnippet){
      html += '<tr><td class="cd-dk">原始摘要</td><td class="cd-dv">' + esc(r.rawTitle||'') + ' ' + esc(r.rawSnippet||'') + '</td></tr>';
    }
    html += '</table>'
      + '<div class="p7-actions" style="margin-top:12px">'
      + '<button class="btn btn-primary" onclick="cdImport(' + idx + ');document.getElementById(\'cd_modal\').remove();">➕ 导入台账</button>'
      + '<button class="btn btn-outline" onclick="cdGoIntel(' + idx + ')">🧠 AI背调</button>'
      + '</div></div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
  };

  // ── Jump to intel view (handed off by another module) ──
  window.cdGoIntel = function(idx){
    var r = S.cdSearchResults[idx];
    if(!r){ toast('请先选择一条结果','err'); return; }
    window._cdPendingIntel = { name: r.name, website: r.website, country: r.country };
    toast('已携带线索信息跳转到AI背调：' + (r.name||''));
    go('customerDevIntel');
  };

  // ============================================================
  // Feature 1.4 — Smart filter
  // ============================================================
  window.cdSetFilter = function(key, value){
    window._cdFilter[key] = value;
    renderView();
  };

  function cdApplyFilters(){
    var f = window._cdFilter;
    var kw = (f.keyword||'').trim().toLowerCase();
    return (S.customers||[]).filter(function(c){
      // category
      if(f.category !== 'all'){
        if((c.productCategory||'') !== f.category) return false;
      }
      // region (fuzzy country match)
      if(f.region !== 'all'){
        if(cdRegionOf(cdCustCountry(c)) !== f.region) return false;
      }
      // customer type
      if(f.customerType !== 'all'){
        if(cdCustType(c) !== f.customerType) return false;
      }
      // intent level
      if(f.intent !== 'all'){
        if(cdCustIntent(c) !== f.intent) return false;
      }
      // status
      if(f.status !== 'all'){
        if((c.status||'') !== f.status) return false;
      }
      // completeness bucket
      var comp = cdCustCompleteness(c);
      if(f.completeness === 'high' && comp < 80) return false;
      if(f.completeness === 'mid' && (comp < 50 || comp >= 80)) return false;
      if(f.completeness === 'low' && comp >= 50) return false;
      // free keyword search over name / email / website / country
      if(kw){
        var hay = [cdCustName(c), c.email, c.website, cdCustCountry(c), c.city].join(' ').toLowerCase();
        if(hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  window.cdSaveGroup = function(){
    var nameEl = document.getElementById('cd_group_name');
    var name = nameEl ? nameEl.value.trim() : '';
    if(!name){ toast('请输入客群名称','err'); return; }
    var f = window._cdFilter;
    // don't save an all-empty filter
    var used = ['category','region','customerType','intent','status','completeness'].some(function(k){ return f[k] !== 'all'; });
    if(!used && !(f.keyword||'').trim()){ toast('当前未设置任何筛选条件','err'); return; }
    var matched = cdApplyFilters();
    S.cdSmartGroups.push({
      name: name,
      filters: JSON.parse(JSON.stringify(f)),
      createdAt: cdNowISO(),
      count: matched.length
    });
    persist();
    toast('✅ 已保存智能客群：' + name + '（' + matched.length + '人）');
    renderView();
  };

  window.cdApplyGroup = function(name){
    var g = (S.cdSmartGroups||[]).find(function(x){ return x.name === name; });
    if(!g) return;
    window._cdFilter = JSON.parse(JSON.stringify(g.filters));
    toast('已应用客群：' + name);
    renderView();
  };

  window.cdDeleteGroup = function(name){
    if(!confirm('删除客群「' + name + '」？')) return;
    S.cdSmartGroups = (S.cdSmartGroups||[]).filter(function(x){ return x.name !== name; });
    persist();
    toast('已删除客群');
    renderView();
  };

  window.cdResetFilter = function(){
    window._cdFilter = { category:'all', region:'all', customerType:'all', intent:'all', status:'all', completeness:'all', keyword:'' };
    renderView();
  };

  // ============================================================
  // RENDER — Search view
  // ============================================================
  function cdRenderSearch(root){
    var st = window._cdState;
    var h = '<div class="cd-page">';

    // search panel
    h += '<div class="cd-panel"><div class="cd-panel-head">🔍 全网搜客 · AI多数据源客户发现</div>';
    h += '<div class="cd-formgrid">'
      + '<label>品类矩阵<select class="cd-input" id="cd_cat">'
      + Object.keys(CD_CATEGORIES).map(function(k){
          return '<option value="'+k+'">'+CD_CATEGORIES[k].label+'</option>';
        }).join('')
      + '</select></label>'
      + '<label>搜索范围<select class="cd-input" id="cd_scope">'
      + '<option value="web">全网（AI搜索）</option>'
      + '<option value="standalone">独立站品牌/工厂</option>'
      + '<option value="platform">平台店铺（阿里/亚马逊）</option>'
      + '</select></label>'
      + '</div>';

    h += '<label class="cd-kwlabel">关键词（每行一个，批量搜客，最多8个）'
      + '<textarea class="cd-input" id="cd_kw" rows="3" placeholder="outdoor knife manufacturer&#10;hunting knife supplier"></textarea></label>';

    // built-in keyword chips
    h += '<div class="cd-chips">';
    Object.keys(CD_CATEGORIES).forEach(function(k){
      CD_CATEGORIES[k].keywords.forEach(function(kw){
        h += '<button class="cd-chip" onclick="cdPickKeyword(\'' + kw.replace(/'/g,"\\'") + '\')">' + esc(kw) + '</button>';
      });
    });
    h += '</div>';

    h += '<div class="cd-actions">'
      + '<button class="btn btn-primary" onclick="cdRunSearch()" ' + (st.loading?'disabled':'') + '>'
      + (st.loading ? '⏳ 搜索中（联网+AI提取，请耐心等待）…' : '🚀 开始搜索') + '</button>'
      + '<button class="btn btn-outline" onclick="cdClearResults()">🧹 清空结果</button>'
      + '<span class="cd-hint">结果仅生成客户记录，绝不自动发送邮件/WhatsApp。全部免费（AI联网搜索）。</span>'
      + '</div>';

    // live log
    if(st.log.length){
      h += '<div class="cd-log">' + st.log.map(function(l){
        return '<div>' + esc(l) + '</div>';
      }).join('') + '</div>';
    }
    h += '</div>';

    // result cards
    if(S.cdSearchResults.length){
      var sorted = S.cdSearchResults.slice();
      if(st.sort === 'score') sorted.sort(function(a,b){ return (b.matchScore||0) - (a.matchScore||0); });
      h += '<div class="cd-panel"><div class="cd-panel-head">📋 搜索结果 (' + S.cdSearchResults.length + ')'
        + '<span class="cd-actions">'
        + '<button class="btn btn-sm btn-outline" onclick="cdSetSort(\'score\')">按匹配度</button>'
        + '<button class="btn btn-sm btn-outline" onclick="cdSetSort(\'name\')">按名称</button>'
        + '</span></div>';
      h += '<div class="cd-cardlist">';
      sorted.forEach(function(r){
        // locate original index for handlers
        var idx = S.cdSearchResults.indexOf(r);
        var score = Number(r.matchScore) || 0;
        var scoreColor = score >= 75 ? '#38a169' : (score >= 50 ? '#d69e2e' : '#a0aec0');
        h += '<div class="cd-card' + (r._imported?' done':'') + '">'
          + '<div class="cd-card-head">'
          + '<b>' + esc(r.name||'(未命名)') + '</b>'
          + '<span class="cd-score" style="color:' + scoreColor + '">' + score + '分</span>'
          + '</div>'
          + '<div class="cd-card-meta">'
          + (r.website ? '<div>🌐 ' + '<a href="' + esc(r.website) + '" target="_blank" rel="noopener">' + esc(r.website) + '</a></div>' : '')
          + (r.country ? '<div>📍 ' + esc(r.country) + '</div>' : '')
          + (r.customerType ? '<div>🏷️ ' + esc(r.customerType) + '</div>' : '')
          + (r.email ? '<div>✉️ ' + esc(r.email) + '</div>' : '')
          + (r.phone ? '<div>📞 ' + esc(r.phone) + '</div>' : '')
          + (r.matchedCategory ? '<div>🧩 ' + esc(CD_CATEGORIES[r.matchedCategory] ? CD_CATEGORIES[r.matchedCategory].label : r.matchedCategory) + '</div>' : '')
          + '</div>'
          + '<div class="cd-card-actions">'
          + '<button class="btn btn-sm btn-outline" onclick="cdShowDetail(' + idx + ')">👁 查看详情</button>'
          + (r._imported
              ? '<button class="btn btn-sm" disabled style="opacity:.5">✅ 已导入</button>'
              : '<button class="btn btn-sm btn-primary" onclick="cdImport(' + idx + ')">➕ 导入台账</button>')
          + '<button class="btn btn-sm btn-outline" onclick="cdGoIntel(' + idx + ')">🧠 AI背调</button>'
          + '</div>'
          + '</div>';
      });
      h += '</div></div>';
    } else if(!st.loading){
      h += '<div class="cd-empty">输入关键词后点击"开始搜索"。可直接点下方关键词芯片快速填充。</div>';
    }

    // history
    var hist = S.cdSearchHistory.slice().reverse().slice(0, 10);
    if(hist.length){
      h += '<div class="cd-panel"><div class="cd-panel-head">🕘 最近搜索历史'
        + '<button class="btn btn-sm btn-outline" onclick="cdClearHistory()">清空历史</button></div>';
      h += '<table class="cd-table"><thead><tr><th>时间</th><th>品类</th><th>关键词</th><th>结果数</th></tr></thead><tbody>';
      hist.forEach(function(s){
        h += '<tr><td>' + cdFmtTime(s.timestamp) + '</td>'
          + '<td>' + esc(CD_CATEGORIES[s.category] ? CD_CATEGORIES[s.category].label : s.category) + '</td>'
          + '<td>' + esc(s.keywords||'') + '</td>'
          + '<td>' + (s.resultCount||0) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }

    h += '</div>';
    root.innerHTML = h;
  }

  // ============================================================
  // RENDER — Filter view
  // ============================================================
  function cdRenderFilter(root){
    var f = window._cdFilter;
    var matched = cdApplyFilters();

    // distribution stats
    var catDist = {};
    var regDist = {};
    matched.forEach(function(c){
      var cat = c.productCategory || '未分类';
      catDist[cat] = (catDist[cat]||0) + 1;
      var rg = cdRegionOf(cdCustCountry(c)) || '其他/未标记';
      regDist[rg] = (regDist[rg]||0) + 1;
    });

    var h = '<div class="cd-page">';

    // stats row
    h += '<div class="cd-stats">'
      + '<div class="cd-stat"><div class="cd-stat-num">' + matched.length + '</div><div class="cd-stat-lbl">符合条件客户</div></div>'
      + '<div class="cd-stat"><div class="cd-stat-num">' + Object.keys(catDist).length + '</div><div class="cd-stat-lbl">覆盖品类</div></div>'
      + '<div class="cd-stat"><div class="cd-stat-num">' + Object.keys(regDist).length + '</div><div class="cd-stat-lbl">覆盖区域</div></div>'
      + '<div class="cd-stat"><div class="cd-stat-num">' + (S.customers||[]).length + '</div><div class="cd-stat-lbl">客户总数</div></div>'
      + '</div>';

    // filter panel
    h += '<div class="cd-panel"><div class="cd-panel-head">🎯 多维筛选 · 实时生效</div>';
    h += '<div class="cd-filtergrid">'
      + '<label>品类<select class="cd-input" onchange="cdSetFilter(\'category\', this.value)">'
      + '<option value="all">全部</option>'
      + Object.keys(CD_CATEGORIES).map(function(k){
          return '<option value="'+k+'"' + (f.category===k?' selected':'') + '>'+CD_CATEGORIES[k].label+'</option>';
        }).join('')
      + '</select></label>'
      + '<label>国家/区域<select class="cd-input" onchange="cdSetFilter(\'region\', this.value)">'
      + '<option value="all">全部</option>'
      + '<option value="usa"' + (f.region==='usa'?' selected':'') + '>美国</option>'
      + '<option value="europe"' + (f.region==='europe'?' selected':'') + '>欧洲</option>'
      + '<option value="middleeast"' + (f.region==='middleeast'?' selected':'') + '>中东</option>'
      + '<option value="seasia"' + (f.region==='seasia'?' selected':'') + '>东南亚</option>'
      + '<option value="latam"' + (f.region==='latam'?' selected':'') + '>拉美</option>'
      + '<option value="africa"' + (f.region==='africa'?' selected':'') + '>非洲</option>'
      + '</select></label>'
      + '<label>客户类型<select class="cd-input" onchange="cdSetFilter(\'customerType\', this.value)">'
      + '<option value="all">全部</option>'
      + CD_CUSTOMER_TYPES.map(function(t){ return '<option'+(f.customerType===t?' selected':'')+'>'+t+'</option>'; }).join('')
      + '</select></label>'
      + '<label>意向等级<select class="cd-input" onchange="cdSetFilter(\'intent\', this.value)">'
      + '<option value="all">全部</option>'
      + ['高','中','低'].map(function(t){ return '<option value="'+t+'"'+(f.intent===t?' selected':'')+'>'+t+'</option>'; }).join('')
      + '</select></label>'
      + '<label>开发状态<select class="cd-input" onchange="cdSetFilter(\'status\', this.value)">'
      + '<option value="all">全部</option>'
      + CD_STATUSES.map(function(t){ return '<option'+(f.status===t?' selected':'')+'>'+t+'</option>'; }).join('')
      + '</select></label>'
      + '<label>信息完整度<select class="cd-input" onchange="cdSetFilter(\'completeness\', this.value)">'
      + '<option value="all">全部</option>'
      + '<option value="high"' + (f.completeness==='high'?' selected':'') + '>高 (≥80)</option>'
      + '<option value="mid"' + (f.completeness==='mid'?' selected':'') + '>中 (50-79)</option>'
      + '<option value="low"' + (f.completeness==='low'?' selected':'') + '>低 (<50)</option>'
      + '</select></label>'
      + '</div>';
    h += '<div class="cd-actions">'
      + '<input class="cd-input" id="cd_fkw" placeholder="搜索客户名/邮箱/网站/国家…" style="max-width:280px" value="'+esc(f.keyword||'')+'" onchange="cdSetFilter(\'keyword\', this.value)" />'
      + '<button class="btn btn-outline" onclick="cdResetFilter()">↺ 重置</button>'
      + '</div>';
    h += '</div>';

    // distributions
    h += '<div class="cd-panel"><div class="cd-panel-head">📊 分布概览</div>';
    h += '<div class="cd-dist"><b>品类分布：</b>';
    Object.keys(catDist).forEach(function(k){
      var label = CD_CATEGORIES[k] ? CD_CATEGORIES[k].label : k;
      h += '<span class="cd-chip">' + esc(label) + ' ' + catDist[k] + '</span>';
    });
    h += '</div><div class="cd-dist"><b>区域分布：</b>';
    Object.keys(regDist).forEach(function(k){
      h += '<span class="cd-chip">' + esc(k) + ' ' + regDist[k] + '</span>';
    });
    h += '</div></div>';

    // smart groups
    h += '<div class="cd-panel"><div class="cd-panel-head">💾 智能客群（保存当前筛选条件）</div>';
    h += '<div class="cd-actions">'
      + '<input class="cd-input" id="cd_group_name" placeholder="客群名称，如：美国高意向户外刀客户" style="max-width:280px" />'
      + '<button class="btn btn-primary" onclick="cdSaveGroup()">💾 保存当前筛选</button>'
      + '</div>';
    if(S.cdSmartGroups.length){
      h += '<div class="cd-grouplist">';
      S.cdSmartGroups.forEach(function(g){
        h += '<div class="cd-groupcard">'
          + '<div><b>' + esc(g.name) + '</b> <small>(' + g.count + '人 · ' + cdFmtTime(g.createdAt) + ')</small></div>'
          + '<div class="cd-card-actions">'
          + '<button class="btn btn-sm btn-primary" onclick="cdApplyGroup(\'' + String(g.name).replace(/'/g,"\\'") + '\')">▶ 一键应用</button>'
          + '<button class="btn btn-sm btn-outline" onclick="cdDeleteGroup(\'' + String(g.name).replace(/'/g,"\\'") + '\')">🗑</button>'
          + '</div></div>';
      });
      h += '</div>';
    }
    h += '</div>';

    // matched customer cards
    h += '<div class="cd-panel"><div class="cd-panel-head">👥 客户列表 (' + matched.length + ')</div>';
    if(matched.length === 0){
      h += '<div class="cd-empty">没有符合条件的客户。可去「全网搜客」发现新线索。</div>';
    } else {
      h += '<div class="cd-cardlist">';
      matched.forEach(function(c){
        var comp = cdCustCompleteness(c);
        var compColor = comp >= 80 ? '#38a169' : (comp >= 50 ? '#d69e2e' : '#a0aec0');
        var intent = cdCustIntent(c);
        var intentBadge = intent ? '<span class="cd-badge ' + (intent==='高'?'green':(intent==='中'?'blue':'gray')) + '">意向:' + intent + '</span>' : '';
        h += '<div class="cd-card">'
          + '<div class="cd-card-head"><b>' + esc(cdCustName(c)) + '</b>'
          + '<span class="cd-score" style="color:' + compColor + '">完整度 ' + comp + '</span></div>'
          + '<div class="cd-card-meta">'
          + (cdCustCountry(c) ? '<div>📍 ' + esc(cdCustCountry(c)) + '</div>' : '')
          + (c.email ? '<div>✉️ ' + esc(c.email) + '</div>' : '')
          + (c.website ? '<div>🌐 <a href="' + esc(c.website) + '" target="_blank" rel="noopener">'+esc(c.website)+'</a></div>' : '')
          + (cdCustType(c) ? '<div>🏷️ ' + esc(cdCustType(c)) + '</div>' : '')
          + (c.productCategory ? '<div>🧩 ' + esc(CD_CATEGORIES[c.productCategory] ? CD_CATEGORIES[c.productCategory].label : c.productCategory) + '</div>' : '')
          + '</div>'
          + '<div class="cd-card-actions">'
          + '<span class="cd-tag">' + esc(c.status||'未开发') + '</span>'
          + intentBadge
          + '</div></div>';
      });
      h += '</div>';
    }
    h += '</div>';

    h += '</div>';
    root.innerHTML = h;
  }

  // ============================================================
  // renderView interception
  // ============================================================
  var _cdOrigRV = window.renderView;
  window.renderView = function(){
    var main = document.getElementById('mainContent');
    if(!main){ _cdOrigRV.apply(this, arguments); return; }
    if(currentView === 'customerDevSearch'){ cdRenderSearch(main); return; }
    if(currentView === 'customerDevFilter'){ cdRenderFilter(main); return; }
    _cdOrigRV.apply(this, arguments);
  };

  // ============================================================
  // Styles (all cd- prefixed, responsive)
  // ============================================================
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-page{padding:4px;}'
    + '.cd-panel{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px;}'
    + '.cd-panel-head{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.cd-hint{font-size:12px;color:#718096;line-height:1.5;}'
    + '.cd-input{width:100%;padding:6px 8px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;box-sizing:border-box;}'
    + '.cd-kwlabel{display:block;font-size:12px;color:#718096;margin:8px 0;}'
    + '.cd-kwlabel textarea{margin-top:4px;}'
    + '.cd-formgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:6px;}'
    + '.cd-filtergrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px;}'
    + '.cd-formgrid label,.cd-filtergrid label{display:flex;flex-direction:column;font-size:12px;color:#718096;gap:4px;}'
    + '.cd-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;}'
    + '.cd-empty{padding:40px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    // chips
    + '.cd-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;}'
    + '.cd-chip{font-size:11px;padding:3px 9px;border:1px solid #cbd5e0;border-radius:12px;background:#f7fafc;cursor:pointer;color:#4a5568;}'
    + '.cd-chip:hover{background:#edf2f7;}'
    // log
    + '.cd-log{margin-top:10px;background:#1a202c;color:#9ae6b4;font-size:12px;padding:10px;border-radius:8px;max-height:160px;overflow:auto;font-family:monospace;}'
    // result cards
    + '.cd-cardlist{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}'
    + '.cd-card{border:1px solid #e2e8f0;border-radius:8px;padding:10px;background:#fafcff;}'
    + '.cd-card.done{border-color:#9ae6b4;background:#f0fff4;}'
    + '.cd-card-head{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;}'
    + '.cd-score{font-weight:700;font-size:14px;}'
    + '.cd-card-meta{font-size:12px;color:#4a5568;display:flex;flex-direction:column;gap:2px;margin:6px 0;}'
    + '.cd-card-meta a{color:#3182ce;}'
    + '.cd-card-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;}'
    + '.cd-tag{font-size:11px;padding:2px 8px;border-radius:10px;background:#edf2f7;color:#4a5568;}'
    + '.cd-badge{font-size:11px;padding:2px 10px;border-radius:10px;font-weight:600;color:#fff;}'
    + '.cd-badge.blue{background:#3182ce;}.cd-badge.green{background:#38a169;}.cd-badge.gray{background:#a0aec0;}'
    // stats
    + '.cd-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}'
    + '.cd-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.cd-stat-num{font-size:26px;font-weight:700;color:#2d3748;}'
    + '.cd-stat-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    // distribution
    + '.cd-dist{font-size:13px;color:#4a5568;margin:6px 0;display:flex;flex-wrap:wrap;gap:6px;align-items:center;}'
    // smart groups
    + '.cd-grouplist{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:10px;}'
    + '.cd-groupcard{border:1px solid #e2e8f0;border-radius:8px;padding:10px;background:#fffbeb;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}'
    // table
    + '.cd-table{width:100%;border-collapse:collapse;font-size:13px;}'
    + '.cd-table th{background:#f7fafc;text-align:left;padding:8px 10px;font-size:12px;color:#718096;border-bottom:1px solid #e2e8f0;}'
    + '.cd-table td{padding:8px 10px;border-bottom:1px solid #edf2f7;vertical-align:top;}'
    // modal
    + '.cd-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;}'
    + '.cd-modal{background:#fff;border-radius:12px;max-width:560px;width:100%;padding:16px;max-height:85vh;overflow:auto;}'
    + '.cd-modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:15px;}'
    + '.cd-modal-x{background:none;border:none;font-size:18px;cursor:pointer;color:#718096;}'
    + '.cd-dtable{width:100%;font-size:13px;}'
    + '.cd-dk{color:#718096;width:90px;padding:4px 8px 4px 0;vertical-align:top;}'
    + '.cd-dv{padding:4px 0;}'
    // Responsive
    + '@media (max-width:768px){'
    + '  .cd-stats{grid-template-columns:1fr 1fr;}'
    + '  .cd-filtergrid{grid-template-columns:1fr;}'
    + '  .cd-cardlist{grid-template-columns:1fr;}'
    + '  .cd-grouplist{grid-template-columns:1fr;}'
    + '  .cd-table{display:block;overflow-x:auto;}'
    + '  .cd-actions{flex-direction:column;align-items:stretch;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
