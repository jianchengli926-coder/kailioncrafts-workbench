/* ============================================================
 * Customer Development Reply Management (customer-dev-reply.js)
 * ----------------------------------------------------------------
 * Phase 4.2 — Customer Reply Management & AI Reply Drafts
 *   - 12 intent classification (rule-based first, AI-enhanced)
 *   - Bilingual (EN/ZH) AI reply drafts per intent strategy
 *   - Conversation-bubble display (us left / customer right)
 *   - Manual customer reply intake (paste + add)
 *   - Inline editor + one-click copy + AI assistant panel
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Only generates content + records state.
 *   - All new CSS classes use the cd- prefix. Code comments in English.
 *   - All new fields persisted via persist().
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  (S.customers || []).forEach(function(c){
    if(!Array.isArray(c.cdConversations)) c.cdConversations = [];
    if(!Array.isArray(c.cdEmails)) c.cdEmails = [];
    if(!Array.isArray(c.cdBlockers)) c.cdBlockers = [];
  });

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'customerDevReply',
    icon: '💬',
    label: '回复管理',
    title: '客户回复与AI回复草稿',
    crumb: '12种意图识别 · 双语草稿 · 对话形式'
  });

  // ============================================================
  // Constants: 12 reply intents
  // ============================================================
  var CD_INTENTS = {
    quote:      { label:'询价',       icon:'🔍', color:'#d69e2e', hint:'问价格、MOQ、报价' },
    sample:     { label:'要样品',     icon:'📦', color:'#805ad5', hint:'要样品、样品费、样品交期' },
    leadtime:   { label:'问交期',     icon:'📅', color:'#2b6cb0', hint:'生产周期、交货时间、旺季排期' },
    certification:{label:'问认证',   icon:'📋', color:'#2f855a', hint:'FDA/LFGB/SGS/CE等' },
    factory:    { label:'问工厂',     icon:'🏭', color:'#4a5568', hint:'工厂规模、产能、验厂' },
    oem:        { label:'问定制',     icon:'🎨', color:'#d53f8c', hint:'OEM/ODM、Logo、包装定制' },
    negotiate:  { label:'议价',       icon:'💰', color:'#c05621', hint:'嫌贵、要求降价、对比竞品' },
    reject:     { label:'拒绝',       icon:'❌', color:'#c53030', hint:'明确拒绝、已有供应商、不需要' },
    hesitate:   { label:'犹豫',       icon:'🤔', color:'#718096', hint:'要考虑、和团队讨论、上级审批' },
    call:       { label:'要通话',     icon:'📞', color:'#319795', hint:'视频通话、电话沟通' },
    order:      { label:'下单意向',   icon:'✅', color:'#16a34a', hint:'要下单、要PI、要合同' },
    other:      { label:'其他',       icon:'❓', color:'#a0aec0', hint:'未分类' }
  };

  // Keyword rules (English + Chinese) for fast intent classification
  var CD_INTENT_RULES = [
    { intent:'quote',
      re:/\b(price|pricing|quote|quotation|cost|how much|fob|cif|unit price|best price|price list|询价|报价|价格|多少钱)\b/i },
    { intent:'sample',
      re:/\b(sample|free sample|send me a sample|样品|寄样|试用品)\b/i },
    { intent:'leadtime',
      re:/\b(lead ?time|delivery time|delivery date|production time|how long|when can you deliver|交期|交货|生产周期|排产)\b/i },
    { intent:'certification',
      re:/\b(fda|lfgb|sgs|ce|rohs|iso|certification|certificate|compliance|认证|检测报告)\b/i },
    { intent:'factory',
      re:/\b(factory|manufacturer|mill|workshop|capacity|annual output|audit|factory size|工厂|产能|验厂|车间)\b/i },
    { intent:'oem',
      re:/\b(oem|odm|private label|custom logo|branding|custom packaging|logo|customization|定制|代工|贴牌|logo)\b/i },
    { intent:'negotiate',
      re:/\b(too expensive|cheaper|lower price|reduce|discount|price is high|can you lower|your price|太贵|便宜|降价|贵了|议价)\b/i },
    { intent:'reject',
      re:/\b(no thank|not interested|we already have|not looking|unsubscribe|remove|no need|不需要|已有供应商|不用了|暂时不)\b/i },
    { intent:'hesitate',
      re:/\b(let me think|need to discuss|need approval|talk to my (boss|team|partner)|consider|will get back|考虑|商量|讨论|审批|上报)\b/i },
    { intent:'call',
      re:/\b(video call|zoom|skype|phone call|call me|let us talk|schedule a call|通话|视频会议|电话|zoom会议)\b/i },
    { intent:'order',
      re:/\b(place an order|ready to order|proforma invoice|pi|contract|purchase order|po\b|下单|订单|形式发票|合同|采购单)\b/i }
  ];

  // Sentiment rules
  function cdrSentimentOf(text){
    if(!text) return 'neutral';
    var t = String(text).toLowerCase();
    if(/\b(urgent|asap|immediately|rush|紧急|马上|尽快)\b/.test(t)) return 'urgent';
    if(/\b(no thank|not interested|too expensive|unsubscribe|remove|不需要|太贵|不用)\b/.test(t)) return 'negative';
    if(/\b(great|excellent|perfect|love|ready to order|please send|thank you for|很好|太好了|好的|麻烦|请发)\b/.test(t)) return 'positive';
    return 'neutral';
  }

  // ============================================================
  // Helpers
  // ============================================================
  function cdrNowISO(){ return new Date().toISOString(); }

  function cdrFindCustomer(id){
    return (S.customers || []).find(function(x){ return x.id === id; }) || null;
  }
  function cdrGetName(c){ return c.company || c.name || 'Unknown'; }

  function cdrParseJSON(content){
    if(!content) return null;
    try{
      var m = content.match(/```json\s*([\s\S]*?)```/);
      if(m && m[1]) return JSON.parse(m[1]);
      m = content.match(/\{[\s\S]*\}/);
      if(m) return JSON.parse(m[0]);
    }catch(e){}
    return null;
  }

  function cdrCopy(text, done){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ done && done(true); }).catch(function(){
        cdrFallbackCopy(text, done);
      });
    }else{ cdrFallbackCopy(text, done); }
  }
  function cdrFallbackCopy(text, done){
    try{
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      done && done(true);
    }catch(e){ done && done(false); }
  }

  function cdrDebounce(fn, ms){
    var t = null;
    return function(){
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function(){ fn.apply(self, args); }, ms);
    };
  }

  function cdrFmtTs(ts){
    if(!ts) return '';
    var d = new Date(ts);
    if(isNaN(d.getTime())) return String(ts);
    var pad = function(n){ return String(n).padStart(2,'0'); };
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
  }

  function cdrWordCount(t){ return t ? String(t).split(/\s+/).filter(Boolean).length : 0; }

  // ============================================================
  // Intent classification (rule-based first, returns synchronously)
  // ============================================================
  window.cdReplyClassifyIntent = function(text){
    if(!text) return { intent:'other', confidence:0, sentiment:'neutral', keyPoints:[] };
    var lower = String(text).toLowerCase();
    var hits = {};
    CD_INTENT_RULES.forEach(function(r){
      var m = text.match(r.re);
      if(m) hits[r.intent] = m[0];
    });
    // Priority order when multiple match: order > call > negotiate > reject > ... > other
    var priority = ['order','call','negotiate','reject','hesitate','sample','certification','factory','oem','leadtime','quote'];
    var chosen = 'other';
    for(var i=0;i<priority.length;i++){
      if(hits[priority[i]]){ chosen = priority[i]; break; }
    }
    var keyPoints = [];
    Object.keys(hits).forEach(function(k){
      keyPoints.push(CD_INTENTS[k].icon + ' ' + CD_INTENTS[k].label + ': "' + hits[k] + '"');
    });
    return {
      intent: chosen,
      confidence: Object.keys(hits).length ? (Object.keys(hits).length===1 ? 0.8 : 0.6) : 0.3,
      sentiment: cdrSentimentOf(text),
      keyPoints: keyPoints
    };
  };

  // ============================================================
  // Conversation accessors
  // ============================================================
  window.cdReplyGetConversations = function(customerId){
    var c = cdrFindCustomer(customerId);
    if(!c) return [];
    if(!Array.isArray(c.cdConversations)) c.cdConversations = [];
    // Merge: also include sent emails from c.cdEmails as virtual 'us' bubbles
    // so the timeline shows first outreach / followups even before manual logging.
    var merged = c.cdConversations.slice();
    (c.cdEmails || []).forEach(function(e){
      if(e.status !== 'sent') return;
      // Skip ai_reply drafts (they are already recorded as ai_draft conversations)
      if(e.type === 'ai_reply') return;
      // Skip if a conversation already references this emailId
      if(merged.find(function(x){ return x.emailId === e.id; })) return;
      merged.push({
        id: 'cd_conv_v_' + e.id,
        role: 'us',
        type: e.type === 'first' ? 'first_outreach' : 'followup',
        content: e.bodyEn || '',
        subject: e.subjectEn || '',
        timestamp: e.sentAt || e.updatedAt || e.createdAt,
        intent: null,
        sentiment: 'neutral',
        language: e.lang || 'en',
        emailId: e.id,
        blockers: [],
        notes: ''
      });
    });
    return merged.sort(function(a,b){
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
  };

  // Return customers that have at least one customer message without a subsequent ai_draft/our reply
  window.cdReplyGetPendingCustomers = function(){
    var out = [];
    (S.customers || []).forEach(function(c){
      var convs = (c.cdConversations || []).slice().sort(function(a,b){
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
      if(!convs.length) return;
      // Last message from customer?
      var last = convs[convs.length-1];
      if(last.role === 'customer'){
        out.push({
          id: c.id,
          company: cdrGetName(c),
          country: c.country || '',
          lastIntent: last.intent || 'other',
          lastAt: last.timestamp
        });
      }
    });
    return out;
  };

  // ============================================================
  // Add a customer reply (manual intake)
  // ============================================================
  window.cdReplyAddCustomerMessage = function(customerId, payload){
    var c = cdrFindCustomer(customerId);
    if(!c){ toast('未找到客户', 'err'); return; }
    payload = payload || {};
    var content = (payload.content || '').trim();
    if(!content){ toast('请输入客户回复内容', 'err'); return; }
    if(!Array.isArray(c.cdConversations)) c.cdConversations = [];

    // Auto-classify
    var cls = window.cdReplyClassifyIntent(content + ' ' + (payload.subject||''));

    var conv = {
      id: 'cd_conv_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
      role: 'customer',
      type: 'reply',
      content: content,
      subject: payload.subject || '',
      timestamp: cdrNowISO(),
      intent: cls.intent,
      sentiment: cls.sentiment,
      language: payload.language || 'en',
      emailId: null,
      blockers: [],
      notes: ''
    };
    c.cdConversations.push(conv);

    // Auto-run blocker analysis if module is loaded
    if(typeof window.cdBlockerAnalyze === 'function'){
      try{ window.cdBlockerAnalyze(customerId, conv.id); }catch(e){ console.warn('[cdReply] blocker analyze failed', e); }
    }

    // Auto-seed an ai_draft placeholder (will be filled by generate)
    persist();
    toast('✅ 客户回复已记录（意图：' + (CD_INTENTS[cls.intent].label) + '），可点击「生成AI回复草稿」');
    renderView();
    return conv.id;
  };

  // ============================================================
  // Intent-specific reply strategy prompt block
  // ============================================================
  function cdrStrategyBlock(intent){
    var map = {
      quote: 'Customer asks for price/quote. Do NOT quote a bottom-line price. Acknowledge, ask for specs/quantity/target price, give a price RANGE only, and promise a formal PI after details confirmed.',
      sample: 'Customer wants samples. Explain sample policy: sample cost (refundable on bulk order) + freight collect (customer courier account preferred). Emphasize sample quality. Ask for courier account / address.',
      leadtime: 'Customer asks lead time. State standard lead time, mention peak-season scheduling advice, offer split delivery option. Do NOT invent exact days unless KB confirms.',
      certification: 'Customer asks certifications. List SGS LFGB, FDA, RoHS, CE as available; offer to send copies. Be precise: do NOT claim certifications we do not have.',
      factory: 'Customer asks about factory. We work with 4 strategic manufacturing partners (family-equity model) in Yangjiang. Invite a video factory tour. Link to https://kailioncrafts.com/family-factory-ecosystem/. Do NOT claim we own factories.',
      oem: 'Customer asks OEM/ODM. Explain OEM/private-label flow: confirm specs -> artwork -> sampling -> production. Mention logo, packaging, color customization. Do NOT invent MOQ numbers; say "MOQ depends on product".',
      negotiate: 'Customer negotiates price. Do NOT drop price immediately. Reframe value (material/process/certification/service), offer MOQ tiered pricing concept, mention complimentary value-adds (marketing assets, factory video branded with their logo).',
      reject: 'Customer rejects. Accept gracefully, thank them for their time, keep the door open, no hard sell. Offer to stay in touch for future needs.',
      hesitate: 'Customer is hesitating. Lower decision threshold: offer a small trial order, provide ROI/comparison material, attach a one-pager. Do NOT push aggressively.',
      call: 'Customer wants a call. Propose available windows (China time 10:00-22:00 = GMT+8), ask their timezone, offer Zoom/Teams/WhatsApp video.',
      order: 'Customer wants to order. Congratulate warmly, send a PI template outline, confirm order details (specs, quantity, packaging, shipping terms). Ask for shipping mark / consignee info.',
      other: 'Answer their specific question professionally, then offer a relevant next step.'
    };
    return map[intent] || map.other;
  }

  // ============================================================
  // Generate AI reply draft for a customer conversation
  // ============================================================
  window.cdReplyGenerateDraft = async function(customerId, conversationId){
    var c = cdrFindCustomer(customerId);
    if(!c){ toast('未找到客户', 'err'); return; }
    if(!Array.isArray(c.cdConversations)) c.cdConversations = [];

    // Find the triggering customer message
    var custMsg = conversationId
      ? c.cdConversations.find(function(x){ return x.id === conversationId; })
      : c.cdConversations.slice().reverse().find(function(x){ return x.role === 'customer'; });
    if(!custMsg){ toast('请先添加客户回复', 'err'); return; }

    window._cdrBusy = true;
    window._cdrBusyMsg = 'AI正在生成「' + (CD_INTENTS[custMsg.intent]||CD_INTENTS.other).label + '」回复草稿…';
    renderView();

    try{
      // Build brief from history
      var hist = c.cdConversations.slice().sort(function(a,b){
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
      var histBlock = hist.slice(-6).map(function(h){
        var who = h.role === 'us' ? 'US' : 'CUSTOMER';
        return '[' + who + '] ' + (h.content||'').substring(0, 400);
      }).join('\n');

      var p = c.cdProfile || {};
      var intelBrief = '';
      if(c.cdIntel && c.cdIntel.dimensions){
        var d = c.cdIntel.dimensions;
        if(d.companyOverview && d.companyOverview.businessScope) intelBrief += 'Business: ' + d.companyOverview.businessScope + '\n';
        if(d.purchaseIntent && d.purchaseIntent.categories) intelBrief += 'Categories: ' + d.purchaseIntent.categories + '\n';
        if(d.painPoints && d.painPoints.supplierIssues) intelBrief += 'Pain: ' + d.painPoints.supplierIssues + '\n';
      }
      if(!intelBrief) intelBrief = '(no intel)';

      var strategy = cdrStrategyBlock(custMsg.intent);
      var intentMeta = CD_INTENTS[custMsg.intent] || CD_INTENTS.other;

      var prompt = ''
        + 'You are Leo Li, founder of KaiLionCrafts (阳江市锴利国际贸易有限公司), a Yangjiang-based knife & scissors sourcing partner working with 4 strategic family-equity factories.\n\n'
        + '=== CUSTOMER ===\n'
        + 'Company: ' + cdrGetName(c) + '\n'
        + 'Country: ' + (c.country || '-') + '\n'
        + 'Contact: ' + (c.contact && c.contact.name ? c.contact.name : '-') + '\n'
        + 'Products: ' + (c.mainProducts || c.products || '-') + '\n'
        + 'Intel: ' + intelBrief + '\n\n'
        + '=== CONVERSATION HISTORY (last exchanges) ===\n' + histBlock + '\n\n'
        + '=== CUSTOMER LATEST REPLY ===\n'
        + 'Subject: ' + (custMsg.subject||'(no subject)') + '\n'
        + 'Body: ' + (custMsg.content||'') + '\n\n'
        + '=== DETECTED INTENT ===\n'
        + 'Intent: ' + intentMeta.label + ' (' + custMsg.intent + ')\n'
        + 'Sentiment: ' + custMsg.sentiment + '\n\n'
        + '=== REPLY STRATEGY (follow this strictly) ===\n' + strategy + '\n\n'
        + '=== FACT RULES ===\n'
        + '- Do NOT invent MOQ, prices, lead times, certifications, factory size, export counts, customer cases.\n'
        + '- We do NOT own factories; we work with 4 strategic manufacturing partners in Yangjiang.\n'
        + '- Forbidden English words: free, 100%, guarantee, best, cheapest, amazing, perfect, urgent, act now, limited time, click here, discount, sale, offer, special, deal, save, cheap.\n'
        + '- Keep it B2B professional, concise (120-200 words body).\n'
        + '- Signature block (keep exactly, in English even for ZH body):\n'
        + 'Best regards,\nLeo Li\nKaiLionCrafts\nWhatsApp: +86 131-3800-6564\nWeb: https://kailioncrafts.com\n\n'
        + '=== OUTPUT FORMAT — STRICT JSON, NO MARKDOWN, NO EXTRA TEXT ===\n'
        + '{\n'
        + '  "subjectEn": "reply subject in English (e.g. Re: ...)",\n'
        + '  "subjectZh": "中文主题对照",\n'
        + '  "bodyEn": "full English email body INCLUDING the signature block",\n'
        + '  "bodyZh": "accurate Chinese translation of the whole email body for internal review",\n'
        + '  "strategyNote": "one short sentence on why this reply fits the intent"\n'
        + '}\n'
        + 'Return ONLY the JSON object.';

      var r = await callAI(
        [{ role:'user', content: prompt }],
        { purpose:'cd_reply_draft', temperature:0.3, context:'kaiLionOutbound', useServerRouter:true, async:false, taskType:'text', numCtx:8192 }
      );

      window._cdrBusy = false;
      if(r.error){ toast('AI生成失败：' + (r.error||''), 'err'); renderView(); return; }

      var data = cdrParseJSON(r.content);
      if(!data || !data.bodyEn){
        toast('AI返回格式异常，请重试', 'err');
        renderView();
        return;
      }

      // Store in c.cdEmails (type='ai_reply')
      var emailId = 'cd_email_' + Date.now().toString(36);
      c.cdEmails.push({
        id: emailId,
        type: 'ai_reply',
        typeLabel: 'AI回复草稿 · ' + intentMeta.label,
        subjectEn: data.subjectEn || '',
        subjectZh: data.subjectZh || '',
        bodyEn: data.bodyEn || '',
        bodyZh: data.bodyZh || '',
        lang: 'en',
        langLabel: 'English',
        tierStyle: null,
        status: 'generated',
        qualityScore: 0,
        forbiddenWords: [],
        sellingPointsUsed: [],
        linksUsed: [],
        createdAt: cdrNowISO(),
        updatedAt: cdrNowISO(),
        dateEn: '', dateZh: '',
        history: [],
        aiAssistantHistory: [],
        replyToConversationId: custMsg.id,
        strategyNote: data.strategyNote || ''
      });

      // Also record as an ai_draft conversation entry
      var draftConv = {
        id: 'cd_conv_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
        role: 'us',
        type: 'ai_draft',
        content: data.bodyEn || '',
        subject: data.subjectEn || '',
        timestamp: cdrNowISO(),
        intent: custMsg.intent,
        sentiment: 'neutral',
        language: 'en',
        emailId: emailId,
        blockers: [],
        notes: data.strategyNote || ''
      };
      c.cdConversations.push(draftConv);

      persist();
      toast('✅ AI回复草稿已生成（' + intentMeta.label + '），请审核后手动发送');
      renderView();
    }catch(e){
      window._cdrBusy = false;
      console.warn('[cdReply] generate failed:', e);
      toast('生成出错：' + (e.message||e), 'err');
      renderView();
    }
  };

  // ============================================================
  // Edit / copy / mark-sent for ai_draft emails
  // ============================================================
  window.cdReplyEdit = function(customerId, emailId, field, value){
    var c = cdrFindCustomer(customerId); if(!c) return;
    var e = (c.cdEmails||[]).find(function(x){ return x.id === emailId; });
    if(!e) return;
    e[field] = value;
    e.updatedAt = cdrNowISO();
    if(e.status === 'generated') e.status = 'edited';
    // also sync body into the conversation ai_draft entry
    var conv = (c.cdConversations||[]).find(function(x){ return x.emailId === emailId && x.type === 'ai_draft'; });
    if(conv && field === 'bodyEn') conv.content = value;
    cdrPersistDebounced();
  };
  var cdrPersistDebounced = cdrDebounce(function(){ persist(); }, 500);

  window.cdReplyCopy = function(customerId, emailId, which){
    var c = cdrFindCustomer(customerId); if(!c) return;
    var e = (c.cdEmails||[]).find(function(x){ return x.id === emailId; });
    if(!e) return;
    var text = which === 'zh'
      ? ('主题: ' + (e.subjectZh||'') + '\n\n' + (e.bodyZh||''))
      : ('Subject: ' + (e.subjectEn||'') + '\n\n' + (e.bodyEn||''));
    cdrCopy(text, function(ok){
      toast(ok ? '已复制到剪贴板（请手动发送）' : '复制失败，请手动选择', ok ? 'ok' : 'err');
    });
  };

  window.cdReplyMarkSent = function(customerId, emailId){
    var c = cdrFindCustomer(customerId); if(!c) return;
    var e = (c.cdEmails||[]).find(function(x){ return x.id === emailId; });
    if(!e) return;
    e.status = 'sent';
    e.sentAt = cdrNowISO();
    // Convert the ai_draft conversation entry to 'our reply'
    var conv = (c.cdConversations||[]).find(function(x){ return x.emailId === emailId && x.type === 'ai_draft'; });
    if(conv){ conv.type = 'reply'; conv.notes = '已手动发送'; }
    persist();
    toast('✅ 已记录为「已发送」（请手动在邮箱发送）');
    renderView();
  };

  // AI assistant: revise the draft
  window.cdReplyAssistantSend = async function(customerId, emailId){
    var c = cdrFindCustomer(customerId); if(!c) return;
    var e = (c.cdEmails||[]).find(function(x){ return x.id === emailId; });
    if(!e) return;
    var instr = (window._cdrAssistantInstr || '').trim();
    if(!instr){ toast('请输入修改指令', 'err'); return; }
    window._cdrAssistantBusy = true;
    renderView();
    try{
      var sys = 'You are a B2B email copy assistant. Rewrite the given English reply email per user instruction. Keep the signature block unchanged. Return STRICT JSON: {"bodyEn":"...","bodyZh":"...","note":"short note"}.';
      var user = 'Current subject: ' + (e.subjectEn||'') + '\n\n'
        + 'Current body:\n' + (e.bodyEn||'') + '\n\n'
        + 'Instruction: ' + instr + '\n\nReturn only JSON.';
      var r = await callAI(
        [{role:'system',content:sys},{role:'user',content:user}],
        { purpose:'cd_reply_assistant', temperature:0.4, context:'kaiLionOutbound', useServerRouter:true, async:false, taskType:'text', numCtx:4096 }
      );
      window._cdrAssistantBusy = false;
      if(r.error){ toast('AI助手失败：' + r.error, 'err'); renderView(); return; }
      var data = cdrParseJSON(r.content);
      if(!data || !data.bodyEn){ toast('AI返回格式异常', 'err'); renderView(); return; }
      window._cdrAssistantProposal = { bodyEn:data.bodyEn, bodyZh:data.bodyZh||e.bodyZh||'', note:data.note||'' };
      window._cdrAssistantInstr = '';
      renderView();
    }catch(err){
      window._cdrAssistantBusy = false;
      toast('AI助手出错：' + (err.message||err), 'err');
      renderView();
    }
  };

  window.cdReplyAssistantApply = function(customerId, emailId){
    var c = cdrFindCustomer(customerId); if(!c) return;
    var e = (c.cdEmails||[]).find(function(x){ return x.id === emailId; });
    if(!e) return;
    var p = window._cdrAssistantProposal;
    if(!p) return;
    e.history.push({ version:(e.history.length+1), subjectEn:e.subjectEn, bodyEn:e.bodyEn, timestamp:cdrNowISO() });
    e.aiAssistantHistory.push({ instruction:'(assistant)', oldBody:e.bodyEn, newBody:p.bodyEn, timestamp:cdrNowISO() });
    e.bodyEn = p.bodyEn; e.bodyZh = p.bodyZh || e.bodyZh;
    e.status = 'edited';
    // sync conversation
    var conv = (c.cdConversations||[]).find(function(x){ return x.emailId === emailId && x.type === 'ai_draft'; });
    if(conv) conv.content = p.bodyEn;
    window._cdrAssistantProposal = null;
    persist();
    toast('✅ 已应用AI修改');
    renderView();
  };
  window.cdReplyAssistantDiscard = function(){ window._cdrAssistantProposal = null; renderView(); };
  window.cdReplyQuickInstr = function(text){
    window._cdrAssistantInstr = text;
    if(window._cdrCurCid && window._cdrCurEmailId) window.cdReplyAssistantSend(window._cdrCurCid, window._cdrCurEmailId);
  };

  // Customer selector / filter
  window.cdReplySelectCustomer = function(cid){ window._cdrCurCid = cid; renderView(); };
  window.cdReplySetIntentFilter = function(it){ window._cdrIntentFilter = (window._cdrIntentFilter === it) ? null : it; renderView(); };

  // ============================================================
  // Rendering
  // ============================================================
  function cdrBubble(conv, c){
    var isUs = conv.role === 'us';
    var isDraft = conv.type === 'ai_draft';
    var cls = 'cdr-bubble ' + (isUs ? 'cdr-us' : 'cdr-customer');
    if(isDraft) cls += ' cdr-draft';
    var h = '<div class="' + cls + '">';
    // header
    h += '<div class="cdr-bubble-head">';
    h += '<span class="cdr-bubble-who">' + (isUs ? '✉️ 我方' : '📥 客户') + (isDraft ? ' <span class="cdr-draft-tag">AI草稿·待发送</span>' : '') + '</span>';
    h += '<span class="cdr-bubble-ts">' + esc(cdrFmtTs(conv.timestamp)) + '</span>';
    h += '</div>';
    // subject
    if(conv.subject){
      h += '<div class="cdr-bubble-subj">' + esc(conv.subject) + '</div>';
    }
    // intent / sentiment badges for customer messages
    if(!isUs && conv.intent){
      var im = CD_INTENTS[conv.intent] || CD_INTENTS.other;
      h += '<div class="cdr-badge-row">';
      h += '<span class="cdr-badge" style="background:'+im.color+'22;color:'+im.color+'">' + im.icon + ' ' + im.label + '</span>';
      if(conv.sentiment){
        var sc = conv.sentiment==='positive' ? '#38a169' : (conv.sentiment==='negative' ? '#c53030' : (conv.sentiment==='urgent' ? '#d69e2e' : '#718096'));
        h += '<span class="cdr-badge" style="background:'+sc+'22;color:'+sc+'">情绪: ' + conv.sentiment + '</span>';
      }
      if(Array.isArray(conv.blockers) && conv.blockers.length){
        h += '<span class="cdr-badge" style="background:#c5303022;color:#c53030">🚧 ' + conv.blockers.length + ' 个卡点</span>';
      }
      h += '</div>';
    }
    // content
    h += '<div class="cdr-bubble-body">' + esc(conv.content||'') + '</div>';

    // If this is an ai_draft, show the full editor panel
    if(isDraft && conv.emailId){
      var e = (c.cdEmails||[]).find(function(x){ return x.id === conv.emailId; });
      if(e){
        h += cdrRenderDraftEditor(c, e);
      }
    }
    h += '</div>';
    return h;
  }

  function cdrRenderDraftEditor(c, e){
    window._cdrCurCid = c.id;
    window._cdrCurEmailId = e.id;
    var h = '<div class="cdr-editor">';
    // subject
    h += '<div class="cdr-edit-row"><label class="cdr-edit-label">发送版主题</label>'
      + '<input class="cd-input" value="' + esc(e.subjectEn||'') + '" oninput="cdReplyEdit(\'' + c.id + '\',\'' + e.id + '\',\'subjectEn\',this.value)"></div>';
    h += '<div class="cdr-edit-row"><label class="cdr-edit-label">中文主题</label>'
      + '<input class="cd-input" value="' + esc(e.subjectZh||'') + '" oninput="cdReplyEdit(\'' + c.id + '\',\'' + e.id + '\',\'subjectZh\',this.value)"></div>';
    // body EN + ZH
    h += '<div class="cdr-editor-flex">';
    h += '<div class="cdr-mail-pane"><div class="cdr-mail-head">📤 发送版（EN） <span class="cd-wc">' + cdrWordCount(e.bodyEn) + ' 词</span>'
      + '<span class="cdr-mail-actions"><button class="btn btn-outline btn-sm" onclick="cdReplyCopy(\'' + c.id + '\',\'' + e.id + '\',\'en\')">📋 复制</button></span></div>';
    h += '<textarea class="cd-ta" rows="10" oninput="cdReplyEdit(\'' + c.id + '\',\'' + e.id + '\',\'bodyEn\',this.value)">' + esc(e.bodyEn||'') + '</textarea>';
    h += '</div>';
    h += '<div class="cdr-mail-pane"><div class="cdr-mail-head">📝 中文对照 <span class="cd-wc">' + ((e.bodyZh||'').replace(/\s/g,'').length) + ' 字</span>'
      + '<span class="cdr-mail-actions"><button class="btn btn-outline btn-sm" onclick="cdReplyCopy(\'' + c.id + '\',\'' + e.id + '\',\'zh\')">📋 复制</button></span></div>';
    h += '<textarea class="cd-ta cd-ta-zh" rows="10" oninput="cdReplyEdit(\'' + c.id + '\',\'' + e.id + '\',\'bodyZh\',this.value)">' + esc(e.bodyZh||'') + '</textarea>';
    h += '</div>';
    h += '</div>'; // /editor-flex

    // Actions
    h += '<div class="cdr-actions">';
    if(e.status !== 'sent'){
      h += '<button class="btn btn-success btn-sm" onclick="cdReplyMarkSent(\'' + c.id + '\',\'' + e.id + '\')">✅ 标记已回复（手动发送）</button>';
    }else{
      h += '<span class="cdr-badge" style="background:#38a16922;color:#38a169">已发送</span>';
    }
    h += '<button class="btn btn-outline btn-sm" onclick="cdReplyToggleAssistant()">🤖 AI助手修改</button>';
    h += '</div>';

    // AI assistant panel
    h += cdrRenderAssistant(c, e);

    h += '</div>';
    return h;
  }

  function cdrRenderAssistant(c, e){
    var open = window._cdrAssistantOpen === true;
    if(!open) return '';
    var h = '<div class="cd-assistant open">';
    h += '<div class="cd-assistant-head" onclick="cdReplyToggleAssistant()">🤖 AI助手修改 ▲</div>';
    h += '<div class="cd-assistant-body">';
    h += '<div class="cd-quick">';
    ['更正式','更简短','加一句价值点','换个角度','检查语法'].forEach(function(q){
      h += '<button class="cd-quick-btn" onclick="cdReplyQuickInstr(\'' + q + '\')">' + q + '</button>';
    });
    h += '</div>';
    h += '<textarea class="cd-ta cd-ta-assist" rows="3" placeholder="自然语言描述修改需求…" oninput="window._cdrAssistantInstr=this.value">' + esc(window._cdrAssistantInstr||'') + '</textarea>';
    h += '<button class="btn btn-primary btn-sm" onclick="cdReplyAssistantSend(\'' + c.id + '\',\'' + e.id + '\')" ' + (window._cdrAssistantBusy?'disabled':'') + '>' + (window._cdrAssistantBusy?'⏳ AI修改中…':'✨ 让AI修改') + '</button>';
    if(window._cdrAssistantProposal){
      var p = window._cdrAssistantProposal;
      h += '<div class="cd-proposal">';
      h += '<div class="cd-proposal-t">📌 AI修改预览' + (p.note ? '：' + esc(p.note) : '') + '</div>';
      h += '<div class="cd-proposal-body">' + esc(p.bodyEn) + '</div>';
      h += '<div class="cd-proposal-actions">'
        + '<button class="btn btn-primary btn-sm" onclick="cdReplyAssistantApply(\'' + c.id + '\',\'' + e.id + '\')">✅ 应用</button>'
        + '<button class="btn btn-outline btn-sm" onclick="cdReplyAssistantDiscard()">❌ 放弃</button>'
        + '</div></div>';
    }
    h += '</div></div>';
    return h;
  }
  window.cdReplyToggleAssistant = function(){ window._cdrAssistantOpen = !window._cdrAssistantOpen; renderView(); };

  // ============================================================
  // Main page
  // ============================================================
  function cdrRenderPage(root){
    var customers = S.customers || [];
    if(!customers.length){
      root.innerHTML = '<div class="cd-empty">客户台账为空。请先在「客户背调画像」页生成客户。</div>';
      return;
    }

    // Pending count (customers with last message from customer, no draft yet)
    var pending = window.cdReplyGetPendingCustomers();

    var cid = window._cdrCurCid || (pending[0] && pending[0].id) || customers[0].id;
    var c = cdrFindCustomer(cid) || customers[0];

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '<div><h2 style="margin:0">💬 客户回复管理 · AI回复草稿</h2>'
      + '<div class="text-sm text-muted" style="margin-top:4px">12种意图识别 · 中英文双语草稿 · 对话形式 · 全程不自动发送</div></div>';
    h += '<div class="cd-pending-chip" title="有客户最后一条消息尚未回复">'
      + '⏳ 待回复客户：<b>' + pending.length + '</b></div>';
    h += '</div>';

    // Customer selector
    h += '<div class="cd-selector"><label class="cd-sel-label">选择客户：</label>';
    h += '<select class="cd-sel" onchange="cdReplySelectCustomer(this.value)">';
    customers.forEach(function(x){
      var pend = pending.find(function(p){ return p.id === x.id; });
      h += '<option value="' + esc(x.id) + '"' + (x.id===c.id?' selected':'') + '>'
        + esc(cdrGetName(x)) + '（' + esc(x.country||'未知') + '）' + (pend ? ' · ⏳待回复' : '') + '</option>';
    });
    h += '</select></div>';

    // Intent filter chips
    h += '<div class="cdr-intent-filter"><span class="cdr-if-label">意图筛选：</span>';
    Object.keys(CD_INTENTS).forEach(function(k){
      var m = CD_INTENTS[k];
      var on = window._cdrIntentFilter === k;
      h += '<span class="cdr-if-chip' + (on?' on':'') + '" style="' + (on ? 'background:'+m.color+';color:#fff;border-color:'+m.color : 'color:'+m.color) + '" onclick="cdReplySetIntentFilter(\'' + k + '\')">'
        + m.icon + ' ' + m.label + '</span>';
    });
    h += '</div>';

    // Conversations
    var convs = window.cdReplyGetConversations(c.id);
    if(window._cdrIntentFilter){
      convs = convs.filter(function(x){ return x.role === 'customer' && x.intent === window._cdrIntentFilter; });
    }

    h += '<div class="cdr-conv-area">';
    if(!convs.length){
      h += '<div class="cd-empty">暂无对话记录。请在下方粘贴客户回复开始。</div>';
    }else{
      convs.forEach(function(conv){ h += cdrBubble(conv, c); });
    }
    h += '</div>';

    // Customer reply input
    h += '<div class="cdr-input-panel">';
    h += '<div class="cdr-input-title">📥 添加客户回复（手动粘贴邮件/WhatsApp原文）</div>';
    h += '<textarea id="cdrNewReply" class="cdr-input-ta" rows="4" placeholder="粘贴客户回复内容，例如：Hi Leo, thanks for your email. Could you quote me for 500 pcs of 8-inch kitchen knives?"></textarea>';
    h += '<div class="cdr-input-row">';
    h += '<input id="cdrNewReplySubj" class="cdr-input" placeholder="主题（可选，如 Re: Your Yangjiang knives）" style="flex:1">';
    h += '<select id="cdrNewReplyLang" class="cdr-input" style="max-width:140px">';
    h += '<option value="en">English</option>';
    h += '<option value="zh">中文</option>';
    h += '</select>';
    h += '<button class="btn btn-primary" onclick="cdrSubmitReply(\'' + c.id + '\')">➕ 添加客户回复</button>';
    h += '</div>';
    h += '<div class="cdr-input-hint">系统会自动识别意图（12类）+ 情绪 + 卡点，然后可一键生成AI回复草稿。</div>';
    h += '</div>';

    // Pending AI generation button (if last message is customer and no ai_draft yet)
    var sortedAll = window.cdReplyGetConversations(c.id);
    var lastMsg = sortedAll[sortedAll.length - 1];
    if(lastMsg && lastMsg.role === 'customer'){
      h += '<div class="cdr-cta-bar">';
      h += '<button class="btn btn-primary btn-lg" onclick="cdReplyGenerateDraft(\'' + c.id + '\',\'' + lastMsg.id + '\')" ' + (window._cdrBusy?'disabled':'') + '>'
        + (window._cdrBusy ? '⏳ ' + esc(window._cdrBusyMsg||'生成中…') : '🤖 针对该回复生成AI双语草稿（' + (CD_INTENTS[lastMsg.intent]||CD_INTENTS.other).label + '）')
        + '</button>';
      h += '</div>';
    }

    h += '<div class="cd-footer-bar"><span class="cd-hint">🔒 本工作台只生成内容，不自动发送邮件/WhatsApp。请复制草稿到企业邮箱手动发送。</span></div>';

    root.innerHTML = h;
  }

  window.cdrSubmitReply = function(cid){
    var ta = document.getElementById('cdrNewReply');
    var sub = document.getElementById('cdrNewReplySubj');
    var lang = document.getElementById('cdrNewReplyLang');
    if(!ta) return;
    window.cdReplyAddCustomerMessage(cid, {
      content: ta.value,
      subject: sub ? sub.value : '',
      language: lang ? lang.value : 'en'
    });
  };

  // ── renderView interception ───────────────────────────────
  var _cdrOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'customerDevReply'){
      cdRRenderPageSafe(document.getElementById('mainContent'));
      return;
    }
    _cdrOrigRV.apply(this, arguments);
  };
  function cdRRenderPageSafe(root){
    if(!root) return;
    try{ cdrRenderPage(root); }
    catch(e){ console.warn('[cdReply] render error', e); root.innerHTML = '<div class="cd-empty">渲染出错：' + esc(e.message||e) + '</div>'; }
  }

  // ── Styles ───────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.cdr-badge{font-size:11px;font-weight:600;padding:2px 9px;border-radius:10px;display:inline-block;margin-right:4px;}'
    + '.cd-pending-chip{background:#fefcbf;padding:6px 12px;border-radius:14px;font-size:13px;color:#975a16;}'
    // intent filter
    + '.cdr-intent-filter{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:14px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;}'
    + '.cdr-if-label{font-size:12.5px;color:#4a5568;font-weight:600;}'
    + '.cdr-if-chip{font-size:12px;padding:3px 10px;border:1px solid #e2e8f0;border-radius:12px;cursor:pointer;background:#fff;}'
    + '.cdr-if-chip.on{font-weight:700;}'
    // conversation area
    + '.cdr-conv-area{display:flex;flex-direction:column;gap:14px;margin-bottom:18px;}'
    + '.cdr-bubble{max-width:78%;padding:12px 16px;border-radius:14px;position:relative;box-shadow:0 1px 2px rgba(0,0,0,0.04);}'
    + '.cdr-us{align-self:flex-start;background:#ebf8ff;border:1px solid #bee3f8;color:#2a4365;border-bottom-left-radius:4px;}'
    + '.cdr-customer{align-self:flex-end;background:#fefcbf;border:1px solid #f6e05e;color:#744210;border-bottom-right-radius:4px;}'
    + '.cdr-draft{border:2px dashed #805ad5;background:#faf5ff;}'
    + '.cdr-bubble-head{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;margin-bottom:6px;opacity:0.8;}'
    + '.cdr-bubble-who{font-weight:700;}'
    + '.cdr-draft-tag{background:#805ad5;color:#fff;padding:1px 7px;border-radius:8px;margin-left:6px;font-size:10.5px;}'
    + '.cdr-bubble-ts{font-size:11px;opacity:0.7;}'
    + '.cdr-bubble-subj{font-size:12.5px;font-weight:700;margin-bottom:6px;opacity:0.85;}'
    + '.cdr-badge-row{margin:4px 0;}'
    + '.cdr-bubble-body{font-size:13.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;}'
    // draft editor
    + '.cdr-editor{margin-top:10px;background:#fff;border-radius:10px;padding:12px;border:1px solid #e2e8f0;}'
    + '.cdr-edit-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;}'
    + '.cdr-edit-label{width:110px;font-size:12px;color:#718096;font-weight:600;flex-shrink:0;}'
    + '.cd-input{flex:1;padding:6px 10px;border:1px solid #cbd5e0;border-radius:8px;font-size:13px;}'
    + '.cdr-editor-flex{display:flex;gap:10px;margin:8px 0;}'
    + '.cdr-mail-pane{flex:1;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;}'
    + '.cdr-mail-head{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#f7fafc;font-size:12.5px;font-weight:700;color:#2d3748;}'
    + '.cd-wc{font-size:11px;font-weight:400;color:#a0aec0;margin-left:auto;}'
    + '.cdr-mail-actions{display:flex;gap:6px;}'
    + '.cd-ta{width:100%;border:none;border-top:1px solid #e2e8f0;padding:10px;font-size:13px;line-height:1.7;resize:vertical;font-family:inherit;box-sizing:border-box;}'
    + '.cd-ta-zh{background:#fefcf7;}'
    + '.cdr-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}'
    // input panel
    + '.cdr-input-panel{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:14px;}'
    + '.cdr-input-title{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:10px;}'
    + '.cdr-input-ta{width:100%;border:1px solid #cbd5e0;border-radius:8px;padding:10px;font-size:13px;font-family:inherit;line-height:1.6;resize:vertical;box-sizing:border-box;margin-bottom:8px;}'
    + '.cdr-input-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}'
    + '.cdr-input-hint{font-size:11.5px;color:#a0aec0;margin-top:8px;}'
    // CTA bar
    + '.cdr-cta-bar{margin:16px 0;text-align:center;}'
    // responsive
    + '@media (max-width:800px){'
    + '  .cdr-bubble{max-width:95%;}'
    + '  .cdr-editor-flex{flex-direction:column;}'
    + '  .cdr-edit-row{flex-direction:column;align-items:stretch;}'
    + '  .cdr-edit-label{width:auto;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
