/* ============================================================
 * P7 Phase7 Module: AI Feedback & Intelligence Loop
 * ----------------------------------------------------------------
 * Feature 21: AI Learning Center — record every human edit to an
 *             AI draft, let AI distill high-frequency modification
 *             patterns, and inject those patterns as best-practice
 *             guidance into future AI generations.
 * Feature 22: Natural-language follow-up rules — user describes a
 *             trigger in plain Chinese, AI parses it into a structured
 *             condition + action; engine only toasts / drafts / tags,
 *             NEVER sends external messages automatically.
 * Feature 31: Negotiation monitor — AI analyzes each customer's
 *             communication history, scores negotiation health 0-100,
 *             surfaces bottlenecks (price/delivery/quality/decision/
 *             competitor) with talk-track suggestions.
 * Feature 32: NL2Data simplified — natural-language question ->
 *             keyword template match first, AI fallback -> answer +
 *             table, history persisted.
 *
 * HARD RULE: This module NEVER sends any email / WhatsApp / SMS. It
 * only builds drafts, reminders, tags and suggestions. The user must
 * manually send. All CSS classes use the p7- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init (already wired into app.js load/persist) ──
  if(!Array.isArray(S.p7LearningRecords)) S.p7LearningRecords = [];
  if(!Array.isArray(S.p7LearnedPatterns)) S.p7LearnedPatterns = [];
  if(!S.p7LearningStats) S.p7LearningStats = {totalEdits:0, patternsLearned:0, mostModifiedParts:{}, lastAnalysis:null};
  if(!Array.isArray(S.p7NlRules)) S.p7NlRules = [];
  if(!Array.isArray(S.p7RuleTriggers)) S.p7RuleTriggers = [];
  if(!S.p7NegotiationAnalysis) S.p7NegotiationAnalysis = {};
  if(!Array.isArray(S.p7NlQueryHistory)) S.p7NlQueryHistory = [];

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'aiLearning',
    icon: '🔮',
    label: 'AI学习中心',
    title: 'AI反馈环 · 自然语言规则 · 智能查询',
    crumb: '学习记录 · 修改模式 · NL规则 · NL查询'
  });
  NAV.push({
    key: 'negotiationMonitor',
    icon: '🎯',
    label: '谈单监测',
    title: 'AI谈单健康度监测',
    crumb: '健康度评分 · 卡点识别 · 突破话术'
  });

  // ── Local helpers ───────────────────────────────────────────
  function p7NowISO(){ return new Date().toISOString(); }

  function p7FmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p7FmtDateTime(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return p7FmtDate(iso) + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  function p7FindCustomer(id){
    return (S.customers||[]).find(function(x){ return x.id === id; }) || null;
  }

  function p7CustomerEmail(c){
    try{ if(typeof getCustomerPrimaryEmail === 'function'){ var e = getCustomerPrimaryEmail(c); if(e) return e; } }catch(e){}
    return (c && c.contact && c.contact.email) || '';
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

  // Simple word-level diff summary — describes WHAT changed, not line-by-line
  function p7DiffSummary(oSubj, oBody, mSubj, mBody){
    var parts = [];
    oSubj = oSubj || ''; mSubj = mSubj || '';
    oBody = oBody || ''; mBody = mBody || '';
    if(oSubj !== mSubj){
      if(oSubj && mSubj){
        parts.push('标题改写（原「' + oSubj.slice(0,40) + '」→「' + mSubj.slice(0,40) + '」）');
      } else if(mSubj){
        parts.push('补充标题');
      } else {
        parts.push('删除标题');
      }
    }
    if(oBody !== mBody){
      var oLen = oBody.length, mLen = mBody.length;
      var delta = mLen - oLen;
      if(Math.abs(delta) > 200){
        parts.push('正文长度' + (delta > 0 ? '增加' : '缩短') + '约' + Math.abs(delta) + '字符');
      } else {
        parts.push('正文细节微调');
      }
      // heuristic: detect tone / CTA changes
      if(/(call|电话|zoom|meeting|约)/i.test(mBody) && !/(call|电话|zoom|meeting|约)/i.test(oBody)){
        parts.push('新增CTA邀约');
      }
      if(/(sorry|抱歉|regret|unfortunately)/i.test(mBody) && !/(sorry|抱歉|regret|unfortunately)/i.test(oBody)){
        parts.push('增加委婉措辞');
      }
      if(/(MOQ|最小起订|样品|sample)/i.test(mBody) && !/(MOQ|最小起订|样品|sample)/i.test(oBody)){
        parts.push('补充MOQ/样品说明');
      }
    }
    if(parts.length === 0) parts.push('无实质修改');
    return parts.join('；');
  }

  // Identify which parts of the draft were modified (for stats)
  function p7ModifiedParts(oSubj, oBody, mSubj, mBody){
    var parts = [];
    if((oSubj||'') !== (mSubj||'')) parts.push('subject');
    if((oBody||'') !== (mBody||'')){
      var o = oBody||'', m = mBody||'';
      parts.push('body');
      if(/(call|电话|zoom|meeting|约|cta|回复|reply)/i.test(m) && !/(call|电话|zoom|meeting|约|cta|回复|reply)/i.test(o)) parts.push('cta');
      if(/(MOQ|最小起订|样品|sample|价格|price|quote)/i.test(m) && !/(MOQ|最小起订|样品|sample|价格|price|quote)/i.test(o)) parts.push('commercial_detail');
      if(/(cert|认证|ISO|BSCI|FDA)/i.test(m) && !/(cert|认证|ISO|BSCI|FDA)/i.test(o)) parts.push('credential');
    }
    if(parts.length === 0) parts.push('other');
    return parts;
  }

  // ── Feature 21: AI Learning Feedback Loop ─────────────────
  // Called by OTHER modules whenever a human edits an AI-generated draft.
  // Records the edit and bumps stats.
  window.p7RecordEdit = function(customerId, draftType, originalSubject, originalBody, modifiedSubject, modifiedBody){
    var rec = {
      id: uid(),
      customerId: customerId || '',
      draftType: draftType || 'email',
      originalSubject: originalSubject || '',
      originalBody: originalBody || '',
      modifiedSubject: modifiedSubject || '',
      modifiedBody: modifiedBody || '',
      diffSummary: p7DiffSummary(originalSubject, originalBody, modifiedSubject, modifiedBody),
      createdAt: p7NowISO()
    };
    S.p7LearningRecords.push(rec);

    // bump stats
    S.p7LearningStats.totalEdits = (S.p7LearningStats.totalEdits || 0) + 1;
    var mp = p7ModifiedParts(originalSubject, originalBody, modifiedSubject, modifiedBody);
    mp.forEach(function(p){
      S.p7LearningStats.mostModifiedParts[p] = (S.p7LearningStats.mostModifiedParts[p] || 0) + 1;
    });

    try{
      var c = p7FindCustomer(customerId);
      if(c) addTimelineEvent(customerId, 'ai_draft_edit', '人工修改AI草稿（' + (draftType||'email') + '）', rec.diffSummary, {recordId: rec.id});
    }catch(e){}

    persist();
    return rec;
  };

  // Expose active patterns as a prompt-guidance block for OTHER modules
  // to prepend to their AI prompts. Call this anywhere AI drafts are
  // generated to inject learned best practices.
  window.p7GetActivePatternsPrompt = function(){
    var active = (S.p7LearnedPatterns||[]).filter(function(p){ return p.enabled !== false; });
    if(active.length === 0) return '';
    var lines = ['【重要：根据历史人工修改记录总结的最佳实践，请严格遵守】'];
    active.slice(0, 8).forEach(function(p, i){
      lines.push((i+1) + '. ' + p.description);
      if(p.exampleBefore && p.exampleAfter){
        lines.push('   反例：' + p.exampleBefore + '  →  优化后：' + p.exampleAfter);
      }
    });
    return lines.join('\n');
  };

  // AI analyzes recent learning records -> distill patterns
  window.p7AnalyzePatterns = async function(){
    var recs = S.p7LearningRecords || [];
    if(recs.length < 3){
      toast('至少需要3条修改记录才能分析模式（当前' + recs.length + '条）', 'err');
      return;
    }
    toast('AI 正在分析最近的修改模式…');
    // take most recent 50 records
    var recent = recs.slice(-50);
    var sample = recent.map(function(r, i){
      var c = p7FindCustomer(r.customerId);
      return '#' + (i+1) + ' [' + (r.draftType||'email') + '][' + (c ? c.company : '未知客户') + ']'
        + '\n  原标题: ' + (r.originalSubject||'(空)')
        + '\n  新标题: ' + (r.modifiedSubject||'(空)')
        + '\n  原正文前200字: ' + (r.originalBody||'').slice(0,200)
        + '\n  新正文前200字: ' + (r.modifiedBody||'').slice(0,200)
        + '\n  修改摘要: ' + (r.diffSummary||'');
    }).join('\n');

    var prompt = '你是B2B外贸邮件质量分析师。以下是业务员对AI生成草稿的人工修改记录。\n'
      + '请识别高频、可复用的修改模式（例如："标题过长→缩短为8词以内"、"正文缺少CTA→需加回复引导"、"语气过强硬→需委婉"等）。\n'
      + '要求：\n'
      + '1. 只输出JSON，格式：{"patterns":[{"patternType":"subject|body|cta|tone|credential|commercial_detail","description":"一句话描述这个最佳实践","exampleBefore":"AI原写法示例","exampleAfter":"人工修改后的写法示例"}]}\n'
      + '2. 识别3-7个最有价值的模式，宁缺毋滥。\n'
      + '3. description必须是可直接执行的写作指导（祈使句），不要空泛。\n'
      + '4. exampleBefore/exampleAfter用简短英文邮件片段示例。\n\n'
      + '【修改记录样本】\n' + sample;

    try{
      var r = await callAI(
        [{ role: 'user', content: prompt }],
        { purpose: 'p7_analyze_patterns', timeout: 60000, temperature: 0.3, model: 'gpt-5.6-terra' }
      );
      if(r.error){ toast('AI分析失败：' + (r.error||'未知错误'), 'err'); return; }
      var j = p7ParseAIJSON(r.content);
      if(!j || !Array.isArray(j.patterns) || j.patterns.length === 0){
        toast('AI未能识别出有效模式', 'err'); return;
      }
      var added = 0;
      j.patterns.forEach(function(p){
        // dedupe by description similarity (simple: skip if same description exists)
        var dup = (S.p7LearnedPatterns||[]).some(function(x){
          return x.description && p.description && x.description.slice(0,30) === p.description.slice(0,30);
        });
        if(dup) return;
        S.p7LearnedPatterns.push({
          id: uid(),
          patternType: p.patternType || 'body',
          description: p.description || '',
          exampleBefore: p.exampleBefore || '',
          exampleAfter: p.exampleAfter || '',
          frequency: 1,
          appliedCount: 0,
          enabled: true,
          createdAt: p7NowISO()
        });
        added++;
      });
      S.p7LearningStats.patternsLearned = (S.p7LearnedPatterns||[]).length;
      S.p7LearningStats.lastAnalysis = p7NowISO();
      persist();
      toast('✅ 分析完成，新增 ' + added + ' 条学习模式');
      renderView();
    }catch(err){
      console.warn('[p7] analyze patterns failed', err);
      toast('分析出错：' + (err.message||err), 'err');
    }
  };

  window.p7TogglePattern = function(id){
    var p = (S.p7LearnedPatterns||[]).find(function(x){ return x.id === id; });
    if(!p) return;
    p.enabled = !p.enabled;
    persist(); renderView();
  };

  window.p7DeletePattern = function(id){
    S.p7LearnedPatterns = (S.p7LearnedPatterns||[]).filter(function(x){ return x.id !== id; });
    persist(); toast('已删除模式'); renderView();
  };

  window.p7DeleteLearningRecord = function(id){
    S.p7LearningRecords = (S.p7LearningRecords||[]).filter(function(x){ return x.id !== id; });
    S.p7LearningStats.totalEdits = (S.p7LearningRecords||[]).length;
    persist(); renderView();
  };

  // Tab state for AI Learning page
  if(!window._p7LearnTab) window._p7LearnTab = 'records';
  window.p7SetLearnTab = function(t){ window._p7LearnTab = t; renderView(); };
  if(!window._p7RecFilter) window._p7RecFilter = '';
  window.p7SetRecFilter = function(v){ window._p7RecFilter = v; renderView(); };

  // ── Feature 22: Natural-language follow-up rules ──────────
  var P7_FIELDS = ['budget','deliveryTime','competitor','certification','quantity','replyStatus'];
  var P7_OPS = ['gt','lt','eq','contains','mentions'];
  var P7_ACTIONS = ['notify','generate_draft','tag'];

  function p7FieldLabel(f){
    return {budget:'预算', deliveryTime:'交期', competitor:'竞品', certification:'认证', quantity:'数量', replyStatus:'回复状态'}[f] || f;
  }
  function p7OpLabel(o){
    return {gt:'>', lt:'<', eq:'=', contains:'包含', mentions:'提及'}[o] || o;
  }
  function p7ActionLabel(a){
    return {notify:'🔔 提醒我', generate_draft:'✍️ 生成回复草稿建议', tag:'🏷️ 标记客户'}[a] || a;
  }

  // AI-parses a natural-language rule into {condition, action}
  window.p7CreateRule = async function(){
    var el = document.getElementById('p7_nl_rule_input');
    if(!el || !el.value.trim()){ toast('请输入规则描述', 'err'); return; }
    var raw = el.value.trim();
    toast('AI 正在解析规则…');
    var prompt = '你是规则解析器。用户用自然语言描述了一条外贸跟进规则，请把它解析为结构化条件。\n'
      + '支持的条件字段：budget(预算,数字美元), deliveryTime(交期,天数), competitor(竞品名,字符串), certification(认证名,字符串), quantity(数量,数字), replyStatus(回复状态,字符串如已回复/未回复/已读未回)\n'
      + '支持的操作符：gt(>), lt(<), eq(=), contains(包含子串), mentions(提及关键词)\n'
      + '支持的动作：notify(提醒我), generate_draft(生成回复草稿建议), tag(标记客户)\n'
      + '只输出JSON：{"condition":{"field":"...","operator":"...","value":"..."},"action":"notify|generate_draft|tag"}\n'
      + '如果用户没明确说动作，默认 notify。\n'
      + '用户描述：' + raw;
    try{
      var r = await callAI(
        [{ role:'user', content: prompt }],
        { purpose:'p7_parse_rule', timeout:45000, temperature:0.1, model:'gpt-5.6-terra' }
      );
      if(r.error){ toast('AI解析失败：' + (r.error||'未知错误'), 'err'); return; }
      var j = p7ParseAIJSON(r.content);
      if(!j || !j.condition || !j.condition.field){ toast('AI无法解析这条规则，请换个说法', 'err'); return; }
      if(P7_FIELDS.indexOf(j.condition.field) < 0){
        toast('AI解析出的字段「' + j.condition.field + '」不受支持', 'err'); return;
      }
      if(P7_OPS.indexOf(j.condition.operator) < 0) j.condition.operator = 'contains';
      if(P7_ACTIONS.indexOf(j.action) < 0) j.action = 'notify';
      S.p7NlRules.push({
        id: uid(),
        rawText: raw,
        parsedCondition: j.condition,
        action: j.action,
        enabled: true,
        triggerCount: 0,
        createdAt: p7NowISO()
      });
      persist();
      toast('✅ 规则已创建（仅记录，不会自动执行任何外部操作）');
      el.value = '';
      renderView();
    }catch(err){
      console.warn('[p7] parse rule failed', err);
      toast('解析出错：' + (err.message||err), 'err');
    }
  };

  window.p7ToggleRule = function(id){
    var r = (S.p7NlRules||[]).find(function(x){ return x.id === id; });
    if(!r) return;
    r.enabled = !r.enabled;
    persist(); renderView();
  };

  window.p7DeleteRule = function(id){
    S.p7NlRules = (S.p7NlRules||[]).filter(function(x){ return x.id !== id; });
    S.p7RuleTriggers = (S.p7RuleTriggers||[]).filter(function(t){ return t.ruleId !== id; });
    persist(); toast('已删除规则'); renderView();
  };

  // Evaluate a single condition against a customer + context
  function p7EvalCondition(cond, c, ctx){
    if(!cond || !cond.field) return false;
    var v;
    switch(cond.field){
      case 'budget':
        v = (c.bant && c.bant.budget) || (c.budget) || (ctx && ctx.budget);
        break;
      case 'deliveryTime':
        v = (ctx && ctx.deliveryTime) || (c.expectedDeliveryDays) || (c.bant && c.bant.timeline);
        break;
      case 'competitor':
        v = (ctx && ctx.competitor) || (c.competitor) || (c.notes || '');
        break;
      case 'certification':
        v = (ctx && ctx.certification) || ((c.certifications||[]).join(',') || '');
        break;
      case 'quantity':
        v = (ctx && ctx.quantity) || (c.quantity) || (c.bant && c.bant.need && String(c.bant.need).match(/\d+/) && RegExp.$1);
        break;
      case 'replyStatus':
        v = '';
        if(c.status === '已回复' || c.status === 'replied') v = '已回复';
        else if((S.inbox||[]).some(function(it){ return it.customerId === c.id; })) v = '已回复';
        else v = '未回复';
        break;
      default: return false;
    }
    if(v == null) return false;
    v = String(v);
    var target = String(cond.value || '');
    switch(cond.operator){
      case 'gt': return parseFloat(v) > parseFloat(target);
      case 'lt': return parseFloat(v) < parseFloat(target);
      case 'eq': return v.toLowerCase() === target.toLowerCase();
      case 'contains': return v.toLowerCase().indexOf(target.toLowerCase()) >= 0;
      case 'mentions':
        // search recent inbox message bodies for the keyword
        var msgs = (S.inbox||[]).filter(function(it){ return it.customerId === c.id; });
        return msgs.some(function(m){ return String(m.body||m.subject||'').toLowerCase().indexOf(target.toLowerCase()) >= 0; });
      default: return false;
    }
  }

  // Called by other modules when a customer communication event occurs.
  // Matches enabled rules, records triggers, toasts user. NEVER sends.
  window.p7CheckRules = function(customerId, context){
    var c = p7FindCustomer(customerId);
    if(!c) return;
    (S.p7NlRules||[]).forEach(function(rule){
      if(!rule.enabled) return;
      var matched = p7EvalCondition(rule.parsedCondition, c, context || {});
      if(!matched) return;
      // dedupe: don't trigger same rule for same customer more than once per 24h
      var dup = (S.p7RuleTriggers||[]).some(function(t){
        return t.ruleId === rule.id && t.customerId === customerId &&
          (Date.now() - new Date(t.createdAt).getTime()) < 86400000;
      });
      if(dup) return;
      rule.triggerCount = (rule.triggerCount||0) + 1;
      var trigger = {
        id: uid(),
        ruleId: rule.id,
        customerId: customerId,
        matchedValue: (rule.parsedCondition.field || '') + ' ' + p7OpLabel(rule.parsedCondition.operator) + ' ' + rule.parsedCondition.value,
        actionSuggestion: p7ActionLabel(rule.action),
        createdAt: p7NowISO()
      };
      S.p7RuleTriggers.push(trigger);
      try{ addTimelineEvent(customerId, 'rule_trigger', '规则触发：' + rule.rawText, trigger.matchedValue, {ruleId: rule.id}); }catch(e){}
      if(rule.action === 'notify'){
        toast('🔔 规则提醒：' + c.company + ' — ' + rule.rawText);
      } else if(rule.action === 'generate_draft'){
        toast('✍️ 规则建议：为 ' + c.company + ' 生成回复草稿（请到草稿页手动发送）');
      } else if(rule.action === 'tag'){
        if(!Array.isArray(c.tags)) c.tags = [];
        var tagTxt = '规则:' + (rule.rawText.slice(0,10));
        if(c.tags.indexOf(tagTxt) < 0) c.tags.push(tagTxt);
        toast('🏷️ 已为 ' + c.company + ' 打上标记：' + tagTxt);
      }
    });
    persist();
  };

  // Manually scan every customer against every enabled rule
  window.p7ManualCheckAllRules = function(){
    var hits = 0;
    (S.customers||[]).forEach(function(c){
      var before = S.p7RuleTriggers.length;
      window.p7CheckRules(c.id, {});
      if(S.p7RuleTriggers.length > before) hits++;
    });
    toast('✅ 检测完成，涉及 ' + hits + ' 个客户');
    renderView();
  };

  // ── Feature 31: AI Negotiation Monitor ───────────────────
  var P7_BOTTLENECK_LABELS = {
    price: '💰 价格卡点',
    delivery: '🚚 交期卡点',
    quality: '✅ 质量卡点',
    decision: '🤝 决策卡点',
    competitor: '⚔️ 竞品卡点'
  };

  function p7GatherCustomerHistory(c){
    var lines = [];
    // inbox
    var inbox = (S.inbox||[]).filter(function(it){ return it.customerId === c.id; })
      .sort(function(a,b){ return new Date(a.sentAt||a.createdAt||0) - new Date(b.sentAt||b.createdAt||0); });
    inbox.slice(-20).forEach(function(m){
      lines.push('[收件 ' + p7FmtDate(m.sentAt||m.createdAt) + '] ' + (m.subject||'') + '\n' + String(m.body||'').slice(0,300));
    });
    // drafts sent to this customer
    var drafts = (S.drafts||[]).filter(function(d){ return d.customerId === c.id; })
      .sort(function(a,b){ return new Date(a.createdAt||0) - new Date(b.createdAt||0); });
    drafts.slice(-10).forEach(function(d){
      lines.push('[发出草稿 ' + p7FmtDate(d.createdAt) + '] ' + (d.subject||'') + '\n' + String(d.body||'').slice(0,300));
    });
    // send records
    var sent = (S.sendRecords||[]).filter(function(r){ return r.customerId === c.id; });
    lines.push('[发送统计] 共发送 ' + sent.length + ' 封邮件，打开 ' + sent.filter(function(r){return r.openStatus==='opened';}).length + ' 次');
    return lines.join('\n---\n');
  }

  window.p7AnalyzeNegotiation = async function(customerId){
    var c = p7FindCustomer(customerId);
    if(!c){ toast('客户不存在', 'err'); return; }
    toast('AI 正在分析 ' + c.company + ' 的谈单情况…');
    var history = p7GatherCustomerHistory(c);
    var prompt = '你是B2B外贸资深谈单教练。请分析以下客户的沟通记录，评估谈单健康度。\n'
      + '【客户】' + c.company + '；国家：' + (c.country||'') + '；关注品类：' + (c.productCategory||'未指定') + '；当前状态：' + (c.status||'未知') + '\n'
      + '【沟通记录】\n' + (history || '（无历史记录）') + '\n\n'
      + '请输出JSON：\n'
      + '{"healthScore":0-100整数,\n'
      + ' "bottlenecks":[{"type":"price|delivery|quality|decision|competitor","description":"中文，说明卡点具体表现","suggestion":"中文，突破建议","talkTrack":"英文，一句可直接发给客户的话术示例"}]}\n'
      + '要求：\n'
      + '1. healthScore综合判断：回复活跃度、意向明确度、卡点严重度。0-40危险(红)，40-70警告(黄)，70+健康(绿)。\n'
      + '2. bottlenecks 1-3个，只写真实存在的卡点，不要编造。\n'
      + '3. talkTrack必须是英文邮件话术片段，专业、简短、带引导下一步。\n'
      + '4. 如果沟通记录为空或极少，healthScore给30，bottlenecks写decision类型（客户尚未表达明确意向）。';

    try{
      var r = await callAI(
        [{ role:'user', content: prompt }],
        { purpose:'p7_negotiation', timeout:60000, temperature:0.3, model:'gpt-5.6-terra' }
      );
      if(r.error){ toast('AI分析失败：' + (r.error||'未知错误'), 'err'); return; }
      var j = p7ParseAIJSON(r.content);
      if(!j || typeof j.healthScore !== 'number'){ toast('AI返回格式异常', 'err'); return; }
      S.p7NegotiationAnalysis[customerId] = {
        healthScore: Math.max(0, Math.min(100, Math.round(j.healthScore))),
        bottlenecks: Array.isArray(j.bottlenecks) ? j.bottlenecks.slice(0,5) : [],
        lastAnalyzed: p7NowISO()
      };
      try{ addTimelineEvent(customerId, 'negotiation_analysis', 'AI谈单分析完成（健康度' + Math.round(j.healthScore) + '分）', (j.bottlenecks||[]).map(function(b){return b.type;}).join(',')); }catch(e){}
      persist();
      toast('✅ 已完成 ' + c.company + ' 的谈单分析');
      renderView();
    }catch(err){
      console.warn('[p7] negotiation analysis failed', err);
      toast('分析出错：' + (err.message||err), 'err');
    }
  };

  window.p7AnalyzeAllNegotiations = async function(){
    var list = S.customers || [];
    if(list.length === 0){ toast('暂无客户', 'err'); return; }
    toast('将逐个分析 ' + list.length + ' 个客户，请耐心等待…');
    // process sequentially to avoid API burst
    for(var i = 0; i < list.length; i++){
      var c = list[i];
      // reuse existing function but suppress per-customer toast
      try{
        await window.p7AnalyzeNegotiation(c.id);
      }catch(e){ console.warn('[p7] bulk analyze skip', c.id, e); }
    }
    toast('🎉 全部客户谈单分析完成');
  };

  // Detail drawer state
  if(!window._p7NegDetail) window._p7NegDetail = null;
  window.p7ShowNegDetail = function(cid){ window._p7NegDetail = cid; renderView(); };
  window.p7CloseNegDetail = function(){ window._p7NegDetail = null; renderView(); };

  // ── Feature 32: NL2Data simplified query ─────────────────
  // Predefined templates: [regex, answer-builder]
  var P7_QUERY_TEMPLATES = [
    {
      match: /上个月.*邮件|上月.*邮件|how many email.*last month/i,
      label: '上个月发送了多少封邮件',
      build: function(){
        var now = new Date();
        var firstLast = new Date(now.getFullYear(), now.getMonth()-1, 1);
        var firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
        var recs = (S.sendRecords||[]).filter(function(r){
          var t = new Date(r.sentAt||r.createdAt||0);
          return t >= firstLast && t < firstThis;
        });
        return {
          answer: '上个月（' + p7FmtDate(firstLast).slice(0,7) + '）共发送了 <b>' + recs.length + '</b> 封邮件。',
          table: null,
          num: recs.length
        };
      }
    },
    {
      match: /哪个品类.*回复率最高|品类.*回复率|reply rate.*category/i,
      label: '哪个品类回复率最高',
      build: function(){
        var byCat = {};
        (S.customers||[]).forEach(function(c){
          var cat = c.productCategory || '未分类';
          if(!byCat[cat]) byCat[cat] = { sent:0, replied:0 };
          var sent = (S.sendRecords||[]).filter(function(r){ return r.customerId === c.id; }).length;
          byCat[cat].sent += sent;
          var replied = (S.inbox||[]).some(function(it){ return it.customerId === c.id; });
          if(replied) byCat[cat].replied += 1;
        });
        var rows = Object.keys(byCat).map(function(k){
          var v = byCat[k];
          var rate = v.sent > 0 ? Math.round(v.replied / v.sent * 100) : 0;
          return { category: k, sent: v.sent, replied: v.replied, replyRate: rate + '%' };
        });
        rows.sort(function(a,b){ return parseFloat(b.replyRate) - parseFloat(a.replyRate); });
        var best = rows[0];
        return {
          answer: best ? '回复率最高的品类是 <b>' + esc(best.category) + '</b>，回复率 <b>' + best.replyRate + '</b>。' : '暂无数据',
          table: { headers:['品类','发送数','回复数','回复率'], rows: rows.map(function(r){return [r.category, r.sent, r.replied, r.replyRate];}) }
        };
      }
    },
    {
      match: /本周.*待跟进|本周.*跟进|follow up.*this week/i,
      label: '本周有多少待跟进客户',
      build: function(){
        var now = new Date();
        var day = now.getDay() || 7; // Mon=1..Sun=7
        var monday = new Date(now); monday.setDate(now.getDate() - day + 1); monday.setHours(0,0,0,0);
        var sunday = new Date(monday); sunday.setDate(monday.getDate() + 7);
        var list = (S.followUpReminders||[]).filter(function(r){
          var t = new Date(r.dueDate || r.due || r.createdAt || 0);
          return t >= monday && t < sunday && !r.done && !r.completed;
        });
        return {
          answer: '本周待跟进客户共 <b>' + list.length + '</b> 个。',
          table: { headers:['客户','到期日','状态'], rows: list.slice(0,20).map(function(r){
            var c = p7FindCustomer(r.customerId);
            return [ c ? c.company : (r.customerName||r.customerId||'—'), p7FmtDate(r.dueDate||r.due), r.status||'待跟进' ];
          })}
        };
      }
    },
    {
      match: /A级客户多少|A 级客户多少|how many.*A.*customer/i,
      label: 'A级客户有多少',
      build: function(){
        var list = (S.customers||[]).filter(function(c){ return c.p6Tier === 'A'; });
        return {
          answer: '当前 A 级客户共 <b>' + list.length + '</b> 个。',
          table: { headers:['客户','国家','分级分'], rows: list.slice(0,30).map(function(c){ return [c.company, c.country||'—', c.p6TierScore||'—']; }) }
        };
      }
    },
    {
      match: /哪个国家.*客户最多|国家.*最多|most customer.*country/i,
      label: '哪个国家客户最多',
      build: function(){
        var byCountry = {};
        (S.customers||[]).forEach(function(c){
          var k = c.country || '未知';
          byCountry[k] = (byCountry[k]||0) + 1;
        });
        var rows = Object.keys(byCountry).map(function(k){ return { country:k, n: byCountry[k] }; });
        rows.sort(function(a,b){ return b.n - a.n; });
        var top = rows[0];
        return {
          answer: top ? '客户最多的国家是 <b>' + esc(top.country) + '</b>，共 <b>' + top.n + '</b> 个客户。' : '暂无客户数据',
          table: { headers:['国家','客户数'], rows: rows.slice(0,15).map(function(r){ return [r.country, r.n]; }) }
        };
      }
    },
    {
      match: /最近30天.*新增|30天.*新客户|new customer.*30/i,
      label: '最近30天新增客户数',
      build: function(){
        var cutoff = Date.now() - 30*86400000;
        var list = (S.customers||[]).filter(function(c){
          var t = new Date(c.createdAt||0).getTime();
          return t >= cutoff;
        });
        return {
          answer: '最近30天新增客户 <b>' + list.length + '</b> 个。',
          table: { headers:['客户','国家','来源','新增日期'], rows: list.slice(0,20).map(function(c){ return [c.company, c.country||'—', c.source||'—', p7FmtDate(c.createdAt)]; }) }
        };
      }
    }
  ];

  window.p7RunQuery = async function(q){
    q = (q||'').trim();
    if(!q){ toast('请输入问题', 'err'); return; }
    // 1. keyword template match
    for(var i = 0; i < P7_QUERY_TEMPLATES.length; i++){
      var tpl = P7_QUERY_TEMPLATES[i];
      if(tpl.match.test(q)){
        var res = tpl.build();
        S.p7NlQueryHistory.unshift({
          id: uid(), question: q, answer: res.answer, queryType: 'template',
          table: res.table || null, createdAt: p7NowISO()
        });
        if(S.p7NlQueryHistory.length > 50) S.p7NlQueryHistory.length = 50;
        persist(); renderView();
        return;
      }
    }
    // 2. AI fallback
    toast('AI 正在理解你的问题…');
    var statsCtx = {
      totalCustomers: (S.customers||[]).length,
      totalSent: (S.sendRecords||[]).length,
      totalInbox: (S.inbox||[]).length,
      totalDrafts: (S.drafts||[]).length,
      aTierCount: (S.customers||[]).filter(function(c){return c.p6Tier==='A';}).length,
      bTierCount: (S.customers||[]).filter(function(c){return c.p6Tier==='B';}).length,
      cTierCount: (S.customers||[]).filter(function(c){return c.p6Tier==='C';}).length,
      countries: (function(){
        var m = {}; (S.customers||[]).forEach(function(c){ var k=c.country||'未知'; m[k]=(m[k]||0)+1; }); return m;
      })()
    };
    var prompt = '你是外贸CRM数据问答助手。基于以下系统统计数据，用一句简洁的中文回答用户问题。如果数据不足以回答，明确说明"数据不足"。\n'
      + '【系统统计】' + JSON.stringify(statsCtx) + '\n'
      + '【用户问题】' + q + '\n'
      + '直接输出回答（中文，一到两句话），不要JSON，不要Markdown。';
    try{
      var r = await callAI(
        [{ role:'user', content: prompt }],
        { purpose:'p7_nl_query', timeout:30000, temperature:0.2, model:'gpt-5.6-terra' }
      );
      var ans = r.error ? ('AI回答失败：' + (r.error||'')) : (r.content || '（无回答）');
      S.p7NlQueryHistory.unshift({
        id: uid(), question: q, answer: esc(ans), queryType: 'ai', table: null, createdAt: p7NowISO()
      });
      if(S.p7NlQueryHistory.length > 50) S.p7NlQueryHistory.length = 50;
      persist(); renderView();
    }catch(e){
      toast('查询出错：' + (e.message||e), 'err');
    }
  };

  window.p7Requery = function(id){
    var h = (S.p7NlQueryHistory||[]).find(function(x){ return x.id === id; });
    if(!h) return;
    window.p7RunQuery(h.question);
  };

  window.p7ClearQueryHistory = function(){
    S.p7NlQueryHistory = [];
    persist(); toast('查询历史已清空'); renderView();
  };

  window.p7DeleteQuery = function(id){
    S.p7NlQueryHistory = (S.p7NlQueryHistory||[]).filter(function(x){ return x.id !== id; });
    persist(); renderView();
  };

  // ── RENDER: AI Learning Center page ────────────────────────
  function p7RenderLearningPage(root){
    var totalEdits = (S.p7LearningRecords||[]).length;
    var totalPatterns = (S.p7LearnedPatterns||[]).length;
    var activeRules = (S.p7NlRules||[]).filter(function(r){return r.enabled;}).length;
    var triggers = (S.p7RuleTriggers||[]).length;

    var h = '<div class="p7-page">';
    h += '<div class="p7-stats">'
      + '<div class="p7-stat"><div class="p7-stat-num">' + totalEdits + '</div><div class="p7-stat-lbl">✏️ 累计人工修改</div></div>'
      + '<div class="p7-stat p7-a"><div class="p7-stat-num">' + totalPatterns + '</div><div class="p7-stat-lbl">🧠 学到的模式</div></div>'
      + '<div class="p7-stat p7-warn"><div class="p7-stat-num">' + activeRules + '</div><div class="p7-stat-lbl">📜 启用中的规则</div></div>'
      + '<div class="p7-stat"><div class="p7-stat-num">' + triggers + '</div><div class="p7-stat-lbl">⚡ 规则触发次数</div></div>'
      + '</div>';

    h += '<div class="p7-tabs">'
      + '<div class="p7-tab' + (window._p7LearnTab==='records'?' on':'') + '" onclick="p7SetLearnTab(\'records\')">📝 学习记录</div>'
      + '<div class="p7-tab' + (window._p7LearnTab==='patterns'?' on':'') + '" onclick="p7SetLearnTab(\'patterns\')">🧠 学到的模式</div>'
      + '<div class="p7-tab' + (window._p7LearnTab==='stats'?' on':'') + '" onclick="p7SetLearnTab(\'stats\')">📊 学习统计</div>'
      + '<div class="p7-tab' + (window._p7LearnTab==='nlRules'?' on':'') + '" onclick="p7SetLearnTab(\'nlRules\')">📜 自然语言规则</div>'
      + '<div class="p7-tab' + (window._p7LearnTab==='nlQuery'?' on':'') + '" onclick="p7SetLearnTab(\'nlQuery\')">🔍 智能查询</div>'
      + '</div>';

    if(window._p7LearnTab === 'records') h += p7RenderRecordsTab();
    else if(window._p7LearnTab === 'patterns') h += p7RenderPatternsTab();
    else if(window._p7LearnTab === 'stats') h += p7RenderStatsTab();
    else if(window._p7LearnTab === 'nlRules') h += p7RenderNlRulesTab();
    else h += p7RenderNlQueryTab();

    h += '</div>';
    root.innerHTML = h;
  }

  // Tab 1: learning records
  function p7RenderRecordsTab(){
    var recs = (S.p7LearningRecords||[]).slice().reverse();
    var custFilter = window._p7RecFilter || '';
    if(custFilter) recs = recs.filter(function(r){ return r.customerId === custFilter; });

    var h = '<div class="p7-panel">';
    h += '<div class="p7-panel-head">📝 人工修改AI草稿记录'
      + '<select class="p7-input p7-sel" onchange="p7SetRecFilter(this.value)">'
      + '<option value="">全部客户</option>';
    (S.customers||[]).forEach(function(c){
      h += '<option value="' + c.id + '"' + (custFilter===c.id?' selected':'') + '>' + esc(c.company) + '</option>';
    });
    h += '</select></div>';

    if(recs.length === 0){
      h += '<div class="p7-empty">还没有修改记录。当你在其他模块修改AI生成的草稿时，会自动记录到这里。</div>';
    } else {
      recs.forEach(function(r){
        var c = p7FindCustomer(r.customerId);
        h += '<div class="p7-rec-card">'
          + '<div class="p7-rec-head">'
          + '<span class="p7-rec-who">' + esc(c ? c.company : '未知客户') + '</span>'
          + '<span class="p7-tag">' + esc(r.draftType||'email') + '</span>'
          + '<span class="p7-rec-time">' + p7FmtDateTime(r.createdAt) + '</span>'
          + '</div>'
          + '<div class="p7-rec-diff">' + esc(r.diffSummary) + '</div>'
          + '<details class="p7-rec-detail"><summary>展开查看修改前后对比</summary>'
          + '<div class="p7-diff-grid">'
          + '<div><div class="p7-diff-lbl">原标题</div><div class="p7-diff-old">' + esc(r.originalSubject||'(空)') + '</div></div>'
          + '<div><div class="p7-diff-lbl">修改后标题</div><div class="p7-diff-new">' + esc(r.modifiedSubject||'(空)') + '</div></div>'
          + '</div>'
          + '<div class="p7-diff-lbl">原正文</div><pre class="p7-diff-old pre">' + esc(r.originalBody||'(空)') + '</pre>'
          + '<div class="p7-diff-lbl">修改后正文</div><pre class="p7-diff-new pre">' + esc(r.modifiedBody||'(空)') + '</pre>'
          + '</details>'
          + '<div class="p7-rec-ops"><button class="btn btn-sm btn-outline" onclick="p7DeleteLearningRecord(\'' + r.id + '\')">🗑 删除此记录</button></div>'
          + '</div>';
      });
    }
    h += '</div>';
    return h;
  }

  // Tab 2: learned patterns
  function p7RenderPatternsTab(){
    var patterns = S.p7LearnedPatterns || [];
    var h = '<div class="p7-panel">';
    h += '<div class="p7-panel-head">🧠 AI从修改中学习到的写作模式'
      + '<button class="btn btn-sm btn-primary" onclick="p7AnalyzePatterns()">✨ 分析最近修改模式</button></div>';
    if(patterns.length === 0){
      h += '<div class="p7-empty">还没有学习到模式。积累至少3条修改记录后，点击上方按钮让AI分析。</div>';
    } else {
      patterns.slice().reverse().forEach(function(p){
        h += '<div class="p7-pat-card' + (p.enabled===false?' off':'') + '">'
          + '<div class="p7-pat-head">'
          + '<span class="p7-tag">' + esc(p.patternType||'body') + '</span>'
          + '<span class="p7-pat-desc">' + esc(p.description||'') + '</span>'
          + '</div>'
          + (p.exampleBefore ? '<div class="p7-pat-ex"><span class="p7-diff-lbl">AI原写法</span><div class="p7-diff-old">' + esc(p.exampleBefore) + '</div></div>' : '')
          + (p.exampleAfter ? '<div class="p7-pat-ex"><span class="p7-diff-lbl">优化后写法</span><div class="p7-diff-new">' + esc(p.exampleAfter) + '</div></div>' : '')
          + '<div class="p7-pat-meta">命中 ' + (p.frequency||1) + ' 次 · 已应用 ' + (p.appliedCount||0) + ' 次</div>'
          + '<div class="p7-pat-ops">'
          + '<label class="p7-switch"><input type="checkbox" ' + (p.enabled!==false?'checked':'') + ' onchange="p7TogglePattern(\'' + p.id + '\')"> 应用到下次AI生成</label>'
          + '<button class="btn btn-sm btn-outline" onclick="p7DeletePattern(\'' + p.id + '\')">🗑 删除</button>'
          + '</div>'
          + '</div>';
      });
    }
    h += '</div>';
    return h;
  }

  // Tab 3: learning stats
  function p7RenderStatsTab(){
    var s = S.p7LearningStats || {};
    var parts = s.mostModifiedParts || {};
    var entries = Object.keys(parts).map(function(k){ return {k:k, n: parts[k]}; });
    entries.sort(function(a,b){ return b.n - a.n; });
    var max = entries.length ? entries[0].n : 1;
    var partLabels = {subject:'标题', body:'正文', cta:'CTA引导', commercial_detail:'商务细节', credential:'资质认证', other:'其他'};

    var h = '<div class="p7-stats-grid">';
    h += '<div class="p7-panel"><div class="p7-panel-head">📊 累计学习数据</div>'
      + '<div class="p7-stat-row"><span>累计人工修改次数</span><b>' + (s.totalEdits||0) + '</b></div>'
      + '<div class="p7-stat-row"><span>AI学习到的模式数</span><b>' + (s.patternsLearned||0) + '</b></div>'
      + '<div class="p7-stat-row"><span>上次分析时间</span><b>' + p7FmtDateTime(s.lastAnalysis) + '</b></div>'
      + '</div>';

    h += '<div class="p7-panel"><div class="p7-panel-head">📈 最常修改的部分</div>';
    if(entries.length === 0){
      h += '<div class="p7-empty">暂无数据</div>';
    } else {
      entries.forEach(function(e){
        var pct = Math.round(e.n / max * 100);
        h += '<div class="p7-bar-row">'
          + '<span class="p7-bar-lbl">' + (partLabels[e.k] || e.k) + '</span>'
          + '<div class="p7-bar"><div class="p7-bar-fill" style="width:' + pct + '%"></div></div>'
          + '<span class="p7-bar-num">' + e.n + '</span>'
          + '</div>';
      });
    }
    h += '</div></div>';

    h += '<div class="p7-panel" style="margin-top:12px"><div class="p7-panel-head">💡 学习效果说明</div>'
      + '<div style="font-size:13px;color:#4a5568;line-height:1.8">'
      + '每当你人工修改AI生成的草稿，系统会自动记录修改位置和差异摘要。<br>'
      + '点击「🧠 学到的模式」tab 中的「分析最近修改模式」，AI会归纳出你最常调整的写作偏好（例如标题太长、CTA不够明确等）。<br>'
      + '启用后的模式会作为"最佳实践"自动注入到后续所有AI草稿生成的prompt中，AI会越写越符合你的风格。'
      + '</div></div>';
    return h;
  }

  // Tab 4: NL rules
  function p7RenderNlRulesTab(){
    var rules = S.p7NlRules || [];
    var triggers = S.p7RuleTriggers || [];
    var h = '<div class="p7-panel">';
    h += '<div class="p7-panel-head">📜 自然语言跟进规则'
      + '<button class="btn btn-sm btn-primary" onclick="p7ManualCheckAllRules()">🔍 手动检测全部客户</button></div>';

    h += '<div class="p7-rule-create">'
      + '<input class="p7-input" id="p7_nl_rule_input" placeholder="用中文描述规则，例如：客户提到预算超过$5000时立即通知我" />'
      + '<button class="btn btn-sm btn-primary" onclick="p7CreateRule()">✨ AI解析并创建规则</button>'
      + '</div>';

    h += '<div style="font-size:12px;color:#718096;margin:8px 0 12px">支持字段：预算/交期/竞品/认证/数量/回复状态 · 动作：提醒/生成草稿建议/打标签 · ⚠️ 系统只提醒和生成草稿，绝不自动发送邮件或WhatsApp</div>';

    if(rules.length === 0){
      h += '<div class="p7-empty">还没有规则。在上方输入框用自然语言描述一条触发条件试试。</div>';
    } else {
      rules.slice().reverse().forEach(function(r){
        var cond = r.parsedCondition || {};
        h += '<div class="p7-rule-card' + (r.enabled===false?' off':'') + '">'
          + '<div class="p7-rule-raw">📌 ' + esc(r.rawText) + '</div>'
          + '<div class="p7-rule-cond">触发条件：<b>' + p7FieldLabel(cond.field) + ' ' + p7OpLabel(cond.operator) + ' ' + esc(String(cond.value||'')) + '</b> · 动作：' + p7ActionLabel(r.action) + '</div>'
          + '<div class="p7-rule-meta">累计触发 ' + (r.triggerCount||0) + ' 次</div>'
          + '<div class="p7-rule-ops">'
          + '<label class="p7-switch"><input type="checkbox" ' + (r.enabled!==false?'checked':'') + ' onchange="p7ToggleRule(\'' + r.id + '\')"> 启用</label>'
          + '<button class="btn btn-sm btn-outline" onclick="p7DeleteRule(\'' + r.id + '\')">🗑 删除</button>'
          + '</div>';
        // recent triggers for this rule
        var rt = triggers.filter(function(t){return t.ruleId === r.id;}).slice(-5).reverse();
        if(rt.length){
          h += '<div class="p7-rule-triggers"><div class="p7-diff-lbl">最近触发</div>';
          rt.forEach(function(t){
            var c = p7FindCustomer(t.customerId);
            h += '<div class="p7-rule-trigger-item">· ' + esc(c?c.company:t.customerId) + ' — ' + esc(t.matchedValue) + ' <small style="color:#a0aec0">(' + p7FmtDateTime(t.createdAt) + ')</small></div>';
          });
          h += '</div>';
        }
        h += '</div>';
      });
    }
    h += '</div>';
    return h;
  }

  // Tab 5: NL query
  function p7RenderNlQueryTab(){
    var history = S.p7NlQueryHistory || [];
    var h = '<div class="p7-panel">';
    h += '<div class="p7-panel-head">🔍 智能查数据（自然语言）'
      + '<button class="btn btn-sm btn-outline" onclick="p7ClearQueryHistory()">🗑 清空历史</button></div>';

    h += '<div class="p7-query-bar">'
      + '<input class="p7-input" id="p7_nl_query_input" placeholder="试试问：上个月发送了多少封邮件 / A级客户有多少 / 哪个国家客户最多" onkeydown="if(event.key===\'Enter\')p7RunQuery(document.getElementById(\'p7_nl_query_input\').value)" />'
      + '<button class="btn btn-sm btn-primary" onclick="p7RunQuery(document.getElementById(\'p7_nl_query_input\').value)">▶ 提问</button>'
      + '</div>';

    // suggested templates
    h += '<div class="p7-query-suggest">常见问题：';
    P7_QUERY_TEMPLATES.forEach(function(t){
      h += '<button class="btn btn-sm btn-outline" onclick="p7RunQuery(\'' + t.label.replace(/'/g,"\\'") + '\')">' + t.label + '</button>';
    });
    h += '</div>';

    // history
    if(history.length === 0){
      h += '<div class="p7-empty">还没有查询记录。</div>';
    } else {
      history.forEach(function(item){
        h += '<div class="p7-q-card">'
          + '<div class="p7-q-q">🙋 ' + esc(item.question) + ' <span class="p7-tag">' + (item.queryType==='ai'?'AI':'模板') + '</span> <small style="color:#a0aec0;margin-left:6px">' + p7FmtDateTime(item.createdAt) + '</small></div>'
          + '<div class="p7-q-a">💡 ' + item.answer + '</div>';
        if(item.table && item.table.rows && item.table.rows.length){
          h += '<table class="p7-table"><thead><tr>';
          item.table.headers.forEach(function(hh){ h += '<th>' + esc(hh) + '</th>'; });
          h += '</tr></thead><tbody>';
          item.table.rows.forEach(function(row){
            h += '<tr>';
            row.forEach(function(cell){ h += '<td>' + esc(String(cell)) + '</td>'; });
            h += '</tr>';
          });
          h += '</tbody></table>';
        }
        h += '<div class="p7-q-ops"><button class="btn btn-sm btn-outline" onclick="p7Requery(\'' + item.id + '\')">🔄 重新查询</button>'
          + '<button class="btn btn-sm btn-outline" onclick="p7DeleteQuery(\'' + item.id + '\')">🗑</button></div>'
          + '</div>';
      });
    }
    h += '</div>';
    return h;
  }

  // ── RENDER: Negotiation Monitor page ──────────────────────
  function p7HealthColor(score){
    if(score < 40) return '#c53030';
    if(score < 70) return '#d69e2e';
    return '#38a169';
  }
  function p7HealthLabel(score){
    if(score < 40) return '⚠️ 危险';
    if(score < 70) return '🟡 警告';
    return '🟢 健康';
  }

  function p7RenderNegotiationPage(root){
    var customers = S.customers || [];
    // enrich with analysis; unanalyzed customers get score = null
    var list = customers.map(function(c){
      var a = S.p7NegotiationAnalysis[c.id];
      return { c: c, score: a ? a.healthScore : null, analysis: a };
    });
    // sort: unanalyzed at bottom, analyzed by score asc (most dangerous first)
    list.sort(function(a, b){
      if(a.score == null && b.score == null) return 0;
      if(a.score == null) return 1;
      if(b.score == null) return -1;
      return a.score - b.score;
    });

    var analyzedCount = list.filter(function(x){return x.score != null;}).length;
    var dangerCount = list.filter(function(x){return x.score != null && x.score < 40;}).length;
    var avgScore = analyzedCount > 0
      ? Math.round(list.reduce(function(s,x){return s + (x.score||0);},0) / analyzedCount)
      : 0;

    var h = '<div class="p7-page">';
    h += '<div class="p7-stats">'
      + '<div class="p7-stat"><div class="p7-stat-num">' + analyzedCount + '/' + customers.length + '</div><div class="p7-stat-lbl">🎯 已分析客户</div></div>'
      + '<div class="p7-stat p7-danger"><div class="p7-stat-num">' + dangerCount + '</div><div class="p7-stat-lbl">🚨 健康度&lt;40</div></div>'
      + '<div class="p7-stat"><div class="p7-stat-num">' + (analyzedCount?avgScore:'—') + '</div><div class="p7-stat-lbl">📈 平均健康度</div></div>'
      + '<div class="p7-stat p7-warn"><button class="btn btn-sm btn-primary" onclick="p7AnalyzeAllNegotiations()">✨ AI批量分析全部</button></div>'
      + '</div>';

    // Detail drawer
    if(window._p7NegDetail){
      var detC = p7FindCustomer(window._p7NegDetail);
      var detA = S.p7NegotiationAnalysis[window._p7NegDetail];
      if(detC){
        h += '<div class="p7-detail-panel">';
        h += '<div class="p7-panel-head">'
          + '<span>🎯 ' + esc(detC.company) + ' 谈单详情</span>'
          + '<button class="btn btn-sm btn-outline" onclick="p7CloseNegDetail()">✖ 关闭</button>'
          + '</div>';
        if(detA){
          h += '<div class="p7-health-big" style="color:' + p7HealthColor(detA.healthScore) + '">' + detA.healthScore + ' <small>' + p7HealthLabel(detA.healthScore) + '</small></div>';
          h += '<div style="font-size:12px;color:#718096;margin-bottom:12px">分析时间：' + p7FmtDateTime(detA.lastAnalyzed) + '</div>';
          (detA.bottlenecks||[]).forEach(function(b){
            h += '<div class="p7-bn-card">'
              + '<div class="p7-bn-type">' + (P7_BOTTLENECK_LABELS[b.type] || b.type) + '</div>'
              + '<div class="p7-bn-desc"><b>现象：</b>' + esc(b.description||'') + '</div>'
              + '<div class="p7-bn-sug"><b>建议：</b>' + esc(b.suggestion||'') + '</div>'
              + (b.talkTrack ? '<div class="p7-bn-tt"><b>推荐话术（英文，仅草稿）：</b><pre>' + esc(b.talkTrack) + '</pre></div>' : '')
              + '</div>';
          });
        } else {
          h += '<div class="p7-empty">尚未分析该客户。</div>';
        }
        h += '<div style="margin-top:10px"><button class="btn btn-sm btn-primary" onclick="p7AnalyzeNegotiation(\'' + detC.id + '\')">🔄 重新AI分析</button>'
          + '<button class="btn btn-sm btn-outline" onclick="go(\'customers\',{id:\'' + detC.id + '\'})">➡️ 查看客户详情</button></div>';
        h += '</div>';
      }
    }

    // Customer list
    h += '<div class="p7-panel"><div class="p7-panel-head">👥 客户谈单健康度（最危险在前）</div>';
    if(list.length === 0){
      h += '<div class="p7-empty">暂无客户。</div>';
    } else {
      h += '<table class="p7-table"><thead><tr><th>客户</th><th>国家</th><th>分级</th><th>健康度</th><th>卡点</th><th>操作</th></tr></thead><tbody>';
      list.forEach(function(item){
        var c = item.c;
        var score = item.score;
        h += '<tr>';
        h += '<td class="p7-cust-name">' + esc(c.company) + '</td>';
        h += '<td>' + esc(c.country||'—') + '</td>';
        h += '<td><span class="p7-badge p7-t' + (c.p6Tier||'C') + '">' + (c.p6Tier||'C') + '</span></td>';
        if(score == null){
          h += '<td><span style="color:#a0aec0">未分析</span></td>';
        } else {
          h += '<td><span style="color:' + p7HealthColor(score) + ';font-weight:700">' + score + ' ' + p7HealthLabel(score) + '</span></td>';
        }
        if(item.analysis && item.analysis.bottlenecks && item.analysis.bottlenecks.length){
          h += '<td>' + item.analysis.bottlenecks.map(function(b){ return P7_BOTTLENECK_LABELS[b.type] || b.type; }).join('、') + '</td>';
        } else {
          h += '<td style="color:#a0aec0">—</td>';
        }
        h += '<td><button class="btn btn-sm btn-primary" onclick="p7ShowNegDetail(\'' + c.id + '\')">🔍 详情</button> '
          + '<button class="btn btn-sm btn-outline" onclick="p7AnalyzeNegotiation(\'' + c.id + '\')">✨ AI分析</button></td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div>';

    h += '</div>';
    root.innerHTML = h;
  }

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'aiLearning'){
      p7RenderLearningPage(document.getElementById('mainContent'));
      return;
    }
    if(currentView === 'negotiationMonitor'){
      p7RenderNegotiationPage(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p7- prefixed, responsive) ────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p7-page{padding:4px;}'
    + '.p7-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}'
    + '.p7-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.p7-stat-num{font-size:26px;font-weight:700;color:#2d3748;}'
    + '.p7-stat-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    + '.p7-stat.p7-a .p7-stat-num{color:#d69e2e;}'
    + '.p7-stat.p7-warn .p7-stat-num{color:#dd6b20;}'
    + '.p7-stat.p7-danger .p7-stat-num{color:#c53030;}'
    + '.p7-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}'
    + '.p7-tab{padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;color:#4a5568;}'
    + '.p7-tab.on{background:#3182ce;color:#fff;border-color:#3182ce;font-weight:600;}'
    + '.p7-panel{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px;}'
    + '.p7-panel-head{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.p7-input{width:100%;padding:6px 8px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;box-sizing:border-box;}'
    + '.p7-sel{width:auto !important;min-width:140px;}'
    + '.p7-empty{padding:30px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.p7-tag{font-size:11px;padding:2px 8px;border-radius:10px;background:#edf2f7;color:#4a5568;margin-left:4px;}'
    + '.p7-badge{font-size:11px;padding:2px 10px;border-radius:10px;font-weight:600;color:#fff;}'
    + '.p7-badge.p7tA{background:#d69e2e;}'
    + '.p7-badge.p7tB{background:#3182ce;}'
    + '.p7-badge.p7tC{background:#a0aec0;}'
    // records
    + '.p7-rec-card{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:10px;background:#fafcff;}'
    + '.p7-rec-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}'
    + '.p7-rec-who{font-weight:700;color:#2d3748;}'
    + '.p7-rec-time{margin-left:auto;font-size:11px;color:#a0aec0;}'
    + '.p7-rec-diff{font-size:13px;color:#4a5568;margin:6px 0;}'
    + '.p7-rec-detail{margin-top:6px;font-size:12px;}'
    + '.p7-rec-detail summary{cursor:pointer;color:#3182ce;}'
    + '.p7-diff-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0;}'
    + '.p7-diff-lbl{font-size:11px;color:#718096;margin:6px 0 2px;font-weight:600;}'
    + '.p7-diff-old{background:#fff5f5;border-left:3px solid #fc8181;padding:6px 8px;border-radius:4px;font-size:12px;color:#742a2a;white-space:pre-wrap;}'
    + '.p7-diff-new{background:#f0fff4;border-left:3px solid #68d391;padding:6px 8px;border-radius:4px;font-size:12px;color:#22543d;white-space:pre-wrap;}'
    + '.pre{white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto;}'
    + '.p7-rec-ops{margin-top:8px;}'
    // patterns
    + '.p7-pat-card{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:10px;background:#fff;}'
    + '.p7-pat-card.off{opacity:0.6;}'
    + '.p7-pat-head{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;margin-bottom:6px;}'
    + '.p7-pat-desc{font-weight:600;color:#2d3748;font-size:13px;flex:1;}'
    + '.p7-pat-ex{margin:4px 0;}'
    + '.p7-pat-meta{font-size:11px;color:#a0aec0;margin:6px 0;}'
    + '.p7-pat-ops{display:flex;gap:10px;align-items:center;margin-top:6px;}'
    + '.p7-switch{font-size:12px;color:#4a5568;display:flex;align-items:center;gap:4px;cursor:pointer;}'
    // stats
    + '.p7-stats-grid{display:grid;grid-template-columns:1fr 1.4fr;gap:14px;align-items:start;}'
    + '.p7-stat-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #edf2f7;font-size:13px;}'
    + '.p7-bar-row{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;}'
    + '.p7-bar-lbl{width:90px;color:#4a5568;}'
    + '.p7-bar{flex:1;height:14px;background:#edf2f7;border-radius:7px;overflow:hidden;}'
    + '.p7-bar-fill{height:100%;background:linear-gradient(90deg,#3182ce,#63b3ed);}'
    + '.p7-bar-num{width:30px;text-align:right;color:#718096;font-weight:600;}'
    // rules
    + '.p7-rule-create{display:flex;gap:8px;margin-bottom:10px;}'
    + '.p7-rule-create .p7-input{flex:1;}'
    + '.p7-rule-card{border:1px solid #e2e8f0;border-left:4px solid #3182ce;border-radius:8px;padding:12px;margin-bottom:10px;background:#fff;}'
    + '.p7-rule-card.off{opacity:0.55;border-left-color:#cbd5e0;}'
    + '.p7-rule-raw{font-weight:700;color:#2d3748;font-size:14px;margin-bottom:4px;}'
    + '.p7-rule-cond{font-size:12px;color:#4a5568;margin:4px 0;}'
    + '.p7-rule-meta{font-size:11px;color:#a0aec0;}'
    + '.p7-rule-ops{display:flex;gap:10px;align-items:center;margin-top:6px;}'
    + '.p7-rule-triggers{margin-top:8px;background:#f7fafc;border-radius:6px;padding:6px 8px;}'
    + '.p7-rule-trigger-item{font-size:12px;color:#4a5568;margin:2px 0;}'
    // query
    + '.p7-query-bar{display:flex;gap:8px;margin-bottom:10px;}'
    + '.p7-query-bar .p7-input{flex:1;}'
    + '.p7-query-suggest{font-size:12px;color:#718096;margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}'
    + '.p7-q-card{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:10px;background:#fff;}'
    + '.p7-q-q{font-weight:600;color:#2d3748;margin-bottom:6px;font-size:13px;}'
    + '.p7-q-a{font-size:13px;color:#4a5568;background:#f7fafc;padding:8px;border-radius:6px;margin-bottom:8px;}'
    + '.p7-q-ops{display:flex;gap:6px;}'
    // table
    + '.p7-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:13px;margin-top:8px;}'
    + '.p7-table th{background:#f7fafc;text-align:left;padding:8px 10px;font-size:12px;color:#718096;border-bottom:1px solid #e2e8f0;}'
    + '.p7-table td{padding:8px 10px;border-bottom:1px solid #edf2f7;vertical-align:top;}'
    + '.p7-cust-name{font-weight:600;}'
    // negotiation detail
    + '.p7-detail-panel{background:#fffbeb;border:2px solid #f6ad55;border-radius:10px;padding:14px;margin-bottom:14px;}'
    + '.p7-health-big{font-size:48px;font-weight:800;line-height:1;}'
    + '.p7-health-big small{font-size:16px;font-weight:600;}'
    + '.p7-bn-card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin:8px 0;}'
    + '.p7-bn-type{font-weight:700;color:#c53030;margin-bottom:4px;}'
    + '.p7-bn-desc{font-size:13px;color:#4a5568;margin:3px 0;}'
    + '.p7-bn-sug{font-size:13px;color:#2d3748;margin:3px 0;}'
    + '.p7-bn-tt{font-size:12px;margin-top:6px;}'
    + '.p7-bn-tt pre{background:#f7fafc;padding:8px;border-radius:6px;white-space:pre-wrap;color:#2d3748;margin:4px 0;}'
    // Responsive
    + '@media (max-width:768px){'
    + '  .p7-stats{grid-template-columns:repeat(2,1fr);}'
    + '  .p7-stats-grid{grid-template-columns:1fr;}'
    + '  .p7-diff-grid{grid-template-columns:1fr;}'
    + '  .p7-rule-create{flex-direction:column;}'
    + '  .p7-query-bar{flex-direction:column;}'
    + '  .p7-table{display:block;overflow-x:auto;}'
    + '  .p7-pat-ops,.p7-rule-ops{flex-direction:column;align-items:stretch;}'
    + '  .p7-rec-time{margin-left:0;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
