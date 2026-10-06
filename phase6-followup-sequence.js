/* ============================================================
 * P6 Phase6 Module: Follow-up Sequence Workbench
 * ----------------------------------------------------------------
 * Feature 9:  Auto follow-up sequence (Day1/3/7/14) + conditional
 *             branching (replied / unsubscribed / opened-not-replied /
 *             not-opened). AI only generates DRAFTS — NEVER sends.
 * Feature 11: Customer A/B/C tiering + differentiated strategy.
 * Feature 16: Channel fallback suggestions.
 *
 * HARD RULE: This module NEVER sends any email / WhatsApp. It only
 * builds sequences, drafts, reminders and suggestions. The user sends
 * manually. All CSS classes use the p6- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init (already wired into app.js load/persist) ──
  if(!Array.isArray(S.p6Sequences)) S.p6Sequences = [];
  if(!Array.isArray(S.p6SequenceAssignments)) S.p6SequenceAssignments = [];
  if(!Array.isArray(S.p6FallbackSuggestions)) S.p6FallbackSuggestions = [];

  // Seed a default Day1/3/7/14 sequence on first run
  if(S.p6Sequences.length === 0){
    S.p6Sequences.push({
      id: 'p6-default-seq',
      name: '标准跟进序列 (Day1/3/7/14)',
      isDefault: true,
      steps: [
        { day: 1,  label: '首次开发信' },
        { day: 3,  label: '第一次跟进' },
        { day: 7,  label: '第二次跟进' },
        { day: 14, label: '最终/断联信' }
      ],
      createdAt: new Date().toISOString()
    });
  }

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'followupSequence',
    icon: '📚',
    label: '序列模板分级',
    title: '跟进序列模板与客户分级（旧版·Day1/3/7/14）',
    crumb: 'Day1/3/7/14 · A/B/C分级 · 渠道fallback · 新版6轮跟进见「跟进序列」'
  });

  // ── Local helpers ───────────────────────────────────────────
  function p6NowISO(){ return new Date().toISOString(); }

  function p6FmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p6AddDays(startISO, days){
    var d = new Date(startISO);
    if(isNaN(d.getTime())) d = new Date();
    d.setDate(d.getDate() + (parseInt(days,10) || 0));
    return d.toISOString();
  }

  function p6DaysSince(iso){
    if(!iso) return 9999;
    var d = new Date(iso);
    if(isNaN(d.getTime())) return 9999;
    return (Date.now() - d.getTime()) / 86400000;
  }

  function p6FindCustomer(id){
    return (S.customers||[]).find(function(x){ return x.id === id; }) || null;
  }

  function p6FindCustomerByEmail(email){
    if(!email) return null;
    return (S.customers||[]).find(function(x){
      var e = p6CustomerEmail(x);
      return e && e.toLowerCase() === String(email).toLowerCase();
    }) || null;
  }

  function p6CustomerEmail(c){
    try{ if(typeof getCustomerPrimaryEmail === 'function'){ var e = getCustomerPrimaryEmail(c); if(e) return e; } }catch(e){}
    return (c && c.contact && c.contact.email) || '';
  }

  // Robust JSON extraction from AI response (handles ```json blocks)
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

  // ── Conditional branching detectors ────────────────────────
  function p6CustomerReplied(c){
    if(!c) return false;
    if(c.status === '已回复') return true;
    // inbox reply exists for this customer
    var hasReply = (S.inbox||[]).some(function(it){
      if(it.customerId && it.customerId === c.id) return true;
      if(it.from && p6FindCustomerByEmail(it.from) && p6FindCustomerByEmail(it.from).id === c.id) return true;
      return false;
    });
    return hasReply;
  }

  function p6CustomerUnsubscribed(c){
    if(!c) return false;
    var s = String(c.status || '');
    if(s.indexOf('退订') >= 0 || s.indexOf('黑名单') >= 0 || s.indexOf('Black') >= 0 || s.indexOf('unsub') >= 0) return true;
    var tags = (c.tags||[]).join(',');
    if(tags.indexOf('退订') >= 0 || tags.indexOf('黑名单') >= 0) return true;
    return false;
  }

  function p6CountOpens(c){
    if(!c) return 0;
    return (S.sendRecords||[]).filter(function(r){
      return r.customerId === c.id && r.openStatus === 'opened';
    }).length;
  }

  // Returns: 'replied' | 'unsubscribed' | 'opened-not-replied' | 'not-opened'
  function p6DetectCondition(c){
    if(p6CustomerReplied(c)) return 'replied';
    if(p6CustomerUnsubscribed(c)) return 'unsubscribed';
    if(p6CountOpens(c) > 0) return 'opened-not-replied';
    return 'not-opened';
  }

  function p6ConditionLabel(cond){
    if(cond === 'replied') return '客户已回复';
    if(cond === 'unsubscribed') return '退订/黑名单';
    if(cond === 'opened-not-replied') return '已读未回';
    if(cond === 'not-opened') return '未打开';
    return '未评估';
  }

  // Evaluate branching on an active assignment; stop/completed/cooldown as needed
  function p6EvaluateAssignment(a){
    if(!a || a.status !== 'active') return;
    var c = p6FindCustomer(a.customerId);
    if(!c) return;
    var cond = p6DetectCondition(c);
    if(cond === 'replied'){
      a.status = 'completed';
      try{ addTimelineEvent(c.id, 'sequence_done', '序列自动完成（客户已回复）', a.sequenceName, {assignmentId:a.id}); }catch(e){}
      toast('✅ '+c.company+' 已回复，序列自动结束');
    } else if(cond === 'unsubscribed'){
      a.status = 'cooldown';
      try{ addTimelineEvent(c.id, 'sequence_cooldown', '序列进入冷却（客户退订/黑名单）', a.sequenceName, {assignmentId:a.id}); }catch(e){}
      toast('⚠️ '+c.company+' 退订/黑名单，序列已暂停', 'err');
    }
    // stamp condition on current pending step
    var cur = a.steps[a.currentStep];
    if(cur && cur.status === 'pending') cur.condition = cond;
  }

  // Evaluate every active assignment (call when dashboard opens / step done)
  function p6EvaluateAll(){
    (S.p6SequenceAssignments||[]).forEach(p6EvaluateAssignment);
  }

  // ── Feature 9: Sequence template manager ────────────────────
  window.p6NewTemplate = function(){
    S.p6Sequences.push({
      id: uid(),
      name: '新建跟进序列 ' + (S.p6Sequences.length + 1),
      isDefault: false,
      steps: [
        { day: 1,  label: '首次触达' },
        { day: 3,  label: '跟进1' },
        { day: 7,  label: '跟进2' },
        { day: 14, label: '最后跟进' }
      ],
      createdAt: p6NowISO()
    });
    persist(); renderView();
  };

  window.p6SaveTemplate = function(seqId){
    var seq = (S.p6Sequences||[]).find(function(s){ return s.id === seqId; });
    if(!seq) return;
    var nameEl = document.getElementById('p6_tpl_name_' + seqId);
    if(nameEl) seq.name = nameEl.value.trim() || seq.name;
    // re-read each step day/label from DOM
    var newSteps = [];
    for(var i = 0; i < 12; i++){
      var dEl = document.getElementById('p6_tpl_day_' + seqId + '_' + i);
      var lEl = document.getElementById('p6_tpl_label_' + seqId + '_' + i);
      if(!dEl) break;
      var day = parseInt(dEl.value, 10);
      if(isNaN(day) || day < 0) day = 1;
      newSteps.push({ day: day, label: (lEl && lEl.value) || ('Step ' + (i+1)) });
    }
    if(newSteps.length === 0){ toast('至少需要1个步骤', 'err'); return; }
    seq.steps = newSteps;
    persist(); toast('✅ 序列模板已保存'); renderView();
  };

  window.p6DelTemplate = function(seqId){
    var used = (S.p6SequenceAssignments||[]).some(function(a){ return a.sequenceId === seqId; });
    if(used){ toast('该序列已被客户使用，无法删除', 'err'); return; }
    S.p6Sequences = (S.p6Sequences||[]).filter(function(s){ return s.id !== seqId; });
    persist(); toast('已删除序列模板'); renderView();
  };

  // Assign a sequence to a customer (one active sequence per customer)
  window.p6AssignSequence = function(customerId, sequenceId){
    if(!customerId || !sequenceId) return;
    var existing = (S.p6SequenceAssignments||[]).find(function(a){
      return a.customerId === customerId && a.status === 'active';
    });
    if(existing){ toast('该客户已有进行中的序列，请先结束它', 'err'); return; }
    var seq = (S.p6Sequences||[]).find(function(s){ return s.id === sequenceId; });
    var c = p6FindCustomer(customerId);
    if(!seq || !c){ toast('客户或序列不存在', 'err'); return; }
    var start = p6NowISO();
    var steps = seq.steps.map(function(st, i){
      return { step: i, dueDate: p6AddDays(start, st.day), status: 'pending', condition: null, generatedSubject: '', generatedBody: '' };
    });
    S.p6SequenceAssignments.push({
      id: uid(),
      customerId: customerId,
      customerName: c.company,
      sequenceId: seq.id,
      sequenceName: seq.name,
      currentStep: 0,
      startDate: start,
      status: 'active',
      steps: steps,
      createdAt: start
    });
    try{ addTimelineEvent(customerId, 'sequence_start', '开始跟进序列：' + seq.name, '共' + seq.steps.length + '步，首步到期 ' + p6FmtDate(steps[0].dueDate)); }catch(e){}
    persist(); toast('✅ 已为 ' + c.company + ' 分配序列'); renderView();
  };

  // Pause / resume / stop an assignment
  window.p6SetAssignmentStatus = function(aid, status){
    var a = (S.p6SequenceAssignments||[]).find(function(x){ return x.id === aid; });
    if(!a) return;
    a.status = status;
    var c = p6FindCustomer(a.customerId);
    try{ if(c) addTimelineEvent(c.id, 'sequence_' + status, '序列状态 → ' + status, a.sequenceName); }catch(e){}
    persist(); renderView();
  };

  // Mark current step done, advance to next
  window.p6StepDone = function(aid){
    var a = (S.p6SequenceAssignments||[]).find(function(x){ return x.id === aid; });
    if(!a) return;
    p6EvaluateAssignment(a);
    if(a.status !== 'active'){ renderView(); return; }
    var cur = a.steps[a.currentStep];
    if(cur) cur.status = 'done';
    var c = p6FindCustomer(a.customerId);
    try{ if(c) addTimelineEvent(c.id, 'sequence_step', '完成第' + (a.currentStep+1) + '步', a.sequenceName); }catch(e){}
    a.currentStep++;
    if(a.currentStep >= a.steps.length){
      a.status = 'completed';
      try{ if(c) addTimelineEvent(c.id, 'sequence_done', '序列全部完成', a.sequenceName); }catch(e){}
      toast('🎉 序列已全部完成');
    }
    persist(); renderView();
  };

  // AI-generate the current step email DRAFT (never sends)
  window.p6GenStepEmail = async function(aid){
    var a = (S.p6SequenceAssignments||[]).find(function(x){ return x.id === aid; });
    if(!a){ toast('未找到序列', 'err'); return; }
    p6EvaluateAssignment(a);
    if(a.status !== 'active'){ toast('该序列已结束，无需生成', 'err'); renderView(); return; }
    var c = p6FindCustomer(a.customerId);
    var seq = (S.p6Sequences||[]).find(function(s){ return s.id === a.sequenceId; });
    if(!c || !seq){ toast('客户或序列缺失', 'err'); return; }
    var stepTpl = seq.steps[a.currentStep] || { day: 0, label: '跟进' };
    var step = a.steps[a.currentStep];
    var cond = step.condition || p6DetectCondition(c);

    toast('AI 正在生成第' + (a.currentStep+1) + '步邮件草稿…');
    var f = S.companyFacts || {};
    var condGuidance = cond === 'opened-not-replied'
      ? '客户已打开邮件但未回复：语气可更直接，强调一个新价值点（案例/认证/限时样品），推动回复。'
      : (cond === 'not-opened'
        ? '客户未打开邮件：标题必须短而有钩子（利益/好奇），正文极简，一句话说清价值与CTA。'
        : '常规专业跟进，不施压，提供一个明确的下一步。');

    var prompt = '你是B2B外贸资深销售。请为以下跟进步骤写一封英文开发/跟进邮件草稿。\n'
      + '【公司事实】品牌：' + (f.brandName || 'KaiLionCrafts')
      + '；品类：' + ((f.categories||[]).join(',') || '厨房刀具、剪刀、户外用品')
      + ((f.certifications && f.certifications.length) ? '；认证：' + f.certifications.join(',') : '')
      + (f.moq ? '；MOQ：' + f.moq : '') + (f.leadTime ? '；交期：' + f.leadTime : '') + '\n'
      + '【客户】公司：' + c.company + '；国家：' + (c.country||'') + '；关注品类：' + (c.productCategory||'未指定') + '\n'
      + '【当前步骤】第' + (a.currentStep+1) + '步（开始后第' + stepTpl.day + '天）— ' + stepTpl.label + '\n'
      + '【分支语境】' + p6ConditionLabel(cond) + '。' + condGuidance + '\n'
      + '要求：英文；主题≤8个词；正文80-130词；专业、简短、带一个明确CTA（回复/约call/索样）；不要承诺未确认的数字或价格。\n'
      + '只输出JSON：{"subject":"...","body":"..."}。';

    try{
      var r = await callAI(
        [{ role: 'user', content: prompt }],
        { purpose: 'p6_followup', timeout: 60000, temperature: 0.3, model: 'gpt-5.6-terra' }
      );
      if(r.error){ toast('AI生成失败：' + (r.error||'未知错误'), 'err'); return; }
      var j = p6ParseAIJSON(r.content);
      if(!j || !j.subject){ toast('AI返回格式异常，已重试请稍后', 'err'); return; }
      step.generatedSubject = String(j.subject).slice(0, 200);
      step.generatedBody = String(j.body || '').slice(0, 2000);
      step.condition = cond;
      if(step.status === 'pending') step.status = 'draft';
      try{ addTimelineEvent(c.id, 'ai_draft', 'AI生成跟进邮件草稿（第' + (a.currentStep+1) + '步）', step.generatedSubject, {assignmentId:a.id}); }catch(e){}
      persist(); toast('✅ 草稿已生成（仅草稿，未发送，请手动去草稿页发送）'); renderView();
    }catch(err){
      console.warn('[p6] gen step email failed', err);
      toast('生成出错：' + (err.message||err), 'err');
    }
  };

  // Copy generated draft into the drafts page for manual send
  window.p6UseDraft = function(aid){
    var a = (S.p6SequenceAssignments||[]).find(function(x){ return x.id === aid; });
    if(!a) return;
    go('drafts', { customerId: a.customerId });
    toast('已跳转草稿页，请手动编写/发送（本工作台不自动发送）');
  };

  // ── Feature 11: A/B/C Tiering ──────────────────────────────
  function p6CalcTier(c){
    // Component 1: lead score 0-100 (40%)
    var lead = c.leadScore;
    if(lead == null || isNaN(lead)) lead = (c.scores && c.scores.total) || 50;
    lead = Math.max(0, Math.min(100, Number(lead) || 50));

    // Component 2: behavior / dynamic intent 0-100 (30%)
    var beh = c.dynamicIntentScore;
    if(beh == null || isNaN(beh)){
      var pts = 0;
      (c.behaviorSignals||[]).forEach(function(s){ pts += (Number(s.points) || 0); });
      beh = Math.max(0, Math.min(100, 50 + pts));
    }
    beh = Math.max(0, Math.min(100, Number(beh) || 50));

    // Component 3: BANT completeness 0-100 (20%)
    var bant = 50;
    if(c.bant){
      var filled = 0;
      ['budget','authority','need','timeline'].forEach(function(k){ if(c.bant[k]) filled++; });
      bant = Math.round(filled / 4 * 100);
    }

    // Component 4: customer type / source quality 0-100 (10%)
    var src = 50;
    var ct = String(c.customerType||'');
    var so = String(c.source||'');
    if(ct === '询盘' || ct === 'inquiry' || ct === '老客户' || ct === 'existing' || ct === '客户') src = 90;
    else if(so === '展会' || so === 'referral' || so === '主动询盘' || so === '官网询盘') src = 80;
    else if(so === 'cold' || so === 'import' || so === '海关数据' || so === 'list') src = 45;

    var score = Math.round(lead*0.4 + beh*0.3 + bant*0.2 + src*0.1);
    var tier = score >= 75 ? 'A' : (score >= 50 ? 'B' : 'C');

    // Human-readable reason
    var reasons = [];
    if(lead >= 70) reasons.push('线索分高(' + Math.round(lead) + ')');
    else if(lead < 40) reasons.push('线索分低(' + Math.round(lead) + ')');
    if(beh >= 70) reasons.push('行为活跃(' + Math.round(beh) + ')');
    else if(beh < 40) reasons.push('行为冷淡(' + Math.round(beh) + ')');
    if(bant >= 75) reasons.push('BANT信息完整');
    else if(bant <= 25) reasons.push('BANT缺失');
    if(src >= 80) reasons.push('高质量来源');
    else if(src <= 45) reasons.push('低质量来源');

    return { tier: tier, score: score, reason: reasons.join(' · ') || '综合评分' };
  }

  var P6_TIER_STRATEGY = {
    A: { freq: '每周跟进', channels: '邮件 + WhatsApp + 电话（多渠道）', cadence: 'Day1邮件 → Day3 WhatsApp → Day7电话 → Day14报价', action: '高意向高价值，优先分配时间，加速样品/报价流程' },
    B: { freq: '每两周跟进', channels: '邮件为主，WhatsApp辅助', cadence: 'Day1邮件 → Day7邮件 → Day14 WhatsApp', action: '潜力客户，持续培育，等待触发信号升级到A' },
    C: { freq: '每月触达', channels: '内容营销邮件', cadence: '月度Newsletter / 产品动态 / 行业案例', action: '长期养客，用内容保持存在感，不占用大量人力' }
  };

  function p6EnsureTier(c){
    if(c.p6TierManual) return; // respect manual override
    var r = p6CalcTier(c);
    c.p6Tier = r.tier;
    c.p6TierReason = r.reason;
    c.p6TierScore = r.score;
    c.p6TierUpdatedAt = p6NowISO();
  }

  window.p6RecomputeTiers = function(){
    (S.customers||[]).forEach(function(c){ if(!c.p6TierManual) p6EnsureTier(c); });
    persist(); toast('✅ 已重新计算所有客户分级'); renderView();
  };

  // Manual tier override + AI re-recommends a short strategy
  window.p6SetTier = async function(cid, tier){
    var c = p6FindCustomer(cid);
    if(!c) return;
    if(['A','B','C'].indexOf(tier) < 0){ toast('分级无效', 'err'); return; }
    c.p6Tier = tier;
    c.p6TierManual = true;
    c.p6TierReason = '手动设定为' + tier + '级';
    c.p6TierUpdatedAt = p6NowISO();
    persist(); renderView();
    // async AI strategy suggestion (non-blocking)
    try{
      toast('AI 正在为' + c.company + '推荐' + tier + '级策略…');
      var r = await callAI(
        [{ role:'user', content: '你是B2B外贸销售经理。客户「' + c.company + '」被手动设为' + tier + '级（' + (P6_TIER_STRATEGY[tier].freq) + '，渠道：' + P6_TIER_STRATEGY[tier].channels + '）。请用3-4句中文给出差异化跟进策略建议（频率、渠道、内容重点、下一步动作）。直接输出建议，不要JSON。' }],
        { purpose:'p6_followup', timeout:45000, temperature:0.4, model:'gpt-5.6-terra' }
      );
      if(!r.error && r.content){
        c.p6TierStrategy = r.content.slice(0, 600);
        try{ addTimelineEvent(cid, 'tier_override', '手动分级为 ' + tier + ' 级', c.p6TierReason); }catch(e){}
        persist(); renderView();
      }
    }catch(e){ console.warn('[p6] tier strategy AI failed', e); }
  };

  // ── Feature 16: Channel fallback suggestions ───────────────
  function p6AddFallback(c, trigger, channel, reason){
    // dedupe: skip if an active suggestion for same customer+trigger exists
    var dup = (S.p6FallbackSuggestions||[]).some(function(s){
      return s.customerId === c.id && s.trigger === trigger && !s.dismissed;
    });
    if(dup) return false;
    S.p6FallbackSuggestions.push({
      id: uid(),
      customerId: c.id,
      customerName: c.company,
      trigger: trigger,
      suggestedChannel: channel,
      reason: reason,
      createdAt: p6NowISO(),
      dismissed: false
    });
    return true;
  }

  window.p6ScanFallback = function(){
    var created = 0;
    (S.customers||[]).forEach(function(c){
      if(p6CustomerReplied(c)) return;
      if(p6CustomerUnsubscribed(c)) return;

      var recs = (S.sendRecords||[]).filter(function(r){ return r.customerId === c.id; });
      var waRecs = (S.whatsappRecords||[]).filter(function(r){ return r.customerId === c.id; });

      // latest email by sentAt
      var sorted = recs.slice().sort(function(a,b){ return new Date(b.sentAt) - new Date(a.sentAt); });
      var lastEmail = sorted[0];
      var lastEmailDays = lastEmail ? p6DaysSince(lastEmail.sentAt) : 9999;
      var opens = recs.filter(function(r){ return r.openStatus === 'opened'; }).length;

      // Rule 2: opened 3+ times, no reply → phone call
      if(opens >= 3){
        if(p6AddFallback(c, 'opened_3x_no_reply', 'phone', '客户已打开邮件 ' + opens + ' 次但从未回复，建议直接电话沟通')) created++;
        return;
      }
      // Rule 3: WhatsApp read no reply 48h → formal quote email
      var waSorted = waRecs.slice().sort(function(a,b){
        return new Date(b.sentAt || b.createdAt || 0) - new Date(a.sentAt || a.createdAt || 0);
      });
      var lastWa = waSorted[0];
      if(lastWa && (lastWa.readStatus === 'read' || lastWa.status === 'read' || lastWa.read === true)){
        var waDays = p6DaysSince(lastWa.sentAt || lastWa.createdAt);
        if(waDays >= 2 && waDays < 14){
          if(p6AddFallback(c, 'whatsapp_read_48h', 'email_quote', 'WhatsApp 已读未回超 48 小时，建议发正式报价邮件推进')) created++;
          return;
        }
      }
      // Rule 1: email sent 7+ days, never opened → switch to WhatsApp
      if(lastEmail && lastEmail.openStatus !== 'opened' && lastEmailDays >= 7 && lastEmailDays < 14){
        if(p6AddFallback(c, 'email_no_open_7d', 'whatsapp', '邮件发出 ' + Math.floor(lastEmailDays) + ' 天未打开，建议切换 WhatsApp 触达')) created++;
        return;
      }
      // Rule 4: all channels silent 14+ days → dormant reactivation
      if(lastEmailDays >= 14){
        if(p6AddFallback(c, 'dormant_14d', 'reactivate', '多渠道 14 天以上无响应，建议休眠激活（新案例/新品/新价值点）')) created++;
      }
    });
    persist(); toast('扫描完成，新增 ' + created + ' 条 Fallback 建议'); renderView();
  };

  window.p6DismissFallback = function(id){
    var s = (S.p6FallbackSuggestions||[]).find(function(x){ return x.id === id; });
    if(s){ s.dismissed = true; persist(); renderView(); }
  };

  window.p6FallbackAction = function(id){
    var s = (S.p6FallbackSuggestions||[]).find(function(x){ return x.id === id; });
    if(!s) return;
    if(s.suggestedChannel === 'whatsapp'){
      go('outreach', { customerId: s.customerId, channel: 'whatsapp' });
    } else if(s.suggestedChannel === 'phone'){
      go('customers', { id: s.customerId });
      toast('请在客户详情中查看电话并手动拨打（本工作台不自动拨号）');
    } else {
      // email_quote / reactivate → go to drafts with customer param
      go('drafts', { customerId: s.customerId });
    }
    toast('已跳转，请手动发送（本工作台不自动发送）');
  };

  // ── Tab state ──────────────────────────────────────────────
  if(!window._p6SeqTab) window._p6SeqTab = 'sequence';
  window.p6SetSeqTab = function(t){ window._p6SeqTab = t; renderView(); };

  // ── Render: main page ──────────────────────────────────────
  function p6RenderFollowupPage(root){
    p6EvaluateAll();
    // ensure tiers exist for display
    (S.customers||[]).forEach(function(c){ if(!c.p6Tier) p6EnsureTier(c); });

    var activeSeqs = (S.p6SequenceAssignments||[]).filter(function(a){ return a.status === 'active'; }).length;
    var aTierCount = (S.customers||[]).filter(function(c){ return c.p6Tier === 'A'; }).length;
    var pendingFb = (S.p6FallbackSuggestions||[]).filter(function(s){ return !s.dismissed; }).length;

    var h = '';
    h += '<div class="p6-page">';

    // Stat cards
    h += '<div class="p6-stats">'
      + '<div class="p6-stat"><div class="p6-stat-num">' + activeSeqs + '</div><div class="p6-stat-lbl">🔄 进行中的跟进序列</div></div>'
      + '<div class="p6-stat p6-a"><div class="p6-stat-num">' + aTierCount + '</div><div class="p6-stat-lbl">⭐ A级客户</div></div>'
      + '<div class="p6-stat p6-warn"><div class="p6-stat-num">' + pendingFb + '</div><div class="p6-stat-lbl">📡 待处理渠道建议</div></div>'
      + '</div>';

    // Tab bar
    h += '<div class="p6-tabs">'
      + '<div class="p6-tab' + (window._p6SeqTab==='sequence'?' on':'') + '" onclick="p6SetSeqTab(\'sequence\')">🔄 序列管理</div>'
      + '<div class="p6-tab' + (window._p6SeqTab==='tier'?' on':'') + '" onclick="p6SetSeqTab(\'tier\')">⭐ 客户分级</div>'
      + '<div class="p6-tab' + (window._p6SeqTab==='fallback'?' on':'') + '" onclick="p6SetSeqTab(\'fallback\')">📡 渠道Fallback</div>'
      + '</div>';

    if(window._p6SeqTab === 'sequence') h += p6RenderSequenceTab();
    else if(window._p6SeqTab === 'tier') h += p6RenderTierTab();
    else h += p6RenderFallbackTab();

    h += '</div>';
    root.innerHTML = h;
  }

  // ── Sequence tab: left = template editor, right = assignments ──
  function p6RenderSequenceTab(){
    var h = '<div class="p6-seq-grid">';

    // LEFT: template manager
    h += '<div class="p6-panel">';
    h += '<div class="p6-panel-head">📋 序列模板 <button class="btn btn-sm btn-outline" onclick="p6NewTemplate()">+ 新建模板</button></div>';
    (S.p6Sequences||[]).forEach(function(seq){
      h += '<div class="p6-tpl-card">';
      h += '<input class="p6-input" id="p6_tpl_name_' + seq.id + '" value="' + esc(seq.name) + '" />';
      h += '<div class="p6-tpl-steps">';
      seq.steps.forEach(function(st, i){
        h += '<div class="p6-tpl-step">'
          + '<span class="p6-step-no">Step' + (i+1) + '</span>'
          + '<input class="p6-input p6-day" id="p6_tpl_day_' + seq.id + '_' + i + '" type="number" min="0" value="' + st.day + '" title="第几天" />'
          + '<span class="p6-day-lbl">天</span>'
          + '<input class="p6-input p6-lbl" id="p6_tpl_label_' + seq.id + '_' + i + '" value="' + esc(st.label||'') + '" />'
          + '</div>';
      });
      h += '</div>';
      h += '<div class="p6-tpl-ops">'
        + '<button class="btn btn-sm btn-primary" onclick="p6SaveTemplate(\'' + seq.id + '\')">💾 保存模板</button>'
        + '<button class="btn btn-sm btn-outline" onclick="p6DelTemplate(\'' + seq.id + '\')">🗑 删除</button>'
        + (seq.isDefault ? '<span class="p6-tag">默认</span>' : '')
        + '</div>';
      h += '</div>';
    });
    h += '</div>';

    // RIGHT: assignment list
    h += '<div class="p6-panel">';
    h += '<div class="p6-panel-head">👥 已分配序列 <small style="font-weight:400;color:#718096">（每客户仅一个活跃序列）</small></div>';

    // Assign form: pick customer + template
    h += '<div class="p6-assign-bar">';
    h += '<select class="p6-input p6-sel" id="p6_assign_cust">';
    (S.customers||[]).forEach(function(c){
      var active = (S.p6SequenceAssignments||[]).some(function(a){ return a.customerId===c.id && a.status==='active'; });
      h += '<option value="' + c.id + '"' + (active ? ' disabled' : '') + '>' + esc(c.company) + (active ? '（进行中）' : '') + '</option>';
    });
    h += '</select>';
    h += '<select class="p6-input p6-sel" id="p6_assign_seq">';
    (S.p6Sequences||[]).forEach(function(s){ h += '<option value="' + s.id + '">' + esc(s.name) + '</option>'; });
    h += '</select>';
    h += '<button class="btn btn-sm btn-primary" onclick="p6DoAssign()">▶ 开始序列</button>';
    h += '</div>';

    var assigns = S.p6SequenceAssignments || [];
    if(assigns.length === 0){
      h += '<div class="p6-empty">还没有分配任何跟进序列。从上方选择客户和模板开始。</div>';
    } else {
      assigns.slice().reverse().forEach(function(a){
        h += p6RenderAssignmentCard(a);
      });
    }
    h += '</div>';

    h += '</div>';
    return h;
  }

  window.p6DoAssign = function(){
    var cEl = document.getElementById('p6_assign_cust');
    var sEl = document.getElementById('p6_assign_seq');
    if(!cEl || !sEl || !cEl.value || !sEl.value){ toast('请选择客户和序列模板', 'err'); return; }
    p6AssignSequence(cEl.value, sEl.value);
  };

  function p6StatusBadge(status){
    if(status === 'active') return '<span class="p6-badge blue">进行中</span>';
    if(status === 'completed') return '<span class="p6-badge green">已完成</span>';
    if(status === 'cooldown') return '<span class="p6-badge gray">冷却</span>';
    if(status === 'paused') return '<span class="p6-badge warn">已暂停</span>';
    return '<span class="p6-badge gray">' + esc(status) + '</span>';
  }

  function p6RenderAssignmentCard(a){
    var h = '<div class="p6-assign-card">';
    h += '<div class="p6-assign-head">'
      + '<span class="p6-assign-who">' + esc(a.customerName) + '</span>'
      + p6StatusBadge(a.status)
      + '</div>';
    h += '<div class="p6-assign-meta">序列：' + esc(a.sequenceName) + ' · 开始 ' + p6FmtDate(a.startDate) + '</div>';

    // Progress bar
    h += '<div class="p6-progress">';
    a.steps.forEach(function(st, i){
      var cls = 'p6-seg';
      if(st.status === 'done') cls += ' done';
      else if(i === a.currentStep && a.status === 'active') cls += ' cur';
      else cls += ' future';
      h += '<div class="' + cls + '" title="Step' + (i+1) + ' · 到期 ' + p6FmtDate(st.dueDate) + ' · ' + p6ConditionLabel(st.condition) + '">' + (i+1) + '</div>';
    });
    h += '</div>';

    if(a.status === 'active'){
      var cur = a.steps[a.currentStep];
      if(cur){
        h += '<div class="p6-assign-actions">'
          + '<span class="p6-assign-meta">当前 Step' + (a.currentStep+1) + ' · 到期 ' + p6FmtDate(cur.dueDate) + ' · 分支：' + p6ConditionLabel(cur.condition) + '</span>'
          + '<button class="btn btn-sm btn-primary" onclick="p6GenStepEmail(\'' + a.id + '\')">✨ AI生成邮件草稿</button>'
          + '<button class="btn btn-sm btn-outline" onclick="p6StepDone(\'' + a.id + '\')">✅ 标记完成当前步</button>'
          + '<button class="btn btn-sm btn-outline" onclick="p6SetAssignmentStatus(\'' + a.id + '\',\'paused\')">⏸ 暂停</button>'
          + '<button class="btn btn-sm btn-outline" onclick="p6SetAssignmentStatus(\'' + a.id + '\',\'stopped\')">⏹ 停止</button>'
          + '</div>';
      }
      // Show generated draft preview
      if(cur && (cur.generatedSubject || cur.generatedBody)){
        h += '<div class="p6-draft-box">'
          + '<div class="p6-draft-subj">📧 ' + esc(cur.generatedSubject) + '</div>'
          + '<pre class="p6-draft-body">' + esc(cur.generatedBody) + '</pre>'
          + '<div class="p6-draft-note">⚠️ 仅草稿，未发送。</div>'
          + '<button class="btn btn-sm btn-outline" onclick="p6UseDraft(\'' + a.id + '\')">✏️ 去草稿页手动编辑/发送</button>'
          + '</div>';
      }
    } else if(a.status === 'paused'){
      h += '<div class="p6-assign-actions"><button class="btn btn-sm btn-primary" onclick="p6SetAssignmentStatus(\'' + a.id + '\',\'active\')">▶ 继续序列</button></div>';
    }
    h += '</div>';
    return h;
  }

  // ── Tier tab ──────────────────────────────────────────────
  function p6RenderTierTab(){
    var all = S.customers || [];
    var counts = { A:0, B:0, C:0 };
    all.forEach(function(c){ var t = c.p6Tier || 'C'; counts[t] = (counts[t]||0)+1; });
    var total = all.length || 1;

    var h = '<div class="p6-tier-head">'
      + '<button class="btn btn-sm btn-outline" onclick="p6RecomputeTiers()">🔄 重新计算分级</button>'
      + '<span class="p6-assign-meta">分级权重：线索分40% · 行为信号30% · BANT 20% · 来源质量10%</span>'
      + '</div>';

    // Distribution cards
    h += '<div class="p6-tier-dist">';
    [['A','⭐ A级 · 高意向高价值'],['B','🅱️ B级 · 潜力客户'],['C','🅲 C级 · 长期培育']].forEach(function(pair){
      var t = pair[0], lbl = pair[1];
      var n = counts[t]||0;
      var pct = Math.round(n/total*100);
      var st = P6_TIER_STRATEGY[t];
      h += '<div class="p6-tier-card t-' + t + '">'
        + '<div class="p6-tier-title">' + lbl + '</div>'
        + '<div class="p6-tier-num">' + n + ' <small>(' + pct + '%)</small></div>'
        + '<div class="p6-bar"><div class="p6-bar-fill f-' + t + '" style="width:' + pct + '%"></div></div>'
        + '<div class="p6-tier-strat"><b>建议频率：</b>' + st.freq + '<br><b>渠道：</b>' + esc(st.channels) + '<br><b>节奏：</b>' + esc(st.cadence) + '<br><b>打法：</b>' + esc(st.action) + '</div>'
        + '</div>';
    });
    h += '</div>';

    // Customer table sorted by tier weight A>B>C
    var order = { A:0, B:1, C:2 };
    var sorted = all.slice().sort(function(a,b){
      return (order[a.p6Tier||'C'] - order[b.p6Tier||'C']);
    });

    h += '<table class="p6-table"><thead><tr>'
      + '<th>客户</th><th>分级</th><th>综合分</th><th>分级依据</th><th>建议策略</th><th>手动调整</th>'
      + '</tr></thead><tbody>';
    sorted.forEach(function(c){
      var t = c.p6Tier || 'C';
      h += '<tr>'
        + '<td class="p6-cust-name">' + esc(c.company) + (c.p6TierManual ? ' <span class="p6-tag">手动</span>' : '') + '</td>'
        + '<td><span class="p6-badge t-' + t + '">' + t + '</span></td>'
        + '<td>' + (c.p6TierScore != null ? c.p6TierScore : '—') + '</td>'
        + '<td class="p6-reason">' + esc(c.p6TierReason || '—') + '</td>'
        + '<td class="p6-strat-cell">' + (c.p6TierStrategy ? esc(c.p6TierStrategy).slice(0,120) : esc(P6_TIER_STRATEGY[t].action)) + '</td>'
        + '<td><select class="p6-input p6-sel" onchange="p6SetTier(\'' + c.id + '\', this.value)">'
          + ['A','B','C'].map(function(o){
              return '<option value="' + o + '"' + (t===o?' selected':'') + '>' + o + '级</option>';
            }).join('')
          + '</select></td>'
        + '</tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  // ── Fallback tab ──────────────────────────────────────────
  function p6FbTriggerLabel(tr){
    if(tr === 'email_no_open_7d') return '📧→💬 邮件未打开7天';
    if(tr === 'opened_3x_no_reply') return '👀📞 已打开3次未回';
    if(tr === 'whatsapp_read_48h') return '💬→📄 WhatsApp已读48h';
    if(tr === 'dormant_14d') return '💤 14天休眠激活';
    return tr;
  }
  function p6FbChannelLabel(ch){
    if(ch === 'whatsapp') return '切换 WhatsApp';
    if(ch === 'phone') return '电话跟进';
    if(ch === 'email_quote') return '发正式报价邮件';
    if(ch === 'reactivate') return '休眠激活邮件';
    return ch;
  }

  function p6RenderFallbackTab(){
    var pending = (S.p6FallbackSuggestions||[]).filter(function(s){ return !s.dismissed; });
    var h = '<div class="p6-fb-head">'
      + '<button class="btn btn-sm btn-primary" onclick="p6ScanFallback()">🔍 扫描全部客户生成建议</button>'
      + '<span class="p6-assign-meta">规则：邮件7天未开→WhatsApp · 打开3次未回→电话 · WhatsApp已读48h→报价邮件 · 14天无响应→激活</span>'
      + '</div>';
    if(pending.length === 0){
      h += '<div class="p6-empty">暂无待处理建议。点击上方按钮扫描所有客户的互动数据。</div>';
    } else {
      h += '<div class="p6-fb-list">';
      pending.forEach(function(s){
        h += '<div class="p6-fb-card">'
          + '<div class="p6-fb-head"><b>' + esc(s.customerName) + '</b> <span class="p6-tag">' + p6FbTriggerLabel(s.trigger) + '</span></div>'
          + '<div class="p6-fb-reason">' + esc(s.reason) + '</div>'
          + '<div class="p6-fb-actions">'
          + '<button class="btn btn-sm btn-primary" onclick="p6FallbackAction(\'' + s.id + '\')">➡️ ' + p6FbChannelLabel(s.suggestedChannel) + '</button>'
          + '<button class="btn btn-sm btn-outline" onclick="p6DismissFallback(\'' + s.id + '\')">✖ 忽略</button>'
          + '</div>'
          + '</div>';
      });
      h += '</div>';
    }
    return h;
  }

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'followupSequence'){
      p6RenderFollowupPage(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p6- prefixed, responsive) ─────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p6-page{padding:4px;}'
    + '.p6-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;}'
    + '.p6-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.p6-stat-num{font-size:26px;font-weight:700;color:#2d3748;}'
    + '.p6-stat-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    + '.p6-stat.p6-a .p6-stat-num{color:#d69e2e;}'
    + '.p6-stat.p6-warn .p6-stat-num{color:#dd6b20;}'
    + '.p6-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}'
    + '.p6-tab{padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;color:#4a5568;}'
    + '.p6-tab.on{background:#3182ce;color:#fff;border-color:#3182ce;font-weight:600;}'
    + '.p6-seq-grid{display:grid;grid-template-columns:1fr 1.4fr;gap:14px;align-items:start;}'
    + '.p6-panel{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;}'
    + '.p6-panel-head{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;}'
    + '.p6-tpl-card{border:1px solid #edf2f7;border-radius:8px;padding:10px;margin-bottom:10px;background:#fafcff;}'
    + '.p6-input{width:100%;padding:6px 8px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;box-sizing:border-box;}'
    + '.p6-tpl-steps{margin:8px 0;display:flex;flex-direction:column;gap:5px;}'
    + '.p6-tpl-step{display:flex;align-items:center;gap:6px;font-size:12px;}'
    + '.p6-step-no{width:38px;color:#718096;font-weight:600;}'
    + '.p6-day{width:60px;}'
    + '.p6-day-lbl{color:#a0aec0;}'
    + '.p6-lbl{flex:1;}'
    + '.p6-tpl-ops{display:flex;gap:6px;align-items:center;margin-top:6px;}'
    + '.p6-assign-bar{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;}'
    + '.p6-sel{width:auto !important;flex:1;min-width:120px;}'
    + '.p6-assign-card{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:10px;}'
    + '.p6-assign-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.p6-assign-who{font-weight:700;font-size:14px;color:#2d3748;}'
    + '.p6-assign-meta{font-size:12px;color:#718096;margin:4px 0;}'
    + '.p6-progress{display:flex;gap:4px;margin:10px 0;}'
    + '.p6-seg{flex:1;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border-radius:5px;color:#fff;}'
    + '.p6-seg.future{background:#cbd5e0;color:#fff;}'
    + '.p6-seg.done{background:#38a169;}'
    + '.p6-seg.cur{background:#3182ce;box-shadow:0 0 0 2px rgba(49,130,206,.25);}'
    + '.p6-assign-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;}'
    + '.p6-badge{font-size:11px;padding:2px 10px;border-radius:10px;font-weight:600;color:#fff;}'
    + '.p6-badge.blue{background:#3182ce;}'
    + '.p6-badge.green{background:#38a169;}'
    + '.p6-badge.gray{background:#a0aec0;}'
    + '.p6-badge.warn{background:#d69e2e;}'
    + '.p6-badge.t-A{background:#d69e2e;}'
    + '.p6-badge.t-B{background:#3182ce;}'
    + '.p6-badge.t-C{background:#a0aec0;}'
    + '.p6-draft-box{margin-top:10px;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:8px;padding:10px;}'
    + '.p6-draft-subj{font-weight:700;font-size:13px;margin-bottom:6px;}'
    + '.p6-draft-body{font-size:12px;color:#4a5568;white-space:pre-wrap;background:#fff;border-radius:6px;padding:8px;max-height:160px;overflow:auto;margin:0 0 6px;}'
    + '.p6-draft-note{font-size:11px;color:#c05621;margin-bottom:6px;}'
    + '.p6-tag{font-size:11px;padding:2px 8px;border-radius:10px;background:#edf2f7;color:#4a5568;}'
    // Tier tab
    + '.p6-tier-head{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;}'
    + '.p6-tier-dist{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;}'
    + '.p6-tier-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;border-top:4px solid #cbd5e0;}'
    + '.p6-tier-card.t-A{border-top-color:#d69e2e;}'
    + '.p6-tier-card.t-B{border-top-color:#3182ce;}'
    + '.p6-tier-card.t-C{border-top-color:#a0aec0;}'
    + '.p6-tier-title{font-size:13px;font-weight:700;color:#2d3748;}'
    + '.p6-tier-num{font-size:28px;font-weight:700;margin:4px 0;}'
    + '.p6-tier-num small{font-size:13px;color:#718096;font-weight:400;}'
    + '.p6-bar{height:6px;background:#edf2f7;border-radius:3px;overflow:hidden;margin:6px 0 10px;}'
    + '.p6-bar-fill{height:100%;}'
    + '.p6-bar-fill.f-A{background:#d69e2e;}'
    + '.p6-bar-fill.f-B{background:#3182ce;}'
    + '.p6-bar-fill.f-C{background:#a0aec0;}'
    + '.p6-tier-strat{font-size:12px;color:#4a5568;line-height:1.6;}'
    + '.p6-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:13px;}'
    + '.p6-table th{background:#f7fafc;text-align:left;padding:8px 10px;font-size:12px;color:#718096;border-bottom:1px solid #e2e8f0;}'
    + '.p6-table td{padding:8px 10px;border-bottom:1px solid #edf2f7;vertical-align:top;}'
    + '.p6-cust-name{font-weight:600;}'
    + '.p6-reason{color:#718096;font-size:12px;max-width:200px;}'
    + '.p6-strat-cell{color:#4a5568;font-size:12px;max-width:240px;}'
    // Fallback tab
    + '.p6-fb-head{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;}'
    + '.p6-fb-list{display:flex;flex-direction:column;gap:10px;}'
    + '.p6-fb-card{background:#fff;border:1px solid #e2e8f0;border-left:4px solid #dd6b20;border-radius:10px;padding:12px 14px;}'
    + '.p6-fb-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px;}'
    + '.p6-fb-reason{font-size:13px;color:#4a5568;margin:6px 0;}'
    + '.p6-fb-actions{display:flex;gap:6px;flex-wrap:wrap;}'
    + '.p6-empty{padding:40px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    // Responsive
    + '@media (max-width:768px){'
    + '  .p6-stats{grid-template-columns:1fr;}'
    + '  .p6-seq-grid{grid-template-columns:1fr;}'
    + '  .p6-tier-dist{grid-template-columns:1fr;}'
    + '  .p6-assign-bar{flex-direction:column;}'
    + '  .p6-table{display:block;overflow-x:auto;}'
    + '  .p6-assign-actions{flex-direction:column;align-items:stretch;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
