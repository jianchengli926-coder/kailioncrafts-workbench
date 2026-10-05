/* ============================================================
 * Phase 3: AI Reply Drafts + Customer Timeline
 * Pure frontend module. No SMTP / no auto-send.
 * All new CSS classes use p3- prefix.
 * Loaded AFTER app.js via <script> tag.
 * ============================================================ */
(function(){
  'use strict';

  /* ---------- 1. Lazy init S fields ---------- */
  if(!S.replyDrafts) S.replyDrafts = [];

  /* ---------- 2. Constants ---------- */
  const P3_INTENTS = {
    interested:   { label: '感兴趣',   color: '#10b981', badge: 'badge-a'  },
    quote:        { label: '需报价',   color: '#f59e0b', badge: 'badge-gold' },
    purchased:    { label: '已购买',   color: '#3b82f6', badge: 'badge-blue' },
    unsubscribe:  { label: '退订',     color: '#ef4444', badge: 'badge-red'  },
    sample:       { label: '需样品',   color: '#8b5cf6', badge: 'badge-a'    },
    other:        { label: '其他',     color: '#64748b', badge: 'badge-gray'}
  };

  const P3_CAT_LABELS = {
    outdoor_knives: '户外刀',
    kitchen_knives: '厨房刀',
    professional_scissors: '剪刀',
    kitchen_accessories: '厨房用品'
  };

  const P3_STATUS_LABELS = {
    draft:  { label: '待审核', color: '#f59e0b' },
    edited: { label: '已编辑', color: '#3b82f6' },
    sent:   { label: '已发送', color: '#10b981' }
  };

  const P3_TL_TYPES = {
    outreach:   { label: '开发信',  icon: '✉️', color: '#3b82f6' },
    open:       { label: '已打开',  icon: '👁️', color: '#8b5cf6' },
    click:      { label: '已点击',  icon: '🖱️', color: '#a855f7' },
    reply:      { label: '客户回复', icon: '📥', color: '#f59e0b' },
    followup:   { label: '跟进',    icon: '📅', color: '#06b6d4' },
    inquiry:    { label: '询盘',    icon: '💬', color: '#ec4899' },
    quote:      { label: '报价',    icon: '💰', color: '#10b981' },
    contract:   { label: '订单',    icon: '📝', color: '#16a34a' },
    ai_draft:   { label: 'AI草稿',  icon: '🤖', color: '#6366f1' },
    reply_sent: { label: '已回复',  icon: '✅', color: '#059669' },
    status:     { label: '状态变更', icon: '🔄', color: '#64748b' }
  };

  /* ---------- 3. Module-level filter state ---------- */
  let p3DraftsFilterStatus  = '全部';
  let p3DraftsFilterIntent  = '全部';
  let p3ExpandedDraftId     = null;
  let p3GeneratingInboxId   = null; // inboxId currently being generated (loading flag)

  /* ---------- 4. Push nav item ---------- */
  NAV.push({
    key: 'replyDrafts',
    icon: '💬',
    label: '回复草稿',
    title: 'AI回复草稿管理',
    crumb: '客户回复 · AI生成 · 人工审核'
  });

  /* ---------- 5. Helpers ---------- */
  function p3Now(){ return Date.now(); }

  function p3FmtTs(ts){
    if(!ts) return '-';
    const d = new Date(ts);
    if(isNaN(d.getTime())) return String(ts);
    const pad = n => String(n).padStart(2,'0');
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
  }

  function p3GetCustomer(cid){
    return (S.customers||[]).find(c=>c.id===cid);
  }

  function p3DetectLang(text){
    if(!text) return 'en';
    // If more CJK chars than Latin chars, treat as Chinese
    const cjk = (text.match(/[\u4e00-\u9fff]/g)||[]).length;
    const latin = (text.match(/[a-zA-Z]/g)||[]).length;
    return cjk > latin ? 'zh' : 'en';
  }

  function p3ClassifyIntent(inboxItem){
    const text = ((inboxItem.subject||'')+' '+(inboxItem.body||'')+' '+((inboxItem.aiSummary&&inboxItem.aiSummary.intent)||'')).toLowerCase();
    if(/unsubscribe|opt.?out|remove|取消订阅|退订|不要再发/.test(text)) return 'unsubscribe';
    if(/sample|free sample|寄样|样品|试用品/.test(text)) return 'sample';
    if(/price|quote|quotation|cost|fob|cif|报价|价格|多少钱/.test(text)) return 'quote';
    if(/order|buy|purchase|place an order|下单|已买|采购/.test(text)) return 'purchased';
    if(/interested|tell me more|more info|catalog|e-catalog|感兴趣|发资料|目录/.test(text)) return 'interested';
    return 'other';
  }

  function p3CompanyFactsLines(){
    const f = S.companyFacts || {};
    const lines = [];
    lines.push('Brand name: ' + (f.brandName || 'KaiLionCrafts'));
    lines.push('Company: ' + (f.companyName || '阳江市锴利国际贸易有限公司 (KaiLionCrafts)'));
    lines.push('Website: ' + (f.website || 'https://kailioncrafts.com'));
    if(f.moq)        lines.push('MOQ: ' + f.moq);
    if(f.leadTime)   lines.push('Lead time: ' + f.leadTime);
    if(f.certifications && f.certifications.length)
      lines.push('Certifications: ' + (Array.isArray(f.certifications) ? f.certifications.join(', ') : f.certifications));
    if(f.businessModel) lines.push('Business model: ' + f.businessModel);
    return lines.join('\n');
  }

  function p3HistoricalContext(customerId){
    const sends = (S.sendRecords||[]).filter(r=>r.customerId===customerId);
    if(!sends.length) return 'No previous outreach records found in CRM.';
    const sorted = sends.slice().sort((a,b)=>new Date(a.sentAt)-new Date(b.sentAt));
    const first = sorted[0];
    const last  = sorted[sorted.length-1];
    return [
      'Total outreach emails sent: ' + sends.length,
      'First contact: ' + p3FmtTs(first.sentAt) + ' — Subject: ' + (first.subject||''),
      'Latest outreach: ' + p3FmtTs(last.sentAt) + ' — Subject: ' + (last.subject||''),
      'Opened: ' + sends.filter(r=>r.openStatus).length + ', Clicked: ' + sends.filter(r=>r.clickStatus).length
    ].join('\n');
  }

  /* ---------- 6. Timeline event writer ---------- */
  function p3AddTimelineEvent(customerId, ev){
    const c = p3GetCustomer(customerId);
    if(!c) return;
    if(!Array.isArray(c.timeline)) c.timeline = [];
    ev.timestamp = ev.timestamp || p3Now();
    c.timeline.push(ev);
    // keep max 200 events per customer
    if(c.timeline.length > 200) c.timeline = c.timeline.slice(-200);
    c.lastInteraction = p3Now();
    persist();
  }

  /* ---------- 7. AI reply prompt builder ---------- */
  function p3BuildPrompt(inboxItem, customer){
    const intentKey = p3ClassifyIntent(inboxItem);
    const intentInfo = P3_INTENTS[intentKey] || P3_INTENTS.other;
    const catLabel  = P3_CAT_LABELS[customer && customer.productCategory] || (customer && customer.productCategory) || 'general cutlery';
    const lang = p3DetectLang((inboxItem.subject||'') + ' ' + (inboxItem.body||''));
    const contactName = (customer && customer.contact && customer.contact.name) || (customer && customer.company) || 'there';

    const strategyMap = {
      interested:  'Customer is interested and wants more info. Send a warm reply with a brief product catalog overview and invite them to ask detailed questions.',
      quote:       'Customer is asking for price/quote. Do NOT invent numbers. Acknowledge the request, ask them to confirm quantity/specs, and promise a formal quote within 24h after confirming details.',
      purchased:   'Customer mentions a past purchase. Thank them for the trust, ask for feedback, and offer accessory/refill suggestions.',
      unsubscribe: 'Customer wants to unsubscribe. Respect their request politely, confirm removal, keep the door open for future contact. Do NOT try to sell anything.',
      sample:      'Customer wants samples. Confirm sample availability, explain sample policy (sample cost + freight, refundable on bulk order), and ask for their courier account or shipping address.',
      other:       'Respond to their specific question directly and professionally, then offer a relevant next step.'
    };
    const strategy = strategyMap[intentKey] || strategyMap.other;

    const prompt = [
      'You are Leo Li, founder of KaiLionCrafts, a B2B cutlery/kitchenware supplier based in Yangjiang, China.',
      'Your task: write a professional, trustworthy reply email to a customer who just responded to your outreach.',
      '',
      '=== CUSTOMER PROFILE ===',
      'Company: ' + (customer ? (customer.company||'-') : '-'),
      'Country: ' + (customer ? (customer.country||'-') : '-'),
      'Product category of interest: ' + catLabel,
      'Contact person: ' + contactName,
      '',
      '=== HISTORICAL COMMUNICATION ===',
      p3HistoricalContext(customer ? customer.id : null),
      '',
      '=== CUSTOMER\'S LATEST EMAIL ===',
      'Subject: ' + (inboxItem.subject||''),
      'Body:',
      (inboxItem.body||''),
      '',
      '=== AI-DETECTED INTENT ===',
      'Intent category: ' + intentInfo.label + ' (' + intentKey + ')',
      'AI summary intent: ' + ((inboxItem.aiSummary&&inboxItem.aiSummary.intent)||'-'),
      'AI summary product: ' + ((inboxItem.aiSummary&&inboxItem.aiSummary.product)||'-'),
      'AI summary question: ' + ((inboxItem.aiSummary&&inboxItem.aiSummary.question)||'-'),
      'Urgency: ' + ((inboxItem.aiSummary&&inboxItem.aiSummary.urgency)||'-'),
      '',
      '=== REPLY STRATEGY ===',
      strategy,
      '',
      '=== COMPANY FACTS (use only confirmed values; do NOT invent) ===',
      p3CompanyFactsLines(),
      '',
      '=== OUTPUT REQUIREMENTS ===',
      '1. Greet: "Dear ' + contactName + '," (or "尊敬的' + contactName + '," if writing in Chinese).',
      '2. Body: directly address their question, mention 2-3 relevant product selling points for ' + catLabel + ', end with a clear CTA (request quote / request samples / schedule a video call).',
      '3. Signature: "Best regards, Leo Li | KaiLionCrafts | ' + (S.companyFacts && S.companyFacts.website ? S.companyFacts.website : 'https://kailioncrafts.com') + '"',
      '4. Language rule: The customer wrote in ' + (lang==='zh' ? 'Chinese' : 'English') + '.',
      '   -> ' + (lang==='zh'
        ? 'Write the MAIN reply in Chinese, then provide an English translation below a separator line.'
        : 'Write the MAIN reply in English, then provide a Chinese translation below a separator line.'),
      '5. Do NOT invent prices, MOQ numbers, certifications, factory size, export country counts, or client testimonials.',
      '6. Tone: professional, B2B, trustworthy, concise (under 250 words for the main reply).',
      '',
      '=== OUTPUT FORMAT (strict) ===',
      'Output exactly in this format, no extra commentary:',
      '===REPLY_START===',
      '[main reply body here]',
      '===REPLY_END===',
      '===TRANSLATION_START===',
      '[translation here]',
      '===TRANSLATION_END==='
    ].join('\n');

    return { prompt, intentKey, lang };
  }

  function p3ParseAIReply(raw){
    if(!raw) return null;
    const replyMatch = raw.match(/===REPLY_START===([\s\S]*?)===REPLY_END===/);
    const transMatch = raw.match(/===TRANSLATION_START===([\s\S]*?)===TRANSLATION_END===/);
    const body = replyMatch ? replyMatch[1].trim() : raw.trim();
    const translation = transMatch ? transMatch[1].trim() : '';
    return { body, translation };
  }

  /* ---------- 8. Core: generate AI reply ---------- */
  window.p3GenerateReply = async function(inboxId){
    const item = (S.inbox||[]).find(x=>x.id===inboxId);
    if(!item){ toast('未找到该邮件', 'err'); return; }
    if(p3GeneratingInboxId === inboxId) return;

    p3GeneratingInboxId = inboxId;
    // If we are on the inbox view, re-render to show loading
    if(currentView === 'inbox') renderView();

    try{
      const customer = p3GetCustomer(item.customerId);
      const { prompt, intentKey, lang } = p3BuildPrompt(item, customer);

      const r = await callAI([{ role:'user', content: prompt }], { purpose:'reply', timeout: 90000, temperature: 0.5 });

      p3GeneratingInboxId = null;

      if(!r.content){
        toast('AI生成失败: ' + (r.error||'未知错误'), 'err');
        if(currentView === 'inbox') renderView();
        return;
      }

      const parsed = p3ParseAIReply(r.content);
      if(!parsed){
        toast('AI返回格式异常，请重试', 'err');
        if(currentView === 'inbox') renderView();
        return;
      }

      // Create / update reply draft
      const existing = (S.replyDrafts||[]).find(d=>d.inboxId===inboxId && d.status!=='sent');
      const now = p3Now();
      if(existing){
        existing.body = parsed.body;
        existing.translation = parsed.translation;
        existing.intent = intentKey;
        existing.status = 'draft';
        existing.createdAt = now;
        existing.modelUsed = r.model || 'unknown';
      } else {
        const draft = {
          id: 'rd_' + now + '_' + Math.random().toString(36).slice(2,7),
          inboxId: inboxId,
          customerId: item.customerId,
          customerName: item.customerName,
          intent: intentKey,
          subject: 'Re: ' + (item.subject||'').replace(/^Re:\s*/i,''),
          body: parsed.body,
          translation: parsed.translation,
          status: 'draft',
          createdAt: now,
          sentAt: null,
          modelUsed: r.model || 'unknown'
        };
        S.replyDrafts.push(draft);
      }

      // Write timeline event
      p3AddTimelineEvent(item.customerId, {
        type: 'ai_draft',
        timestamp: now,
        title: 'AI生成回复草稿',
        description: '意图: ' + (P3_INTENTS[intentKey]?P3_INTENTS[intentKey].label:intentKey)
      });

      persist();
      toast('✅ AI回复草稿已生成，请人工审核后复制发送');
      if(currentView === 'inbox') renderView();
    }catch(err){
      p3GeneratingInboxId = null;
      toast('生成出错: ' + (err && err.message ? err.message : err), 'err');
      if(currentView === 'inbox') renderView();
    }
  };

  /* ---------- 9. Draft actions ---------- */
  window.p3EditDraft = function(draftId){
    // Toggle expanded editing
    p3ExpandedDraftId = (p3ExpandedDraftId === draftId) ? null : draftId;
    renderView();
  };

  window.p3SaveDraftEdit = function(draftId){
    const d = (S.replyDrafts||[]).find(x=>x.id===draftId);
    if(!d) return;
    const ta = document.getElementById('p3DraftBody_' + draftId);
    const taTr = document.getElementById('p3DraftTrans_' + draftId);
    if(ta) d.body = ta.value;
    if(taTr) d.translation = taTr.value;
    d.status = 'edited';
    persist();
    toast('已保存编辑', 'ok');
    renderView();
  };

  window.p3CopyDraft = function(draftId){
    const d = (S.replyDrafts||[]).find(x=>x.id===draftId);
    if(!d) return;
    const text = d.body + (d.translation ? '\n\n---\n' + d.translation : '');
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(()=>{
        toast('✅ 已复制到剪贴板，请粘贴到企业邮箱手动发送');
      }).catch(()=>{
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try{ document.execCommand('copy'); toast('✅ 已复制'); }catch(e){ toast('复制失败，请手动选择文本', 'err'); }
        document.body.removeChild(ta);
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); toast('✅ 已复制'); }catch(e){ toast('复制失败', 'err'); }
      document.body.removeChild(ta);
    }
  };

  window.p3MarkDraftSent = function(draftId){
    const d = (S.replyDrafts||[]).find(x=>x.id===draftId);
    if(!d) return;
    d.status = 'sent';
    d.sentAt = p3Now();

    // Update inbox item status
    const item = (S.inbox||[]).find(x=>x.id===d.inboxId);
    if(item){ item.status = '已回复'; }

    // Update customer lastInteraction
    const c = p3GetCustomer(d.customerId);
    if(c){ c.lastInteraction = p3Now(); }

    // Write timeline event
    p3AddTimelineEvent(d.customerId, {
      type: 'reply_sent',
      timestamp: p3Now(),
      title: '回复客户邮件',
      description: '主题: ' + (d.subject||'')
    });

    persist();
    toast('✅ 已标记为已发送，收件箱状态已更新');
    renderView();
  };

  window.p3RegenerateDraft = function(inboxId){
    // Remove unsent draft and regenerate
    const idx = (S.replyDrafts||[]).findIndex(d=>d.inboxId===inboxId && d.status!=='sent');
    if(idx >= 0) S.replyDrafts.splice(idx,1);
    persist();
    window.p3GenerateReply(inboxId);
  };

  /* ---------- 10. Aggregate customer timeline ---------- */
  window.p3BuildTimeline = function(customerId){
    const events = [];
    const c = p3GetCustomer(customerId);

    // Outreach emails
    (S.sendRecords||[]).filter(r=>r.customerId===customerId).forEach(r=>{
      events.push({
        type: 'outreach',
        timestamp: r.sentAt,
        title: '发送开发信',
        description: (r.subject||'')
      });
      if(r.openStatus){
        events.push({
          type: 'open',
          timestamp: r.sentAt,
          title: '邮件被打开',
          description: (r.subject||'')
        });
      }
      if(r.clickStatus){
        events.push({
          type: 'click',
          timestamp: r.sentAt,
          title: '链接被点击',
          description: (r.subject||'')
        });
      }
    });

    // Customer inbox replies
    (S.inbox||[]).filter(i=>i.customerId===customerId).forEach(i=>{
      events.push({
        type: 'reply',
        timestamp: i.receivedAt,
        title: '客户回复',
        description: (i.subject||'') + ' — ' + ((i.body||'').substring(0,120))
      });
    });

    // Follow-ups
    (S.followUps||[]).filter(f=>f.customerId===customerId).forEach(f=>{
      events.push({
        type: 'followup',
        timestamp: f.createdAt || f.timestamp || f.due,
        title: '跟进记录',
        description: f.note || f.content || f.type || ''
      });
    });

    // Inquiries
    (S.inquiries||[]).filter(q=>q.customerId===customerId).forEach(q=>{
      events.push({
        type: 'inquiry',
        timestamp: q.createdAt,
        title: '询盘创建',
        description: q.subject || (q.productCategory||'')
      });
    });

    // Quotes
    (S.quotes||[]).filter(q=>q.customerId===customerId).forEach(q=>{
      events.push({
        type: 'quote',
        timestamp: q.createdAt,
        title: '报价',
        description: q.subject || (q.id||'')
      });
    });

    // Contracts
    (S.contracts||[]).filter(ct=>ct.customerId===customerId).forEach(ct=>{
      events.push({
        type: 'contract',
        timestamp: ct.createdAt,
        title: '合同/订单',
        description: ct.subject || (ct.id||'')
      });
    });

    // AI reply drafts
    (S.replyDrafts||[]).filter(d=>d.customerId===customerId).forEach(d=>{
      events.push({
        type: 'ai_draft',
        timestamp: d.createdAt,
        title: 'AI生成回复草稿',
        description: d.subject || ''
      });
      if(d.status==='sent' && d.sentAt){
        events.push({
          type: 'reply_sent',
          timestamp: d.sentAt,
          title: '已回复客户',
          description: d.subject || ''
        });
      }
    });

    // Existing customer timeline (merged, dedup later)
    if(c && Array.isArray(c.timeline)){
      c.timeline.forEach(t=>{
        events.push({
          type: t.type || 'status',
          timestamp: t.timestamp || t.ts,
          title: t.title || (t.action||'事件'),
          description: t.description || t.detail || ''
        });
      });
    }

    // Filter invalid timestamps
    const valid = events.filter(e=>e.timestamp && !isNaN(new Date(e.timestamp).getTime()));

    // Sort desc
    valid.sort((a,b)=>new Date(b.timestamp) - new Date(a.timestamp));

    // Dedup by type+title+rounded timestamp (within 5s)
    const seen = new Set();
    return valid.filter(e=>{
      const tsKey = Math.floor(new Date(e.timestamp).getTime() / 5000);
      const key = e.type + '|' + tsKey + '|' + (e.title||'');
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  /* ---------- 11. Timeline modal viewer ---------- */
  window.p3ViewCustomerTimeline = function(customerId){
    const c = p3GetCustomer(customerId);
    if(!c){ toast('未找到客户', 'err'); return; }
    const events = window.p3BuildTimeline(customerId);

    const rows = events.length ? events.map(e=>{
      const meta = P3_TL_TYPES[e.type] || P3_TL_TYPES.status;
      return `
        <div class="p3-timeline-item">
          <div class="p3-timeline-dot" style="background:${meta.color}">${meta.icon}</div>
          <div class="p3-timeline-content">
            <div class="p3-timeline-head">
              <span class="p3-timeline-badge" style="background:${meta.color}20;color:${meta.color}">${meta.label}</span>
              <span class="p3-timeline-ts">${p3FmtTs(e.timestamp)}</span>
            </div>
            <div class="p3-timeline-title">${esc(e.title)}</div>
            <div class="p3-timeline-desc">${esc(e.description||'')}</div>
          </div>
        </div>`;
    }).join('') : '<div class="empty" style="padding:40px;text-align:center;color:#94a3b8"><div style="font-size:36px">📭</div><p>该客户暂无时间线事件</p></div>';

    openModal(`
      <div class="modal-head">
        <h3>📋 客户时间线 · ${esc(c.company||'')}</h3>
        <span class="modal-close" onclick="closeModal()">×</span>
      </div>
      <div class="modal-body" style="max-height:70vh;overflow-y:auto">
        <div class="text-sm text-muted mb16" style="padding:0 4px">
          共 ${events.length} 个事件 · 按时间倒序排列
        </div>
        <div class="p3-timeline-wrap">
          ${rows}
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-outline" onclick="closeModal()">关闭</button>
      </div>
    `, true);
  };

  /* Inject timeline button into customer detail drawer */
  function p3InjectTimelineButton(cid){
    const drawerBody = document.querySelector('.drawer-body');
    if(!drawerBody) return;
    // Avoid duplicate injection
    if(document.getElementById('p3TimelineBtn_'+cid)) return;
    const btn = document.createElement('button');
    btn.id = 'p3TimelineBtn_' + cid;
    btn.className = 'btn btn-outline btn-sm';
    btn.style.cssText = 'background:#fff;margin-top:8px;width:100%';
    btn.innerHTML = '📋 完整客户时间线';
    btn.onclick = function(){ window.p3ViewCustomerTimeline(cid); };
    drawerBody.insertBefore(btn, drawerBody.firstChild);
  }

  /* ---------- 12. View: Reply drafts management page ---------- */
  window.viewReplyDrafts = function(root){
    let list = (S.replyDrafts||[]).slice();
    if(p3DraftsFilterStatus !== '全部') list = list.filter(d=>d.status===p3DraftsFilterStatus);
    if(p3DraftsFilterIntent !== '全部') list = list.filter(d=>d.intent===p3DraftsFilterIntent);
    list.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));

    const all = S.replyDrafts||[];
    const stats = {
      total: all.length,
      draft:  all.filter(d=>d.status==='draft').length,
      edited: all.filter(d=>d.status==='edited').length,
      sent:   all.filter(d=>d.status==='sent').length
    };

    const statusOpts = [['全部','全部'],['draft','待审核'],['edited','已编辑'],['sent','已发送']];
    const intentOpts = [['全部','全部']].concat(Object.keys(P3_INTENTS).map(k=>[k, P3_INTENTS[k].label]));

    const cards = list.length ? list.map(d=>{
      const intentMeta = P3_INTENTS[d.intent] || P3_INTENTS.other;
      const statusMeta = P3_STATUS_LABELS[d.status] || P3_STATUS_LABELS.draft;
      const expanded = (p3ExpandedDraftId === d.id);
      const customer = p3GetCustomer(d.customerId);

      return `
      <div class="card card-pad mb16" style="border-left:3px solid ${statusMeta.color}">
        <div class="flex-between mb8" style="flex-wrap:wrap;gap:6px">
          <div>
            <b style="color:var(--primary)">${esc(d.customerName||customer?customer.company:'')}</b>
            <span class="text-sm text-muted"> · ${esc(customer?customer.country:'')}</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span class="badge" style="background:${intentMeta.color}20;color:${intentMeta.color}">${intentMeta.label}</span>
            <span class="badge" style="background:${statusMeta.color}20;color:${statusMeta.color}">${statusMeta.label}</span>
          </div>
        </div>
        <div class="text-sm fw700 mb8">${esc(d.subject||'')}</div>
        <div class="text-sm text-muted mb8" style="font-size:11px">
          生成于 ${p3FmtTs(d.createdAt)} ${d.sentAt?(' · 已发送 '+p3FmtTs(d.sentAt)):''} · 模型: ${esc(d.modelUsed||'-')}
        </div>
        <div class="p3-draft-preview" style="background:var(--gray-bg,#f8fafc);padding:10px;border-radius:6px;font-size:13px;line-height:1.7;white-space:pre-wrap;max-height:${expanded?'none':'100px'};overflow:hidden">${esc(d.body||'')}</div>

        ${expanded ? `
          <div class="mt16">
            <div class="text-sm fw700 mb8">回复正文（可编辑）：</div>
            <textarea id="p3DraftBody_${d.id}" class="p3-editor" rows="10" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;line-height:1.7;font-family:inherit">${esc(d.body||'')}</textarea>
            ${d.translation ? `
              <div class="text-sm fw700 mb8 mt16">翻译：</div>
              <textarea id="p3DraftTrans_${d.id}" class="p3-editor" rows="6" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;line-height:1.7;font-family:inherit;background:#f8fafc">${esc(d.translation||'')}</textarea>
            ` : ''}
          </div>
        ` : ''}

        <div class="btn-row mt16" style="flex-wrap:wrap;gap:6px">
          <button class="btn btn-outline btn-sm" onclick="p3EditDraft('${d.id}')">${expanded?'收起':'✏️ 编辑/展开'}</button>
          ${expanded ? `<button class="btn btn-primary btn-sm" onclick="p3SaveDraftEdit('${d.id}')">💾 保存编辑</button>` : ''}
          <button class="btn btn-gold btn-sm" onclick="p3CopyDraft('${d.id}')">📋 复制到剪贴板</button>
          ${d.status!=='sent' ? `<button class="btn btn-success btn-sm" onclick="p3MarkDraftSent('${d.id}')">✅ 标记已发送</button>` : '<span class="badge badge-a">已发送</span>'}
          ${d.customerId ? `<button class="btn btn-outline btn-sm" onclick="p3ViewCustomerTimeline('${d.customerId}')">📋 时间线</button>` : ''}
        </div>
      </div>`;
    }).join('') : '<div class="card"><div class="empty"><div class="big">💬</div><p>暂无回复草稿。请前往「AI 收件箱」点击「🤖 AI生成回复」按钮。</p></div></div>';

    root.innerHTML = `
      <div class="card card-pad mb16" style="background:linear-gradient(135deg,#eef2ff,#e0e7ff);border:1px solid #c7d2fe">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
          <div style="font-weight:700;color:#3730a3;font-size:15px">🤖 AI 回复草稿管理</div>
          <div class="text-sm text-muted">草稿仅保存在本地，请复制到企业邮箱手动发送 · 绝不自动发送</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
          <div style="background:#fff;padding:12px;border-radius:8px;text-align:center;border-top:3px solid #6366f1">
            <div style="font-size:22px;font-weight:800;color:#4338ca">${stats.total}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">总草稿数</div>
          </div>
          <div style="background:#fff;padding:12px;border-radius:8px;text-align:center;border-top:3px solid #f59e0b">
            <div style="font-size:22px;font-weight:800;color:#d97706">${stats.draft}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">待审核</div>
          </div>
          <div style="background:#fff;padding:12px;border-radius:8px;text-align:center;border-top:3px solid #3b82f6">
            <div style="font-size:22px;font-weight:800;color:#1d4ed8">${stats.edited}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">已编辑</div>
          </div>
          <div style="background:#fff;padding:12px;border-radius:8px;text-align:center;border-top:3px solid #10b981">
            <div style="font-size:22px;font-weight:800;color:#047857">${stats.sent}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">已发送</div>
          </div>
        </div>
      </div>

      <div class="flex gap8 mb16" style="flex-wrap:wrap;align-items:center">
        <span class="text-sm text-muted" style="font-size:12px">状态筛选:</span>
        ${statusOpts.map(([k,label])=>`<button class="btn ${p3DraftsFilterStatus===k?'btn-gold':'btn-outline'} btn-sm" onclick="p3SetDraftsFilter('status','${k}')">${label}</button>`).join('')}
        <span class="text-sm text-muted" style="font-size:12px;margin-left:8px">意图筛选:</span>
        ${intentOpts.map(([k,label])=>`<button class="btn ${p3DraftsFilterIntent===k?'btn-gold':'btn-outline'} btn-sm" onclick="p3SetDraftsFilter('intent','${k}')">${label}</button>`).join('')}
      </div>

      ${cards}
    `;
  };

  window.p3SetDraftsFilter = function(kind, val){
    if(kind === 'status') p3DraftsFilterStatus = val;
    else p3DraftsFilterIntent = val;
    p3ExpandedDraftId = null;
    renderView();
  };

  /* ---------- 13. Override viewInbox (enhanced with AI reply button) ---------- */
  window.viewInbox = function(root){
    // Use module-level filter (cannot access app.js closure inboxFilter)
    const list = (S.inbox||[]);
    const inboxStats = {
      total: list.length,
      unread: list.filter(i=>i.status==='未读').length,
      replied: list.filter(i=>i.status==='已回复').length,
      highUrgency: list.filter(i=>i.aiSummary&&i.aiSummary.urgency==='高' && i.status!=='已回复').length,
      priceInquiry: list.filter(i=>i.aiSummary&&(i.aiSummary.intent||'').match(/报价|价格|quote|price/i)).length,
      sampleRequest: list.filter(i=>i.aiSummary&&(i.aiSummary.intent||'').match(/样品|sample/i)).length
    };

    const cards = list.length ? list.map(i=>{
      const existingDraft = (S.replyDrafts||[]).find(d=>d.inboxId===i.id);
      const isGenerating = (p3GeneratingInboxId === i.id);
      const intentKey = p3ClassifyIntent(i);
      const intentMeta = P3_INTENTS[intentKey] || P3_INTENTS.other;

      // Reply section rendering
      let replySectionHtml = '';
      if(isGenerating){
        replySectionHtml = `
          <div style="background:#eef2ff;padding:14px;border-radius:6px;text-align:center;color:#4338ca;font-size:13px">
            🤖 AI 正在生成回复草稿，请稍候...
          </div>`;
      } else if(existingDraft){
        const statusMeta = P3_STATUS_LABELS[existingDraft.status] || P3_STATUS_LABELS.draft;
        replySectionHtml = `
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:12px;border-radius:6px">
            <div class="flex-between mb8">
              <b style="color:#166534">🤖 AI 回复草稿</b>
              <span class="badge" style="background:${statusMeta.color}20;color:${statusMeta.color}">${statusMeta.label}</span>
            </div>
            <div class="text-sm" style="background:#fff;padding:10px;border-radius:6px;line-height:1.7;white-space:pre-wrap;max-height:200px;overflow-y:auto">${esc(existingDraft.body||'')}</div>
            ${existingDraft.translation ? `<details style="margin-top:8px"><summary class="text-sm text-muted" style="cursor:pointer;font-size:12px">查看翻译</summary><div class="text-sm" style="margin-top:6px;padding:10px;background:#f8fafc;border-radius:6px;line-height:1.7;white-space:pre-wrap">${esc(existingDraft.translation)}</div></details>` : ''}
            <div class="btn-row mt16" style="flex-wrap:wrap;gap:6px">
              <button class="btn btn-outline btn-sm" onclick="go('replyDrafts')">✏️ 在草稿页编辑</button>
              <button class="btn btn-gold btn-sm" onclick="p3CopyDraft('${existingDraft.id}')">📋 复制</button>
              ${existingDraft.status!=='sent'
                ? `<button class="btn btn-success btn-sm" onclick="p3MarkDraftSent('${existingDraft.id}')">✅ 标记已回复</button>`
                : ''}
              <button class="btn btn-outline btn-sm" onclick="p3RegenerateReply('${i.id}')">🔄 重新生成</button>
            </div>
          </div>`;
      } else {
        replySectionHtml = `
          <div style="background:#f8fafc;border:1px dashed #cbd5e1;padding:14px;border-radius:6px;text-align:center">
            <div class="text-sm text-muted mb8" style="font-size:12px">尚未生成AI回复草稿</div>
            <button class="btn btn-primary btn-sm" onclick="p3GenerateReply('${i.id}')">🤖 AI生成回复</button>
          </div>`;
      }

      return `
        <div class="card card-pad mb16" style="${i.status==='未读'?'border-left:3px solid var(--accent)':''}">
          <div class="flex-between mb8" style="flex-wrap:wrap;gap:6px">
            <div><b style="color:var(--primary)">${esc(i.customerName)}</b> <span class="text-sm text-muted">· ${esc(i.country)}</span></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <span class="badge" style="background:${intentMeta.color}20;color:${intentMeta.color}">${intentMeta.label}</span>
              <span class="badge ${i.status==='未读'?'badge-red':i.status==='已回复'?'badge-a':'badge-gray'}">${i.status}</span>
            </div>
          </div>
          <div class="text-sm fw700 mb8">${esc(i.subject)}</div>
          <div class="text-sm" style="background:var(--gray-bg,#f8fafc);padding:10px;border-radius:6px;line-height:1.7;white-space:pre-wrap">${esc(i.body)}</div>
          <div class="divider"></div>
          <div style="background:#f7efdd;padding:10px 12px;border-radius:6px;font-size:12.5px;line-height:1.9">
            <b class="text-gold">🤖 AI 提炼：</b><br>
            客户意图：${esc(i.aiSummary&&i.aiSummary.intent||'-')}<br>
            关注产品：${esc(i.aiSummary&&i.aiSummary.product||'-')}<br>
            关键问题：${esc(i.aiSummary&&i.aiSummary.question||'-')}<br>
            紧急程度：<span class="badge ${i.aiSummary&&i.aiSummary.urgency==='高'?'badge-red':'badge-gold'}">${i.aiSummary&&i.aiSummary.urgency||'-'}</span>
          </div>
          <div class="divider"></div>
          ${replySectionHtml}
          <div class="btn-row mt16" style="flex-wrap:wrap;gap:6px">
            ${i.status!=='已回复'
              ? `<button class="btn btn-success btn-sm" onclick="p3QuickMarkReplied('${i.id}')">✅ 已据此回复</button>`
              : '<span class="badge badge-a">已回复</span>'}
            <button class="btn btn-outline btn-sm" onclick="openCustomerDetail('${i.customerId}');closeDrawer()">查看客户</button>
            <button class="btn btn-outline btn-sm" onclick="p3ViewCustomerTimeline('${i.customerId}')">📋 时间线</button>
            <button class="btn btn-outline btn-sm" onclick="toast('已设置跟进提醒')">⏰ 设置跟进提醒</button>
          </div>
        </div>`;
    }).join('')
    : '<div class="card"><div class="empty"><div class="big">📥</div><p>收件箱为空，客户回复会自动出现在这里</p></div></div>';

    root.innerHTML = `
      <div class="card card-pad mb16" style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #bfdbfe">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
          <div style="font-weight:700;color:#1e40af;font-size:15px">📊 收件箱智能分析面板</div>
          <button class="btn btn-outline btn-sm" style="font-size:11px;background:#fff" onclick="go('replyDrafts')">💬 管理所有回复草稿 →</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px">
          <div style="background:#fff;padding:12px;border-radius:8px;text-align:center;border-top:3px solid #3b82f6">
            <div style="font-size:22px;font-weight:800;color:#1e40af">${inboxStats.total}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">总邮件数</div>
          </div>
          <div style="background:#fff;padding:12px;border-radius:8px;text-align:center;border-top:3px solid #ef4444">
            <div style="font-size:22px;font-weight:800;color:#dc2626">${inboxStats.unread}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">未读邮件</div>
          </div>
          <div style="background:#fff;padding:12px;border-radius:8px;text-align:center;border-top:3px solid #f59e0b">
            <div style="font-size:22px;font-weight:800;color:#d97706">${inboxStats.highUrgency}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">高优先级</div>
          </div>
          <div style="background:#fff;padding:12px;border-radius:8px;text-align:center;border-top:3px solid #8b5cf6">
            <div style="font-size:22px;font-weight:800;color:#7c3aed">${inboxStats.priceInquiry}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">报价询盘</div>
          </div>
          <div style="background:#fff;padding:12px;border-radius:8px;text-align:center;border-top:3px solid #ec4899">
            <div style="font-size:22px;font-weight:800;color:#db2777">${inboxStats.sampleRequest}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">样品需求</div>
          </div>
          <div style="background:#fff;padding:12px;border-radius:8px;text-align:center;border-top:3px solid #10b981">
            <div style="font-size:22px;font-weight:800;color:#059669">${inboxStats.replied}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">已回复</div>
          </div>
        </div>
        <div style="margin-top:12px;padding:10px 14px;background:#fff;border-radius:6px;font-size:12px;color:#1e40af;line-height:1.6">
          💡 <b>今日回复建议</b>：优先处理${inboxStats.highUrgency}封高优先级邮件 → 跟进${inboxStats.priceInquiry}个报价询盘 → 推进${inboxStats.sampleRequest}个样品需求。点击「🤖 AI生成回复」一键生成双语草稿。
        </div>
      </div>
      ${cards}
    `;
  };

  /* Quick mark replied (without draft) */
  window.p3QuickMarkReplied = function(inboxId){
    const i = (S.inbox||[]).find(x=>x.id===inboxId);
    if(!i) return;
    i.status = '已回复';
    const c = p3GetCustomer(i.customerId);
    if(c){ c.lastInteraction = p3Now(); }
    p3AddTimelineEvent(i.customerId, {
      type: 'reply_sent',
      timestamp: p3Now(),
      title: '回复客户邮件（手动标记）',
      description: '主题: ' + (i.subject||'')
    });
    persist();
    toast('已标记回复');
    renderView();
  };

  /* Regenerate reply */
  window.p3RegenerateReply = function(inboxId){
    window.p3RegenerateDraft(inboxId);
  };

  /* ---------- 14. Wrap openCustomerDetail to inject timeline button ---------- */
  const _origOpenDetail = window.openCustomerDetail;
  if(typeof _origOpenDetail === 'function'){
    window.openCustomerDetail = function(cid){
      _origOpenDetail.apply(this, arguments);
      setTimeout(function(){ p3InjectTimelineButton(cid); }, 60);
    };
  }

  /* ---------- 15. Wrap renderView to intercept replyDrafts view ---------- */
  const _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'replyDrafts'){
      const c = document.getElementById('mainContent');
      if(c) window.viewReplyDrafts(c);
      return;
    }
    _origRV.apply(this, arguments);
  };

  /* ---------- 16. Inject CSS ---------- */
  const style = document.createElement('style');
  style.textContent = `
    .p3-timeline-wrap {
      position: relative;
      padding-left: 8px;
    }
    .p3-timeline-item {
      position: relative;
      padding-left: 32px;
      padding-bottom: 20px;
      border-left: 2px solid #e2e8f0;
    }
    .p3-timeline-item:last-child {
      padding-bottom: 0;
      border-left-color: transparent;
    }
    .p3-timeline-dot {
      position: absolute;
      left: -14px;
      top: 0;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      color: #fff;
      background: #64748b;
    }
    .p3-timeline-content {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .p3-timeline-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 4px;
    }
    .p3-timeline-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
    }
    .p3-timeline-ts {
      font-size: 11px;
      color: #94a3b8;
    }
    .p3-timeline-title {
      font-size: 13px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 2px;
    }
    .p3-timeline-desc {
      font-size: 12px;
      color: #64748b;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .p3-editor {
      resize: vertical;
    }
    @media (max-width: 640px) {
      .p3-timeline-item {
        padding-left: 26px;
      }
      .p3-timeline-dot {
        left: -12px;
        width: 22px;
        height: 22px;
        font-size: 11px;
      }
      .p3-timeline-content {
        padding: 8px 10px;
      }
    }
  `;
  document.head.appendChild(style);

})();
