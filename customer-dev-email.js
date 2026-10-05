/* ============================================================
 * Customer Development Email Engine (customer-dev-email.js)
 * ----------------------------------------------------------------
 * Phase 2 of the 外贸客户开发工作台:
 *   2.1  Bilingual (EN send / ZH review) personalized emails
 *   2.2  Online editing + one-click copy + word count + restore
 *   2.3  AI assistant natural-language revision panel
 *   2.4  AI quality check + forbidden-word detection
 *   2.5  Automatic selling-point injection (per buyer type / tier)
 *   2.6  Automatic site link embedding (per product category)
 *   2.7  Collapsible grouped email sequence (Day0/3/7/14/reply)
 *   2.8  Real-time date stamp (auto-update for unsent drafts)
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. "Mark sent" only records status.
 *   - Fully client-side free implementation. No paid services.
 *   - Does NOT modify app.js / server.js / other cd-* modules.
 *   - All new CSS classes use the cd- prefix. Code comments in English.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  // Emails live on each customer (not a global collection)
  (S.customers || []).forEach(function(c){
    if(!Array.isArray(c.cdEmails)) c.cdEmails = [];
  });

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'customerDevEmail',
    icon: '✉️',
    label: '开发信引擎',
    title: '个性化开发信 · 双语 · 质检 · AI助手',
    crumb: '中英文双语开发信 · 卖点自动融入 · 违禁词检测'
  });

  // ============================================================
  // Constants
  // ============================================================
  var CD_EMAIL_TYPES = [
    { key:'first',      label:'首次开发信',   sub:'Day 0',  desc:'首次触达客户，建立联系' },
    { key:'followup3',  label:'Day 3 跟进',   sub:'+3天',   desc:'轻推一下，提供轻量价值' },
    { key:'followup7',  label:'Day 7 跟进',   sub:'+7天',   desc:'给物料降门槛，附价值' },
    { key:'followup14', label:'Day 14 跟进',  sub:'+14天',  desc:'换角度，建立适配感' },
    { key:'reply',      label:'客户回复',     sub:'收件箱', desc:'客户来信存档（手动记录）' },
    { key:'ai_reply',   label:'AI回复草稿',   sub:'回复',   desc:'针对客户回复生成的回复草稿' }
  ];

  var CD_STATUS_LABEL = {
    not_generated: { label:'未生成', color:'#a0aec0' },
    generated:     { label:'已生成', color:'#3182ce' },
    edited:        { label:'已编辑', color:'#dd6b20' },
    sent:          { label:'已发送', color:'#38a169' }
  };

  // 12 selling points pool (functional id + label + embedding strategy)
  var CD_SELLING_POINTS_POOL = [
    { id:'yangjiang',    label:'阳江产业带',       en:'Yangjiang industrial cluster (~75% of China knives & scissors)' },
    { id:'factories',    label:'4家合作工厂',       en:'4 strategic manufacturing partners (family-equity model)' },
    { id:'leo',          label:'创始人Leo直接对接', en:'Direct contact with founder Leo Li, no sales layer' },
    { id:'gov',          label:'返乡创业+政府背书', en:'Yangjiang government-supported returning-youth entrepreneur' },
    { id:'association',  label:'阳江刀剪协会资源',  en:'Yangjiang Hardware & Knife Association resources' },
    { id:'freemedia',    label:'免费营销素材套餐',  en:'Free marketing asset package (photos/videos)' },
    { id:'logowrap',     label:'工厂宣传片打客户Logo', en:'Factory promo video branded with your logo' },
    { id:'oem',          label:'OEM/ODM代工',       en:'OEM / ODM / private label available' },
    { id:'certs',        label:'SGS LFGB+FDA认证',  en:'Compliance: SGS LFGB, FDA, RoHS, CE' },
    { id:'directprice',  label:'工厂直供价',        en:'Factory-direct pricing (below traders)' },
    { id:'export',       label:'出口130+国家',      en:'Exported to 130+ countries' },
    { id:'onestop',      label:'一站式采购',        en:'One-stop sourcing across 4 categories' }
  ];

  // Full link library (hardcoded)
  var CD_LINK_POOL = {
    home:        { label:'首页',           url:'https://kailioncrafts.com/' },
    outdoor:     { label:'户外刀',         url:'https://kailioncrafts.com/outdoor-knives/' },
    kitchen:     { label:'厨房刀',         url:'https://kailioncrafts.com/kitchen-knives/' },
    scissors:    { label:'剪刀',           url:'https://kailioncrafts.com/professional-scissors/' },
    accessories: { label:'厨房用品',       url:'https://kailioncrafts.com/kitchen-accessories/' },
    oem:         { label:'OEM/ODM',       url:'https://kailioncrafts.com/oem-odm/' },
    freemedia:   { label:'免费营销素材',   url:'https://kailioncrafts.com/free-marketing-assets/' },
    onestop:     { label:'一站式出口',     url:'https://kailioncrafts.com/one-stop-export/' },
    founder:     { label:'创始人',         url:'https://kailioncrafts.com/meet-the-founder/' },
    yangjiang:   { label:'阳江优势',       url:'https://kailioncrafts.com/yangjiang-advantage/' },
    ecosystem:   { label:'工厂生态',       url:'https://kailioncrafts.com/family-factory-ecosystem/' },
    contact:     { label:'联系我们',       url:'https://kailioncrafts.com/contact/' }
  };

  // Forbidden words dictionary
  var CD_FORBIDDEN = [
    { word:'free',        category:'绝对化',   suggestion:'complimentary / at no cost' },
    { word:'100%',        category:'绝对化',   suggestion:'delete or soften' },
    { word:'guarantee',   category:'绝对化',   suggestion:'stand behind / support' },
    { word:'best',        category:'绝对化',   suggestion:'strong / reliable' },
    { word:'cheapest',    category:'绝对化',   suggestion:'cost-effective' },
    { word:'amazing',     category:'绝对化',   suggestion:'solid / dependable' },
    { word:'perfect',     category:'绝对化',   suggestion:'well-suited' },
    { word:'incredible',  category:'绝对化',   suggestion:'delete' },
    { word:'urgent',      category:'垃圾邮件触发', suggestion:'delete' },
    { word:'act now',     category:'垃圾邮件触发', suggestion:'delete' },
    { word:'limited time',category:'垃圾邮件触发', suggestion:'delete' },
    { word:'click here',  category:'垃圾邮件触发', suggestion:'follow this link' },
    { word:'buy now',     category:'垃圾邮件触发', suggestion:'delete' },
    { word:'don\'t miss', category:'垃圾邮件触发', suggestion:'delete' },
    { word:'exclusive',   category:'垃圾邮件触发', suggestion:'delete' },
    { word:'discount',    category:'过度营销', suggestion:'pricing options' },
    { word:'sale',        category:'过度营销', suggestion:'delete' },
    { word:'offer',       category:'过度营销', suggestion:'option / support' },
    { word:'special',     category:'过度营销', suggestion:'delete' },
    { word:'deal',        category:'过度营销', suggestion:'arrangement' },
    { word:'save',        category:'过度营销', suggestion:'reduce' },
    { word:'cheap',       category:'过度营销', suggestion:'cost-effective' }
  ];

  var CD_SIGNATURE = 'Best regards,\nLeo Li\nKaiLionCrafts\nWhatsApp: +86 131-3800-6564\nWeb: https://kailioncrafts.com';

  // ============================================================
  // Feature 3.4: Customer-tier differentiated outreach style
  // S/A/B/C derived from countryTier + intentLevel
  // ============================================================
  var CD_TIER_STYLES = {
    S: {
      label: 'S级 · 品牌大客户',
      desc: '欧美品牌商 / 大型进口商 — 专业定制、品牌导向',
      style: 'Write like a senior account manager addressing a European/American brand buyer. Formal, respectful, premium tone. Focus on customization capability, brand-building, private label, quality certifications, and direct founder contact.',
      sellingPointIds: ['logowrap', 'oem', 'certs', 'leo', 'freemedia'],
      cta: 'Would you be open to a 15-minute video call to discuss your private label needs?',
      tone: 'Formal, respectful, professional',
      words: [120, 180]
    },
    A: {
      label: 'A级 · 中型进口商',
      desc: '欧美中型进口商 / 分销商 — 价值导向、专业友好',
      style: 'Professional and balanced, value-oriented. Confident and helpful. Focus on factory-direct pricing, stable supply, free marketing assets, one-stop sourcing.',
      sellingPointIds: ['directprice', 'onestop', 'freemedia', 'export'],
      cta: 'May I send our latest catalog and sample options for your review?',
      tone: 'Professional, friendly',
      words: [100, 150]
    },
    B: {
      label: 'B级 · 区域进口商/电商',
      desc: '中东/东南亚/拉美进口商、电商卖家 — 简洁价格导向',
      style: 'Concise, price- and practicality-oriented. Get to the point quickly. Focus on price advantage, low MOQ, ready stock, fast delivery.',
      sellingPointIds: ['directprice', 'yangjiang', 'onestop'],
      cta: 'Shall I send our price list with MOQ options for a trial order?',
      tone: 'Concise, direct',
      words: [70, 110]
    },
    C: {
      label: 'C级 · 新兴市场小买家',
      desc: '非洲等新兴市场小买家 — 极简、现货低价',
      style: 'Minimal, price- and ready-stock oriented. Very short, simple, direct. Focus on lowest price, ready stock, small-batch, fast shipping.',
      sellingPointIds: ['directprice', 'yangjiang'],
      cta: 'Would you like our ready-stock list with best prices for small orders?',
      tone: 'Simple, direct',
      words: [50, 80]
    }
  };

  // Derive S/A/B/C tier from countryTier + intentLevel
  function ceCalcTier(c){
    var p = c.cdProfile || {};
    var ct = String(p.countryTier || 'C').toUpperCase();
    var il = String(p.intentLevel || '');
    var high = /高|high/i.test(il);
    var mid  = /中|mid/i.test(il);
    var low  = /低|low/i.test(il);
    if(ct === 'S') return high ? 'S' : (mid ? 'A' : 'B');
    if(ct === 'A') return (high || mid) ? 'A' : 'B';
    if(ct === 'B') return high ? 'A' : (mid ? 'B' : 'C');
    // C country
    return low ? 'C' : (mid ? 'B' : 'C');
  }

  // Resolve which tier style to use for an email: explicit override
  // on the email object wins, otherwise auto-calculate from customer.
  function ceResolveTier(c, email){
    if(email && email.tierStyle && CD_TIER_STYLES[email.tierStyle]) return email.tierStyle;
    return ceCalcTier(c);
  }

  // Resolve target language code for a customer/email
  function ceResolveLang(c, email){
    if(email && email.lang) return email.lang;
    if(c.cdEmailLang) return c.cdEmailLang;
    if(window.cdEnsureCustomerLang) window.cdEnsureCustomerLang(c);
    if(c.cdEmailLang) return c.cdEmailLang;
    if(window.cdRecommendLang) return window.cdRecommendLang(c.country);
    return 'en';
  }

  // ============================================================
  // Local helpers
  // ============================================================
  function ceNowISO(){ return new Date().toISOString(); }

  // English date: "October 6, 2026"
  function ceDateEn(d){
    d = d || new Date();
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  // Chinese date: "2026年10月6日"
  function ceDateZh(d){
    d = d || new Date();
    return d.getFullYear() + '年' + (d.getMonth()+1) + '月' + d.getDate() + '日';
  }

  function ceFindCustomer(id){
    return (S.customers || []).find(function(x){ return x.id === id; }) || null;
  }
  function ceGetName(c){ return c.company || c.name || ''; }

  function ceFindEmail(c, type){
    if(!c || !Array.isArray(c.cdEmails)) return null;
    return c.cdEmails.find(function(e){ return e.type === type; }) || null;
  }

  function ceEnsureEmail(c, type){
    var e = ceFindEmail(c, type);
    if(e) return e;
    var meta = CD_EMAIL_TYPES.find(function(t){ return t.key === type; }) || {};
    e = {
      id: uid(),
      type: type,
      typeLabel: meta.label || type,
      subjectEn: '', subjectZh: '',
      bodyEn: '', bodyZh: '',
      subjectOptions: [],
      dateEn: ceDateEn(), dateZh: ceDateZh(),
      status: 'not_generated',
      createdAt: ceNowISO(), updatedAt: ceNowISO(),
      sentAt: null,
      history: [],
      qualityScore: 0,
      forbiddenWords: [],
      sellingPointsUsed: [],
      linksUsed: [],
      aiAssistantHistory: []
    };
    c.cdEmails.push(e);
    return e;
  }

  // Robust JSON extraction
  function ceParseJSON(content){
    if(!content) return null;
    try{
      var m = content.match(/```json\s*([\s\S]*?)```/);
      if(m && m[1]) return JSON.parse(m[1]);
      m = content.match(/\{[\s\S]*\}/);
      if(m) return JSON.parse(m[0]);
      return null;
    }catch(e){
      console.warn('[ce] JSON parse failed:', e);
      return null;
    }
  }

  // Word count for English
  function ceWordCount(text){
    if(!text) return 0;
    var t = String(text).replace(/\(Best regards[\s\S]*$/i, '').trim();
    return t ? t.split(/\s+/).filter(Boolean).length : 0;
  }
  // Character count for Chinese (no spaces)
  function ceCharCount(text){
    if(!text) return 0;
    return String(text).replace(/\s/g, '').length;
  }

  // Debounce
  function ceDebounce(fn, ms){
    var t = null;
    return function(){
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function(){ fn.apply(self, args); }, ms);
    };
  }

  // Clipboard copy with fallback
  function ceCopy(text, done){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ done && done(true); }).catch(function(){
        ceFallbackCopy(text, done);
      });
    }else{
      ceFallbackCopy(text, done);
    }
  }
  function ceFallbackCopy(text, done){
    try{
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      done && done(true);
    }catch(e){ done && done(false); }
  }

  // ============================================================
  // Feature 2.4: Quality check / forbidden words
  // ============================================================
  function ceQualityCheck(bodyEn, lang){
    if(!bodyEn) return { score:0, words:[], uppercase:0, exclam:0 };
    var text = String(bodyEn);
    var lower = text.toLowerCase();
    var found = [];

    // For non-English bodies, English forbidden-word scan is not meaningful;
    // only count exclamation / uppercase heuristics that are script-agnostic.
    var isEnglish = (!lang || lang === 'en');

    if(isEnglish){
      CD_FORBIDDEN.forEach(function(f){
        var re = new RegExp('\\b' + f.word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b', 'i');
        if(re.test(lower)){
          found.push({ word:f.word, category:f.category, suggestion:f.suggestion });
        }
      });

      // Consecutive uppercase >= 5 letters
      var upperHits = text.match(/\b[A-Z]{5,}\b/g) || [];
      upperHits.forEach(function(w){
        found.push({ word:w, category:'大写过多', suggestion:'改为常规大小写（如 ' + w.charAt(0) + w.slice(1).toLowerCase() + '）' });
      });
    }

    // Exclamation marks > 2
    var exclam = (text.match(/!/g) || []).length;
    if(exclam > 2){
      found.push({ word:'! × ' + exclam, category:'感叹号过多', suggestion:'删除多余感叹号，B2B邮件最多1个' });
    }

    // Score: start at 100, -8 per forbidden word, min 0
    var score = 100 - found.length * 8;
    if(score < 0) score = 0;
    // Bonus: if body is within 150 words, +5 (English word count)
    if(isEnglish && ceWordCount(bodyEn) <= 150 && ceWordCount(bodyEn) >= 60) score = Math.min(100, score + 5);

    return { score: score, words: found, uppercase: isEnglish ? (text.match(/\b[A-Z]{5,}\b/g) || []).length : 0, exclam: exclam };
  }

  function ceHighlightForbidden(bodyEn, forbiddenWords){
    if(!bodyEn) return '';
    var html = esc(bodyEn);
    forbiddenWords.forEach(function(f){
      if(!f.word || f.word.indexOf('!') >= 0 || f.word.indexOf('×') >= 0) return;
      var re = new RegExp('\\b(' + f.word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')\\b', 'gi');
      html = html.replace(re, '<mark class="cd-mark" title="' + esc(f.category + ' → ' + f.suggestion) + '">$1</mark>');
    });
    return html;
  }

  // ============================================================
  // Feature 2.5 / 2.6: Selling point & link selection
  // ============================================================
  function cePickSellingPoints(c, tierOverride){
    var p = c.cdProfile || {};
    var type = p.customerType || c.customerType || '';
    var tier = tierOverride || ceCalcTier(c);
    var picks = [];
    function byId(id){ return CD_SELLING_POINTS_POOL.find(function(x){ return x.id === id; }); }

    // Feature 3.4: tier-style selling points take priority
    var tierStyle = CD_TIER_STYLES[tier] || CD_TIER_STYLES.C;
    tierStyle.sellingPointIds.forEach(function(id){
      var sp = byId(id);
      if(sp) picks.push(sp);
    });

    // Buyer-type personalization (still applied as secondary candidates)
    if(/brand/i.test(type)){
      if(!picks.find(function(x){ return x && x.id === 'logowrap'; })) picks.push(byId('logowrap'));
    }else if(/import/i.test(type)){
      if(!picks.find(function(x){ return x && x.id === 'directprice'; })) picks.push(byId('directprice'));
    }else if(/e-?commerce/i.test(type) || /电商/i.test(type)){
      if(!picks.find(function(x){ return x && x.id === 'freemedia'; })) picks.push(byId('freemedia'));
    }else if(/distrib/i.test(type) || /分销/i.test(type)){
      if(!picks.find(function(x){ return x && x.id === 'onestop'; })) picks.push(byId('onestop'));
    }
    // Founder direct contact as a universal trust signal
    if(!picks.find(function(x){ return x && x.id === 'leo'; })) picks.push(byId('leo'));

    // de-dup, take 4 candidates
    var seen = {}; var out = [];
    picks.forEach(function(x){ if(x && !seen[x.id]){ seen[x.id]=1; out.push(x); } });
    return out.slice(0, 4);
  }

  function cePickLinks(c){
    var cat = c.productCategory || (c.cdProfile && c.cdProfile.categoryMatch && c.cdProfile.categoryMatch[0]) || '';
    var links = [];
    // product category link
    if(/户外|outdoor/i.test(cat)) links.push(CD_LINK_POOL.outdoor);
    else if(/厨房刀|kitchen knife/i.test(cat)) links.push(CD_LINK_POOL.kitchen);
    else if(/剪刀|scissor/i.test(cat)) links.push(CD_LINK_POOL.scissors);
    else if(/厨房用品|accessor/i.test(cat)) links.push(CD_LINK_POOL.accessories);
    else links.push(CD_LINK_POOL.home);
    // service links
    links.push(CD_LINK_POOL.oem);
    links.push(CD_LINK_POOL.founder);
    return links;
  }

  // ============================================================
  // Knowledge base retrieval (compact, factEligible only)
  // ============================================================
  async function ceFetchKB(c){
    try{
      var q = [ceGetName(c), c.country, c.mainProducts || c.products].filter(Boolean).join(' ').substring(0, 200);
      var url = '/api/kb/context?q=' + encodeURIComponent(q || 'KaiLionCrafts outbound') + '&purpose=internal_ai&provider=online_glm&limit=12';
      var resp = await fetch(url);
      if(!resp.ok) return [];
      var data = await resp.json();
      return (data.facts || []).filter(function(f){ return f && f.factEligible === true; }).slice(0, 5);
    }catch(e){
      console.warn('[ce] KB fetch failed:', e);
      return [];
    }
  }

  // ============================================================
  // Prompt building
  // ============================================================
  function ceIntelBrief(c){
    if(!c.cdIntel || !c.cdIntel.dimensions) return '（暂无背调数据）';
    var d = c.cdIntel.dimensions;
    var lines = [];
    var co = d.companyOverview || {};
    if(co.businessScope) lines.push('业务范围: ' + co.businessScope);
    var pi = d.purchaseIntent || {};
    if(pi.categories) lines.push('采购品类: ' + pi.categories);
    var pp = d.painPoints || {};
    if(pp.supplierIssues) lines.push('现有供应商问题: ' + pp.supplierIssues);
    var es = d.entryStrategy || {};
    if(es.bestAngle) lines.push('最佳切入点: ' + es.bestAngle);
    return lines.length ? lines.join('；') : '（背调无具体摘要）';
  }

  function ceBuildGenPrompt(c, emailType, email){
    var p = c.cdProfile || {};
    var tier = ceResolveTier(c, email);
    var tierStyle = CD_TIER_STYLES[tier] || CD_TIER_STYLES.C;
    var lang = ceResolveLang(c, email);
    var langMeta = (window.cdGetLangMeta && window.cdGetLangMeta(lang)) || null;
    var sp = cePickSellingPoints(c, tier);
    var lk = cePickLinks(c);
    var typeLabel = (CD_EMAIL_TYPES.find(function(t){ return t.key === emailType; }) || {}).label || emailType;

    var spBlock = sp.map(function(s, i){ return (i+1) + '. [' + s.label + '] ' + s.en; }).join('\n');
    var lkBlock = lk.map(function(l){ return '- ' + l.label + ': ' + l.url; }).join('\n');

    var followupAngle = '';
    if(emailType === 'followup3'){
      followupAngle = 'This is a Day-3 bump: keep it very short, gently floating the original message back up, add one small value (an industry observation or a quick question), no new hard sell.';
    }else if(emailType === 'followup7'){
      followupAngle = 'This is a Day-7 value email: lower the barrier by offering something useful (browsing the site collection, a specific category page), keep it low-pressure, give the reader an easy reason to reply.';
    }else if(emailType === 'followup14'){
      followupAngle = 'This is a Day-14 angle-shift email: switch to a different angle (e.g. how similar buyers use our products, or a new product/material update), give a graceful exit if not interested, stay professional.';
    }else{
      followupAngle = 'This is the FIRST outreach email: open by referencing something specific about the customer (their products / market / business scope from the briefing), then one pain point + 2-3 selling points, then a soft CTA linking to our site.';
    }

    // ── Feature 3.4: tier style block ──────────────────────
    var wc = tierStyle.words || [100, 150];
    var tierBlock = ''
      + '【Customer tier: ' + tier + ' · ' + tierStyle.label + '】\n'
      + 'Buyer profile: ' + tierStyle.desc + '\n'
      + 'Writing style: ' + tierStyle.style + '\n'
      + 'Required CTA (adapt naturally to the greeting, do not quote verbatim): ' + tierStyle.cta + '\n'
      + 'Tone: ' + tierStyle.tone + '\n'
      + 'Target length: ' + wc[0] + '-' + wc[1] + ' words in the body language.\n';

    // ── Feature 3.1: target language block ────────────────
    var langName = (langMeta && langMeta.nativeLabel) ? langMeta.nativeLabel : 'English';
    var langBlock = '';
    if(lang === 'en' || !langMeta){
      langBlock = '【Target language: English. Write subjectEn and bodyEn in English.】\n';
    }else{
      langBlock = '【Target language: ' + langName + ' (' + lang + ')】\n'
        + 'IMPORTANT: Write the SUBJECT (subjectEn field) and the BODY (bodyEn field) in ' + langName + '.\n'
        + 'The signature block MUST stay in English (as given below).\n'
        + 'Greeting, body paragraphs, and CTA must be natural, native-sounding ' + langName + '.\n'
        + 'Do NOT mix English sentences into the body except brand names, product category names, URLs, and the signature.\n'
        + 'subjectZh must be the Chinese translation of the chosen subject for internal review.\n'
        + 'bodyZh must be an accurate Chinese translation of the entire email body (including signature) for internal review.\n';
      if(langMeta.rtl){
        langBlock += 'NOTE: ' + langName + ' is a right-to-left language. Write correct Arabic script. Use standard Arabic punctuation and numerals appropriate for B2B. Do not reverse Latin-script URLs or brand names.\n';
      }
    }

    var prompt = ''
      + 'You are a senior B2B outbound email specialist for KaiLionCrafts, a Yangjiang-based knife & scissors manufacturing network (阳江刀剪产业带).\n\n'
      + '【Customer】\n'
      + 'Company: ' + (ceGetName(c) || 'Unknown') + '\n'
      + 'Country: ' + (c.country || 'Unknown') + '\n'
      + 'Buyer type: ' + (p.customerType || c.customerType || 'Unknown') + '\n'
      + 'Main products: ' + (c.mainProducts || c.products || 'Unknown') + '\n'
      + 'Website: ' + (c.website || 'Unknown') + '\n'
      + 'Intent: ' + (p.intentLevel || 'Unknown') + ' | Country tier: ' + (p.countryTier || 'C') + ' | Priority: ' + (p.priorityScore || 0) + '\n'
      + 'Recommended strategy: ' + (p.strategy || 'Standard OEM outreach') + '\n\n'
      + '【Customer intel briefing】\n' + ceIntelBrief(c) + '\n\n'
      + langBlock + '\n'
      + tierBlock + '\n'
      + '【Pre-selected selling points for this tier (choose 2-3, weave in naturally, do NOT list them like a menu)】\n' + spBlock + '\n\n'
      + '【Available site links (embed naturally where relevant; CTA may point to the matching product collection)】\n' + lkBlock + '\n\n'
      + '【Email type: ' + typeLabel + '】\n' + followupAngle + '\n\n'
      + '【Writing rules - MUST follow】\n'
      + '- Short paragraphs. Greeting -> 2-3 short body paragraphs -> soft CTA -> signature.\n'
      + '- Personalize the opening with a SPECIFIC detail from the customer briefing above. Never say "I hope this email finds you well" as a generic opener.\n'
      + '- Use "we" / "our Yangjiang manufacturing partners". Do NOT claim we own factories; say "strategic manufacturing partners" or "local manufacturing network".\n'
      + '- Do NOT invent MOQ, lead time, price, certifications, customer cases, export numbers beyond what is given. No guarantees.\n'
      + '- FORBIDDEN English words (do NOT use even in English sections): free, 100%, guarantee, best, cheapest, amazing, perfect, incredible, urgent, act now, limited time, click here, buy now, don\'t miss, exclusive, discount, sale, offer, special, deal, save, cheap.\n'
      + '- Max 2 exclamation marks. Avoid long ALL-CAPS words.\n'
      + '- Signature MUST be exactly (keep in English even when body is translated):\n' + CD_SIGNATURE + '\n\n'
      + '【Output format - STRICT JSON, no markdown, no extra text】\n'
      + '{\n'
      + '  "subjectOptions": ["option1","option2","option3"],\n'
      + '  "subjectEn": "the chosen best subject line (in the target language)",\n'
      + '  "subjectZh": "中文对照主题",\n'
      + '  "bodyEn": "email body in the target language, INCLUDING the English signature block",\n'
      + '  "bodyZh": "accurate Chinese translation of the whole email body for review",\n'
      + '  "sellingPointsUsed": ["label of each selling point actually used, e.g. 阳江产业带"],\n'
      + '  "linksUsed": ["full URL of each link actually embedded"]\n'
      + '}\n'
      + 'Return ONLY the JSON object.';

    return prompt;
  }

  // ============================================================
  // Feature 2.8: auto-update date for unsent emails
  // ============================================================
  function ceRefreshDates(){
    var now = new Date();
    (S.customers || []).forEach(function(c){
      (c.cdEmails || []).forEach(function(e){
        if(e.status !== 'sent'){
          e.dateEn = ceDateEn(now);
          e.dateZh = ceDateZh(now);
        }
      });
    });
  }

  // ============================================================
  // Core: generate email
  // ============================================================
  window.ceGenerate = async function(cid, type){
    var c = ceFindCustomer(cid);
    if(!c){ toast('未找到客户', 'err'); return; }
    var email = ceEnsureEmail(c, type);
    window._ceBusy = true;
    window._ceBusyMsg = 'AI正在生成「' + (email.typeLabel||type) + '」…';
    renderView();

    try{
      // KB context
      var facts = await ceFetchKB(c);
      var kbBlock = facts.length
        ? '\n【Knowledge base confirmed facts (only these may be stated as company facts)】\n'
          + facts.map(function(f,i){ return (i+1)+'. '+ (f.title||'') + ': ' + (f.shortEvidence||'').substring(0,120); }).join('\n')
        : '\n【Knowledge base】No confirmed facts retrieved. Do NOT state any company capability, MOQ, price, certification or case as fact.\n';

      var prompt = ceBuildGenPrompt(c, type, email);
      prompt += kbBlock;

      var r = await callAI(
        [{ role:'user', content: prompt }],
        { purpose:'outreach_email', temperature:0.35, context:'kaiLionOutbound', useServerRouter:true, async:false, taskType:'text', numCtx:8192 }
      );

      window._ceBusy = false;
      if(r.error){ toast('AI生成失败：' + (r.error||''), 'err'); renderView(); return; }

      var data = ceParseJSON(r.content);
      if(!data){
        // Fallback: regex extract
        data = ceFallbackExtract(r.content);
      }
      if(!data || !data.bodyEn){ toast('AI返回格式异常，请重试', 'err'); renderView(); return; }

      // Preserve previous as history
      if(email.bodyEn){
        email.history.push({ version:(email.history.length+1), subjectEn:email.subjectEn, bodyEn:email.bodyEn, timestamp:ceNowISO() });
      }

      email.subjectOptions = Array.isArray(data.subjectOptions) ? data.subjectOptions : [];
      email.subjectEn = data.subjectEn || (email.subjectOptions[0] || '');
      email.subjectZh = data.subjectZh || '';
      email.bodyEn = data.bodyEn || '';
      email.bodyZh = data.bodyZh || '';
      email.sellingPointsUsed = Array.isArray(data.sellingPointsUsed) ? data.sellingPointsUsed : [];
      email.linksUsed = Array.isArray(data.linksUsed) ? data.linksUsed : [];

      // Feature 3.1: stamp language metadata on the email
      email.lang = ceResolveLang(c, email);
      var lm = (window.cdGetLangMeta && window.cdGetLangMeta(email.lang)) || null;
      email.langLabel = lm ? lm.nativeLabel : 'English';
      email.rtl = !!(lm && lm.rtl);

      // Feature 3.4: stamp tier style used
      email.tierStyle = ceResolveTier(c, email);

      email.status = 'generated';
      email.updatedAt = ceNowISO();
      email.dateEn = ceDateEn(); email.dateZh = ceDateZh();

      // Auto quality check (English forbidden-word scan only for English bodies)
      var qr = ceQualityCheck(email.bodyEn, email.lang);
      email.qualityScore = qr.score;
      email.forbiddenWords = qr.words;

      persist();
      toast('✅ 开发信已生成（' + email.langLabel + ' · ' + (CD_TIER_STYLES[email.tierStyle]||{}).label + ' · 质检 ' + qr.score + ' 分）');
      renderView();
    }catch(e){
      window._ceBusy = false;
      console.warn('[ce] generate failed:', e);
      toast('生成出错：' + (e.message||e), 'err');
      renderView();
    }
  };

  function ceFallbackExtract(content){
    if(!content) return null;
    var subM = content.match(/subject\s*[:：]\s*(.+)/i);
    var bodyM = content.match(/body\s*[:：]\s*([\s\S]+)/i);
    return {
      subjectEn: subM ? subM[1].trim() : '',
      bodyEn: bodyM ? bodyM[1].trim() : content.trim(),
      bodyZh: '', subjectZh: '', sellingPointsUsed: [], linksUsed: []
    };
  }

  // Generate all not-generated emails for a customer
  window.ceGenerateAll = async function(cid){
    var c = ceFindCustomer(cid);
    if(!c) return;
    var types = ['first','followup3','followup7','followup14'];
    for(var i=0;i<types.length;i++){
      var e = ceFindEmail(c, types[i]);
      if(!e || e.status === 'not_generated'){
        await window.ceGenerate(cid, types[i]);
      }
    }
  };

  // ============================================================
  // Feature 2.2: inline editing (debounced)
  // ============================================================
  window.ceEdit = function(cid, type, field, value){
    var c = ceFindCustomer(cid); if(!c) return;
    var e = ceFindEmail(c, type); if(!e) return;
    e[field] = value;
    e.updatedAt = ceNowISO();
    if(e.status === 'generated') e.status = 'edited';
    cePersistDebounced();
  };

  var cePersistDebounced = ceDebounce(function(){ persist(); }, 500);

  window.cePickSubject = function(cid, type, idx){
    var c = ceFindCustomer(cid); if(!c) return;
    var e = ceFindEmail(c, type); if(!e) return;
    if(e.subjectOptions && e.subjectOptions[idx]){
      e.subjectEn = e.subjectOptions[idx];
      if(e.status === 'generated') e.status = 'edited';
      persist(); renderView();
    }
  };

  window.ceRestore = function(cid, type){
    var c = ceFindCustomer(cid); if(!c) return;
    var e = ceFindEmail(c, type); if(!c) return;
    if(e.history && e.history.length){
      var orig = e.history[0];
      e.bodyEn = orig.bodyEn; e.subjectEn = orig.subjectEn;
      e.bodyZh = ''; e.subjectZh = '';
      e.status = 'edited';
      persist();
      toast('已恢复AI原始版本（英文）');
      renderView();
    }else{
      toast('没有可恢复的历史版本', 'err');
    }
  };

  window.ceCopy = function(cid, type, which){
    var c = ceFindCustomer(cid); if(!c) return;
    var e = ceFindEmail(c, type); if(!e) return;
    var text = '';
    if(which === 'en'){
      text = 'Subject: ' + (e.subjectEn||'') + '\n\n' + (e.bodyEn||'');
    }else{
      text = '主题: ' + (e.subjectZh||'') + '\n\n' + (e.bodyZh||'');
    }
    ceCopy(text, function(ok){
      toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择复制', ok ? 'ok' : 'err');
    });
  };

  window.ceMarkSent = function(cid, type){
    var c = ceFindCustomer(cid); if(!c) return;
    var e = ceFindEmail(c, type); if(!e) return;
    if(e.status === 'not_generated'){ toast('请先生成开发信', 'err'); return; }
    e.status = 'sent';
    e.sentAt = ceNowISO();
    persist();
    toast('✅ 已记录为「已发送」（请手动在邮箱发送）');
    renderView();
  };

  // ============================================================
  // Feature 2.4: one-click replace forbidden words
  // ============================================================
  window.ceReplaceForbidden = function(cid, type, wordIdx){
    var c = ceFindCustomer(cid); if(!c) return;
    var e = ceFindEmail(c, type); if(!e) return;
    if(wordIdx === 'all'){
      // Replace each with its suggestion's first option (simple word-level)
      (e.forbiddenWords || []).forEach(function(f){
        var repl = (f.suggestion || '').split('/')[0].trim();
        if(repl && repl !== 'delete' && repl !== 'delete or soften' && repl !== 'delete or soften' && !/改为/.test(repl)){
          var re = new RegExp('\\b' + f.word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b', 'gi');
          e.bodyEn = e.bodyEn.replace(re, repl);
        }
      });
    }else{
      var f = e.forbiddenWords[wordIdx];
      if(f){
        var repl = (f.suggestion || '').split('/')[0].trim();
        if(repl && !/delete|改为/.test(repl)){
          var re2 = new RegExp('\\b' + f.word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b', 'gi');
          e.bodyEn = e.bodyEn.replace(re2, repl);
        }
      }
    }
    // re-run quality check
    var qr = ceQualityCheck(e.bodyEn, e.lang);
    e.qualityScore = qr.score;
    e.forbiddenWords = qr.words;
    if(e.status !== 'sent') e.status = 'edited';
    persist();
    renderView();
  };

  // ============================================================
  // Feature 2.3: AI assistant panel
  // ============================================================
  window.ceAssistantSend = async function(cid, type){
    var c = ceFindCustomer(cid); if(!c) return;
    var e = ceFindEmail(c, type); if(!e) return;
    var instr = (window._ceAssistantInstr || '').trim();
    if(!instr){ toast('请输入修改指令', 'err'); return; }
    if(!e.bodyEn){ toast('请先生成开发信', 'err'); return; }

    window._ceAssistantBusy = true;
    renderView();
    try{
      var sys = 'You are a B2B email copy assistant. Rewrite the given English email according to the user instruction. Keep the signature block unchanged. Keep it professional B2B English. Return STRICT JSON: {"bodyEn":"...","bodyZh":"...","note":"short explanation of what changed"}.';
      var user = 'Current subject: ' + (e.subjectEn||'') + '\n\n'
        + 'Current English body:\n' + (e.bodyEn||'') + '\n\n'
        + 'User instruction: ' + instr + '\n\n'
        + 'Rewrite now. Return only JSON.';
      var r = await callAI(
        [{role:'system',content:sys},{role:'user',content:user}],
        { purpose:'outreach_email_assistant', temperature:0.4, context:'kaiLionOutbound', useServerRouter:true, async:false, taskType:'text', numCtx:4096 }
      );
      window._ceAssistantBusy = false;
      if(r.error){ toast('AI助手失败：' + r.error, 'err'); renderView(); return; }
      var data = ceParseJSON(r.content);
      if(!data || !data.bodyEn){ toast('AI返回格式异常', 'err'); renderView(); return; }
      // Stage the proposal
      window._ceAssistantProposal = { bodyEn:data.bodyEn, bodyZh:data.bodyZh||e.bodyZh||'', note:data.note||'' };
      window._ceAssistantInstr = '';
      renderView();
    }catch(err){
      window._ceAssistantBusy = false;
      toast('AI助手出错：' + (err.message||err), 'err');
      renderView();
    }
  };

  window.ceAssistantApply = function(cid, type){
    var c = ceFindCustomer(cid); if(!c) return;
    var e = ceFindEmail(c, type); if(!e) return;
    var p = window._ceAssistantProposal;
    if(!p) return;
    e.history.push({ version:(e.history.length+1), subjectEn:e.subjectEn, bodyEn:e.bodyEn, timestamp:ceNowISO() });
    e.aiAssistantHistory.push({ instruction:window._ceAssistantInstr||'(proposal)', oldBody:e.bodyEn, newBody:p.bodyEn, timestamp:ceNowISO() });
    e.bodyEn = p.bodyEn; e.bodyZh = p.bodyZh || e.bodyZh;
    e.status = 'edited';
    var qr = ceQualityCheck(e.bodyEn, e.lang);
    e.qualityScore = qr.score; e.forbiddenWords = qr.words;
    window._ceAssistantProposal = null;
    persist();
    toast('✅ 已应用AI修改');
    renderView();
  };

  window.ceAssistantDiscard = function(){
    window._ceAssistantProposal = null;
    renderView();
  };

  window.ceQuickInstr = function(text){
    window._ceAssistantInstr = text;
    renderView();
    // auto-send
    var cid = window._ceSelectedCid;
    var type = window._ceExpandedType;
    if(cid && type) window.ceAssistantSend(cid, type);
  };

  window.ceToggleAssistant = function(){
    window._ceAssistantOpen = !window._ceAssistantOpen;
    renderView();
  };

  window.ceToggleGroup = function(type){
    window._ceExpandedType = (window._ceExpandedType === type) ? null : type;
    renderView();
  };

  window.ceSelectCustomer = function(cid){
    window._ceSelectedCid = cid;
    window._ceExpandedType = 'first'; // default expand first
    renderView();
  };

  window.ceSetViewMode = function(m){ window._ceViewMode = m; renderView(); };

  // Feature 3.1: set preferred email language for a customer
  window.ceSetCustomerLang = function(cid, code){
    var c = ceFindCustomer(cid); if(!c) return;
    c.cdEmailLang = code;
    c.cdEmailLangManual = true;
    if(window.cdRecommendLang && window.cdRecommendLang(c.country) === code) c.cdEmailLangManual = false;
    persist();
    toast('✅ 客户开发信语言已设为 ' + (((window.cdGetLangMeta&&window.cdGetLangMeta(code))||{}).nativeLabel || code) + '，点击「重新生成」生效');
    renderView();
  };

  // Feature 3.4: override tier style on a specific email
  window.ceSetEmailTier = function(cid, type, tier){
    var c = ceFindCustomer(cid); if(!c) return;
    var e = ceEnsureEmail(c, type);
    e.tierStyle = (CD_TIER_STYLES[tier] ? tier : null);
    if(!e.tierStyle) delete e.tierStyle; // back to auto
    persist();
    toast('✅ 开发信风格已切换为 ' + (CD_TIER_STYLES[tier] ? CD_TIER_STYLES[tier].label : '自动') + '，点击「重新生成」生效');
    renderView();
  };

  // ============================================================
  // Rendering
  // ============================================================
  function ceStatusBadge(st){
    var s = CD_STATUS_LABEL[st] || CD_STATUS_LABEL.not_generated;
    return '<span class="cd-badge" style="background:'+s.color+'22;color:'+s.color+'">'+s.label+'</span>';
  }

  function ceQualityBadge(score){
    var color = score >= 80 ? '#38a169' : (score >= 50 ? '#d69e2e' : '#e53e3e');
    return '<span class="cd-badge" style="background:'+color+'22;color:'+color+'">质检 ' + score + ' 分</span>';
  }

  function ceRenderGroup(c, t){
    var e = ceFindEmail(c, t.key);
    if(!e) e = ceEnsureEmail(c, t.key);
    var expanded = window._ceExpandedType === t.key;
    var curLang = ceResolveLang(c, e);
    var curLangMeta = (window.cdGetLangMeta && window.cdGetLangMeta(curLang)) || null;
    var curTier = ceResolveTier(c, e);
    var tierStyle = CD_TIER_STYLES[curTier] || CD_TIER_STYLES.C;

    var h = '<div class="cd-group' + (e.rtl ? ' cd-rtl' : '') + '"' + (e.rtl ? ' dir="rtl"' : '') + '">';
    // header
    h += '<div class="cd-group-head' + (expanded?' on':'') + '" onclick="ceToggleGroup(\'' + t.key + '\')">'
      + '<span class="cd-group-arrow">' + (expanded ? '▼' : '▶') + '</span>'
      + '<span class="cd-group-title">' + t.label + ' <small class="text-muted">' + t.sub + '</small></span>'
      + ceStatusBadge(e.status);
    // language + tier badges on generated emails
    if(e.status && e.status !== 'not_generated'){
      h += '<span class="cd-badge" style="background:#e9d8fd22;color:#553c9a">' + (curLangMeta?curLangMeta.flag:'') + ' ' + esc(e.langLabel || (curLangMeta&&curLangMeta.nativeLabel) || 'English') + '</span>';
      h += '<span class="cd-badge" style="background:#fed7d722;color:#c53030">' + curTier + '级</span>';
    }
    if(e.status === 'sent' && e.sentAt){
      h += '<span class="cd-group-date">发送于 ' + esc(new Date(e.sentAt).toLocaleDateString('zh-CN')) + '</span>';
    }else if(e.dateZh){
      h += '<span class="cd-group-date">' + esc(e.dateZh) + '</span>';
    }
    // summary
    if(e.subjectEn){
      h += '<span class="cd-group-summary">' + esc(e.subjectEn.substring(0,30)) + (e.subjectEn.length>30?'…':'') + '</span>';
    }
    h += '<span class="cd-group-actions" onclick="event.stopPropagation()">';
    // Language selector (customer-level)
    var langs = (window.cdLanguages || []);
    if(langs.length){
      h += '<select class="cd-mini-sel" title="选择客户开发信语言" onchange="ceSetCustomerLang(\'' + c.id + '\',this.value)">';
      langs.forEach(function(l){
        h += '<option value="' + l.code + '"' + (l.code === curLang ? ' selected' : '') + '>' + l.flag + ' ' + esc(l.nativeLabel) + '</option>';
      });
      h += '</select>';
    }
    // Tier style selector (email-level override)
    h += '<select class="cd-mini-sel" title="选择开发信风格（S/A/B/C）" onchange="ceSetEmailTier(\'' + c.id + '\',\'' + t.key + '\',this.value)">';
    h += '<option value="">自动（' + curTier + '级）</option>';
    ['S','A','B','C'].forEach(function(k){
      h += '<option value="' + k + '"' + (e.tierStyle===k?' selected':'') + '>' + esc(CD_TIER_STYLES[k].label) + '</option>';
    });
    h += '</select>';
    h += '<button class="btn btn-primary btn-sm" onclick="ceGenerate(\'' + c.id + '\',\'' + t.key + '\')" ' + (window._ceBusy?'disabled':'') + '>' + (e.status==='not_generated'?'生成':'重新生成') + '</button>';
    if(e.status !== 'not_generated'){
      h += '<button class="btn btn-outline btn-sm" onclick="ceMarkSent(\'' + c.id + '\',\'' + t.key + '\')">✓ 标记已发送</button>';
    }
    h += '</span></div>';

    // body when expanded
    if(expanded){
      h += '<div class="cd-group-body">';
      h += ceRenderEditor(c, e);
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function ceRenderEditor(c, e){
    var h = '';
    var mode = window._ceViewMode || 'both';
    // Before generation, fall back to the customer's resolved language label
    var resolvedLang = ceResolveLang(c, e);
    var resolvedMeta = (window.cdGetLangMeta && window.cdGetLangMeta(resolvedLang)) || null;
    var sendLabel = e.langLabel || (resolvedMeta && resolvedMeta.nativeLabel) || 'English';
    var sendLangCode = e.lang || resolvedLang;
    var rtl = !!e.rtl || !!(resolvedMeta && resolvedMeta.rtl);

    // Subject options picker
    h += '<div class="cd-edit-row"><label class="cd-edit-label">主题行（3个候选）</label><div class="cd-sub-opts">';
    (e.subjectOptions || []).forEach(function(opt, i){
      h += '<span class="cd-sub-opt' + (e.subjectEn===opt?' on':'') + '" onclick="cePickSubject(\'' + c.id + '\',\'' + e.type + '\',' + i + ')">' + esc(opt) + '</span>';
    });
    h += '</div></div>';

    h += '<div class="cd-edit-row"><label class="cd-edit-label">' + esc(sendLabel) + '主题</label>'
      + '<input class="cd-input" dir="' + (rtl?'rtl':'ltr') + '" value="' + esc(e.subjectEn) + '" oninput="ceEdit(\'' + c.id + '\',\'' + e.type + '\',\'subjectEn\',this.value)"></div>';
    h += '<div class="cd-edit-row"><label class="cd-edit-label">中文主题</label>'
      + '<input class="cd-input" value="' + esc(e.subjectZh) + '" oninput="ceEdit(\'' + c.id + '\',\'' + e.type + '\',\'subjectZh\',this.value)"></div>';

    h += '<div class="cd-edit-row cd-date-row"><label class="cd-edit-label">日期（可改）</label>'
      + '<span class="cd-date">📅 ' + esc(e.dateEn) + ' · ' + esc(e.dateZh) + (e.status==='sent'?' <span class="text-muted">（已发送，日期锁定）</span>':'') + '</span></div>';

    // View mode toggle
    h += '<div class="cd-mode-toggle">'
      + '<span class="cd-mode-l">视图：</span>'
      + '<span class="cd-mode' + (mode==='en'?' on':'') + '" onclick="ceSetViewMode(\'en\')">发送版</span>'
      + '<span class="cd-mode' + (mode==='zh'?' on':'') + '" onclick="ceSetViewMode(\'zh\')">仅中文</span>'
      + '<span class="cd-mode' + (mode==='both'?' on':'') + '" onclick="ceSetViewMode(\'both\')">双语对照</span>'
      + '</div>';

    // Two-column: editor + AI assistant
    h += '<div class="cd-editor-flex">';

    // Left: bilingual editor
    h += '<div class="cd-editor-main">';

    if(mode === 'en' || mode === 'both'){
      h += '<div class="cd-mail-pane' + (rtl?' cd-rtl':'') + '"' + (rtl?' dir="rtl"':'') + '>';
      h += '<div class="cd-mail-head">📤 发送版（' + esc(sendLabel) + (rtl?' · RTL':'') + '） <span class="cd-wc">' + ceWordCount(e.bodyEn) + ' 词</span>'
        + '<span class="cd-mail-actions">'
        + '<button class="btn btn-outline btn-sm" onclick="ceCopy(\'' + c.id + '\',\'' + e.type + '\',\'en\')">📋 复制</button>'
        + '<button class="btn btn-outline btn-sm" onclick="ceRestore(\'' + c.id + '\',\'' + e.type + '\')" title="从AI原始版本恢复">↩️ 恢复原始</button>'
        + '</span></div>';
      // Quality highlighted preview (read-only) + editable textarea
      if(e.forbiddenWords && e.forbiddenWords.length){
        h += '<div class="cd-forbidden-preview">⚠️ 违禁词预览（高亮处建议替换）：<br>' + ceHighlightForbidden(e.bodyEn, e.forbiddenWords) + '</div>';
      }
      h += '<textarea class="cd-ta" rows="14" oninput="ceEdit(\'' + c.id + '\',\'' + e.type + '\',\'bodyEn\',this.value)">' + esc(e.bodyEn) + '</textarea>';
      h += '</div>';
    }

    if(mode === 'zh' || mode === 'both'){
      h += '<div class="cd-mail-pane">';
      h += '<div class="cd-mail-head">📝 审核版（中文对照） <span class="cd-wc">' + ceCharCount(e.bodyZh) + ' 字</span>'
        + '<span class="cd-mail-actions"><button class="btn btn-outline btn-sm" onclick="ceCopy(\'' + c.id + '\',\'' + e.type + '\',\'zh\')">📋 复制</button></span></div>';
      h += '<textarea class="cd-ta cd-ta-zh" rows="14" oninput="ceEdit(\'' + c.id + '\',\'' + e.type + '\',\'bodyZh\',this.value)">' + esc(e.bodyZh) + '</textarea>';
      h += '</div>';
    }

    // Quality report
    h += ceRenderQuality(e);

    // Selling points & links used
    h += '<div class="cd-meta-row">';
    h += '<div class="cd-meta-block"><div class="cd-meta-t">🎯 实际融入卖点（' + (e.sellingPointsUsed||[]).length + '）</div>';
    if(e.sellingPointsUsed && e.sellingPointsUsed.length){
      e.sellingPointsUsed.forEach(function(sp){ h += '<span class="cd-chip">' + esc(sp) + '</span>'; });
    }else{ h += '<span class="text-muted">未记录</span>'; }
    h += '</div>';
    h += '<div class="cd-meta-block"><div class="cd-meta-t">🔗 嵌入链接（' + (e.linksUsed||[]).length + '）</div>';
    if(e.linksUsed && e.linksUsed.length){
      e.linksUsed.forEach(function(l){ h += '<span class="cd-chip cd-chip-link"><a href="' + esc(l) + '" target="_blank" rel="noopener">' + esc(l) + '</a></span>'; });
    }else{ h += '<span class="text-muted">未记录</span>'; }
    h += '</div>';
    h += '</div>';

    h += '</div>'; // /editor-main

    // Right: AI assistant panel
    h += ceRenderAssistant(c, e);

    h += '</div>'; // /editor-flex

    return h;
  }

  function ceRenderQuality(e){
    var h = '<div class="cd-quality">';
    h += '<div class="cd-quality-head">' + ceQualityBadge(e.qualityScore || 0) + ' <span class="text-muted" style="font-weight:400">质检报告（生成后自动检测）</span></div>';
    if(!e.forbiddenWords || !e.forbiddenWords.length){
      h += '<div class="cd-quality-ok">✅ 未检测到高风险词汇，邮件安全性良好。</div>';
    }else{
      h += '<table class="cd-fb-table"><thead><tr><th>命中词</th><th>类别</th><th>替换建议</th><th>操作</th></tr></thead><tbody>';
      e.forbiddenWords.forEach(function(f, i){
        h += '<tr><td><mark class="cd-mark">' + esc(f.word) + '</mark></td><td>' + esc(f.category) + '</td><td>' + esc(f.suggestion) + '</td>'
          + '<td><button class="btn btn-outline btn-sm" onclick="ceReplaceForbidden(\'' + (window._ceSelectedCid||'') + '\',\'' + e.type + '\',' + i + ')">替换</button></td></tr>';
      });
      h += '</tbody></table>';
      h += '<div class="cd-quality-actions"><button class="btn btn-outline btn-sm" onclick="ceReplaceForbidden(\'' + (window._ceSelectedCid||'') + '\',\'' + e.type + '\',\'all\')">🔄 一键全部替换</button>';
      h += '<span class="cd-hint">提示：Gmail/Outlook/Yahoo 对 spam trigger words 敏感，避免全大写、感叹号堆砌。</span></div>';
    }
    h += '</div>';
    return h;
  }

  function ceRenderAssistant(c, e){
    var open = window._ceAssistantOpen !== false;
    var h = '<div class="cd-assistant' + (open?' open':'') + '">';
    h += '<div class="cd-assistant-head" onclick="ceToggleAssistant()">🤖 AI助手修改 ' + (open?'▲':'▼') + '</div>';
    if(open){
      h += '<div class="cd-assistant-body">';
      // quick buttons
      h += '<div class="cd-quick">';
      ['更正式','更简短','加痛点','加强卖点','换个角度','检查语法'].forEach(function(q){
        h += '<button class="cd-quick-btn" onclick="ceQuickInstr(\'' + q + '\')">' + q + '</button>';
      });
      h += '</div>';
      // input
      h += '<textarea class="cd-ta cd-ta-assist" rows="3" placeholder="用自然语言描述修改需求，如：把这段改得更正式 / 缩短到100词以内 / 加一个关于交期的痛点" oninput="window._ceAssistantInstr=this.value">' + esc(window._ceAssistantInstr||'') + '</textarea>';
      h += '<button class="btn btn-primary btn-sm" onclick="ceAssistantSend(\'' + c.id + '\',\'' + e.type + '\')" ' + (window._ceAssistantBusy?'disabled':'') + '>' + (window._ceAssistantBusy?'⏳ AI修改中…':'✨ 让AI修改') + '</button>';

      // Proposal pending
      if(window._ceAssistantProposal){
        var p = window._ceAssistantProposal;
        h += '<div class="cd-proposal">';
        h += '<div class="cd-proposal-t">📌 AI修改预览' + (p.note ? '：' + esc(p.note) : '') + '</div>';
        h += '<div class="cd-proposal-body">' + esc(p.bodyEn) + '</div>';
        h += '<div class="cd-proposal-actions">'
          + '<button class="btn btn-primary btn-sm" onclick="ceAssistantApply(\'' + c.id + '\',\'' + e.type + '\')">✅ 应用</button>'
          + '<button class="btn btn-outline btn-sm" onclick="ceAssistantDiscard()">❌ 放弃</button>'
          + '</div></div>';
      }

      // History
      if(e.aiAssistantHistory && e.aiAssistantHistory.length){
        h += '<div class="cd-assist-hist"><div class="cd-meta-t">修改记录（' + e.aiAssistantHistory.length + '）</div>';
        e.aiAssistantHistory.slice(-5).forEach(function(ah){
          h += '<div class="cd-assist-hist-item">· ' + esc(ah.instruction||'') + ' <small class="text-muted">' + esc(new Date(ah.timestamp).toLocaleString('zh-CN')) + '</small></div>';
        });
        h += '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  // ============================================================
  // Main page render
  // ============================================================
  function ceRenderPage(root){
    ceRefreshDates(); // auto-update unsent dates

    var customers = S.customers || [];
    var cid = window._ceSelectedCid || (customers[0] && customers[0].id);
    var c = cid ? ceFindCustomer(cid) : null;
    if(!c && customers.length){ c = customers[0]; cid = c.id; window._ceSelectedCid = cid; }

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '<div><h2 style="margin:0">✉️ 个性化开发信引擎</h2>'
      + '<div class="text-sm text-muted" style="margin-top:4px">中英文双语 · 卖点自动融入 · 违禁词质检 · AI助手修改</div></div>';
    h += '</div>';

    if(!customers.length){
      h += '<div class="cd-empty">客户台账为空。请先在「客户背调画像」页生成客户。</div>';
      root.innerHTML = h; return;
    }

    // Customer selector
    h += '<div class="cd-selector"><label class="cd-sel-label">选择客户：</label>';
    h += '<select class="cd-sel" onchange="ceSelectCustomer(this.value)">';
    customers.forEach(function(x){
      var p = x.cdProfile || {};
      h += '<option value="' + esc(x.id) + '"' + (x.id===cid?' selected':'') + '>'
        + esc(ceGetName(x)||('未命名')) + '（' + esc(x.country||'未知') + ' · ' + esc(p.customerType||x.customerType||'—') + '）</option>';
    });
    h += '</select></div>';

    if(!c){ root.innerHTML = h; return; }

    // Profile summary bar (explains selling point choice)
    var p = c.cdProfile || {};
    var autoTier = ceCalcTier(c);
    var autoTierStyle = CD_TIER_STYLES[autoTier] || CD_TIER_STYLES.C;
    var autoLang = ceResolveLang(c, null);
    var autoLangMeta = (window.cdGetLangMeta && window.cdGetLangMeta(autoLang)) || null;
    h += '<div class="cd-profile-bar">';
    h += '<span class="cd-pb-item">🎯 意向：<b>' + esc(p.intentLevel||'—') + '</b></span>';
    h += '<span class="cd-pb-item">🌍 国家等级：<b>' + esc(p.countryTier||'—') + '</b></span>';
    h += '<span class="cd-pb-item">🏷️ 类型：<b>' + esc(p.customerType||'—') + '</b></span>';
    h += '<span class="cd-pb-item">🧭 品类：<b>' + esc((p.categoryMatch||[]).join('、')||c.productCategory||'—') + '</b></span>';
    h += '<span class="cd-pb-item">⭐ 优先级：<b>' + (p.priorityScore||0) + '</b></span>';
    h += '<span class="cd-pb-item" title="根据国家等级+意向自动推算，可在每封开发信上手动覆盖">📝 推荐风格：<b>' + esc(autoTierStyle.label) + '</b></span>';
    h += '<span class="cd-pb-item" title="根据国家自动推荐，可在多语言中心或下方下拉覆盖">🗣️ 推荐语言：<b>' + (autoLangMeta?autoLangMeta.flag+' ':'') + esc(autoLangMeta?autoLangMeta.nativeLabel:autoLang) + (autoLangMeta&&autoLangMeta.rtl?' (RTL)':'') + '</b></span>';
    h += '</div>';

    // Bulk generate button
    h += '<div class="cd-bulk"><button class="btn btn-primary" onclick="ceGenerateAll(\'' + c.id + '\')" ' + (window._ceBusy?'disabled':'') + '>'
      + (window._ceBusy ? '⏳ ' + esc(window._ceBusyMsg||'生成中…') : '⚡ 一键生成所有未生成开发信') + '</button>'
      + '<span class="cd-hint">首封 + Day3/7/14 跟进 · 自动融入卖点与链接 · 全程不自动发送</span></div>';

    // Groups
    h += '<div class="cd-groups">';
    CD_EMAIL_TYPES.forEach(function(t){
      h += ceRenderGroup(c, t);
    });
    h += '</div>';

    // Bottom action bar
    h += '<div class="cd-footer-bar">';
    h += '<span class="cd-hint">🔒 本工作台只生成内容，不自动发送邮件/WhatsApp。「标记已发送」仅记录状态，请手动在邮箱发送。</span>';
    h += '</div>';

    root.innerHTML = h;
  }

  // ── renderView interception ───────────────────────────────
  var _ceOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'customerDevEmail'){
      ceRenderPage(document.getElementById('mainContent'));
      return;
    }
    _ceOrigRV.apply(this, arguments);
  };

  // ── Styles (cd- prefixed) ────────────────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-empty{padding:36px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.cd-selector{display:flex;align-items:center;gap:10px;margin-bottom:14px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;}'
    + '.cd-sel-label{font-size:13px;color:#4a5568;font-weight:600;}'
    + '.cd-sel{flex:1;max-width:560px;padding:7px 10px;border:1px solid #cbd5e0;border-radius:8px;font-size:13px;background:#fff;}'
    + '.cd-profile-bar{display:flex;gap:16px;flex-wrap:wrap;background:#ebf8ff;border:1px solid #bee3f8;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#2a4365;}'
    + '.cd-pb-item b{color:#1a365d;}'
    + '.cd-bulk{margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;}'
    + '.cd-hint{font-size:12px;color:#a0aec0;}'
    // Groups
    + '.cd-groups{display:flex;flex-direction:column;gap:10px;}'
    + '.cd-group{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;}'
    + '.cd-group-head{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;flex-wrap:wrap;}'
    + '.cd-group-head.on{background:#f7fafc;border-bottom:1px solid #e2e8f0;}'
    + '.cd-group-arrow{color:#a0aec0;font-size:11px;}'
    + '.cd-group-title{font-size:14px;font-weight:700;color:#2d3748;}'
    + '.cd-group-summary{font-size:12px;color:#718096;flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + '.cd-group-date{font-size:11.5px;color:#a0aec0;}'
    + '.cd-group-actions{margin-left:auto;display:flex;gap:6px;}'
    + '.cd-group-body{padding:16px;}'
    // Editor
    + '.cd-edit-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;}'
    + '.cd-edit-label{width:110px;font-size:12.5px;color:#718096;font-weight:600;flex-shrink:0;}'
    + '.cd-input{flex:1;padding:7px 10px;border:1px solid #cbd5e0;border-radius:8px;font-size:13px;}'
    + '.cd-date-row{margin-bottom:14px;}'
    + '.cd-date{font-size:13px;color:#2d3748;}'
    + '.cd-sub-opts{flex:1;display:flex;flex-direction:column;gap:4px;}'
    + '.cd-sub-opt{font-size:12.5px;padding:5px 10px;border:1px dashed #cbd5e0;border-radius:6px;cursor:pointer;color:#4a5568;}'
    + '.cd-sub-opt.on{border-style:solid;border-color:#3182ce;background:#ebf8ff;color:#2b6cb0;font-weight:600;}'
    // mode toggle
    + '.cd-mode-toggle{display:flex;align-items:center;gap:8px;margin-bottom:12px;}'
    + '.cd-mode-l{font-size:12px;color:#718096;}'
    + '.cd-mode{font-size:12px;padding:3px 12px;border:1px solid #e2e8f0;border-radius:14px;cursor:pointer;color:#4a5568;}'
    + '.cd-mode.on{background:#3182ce;color:#fff;border-color:#3182ce;}'
    // flex editor + assistant
    + '.cd-editor-flex{display:flex;gap:14px;align-items:flex-start;}'
    + '.cd-editor-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;}'
    + '.cd-mail-pane{border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;}'
    + '.cd-mail-head{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f7fafc;font-size:13px;font-weight:700;color:#2d3748;}'
    + '.cd-wc{font-size:11.5px;font-weight:400;color:#a0aec0;margin-left:auto;}'
    + '.cd-mail-actions{display:flex;gap:6px;}'
    + '.cd-ta{width:100%;border:none;border-top:1px solid #e2e8f0;padding:12px;font-size:13px;line-height:1.7;resize:vertical;font-family:inherit;box-sizing:border-box;}'
    + '.cd-ta:focus{outline:none;background:#fff;}'
    + '.cd-ta-zh{background:#fefcf7;}'
    + '.cd-forbidden-preview{padding:8px 12px;background:#fffaf0;font-size:12px;color:#975a16;border-top:1px solid #fbd38d;white-space:pre-wrap;line-height:1.6;}'
    // quality
    + '.cd-quality{border:1px solid #e2e8f0;border-radius:10px;padding:12px;}'
    + '.cd-quality-head{font-size:13px;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:8px;}'
    + '.cd-quality-ok{font-size:12.5px;color:#22543d;background:#f0fff4;padding:8px 10px;border-radius:6px;}'
    + '.cd-fb-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px;}'
    + '.cd-fb-table th,.cd-fb-table td{padding:6px 8px;border-bottom:1px solid #edf2f7;text-align:left;}'
    + '.cd-fb-table th{background:#f7fafc;color:#4a5568;}'
    + '.cd-mark{background:#fefcbf;padding:0 2px;border-radius:2px;}'
    + '.cd-quality-actions{margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}'
    // meta chips
    + '.cd-meta-row{display:flex;gap:14px;flex-wrap:wrap;}'
    + '.cd-meta-block{flex:1;min-width:220px;background:#f7fafc;border-radius:10px;padding:10px 12px;}'
    + '.cd-meta-t{font-size:12px;font-weight:700;color:#4a5568;margin-bottom:6px;}'
    + '.cd-chip{display:inline-block;font-size:11.5px;background:#ebf8ff;color:#2b6cb0;padding:2px 9px;border-radius:10px;margin:2px;}'
    + '.cd-chip-link a{color:#2b6cb0;text-decoration:none;}'
    // assistant
    + '.cd-assistant{width:300px;flex-shrink:0;border:1px solid #e9d8fd;border-radius:10px;overflow:hidden;background:#faf5ff;}'
    + '.cd-assistant-head{padding:10px 12px;font-size:13px;font-weight:700;color:#553c9a;cursor:pointer;background:#f3e8ff;}'
    + '.cd-assistant-body{padding:12px;display:flex;flex-direction:column;gap:8px;}'
    + '.cd-quick{display:flex;flex-wrap:wrap;gap:4px;}'
    + '.cd-quick-btn{font-size:11.5px;padding:3px 9px;background:#fff;border:1px solid #d6bcfa;border-radius:10px;cursor:pointer;color:#553c9a;}'
    + '.cd-quick-btn:hover{background:#e9d8fd;}'
    + '.cd-ta-assist{border:1px solid #d6bcfa;border-radius:8px;padding:8px;font-size:12.5px;}'
    + '.cd-proposal{background:#fff;border:1px solid #d6bcfa;border-radius:8px;padding:10px;margin-top:6px;}'
    + '.cd-proposal-t{font-size:12px;font-weight:700;color:#553c9a;margin-bottom:6px;}'
    + '.cd-proposal-body{font-size:12px;color:#2d3748;white-space:pre-wrap;line-height:1.6;max-height:200px;overflow:auto;}'
    + '.cd-proposal-actions{display:flex;gap:6px;margin-top:8px;}'
    + '.cd-assist-hist{margin-top:8px;border-top:1px dashed #d6bcfa;padding-top:8px;}'
    + '.cd-assist-hist-item{font-size:11.5px;color:#6b46c1;margin:3px 0;}'
    // badges & footer
    + '.cd-badge{font-size:11px;font-weight:600;padding:2px 9px;border-radius:10px;}'
    + '.cd-mini-sel{padding:3px 6px;border:1px solid #cbd5e0;border-radius:6px;font-size:11.5px;background:#fff;color:#2d3748;max-width:150px;}'
    // RTL (Arabic) support
    + '.cd-rtl .cd-ta,.cd-rtl .cd-input{text-align:right;}'
    + '.cd-rtl .cd-forbidden-preview{text-align:right;}'
    + '.cd-rtl .cd-mail-head{flex-direction:row-reverse;}'
    + '.cd-footer-bar{margin-top:16px;padding:12px;background:#fff5f5;border:1px solid #fed7d7;border-radius:10px;text-align:center;}'
    + '.cd-footer-bar .cd-hint{color:#c53030;}'
    // responsive
    + '@media (max-width:900px){'
    + '  .cd-editor-flex{flex-direction:column;}'
    + '  .cd-assistant{width:100%;}'
    + '  .cd-edit-row{flex-direction:column;align-items:stretch;}'
    + '  .cd-edit-label{width:auto;}'
    + '  .cd-group-summary{display:none;}'
    + '  .cd-group-actions{margin-left:0;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
