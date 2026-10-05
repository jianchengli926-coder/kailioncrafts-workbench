/* ============================================================
 * P5 Phase5 Module B: Draft Quality Enhancement
 * ----------------------------------------------------------------
 * Feature 5: enhanced outreach-draft quality checks layered on
 * top of the existing 12 rules from draft-quality.js.
 *
 * Adds 5 extra checks (all pure rule-based, NO AI call):
 *   5a. Personalization score (company / person / product /
 *       industry / country mentions)
 *   5b. Length recommendation (B2B sweet spot 80-120 words)
 *   5c. Subject-line hook score
 *   5d. Call-to-action detection (too soft / too pushy)
 *   5e. Spam-trigger word detection
 *
 * Integration points (no app.js modification needed):
 *   - Wraps the global runDraftQualityCheck() so every normal
 *     quality run also produces an enhanced report stored on the
 *     draft as draft.p5EnhancedReport.
 *   - Intercepts renderView() on the drafts view and appends the
 *     enhanced panel right after each #draftQualityPanel_<id>.
 *
 * NOTE: draft-quality.js actually exposes window.DraftQualityChecker
 * (the task brief named it DraftQuality). Both names are supported.
 *
 * HARD RULE: never sends anything. All CSS uses the p5- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── Resolve the original quality checker (name-tolerant) ──
  function p5GetChecker(){
    if(window.DraftQualityChecker) return window.DraftQualityChecker;
    if(window.DraftQuality) return window.DraftQuality;
    return null;
  }

  // ── Small utils ────────────────────────────────────────────
  function p5Words(text){
    return String(text||'').trim().split(/\s+/).filter(Boolean).length;
  }

  function p5Includes(haystack, needle){
    if(!needle || String(needle).trim().length < 2) return false;
    return String(haystack||'').toLowerCase().indexOf(String(needle).trim().toLowerCase()) >= 0;
  }

  // ── 5a. Personalization score ─────────────────────────────
  function p5CheckPersonalization(draft, customer){
    var body = String(draft.body||'') + ' ' + String(draft.subject||'');
    var details = {
      companyName: false, personName: false, product: false,
      industry: false, country: false, extra: false
    };
    var score = 0;

    var company = customer.company || customer.customerName || '';
    if(p5Includes(body, company)){ details.companyName = true; score += 25; }

    var person = (customer.contact && customer.contact.name) || customer.contactName || '';
    if(p5Includes(body, person)){ details.personName = true; score += 20; }

    // product may be a single string or a list; match any token
    var productRaw = customer.productName || customer.products || customer.product || '';
    var tokens = [];
    if(Array.isArray(productRaw)) tokens = productRaw;
    else tokens = String(productRaw||'').split(/[,;\/]/);
    tokens = tokens.map(function(t){ return String(t).trim(); }).filter(function(t){ return t.length > 1; });
    var prodHit = tokens.some(function(t){ return p5Includes(body, t); });
    if(prodHit){ details.product = true; score += 20; }

    var industry = customer.industry || customer.industryTag || '';
    if(p5Includes(body, industry)){ details.industry = true; score += 15; }

    var country = customer.country || '';
    if(p5Includes(body, country)){ details.country = true; score += 10; }

    // free extra personalization signals: "your company/website/store" phrasing
    if(/your\s+(company|website|store|business|brand|collection|catalog|catalogue|range)/i.test(body)
       || /(based in|located in|headquartered in)/i.test(body)){
      details.extra = true; score += 10;
    }

    score = Math.min(100, score);
    var status = score < 40 ? 'fail' : (score <= 70 ? 'warn' : 'pass');
    return { score: score, status: status, details: details };
  }

  // ── 5b. Length recommendation ─────────────────────────────
  function p5CheckLength(draft){
    var wc = p5Words(draft.body);
    var status, rec;
    if(wc < 60){
      status = 'fail';
      rec = '内容过短（'+wc+' 词），可能缺乏说服力。B2B开发信建议 80-120 词。';
    } else if(wc < 80){
      status = 'warn';
      rec = '略短（'+wc+' 词），建议补充一个具体卖点或案例。';
    } else if(wc <= 120){
      status = 'pass';
      rec = '长度理想（'+wc+' 词），处于B2B开发信最佳区间 80-120 词。';
    } else if(wc <= 150){
      status = 'warn';
      rec = '略长（'+wc+' 词），建议精简到 120 词以内。';
    } else {
      status = 'fail';
      rec = '过长（'+wc+' 词）。B2B采购人员通常不读长邮件，压缩到 120 词以内。';
    }
    return { wordCount: wc, status: status, recommendation: rec };
  }

  // ── 5c. Subject-line hook score ───────────────────────────
  function p5CheckSubjectHook(draft, customer){
    var subj = String(draft.subject||'');
    var hits = [];
    var score = 0;

    if(/\d/.test(subj)){ score += 25; hits.push('数字（如3 Reasons）'); }
    if(subj.indexOf('?') >= 0){ score += 20; hits.push('提问式'); }

    var company = customer.company || '';
    var person = (customer.contact && customer.contact.name) || '';
    if(p5Includes(subj, company) || p5Includes(subj, person)){ score += 25; hits.push('含客户名/公司名'); }

    if(/\b(save|increase|improve|benefit|oem|odm|moq|quote|catalog|sample|profit|growth|best)\b/i.test(subj)){
      score += 20; hits.push('价值主张');
    }
    if(/(limited|today|now|deadline|urgent)/i.test(subj)){ score += 10; hits.push('紧迫感'); }

    score = Math.min(100, score);
    var status = score < 30 ? 'fail' : (score <= 60 ? 'warn' : 'pass');
    return { score: score, status: status, hits: hits };
  }

  // ── 5d. CTA detection ─────────────────────────────────────
  function p5CheckCTA(draft){
    var body = String(draft.body||'');
    var b = body.toLowerCase();
    var ctaWords = ['reply','respond','let me know','would you be interested','shall we send','shall i send','catalog','sample','quote','call','meeting','connect','schedule','open to'];
    var found = ctaWords.filter(function(w){ return b.indexOf(w) >= 0; });
    var pushyCount = (b.match(/\bmust\b/g)||[]).length + (b.match(/\bshould\b/g)||[]).length + (b.match(/\burgent(?:ly)?\b/g)||[]).length;

    var status;
    if(found.length === 0) status = 'fail';
    else if(pushyCount >= 2) status = 'warn';
    else status = 'pass';

    return {
      status: status,
      hasCTA: found.length > 0,
      ctaText: found.slice(0,3).join(', '),
      pushyCount: pushyCount
    };
  }

  // ── 5e. Spam-trigger word detection ───────────────────────
  var P5_SPAM_WORDS = [
    'free','guarantee','winner','congratulations','act now','limited time',
    '100%','click here','best price','cheap','discount','offer',
    'save big money','no obligation','risk-free','money back'
  ];

  function p5CheckSpam(draft){
    var text = (String(draft.body||'')+' '+String(draft.subject||'')).toLowerCase();
    var hits = [];
    P5_SPAM_WORDS.forEach(function(w){
      // escape regex chars, allow spaces inside multi-word phrases
      var escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      var re = new RegExp('\\b' + escaped + '\\b', 'i');
      if(re.test(text)) hits.push(w);
    });
    var status = hits.length >= 3 ? 'fail' : (hits.length >= 1 ? 'warn' : 'pass');
    return { status: status, hits: hits, count: hits.length };
  }

  // ── Score helpers for overall ─────────────────────────────
  function p5StatusScore(st){ return st === 'pass' ? 100 : (st === 'warn' ? 60 : 30); }

  // ═══════════════════════════════════════════════════════════
  //  MAIN ENTRY: p5EnhancedQualityCheck
  // ═══════════════════════════════════════════════════════════
  window.p5EnhancedQualityCheck = function(draft, context){
    context = context || {};
    var customer = context.customer || {};
    draft = draft || {};

    // Run the original 12-rule checker when available.
    var originalReport = null;
    var checker = p5GetChecker();
    if(checker && typeof checker.checkDraft === 'function'){
      try {
        originalReport = checker.checkDraft(draft, context);
      } catch(e){
        originalReport = { score:0, grade:'D', blockingIssues:[], reviewWarnings:[],
          suggestions:[{rule:'p5_original_error',severity:'low',message:'原质检器运行异常: '+e.message}],
          evidenceSummary:{factsUsed:0,evidenceUsed:0,packStatus:'error'} };
      }
    }

    var personalization = p5CheckPersonalization(draft, customer);
    var lengthCheck     = p5CheckLength(draft);
    var subjectHook     = p5CheckSubjectHook(draft, customer);
    var cta             = p5CheckCTA(draft);
    var spamWords       = p5CheckSpam(draft);

    // Blend: 60% original score, 40% average of the 5 enhanced checks.
    var origScore = originalReport ? (originalReport.score || 0) : 50;
    var enhAvg = (
      personalization.score +
      subjectHook.score +
      p5StatusScore(lengthCheck.status) +
      p5StatusScore(cta.status) +
      Math.max(0, 100 - spamWords.count * 5)
    ) / 5;
    var overallScore = Math.round(origScore * 0.6 + enhAvg * 0.4);
    var overallGrade = overallScore >= 85 ? 'A' : overallScore >= 70 ? 'B' : overallScore >= 50 ? 'C' : 'D';

    return {
      originalReport: originalReport,
      enhanced: {
        personalization: personalization,
        length: lengthCheck,
        subjectHook: subjectHook,
        cta: cta,
        spamWords: spamWords,
        overallScore: overallScore,
        overallGrade: overallGrade
      },
      checkedAt: new Date().toISOString()
    };
  };

  // ═══════════════════════════════════════════════════════════
  //  RENDER: p5RenderEnhancedPanel
  // ═══════════════════════════════════════════════════════════
  var P5_GRADE_COLORS = { A:'#2f855a', B:'#2b6cb0', C:'#d69e2e', D:'#c53030' };
  var P5_STATUS_META = {
    pass: { t:'通过', color:'#38a169', bg:'#f0fff4', icon:'✅' },
    warn: { t:'警告', color:'#d69e2e', bg:'#fffff0', icon:'⚠️' },
    fail: { t:'不通过', color:'#c53030', bg:'#fff5f5', icon:'❌' }
  };

  window.p5RenderEnhancedPanel = function(report){
    if(!report || !report.enhanced) return '';
    var e = report.enhanced;
    var gColor = P5_GRADE_COLORS[e.overallGrade] || '#718096';

    var h = '';
    h += '<div class="p5-enh-card" style="border-left:4px solid '+gColor+'">';
    h += '  <div class="p5-enh-head">';
    h += '    <span class="p5-enh-title">🚀 P5 增强质检（个性化 / 标题钩子 / CTA / 垃圾词 / 长度）</span>';
    h += '    <span class="p5-enh-score" style="color:'+gColor+'">'+e.overallScore+' <small>/100 · '+e.overallGrade+' 级</small></span>';
    h += '  </div>';

    // 5a personalization
    var pm = P5_STATUS_META[e.personalization.status];
    var d = e.personalization.details;
    h += '  <div class="p5-row-item" style="background:'+pm.bg+'">';
    h += '    <div class="p5-row-head"><span>'+pm.icon+' 个性化程度</span><b>'+e.personalization.score+'/100 · '+pm.t+'</b></div>';
    h += '    <div class="p5-row-detail">公司名:'+(d.companyName?'✅':'❌')+' · 人名:'+(d.personName?'✅':'❌')+' · 产品:'+(d.product?'✅':'❌')+' · 行业:'+(d.industry?'✅':'❌')+' · 国家:'+(d.country?'✅':'❌')+(d.extra?' · 自由个性化:✅':'')+'</div>';
    h += '  </div>';

    // 5b length
    var lm = P5_STATUS_META[e.length.status];
    h += '  <div class="p5-row-item" style="background:'+lm.bg+'">';
    h += '    <div class="p5-row-head"><span>'+lm.icon+' 长度建议（'+e.length.wordCount+' 词）</span><b>'+lm.t+'</b></div>';
    h += '    <div class="p5-row-detail">'+esc(e.length.recommendation)+'</div>';
    h += '  </div>';

    // 5c subject hook
    var sm = P5_STATUS_META[e.subjectHook.status];
    h += '  <div class="p5-row-item" style="background:'+sm.bg+'">';
    h += '    <div class="p5-row-head"><span>'+sm.icon+' 标题钩子</span><b>'+e.subjectHook.score+'/100 · '+sm.t+'</b></div>';
    h += '    <div class="p5-row-detail">'+(e.subjectHook.hits.length ? '命中：'+esc(e.subjectHook.hits.join('、')) : '未命中任何钩子元素，标题可能过于平淡')+'</div>';
    h += '  </div>';

    // 5d CTA
    var cm = P5_STATUS_META[e.cta.status];
    h += '  <div class="p5-row-item" style="background:'+cm.bg+'">';
    h += '    <div class="p5-row-head"><span>'+cm.icon+' 行动号召 CTA</span><b>'+cm.t+'</b></div>';
    h += '    <div class="p5-row-detail">'+(e.cta.hasCTA ? '检测到 CTA 信号：'+esc(e.cta.ctaText) + (e.cta.pushyCount>=2 ? ' ⚠️ 语气偏强硬（must/should/urgent 共'+e.cta.pushyCount+'次）' : '') : '缺少明确的行动号召，客户不知道下一步做什么')+'</div>';
    h += '  </div>';

    // 5e spam words
    var tm = P5_STATUS_META[e.spamWords.status];
    h += '  <div class="p5-row-item" style="background:'+tm.bg+'">';
    h += '    <div class="p5-row-head"><span>'+tm.icon+' 垃圾词检测</span><b>'+tm.t+'（命中 '+e.spamWords.count+'）</b></div>';
    h += '    <div class="p5-row-detail">'+(e.spamWords.hits.length ? '⚠️ 命中：'+esc(e.spamWords.hits.join('、'))+'（每个 -5 分）' : '✅ 未检测到常见垃圾邮件触发词')+'</div>';
    h += '  </div>';

    h += '  <div class="p5-enh-foot">综合分 = 原12项质检 60% + 增强5项 40% · 检查于 '+esc(new Date(report.checkedAt).toLocaleString())+'</div>';
    h += '</div>';
    return h;
  };

  // ═══════════════════════════════════════════════════════════
  //  INTEGRATION: wrap runDraftQualityCheck
  // ═══════════════════════════════════════════════════════════
  var _origRQC = window.runDraftQualityCheck;
  window.runDraftQualityCheck = function(draftId){
    // let the original function produce its report + toast
    var origReport = null;
    if(typeof _origRQC === 'function'){
      try { origReport = _origRQC.apply(this, arguments); } catch(e){ /* keep going */ }
    }
    // attach enhanced report
    try {
      var d = (S.drafts||[]).find(function(x){ return x.id === draftId; });
      if(d){
        var customer = (S.customers||[]).find(function(c){ return c.id === d.customerId; }) || {};
        var enh = window.p5EnhancedQualityCheck(d, { customer: customer });
        d.p5EnhancedReport = enh;
        persist();
      }
    } catch(e){ console.warn('[p5] enhanced check failed', e); }
    return origReport;
  };

  // ═══════════════════════════════════════════════════════════
  //  INTEGRATION: append enhanced panel after renderView on drafts
  // ═══════════════════════════════════════════════════════════
  function p5MountEnhancedPanels(){
    var anchors = document.querySelectorAll('[id^="draftQualityPanel_"]');
    anchors.forEach(function(anchor){
      var draftId = anchor.id.replace('draftQualityPanel_', '');
      var d = (S.drafts||[]).find(function(x){ return x.id === draftId; });
      if(!d || !String(d.body||'').trim()) return;

      // auto-run enhanced check once per draft
      if(!d.p5EnhancedReport){
        var customer = (S.customers||[]).find(function(c){ return c.id === d.customerId; }) || {};
        try {
          d.p5EnhancedReport = window.p5EnhancedQualityCheck(d, { customer: customer });
          persist();
        } catch(e){ return; }
      }

      // create or refresh the slot right after the original quality panel
      var slotId = 'p5EnhSlot_' + draftId;
      var slot = document.getElementById(slotId);
      if(!slot){
        slot = document.createElement('div');
        slot.id = slotId;
        if(anchor.nextSibling) anchor.parentNode.insertBefore(slot, anchor.nextSibling);
        else anchor.parentNode.appendChild(slot);
      }
      slot.innerHTML = window.p5RenderEnhancedPanel(d.p5EnhancedReport);
    });
  }

  var _origRV = window.renderView;
  window.renderView = function(){
    _origRV.apply(this, arguments);
    try {
      if(currentView === 'drafts') p5MountEnhancedPanels();
    } catch(e){ /* never break rendering */ }
  };

  // ── Styles (p5- prefixed, responsive) ─────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p5-enh-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:12px 0;}'
    + '.p5-enh-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;}'
    + '.p5-enh-title{font-size:13.5px;font-weight:700;color:#2d3748;}'
    + '.p5-enh-score{font-size:22px;font-weight:800;}'
    + '.p5-enh-score small{font-size:12px;font-weight:600;color:#718096;}'
    + '.p5-row-item{border-radius:8px;padding:8px 12px;margin-bottom:8px;}'
    + '.p5-row-head{display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;color:#2d3748;margin-bottom:3px;}'
    + '.p5-row-detail{font-size:12px;color:#4a5568;line-height:1.5;}'
    + '.p5-enh-foot{font-size:11px;color:#a0aec0;margin-top:6px;}'
    + '@media (max-width:768px){'
    + '  .p5-enh-head{flex-direction:column;align-items:flex-start;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
