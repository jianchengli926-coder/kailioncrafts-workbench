/* ============================================================
 * Customer Development Dormant Wake-up (customer-dev-dormant.js)
 * ----------------------------------------------------------------
 * Phase 4.5: Dormant customer detection + reactivation
 *   - Auto-scan: no contact for 30+ days (excluding rejected /
 *     paused / blacklisted / won orders)
 *   - 3 levels: light (30-60d) / medium (60-90d) / deep (90d+)
 *   - 5 wake-up angles: new product / holiday / industry news /
 *     friendly offer / simple greeting
 *   - One-click AI bilingual wake-up email (stored in c.cdEmails,
 *     type='wakeup'). NEVER auto-sends.
 *   - Wake-up success tracking + give-up list.
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Generates drafts only.
 *   - Fully client-side free implementation. No paid services.
 *   - Does NOT modify app.js / server.js / other cd-* modules.
 *   - All new CSS classes use the cd- prefix. Code comments in English.
 *   - All persistence goes through persist().
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  (S.customers || []).forEach(function(c){
    if(!c.cdDormant || typeof c.cdDormant !== 'object') c.cdDormant = {};
    if(!Array.isArray(c.cdDormant.wakeAttempts)) c.cdDormant.wakeAttempts = [];
  });

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'customerDevDormant',
    icon: '💤',
    label: '沉睡唤醒',
    title: '沉睡客户识别与唤醒',
    crumb: '30天自动识别 · 三级分类 · 5种唤醒角度'
  });

  // ============================================================
  // Constants
  // ============================================================
  var CD_DORMANT_THRESHOLD = 30;      // days without contact → dormant
  var CD_DORMANT_MEDIUM = 60;         // 60-90 days → medium
  var CD_DORMANT_DEEP = 90;           // 90+ days → deep

  var CD_DORMANT_LEVELS = {
    light:  { label:'轻度沉睡', color:'#3182ce', desc:'30-60天 · 常规唤醒' },
    medium: { label:'中度沉睡', color:'#dd6b20', desc:'60-90天 · 优惠/新品唤醒' },
    deep:   { label:'深度沉睡', color:'#718096', desc:'90天+ · 节日问候或考虑放弃' }
  };

  var CD_DORMANT_ANGLES = {
    new_product:   { label:'新品推荐', icon:'🆕', guide:'We recently launched an updated product line that may suit their assortment. Briefly mention what is new and why it fits their market. Do NOT invent specific product names, MOQ or price.' },
    holiday:       { label:'节日问候', icon:'🎄', guide:'Send a warm seasonal greeting based on their country/region. No sales pitch, no pressure. Wish them well and keep the relationship open.' },
    industry_news: { label:'行业资讯', icon:'📰', guide:'Share a brief, generic industry insight relevant to cutlery / kitchenware sourcing (e.g. Yangjiang cluster updates, material trends). Position as helpful, not selling.' },
    offer:         { label:'友好支持', icon:'🤝', guide:'Mention that we currently offer onboarding support for new trial orders (e.g. sample policy, flexible MOQ for first cooperation). Do NOT use words like "limited time", "urgent", "discount", "free". Use "support", "arrangement", "options".' },
    simple_greeting:{ label:'简单问候', icon:'👋', guide:'A very short, friendly "long time no see, how is business?" note. No product pitch. Pure relationship maintenance. Best for deep-dormant customers.' }
  };

  // Status strings that should NEVER be treated as dormant.
  var CD_DORMANT_EXCLUDE_STATUS = ['拒绝','不再联系','已拒绝','黑名单','已成交','已下单','已签约','合同','won','customer'];

  // ============================================================
  // Local helpers
  // ============================================================
  function cdDorNow(){ return new Date().toISOString(); }

  function cdDorFindCustomer(id){
    if(!id) return null;
    return (S.customers || []).find(function(x){ return x.id === id; }) || null;
  }

  function cdDorName(c){ return (c && (c.company || c.name)) || '未命名客户'; }

  function cdDorDaysSince(iso){
    if(!iso) return null;
    var t = new Date(iso).getTime();
    if(isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  function cdDorFmt(ts){
    if(!ts) return '—';
    var d = new Date(ts);
    if(isNaN(d.getTime())) return String(ts);
    var p = function(n){ return (n<10?'0':'')+n; };
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
  }

  function cdDorIsExcluded(c){
    if(c.blacklisted === true || c.unsubscribe === true) return true;
    if(c.cdFollowup && c.cdFollowup.paused === true) return true;
    if(c.cdDormant && c.cdDormant.givenUp === true) return true;
    var st = String(c.status || '');
    for(var i=0;i<CD_DORMANT_EXCLUDE_STATUS.length;i++){
      if(st.indexOf(CD_DORMANT_EXCLUDE_STATUS[i]) >= 0) return true;
    }
    return false;
  }

  // Robust JSON extraction (per Phase-4 spec)
  function cdDorParseJSON(content){
    if(!content) return null;
    try{
      var m = content.match(/```json\s*([\s\S]*?)```/);
      if(m && m[1]) return JSON.parse(m[1]);
      m = content.match(/\{[\s\S]*\}/);
      if(m) return JSON.parse(m[0]);
    }catch(e){}
    return null;
  }

  function cdDorCopy(text, done){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ done && done(true); })
        .catch(function(){ cdDorFallbackCopy(text, done); });
    }else{ cdDorFallbackCopy(text, done); }
  }
  function cdDorFallbackCopy(text, done){
    try{
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      done && done(true);
    }catch(e){ done && done(false); }
  }

  // ============================================================
  // Global: cdDormantRecommendAngle
  // Heuristic recommendation based on level, tier, history.
  // ============================================================
  window.cdDormantRecommendAngle = function(customerId){
    var c = cdDorFindCustomer(customerId);
    if(!c) return 'simple_greeting';
    var d = c.cdDormant || {};
    var days = d.days || cdDorDaysSince(
      (window.cdTimelineGetLastContact && window.cdTimelineGetLastContact(customerId)) || c.lastInteraction
    ) || 0;

    var attempts = Array.isArray(d.wakeAttempts) ? d.wakeAttempts : [];
    var failedAttempts = attempts.filter(function(a){ return a.result === 'no_response'; }).length;

    // Deep dormant with multiple failed attempts → low-pressure greeting
    if(days >= CD_DORMANT_DEEP){
      if(failedAttempts >= 2) return 'simple_greeting';
      return 'holiday';
    }
    // Medium: new product or industry news gives a reason to reopen
    if(days >= CD_DORMANT_MEDIUM){
      if(failedAttempts >= 1) return 'industry_news';
      return 'new_product';
    }
    // Light: friendly offer / new product
    return 'new_product';
  };

  // ============================================================
  // Global: cdDormantScan — walk all customers, update c.cdDormant
  // ============================================================
  window.cdDormantScan = function(){
    var customers = S.customers || [];
    var list = [];

    customers.forEach(function(c){
      if(!c.cdDormant || typeof c.cdDormant !== 'object') c.cdDormant = {};
      if(!Array.isArray(c.cdDormant.wakeAttempts)) c.cdDormant.wakeAttempts = [];

      // Excluded customers: clear dormant flag and skip
      if(cdDorIsExcluded(c)){
        c.cdDormant.isDormant = false;
        c.cdDormant.level = null;
        return;
      }

      // Last contact: prefer timeline → followup → sendRecords → legacy
      var lastContact = null;
      if(window.cdTimelineGetLastContact) lastContact = window.cdTimelineGetLastContact(c.id);
      if(!lastContact && c.cdFollowup && c.cdFollowup.firstSentAt) lastContact = c.cdFollowup.firstSentAt;
      if(!lastContact && Array.isArray(S.sendRecords)){
        var sMax = null;
        S.sendRecords.forEach(function(r){
          if(r.customerId !== c.id) return;
          if(!r.sentAt) return;
          if(!sMax || new Date(r.sentAt) > new Date(sMax)) sMax = r.sentAt;
        });
        if(sMax) lastContact = sMax;
      }
      if(!lastContact) lastContact = c.lastInteraction || c.createdAt;

      var days = cdDorDaysSince(lastContact);
      if(days === null) days = 0;

      var isDormant = days >= CD_DORMANT_THRESHOLD;
      var level = null;
      if(isDormant){
        if(days >= CD_DORMANT_DEEP) level = 'deep';
        else if(days >= CD_DORMANT_MEDIUM) level = 'medium';
        else level = 'light';
      }

      c.cdDormant.isDormant = isDormant;
      c.cdDormant.level = level;
      c.cdDormant.days = days;
      c.cdDormant.lastContactAt = lastContact;
      c.cdDormant.recommendedAngle = window.cdDormantRecommendAngle(c.id);
      // next recommended wake date: today (we surface it now)
      c.cdDormant.nextWakeDate = cdDorNow();

      if(isDormant) list.push(c);
    });

    // Sort: most dormant first
    list.sort(function(a,b){ return (b.cdDormant.days||0) - (a.cdDormant.days||0); });

    if(typeof persist === 'function') persist();
    return list;
  };

  // ============================================================
  // Global: cdDormantGetList — returns dormant customers array
  // ============================================================
  window.cdDormantGetList = function(){
    return window.cdDormantScan();
  };

  // ============================================================
  // Global: cdDormantGetStats
  // ============================================================
  window.cdDormantGetStats = function(){
    var list = window.cdDormantScan();
    var out = { total: list.length, light:0, medium:0, deep:0,
                totalAttempts:0, replied:0, noResponse:0, sent:0, monthWake:0, successRate:0 };
    var now = new Date();
    var thisMonth = now.getFullYear()*12 + now.getMonth();

    list.forEach(function(c){
      var lv = c.cdDormant && c.cdDormant.level;
      if(lv === 'light') out.light++;
      else if(lv === 'medium') out.medium++;
      else if(lv === 'deep') out.deep++;

      var attempts = (c.cdDormant && c.cdDormant.wakeAttempts) || [];
      attempts.forEach(function(a){
        out.totalAttempts++;
        if(a.result === 'replied') out.replied++;
        else if(a.result === 'no_response') out.noResponse++;
        else if(a.result === 'sent') out.sent++;
        if(a.date){
          var d = new Date(a.date);
          if(!isNaN(d.getTime()) && d.getFullYear()*12 + d.getMonth() === thisMonth) out.monthWake++;
        }
      });
    });

    // success rate = replied / completed attempts (exclude drafts)
    var completed = out.replied + out.noResponse;
    out.successRate = completed > 0 ? Math.round(out.replied / completed * 100) : 0;
    return out;
  };

  // ============================================================
  // Last-contact summary text for table display
  // ============================================================
  function cdDorLastSummary(c){
    if(!c || !Array.isArray(c.cdTimeline) || !c.cdTimeline.length) return '—';
    // find latest contact-type event
    var contactTypes = ['first_outreach','followup','customer_reply','our_reply','call','sample_sent','quote','order','wakeup'];
    var best = null;
    c.cdTimeline.forEach(function(e){
      if(contactTypes.indexOf(e.type) < 0) return;
      if(!e.timestamp) return;
      if(!best || new Date(e.timestamp) > new Date(best.timestamp)) best = e;
    });
    if(!best) return '—';
    var txt = best.content || '';
    return txt.length > 60 ? txt.slice(0, 60) + '…' : txt;
  }

  // ============================================================
  // Global: cdDormantGenerateWakeup — AI bilingual wake-up email
  // Stores into c.cdEmails (type='wakeup') + timeline event + wakeAttempts.
  // ============================================================
  window.cdDormantGenerateWakeup = async function(customerId, angle){
    var c = cdDorFindCustomer(customerId);
    if(!c){ toast('客户不存在', 'err'); return; }
    if(!angle || !CD_DORMANT_ANGLES[angle]) angle = window.cdDormantRecommendAngle(customerId);

    window._cdDorBusy = customerId + '|' + angle;
    renderView();

    var d = c.cdDormant || {};
    var days = d.days || cdDorDaysSince(d.lastContactAt || (window.cdTimelineGetLastContact && window.cdTimelineGetLastContact(customerId))) || 30;
    var angleMeta = CD_DORMANT_ANGLES[angle] || CD_DORMANT_ANGLES.simple_greeting;

    // Build history brief
    var historyLines = [];
    if(Array.isArray(c.cdEmails)){
      c.cdEmails.slice(-5).forEach(function(e){
        historyLines.push('- [' + (e.typeLabel||e.type||'') + '] ' + (e.subjectEn||e.subjectZh||'(无主题)') + (e.status==='sent'?' [已标记发送]':' [草稿]'));
      });
    }
    var histBlock = historyLines.length ? historyLines.join('\n') : '(暂无历史邮件记录)';

    var cat = c.productCategory || (c.cdProfile && c.cdProfile.categoryMatch && c.cdProfile.categoryMatch[0]) || 'cutlery / kitchenware';

    var prompt = [
      'You are Leo Li, founder of KaiLionCrafts, a B2B cutlery / kitchenware supplier in Yangjiang, China.',
      'Write a WAKE-UP email to a buyer who has gone silent for ' + days + ' days.',
      '',
      '=== CUSTOMER ===',
      'Company: ' + cdDorName(c),
      'Country: ' + (c.country || 'Unknown'),
      'Product category: ' + cat,
      'Dormant days: ' + days,
      '',
      '=== HISTORY (most recent last) ===',
      histBlock,
      '',
      '=== WAKE-UP ANGLE: ' + angleMeta.label + ' ===',
      angleMeta.guide,
      '',
      '=== TONE & RULES ===',
      '- Shorter and warmer than a first outreach email. No pressure, no urgency.',
      '- Do NOT use: free, 100%, guarantee, best, cheapest, urgent, limited time, act now, click here, buy now, discount, sale, offer, special, deal, save, cheap, amazing, perfect, incredible.',
      '- Do NOT invent prices, MOQ, certifications, factory size, client testimonials, or export country counts.',
      '- Keep English body under 100 words. Include a soft, low-pressure CTA.',
      '- Sign off as: Best regards, Leo Li, KaiLionCrafts, https://kailioncrafts.com',
      '',
      '=== OUTPUT FORMAT (strict JSON inside ```json block) ===',
      'Return ONLY a JSON object, no commentary:',
      '{',
      '  "subjectEn": "short English subject line",',
      '  "subjectZh": "对应的中文主题",',
      '  "bodyEn": "English email body paragraphs",',
      '  "bodyZh": "简体中文翻译（供内部审阅）"',
      '}'
    ].join('\n');

    try{
      var r = await callAI(
        [{ role:'user', content: prompt }],
        { purpose:'cd_dormant_wakeup', temperature:0.35, context:'kaiLionOutbound', useServerRouter:true, async:false, taskType:'text', numCtx:8192 }
      );
      window._cdDorBusy = null;

      if(r.error){ toast('AI生成失败：' + (r.error||''), 'err'); renderView(); return; }

      var data = cdDorParseJSON(r.content);
      if(!data || !data.bodyEn){
        // fallback regex
        var subM = (r.content||'').match(/subject\s*[:：]\s*(.+)/i);
        var bodyM = (r.content||'').match(/body\s*[:：]\s*([\s\S]+)/i);
        data = {
          subjectEn: subM ? subM[1].trim() : 'Checking in from KaiLionCrafts',
          bodyEn: bodyM ? bodyM[1].trim() : (r.content||'').trim(),
          subjectZh: '', bodyZh: ''
        };
      }

      // Persist into c.cdEmails (Phase-4 email reuse contract)
      if(!Array.isArray(c.cdEmails)) c.cdEmails = [];
      var email = {
        id: 'cd_email_' + Date.now().toString(36),
        type: 'wakeup',
        typeLabel: '沉睡唤醒 · ' + angleMeta.label,
        subjectEn: data.subjectEn || '',
        subjectZh: data.subjectZh || '',
        bodyEn: data.bodyEn || '',
        bodyZh: data.bodyZh || '',
        lang: 'en',
        langLabel: 'English',
        status: 'generated',
        qualityScore: 0,
        forbiddenWords: [],
        sellingPointsUsed: [],
        linksUsed: [],
        tierStyle: null,
        createdAt: cdDorNow(),
        updatedAt: cdDorNow(),
        dateEn: '', dateZh: '',
        sentAt: null,
        history: []
      };
      c.cdEmails.push(email);

      // Record wake-up attempt
      if(!Array.isArray(c.cdDormant.wakeAttempts)) c.cdDormant.wakeAttempts = [];
      var wakeId = 'cd_wake_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
      c.cdDormant.wakeAttempts.push({
        id: wakeId,
        date: cdDorNow(),
        angle: angleMeta.label,
        angleKey: angle,
        emailId: email.id,
        result: 'draft'
      });

      // Timeline event
      if(window.cdTimelineAdd){
        window.cdTimelineAdd(customerId, {
          type: 'wakeup',
          content: '生成「' + angleMeta.label + '」唤醒邮件：' + (email.subjectEn||''),
          actor: 'ai',
          meta: { emailId: email.id, wakeId: wakeId, angle: angle }
        });
      }

      persist();
      toast('✅ 唤醒邮件已生成（' + angleMeta.label + '），请复制后手动发送，系统不会自动发送');
      window._cdDorOpenWake = wakeId; // open the panel
      renderView();
    }catch(e){
      window._cdDorBusy = null;
      console.warn('[cdDormant] generate wakeup failed:', e);
      toast('生成出错：' + (e.message||e), 'err');
      renderView();
    }
  };

  // ============================================================
  // Global: cdDormantMarkWoke — record wake-up result
  // result: 'sent' | 'replied' | 'no_response'
  // ============================================================
  window.cdDormantMarkWoke = function(customerId, wakeId, result){
    var c = cdDorFindCustomer(customerId);
    if(!c || !c.cdDormant) return;
    var attempts = c.cdDormant.wakeAttempts || [];
    var a = attempts.find(function(x){ return x.id === wakeId; });
    if(!a){ toast('唤醒记录不存在', 'err'); return; }
    a.result = result;
    a.resolvedAt = cdDorNow();

    if(result === 'replied'){
      // Customer replied → exit dormant state
      c.cdDormant.isDormant = false;
      c.cdDormant.level = null;
      if(window.cdTimelineAdd){
        window.cdTimelineAdd(customerId, {
          type: 'customer_reply',
          content: '沉睡唤醒成功，客户已回复（角度：' + (a.angle||'') + '）',
          actor: 'customer',
          meta: { wakeId: wakeId }
        });
      }
      toast('🎉 客户已回复，已从沉睡列表移除');
    }else if(result === 'sent'){
      toast('✅ 已标记唤醒邮件已发送');
    }else if(result === 'no_response'){
      toast('📭 已记录：本次唤醒无回复');
    }
    persist();
    renderView();
  };

  // ============================================================
  // Manual: give up on this customer (move to give-up list)
  // ============================================================
  window.cdDormantGiveUp = function(customerId){
    var c = cdDorFindCustomer(customerId);
    if(!c) return;
    c.cdDormant.givenUp = true;
    c.cdDormant.isDormant = false;
    c.cdDormant.level = null;
    if(window.cdTimelineAdd){
      window.cdTimelineAdd(customerId, {
        type: 'note',
        content: '手动标记放弃此客户（从沉睡列表移除）',
        actor: 'user'
      });
    }
    toast('已标记放弃，客户将从沉睡列表移除');
    persist();
    renderView();
  };

  // ============================================================
  // UI: copy / mark sent helpers
  // ============================================================
  window.cdDorCopyEmail = function(customerId, emailId){
    var c = cdDorFindCustomer(customerId);
    if(!c) return;
    var e = (c.cdEmails||[]).find(function(x){ return x.id === emailId; });
    if(!e) return;
    var text = 'Subject: ' + (e.subjectEn||'') + '\n\n' + (e.bodyEn||'');
    cdDorCopy(text, function(ok){
      toast(ok ? '✅ 唤醒邮件已复制到剪贴板' : '复制失败', ok?'ok':'err');
    });
  };

  window.cdDorMarkEmailSent = function(customerId, emailId){
    var c = cdDorFindCustomer(customerId);
    if(!c) return;
    var e = (c.cdEmails||[]).find(function(x){ return x.id === emailId; });
    if(!e) return;
    e.status = 'sent';
    e.sentAt = cdDorNow();
    persist();
    toast('✅ 已标记邮件已发送');
    renderView();
  };

  // ============================================================
  // UI state
  // ============================================================
  window.cdDorSetFilter = function(key, val){
    window._cdDorFilter = window._cdDorFilter || {};
    window._cdDorFilter[key] = val;
    renderView();
  };

  window.cdDorToggleWake = function(wakeId){
    window._cdDorOpenWake = (window._cdDorOpenWake === wakeId) ? null : wakeId;
    renderView();
  };

  // ============================================================
  // Page render
  // ============================================================
  function cdDorRenderStats(){
    var s = window.cdDormantGetStats();
    var h = '<div class="cd-dor-stats">';
    h += '<div class="cd-dor-stat"><div class="cd-dor-stat-n">' + s.total + '</div><div class="cd-dor-stat-l">沉睡客户总数</div></div>';
    h += '<div class="cd-dor-stat cd-dor-lv-light"><div class="cd-dor-stat-n">' + s.light + '</div><div class="cd-dor-stat-l">轻度 (30-60天)</div></div>';
    h += '<div class="cd-dor-stat cd-dor-lv-medium"><div class="cd-dor-stat-n">' + s.medium + '</div><div class="cd-dor-stat-l">中度 (60-90天)</div></div>';
    h += '<div class="cd-dor-stat cd-dor-lv-deep"><div class="cd-dor-stat-n">' + s.deep + '</div><div class="cd-dor-stat-l">深度 (90天+)</div></div>';
    h += '<div class="cd-dor-stat"><div class="cd-dor-stat-n">' + s.monthWake + '</div><div class="cd-dor-stat-l">本月唤醒次数</div></div>';
    h += '<div class="cd-dor-stat"><div class="cd-dor-stat-n">' + s.totalAttempts + '</div><div class="cd-dor-stat-l">累计唤醒次数</div></div>';
    h += '<div class="cd-dor-stat"><div class="cd-dor-stat-n">' + s.successRate + '%</div><div class="cd-dor-stat-l">唤醒成功率</div></div>';
    h += '</div>';
    return h;
  }

  function cdDorRenderFilterBar(){
    var f = window._cdDorFilter || {};
    var h = '<div class="cd-dor-filterbar">';
    h += '<span class="cd-dor-filter-t">分级：</span>';
    [['all','全部'],['light','轻度'],['medium','中度'],['deep','深度']].forEach(function(o){
      h += '<button class="cd-dor-mode' + ((f.level||'all')===o[0]?' on':'') + '" onclick="cdDorSetFilter(\'level\',\'' + o[0] + '\')">' + o[1] + '</button>';
    });
    h += '<span style="flex:1"></span>';
    h += '<button class="btn btn-outline btn-sm" onclick="cdDormantScan();renderView()">🔄 重新扫描</button>';
    h += '</div>';
    return h;
  }

  function cdDorRenderWakePanel(c, wake){
    if(!wake) return '';
    var email = (c.cdEmails||[]).find(function(e){ return e.id === wake.emailId; });
    if(!email) return '';

    var h = '<div class="cd-dor-wake-panel">';
    h += '<div class="cd-dor-wake-head">✉️ 唤醒邮件草稿（' + esc(wake.angle||'') + '）</div>';
    h += '<div class="cd-dor-wake-body">';
    h += '<div class="cd-dor-mail-block"><div class="cd-dor-mail-l">EN 主题</div><div class="cd-dor-mail-v">' + esc(email.subjectEn||'') + '</div></div>';
    h += '<div class="cd-dor-mail-block"><div class="cd-dor-mail-l">EN 正文</div><div class="cd-dor-mail-v pre">' + esc(email.bodyEn||'') + '</div></div>';
    if(email.bodyZh){
      h += '<div class="cd-dor-mail-block"><div class="cd-dor-mail-l">中文参考</div><div class="cd-dor-mail-v pre zh">' + esc(email.bodyZh||'') + '</div></div>';
    }
    h += '<div class="cd-dor-wake-actions">';
    h += '<button class="btn btn-primary btn-sm" onclick="cdDorCopyEmail(\'' + c.id + '\',\'' + email.id + '\')">📋 复制英文邮件</button>';
    h += '<button class="btn btn-outline btn-sm" onclick="cdDorMarkEmailSent(\'' + c.id + '\',\'' + email.id + '\')">✅ 标记已发送</button>';
    h += '<button class="btn btn-outline btn-sm" onclick="cdDormantMarkWoke(\'' + c.id + '\',\'' + wake.id + '\',\'replied\')">🎉 客户已回复</button>';
    h += '<button class="btn btn-outline btn-sm" onclick="cdDormantMarkWoke(\'' + c.id + '\',\'' + wake.id + '\',\'no_response\')">📭 无回复</button>';
    h += '</div>';
    h += '<div class="cd-dor-wake-hint">🔒 系统不会自动发送邮件。请复制内容到邮箱手动发送，发送后再点上方按钮记录结果。</div>';
    h += '</div></div>';
    return h;
  }

  function cdDorRenderRow(c){
    var d = c.cdDormant || {};
    var lv = CD_DORMANT_LEVELS[d.level] || CD_DORMANT_LEVELS.light;
    var recAngle = CD_DORMANT_ANGLES[d.recommendedAngle] || CD_DORMANT_ANGLES.simple_greeting;
    var busy = window._cdDorBusy === (c.id + '|' + d.recommendedAngle);

    var h = '<tr>';
    h += '<td><div class="cd-dor-cust">' + esc(cdDorName(c)) + '</div><div class="cd-dor-sub">来源：' + esc(c.source||c.leadSource||'—') + '</div></td>';
    h += '<td>' + esc(c.country||'—') + '</td>';
    h += '<td>' + esc(c.productCategory || (c.cdProfile && c.cdProfile.categoryMatch && c.cdProfile.categoryMatch[0]) || '—') + '</td>';
    h += '<td><span class="cd-dor-days" style="background:' + lv.color + '18;color:' + lv.color + '">' + (d.days||0) + '天 · ' + lv.label + '</span></td>';
    h += '<td><div class="cd-dor-summary">' + esc(cdDorLastSummary(c)) + '</div><div class="cd-dor-sub">最后沟通：' + cdDorFmt(d.lastContactAt) + '</div></td>';
    h += '<td><span class="cd-dor-angle">' + recAngle.icon + ' ' + recAngle.label + '</span></td>';
    h += '<td class="cd-dor-ops">';
    h += '<button class="btn btn-primary btn-sm" onclick="cdDormantGenerateWakeup(\'' + c.id + '\')" ' + (busy?'disabled':'') + '>' + (busy?'⏳ 生成中':'✨ AI生成唤醒') + '</button>';

    // angle selector (dropdown)
    h += '<select class="cd-dor-angle-sel" onchange="cdDormantGenerateWakeup(\'' + c.id + '\',this.value)">';
    Object.keys(CD_DORMANT_ANGLES).forEach(function(k){
      h += '<option value="' + k + '"' + (k===d.recommendedAngle?' selected':'') + '>' + CD_DORMANT_ANGLES[k].icon + ' ' + CD_DORMANT_ANGLES[k].label + '</option>';
    });
    h += '</select>';

    h += '<button class="btn btn-outline btn-sm" onclick="cdDormantGiveUp(\'' + c.id + '\')" title="从沉睡列表移除">🗑️ 放弃</button>';
    h += '</td></tr>';

    // open wake panel (if this customer's wake is open)
    if(window._cdDorOpenWake){
      var attempts = d.wakeAttempts || [];
      var openWake = attempts.find(function(a){ return a.id === window._cdDorOpenWake; });
      if(openWake){
        h += '<tr class="cd-dor-wake-row"><td colspan="7">' + cdDorRenderWakePanel(c, openWake);
        // wake history
        if(attempts.length > 1){
          h += '<div class="cd-dor-history"><div class="cd-dor-hist-t">唤醒历史（' + attempts.length + '）</div>';
          attempts.forEach(function(a){
            var resLabel = { draft:'草稿', sent:'已发送', replied:'已回复🎉', no_response:'无回复' }[a.result] || a.result;
            h += '<div class="cd-dor-hist-item">· ' + cdDorFmt(a.date) + ' · ' + esc(a.angle||'') + ' → <b>' + esc(resLabel) + '</b></div>';
          });
          h += '</div>';
        }
        h += '</td></tr>';
      }
    }
    return h;
  }

  function cdDorRenderPage(root){
    var list = window.cdDormantGetList();
    var f = window._cdDorFilter || {};

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '<div><h2 style="margin:0">💤 沉睡客户唤醒</h2>'
      + '<div class="text-sm text-muted" style="margin-top:4px">30天无沟通自动识别 · 三级分类 · 5种唤醒角度 · 一键生成双语唤醒邮件</div></div>';
    h += '</div>';

    h += cdDorRenderStats();
    h += cdDorRenderFilterBar();

    // Filter by level
    var filtered = list;
    if(f.level && f.level !== 'all'){
      filtered = filtered.filter(function(c){ return c.cdDormant && c.cdDormant.level === f.level; });
    }

    if(!filtered.length){
      h += '<div class="cd-dor-empty">🎉 没有符合条件的沉睡客户。客户超过30天无沟通时会自动出现在这里。</div>';
      root.innerHTML = h; return;
    }

    h += '<table class="cd-dor-table"><thead><tr>'
      + '<th>客户</th><th>国家</th><th>品类</th><th>沉睡状态</th><th>最后沟通</th><th>推荐角度</th><th>操作</th>'
      + '</tr></thead><tbody>';
    filtered.forEach(function(c){ h += cdDorRenderRow(c); });
    h += '</tbody></table>';

    h += '<div class="cd-dor-footer">🔒 本模块只生成唤醒邮件草稿，不自动发送邮件/WhatsApp。请手动复制到邮箱发送。</div>';

    root.innerHTML = h;
  }

  // ============================================================
  // renderView interception
  // ============================================================
  var _cdDorOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'customerDevDormant'){
      cdDorRenderPage(document.getElementById('mainContent'));
      return;
    }
    _cdDorOrigRV.apply(this, arguments);
  };

  // ============================================================
  // Styles (cd- prefixed)
  // ============================================================
  var style = document.createElement('style');
  style.textContent = ''
    // stats
    + '.cd-dor-stats{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;}'
    + '.cd-dor-stat{flex:1;min-width:110px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;}'
    + '.cd-dor-stat-n{font-size:22px;font-weight:700;color:#2d3748;}'
    + '.cd-dor-stat-l{font-size:11.5px;color:#718096;margin-top:2px;}'
    + '.cd-dor-lv-light .cd-dor-stat-n{color:#3182ce;}'
    + '.cd-dor-lv-medium .cd-dor-stat-n{color:#dd6b20;}'
    + '.cd-dor-lv-deep .cd-dor-stat-n{color:#718096;}'
    // filter bar
    + '.cd-dor-filterbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin-bottom:14px;}'
    + '.cd-dor-filter-t{font-size:12.5px;color:#718096;font-weight:600;}'
    + '.cd-dor-mode{font-size:12px;padding:4px 12px;border:1px solid #e2e8f0;border-radius:14px;cursor:pointer;background:#fff;color:#4a5568;}'
    + '.cd-dor-mode.on{background:#3182ce;color:#fff;border-color:#3182ce;}'
    // table
    + '.cd-dor-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:13px;}'
    + '.cd-dor-table th{background:#f7fafc;color:#4a5568;text-align:left;padding:10px 12px;font-weight:600;border-bottom:1px solid #e2e8f0;font-size:12px;}'
    + '.cd-dor-table td{padding:10px 12px;border-bottom:1px solid #edf2f7;vertical-align:top;}'
    + '.cd-dor-table tr:last-child td{border-bottom:none;}'
    + '.cd-dor-cust{font-weight:600;color:#2d3748;}'
    + '.cd-dor-sub{font-size:11.5px;color:#a0aec0;margin-top:2px;}'
    + '.cd-dor-summary{font-size:12.5px;color:#4a5568;max-width:220px;}'
    + '.cd-dor-days{display:inline-block;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:10px;}'
    + '.cd-dor-angle{font-size:12px;color:#553c9a;background:#f3e8ff;padding:3px 8px;border-radius:6px;}'
    + '.cd-dor-ops{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}'
    + '.cd-dor-angle-sel{padding:4px 6px;border:1px solid #cbd5e0;border-radius:6px;font-size:11.5px;background:#fff;color:#2d3748;}'
    // wake panel
    + '.cd-dor-wake-row td{background:#faf5ff !important;padding:0 !important;}'
    + '.cd-dor-wake-panel{margin:10px;padding:14px;background:#fff;border:1px solid #d6bcfa;border-radius:10px;}'
    + '.cd-dor-wake-head{font-size:13px;font-weight:700;color:#553c9a;margin-bottom:10px;}'
    + '.cd-dor-mail-block{margin-bottom:10px;}'
    + '.cd-dor-mail-l{font-size:11.5px;font-weight:600;color:#718096;margin-bottom:3px;}'
    + '.cd-dor-mail-v{font-size:13px;color:#2d3748;background:#f7fafc;padding:8px 10px;border-radius:6px;line-height:1.6;}'
    + '.cd-dor-mail-v.pre{white-space:pre-wrap;}'
    + '.cd-dor-mail-v.zh{background:#fefcf7;color:#744210;}'
    + '.cd-dor-wake-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;}'
    + '.cd-dor-wake-hint{font-size:11.5px;color:#c53030;margin-top:10px;}'
    + '.cd-dor-history{margin-top:10px;border-top:1px dashed #d6bcfa;padding-top:10px;}'
    + '.cd-dor-hist-t{font-size:12px;font-weight:700;color:#553c9a;margin-bottom:6px;}'
    + '.cd-dor-hist-item{font-size:12px;color:#6b46c1;margin:3px 0;}'
    // empty / footer
    + '.cd-dor-empty{padding:36px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.cd-dor-footer{margin-top:16px;padding:10px;background:#fff5f5;border:1px solid #fed7d7;border-radius:10px;text-align:center;font-size:12px;color:#c53030;}'
    // responsive
    + '@media (max-width:900px){'
    + '  .cd-dor-table{display:block;overflow-x:auto;white-space:nowrap;}'
    + '  .cd-dor-summary{max-width:150px;}'
    + '  .cd-dor-ops{flex-direction:column;align-items:stretch;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
