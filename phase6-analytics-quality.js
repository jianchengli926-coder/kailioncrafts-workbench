/* ============================================================
 * P6 Phase6 Module: Analytics & Quality (Features 18-20)
 * ----------------------------------------------------------------
 * Feature 18: AI communication quality audit (reply drafts)
 * Feature 19: Dormant customer AI wake-up priority prediction
 * Feature 20: Full outreach funnel analysis
 *
 * HARD RULE: This module NEVER sends any email / message.
 * Wake-up drafts are suggestions only — the user sends manually.
 * All new CSS classes use the p6- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  if(!Array.isArray(S.p6ReplyQualityAudits)) S.p6ReplyQualityAudits = [];

  // Local UI state (not persisted)
  var p6State = {
    tab: 'quality',        // quality | dormant | funnel
    funnelDim: 'category', // category | account | month
    funnelStage: null,     // drilldown stage key
    predicting: false,
    predictDone: 0,
    predictTotal: 0,
    predictingLabel: ''
  };

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'analyticsQuality',
    icon: '📊',
    label: '质检与分析',
    title: '沟通质检与漏斗分析',
    crumb: '回复质检 · 沉睡预测 · 全链路漏斗'
  });

  // ── Local helpers ──────────────────────────────────────────
  function p6NowISO(){ return new Date().toISOString(); }

  function p6FmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p6FmtTime(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return p6FmtDate(iso)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  function p6FindCustomer(id){
    return (S.customers||[]).find(function(x){ return x.id === id; }) || null;
  }

  // Robust JSON extraction from AI response (may be wrapped in ```json ...```)
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

  function p6ClampScore(n){
    n = parseInt(n, 10);
    if(isNaN(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  // ── Feature 18: Reply Quality Audit ────────────────────────

  // Find the original inquiry text for a reply draft.
  // Prefer replyDraft.originalInquiry; else most recent inbox item for that customer.
  function p6FindOriginalInquiry(rd){
    if(rd.originalInquiry && String(rd.originalInquiry).trim()){
      return String(rd.originalInquiry);
    }
    var inbox = (S.inbox||[]).slice().sort(function(a,b){
      return new Date(b.receivedAt || b.createdAt || 0) - new Date(a.receivedAt || a.createdAt || 0);
    });
    for(var i=0;i<inbox.length;i++){
      if(inbox[i].customerId === rd.customerId){
        return inbox[i].body || inbox[i].subject || '(无正文)';
      }
    }
    return '(未找到原始询盘内容)';
  }

  // Compute response-time bucket by comparing inquiry receivedAt vs reply sentAt
  function p6ResponseTimeBucket(rd){
    // Try to find original inbox item's receivedAt
    var inquiryTime = null;
    var inbox = (S.inbox||[]);
    for(var i=0;i<inbox.length;i++){
      if(inbox[i].customerId === rd.customerId && inbox[i].receivedAt){
        if(!inquiryTime || new Date(inbox[i].receivedAt) < new Date(inquiryTime)){
          inquiryTime = inbox[i].receivedAt;
        }
      }
    }
    if(!inquiryTime || !rd.sentAt) return 'unknown';
    var diffH = (new Date(rd.sentAt) - new Date(inquiryTime)) / 3600000;
    if(isNaN(diffH)) return 'unknown';
    if(diffH <= 24) return 'pass';
    if(diffH <= 48) return 'warn';
    return 'fail';
  }

  function p6BuildQualityPrompt(customerName, inquiryText, replyText, respBucket){
    return '你是B2B外贸邮件质检专家。请对业务员的客户回复进行6维度评分，输出JSON：\n'
      + '{"score":0-100,'
      + '"dimensions":{"answeredAll":0-100,"valueProp":0-100,"cta":0-100,"tone":0-100,"grammar":0-100,"responseTime":"pass/warn/fail"},'
      + '"strengths":["优点1","优点2"],'
      + '"improvements":["改进建议1","改进建议2"],'
      + '"overallComment":"一句话总评"}\n'
      + '评分标准：\n'
      + '- answeredAll: 是否回答了客户所有问题\n'
      + '- valueProp: 是否包含产品卖点/价值主张\n'
      + '- cta: 是否有明确的下一步行动号召\n'
      + '- tone: 语气是否专业友好\n'
      + '- grammar: 语法拼写是否正确\n'
      + '- responseTime: 24小时内=pass, 24-48小时=warn, >48小时=fail（系统已给出参考值：' + respBucket + '）\n'
      + '客户：' + customerName + '\n'
      + '客户原始询盘：\n' + inquiryText + '\n\n'
      + '业务员回复：\n' + replyText + '\n\n'
      + '只输出JSON，不要其他文字。';
  }

  // Audit a single sent reply draft. Async.
  window.p6AuditReply = async function(replyDraftId){
    var rd = (S.replyDrafts||[]).find(function(x){ return x.id === replyDraftId; });
    if(!rd){ toast('未找到回复草稿', 'err'); return; }

    toast('AI正在质检「' + (rd.customerName||'客户') + '」的回复...');

    try{
      var inquiryText = p6FindOriginalInquiry(rd);
      var respBucket = p6ResponseTimeBucket(rd);
      var prompt = p6BuildQualityPrompt(rd.customerName||'未知客户', inquiryText, rd.replyBody||'(空)', respBucket);

      var r = await callAI(
        [{ role: 'user', content: prompt }],
        { purpose: 'replyQualityAudit', timeout: 60000, temperature: 0.2, model: 'gpt-5.6-terra' }
      );
      if(r.error){ toast('质检失败：' + (r.error||'未知错误'), 'err'); return; }

      var res = p6ParseAIJSON(r.content);
      if(!res){ toast('AI返回格式异常', 'err'); return; }

      var dims = res.dimensions || {};
      // Override responseTime with our computed value (more reliable than AI guessing)
      if(respBucket !== 'unknown') dims.responseTime = respBucket;
      else if(!dims.responseTime) dims.responseTime = 'unknown';

      // Remove any prior audit for this replyDraft, then push new one
      S.p6ReplyQualityAudits = S.p6ReplyQualityAudits.filter(function(a){ return a.replyDraftId !== replyDraftId; });
      S.p6ReplyQualityAudits.push({
        id: uid(),
        replyDraftId: replyDraftId,
        customerId: rd.customerId,
        customerName: rd.customerName || '未知客户',
        score: p6ClampScore(res.score),
        dimensions: {
          answeredAll: p6ClampScore(dims.answeredAll),
          valueProp: p6ClampScore(dims.valueProp),
          cta: p6ClampScore(dims.cta),
          tone: p6ClampScore(dims.tone),
          grammar: p6ClampScore(dims.grammar),
          responseTime: dims.responseTime || 'unknown'
        },
        strengths: Array.isArray(res.strengths) ? res.strengths.slice(0,5) : [],
        improvements: Array.isArray(res.improvements) ? res.improvements.slice(0,5) : [],
        overallComment: String(res.overallComment||'').slice(0,300),
        auditedAt: p6NowISO()
      });

      persist();
      toast('✅ 质检完成：' + (rd.customerName||'客户') + ' → ' + p6ClampScore(res.score) + '分');
      renderView();
    }catch(err){
      console.error('[p6] audit error:', err);
      toast('质检异常：' + (err.message||err), 'err');
    }
  };

  // Audit all sent reply drafts that do not yet have an audit
  window.p6AuditAll = async function(){
    var sent = (S.replyDrafts||[]).filter(function(rd){
      return (rd.status === 'sent' || rd.status === '已发送');
    });
    var todo = sent.filter(function(rd){
      return !S.p6ReplyQualityAudits.some(function(a){ return a.replyDraftId === rd.id; });
    });
    if(todo.length === 0){ toast('没有待质检的已发送回复'); return; }

    if(!confirm('将对 ' + todo.length + ' 条已发送回复进行AI质检，是否继续？')) return;

    for(var i=0;i<todo.length;i++){
      toast('正在质检 ' + (i+1) + '/' + todo.length + '：' + (todo[i].customerName||'客户'));
      // eslint-disable-next-line no-await-in-loop
      await window.p6AuditReply(todo[i].id);
    }
    toast('✅ 批量质检完成，共 ' + todo.length + ' 条');
  };

  // Dashboard aggregate stats
  function p6QualityDashboard(){
    var audits = S.p6ReplyQualityAudits || [];
    if(audits.length === 0){
      return { avg: 0, total: 0, excellent:0, good:0, needs:0, poor:0, themes:{}, trend:[] };
    }
    var sum = 0, excellent=0, good=0, needs=0, poor=0;
    var themeCount = {};
    audits.forEach(function(a){
      sum += a.score;
      if(a.score >= 85) excellent++;
      else if(a.score >= 70) good++;
      else if(a.score >= 50) needs++;
      else poor++;
      (a.improvements||[]).forEach(function(imp){
        var key = String(imp).trim().slice(0,40);
        themeCount[key] = (themeCount[key]||0) + 1;
      });
    });
    // Top themes
    var themes = Object.keys(themeCount).map(function(k){ return {text:k, count:themeCount[k]}; })
      .sort(function(a,b){ return b.count - a.count; }).slice(0,5);
    // Trend: last 10 audits sorted by auditedAt ascending
    var trend = audits.slice().sort(function(a,b){ return new Date(a.auditedAt) - new Date(b.auditedAt); }).slice(-10);
    return {
      avg: Math.round(sum / audits.length),
      total: audits.length,
      excellent: excellent, good: good, needs: needs, poor: poor,
      themes: themes,
      trend: trend
    };
  }

  // ── Feature 19: Dormant Wake-up Prediction ───────────────

  // Build a compact customer profile for prediction
  function p6BuildDormantProfile(d){
    var cust = p6FindCustomer(d.customerId);
    // Historical interaction frequency: count timeline events on customer
    var interactCount = 0;
    if(cust && Array.isArray(cust.timeline)) interactCount = cust.timeline.length;
    // Last reply content sentiment: look at most recent inbox body
    var lastReply = '';
    var inbox = (S.inbox||[]).slice().sort(function(a,b){
      return new Date(b.receivedAt||b.createdAt||0) - new Date(a.receivedAt||a.createdAt||0);
    });
    for(var i=0;i<inbox.length;i++){
      if(inbox[i].customerId === d.customerId){ lastReply = inbox[i].body || ''; break; }
    }
    // Days since last interaction
    var daysSince = '';
    if(d.lastInteraction){
      var diff = (Date.now() - new Date(d.lastInteraction).getTime()) / 86400000;
      if(!isNaN(diff)) daysSince = Math.round(diff) + '天';
    }
    return {
      company: d.customerName || (cust && cust.company) || '未知客户',
      industry: (cust && cust.industry) || '',
      country: (cust && cust.country) || '',
      productCategory: (cust && cust.productCategory) || '',
      interactionCount: interactCount,
      daysSinceLast: daysSince,
      lastReplySnippet: lastReply.slice(0, 400),
      dormantReason: d.reason || ''
    };
  }

  function p6BuildPredictPrompt(profile){
    return '你是B2B外贸客户激活专家。请预测以下沉睡客户的唤醒成功概率，输出JSON：\n'
      + '{"priority":"high/medium/low","score":0-100,"reason":"一句话理由","recommendedStrategy":"new_value/light_touch/final_ultimatum","strategyDetail":"具体建议"}\n'
      + '策略说明：\n'
      + '- new_value: 提供新产品/新价值点重新激活\n'
      + '- light_touch: 轻量级问候/节日/行业资讯触达\n'
      + '- final_ultimatum: 最后一次跟进，告知将停止跟进\n'
      + '客户资料：' + JSON.stringify(profile) + '\n'
      + '只输出JSON。';
  }

  // Predict for a single dormant customer. Async.
  window.p6PredictDormant = async function(customerId){
    var d = (S.dormantCustomers||[]).find(function(x){ return x.customerId === customerId; });
    if(!d){ toast('未找到该沉睡客户', 'err'); return; }

    try{
      var profile = p6BuildDormantProfile(d);
      var r = await callAI(
        [{ role: 'user', content: p6BuildPredictPrompt(profile) }],
        { purpose: 'dormantWakePredict', timeout: 60000, temperature: 0.2, model: 'gpt-5.6-terra' }
      );
      if(r.error){ toast('预测失败：' + (r.error||'未知错误'), 'err'); return; }
      var res = p6ParseAIJSON(r.content);
      if(!res){ toast('AI返回格式异常', 'err'); return; }

      var validPri = ['high','medium','low'];
      var validStrat = ['new_value','light_touch','final_ultimatum'];
      d.p6WakePrediction = {
        priority: validPri.indexOf(res.priority) >= 0 ? res.priority : 'low',
        score: p6ClampScore(res.score),
        reason: String(res.reason||'').slice(0,200),
        recommendedStrategy: validStrat.indexOf(res.recommendedStrategy) >= 0 ? res.recommendedStrategy : 'light_touch',
        strategyDetail: String(res.strategyDetail||'').slice(0,300),
        predictedAt: p6NowISO()
      };
      persist();
      renderView();
    }catch(err){
      console.error('[p6] predict error:', err);
      toast('预测异常：' + (err.message||err), 'err');
    }
  };

  // Predict all dormant customers sequentially
  window.p6PredictAll = async function(){
    var list = (S.dormantCustomers||[]).slice();
    if(list.length === 0){ toast('暂无沉睡客户'); return; }
    var todo = list.filter(function(d){ return !d.p6WakePrediction; });
    if(todo.length === 0){ toast('所有沉睡客户均已预测'); return; }
    if(!confirm('将对 ' + todo.length + ' 个沉睡客户进行AI预测，是否继续？')) return;

    p6State.predicting = true;
    p6State.predictTotal = todo.length;
    p6State.predictDone = 0;
    renderView();

    for(var i=0;i<todo.length;i++){
      p6State.predictingLabel = (i+1) + '/' + todo.length + ' ' + (todo[i].customerName||'');
      renderView();
      // eslint-disable-next-line no-await-in-loop
      await window.p6PredictDormant(todo[i].customerId);
      p6State.predictDone = i+1;
    }
    p6State.predicting = false;
    p6State.predictingLabel = '';
    toast('✅ 全部预测完成');
    renderView();
  };

  // Generate wake-up email DRAFT (never sends). Store on d.p6WakeDraft.
  window.p6GenWakeDraft = async function(customerId){
    var d = (S.dormantCustomers||[]).find(function(x){ return x.customerId === customerId; });
    if(!d){ toast('未找到该客户', 'err'); return; }
    var pred = d.p6WakePrediction;
    if(!pred){ toast('请先运行优先级预测', 'err'); return; }

    toast('正在生成唤醒话术（仅草稿，不会自动发送）...');
    try{
      var company = d.customerName || 'Customer';
      var dormantDays = '';
      if(d.dormantSince){
        var diff = (Date.now() - new Date(d.dormantSince).getTime()) / 86400000;
        if(!isNaN(diff)) dormantDays = Math.round(diff) + ' days';
      }
      var stratMap = {
        new_value: 'new product / new value proposition / new market insight',
        light_touch: 'light touch greeting / industry update / seasonal check-in',
        final_ultimatum: 'final friendly follow-up, letting them know we will close this thread unless they reply'
      };
      var prompt = 'You are a B2B foreign-trade sales writer. Write a wake-up email DRAFT (English) for a dormant customer.\n'
        + 'Customer company: ' + company + '\n'
        + 'Dormant duration: ' + (dormantDays || 'unknown') + '\n'
        + 'Recommended strategy: ' + stratMap[pred.recommendedStrategy] + '\n'
        + 'Strategy detail: ' + (pred.strategyDetail||'') + '\n'
        + 'Tone: professional, warm, not pushy. Keep under 150 words body.\n'
        + 'Output JSON: {"subject":"...","body":"..."}\n'
        + 'Only output JSON.';

      var r = await callAI(
        [{ role: 'user', content: prompt }],
        { purpose: 'wakeDraft', timeout: 60000, temperature: 0.4, model: 'gpt-5.6-terra' }
      );
      if(r.error){ toast('生成失败：' + (r.error||'未知错误'), 'err'); return; }
      var res = p6ParseAIJSON(r.content);
      if(!res || !res.body){ toast('AI返回格式异常', 'err'); return; }

      d.p6WakeDraft = {
        subject: String(res.subject||'').slice(0,120),
        body: String(res.body||'').slice(0,2000),
        generatedAt: p6NowISO()
      };
      persist();
      toast('✅ 唤醒话术已生成（请人工检查后手动发送）');
      renderView();
    }catch(err){
      console.error('[p6] wake draft error:', err);
      toast('生成异常：' + (err.message||err), 'err');
    }
  };

  // Record wake-up result feedback
  window.p6SetWakeResult = function(customerId, result){
    var d = (S.dormantCustomers||[]).find(function(x){ return x.customerId === customerId; });
    if(!d) return;
    d.p6WakeResult = result; // 'contacted' | 'responded' | 'no_response'
    persist();
    renderView();
  };

  // ── Feature 20: Funnel Analysis ───────────────────────────

  function p6UniqCustomerIds(arr){
    var seen = {};
    (arr||[]).forEach(function(x){
      if(x && x.customerId) seen[x.customerId] = true;
    });
    return Object.keys(seen).length;
  }

  // Compute funnel for a filtered subset of sendRecords (or all).
  // For downstream stages (replied/inquired/quoted/closed), we count only
  // customers who appear in the filtered sendRecords subset.
  function p6ComputeFunnel(filteredSendRecords){
    var sends = filteredSendRecords || (S.sendRecords||[]);
    var sent = sends.length;
    var bounced = sends.filter(function(r){
      return r.status === 'bounced' || r.followUpStatus === 'bounced';
    }).length;
    var delivered = Math.max(0, sent - bounced);
    var opened = sends.filter(function(r){ return r.openStatus === 'opened'; }).length;
    var clicked = sends.filter(function(r){ return r.clickStatus === 'clicked'; }).length;

    // Customers who were in this filtered send set
    var sendCustomerIds = {};
    sends.forEach(function(r){ if(r.customerId) sendCustomerIds[r.customerId] = true; });
    var sendCustList = Object.keys(sendCustomerIds);

    // Replied: inbox items whose customerId is in send set
    var replied = 0;
    (S.inbox||[]).forEach(function(it){
      if(it && it.customerId && sendCustomerIds[it.customerId]) replied++;
    });
    // Also count customers with status='已回复' who are in send set
    (S.customers||[]).forEach(function(c){
      if(sendCustomerIds[c.id] && c.status === '已回复') replied++;
    });
    // Dedupe: replied should be unique customers
    var repliedCust = {};
    (S.inbox||[]).forEach(function(it){
      if(it && it.customerId && sendCustomerIds[it.customerId]) repliedCust[it.customerId] = true;
    });
    (S.customers||[]).forEach(function(c){
      if(sendCustomerIds[c.id] && c.status === '已回复') repliedCust[c.id] = true;
    });
    replied = Object.keys(repliedCust).length;

    var inquired = 0;
    (S.inquiries||[]).forEach(function(q){
      if(q && q.customerId && sendCustomerIds[q.customerId]) inquired = true;
    });
    // Count unique customers with inquiries
    var inquCust = {};
    (S.inquiries||[]).forEach(function(q){
      if(q && q.customerId && sendCustomerIds[q.customerId]) inquCust[q.customerId] = true;
    });
    inquired = Object.keys(inquCust).length;

    var quotedCust = {};
    (S.quotes||[]).forEach(function(q){
      if(q && q.customerId && sendCustomerIds[q.customerId]) quotedCust[q.customerId] = true;
    });
    var quoted = Object.keys(quotedCust).length;

    var closedCust = {};
    (S.orders||[]).forEach(function(o){
      if(o && o.customerId && sendCustomerIds[o.customerId]) closedCust[o.customerId] = true;
    });
    (S.customers||[]).forEach(function(c){
      if(sendCustomerIds[c.id] && c.status === '已成交') closedCust[c.id] = true;
    });
    var closed = Object.keys(closedCust).length;

    var stages = [
      { key:'sent',     label:'发送',   count: sent },
      { key:'delivered',label:'送达',   count: delivered },
      { key:'opened',   label:'打开',   count: opened },
      { key:'clicked',  label:'点击',   count: clicked },
      { key:'replied',  label:'回复',   count: replied },
      { key:'inquired', label:'询盘',   count: inquired },
      { key:'quoted',   label:'报价',   count: quoted },
      { key:'closed',   label:'成交',   count: closed }
    ];
    // Attach conversion / drop-off
    stages.forEach(function(s, i){
      if(i === 0){ s.cvr = 100; s.drop = 0; }
      else{
        var prev = stages[i-1].count;
        s.cvr = prev > 0 ? Math.round((s.count / prev) * 1000) / 10 : 0;
        s.drop = prev > 0 ? Math.round((1 - s.count / prev) * 1000) / 10 : 0;
      }
    });
    return stages;
  }

  // Build dimension breakdowns
  function p6FunnelDimensions(){
    var sends = S.sendRecords || [];
    // By category
    var byCat = {};
    sends.forEach(function(r){
      var c = r.category || '未分类';
      if(!byCat[c]) byCat[c] = [];
      byCat[c].push(r);
    });
    // By account
    var byAcc = {};
    sends.forEach(function(r){
      var a = r.account || r.emailAccount || r.fromAccount || '默认账号';
      if(!byAcc[a]) byAcc[a] = [];
      byAcc[a].push(r);
    });
    // By month (last 6 months)
    var now = new Date();
    var months = [];
    for(var i=5;i>=0;i--){
      var d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      months.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));
    }
    var byMonth = {};
    months.forEach(function(m){ byMonth[m] = []; });
    sends.forEach(function(r){
      if(!r.sentAt) return;
      var d = new Date(r.sentAt);
      if(isNaN(d.getTime())) return;
      var k = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
      if(byMonth[k]) byMonth[k].push(r);
    });
    return { byCategory: byCat, byAccount: byAcc, byMonth: byMonth, monthKeys: months };
  }

  // Rule-based AI optimization suggestion (no API call, fast)
  function p6WorstStageSuggestion(stages){
    // Find stage with lowest cvr (skip first which is always 100%)
    var worst = null;
    for(var i=1;i<stages.length;i++){
      var s = stages[i];
      if(s.count === 0) continue;
      if(!worst || s.cvr < worst.cvr) worst = s;
    }
    if(!worst) return { stage: null, text: '暂无足够数据进行优化建议' };

    var text = '';
    if(worst.key === 'opened'){
      text = '打开率偏低 → 建议优化邮件标题（Subject Line）：A/B测试标题、加入个性化称呼、使用数字或悬念、控制在50字符内。';
    } else if(worst.key === 'clicked'){
      text = '点击率偏低 → 建议优化CTA和链接位置：使用醒目按钮、明确动作指令、链接放在首屏、减少干扰项。';
    } else if(worst.key === 'replied'){
      text = '回复率偏低 → 建议优化正文价值主张和个性化：突出客户痛点、加入具体案例、结尾提出一个开放式问题。';
    } else if(worst.key === 'inquired'){
      text = '询盘转化偏低 → 建议加强回复引导：主动邀请客户描述需求、提供样品/报价入口、缩短决策路径。';
    } else if(worst.key === 'quoted'){
      text = '报价转化偏低 → 建议优化报价流程：主动提供阶梯报价、说明MOQ与交期、附上公司认证与案例。';
    } else if(worst.key === 'closed'){
      text = '成交率偏低 → 建议加强商务跟进：明确付款条款、提供样品单、设定合理的跟进节奏（3-5-7天）。';
    } else if(worst.key === 'delivered'){
      text = '送达率偏低 → 建议检查邮箱信誉：清理无效地址、验证发件域名SPF/DKIM、控制发送频率。';
    } else {
      text = worst.label + ' 阶段转化率为 ' + worst.cvr + '%，建议重点优化。';
    }
    return { stage: worst.key, text: text };
  }

  // ── Renderers ─────────────────────────────────────────────

  // Score color
  function p6ScoreColor(score){
    if(score >= 85) return '#38a169';
    if(score >= 70) return '#d69e2e';
    if(score >= 50) return '#dd6b20';
    return '#e53e3e';
  }
  function p6ScoreLabel(score){
    if(score >= 85) return '优秀';
    if(score >= 70) return '良好';
    if(score >= 50) return '待改进';
    return '较差';
  }

  function p6KpiCard(label, value, sub, cls){
    return '<div class="p6-kpi '+(cls||'')+'">'
      + '<div class="p6-kpi-num">'+esc(String(value))+'</div>'
      + '<div class="p6-kpi-lbl">'+esc(label)+'</div>'
      + (sub ? '<div class="p6-kpi-sub">'+esc(sub)+'</div>' : '')
      + '</div>';
  }

  // ── Tab: Quality ─────────────────────────────────────────
  function p6RenderQualityTab(root){
    var dash = p6QualityDashboard();
    var audits = (S.p6ReplyQualityAudits||[]).slice().sort(function(a,b){
      return new Date(b.auditedAt) - new Date(a.auditedAt);
    });

    var html = '';

    // Distribution bar
    var total = dash.total || 1;
    html += '<div class="p6-panel"><div class="p6-panel-title">评分分布</div>';
    html += '<div class="p6-dist-bar">';
    html += '<div class="p6-dist-seg" style="width:'+(dash.excellent/total*100)+'%;background:#38a169" title="优秀 '+dash.excellent+'"></div>';
    html += '<div class="p6-dist-seg" style="width:'+(dash.good/total*100)+'%;background:#d69e2e" title="良好 '+dash.good+'"></div>';
    html += '<div class="p6-dist-seg" style="width:'+(dash.needs/total*100)+'%;background:#dd6b20" title="待改进 '+dash.needs+'"></div>';
    html += '<div class="p6-dist-seg" style="width:'+(dash.poor/total*100)+'%;background:#e53e3e" title="较差 '+dash.poor+'"></div>';
    html += '</div>';
    html += '<div class="p6-dist-legend">'
      + '<span><i style="background:#38a169"></i>≥85 优秀 '+dash.excellent+'</span>'
      + '<span><i style="background:#d69e2e"></i>70-84 良好 '+dash.good+'</span>'
      + '<span><i style="background:#dd6b20"></i>50-69 待改进 '+dash.needs+'</span>'
      + '<span><i style="background:#e53e3e"></i>&lt;50 较差 '+dash.poor+'</span>'
      + '</div></div>';

    // Common improvement themes
    if(dash.themes.length > 0){
      html += '<div class="p6-panel"><div class="p6-panel-title">高频改进建议 TOP5</div><ul class="p6-theme-list">';
      dash.themes.forEach(function(t){
        html += '<li><span class="p6-theme-count">×'+t.count+'</span> '+esc(t.text)+'</li>';
      });
      html += '</ul></div>';
    }

    // Trend (last 10)
    if(dash.trend.length > 1){
      html += '<div class="p6-panel"><div class="p6-panel-title">近期质检趋势（最近'+dash.trend.length+'次）</div><div class="p6-trend">';
      dash.trend.forEach(function(a){
        html += '<div class="p6-trend-point" title="'+esc(a.customerName)+' · '+p6FmtTime(a.auditedAt)+'">'
          + '<div class="p6-trend-bar" style="height:'+a.score+'%;background:'+p6ScoreColor(a.score)+'"></div>'
          + '<div class="p6-trend-num">'+a.score+'</div>'
          + '</div>';
      });
      html += '</div></div>';
    }

    // Audit list
    html += '<div class="p6-panel"><div class="p6-panel-title">质检明细（'+audits.length+'）'
      + ' <button class="btn p6-btn" onclick="p6AuditAll()">🔍 质检全部待检回复</button></div>';

    if(audits.length === 0){
      html += '<div class="p6-empty">暂无质检记录。点击右上角「质检全部待检回复」开始。</div>';
    } else {
      html += '<div class="p6-audit-list">';
      audits.forEach(function(a){
        var c = p6ScoreColor(a.score);
        html += '<div class="p6-audit-card" style="border-left:4px solid '+c+'">';
        html += '<div class="p6-audit-head">'
          + '<div class="p6-audit-who">'+esc(a.customerName)
          + ' <span class="p6-tag">'+p6FmtTime(a.auditedAt)+'</span></div>'
          + '<div class="p6-audit-score" style="color:'+c+'">'+a.score+'分 <small>'+p6ScoreLabel(a.score)+'</small></div>'
          + '</div>';
        // dimension bars
        html += '<div class="p6-dims">';
        var dimMap = [
          ['answeredAll','问题覆盖'],['valueProp','价值主张'],['cta','CTA'],
          ['tone','语气'],['grammar','语法'],['responseTime','响应时效']
        ];
        dimMap.forEach(function(pair){
          var k = pair[0], label = pair[1];
          var v;
          if(k === 'responseTime'){
            var rb = a.dimensions.responseTime;
            v = rb === 'pass' ? 100 : (rb === 'warn' ? 60 : (rb === 'fail' ? 20 : 50));
            var rbLbl = rb === 'pass' ? '≤24h' : (rb === 'warn' ? '24-48h' : (rb === 'fail' ? '>48h' : '未知'));
            html += '<div class="p6-dim-row"><span class="p6-dim-lbl">'+label+'</span>'
              + '<div class="p6-dim-bar"><div class="p6-dim-fill" style="width:'+v+'%;background:'+p6ScoreColor(v)+'"></div></div>'
              + '<span class="p6-dim-val">'+rbLbl+'</span></div>';
          } else {
            v = a.dimensions[k] || 0;
            html += '<div class="p6-dim-row"><span class="p6-dim-lbl">'+label+'</span>'
              + '<div class="p6-dim-bar"><div class="p6-dim-fill" style="width:'+v+'%;background:'+p6ScoreColor(v)+'"></div></div>'
              + '<span class="p6-dim-val">'+v+'</span></div>';
          }
        });
        html += '</div>';
        if(a.overallComment){
          html += '<div class="p6-comment">💬 '+esc(a.overallComment)+'</div>';
        }
        if(a.strengths && a.strengths.length){
          html += '<div class="p6-sw-block"><div class="p6-sw-title good">✅ 优点</div><ul>';
          a.strengths.forEach(function(s){ html += '<li>'+esc(s)+'</li>'; });
          html += '</ul></div>';
        }
        if(a.improvements && a.improvements.length){
          html += '<div class="p6-sw-block"><div class="p6-sw-title bad">🔧 改进建议</div><ul>';
          a.improvements.forEach(function(s){ html += '<li>'+esc(s)+'</li>'; });
          html += '</ul></div>';
        }
        html += '<div class="p6-audit-ops"><button class="btn p6-btn-sm" onclick="p6AuditReply(\''+esc(a.replyDraftId)+'\')">重新质检</button></div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    root.innerHTML = html;
  }

  // ── Tab: Dormant Prediction ────────────────────────────────
  function p6PriBadge(pri){
    if(pri === 'high') return '<span class="p6-pri high">🔴 高优先级</span>';
    if(pri === 'medium') return '<span class="p6-pri med">🟡 中优先级</span>';
    if(pri === 'low') return '<span class="p6-pri low">🟢 低优先级</span>';
    return '<span class="p6-pri none">未预测</span>';
  }
  function p6PriWeight(pri){
    if(pri === 'high') return 3;
    if(pri === 'medium') return 2;
    if(pri === 'low') return 1;
    return 0;
  }
  function p6StratLabel(s){
    if(s === 'new_value') return '🔄 新价值点激活';
    if(s === 'light_touch') return '🤝 轻量级问候';
    if(s === 'final_ultimatum') return '⚠️ 最后跟进';
    return '—';
  }

  function p6RenderDormantTab(root){
    var list = (S.dormantCustomers||[]).slice();
    // Sort by priority then score desc
    list.sort(function(a,b){
      var pa = a.p6WakePrediction ? a.p6WakePrediction.priority : null;
      var pb = b.p6WakePrediction ? b.p6WakePrediction.priority : null;
      var w = p6PriWeight(pb) - p6PriWeight(pa);
      if(w !== 0) return w;
      var sa = a.p6WakePrediction ? a.p6WakePrediction.score : -1;
      var sb = b.p6WakePrediction ? b.p6WakePrediction.score : -1;
      return sb - sa;
    });

    var html = '';
    html += '<div class="p6-panel"><div class="p6-panel-title">沉睡客户唤醒预测（'+list.length+'）'
      + ' <button class="btn p6-btn" onclick="p6PredictAll()" '+(p6State.predicting?'disabled':'')+'>'
      + (p6State.predicting ? '⏳ 预测中 '+p6State.predictDone+'/'+p6State.predictTotal+'：'+esc(p6State.predictingLabel) : '🔮 预测全部')
      + '</button></div>';

    if(list.length === 0){
      html += '<div class="p6-empty">暂无沉睡客户数据</div></div>';
      root.innerHTML = html;
      return;
    }

    html += '<div class="p6-dormant-list">';
    list.forEach(function(d){
      var pred = d.p6WakePrediction;
      html += '<div class="p6-dor-card">';
      html += '<div class="p6-dor-head">';
      html += '<div class="p6-dor-who">'+esc(d.customerName||'未知客户')+' '+(pred?p6PriBadge(pred.priority):p6PriBadge(null))+'</div>';
      if(pred){
        html += '<div class="p6-dor-score" style="color:'+p6ScoreColor(pred.score)+'">'+pred.score+'分</div>';
      }
      html += '</div>';
      html += '<div class="p6-dor-meta">沉睡自 '+p6FmtDate(d.dormantSince)+' · 原因：'+esc(d.reason||'—')+'</div>';

      if(pred){
        html += '<div class="p6-dor-reason">📝 '+esc(pred.reason)+'</div>';
        html += '<div class="p6-dor-strat">🎯 推荐策略：'+p6StratLabel(pred.recommendedStrategy)+'</div>';
        if(pred.strategyDetail){
          html += '<div class="p6-dor-strat-detail">'+esc(pred.strategyDetail)+'</div>';
        }
        // Wake draft
        if(d.p6WakeDraft){
          html += '<div class="p6-dor-draft">';
          html += '<div class="p6-dor-draft-title">✉️ 唤醒话术草稿（仅参考，请人工审核后手动发送）</div>';
          html += '<div class="p6-dor-draft-subject"><b>Subject:</b> '+esc(d.p6WakeDraft.subject)+'</div>';
          html += '<div class="p6-dor-draft-body">'+esc(d.p6WakeDraft.body)+'</div>';
          html += '<div class="p6-dor-draft-time">生成于 '+p6FmtTime(d.p6WakeDraft.generatedAt)+'</div>';
          html += '</div>';
        }
        // Result feedback buttons
        html += '<div class="p6-dor-ops">';
        html += '<button class="btn p6-btn-sm" onclick="p6GenWakeDraft(\''+esc(d.customerId)+'\')">✍️ 生成唤醒话术</button>';
        html += '<span class="p6-ops-label">反馈：</span>';
        html += '<button class="btn p6-btn-sm '+(d.p6WakeResult==='contacted'?'on':'')+'" onclick="p6SetWakeResult(\''+esc(d.customerId)+'\',\'contacted\')">已联系</button>';
        html += '<button class="btn p6-btn-sm '+(d.p6WakeResult==='responded'?'on':'')+'" onclick="p6SetWakeResult(\''+esc(d.customerId)+'\',\'responded\')">已回复</button>';
        html += '<button class="btn p6-btn-sm '+(d.p6WakeResult==='no_response'?'on':'')+'" onclick="p6SetWakeResult(\''+esc(d.customerId)+'\',\'no_response\')">无回应</button>';
        html += '</div>';
        if(d.p6WakeResult){
          var fbMap = { contacted:'已记录：已联系客户', responded:'✅ 模型反馈：该客户有回复，策略有效！', no_response:'模型反馈：客户未回应，可降级或停止跟进' };
          html += '<div class="p6-model-fb">📊 '+esc(fbMap[d.p6WakeResult]||'')+'</div>';
        }
      } else {
        html += '<div class="p6-dor-ops"><button class="btn p6-btn-sm" onclick="p6PredictDormant(\''+esc(d.customerId)+'\')">🔮 预测优先级</button></div>';
      }
      html += '</div>';
    });
    html += '</div></div>';
    root.innerHTML = html;
  }

  // ── Tab: Funnel ───────────────────────────────────────────
  function p6RenderFunnelTab(root){
    var dims = p6FunnelDimensions();
    var html = '';

    // Dimension selector
    html += '<div class="p6-dim-sel">';
    html += '<button class="btn p6-btn-sm '+(p6State.funnelDim==='category'?'on':'')+'" onclick="p6SetFunnelDim(\'category\')">按产品类别</button>';
    html += '<button class="btn p6-btn-sm '+(p6State.funnelDim==='account'?'on':'')+'" onclick="p6SetFunnelDim(\'account\')">按邮箱账号</button>';
    html += '<button class="btn p6-btn-sm '+(p6State.funnelDim==='month'?'on':'')+'" onclick="p6SetFunnelDim(\'month\')">按月（近6月）</button>';
    html += '</div>';

    // Build series map based on dimension
    var series = {};
    if(p6State.funnelDim === 'category') series = dims.byCategory;
    else if(p6State.funnelDim === 'account') series = dims.byAccount;
    else series = dims.byMonth;

    // Overall funnel (all sends)
    var overall = p6ComputeFunnel(S.sendRecords || []);
    var maxCount = overall[0].count || 1;
    var worst = p6WorstStageSuggestion(overall);

    html += '<div class="p6-panel"><div class="p6-panel-title">整体转化漏斗</div>';
    html += '<div class="p6-funnel">';
    overall.forEach(function(s){
      var wPct = s.count > 0 ? Math.max(4, (s.count / maxCount) * 100) : 0;
      var clickable = s.count > 0 ? 'style="cursor:pointer" onclick="p6DrillStage(\''+s.key+'\')"' : '';
      html += '<div class="p6-frow" '+clickable+'>';
      html += '<div class="p6-fbar" style="width:'+wPct+'%">';
      html += '<span class="p6-flabel">'+s.label+'</span>';
      html += '<span class="p6-fcount">'+s.count+'</span>';
      html += '</div>';
      html += '<div class="p6-fmeta">';
      if(s.key !== 'sent'){
        html += '<span class="p6-f-cvr">转化 '+s.cvr+'%</span>';
        html += '<span class="p6-f-drop">流失 '+s.drop+'%</span>';
      } else {
        html += '<span class="p6-f-cvr">基数</span>';
      }
      if(s.count === 0) html += '<span class="p6-f-empty">暂无数据</span>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';

    // Worst stage suggestion
    if(worst.stage){
      var stageLabelMap = { sent:'发送',delivered:'送达',opened:'打开',clicked:'点击',replied:'回复',inquired:'询盘',quoted:'报价',closed:'成交' };
      html += '<div class="p6-suggest"><b>⚠️ 最薄弱环节：'+stageLabelMap[worst.stage]+'</b><br>'+esc(worst.text)+'</div>';
    }
    html += '</div>';

    // Dimension comparison
    html += '<div class="p6-panel"><div class="p6-panel-title">分维度对比</div>';
    var keys = Object.keys(series);
    if(keys.length === 0){
      html += '<div class="p6-empty">暂无维度数据</div>';
    } else {
      html += '<table class="p6-table"><thead><tr><th>维度</th>';
      overall.forEach(function(s){ html += '<th>'+s.label+'</th>'; });
      html += '<th>整体转化率</th></tr></thead><tbody>';
      keys.forEach(function(k){
        var stages = p6ComputeFunnel(series[k]);
        var lastCount = stages[stages.length-1].count;
        var firstCount = stages[0].count;
        var totalCvr = firstCount > 0 ? Math.round((lastCount/firstCount)*1000)/10 : 0;
        html += '<tr><td class="p6-dim-name">'+esc(k)+'</td>';
        stages.forEach(function(s){ html += '<td>'+s.count+'</td>'; });
        html += '<td><b>'+totalCvr+'%</b></td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // Drilldown
    if(p6State.funnelStage){
      html += p6RenderDrilldown(p6State.funnelStage);
    }

    root.innerHTML = html;
  }

  function p6RenderDrilldown(stageKey){
    // Determine which customers are at this stage
    var sends = S.sendRecords || [];
    var custAtStage = {}; // customerId -> {customerName, meta}

    function collectCustomer(cid, meta){
      if(!cid) return;
      if(!custAtStage[cid]){
        var c = p6FindCustomer(cid);
        custAtStage[cid] = {
          customerId: cid,
          customerName: (c && c.company) || '未知客户',
          country: (c && c.country) || '',
          status: (c && c.status) || ''
        };
      }
      if(meta) custAtStage[cid].meta = meta;
    }

    if(stageKey === 'sent' || stageKey === 'delivered' || stageKey === 'opened' || stageKey === 'clicked'){
      sends.forEach(function(r){
        var include = false;
        if(stageKey === 'sent') include = true;
        else if(stageKey === 'delivered') include = !(r.status === 'bounced' || r.followUpStatus === 'bounced');
        else if(stageKey === 'opened') include = (r.openStatus === 'opened');
        else if(stageKey === 'clicked') include = (r.clickStatus === 'clicked');
        if(include) collectCustomer(r.customerId, r.subject || '');
      });
    } else if(stageKey === 'replied'){
      (S.inbox||[]).forEach(function(it){ collectCustomer(it.customerId, it.subject||''); });
    } else if(stageKey === 'inquired'){
      (S.inquiries||[]).forEach(function(q){ collectCustomer(q.customerId, q.status||''); });
    } else if(stageKey === 'quoted'){
      (S.quotes||[]).forEach(function(q){ collectCustomer(q.customerId, q.status||''); });
    } else if(stageKey === 'closed'){
      (S.orders||[]).forEach(function(o){ collectCustomer(o.customerId, o.status||''); });
    }

    var rows = Object.keys(custAtStage).map(function(k){ return custAtStage[k]; });
    var titleMap = { sent:'发送',delivered:'送达',opened:'打开',clicked:'点击',replied:'回复',inquired:'询盘',quoted:'报价',closed:'成交' };
    var html = '<div class="p6-panel"><div class="p6-panel-title">📋 阶段下钻：'+titleMap[stageKey]+'（'+rows.length+'个客户）'
      + ' <button class="btn p6-btn-sm" onclick="p6CloseDrill()">关闭</button></div>';
    if(rows.length === 0){
      html += '<div class="p6-empty">该阶段暂无客户</div>';
    } else {
      html += '<table class="p6-table"><thead><tr><th>客户</th><th>国家</th><th>状态</th><th>备注</th></tr></thead><tbody>';
      rows.forEach(function(r){
        html += '<tr><td>'+esc(r.customerName)+'</td><td>'+esc(r.country||'—')+'</td><td>'+esc(r.status||'—')+'</td><td>'+esc(r.meta||'')+'</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    return html;
  }

  // ── Tab switch / dimension / drilldown (global handlers) ──
  window.p6SetTab = function(t){ p6State.tab = t; p6State.funnelStage = null; renderView(); };
  window.p6SetFunnelDim = function(d){ p6State.funnelDim = d; p6State.funnelStage = null; renderView(); };
  window.p6DrillStage = function(k){ p6State.funnelStage = k; renderView(); };
  window.p6CloseDrill = function(){ p6State.funnelStage = null; renderView(); };

  // ── Main page renderer ────────────────────────────────────
  function p6RenderAnalyticsPage(root){
    // KPI cards
    var dash = p6QualityDashboard();
    var dormantList = S.dormantCustomers || [];
    var highPri = dormantList.filter(function(d){ return d.p6WakePrediction && d.p6WakePrediction.priority === 'high'; }).length;
    var overall = p6ComputeFunnel(S.sendRecords || []);
    var sentTotal = overall[0].count;
    var closedCount = overall[overall.length-1].count;
    var totalCvr = sentTotal > 0 ? Math.round((closedCount/sentTotal)*1000)/10 : 0;

    var html = '';
    html += '<div class="p6-kpis">';
    html += p6KpiCard('平均回复质检分', dash.avg, '共'+dash.total+'次质检', dash.avg>=70?'good':'warn');
    html += p6KpiCard('高优先级沉睡客户', highPri, '共'+dormantList.length+'个沉睡客户', highPri>0?'warn':'');
    html += p6KpiCard('整体成交转化率', totalCvr+'%', closedCount+'/'+sentTotal, totalCvr>=1?'good':'warn');
    html += p6KpiCard('累计发送', sentTotal, '已送达'+overall[1].count, '');
    html += '</div>';

    // Tab bar
    html += '<div class="p6-tabs">';
    html += '<button class="p6-tab '+(p6State.tab==='quality'?'on':'')+'" onclick="p6SetTab(\'quality\')">📝 回复质检</button>';
    html += '<button class="p6-tab '+(p6State.tab==='dormant'?'on':'')+'" onclick="p6SetTab(\'dormant\')">💤 沉睡预测</button>';
    html += '<button class="p6-tab '+(p6State.tab==='funnel'?'on':'')+'" onclick="p6SetTab(\'funnel\')">📈 漏斗分析</button>';
    html += '</div>';

    // Tab content container
    html += '<div id="p6TabContent"></div>';
    root.innerHTML = html;

    var tabRoot = document.getElementById('p6TabContent');
    if(p6State.tab === 'quality') p6RenderQualityTab(tabRoot);
    else if(p6State.tab === 'dormant') p6RenderDormantTab(tabRoot);
    else p6RenderFunnelTab(tabRoot);
  }

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'analyticsQuality'){
      p6RenderAnalyticsPage(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p6- prefixed, responsive) ─────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p6-empty{padding:30px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;margin:10px 0;}'
    + '.p6-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}'
    + '.p6-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.p6-kpi-num{font-size:26px;font-weight:700;color:#2d3748;}'
    + '.p6-kpi-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    + '.p6-kpi-sub{font-size:11px;color:#a0aec0;margin-top:2px;}'
    + '.p6-kpi.good .p6-kpi-num{color:#38a169;}'
    + '.p6-kpi.warn .p6-kpi-num{color:#d69e2e;}'
    + '.p6-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}'
    + '.p6-tab{padding:8px 18px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;color:#4a5568;}'
    + '.p6-tab.on{background:#3182ce;color:#fff;border-color:#3182ce;font-weight:600;}'
    + '.p6-panel{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:14px;}'
    + '.p6-panel-title{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;}'
    + '.p6-btn{font-size:12px !important;padding:6px 12px !important;}'
    + '.p6-btn-sm{font-size:11px !important;padding:4px 10px !important;}'
    + '.p6-btn-sm.on{background:#3182ce !important;color:#fff !important;}'
    // distribution
    + '.p6-dist-bar{display:flex;height:18px;border-radius:9px;overflow:hidden;background:#edf2f7;margin:8px 0;}'
    + '.p6-dist-seg{height:100%;transition:width .3s;}'
    + '.p6-dist-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#4a5568;margin-top:6px;}'
    + '.p6-dist-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:middle;}'
    // themes
    + '.p6-theme-list{margin:0;padding-left:20px;font-size:13px;color:#2d3748;}'
    + '.p6-theme-list li{margin:4px 0;}'
    + '.p6-theme-count{display:inline-block;background:#fed7d7;color:#c53030;font-size:11px;padding:1px 8px;border-radius:10px;margin-right:6px;font-weight:700;}'
    // trend
    + '.p6-trend{display:flex;align-items:flex-end;gap:6px;height:90px;padding:8px 4px;border-left:2px solid #e2e8f0;border-bottom:2px solid #e2e8f0;}'
    + '.p6-trend-point{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;}'
    + '.p6-trend-bar{width:60%;border-radius:3px 3px 0 0;min-height:2px;}'
    + '.p6-trend-num{font-size:10px;color:#718096;margin-top:2px;}'
    // audit cards
    + '.p6-audit-list{display:flex;flex-direction:column;gap:10px;}'
    + '.p6-audit-card{background:#fafbfc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;}'
    + '.p6-audit-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;}'
    + '.p6-audit-who{font-size:14px;font-weight:600;color:#2d3748;}'
    + '.p6-audit-score{font-size:20px;font-weight:700;}'
    + '.p6-audit-score small{font-size:12px;font-weight:400;margin-left:4px;}'
    + '.p6-tag{display:inline-block;font-size:11px;background:#edf2f7;color:#718096;padding:2px 8px;border-radius:10px;margin-left:6px;font-weight:400;}'
    + '.p6-dims{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 16px;margin:8px 0;}'
    + '.p6-dim-row{display:flex;align-items:center;gap:6px;font-size:12px;}'
    + '.p6-dim-lbl{width:60px;color:#718096;flex-shrink:0;}'
    + '.p6-dim-bar{flex:1;height:8px;background:#edf2f7;border-radius:4px;overflow:hidden;}'
    + '.p6-dim-fill{height:100%;border-radius:4px;}'
    + '.p6-dim-val{width:36px;text-align:right;color:#4a5568;flex-shrink:0;font-weight:600;}'
    + '.p6-comment{background:#ebf8ff;border-left:3px solid #3182ce;padding:6px 10px;font-size:12.5px;color:#2c5282;border-radius:4px;margin:6px 0;}'
    + '.p6-sw-block{margin:6px 0;font-size:12.5px;}'
    + '.p6-sw-title{font-weight:700;margin-bottom:4px;}'
    + '.p6-sw-title.good{color:#38a169;}'
    + '.p6-sw-title.bad{color:#dd6b20;}'
    + '.p6-sw-block ul{margin:4px 0;padding-left:18px;color:#4a5568;}'
    + '.p6-audit-ops{margin-top:8px;text-align:right;}'
    // dormant
    + '.p6-dormant-list{display:flex;flex-direction:column;gap:10px;}'
    + '.p6-dor-card{background:#fafbfc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;}'
    + '.p6-dor-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px;}'
    + '.p6-dor-who{font-size:14px;font-weight:600;color:#2d3748;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.p6-dor-score{font-size:20px;font-weight:700;}'
    + '.p6-pri{font-size:11px;padding:2px 10px;border-radius:10px;font-weight:600;color:#fff;}'
    + '.p6-pri.high{background:#e53e3e;}'
    + '.p6-pri.med{background:#d69e2e;}'
    + '.p6-pri.low{background:#38a169;}'
    + '.p6-pri.none{background:#a0aec0;}'
    + '.p6-dor-meta{font-size:12px;color:#718096;margin:4px 0;}'
    + '.p6-dor-reason{font-size:13px;color:#2d3748;background:#fffaf0;padding:6px 10px;border-radius:6px;margin:6px 0;}'
    + '.p6-dor-strat{font-size:13px;font-weight:600;color:#2c5282;margin:4px 0;}'
    + '.p6-dor-strat-detail{font-size:12.5px;color:#4a5568;margin:4px 0;}'
    + '.p6-dor-draft{background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:10px 12px;margin:8px 0;}'
    + '.p6-dor-draft-title{font-size:12px;font-weight:700;color:#22543d;margin-bottom:6px;}'
    + '.p6-dor-draft-subject{font-size:13px;color:#2d3748;margin-bottom:6px;}'
    + '.p6-dor-draft-body{font-size:12.5px;color:#2d3748;white-space:pre-wrap;background:#fff;border-radius:6px;padding:8px;max-height:200px;overflow:auto;}'
    + '.p6-dor-draft-time{font-size:11px;color:#718096;margin-top:4px;}'
    + '.p6-dor-ops{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;}'
    + '.p6-ops-label{font-size:12px;color:#718096;margin-left:6px;}'
    + '.p6-model-fb{font-size:12px;color:#6b46c1;background:#faf5ff;border-left:3px solid #9f7aea;padding:6px 10px;border-radius:4px;margin-top:6px;}'
    // funnel
    + '.p6-dim-sel{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;}'
    + '.p6-funnel{display:flex;flex-direction:column;gap:6px;margin:10px 0;}'
    + '.p6-frow{display:flex;align-items:center;gap:10px;}'
    + '.p6-frow:hover .p6-fbar{opacity:.9;}'
    + '.p6-fbar{background:linear-gradient(90deg,#3182ce,#63b3ed);color:#fff;padding:8px 12px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;min-width:80px;transition:width .3s;}'
    + '.p6-flabel{font-size:13px;font-weight:600;}'
    + '.p6-fcount{font-size:14px;font-weight:700;margin-left:10px;}'
    + '.p6-fmeta{display:flex;gap:10px;font-size:12px;color:#4a5568;flex-shrink:0;}'
    + '.p6-f-cvr{color:#38a169;font-weight:600;}'
    + '.p6-f-drop{color:#e53e3e;}'
    + '.p6-f-empty{color:#a0aec0;font-style:italic;}'
    + '.p6-suggest{background:#fffaf0;border-left:4px solid #ed8936;padding:10px 14px;border-radius:6px;margin-top:10px;font-size:13px;color:#7b341e;}'
    + '.p6-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;}'
    + '.p6-table th{background:#edf2f7;text-align:left;padding:8px 10px;font-weight:600;color:#4a5568;border-bottom:2px solid #e2e8f0;}'
    + '.p6-table td{padding:8px 10px;border-bottom:1px solid #edf2f7;color:#2d3748;}'
    + '.p6-table tr:hover td{background:#f7fafc;}'
    + '.p6-dim-name{font-weight:600;color:#2d3748;}'
    // Responsive
    + '@media (max-width:768px){'
    + '  .p6-kpis{grid-template-columns:repeat(2,1fr);}'
    + '  .p6-dims{grid-template-columns:1fr;}'
    + '  .p6-frow{flex-direction:column;align-items:stretch;}'
    + '  .p6-fbar{width:100% !important;}'
    + '  .p6-fmeta{justify-content:flex-start;}'
    + '  .p6-table{display:block;overflow-x:auto;}'
    + '  .p6-audit-head,.p6-dor-head{flex-direction:column;align-items:flex-start;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
