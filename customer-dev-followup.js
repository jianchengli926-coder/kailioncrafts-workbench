/* ============================================================
 * Customer Development Follow-up Sequence (customer-dev-followup.js)
 * ----------------------------------------------------------------
 * Phase 4 — Feature 4.1 : Multi-round follow-up sequence engine.
 *
 * Day0 / Day3 / Day7 / Day14 / Day21 / Day30 — six-round nurture
 * sequence with per-round angle, conditional branching, horizontal
 * timeline visualization, and today-task integration.
 *
 * Angles:
 *   Day0  first outreach (already covered by customer-dev-email.js)
 *   Day3  pain-point deepening (mention customer site / product gaps)
 *   Day7  social proof (similar customers, certifications, export)
 *   Day14 value-added service (free marketing assets, logo wrap video)
 *   Day21 capacity / scheduling (peak season, capacity planning)
 *   Day30 soft exit (polite close, keep relationship warm)
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. "Mark sent" only records status.
 *   - 100% client-side free. No paid services.
 *   - All CSS classes use the cd- prefix. Code comments in English.
 *   - Does NOT modify app.js / server.js.
 * ============================================================ */
(function(){
  'use strict';

  // ── Constants ──────────────────────────────────────────────
  var CD_FOLLOWUP_STEPS = [
    { key:'first',      day:0,  label:'Day 0', labelFull:'Day 0 首次开发信', angle:'建立联系',
      angleEn:'First outreach — personalized opener' },
    { key:'followup3',  day:3,  label:'Day 3', labelFull:'Day 3 跟进',      angle:'痛点深化',
      angleEn:'Pain-point deepening — reference customer site / product gaps' },
    { key:'followup7',  day:7,  label:'Day 7', labelFull:'Day 7 跟进',      angle:'案例/社会证明',
      angleEn:'Social proof — similar buyers, certifications, export experience' },
    { key:'followup14', day:14, label:'Day 14', labelFull:'Day 14 跟进',    angle:'价值/增值服务',
      angleEn:'Value-added — free marketing assets, logo-wrapped factory video' },
    { key:'followup21', day:21, label:'Day 21', labelFull:'Day 21 跟进',    angle:'产能/排期',
      angleEn:'Capacity & scheduling — peak season planning, no urgency words' },
    { key:'followup30', day:30, label:'Day 30', labelFull:'Day 30 跟进',    angle:'软退出',
      angleEn:'Soft exit — polite close, keep door open, no pressure' }
  ];

  var CD_STEP_STATUS = {
    pending:   { label:'待启动', color:'#a0aec0' },
    due:       { label:'到期',   color:'#dd6b20' },
    generated: { label:'已生成', color:'#3182ce' },
    sent:      { label:'已发送', color:'#38a169' },
    skipped:   { label:'已跳过', color:'#718096' }
  };

  var CD_SIGNATURE = 'Best regards,\nLeo Li\nKaiLionCrafts\nWhatsApp: +86 131-3800-6564\nWeb: https://kailioncrafts.com';

  // Forbidden words (mirrors customer-dev-email.js)
  var CD_FORBIDDEN_WORDS = ['free','100%','guarantee','best','cheapest','amazing','perfect',
    'incredible','urgent','act now','limited time','click here','buy now',"don't miss",
    'exclusive','discount','sale','offer','special','deal','save','cheap'];

  // ── State init ─────────────────────────────────────────────
  (S.customers || []).forEach(function(c){
    if(!Array.isArray(c.cdEmails)) c.cdEmails = [];
    if(!c.cdFollowup) c.cdFollowup = null;
  });

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'customerDevFollowup',
    icon: '🔄',
    label: '跟进序列',
    title: '多轮跟进序列 · Day3/7/14/21/30',
    crumb: '条件分支 · 角度轮换 · 横向时间轴 · 今日任务联动'
  });

  // ── Ephemeral UI state ─────────────────────────────────────
  if(!window._cfState) window._cfState = { selectedCid:null, expandedStep:null, tab:'sequence' };

  // ============================================================
  // Helpers
  // ============================================================
  function cfNowISO(){ return new Date().toISOString(); }

  function cfFindCustomer(id){
    return (S.customers || []).find(function(x){ return x.id === id; }) || null;
  }

  function cfCustName(c){ return c ? (c.company || c.name || '(未命名)') : ''; }

  function cfDaysSince(iso){
    if(!iso) return 0;
    var d = new Date(iso);
    if(isNaN(d.getTime())) return 0;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  function cfFmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function cfParseJSON(content){
    if(!content) return null;
    try{
      var m = content.match(/```json\s*([\s\S]*?)```/);
      if(m && m[1]) return JSON.parse(m[1]);
      m = content.match(/\{[\s\S]*\}/);
      if(m) return JSON.parse(m[0]);
    }catch(e){}
    return null;
  }

  function cfWordCount(text){
    if(!text) return 0;
    var t = String(text).replace(/\(Best regards[\s\S]*$/i, '').trim();
    return t ? t.split(/\s+/).filter(Boolean).length : 0;
  }

  function cfQualityCheck(bodyEn){
    if(!bodyEn) return { score:0, words:[] };
    var lower = String(bodyEn).toLowerCase();
    var found = [];
    CD_FORBIDDEN_WORDS.forEach(function(w){
      var re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b','i');
      if(re.test(lower)) found.push(w);
    });
    var exclam = (String(bodyEn).match(/!/g) || []).length;
    if(exclam > 2) found.push('!×'+exclam);
    var score = Math.max(0, 100 - found.length * 8);
    return { score:score, words:found };
  }

  function cfFindEmail(c, type){
    if(!c || !Array.isArray(c.cdEmails)) return null;
    return c.cdEmails.find(function(e){ return e.type === type; }) || null;
  }

  function cfEnsureEmail(c, type, typeLabel){
    var e = cfFindEmail(c, type);
    if(e) return e;
    e = {
      id: 'cd_email_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6),
      type: type,
      typeLabel: typeLabel || type,
      subjectEn:'', subjectZh:'', bodyEn:'', bodyZh:'',
      subjectOptions:[],
      status:'not_generated',
      createdAt:cfNowISO(), updatedAt:cfNowISO(), sentAt:null,
      history:[], qualityScore:0, forbiddenWords:[],
      sellingPointsUsed:[], linksUsed:[]
    };
    c.cdEmails.push(e);
    return e;
  }

  // Has the customer replied (conditional branch: stop sequence)?
  function cfCustomerReplied(c){
    if(!c) return false;
    if(c.status && /已回复|replied/i.test(String(c.status))) return true;
    // cdConversations: any customer message after our last outbound
    if(Array.isArray(c.cdConversations) && c.cdConversations.length){
      var last = c.cdConversations[c.cdConversations.length-1];
      if(last && last.role === 'customer') return true;
    }
    return false;
  }

  // Is the customer flagged as dormant?
  function cfIsDormant(c){
    if(!c) return false;
    if(c.cdDormant && c.cdDormant.isDormant) return true;
    var days = cfDaysSince(c.lastContactAt || c.lastComm || c.lastInteraction);
    return days >= 30;
  }

  // ============================================================
  // Sequence initialization & state logic
  // ============================================================
  function cfBuildSteps(){
    return CD_FOLLOWUP_STEPS.map(function(s){
      return {
        key: s.key, day: s.day, label: s.label, angle: s.angle,
        status: 'pending', emailId:null, generatedAt:null, sentAt:null,
        skipped:false, skippedReason:''
      };
    });
  }

  // Reconcile a saved step array against the current 6-step template.
  // Preserves runtime state (status/emailId/sentAt/skipped) for steps that
  // already exist by key; appends any missing steps (e.g. legacy data that
  // only had Day0/3/7/14) in the correct order. This guarantees the
  // timeline always renders Day0/3/7/14/21/30.
  function cfNormalizeSteps(fu){
    if(!fu || !Array.isArray(fu.steps)) return;
    var byKey = {};
    fu.steps.forEach(function(s){ if(s && s.key) byKey[s.key] = s; });
    var rebuilt = CD_FOLLOWUP_STEPS.map(function(def){
      var existing = byKey[def.key];
      if(existing){
        // realign day/label/angle to the current template
        existing.day = def.day;
        existing.label = def.label;
        existing.angle = def.angle;
        return existing;
      }
      // missing step (e.g. followup21 / followup30 in old data) → fresh pending
      return {
        key: def.key, day: def.day, label: def.label, angle: def.angle,
        status: 'pending', emailId:null, generatedAt:null, sentAt:null,
        skipped:false, skippedReason:''
      };
    });
    fu.steps = rebuilt;
  }

  window.cdFollowupInit = function(cid){
    var c = cfFindCustomer(cid);
    if(!c){ toast('未找到客户', 'err'); return; }
    if(c.cdFollowup && c.cdFollowup.active){ toast('该客户已有进行中的序列', 'err'); return; }
    c.cdFollowup = {
      active: true,
      firstSentAt: cfNowISO(),
      paused: false,
      pausedReason: '',
      restartCount: 0,
      steps: cfBuildSteps(),
      createdAt: cfNowISO(),
      updatedAt: cfNowISO()
    };
    // Mark the first step as sent immediately (Day0 is the first outreach)
    var firstStep = c.cdFollowup.steps.find(function(s){ return s.key === 'first'; });
    if(firstStep){
      firstStep.status = 'sent';
      firstStep.sentAt = cfNowISO();
    }
    persist();
    toast('✅ 跟进序列已启动（Day0 已记录为已发送，倒计时开始）');
    renderView();
  };

  // Recompute each step's status based on firstSentAt
  function cfRefreshStatus(fu){
    if(!fu || !fu.active) return;
    if(!fu.firstSentAt) return;
    cfNormalizeSteps(fu); // ensure all 6 nodes exist before status calc
    fu.steps.forEach(function(st){
      if(st.status === 'sent' || st.status === 'skipped') return;
      var due = new Date(fu.firstSentAt);
      due.setDate(due.getDate() + st.day);
      var dueDate = due.getTime();
      var email = null;
      // find linked email
      if(st.emailId){
        var c = (S.customers||[]).find(function(x){ return x.id === fu._customerId; });
        if(c) email = (c.cdEmails||[]).find(function(e){ return e.id === st.emailId; });
      }
      if(Date.now() >= dueDate){
        if(st.status === 'pending') st.status = 'due';
        if(email && (email.status === 'generated' || email.status === 'edited') && st.status === 'due'){
          st.status = 'generated';
        }
      }else{
        if(st.status === 'due') st.status = 'pending';
      }
    });
    fu.updatedAt = cfNowISO();
  }

  window.cdFollowupGetStatus = function(cid){
    var c = cfFindCustomer(cid);
    if(!c || !c.cdFollowup || !c.cdFollowup.active){
      return { active:false, currentStep:null, daysUntilNext:null, nextStep:null };
    }
    var fu = c.cdFollowup;
    fu._customerId = cid;
    cfRefreshStatus(fu);
    // Find first non-sent, non-skipped step
    var next = fu.steps.find(function(s){ return s.status !== 'sent' && !s.skipped; });
    var daysUntilNext = null;
    if(next && fu.firstSentAt){
      var due = new Date(fu.firstSentAt);
      due.setDate(due.getDate() + next.day);
      daysUntilNext = Math.ceil((due.getTime() - Date.now()) / 86400000);
    }
    return {
      active: fu.active && !fu.paused,
      paused: fu.paused,
      currentStep: next ? next.key : null,
      daysUntilNext: daysUntilNext,
      nextStep: next,
      steps: fu.steps,
      firstSentAt: fu.firstSentAt
    };
  };

  window.cdFollowupMarkSent = function(cid, stepKey){
    var c = cfFindCustomer(cid);
    if(!c || !c.cdFollowup) return;
    var st = c.cdFollowup.steps.find(function(s){ return s.key === stepKey; });
    if(!st) return;
    st.status = 'sent';
    st.sentAt = cfNowISO();
    st.skipped = false;
    // Also mark the linked cdEmails record as sent
    if(st.emailId){
      var em = (c.cdEmails||[]).find(function(e){ return e.id === st.emailId; });
      if(em){ em.status = 'sent'; em.sentAt = cfNowISO(); }
    }
    // If the first step is marked sent after init, set firstSentAt
    if(stepKey === 'first' && !c.cdFollowup.firstSentAt){
      c.cdFollowup.firstSentAt = cfNowISO();
    }
    persist();
    toast('✅ 已记录「' + st.label + '」为已发送（请手动在邮箱发送）');
    renderView();
  };

  window.cdFollowupSkip = function(cid, stepKey, reason){
    var c = cfFindCustomer(cid);
    if(!c || !c.cdFollowup) return;
    var st = c.cdFollowup.steps.find(function(s){ return s.key === stepKey; });
    if(!st) return;
    st.status = 'skipped';
    st.skipped = true;
    st.skippedReason = reason || '手动跳过';
    persist();
    toast('已跳过「' + st.label + '」：' + st.skippedReason);
    renderView();
  };

  window.cdFollowupPause = function(cid, reason){
    var c = cfFindCustomer(cid);
    if(!c || !c.cdFollowup) return;
    c.cdFollowup.paused = true;
    c.cdFollowup.pausedReason = reason || '客户要求暂不跟进';
    persist();
    toast('⏸️ 序列已暂停：' + c.cdFollowup.pausedReason);
    renderView();
  };

  window.cdFollowupRestart = function(cid){
    var c = cfFindCustomer(cid);
    if(!c || !c.cdFollowup) return;
    c.cdFollowup.paused = false;
    c.cdFollowup.pausedReason = '';
    c.cdFollowup.restartCount = (c.cdFollowup.restartCount || 0) + 1;
    c.cdFollowup.firstSentAt = cfNowISO();
    c.cdFollowup.steps = cfBuildSteps();
    var firstStep = c.cdFollowup.steps.find(function(s){ return s.key === 'first'; });
    if(firstStep){ firstStep.status = 'sent'; firstStep.sentAt = cfNowISO(); }
    persist();
    toast('🔄 序列已重启（以今天为 Day0 重新倒计时）');
    renderView();
  };

  // Today's due followups (for the tasks dashboard)
  window.cdFollowupGetDueCustomers = function(){
    var out = [];
    (S.customers || []).forEach(function(c){
      if(!c.cdFollowup || !c.cdFollowup.active || c.cdFollowup.paused) return;
      if(cfCustomerReplied(c)) return; // stop sequence once customer replies
      var fu = c.cdFollowup;
      fu._customerId = c.id;
      cfRefreshStatus(fu);
      fu.steps.forEach(function(st){
        if(st.status === 'due' && !st.skipped){
          out.push({
            customerId: c.id,
            customerName: cfCustName(c),
            country: c.country || '',
            productCategory: c.productCategory || '',
            stepKey: st.key,
            stepLabel: st.label,
            angle: st.angle,
            day: st.day,
            firstSentAt: fu.firstSentAt
          });
        }
      });
    });
    return out;
  };

  // ============================================================
  // AI generation for each follow-up round
  // ============================================================
  function cfBuildHistoryBlock(c){
    // Summarize previously sent emails so AI does not repeat
    var sent = (c.cdEmails||[]).filter(function(e){ return e && e.status === 'sent' && e.bodyEn; });
    if(!sent.length) return '（暂无历史发送记录）';
    return sent.slice(-4).map(function(e, i){
      return '【已发送 #' + (i+1) + ' · ' + (e.typeLabel||e.type) + '】主题: ' + (e.subjectEn||'（无主题）')
        + '\n正文摘要: ' + String(e.bodyEn).substring(0, 200).replace(/\s+/g,' ');
    }).join('\n\n');
  }

  function cfBuildAngleInstruction(stepKey, c){
    var p = c.cdProfile || {};
    var cat = c.productCategory || (p.categoryMatch && p.categoryMatch[0]) || 'cutlery';
    var site = c.website || '';
    switch(stepKey){
      case 'followup3':
        return 'ANGLE: Pain-point deepening. Reference the customer\'s website or product category (' + cat + ') and point out ONE specific sourcing / quality / supply observation they may face (e.g. inconsistent edge retention, slow reorder cycles, fragmented suppliers). Offer a concrete angle on how our Yangjiang manufacturing partners address it. Keep it short (60-100 words). Do NOT re-pitch everything from the first email.';
      case 'followup7':
        return 'ANGLE: Social proof. Mention that similar buyers in their category work with our Yangjiang manufacturing network on OEM / private label, and reference compliance readiness (SGS LFGB / FDA style certifications as a category capability, do NOT invent specific customer names). Keep it low-pressure: "No need to reply now, just wanted to share." Embed a link to https://kailioncrafts.com/oem-odm/ naturally. 80-120 words.';
      case 'followup14':
        return 'ANGLE: Value-added service. Offer complimentary marketing support: product photos / short factory clips that can be branded with their logo. Point them to https://kailioncrafts.com/free-marketing-assets/ as a resource page. Frame it as "something useful regardless of whether we work together". 80-120 words. Do NOT use the word "free" — say "complimentary" or "at no additional cost".';
      case 'followup21':
        return 'ANGLE: Capacity & scheduling. Gently mention peak-season planning (Q4 / holiday stocking window) and suggest locking in production capacity early. DO NOT use words like "limited time", "urgent", "act now", "offer expires". Frame as forward-looking planning: "If you are mapping out next season\'s stock, here is what our production calendar typically looks like." 80-120 words. Do NOT invent specific MOQ numbers or prices.';
      case 'followup30':
        return 'ANGLE: Soft exit / graceful close. This is the last email in the sequence. Acknowledge that now may not be the right time. Keep the relationship warm: invite them to reach out anytime, wish their business well. No CTA pressure, no question that demands a reply. 50-90 words. Warm, professional, human tone.';
      default:
        return 'ANGLE: Standard gentle follow-up. 60-100 words.';
    }
  }

  window.cfGenerateStep = async function(cid, stepKey){
    var c = cfFindCustomer(cid);
    if(!c){ toast('未找到客户', 'err'); return; }
    if(!c.cdFollowup || !c.cdFollowup.active){ toast('请先启动跟进序列', 'err'); return; }
    var stepDef = CD_FOLLOWUP_STEPS.find(function(s){ return s.key === stepKey; });
    if(!stepDef){ toast('未知跟进轮次', 'err'); return; }
    var fu = c.cdFollowup;
    var step = fu.steps.find(function(s){ return s.key === stepKey; });
    if(!step) return;

    var email = cfEnsureEmail(c, stepKey, stepDef.labelFull);
    window._cfBusy = true;
    window._cfBusyMsg = 'AI 正在生成「' + stepDef.labelFull + ' · ' + stepDef.angle + '」…';
    renderView();

    try{
      var p = c.cdProfile || {};
      var prompt = ''
        + 'You are a senior B2B outbound email specialist for KaiLionCrafts, a Yangjiang-based knife & scissors manufacturing network.\n\n'
        + '【This is ROUND ' + stepDef.label + ' of a follow-up sequence (angle: ' + stepDef.angle + ')】\n'
        + cfBuildAngleInstruction(stepKey, c) + '\n\n'
        + '【Customer context】\n'
        + 'Company: ' + cfCustName(c) + '\n'
        + 'Country: ' + (c.country || 'Unknown') + '\n'
        + 'Buyer type: ' + (p.customerType || c.customerType || 'Unknown') + '\n'
        + 'Product category: ' + (c.productCategory || p.categoryMatch || 'Unknown') + '\n'
        + 'Website: ' + (c.website || 'Unknown') + '\n'
        + 'Intent: ' + (p.intentLevel || 'Unknown') + ' | Country tier: ' + (p.countryTier || 'C') + '\n\n'
        + '【Previously sent emails (DO NOT repeat these points / subjects)】\n'
        + cfBuildHistoryBlock(c) + '\n\n'
        + '【Writing rules — MUST follow】\n'
        + '- Short paragraphs. Greeting -> 1-2 short body paragraphs -> soft closing -> signature.\n'
        + '- Personalize the opening with ONE specific detail about this customer.\n'
        + '- Use "we" / "our Yangjiang manufacturing partners". Do NOT claim we own factories.\n'
        + '- Do NOT invent MOQ, price, lead time, certifications, named customers, or export numbers beyond what is given.\n'
        + '- FORBIDDEN English words (do NOT use): free, 100%, guarantee, best, cheapest, amazing, perfect, incredible, urgent, act now, limited time, click here, buy now, don\'t miss, exclusive, discount, sale, offer, special, deal, save, cheap.\n'
        + '- Max 2 exclamation marks. Avoid long ALL-CAPS words.\n'
        + '- Signature MUST be exactly:\n' + CD_SIGNATURE + '\n\n'
        + '【Output — STRICT JSON, no markdown, no extra text】\n'
        + '{\n'
        + '  "subjectOptions": ["option1","option2","option3"],\n'
        + '  "subjectEn": "chosen subject (English)",\n'
        + '  "subjectZh": "中文对照主题",\n'
        + '  "bodyEn": "email body in English, INCLUDING the English signature block",\n'
        + '  "bodyZh": "accurate Chinese translation of the whole email body for internal review"\n'
        + '}\n'
        + 'Return ONLY the JSON object.';

      var r = await callAI(
        [{ role:'user', content: prompt }],
        { purpose:'cd_followup', temperature:0.35, context:'kaiLionOutbound', useServerRouter:true, async:false, taskType:'text', numCtx:8192 }
      );

      window._cfBusy = false;
      if(r.error){ toast('AI生成失败：' + (r.error||''), 'err'); renderView(); return; }

      var data = cfParseJSON(r.content);
      if(!data || !data.bodyEn){ toast('AI返回格式异常，请重试', 'err'); renderView(); return; }

      // Preserve previous as history
      if(email.bodyEn){
        email.history.push({ version:(email.history.length+1), subjectEn:email.subjectEn, bodyEn:email.bodyEn, timestamp:cfNowISO() });
      }
      email.subjectOptions = Array.isArray(data.subjectOptions) ? data.subjectOptions : [];
      email.subjectEn = data.subjectEn || (email.subjectOptions[0] || '');
      email.subjectZh = data.subjectZh || '';
      email.bodyEn = data.bodyEn || '';
      email.bodyZh = data.bodyZh || '';
      email.status = 'generated';
      email.updatedAt = cfNowISO();
      email.typeLabel = stepDef.labelFull;

      var qr = cfQualityCheck(email.bodyEn);
      email.qualityScore = qr.score;
      email.forbiddenWords = qr.words;

      // Link step to email
      step.emailId = email.id;
      step.generatedAt = cfNowISO();
      if(step.status === 'due' || step.status === 'pending') step.status = 'generated';

      persist();
      toast('✅ ' + stepDef.labelFull + ' 已生成（质检 ' + qr.score + ' 分）');
      renderView();
    }catch(e){
      window._cfBusy = false;
      console.warn('[cf] generate failed:', e);
      toast('生成出错：' + (e.message||e), 'err');
      renderView();
    }
  };

  // ============================================================
  // Rendering
  // ============================================================
  function cfStatusBadge(st){
    var s = CD_STEP_STATUS[st] || CD_STEP_STATUS.pending;
    return '<span class="cd-badge" style="background:'+s.color+'22;color:'+s.color+'">'+s.label+'</span>';
  }

  function cfRenderTimeline(c, fu){
    var h = '<div class="cdf-timeline">';
    fu.steps.forEach(function(st, idx){
      var def = CD_FOLLOWUP_STEPS.find(function(s){ return s.key === st.key; });
      var color = (CD_STEP_STATUS[st.status]||CD_STEP_STATUS.pending).color;
      var dueDate = null;
      if(fu.firstSentAt){
        var d = new Date(fu.firstSentAt);
        d.setDate(d.getDate() + st.day);
        dueDate = d;
      }
      h += '<div class="cdf-tl-node" style="border-top-color:' + color + '">'
        + '<div class="cdf-tl-dot" style="background:' + color + '"></div>'
        + '<div class="cdf-tl-day">' + esc(st.label) + '</div>'
        + '<div class="cdf-tl-angle">' + esc(st.angle) + '</div>'
        + '<div class="cdf-tl-date">' + (dueDate ? cfFmtDate(dueDate.toISOString()) : '—') + '</div>'
        + '<div class="cdf-tl-status">' + cfStatusBadge(st.status) + '</div>'
        + '</div>';
      if(idx < fu.steps.length - 1) h += '<div class="cdf-tl-arrow">→</div>';
    });
    h += '</div>';
    return h;
  }

  function cfRenderStepPanel(c, fu, st){
    var def = CD_FOLLOWUP_STEPS.find(function(s){ return s.key === st.key; });
    var email = st.emailId ? (c.cdEmails||[]).find(function(e){ return e.id === st.emailId; }) : null;
    if(!email) email = cfFindEmail(c, st.key);
    var expanded = window._cfState.expandedStep === st.key;
    var canAct = fu.active && !fu.paused && !cfCustomerReplied(c);

    var h = '<div class="cd-group' + (expanded?' on':'') + '">';
    h += '<div class="cd-group-head' + (expanded?' on':'') + '" onclick="cfToggleStep(\'' + st.key + '\')">'
      + '<span class="cd-group-arrow">' + (expanded?'▼':'▶') + '</span>'
      + '<span class="cd-group-title">' + esc(def.labelFull) + ' <small class="text-muted">· ' + esc(st.angle) + '</small></span>'
      + cfStatusBadge(st.status);
    if(email && email.subjectEn){
      h += '<span class="cd-group-summary">' + esc(email.subjectEn.substring(0,30)) + (email.subjectEn.length>30?'…':'') + '</span>';
    }else{
      h += '<span class="cd-group-summary text-muted">' + esc(def.angleEn) + '</span>';
    }
    h += '<span class="cd-group-actions" onclick="event.stopPropagation()">';
    if(canAct && st.status !== 'sent' && !st.skipped){
      h += '<button class="btn btn-primary btn-sm" onclick="cfGenerateStep(\'' + c.id + '\',\'' + st.key + '\')"' + (window._cfBusy?' disabled':'') + '>'
        + (email && email.status !== 'not_generated' ? '重新生成' : '✨ 生成') + '</button>';
    }
    if(email && email.status !== 'not_generated' && st.status !== 'sent'){
      h += '<button class="btn btn-outline btn-sm" onclick="cdFollowupMarkSent(\'' + c.id + '\',\'' + st.key + '\')">✓ 标记已发送</button>';
    }
    if(canAct && st.status !== 'sent' && !st.skipped && st.key !== 'first'){
      h += '<button class="btn btn-outline btn-sm" onclick="cfSkipPrompt(\'' + c.id + '\',\'' + st.key + '\')" title="跳过本轮">⏭ 跳过</button>';
    }
    h += '</span></div>';

    if(expanded){
      h += '<div class="cd-group-body">';
      if(!canAct){
        h += '<div class="cdf-warn">'
          + (cfCustomerReplied(c) ? '✅ 客户已回复，序列自动停止。请转入正常询盘沟通。' : '')
          + (fu.paused ? '⏸️ 序列已暂停（' + esc(fu.pausedReason||'') + '）。点击下方「重启序列」恢复。' : '')
          + (cfIsDormant(c) && !fu.paused ? '💤 客户已进入沉睡，建议改用唤醒邮件。' : '')
          + '</div>';
      }
      if(email && email.bodyEn){
        h += '<div class="cdf-mailbox">';
        h += '<div class="cdf-mailhead">📤 英文发送版 <span class="cd-wc">' + cfWordCount(email.bodyEn) + ' 词</span>'
          + '<span class="cdf-mail-actions">'
          + '<button class="btn btn-outline btn-sm" onclick="cfCopyEmail(\'' + c.id + '\',\'' + email.id + '\',\'en\')">📋 复制英文</button>'
          + '<button class="btn btn-outline btn-sm" onclick="cfCopyEmail(\'' + c.id + '\',\'' + email.id + '\',\'zh\')">📋 复制中文</button>'
          + '</span></div>';
        h += '<div class="cdf-subj">主题：' + esc(email.subjectEn) + '</div>';
        h += '<pre class="cdf-body">' + esc(email.bodyEn) + '</pre>';
        if(email.bodyZh){
          h += '<div class="cdf-mailhead" style="margin-top:10px">📝 中文对照审核</div>';
          h += '<pre class="cdf-body cf-body-zh">' + esc(email.bodyZh) + '</pre>';
        }
        if(email.forbiddenWords && email.forbiddenWords.length){
          h += '<div class="cdf-fb">⚠️ 违禁词命中：' + email.forbiddenWords.map(function(w){ return '<mark class="cd-mark">'+esc(w)+'</mark>'; }).join('、') + '</div>';
        }
        h += '</div>';
      }else{
        h += '<div class="cdf-empty-step">尚未生成。点击右上角「✨ 生成」由 AI 按「' + esc(st.angle) + '」角度撰写。</div>';
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function cfSkipPrompt(cid, stepKey){
    var reason = prompt('请输入跳过原因（可选）：');
    cdFollowupSkip(cid, stepKey, reason || '手动跳过');
  }

  window.cfSkipPrompt = cfSkipPrompt;

  window.cfCopyEmail = function(cid, emailId, which){
    var c = cfFindCustomer(cid);
    if(!c) return;
    var em = (c.cdEmails||[]).find(function(e){ return e.id === emailId; });
    if(!em) return;
    var text = which === 'en'
      ? 'Subject: ' + (em.subjectEn||'') + '\n\n' + (em.bodyEn||'')
      : '主题: ' + (em.subjectZh||'') + '\n\n' + (em.bodyZh||'');
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ toast('✅ 已复制到剪贴板'); }).catch(function(){ toast('复制失败', 'err'); });
    }else{
      try{
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        toast('✅ 已复制');
      }catch(e){ toast('复制失败', 'err'); }
    }
  };

  window.cfToggleStep = function(key){
    window._cfState.expandedStep = (window._cfState.expandedStep === key) ? null : key;
    renderView();
  };

  window.cfSelectCustomer = function(cid){
    window._cfState.selectedCid = cid;
    window._cfState.expandedStep = null;
    renderView();
  };

  function cfRenderPage(root){
    var customers = S.customers || [];
    var cid = window._cfState.selectedCid || (customers[0] && customers[0].id);
    var c = cid ? cfFindCustomer(cid) : null;
    if(!c && customers.length){ c = customers[0]; cid = c.id; window._cfState.selectedCid = cid; }

    var h = '';
    h += '<div class="flex-between mb16">'
      + '<div><h2 style="margin:0">🔄 多轮跟进序列</h2>'
      + '<div class="text-sm text-muted" style="margin-top:4px">Day0/3/7/14/21/30 · 角度轮换 · 条件分支 · 全程不自动发送</div></div>'
      + '</div>';

    if(!customers.length){
      h += '<div class="cd-empty">客户台账为空。请先在「客户背调画像」页生成客户。</div>';
      root.innerHTML = h; return;
    }

    // Customer selector
    h += '<div class="cd-selector"><label class="cd-sel-label">选择客户：</label>';
    h += '<select class="cd-sel" onchange="cfSelectCustomer(this.value)">';
    customers.forEach(function(x){
      var active = x.cdFollowup && x.cdFollowup.active;
      h += '<option value="' + esc(x.id) + '"' + (x.id===cid?' selected':'') + '>'
        + esc(cfCustName(x)) + '（' + esc(x.country||'未知') + (active?' · 序列进行中':'') + '）</option>';
    });
    h += '</select></div>';

    if(!c){ root.innerHTML = h; return; }

    // Sequence status summary
    var fu = c.cdFollowup;
    if(!fu || !fu.active){
      h += '<div class="cdf-no-seq">';
      h += '<div class="cdf-no-seq-t">该客户尚未启动跟进序列</div>';
      h += '<div class="cd-hint">首次开发信在「开发信引擎」页生成并标记已发送后，回到这里启动序列，倒计时将以首次发送日为 Day0。</div>';
      // Check if first email exists
      var firstEmail = cfFindEmail(c, 'first');
      if(firstEmail && firstEmail.status === 'sent'){
        h += '<button class="btn btn-primary" style="margin-top:12px" onclick="cdFollowupInit(\'' + c.id + '\')">🚀 启动跟进序列（以今天为 Day0）</button>';
      }else{
        h += '<div class="cd-hint" style="margin-top:8px;color:#dd6b20">⚠️ 尚未检测到已发送的首次开发信。请先到「开发信引擎」生成并标记 Day0 已发送。</div>';
      }
      h += '</div>';
      root.innerHTML = h; return;
    }

    fu._customerId = c.id;
    cfRefreshStatus(fu);
    var st = window.cdFollowupGetStatus(cid);

    // Summary bar
    var replied = cfCustomerReplied(c);
    h += '<div class="cdf-summary">'
      + '<span class="cd-pb-item">📅 首次发送：<b>' + cfFmtDate(fu.firstSentAt) + '</b></span>'
      + '<span class="cd-pb-item">⏳ 已进行：<b>' + cfDaysSince(fu.firstSentAt) + ' 天</b></span>'
      + '<span class="cd-pb-item">🎯 当前轮次：<b>' + (st.nextStep ? esc(st.nextStep.label + ' · ' + st.nextStep.angle) : '序列已走完') + '</b></span>'
      + '<span class="cd-pb-item">📆 下次到期：<b>' + (st.daysUntilNext !== null ? (st.daysUntilNext > 0 ? st.daysUntilNext + ' 天后' : '已到期') : '—') + '</b></span>'
      + (fu.paused ? '<span class="cd-pb-item" style="color:#c53030">⏸️ 已暂停</span>' : '')
      + (replied ? '<span class="cd-pb-item" style="color:#38a169">✅ 客户已回复，序列停止</span>' : '')
      + '</div>';

    // Timeline
    h += cfRenderTimeline(c, fu);

    // Control bar
    h += '<div class="cdf-controls">'
      + (fu.paused
        ? '<button class="btn btn-primary btn-sm" onclick="cdFollowupRestart(\'' + c.id + '\')">▶ 重启序列</button>'
        : '<button class="btn btn-outline btn-sm" onclick="cdFollowupPause(\'' + c.id + '\', prompt(\'暂停原因：\') || \'客户要求暂不跟进\')">⏸ 暂停序列</button>')
      + '<button class="btn btn-outline btn-sm" onclick="if(confirm(\'确定以今天为 Day0 重启整个序列？已有记录将保留在历史中。\')) cdFollowupRestart(\'' + c.id + '\')">🔄 重置序列</button>'
      + '<span class="cd-hint">重启后以今天为 Day0 重新倒计时；跳过的轮次不会补回。</span>'
      + '</div>';

    // Step panels
    h += '<div class="cd-groups">';
    fu.steps.forEach(function(stp){
      h += cfRenderStepPanel(c, fu, stp);
    });
    h += '</div>';

    // Safety footer
    h += '<div class="cd-footer-bar">'
      + '<span class="cd-hint">🔒 本工作台只生成跟进信内容与提醒，<b>绝不自动发送邮件/WhatsApp</b>。「标记已发送」仅记录状态，请手动在邮箱发送。'
      + '客户一旦回复，序列自动停止；沉睡客户请改用「沉睡唤醒」邮件。</span></div>';

    root.innerHTML = h;
  }

  // ── renderView interception ───────────────────────────────
  var _cfOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'customerDevFollowup'){
      cfRenderPage(document.getElementById('mainContent'));
      return;
    }
    _cfOrigRV.apply(this, arguments);
  };

  // ── Styles (cd- prefixed, responsive) ─────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.cdf-timeline{display:flex;align-items:flex-start;gap:4px;margin:14px 0;padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow-x:auto;}'
    + '.cdf-tl-node{flex:1;min-width:110px;text-align:center;border-top:3px solid #a0aec0;padding-top:10px;position:relative;}'
    + '.cdf-tl-dot{width:12px;height:12px;border-radius:50%;margin:0 auto 6px;}'
    + '.cdf-tl-day{font-size:13px;font-weight:700;color:#2d3748;}'
    + '.cdf-tl-angle{font-size:11.5px;color:#4a5568;margin-top:2px;}'
    + '.cdf-tl-date{font-size:11px;color:#a0aec0;margin-top:2px;}'
    + '.cdf-tl-status{margin-top:6px;}'
    + '.cdf-tl-arrow{color:#cbd5e0;font-size:18px;align-self:center;padding-top:20px;}'
    + '.cdf-summary{display:flex;gap:16px;flex-wrap:wrap;background:#ebf8ff;border:1px solid #bee3f8;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#2a4365;}'
    + '.cdf-controls{display:flex;gap:8px;align-items:center;margin:12px 0;flex-wrap:wrap;}'
    + '.cdf-no-seq{padding:30px;text-align:center;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:12px;}'
    + '.cdf-no-seq-t{font-size:16px;font-weight:700;color:#2d3748;margin-bottom:8px;}'
    + '.cdf-warn{padding:10px 14px;background:#fffaf0;border:1px solid #fbd38d;border-radius:8px;color:#975a16;font-size:13px;margin-bottom:10px;line-height:1.6;}'
    + '.cdf-mailbox{border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;}'
    + '.cdf-mailhead{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f7fafc;font-size:13px;font-weight:700;color:#2d3748;}'
    + '.cdf-mail-actions{margin-left:auto;display:flex;gap:6px;}'
    + '.cdf-subj{padding:8px 12px;font-size:13px;font-weight:600;color:#2b6cb0;border-bottom:1px solid #edf2f7;}'
    + '.cdf-body{padding:12px;font-size:13px;line-height:1.7;white-space:pre-wrap;background:#fff;margin:0;font-family:inherit;}'
    + '.cdf-body-zh{background:#fefcf7;color:#4a5568;}'
    + '.cdf-fb{padding:8px 12px;background:#fff5f5;color:#c53030;font-size:12px;border-top:1px solid #fed7d7;}'
    + '.cdf-empty-step{padding:20px;text-align:center;color:#a0aec0;font-size:13px;background:#f7fafc;border-radius:8px;}'
    + '.cd-wc{font-size:11.5px;font-weight:400;color:#a0aec0;margin-left:auto;}'
    + '@media (max-width:900px){'
    + '  .cdf-timeline{flex-direction:column;}'
    + '  .cdf-tl-node{border-top:none;border-left:3px solid;padding:0 0 0 14px;text-align:left;}'
    + '  .cdf-tl-dot{display:none;}'
    + '  .cdf-tl-arrow{display:none;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
