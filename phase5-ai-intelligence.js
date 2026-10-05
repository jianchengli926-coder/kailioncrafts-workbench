/* ============================================================
 * P5 Phase5 Module A: AI Intelligence (P0 features)
 * ----------------------------------------------------------------
 * Feature 1: Inquiry email AI auto-classification + intent rating
 * Feature 4: BANT / commitments / objections structured extraction
 * Feature 6: ICP behavior-signal dynamic intent score
 *
 * HARD RULE: This module NEVER sends any email / WhatsApp message.
 * It only classifies, extracts and scores. All actions are read /
 * analyze only — no outbound action.
 *
 * All new CSS classes use the p5- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  if(!Array.isArray(S.p5ClassifyHistory)) S.p5ClassifyHistory = [];

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'aiClassify',
    icon: '🏷️',
    label: 'AI分类评级',
    title: 'AI询盘分类与意向评级',
    crumb: '自动分类 · 意向评级 · 高意向置顶'
  });

  // ── Local helpers ──────────────────────────────────────────
  function p5NowISO(){ return new Date().toISOString(); }

  function p5FmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p5FmtTime(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return p5FmtDate(iso)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  function p5FindCustomer(id){
    return (S.customers||[]).find(function(x){ return x.id === id; }) || null;
  }

  function p5FindInbox(id){
    return (S.inbox||[]).find(function(x){ return x.id === id; }) || null;
  }

  // Robust JSON extraction from AI response (may be wrapped in ```json ...```)
  function p5ParseAIJSON(content){
    if(!content) return null;
    try{
      var m = content.match(/```json\s*([\s\S]*?)```/);
      if(m && m[1]) return JSON.parse(m[1]);
      m = content.match(/\{[\s\S]*\}/);
      if(m) return JSON.parse(m[0]);
      return null;
    }catch(e){
      console.warn('[p5] AI JSON parse failed:', e, content);
      return null;
    }
  }

  // Intent level sort weight: high > mid > low > unclassified
  function p5IntentWeight(level){
    if(level === '高') return 3;
    if(level === '中') return 2;
    if(level === '低') return 1;
    return 0; // unclassified
  }

  // ── Feature 1: AI Classification ───────────────────────────

  // Build classification prompt
  function p5BuildClassifyPrompt(company, subject, body){
    return '你是B2B外贸询盘分类专家。请分析以下客户邮件，输出JSON：\n'
      + '{"intentLevel":"高/中/低","type":"询价/索样/问交期/问认证/投诉/其他","urgency":"高/中/低","confidence":0-100,"summary":"一句话摘要"}\n'
      + '客户：' + company + '\n'
      + '邮件主题：' + (subject || '(无主题)') + '\n'
      + '邮件内容：' + (body || '(空)') + '\n'
      + '只输出JSON，不要其他文字。';
  }

  // Build BANT extraction prompt
  function p5BuildBantPrompt(company, body){
    return '你是B2B销售分析师。请从以下客户回复中抽取BANT信息、客户承诺和异议，输出JSON：\n'
      + '{"budget":"...","authority":"...","need":"...","timeline":"...","commitments":["承诺1","承诺2"],"objections":[{"text":"...","type":"价格/交期/认证/质量/其他"}]}\n'
      + '客户：' + company + '\n'
      + '回复内容：' + (body || '(空)') + '\n'
      + '只输出JSON。如果某项没有信息则填空字符串。commitments和objections为空数组[]。';
  }

  // Classify a single inbox item (async). Also triggers BANT extraction + signal detection.
  window.p5ClassifyItem = async function(inboxId){
    var item = p5FindInbox(inboxId);
    if(!item){ toast('未找到该邮件', 'err'); return; }

    var customer = p5FindCustomer(item.customerId);
    var company = item.customerName || (customer && customer.company) || '未知客户';

    // Show loading state on the button
    toast('AI正在分类「' + company + '」...');

    try{
      // ── Step 1: classification call ──
      var classifyPrompt = p5BuildClassifyPrompt(company, item.subject, item.body);
      var r1 = await callAI(
        [{ role: 'user', content: classifyPrompt }],
        { purpose: 'classify', timeout: 60000, temperature: 0.2, model: 'gpt-5.6-terra' }
      );

      if(r1.error){
        toast('AI分类失败：' + (r1.error || '未知错误'), 'err');
        return;
      }

      var cls = p5ParseAIJSON(r1.content);
      if(!cls){
        toast('AI返回格式异常，无法解析JSON', 'err');
        return;
      }

      // Validate & normalize classification result
      var validLevels = ['高','中','低'];
      var validTypes = ['询价','索样','问交期','问认证','投诉','其他'];
      var validUrgency = ['高','中','低'];
      var intentLevel = validLevels.indexOf(cls.intentLevel) >= 0 ? cls.intentLevel : '低';
      var type = validTypes.indexOf(cls.type) >= 0 ? cls.type : '其他';
      var urgency = validUrgency.indexOf(cls.urgency) >= 0 ? cls.urgency : '低';
      var confidence = Math.max(0, Math.min(100, parseInt(cls.confidence, 10) || 50));
      var summary = String(cls.summary || '').slice(0, 200);

      // Write classification onto the inbox item
      item.aiClassification = {
        intentLevel: intentLevel,
        type: type,
        urgency: urgency,
        confidence: confidence,
        classifiedAt: p5NowISO(),
        summary: summary
      };

      // Sync to customer profile
      if(customer){
        customer.aiIntent = intentLevel;
        customer.aiIntentSummary = summary;

        // Add timeline event
        try{
          addTimelineEvent(customer.id, 'ai_classify',
            'AI分类：' + intentLevel + '意向 · ' + type,
            summary + '（置信度' + confidence + '%）',
            { intentLevel: intentLevel, type: type, confidence: confidence }
          );
        }catch(e){ /* timeline helper may not exist */ }
      }

      // Record history
      S.p5ClassifyHistory.push({
        id: uid(),
        inboxId: inboxId,
        customerId: item.customerId,
        customerName: company,
        result: item.aiClassification,
        classifiedAt: p5NowISO()
      });

      // ── Step 2: BANT extraction (async, non-blocking on UI) ──
      try{
        var bantPrompt = p5BuildBantPrompt(company, item.body);
        var r2 = await callAI(
          [{ role: 'user', content: bantPrompt }],
          { purpose: 'bant', timeout: 60000, temperature: 0.2, model: 'gpt-5.6-terra' }
        );
        if(!r2.error && r2.content){
          var bant = p5ParseAIJSON(r2.content);
          if(bant && customer){
            p5ApplyBantToCustomer(customer, bant);
          }
        }
      }catch(e){
        console.warn('[p5] BANT extraction failed:', e);
      }

      // ── Step 3: detect behavior signals ──
      if(customer){
        p5DetectSignals(customer);
        p5CalcDynamicScore(customer);
      }

      persist();
      toast('✅ 分类完成：' + company + ' → ' + intentLevel + '意向 / ' + type);
      renderView();

    }catch(err){
      console.error('[p5] classify error:', err);
      toast('AI分类异常：' + (err.message || err), 'err');
    }
  };

  // Apply BANT result to a customer object
  function p5ApplyBantToCustomer(customer, bant){
    if(!customer) return;
    if(!customer.bant) customer.bant = {};

    customer.bant.budget = bant.budget || customer.bant.budget || '';
    customer.bant.authority = bant.authority || customer.bant.authority || '';
    customer.bant.need = bant.need || customer.bant.need || '';
    customer.bant.timeline = bant.timeline || customer.bant.timeline || '';
    customer.bant.extractedAt = p5NowISO();

    // Commitments
    if(Array.isArray(bant.commitments)){
      if(!Array.isArray(customer.commitments)) customer.commitments = [];
      bant.commitments.forEach(function(txt){
        txt = String(txt || '').trim();
        if(!txt) return;
        // dedupe by text
        var exists = customer.commitments.some(function(c){ return c.text === txt; });
        if(!exists){
          customer.commitments.push({
            id: uid(),
            text: txt,
            createdAt: p5NowISO(),
            status: 'pending'
          });
        }
      });
    }

    // Objections
    if(Array.isArray(bant.objections)){
      if(!Array.isArray(customer.objections)) customer.objections = [];
      bant.objections.forEach(function(o){
        var txt = String((o && o.text) || '').trim();
        if(!txt) return;
        var type = String((o && o.type) || '其他');
        var exists = customer.objections.some(function(x){ return x.text === txt; });
        if(!exists){
          customer.objections.push({
            id: uid(),
            text: txt,
            type: type,
            createdAt: p5NowISO(),
            resolved: false
          });
        }
      });
    }
  }

  // Batch classify all unclassified inbox items
  window.p5BatchClassify = async function(){
    var unclassified = (S.inbox||[]).filter(function(i){
      return !i.aiClassification;
    });
    if(!unclassified.length){
      toast('没有待分类的邮件（全部已分类）');
      return;
    }

    confirmDlg('将对 ' + unclassified.length + ' 封未分类邮件逐条调用AI分类，可能需要几分钟时间。是否继续？', function(){
      p5RunBatchClassify(unclassified);
    });
  };

  async function p5RunBatchClassify(list){
    toast('开始批量分类，共 ' + list.length + ' 封...');
    var ok = 0, fail = 0;

    for(var i = 0; i < list.length; i++){
      var item = list[i];
      var company = item.customerName || '客户#' + i;
      toast('分类中 (' + (i+1) + '/' + list.length + ')：' + company);

      try{
        var customer = p5FindCustomer(item.customerId);
        var prompt = p5BuildClassifyPrompt(company, item.subject, item.body);
        var r = await callAI(
          [{ role: 'user', content: prompt }],
          { purpose: 'classify_batch', timeout: 60000, temperature: 0.2, model: 'gpt-5.6-terra' }
        );
        if(r.error){ fail++; continue; }

        var cls = p5ParseAIJSON(r.content);
        if(!cls){ fail++; continue; }

        var validLevels = ['高','中','低'];
        var validTypes = ['询价','索样','问交期','问认证','投诉','其他'];
        var intentLevel = validLevels.indexOf(cls.intentLevel) >= 0 ? cls.intentLevel : '低';
        var type = validTypes.indexOf(cls.type) >= 0 ? cls.type : '其他';
        var urgency = validLevels.indexOf(cls.urgency) >= 0 ? cls.urgency : '低';
        var confidence = Math.max(0, Math.min(100, parseInt(cls.confidence,10) || 50));

        item.aiClassification = {
          intentLevel: intentLevel,
          type: type,
          urgency: urgency,
          confidence: confidence,
          classifiedAt: p5NowISO(),
          summary: String(cls.summary||'').slice(0,200)
        };

        if(customer){
          customer.aiIntent = intentLevel;
          customer.aiIntentSummary = item.aiClassification.summary;
        }

        S.p5ClassifyHistory.push({
          id: uid(), inboxId: item.id, customerId: item.customerId,
          customerName: company, result: item.aiClassification, classifiedAt: p5NowISO()
        });

        // Signals
        if(customer){
          p5DetectSignals(customer);
          p5CalcDynamicScore(customer);
        }

        ok++;
      }catch(e){
        console.warn('[p5] batch classify item failed:', e);
        fail++;
      }
    }

    persist();
    toast('批量分类完成：成功 ' + ok + ' 条，失败 ' + fail + ' 条');
    renderView();
  }

  // ── Feature 4: BANT extraction / re-extract ───────────────

  window.p5ReextractBant = async function(customerId){
    var customer = p5FindCustomer(customerId);
    if(!customer){ toast('未找到客户', 'err'); return; }

    // Gather all inbox replies for this customer as context
    var replies = (S.inbox||[]).filter(function(i){ return i.customerId === customerId; });
    if(!replies.length){
      toast('该客户还没有回复记录，无法抽取BANT', 'err');
      return;
    }
    // Concatenate latest 5 replies
    var combined = replies.slice(-5).map(function(r){
      return '[' + p5FmtDate(r.createdAt || r.receivedAt) + '] ' + (r.subject||'') + '\n' + (r.body||'');
    }).join('\n---\n');

    var company = customer.company || (customer.contact && customer.contact.name) || '未知客户';
    toast('AI正在抽取「' + company + '」的BANT信息...');

    try{
      var prompt = p5BuildBantPrompt(company, combined);
      var r = await callAI(
        [{ role: 'user', content: prompt }],
        { purpose: 'bant_extract', timeout: 60000, temperature: 0.2, model: 'gpt-5.6-terra' }
      );
      if(r.error){ toast('BANT抽取失败：' + r.error, 'err'); return; }

      var bant = p5ParseAIJSON(r.content);
      if(!bant){ toast('AI返回格式异常', 'err'); return; }

      p5ApplyBantToCustomer(customer, bant);
      persist();
      toast('✅ BANT信息已更新');
      renderView();
    }catch(e){
      console.error('[p5] bant extract error:', e);
      toast('BANT抽取异常：' + (e.message||e), 'err');
    }
  };

  // Toggle objection resolved
  window.p5ToggleObjection = function(customerId, objectionId){
    var c = p5FindCustomer(customerId);
    if(!c || !Array.isArray(c.objections)) return;
    var o = c.objections.find(function(x){ return x.id === objectionId; });
    if(!o) return;
    o.resolved = !o.resolved;
    persist();
    renderView();
  };

  // Mark commitment fulfilled / broken
  window.p5SetCommitmentStatus = function(customerId, commitmentId, status){
    var c = p5FindCustomer(customerId);
    if(!c || !Array.isArray(c.commitments)) return;
    var cm = c.commitments.find(function(x){ return x.id === commitmentId; });
    if(!cm) return;
    cm.status = status;
    persist();
    renderView();
  };

  // ── Feature 6: Behavior Signals ───────────────────────────

  // Scan a customer's inbox replies + sendRecords and append signals.
  // Dedupe: same signal type only added once (or once per day for reply_speed).
  window.p5DetectSignals = function(customer){
    if(!customer) return;
    if(!Array.isArray(customer.behaviorSignals)) customer.behaviorSignals = [];

    var signals = customer.behaviorSignals;
    var existingTypes = {};
    signals.forEach(function(s){ existingTypes[s.type] = true; });

    var newSignals = [];
    var cid = customer.id;

    // Gather inbox items for this customer
    var inboxItems = (S.inbox||[]).filter(function(i){ return i.customerId === cid; });
    // Gather send records for this customer
    var sends = (S.sendRecords||[]).filter(function(r){ return r.customerId === cid; });

    // Helper: add a signal if not already present
    function addSig(type, points, desc){
      if(existingTypes[type]) return; // dedupe by type
      existingTypes[type] = true;
      newSignals.push({
        id: uid(),
        type: type,
        points: points,
        description: desc,
        createdAt: p5NowISO()
      });
    }

    // 1. Fast reply (<1 hour between send and reply)
    if(inboxItems.length && sends.length){
      var latestSend = sends[0]; // sendRecords are unshifted (newest first)
      if(latestSend && latestSend.sentAt){
        var sendTime = new Date(latestSend.sentAt).getTime();
        var fastestReply = null;
        inboxItems.forEach(function(item){
          var rt = item.createdAt || item.receivedAt;
          if(!rt) return;
          var rtMs = new Date(rt).getTime();
          if(rtMs > sendTime){
            var diff = rtMs - sendTime;
            if(!fastestReply || diff < fastestReply) fastestReply = diff;
          }
        });
        if(fastestReply !== null && fastestReply < 3600*1000){
          addSig('reply_speed', 2, '客户在1小时内回复（' + Math.round(fastestReply/60000) + '分钟）');
        }
      }
    }

    // 2. Scan reply bodies for keywords
    inboxItems.forEach(function(item){
      var body = String(item.body || '').toLowerCase();
      if(!body) return;

      if(/price|quote|cost|报价|价格|how much|pricing/i.test(body)){
        addSig('quote_request', 3, '客户索要报价');
      }
      if(/sample|样品|free sample/i.test(body)){
        addSig('sample_request', 3, '客户索要样品');
      }
      if(/competitor|brand|other supplier|xxx|smith|银鹰|王麻子/i.test(body)){
        addSig('competitor_mention', 2, '客户提及竞品/其他品牌');
      }
      if(/delivery|lead time|交期|ship|shipping time|ETA/i.test(body)){
        addSig('delivery_question', 1, '客户询问交期');
      }
      if(/certificate|CE|BSCI|ISO|FDA|认证|compliance/i.test(body)){
        addSig('cert_question', 1, '客户询问认证');
      }
      if(/unsubscribe|不感兴趣|no longer interested|remove me/i.test(body)){
        addSig('unsubscribe', -5, '客户退订/拒绝');
      }
    });

    // 3. Email opens (sendRecords openStatus)
    var openCount = sends.filter(function(r){ return r.openStatus === 'opened' || r.openStatus === 'opened_3x'; }).length;
    if(openCount >= 3){
      addSig('email_open', 1, '客户累计打开邮件 ' + openCount + ' 次');
    }

    // 4. Link clicks
    var hasClick = sends.some(function(r){ return r.clickStatus === 'clicked'; });
    if(hasClick){
      addSig('link_click', 2, '客户点击了邮件中的链接');
    }

    // 5. No reply > 7 days
    if(sends.length && !inboxItems.length){
      var lastSend = sends[0];
      if(lastSend && lastSend.sentAt){
        var daysSince = (Date.now() - new Date(lastSend.sentAt).getTime()) / (24*3600*1000);
        if(daysSince > 7){
          addSig('no_reply', -1, '最后发送已超过7天，客户未回复');
        }
      }
    }

    // 6. Unsubscribe / no-longer-contact status
    if(customer.status === '不再联系' || customer.blacklisted || customer.unsubscribe){
      addSig('unsubscribe', -5, '客户状态为「不再联系」');
    }

    // Append new signals
    if(newSignals.length){
      customer.behaviorSignals = signals.concat(newSignals);
    }
    customer.lastSignalUpdate = p5NowISO();
  };

  // Compute dynamic intent score: base leadScore + sum of signal points, clamped 0-100
  window.p5CalcDynamicScore = function(customer){
    if(!customer) return 50;
    var base = customer.leadScore || (customer.scores && customer.scores.total) || 50;
    var bonus = 0;
    (customer.behaviorSignals || []).forEach(function(s){ bonus += (s.points || 0); });
    var score = base + bonus;
    score = Math.max(0, Math.min(100, Math.round(score)));
    customer.dynamicIntentScore = score;

    // Auto-set highIntent flag
    customer.highIntent = score >= 70;
    customer.lastSignalUpdate = p5NowISO();
    return score;
  };

  // Re-scan signals for ALL customers
  window.p5RescanAllSignals = function(){
    var list = S.customers || [];
    var cnt = 0;
    list.forEach(function(c){
      p5DetectSignals(c);
      p5CalcDynamicScore(c);
      cnt++;
    });
    persist();
    toast('已重新扫描 ' + cnt + ' 个客户的行为信号');
    renderView();
  };

  // ── Main View ─────────────────────────────────────────────
  window.viewAiClassify = function(root){
    var tab = window._p5Tab || 'classify';

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">🏷️ AI 智能分析工作台</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">询盘自动分类 · BANT结构化抽取 · 行为信号动态评分</div></div>';
    h += '</div>';

    // Tabs
    h += '<div class="p5-tabs">';
    h += p5TabBtn('classify', '🏷️ AI分类评级', tab);
    h += p5TabBtn('bant',     '📊 BANT洞察', tab);
    h += p5TabBtn('signals',  '📈 行为信号', tab);
    h += '</div>';

    if(tab === 'bant')      h += p5RenderBantTab();
    else if(tab === 'signals') h += p5RenderSignalsTab();
    else                        h += p5RenderClassifyTab();

    root.innerHTML = h;
  };

  window.p5SetTab = function(t){ window._p5Tab = t; renderView(); };

  function p5TabBtn(key, label, cur){
    return '<div class="p5-tab' + (cur===key?' on':'') + '" onclick="p5SetTab(\'' + key + '\')">' + label + '</div>';
  }

  // ── Tab 1: Classification list ─────────────────────────────
  function p5RenderClassifyTab(){
    var filterLevel = window._p5FilterLevel || 'all';
    var filterType  = window._p5FilterType  || 'all';

    // Build inbox list with classification
    var all = (S.inbox||[]).slice();

    // Stats
    var high = 0, mid = 0, low = 0, uncls = 0;
    all.forEach(function(i){
      if(!i.aiClassification){ uncls++; return; }
      var lv = i.aiClassification.intentLevel;
      if(lv === '高') high++;
      else if(lv === '中') mid++;
      else low++;
    });

    var h = '';

    // Stats cards
    h += '<div class="p5-stats">';
    h += '<div class="p5-stat p5-stat-high"><div class="p5-stat-num">' + high + '</div><div class="p5-stat-lbl">🔥 高意向</div></div>';
    h += '<div class="p5-stat p5-stat-mid"><div class="p5-stat-num">' + mid + '</div><div class="p5-stat-lbl">⚡ 中意向</div></div>';
    h += '<div class="p5-stat p5-stat-low"><div class="p5-stat-num">' + low + '</div><div class="p5-stat-lbl">💤 低意向</div></div>';
    h += '<div class="p5-stat p5-stat-uncls"><div class="p5-stat-num">' + uncls + '</div><div class="p5-stat-lbl">📥 未分类</div></div>';
    h += '</div>';

    // Filter bar + batch button
    h += '<div class="p5-filter-bar">';
    h += '<label>意向：</label><select class="form-control p5-sel" onchange="p5SetFilterLevel(this.value)">';
    h += '<option value="all"' + (filterLevel==='all'?' selected':'') + '>全部</option>';
    h += '<option value="高"' + (filterLevel==='高'?' selected':'') + '>高</option>';
    h += '<option value="中"' + (filterLevel==='中'?' selected':'') + '>中</option>';
    h += '<option value="低"' + (filterLevel==='低'?' selected':'') + '>低</option>';
    h += '<option value="none"' + (filterLevel==='none'?' selected':'') + '>未分类</option>';
    h += '</select>';
    h += '<label style="margin-left:12px">类型：</label><select class="form-control p5-sel" onchange="p5SetFilterType(this.value)">';
    h += '<option value="all"' + (filterType==='all'?' selected':'') + '>全部</option>';
    ['询价','索样','问交期','问认证','投诉','其他'].forEach(function(t){
      h += '<option value="' + t + '"' + (filterType===t?' selected':'') + '>' + t + '</option>';
    });
    h += '</select>';
    h += '<button class="btn btn-primary" style="margin-left:auto" onclick="p5BatchClassify()">🤖 AI批量分类（' + uncls + '条待处理）</button>';
    h += '</div>';

    // Apply filters
    var list = all.filter(function(i){
      var lv = i.aiClassification ? i.aiClassification.intentLevel : 'none';
      if(filterLevel === 'none' && i.aiClassification) return false;
      if(filterLevel !== 'all' && filterLevel !== 'none' && lv !== filterLevel) return false;
      if(filterType !== 'all' && (!i.aiClassification || i.aiClassification.type !== filterType)) return false;
      return true;
    });

    // Sort: high → mid → low → unclassified
    list.sort(function(a, b){
      var wa = p5IntentWeight(a.aiClassification && a.aiClassification.intentLevel);
      var wb = p5IntentWeight(b.aiClassification && b.aiClassification.intentLevel);
      return wb - wa;
    });

    if(!list.length){
      h += '<div class="p5-empty">没有符合条件的邮件。点击「AI批量分类」开始自动分类收件箱中的询盘。</div>';
      return h;
    }

    h += '<div class="p5-cls-list">';
    list.forEach(function(i){
      var cls = i.aiClassification;
      var lv = cls ? cls.intentLevel : null;
      var lvClass = lv === '高' ? ' high' : (lv === '中' ? ' mid' : (lv === '低' ? ' low' : ' uncls'));
      var customer = p5FindCustomer(i.customerId);

      h += '<div class="p5-cls-card' + lvClass + '">';
      h += '  <div class="p5-cls-head">';
      h += '    <div class="p5-cls-who">';
      h +=      '<span class="p5-level-badge lv-' + (lv || 'none') + '">' + (lv ? lv + '意向' : '未分类') + '</span>';
      h +=      ' <b>' + esc(i.customerName || '未知客户') + '</b>';
      h +=      ' <small>' + esc(i.country || '') + '</small>';
      h += '    </div>';
      h += '    <div class="p5-cls-actions">';
      if(cls){
        h += '  <span class="p5-tag">' + esc(cls.type) + '</span>';
        h += '  <span class="p5-tag gray">置信度 ' + cls.confidence + '%</span>';
        h += '  <span class="p5-tag gray">' + p5FmtTime(cls.classifiedAt) + '</span>';
      }
      h += '      <button class="btn btn-outline btn-sm" onclick="p5ClassifyItem(\'' + i.id + '\')">' + (cls ? '🔄 重新分类' : '🤖 AI分类') + '</button>';
      h += '    </div>';
      h += '  </div>';
      h += '  <div class="p5-cls-subject">' + esc(i.subject || '(无主题)') + '</div>';
      if(cls && cls.summary){
        h += '  <div class="p5-cls-summary">📝 ' + esc(cls.summary) + '</div>';
      }
      h += '  <div class="p5-cls-body">' + esc((i.body||'').substring(0, 200)) + ((i.body||'').length > 200 ? '...' : '') + '</div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  window.p5SetFilterLevel = function(v){ window._p5FilterLevel = v; renderView(); };
  window.p5SetFilterType  = function(v){ window._p5FilterType  = v; renderView(); };

  // ── Tab 2: BANT Insights ──────────────────────────────────
  function p5RenderBantTab(){
    // List customers who have any bant data
    var list = (S.customers||[]).filter(function(c){
      return c.bant && (c.bant.budget || c.bant.authority || c.bant.need || c.bant.timeline ||
             (c.commitments && c.commitments.length) || (c.objections && c.objections.length));
    });

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '<div class="text-sm text-muted">基于AI从客户回复中抽取的 BANT（预算/决策权/需求/时间线）+ 承诺 + 异议。在「AI分类评级」Tab 中执行分类后会自动抽取。</div>';
    h += '</div>';

    if(!list.length){
      h += '<div class="p5-empty">还没有客户拥有BANT数据。请先在「AI分类评级」Tab 中对询盘执行AI分类，系统会自动抽取BANT信息。</div>';
      return h;
    }

    h += '<div class="p5-bant-list">';
    list.forEach(function(c){
      var bant = c.bant || {};
      var commitments = c.commitments || [];
      var objections = c.objections || [];
      var expanded = window._p5BantOpen === c.id;

      h += '<div class="p5-bant-card' + (expanded?' open':'') + '">';
      h += '  <div class="p5-bant-head" onclick="p5ToggleBant(\'' + c.id + '\')">';
      h += '    <div><b>' + esc(c.company || (c.contact && c.contact.name) || '未知') + '</b>';
      h += '    <small> · ' + esc(c.country || '') + '</small></div>';
      h += '    <div style="display:flex;gap:6px;align-items:center">';
      if(commitments.length) h += '<span class="p5-tag">承诺 ' + commitments.length + '</span>';
      if(objections.length) h += '<span class="p5-tag warn">异议 ' + objections.length + '</span>';
      h += '    <span style="font-size:12px;color:#a0aec0">' + (expanded?'▲ 收起':'▼ 展开') + '</span>';
      h += '    </div>';
      h += '  </div>';

      if(expanded){
        h += '  <div class="p5-bant-body">';
        // BANT 4 cards
        h += '    <div class="p5-bant-grid">';
        h += p5BantCard('💰 Budget 预算', bant.budget);
        h += p5BantCard('👤 Authority 决策权', bant.authority);
        h += p5BantCard('🎯 Need 需求', bant.need);
        h += p5BantCard('📅 Timeline 时间线', bant.timeline);
        h += '    </div>';

        // Commitments
        h += '    <div class="p5-bant-section">';
        h += '      <div class="p5-bant-section-title">📌 客户承诺（' + commitments.length + '）';
        h += '      <button class="btn btn-outline btn-sm" style="margin-left:12px" onclick="event.stopPropagation();p5ReextractBant(\'' + c.id + '\')">🔍 重新抽取BANT</button>';
        h += '      </div>';
        if(commitments.length){
          h += '      <div class="p5-cmt-list">';
          commitments.forEach(function(cm){
            var stCls = cm.status === 'fulfilled' ? ' ok' : (cm.status === 'broken' ? ' bad' : '');
            h += '<div class="p5-cmt-item' + stCls + '">';
            h += '  <span>' + esc(cm.text) + '</span>';
            h += '  <span class="p5-cmt-ops">';
            if(cm.status === 'pending'){
              h += '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();p5SetCommitmentStatus(\'' + c.id + '\',\'' + cm.id + '\',\'fulfilled\')">✅ 已兑现</button>';
              h += '<button class="btn btn-outline btn-sm" style="color:#e53e3e" onclick="event.stopPropagation();p5SetCommitmentStatus(\'' + c.id + '\',\'' + cm.id + '\',\'broken\')">❌ 未兑现</button>';
            }else{
              h += '<span class="p5-cmt-status">' + (cm.status==='fulfilled'?'✅ 已兑现':'❌ 未兑现') + '</span>';
              h += '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();p5SetCommitmentStatus(\'' + c.id + '\',\'' + cm.id + '\',\'pending\')">↩ 重置</button>';
            }
            h += '  </span></div>';
          });
          h += '      </div>';
        }else{
          h += '      <div class="text-sm text-muted">暂无承诺记录</div>';
        }
        h += '    </div>';

        // Objections
        h += '    <div class="p5-bant-section">';
        h += '      <div class="p5-bant-section-title">⚠️ 客户异议（' + objections.length + '）</div>';
        if(objections.length){
          h += '      <div class="p5-obj-list">';
          objections.forEach(function(o){
            h += '<div class="p5-obj-item' + (o.resolved?' resolved':'') + '">';
            h += '  <span class="p5-tag">' + esc(o.type) + '</span> ';
            h += '  <span>' + esc(o.text) + '</span>';
            h += '  <span class="p5-obj-ops">';
            h += '  <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();p5ToggleObjection(\'' + c.id + '\',\'' + o.id + '\')">';
            h +=    o.resolved ? '↩ 标记未解决' : '✅ 标记已解决';
            h += '  </button></span></div>';
          });
          h += '      </div>';
        }else{
          h += '      <div class="text-sm text-muted">暂无异议记录</div>';
        }
        h += '    </div>';

        h += '  </div>';
      }
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function p5BantCard(title, val){
    return '<div class="p5-bant-card-item">'
      + '<div class="p5-bant-item-title">' + title + '</div>'
      + '<div class="p5-bant-item-val">' + (esc(val) || '<span class="text-muted">— 暂无信息</span>') + '</div>'
      + '</div>';
  }

  window.p5ToggleBant = function(cid){
    window._p5BantOpen = (window._p5BantOpen === cid) ? null : cid;
    renderView();
  };

  // ── Tab 3: Behavior Signals ───────────────────────────────
  function p5RenderSignalsTab(){
    // Compute scores for all customers
    var list = (S.customers||[]).map(function(c){
      p5DetectSignals(c);
      p5CalcDynamicScore(c);
      return c;
    });

    // Sort by dynamic score descending
    list.sort(function(a,b){
      return (b.dynamicIntentScore||0) - (a.dynamicIntentScore||0);
    });

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '<div class="text-sm text-muted">基于客户行为信号（回复速度、索价索样、打开点击、沉默退订等）动态计算的意向分。基础分 = 原有 leadScore，叠加行为加减分。金色高亮 = 高意向（≥70分）。</div>';
    h += '<button class="btn btn-primary" onclick="p5RescanAllSignals()">🔄 重新扫描所有信号</button>';
    h += '</div>';

    if(!list.length){
      h += '<div class="p5-empty">客户台账为空。</div>';
      return h;
    }

    h += '<div class="p5-signal-list">';
    list.forEach(function(c){
      var score = c.dynamicIntentScore || 0;
      var signals = c.behaviorSignals || [];
      var isHigh = score >= 70;
      var expanded = window._p5SigOpen === c.id;

      h += '<div class="p5-sig-card' + (isHigh?' high':'') + (expanded?' open':'') + '">';
      h += '  <div class="p5-sig-head" onclick="p5ToggleSig(\'' + c.id + '\')">';
      h += '    <div class="p5-sig-score' + (isHigh?' gold':'') + '">' + score + '</div>';
      h += '    <div class="p5-sig-who">';
      h += '      <b>' + esc(c.company || (c.contact && c.contact.name) || '未知') + '</b>';
      h +=      isHigh ? ' <span class="p5-high-badge">🔥 高意向</span>' : '';
      h += '      <div class="text-sm text-muted">' + esc(c.country||'') + ' · 信号 ' + signals.length + ' 条' + (c.aiIntent ? ' · AI意向：' + c.aiIntent : '') + '</div>';
      h += '    </div>';
      h += '    <span style="font-size:12px;color:#a0aec0">' + (expanded?'▲ 收起':'▼ 展开') + '</span>';
      h += '  </div>';

      if(expanded){
        h += '  <div class="p5-sig-body">';
        if(!signals.length){
          h += '<div class="text-sm text-muted" style="padding:12px">暂无行为信号。客户有回复或发送记录后会自动检测。</div>';
        }else{
          h += '<div class="p5-sig-timeline">';
          signals.slice().reverse().forEach(function(s){
            var pos = (s.points||0) >= 0;
            h += '<div class="p5-sig-item">';
            h += '  <span class="p5-sig-pts ' + (pos?'pos':'neg') + '">' + (pos?'+':'') + s.points + '</span>';
            h += '  <span class="p5-sig-desc">' + esc(s.description || s.type) + '</span>';
            h += '  <small class="p5-sig-time">' + p5FmtTime(s.createdAt) + '</small>';
            h += '</div>';
          });
          h += '</div>';
        }
        h += '  </div>';
      }
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  window.p5ToggleSig = function(cid){
    window._p5SigOpen = (window._p5SigOpen === cid) ? null : cid;
    renderView();
  };

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'aiClassify'){
      window.viewAiClassify(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p5- prefixed, responsive) ─────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p5-empty{padding:40px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.p5-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}'
    + '.p5-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.p5-stat-num{font-size:26px;font-weight:700;color:#2d3748;}'
    + '.p5-stat-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    + '.p5-stat-high .p5-stat-num{color:#e53e3e;}'
    + '.p5-stat-mid .p5-stat-num{color:#d69e2e;}'
    + '.p5-stat-low .p5-stat-num{color:#3182ce;}'
    + '.p5-stat-uncls .p5-stat-num{color:#718096;}'
    + '.p5-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}'
    + '.p5-tab{padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;color:#4a5568;}'
    + '.p5-tab.on{background:#805ad5;color:#fff;border-color:#805ad5;font-weight:600;}'
    + '.p5-filter-bar{display:flex;align-items:center;gap:6px;margin-bottom:14px;flex-wrap:wrap;font-size:13px;}'
    + '.p5-sel{width:auto !important;}'
    + '.p5-cls-list{display:flex;flex-direction:column;gap:10px;}'
    + '.p5-cls-card{background:#fff;border:1px solid #e2e8f0;border-left:4px solid #cbd5e0;border-radius:10px;padding:14px 16px;}'
    + '.p5-cls-card.high{border-left-color:#e53e3e;}'
    + '.p5-cls-card.mid{border-left-color:#d69e2e;}'
    + '.p5-cls-card.low{border-left-color:#3182ce;}'
    + '.p5-cls-card.uncls{border-left-color:#cbd5e0;}'
    + '.p5-cls-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;}'
    + '.p5-cls-who{font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.p5-cls-who small{color:#a0aec0;font-weight:400;}'
    + '.p5-cls-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}'
    + '.p5-level-badge{font-size:11px;padding:2px 10px;border-radius:10px;font-weight:600;color:#fff;}'
    + '.lv-高{background:#e53e3e;}'
    + '.lv-中{background:#d69e2e;}'
    + '.lv-低{background:#3182ce;}'
    + '.lv-none{background:#a0aec0;}'
    + '.p5-tag{font-size:11px;padding:2px 8px;border-radius:10px;background:#edf2f7;color:#4a5568;}'
    + '.p5-tag.gray{background:#e2e8f0;color:#718096;}'
    + '.p5-tag.warn{background:#fffaf0;color:#c05621;}'
    + '.p5-cls-subject{font-weight:600;font-size:13.5px;margin:4px 0;}'
    + '.p5-cls-summary{background:#f0fff4;border-left:3px solid #38a169;padding:6px 10px;font-size:12.5px;color:#22543d;border-radius:4px;margin:6px 0;}'
    + '.p5-cls-body{font-size:12.5px;color:#718096;white-space:pre-wrap;background:#f7fafc;border-radius:6px;padding:8px 10px;max-height:80px;overflow:hidden;}'
    // BANT styles
    + '.p5-bant-list{display:flex;flex-direction:column;gap:10px;}'
    + '.p5-bant-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;}'
    + '.p5-bant-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;cursor:pointer;font-size:14px;}'
    + '.p5-bant-head:hover{background:#f7fafc;}'
    + '.p5-bant-body{padding:0 16px 16px;border-top:1px solid #edf2f7;}'
    + '.p5-bant-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:14px 0;}'
    + '.p5-bant-card-item{background:#f7fafc;border-radius:8px;padding:10px 12px;}'
    + '.p5-bant-item-title{font-size:11px;font-weight:700;color:#718096;text-transform:uppercase;margin-bottom:4px;}'
    + '.p5-bant-item-val{font-size:13px;color:#2d3748;}'
    + '.p5-bant-section{margin-top:14px;}'
    + '.p5-bant-section-title{font-size:13px;font-weight:700;color:#2d3748;margin-bottom:8px;display:flex;align-items:center;}'
    + '.p5-cmt-list,.p5-obj-list{display:flex;flex-direction:column;gap:6px;}'
    + '.p5-cmt-item{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fffbeb;border:1px solid #fbd38d;border-radius:6px;padding:8px 12px;font-size:13px;}'
    + '.p5-cmt-item.ok{background:#f0fff4;border-color:#9ae6b4;}'
    + '.p5-cmt-item.bad{background:#fed7d7;border-color:#fc8181;}'
    + '.p5-cmt-ops{display:flex;gap:4px;}'
    + '.p5-cmt-status{font-size:12px;font-weight:600;}'
    + '.p5-obj-item{display:flex;align-items:center;gap:8px;background:#fff5f5;border:1px solid #feb2b2;border-radius:6px;padding:8px 12px;font-size:13px;}'
    + '.p5-obj-item.resolved{opacity:.5;text-decoration:line-through;}'
    + '.p5-obj-ops{margin-left:auto;}'
    // Signal styles
    + '.p5-signal-list{display:flex;flex-direction:column;gap:8px;}'
    + '.p5-sig-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;}'
    + '.p5-sig-card.high{border:2px solid #d69e2e;}'
    + '.p5-sig-head{display:flex;align-items:center;gap:14px;padding:12px 16px;cursor:pointer;}'
    + '.p5-sig-head:hover{background:#f7fafc;}'
    + '.p5-sig-score{width:48px;height:48px;border-radius:50%;background:#edf2f7;color:#4a5568;font-size:18px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;}'
    + '.p5-sig-score.gold{background:linear-gradient(135deg,#f6e05e,#d69e2e);color:#fff;}'
    + '.p5-sig-who{flex:1;font-size:14px;}'
    + '.p5-high-badge{font-size:11px;background:#d69e2e;color:#fff;padding:2px 8px;border-radius:10px;margin-left:6px;}'
    + '.p5-sig-body{border-top:1px solid #edf2f7;padding:12px 16px;}'
    + '.p5-sig-timeline{display:flex;flex-direction:column;gap:6px;}'
    + '.p5-sig-item{display:flex;align-items:center;gap:10px;font-size:13px;}'
    + '.p5-sig-pts{font-weight:700;width:36px;text-align:center;}'
    + '.p5-sig-pts.pos{color:#38a169;}'
    + '.p5-sig-pts.neg{color:#e53e3e;}'
    + '.p5-sig-desc{flex:1;color:#2d3748;}'
    + '.p5-sig-time{color:#a0aec0;font-size:11px;}'
    // Responsive
    + '@media (max-width:768px){'
    + '  .p5-stats{grid-template-columns:repeat(2,1fr);}'
    + '  .p5-bant-grid{grid-template-columns:1fr;}'
    + '  .p5-filter-bar{flex-direction:column;align-items:flex-start;}'
    + '  .p5-filter-bar .btn{margin-left:0;width:100%;}'
    + '  .p5-cls-head{flex-direction:column;align-items:flex-start;}'
    + '  .p5-sig-head{flex-wrap:wrap;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
