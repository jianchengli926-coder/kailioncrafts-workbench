/* ============================================================
 * Customer Development Blocker Recognition (customer-dev-blocker.js)
 * ----------------------------------------------------------------
 * Phase 4.3 — Deal Blocker Recognition & Response Playbook
 *   - 6 blocker types auto-detected from customer replies
 *   - Built-in response strategies + bilingual talk tracks
 *   - One-click insert talk into the latest ai_reply draft
 *   - Global stats: frequency + resolution rate
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Only records + suggests.
 *   - All new CSS classes use the cd- prefix. Code comments in English.
 *   - All new fields persisted via persist().
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  (S.customers || []).forEach(function(c){
    if(!Array.isArray(c.cdBlockers)) c.cdBlockers = [];
    if(!Array.isArray(c.cdConversations)) c.cdConversations = [];
    if(!Array.isArray(c.cdEmails)) c.cdEmails = [];
  });

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'customerDevBlocker',
    icon: '🚧',
    label: '卡点识别',
    title: '谈单卡点识别与应对',
    crumb: '6类卡点 · 自动识别 · 应对策略 · 话术模板'
  });

  // ============================================================
  // Constants: 6 blocker types
  // ============================================================
  var CD_BLOCKER_TYPES = {
    price:      { label:'价格卡点',       icon:'💰', color:'#c05621' },
    leadtime:   { label:'交期卡点',       icon:'📅', color:'#2b6cb0' },
    quality:    { label:'质量卡点',       icon:'📋', color:'#2f855a' },
    decision:   { label:'决策卡点',       icon:'🤔', color:'#805ad5' },
    competitor: { label:'竞品卡点',      icon:'⚔️', color:'#c53030' },
    factory:    { label:'工厂/产能卡点', icon:'🏭', color:'#4a5568' }
  };

  // Keyword rules per blocker type (English + Chinese)
  var CD_BLOCKER_RULES = {
    price: [
      /too expensive/i, /too high/i, /cheaper (elsewhere|competitors|suppliers)/i,
      /price (is )?high/i, /can you (lower|reduce|cut)/i, /discount/i, /best price/i,
      /太贵/i, /便宜点/i, /降价/i, /贵了/i, /能不能便宜/i, /价格太高/i
    ],
    leadtime: [
      /need (it )?urgently/i, /asap/i, /too long/i, /can you rush/i,
      /when can you deliver/i, /how long (is|does) (is|take)/i, /交期/i, /加急/i, /多久能发货/i, /赶时间/i
    ],
    quality: [
      /quality (concern|issue)/i, /how do you ensure quality/i, /previous supplier/i,
      /can i trust/i, /warranty/i, /质量/i, /品质/i, /你们质量如何/i, /之前供应商不好/i
    ],
    decision: [
      /need to (discuss|talk with)/i, /need approval/i, /let me think/i,
      /my (boss|manager|partner|team)/i, /consider/i, /get back to you/i,
      /考虑一下/i, /和.*讨论/i, /需要.*审批/i, /上报/i, /商量一下/i
    ],
    competitor: [
      /comparing with/i, /another (supplier|factory)/i, /currently using/i,
      /XX offers/i, /competitor/i, /同行/i, /竞品/i, /另一家/i, /你们同行/i
    ],
    factory: [
      /factory size/i, /capacity/i, /handle large orders/i, /audit/i,
      /your factory/i, /workshop/i, /annual output/i, /工厂/i, /产能/i, /验厂/i, /多大规模/i
    ]
  };

  // ============================================================
  // Built-in response strategies + bilingual talk tracks
  // ============================================================
  var CD_BLOCKER_STRATEGIES = {
    price: {
      summary: '价值拆解 + MOQ阶梯价 + 增值服务免费送 + 小单试错',
      bullets: [
        '不直接降价，先把价值拆开：材质、工艺、认证、包装、QC、售后',
        '提供 MOQ 阶梯价（数量越大单价越低），引导客户提量',
        '把增值服务包装成"竞品收费我们免费"：营销素材、工厂片打客户Logo、创始人对接',
        '建议先小单试质量，用样品和首单建立信任，后续再谈价',
        '不贬低竞品，强调同价位我们品质更稳 / 同品质我们服务更全'
      ],
      talkEn: [
        'I understand price is an important factor. To help you evaluate properly, our pricing reflects the full package: food-grade stainless steel, SGS LFGB / FDA compliance, 100% QC inspection before shipment, and a complimentary marketing asset package (photos, videos, and a factory promo video branded with your logo).',
        'For a trial order we can offer a small-batch rate, and tiered pricing kicks in from 1,000 pcs upward — the more you commit, the better the unit cost. Many buyers start with 500 pcs to validate quality, then scale.',
        'If your current quote is lower, it is usually on thinner steel, fewer QC checks, or no after-sales. We can send you a side-by-side spec sheet so you compare apples to apples.'
      ],
      talkZh: [
        '我理解价格是重要因素。我们的报价包含的是完整方案：食品级不锈钢、SGS LFGB / FDA 合规、出货前全检、以及免费的营销素材包（产品图、视频、工厂宣传片打您的 Logo）。',
        '试单阶段我们可以走小批量单价，1,000 把以上有阶梯价，量越大单价越好。很多客户先下 500 把验证质量，再放大订单。',
        '如果您手上有更低的报价，通常是钢材更薄、QC 抽检比例低、或者没有售后。我们可以发一份对比表，让您横向对比。'
      ]
    },
    leadtime: {
      summary: '现货优先 + 新客户优先排产 + 分批交付 + 旺季预警',
      bullets: [
        '有现货款先卖现货，告诉客户哪些 SKU 可以马上发',
        '新客户首单承诺优先排产，让客户感到被重视',
        '提供分批交付：先发 30% 救急，剩余 70% 随下一批',
        '海运 / 空运选项说清楚，空运快但贵，海运慢但省',
        '旺季（9-12月）提前 45 天备货提醒'
      ],
      talkEn: [
        'Our standard lead time is about 30-35 days for OEM orders, but for first-time buyers we prioritize production slots. If you are in a rush, we also have a few ready-stock SKUs that can ship within 7 days.',
        'If timing is tight, we can split the shipment: send 30% by air to cover your immediate stock gap, and the balance by sea. This usually lands you covered within 2 weeks while keeping freight cost reasonable.',
        'Peak season (Sep–Dec) fills up fast. If your launch window is Q4, I would recommend locking the order by mid-August to keep the schedule.'
      ],
      talkZh: [
        'OEM 订单标准交期约 30-35 天，但新客户首单我们会优先排产。如果您急用，我们也有少量现货款，7 天内可以发。',
        '如果时间紧，我们可以分批：30% 走空运先顶上您的库存缺口，70% 走海运。这样大约 2 周内您就能收到货，运费也不会太高。',
        '旺季（9-12月）排期很满。如果您的上市窗口在 Q4，建议 8 月中前锁单，才能保住档期。'
      ]
    },
    quality: {
      summary: '认证背书 + 样品先行 + 视频验厂 + 质保补发',
      bullets: [
        '亮出 SGS LFGB / FDA / RoHS 认证，可发扫描件',
        '建议先寄样品免费验证（样品费可抵大货）',
        '邀请视频验厂，看生产线、QC 工位、仓库',
        '承诺质量问题免费补发 / 返工',
        '提供同类型客户案例（已确认的）'
      ],
      talkEn: [
        'Quality is our top priority. All knives are SGS LFGB and FDA compliant, and we can send you the certificate scans. Every batch goes through 100% QC before packing.',
        'Before committing to a bulk order, I strongly suggest we send you samples — you can test edge retention, balance, and packaging yourself. Sample fee is refundable against your first PO.',
        'We are also happy to arrange a live video factory tour so you can see the production line and QC station with your own eyes. If any unit on arrival has a defect, we replace it at our cost.'
      ],
      talkZh: [
        '质量是我们最看重的。所有刀剪都过 SGS LFGB 和 FDA 检测，证书扫描件可以发您。每批货出货前全检。',
        '大货之前强烈建议先寄样品，您自己测锋利度、手感、包装。样品费可以在首单里抵扣。',
        '我们也可以安排视频验厂，您亲眼看生产线和 QC 工位。到货如有不良，我们免费补发。'
      ]
    },
    decision: {
      summary: '降低决策门槛 + 提供决策材料 + 上级友好版',
      bullets: [
        '先小单试错，不要一上来压大单',
        '提供一页纸决策材料：ROI 表、对比表、规格表',
        '给上级看的版本：风险控制、投资回报、供应链稳定性',
        '发 1-2 个已合作客户案例（已确认）',
        '设定一个温和的跟进节点（如 3 天后），不要逼单'
      ],
      talkEn: [
        'Totally understand — this is a decision your team should review carefully. To make that easier, I have prepared a one-page comparison sheet with specs, certifications, and pricing tiers. Would it help if I also put together a short ROI note for your manager?',
        'If your team wants to keep the risk low, we can start with a 500-pc trial order. That is enough to test the market without a big commitment. If the sell-through is good, we scale from there.',
        'Take your time. I will check back with you in a few days. In the meantime, feel free to send me any questions your team has.'
      ],
      talkZh: [
        '完全理解，这种决策团队内部讨论是应该的。为了方便您汇报，我准备了一份一页纸对比表，包含规格、认证、阶梯价。要不要我再写一段给您上级看的 ROI 说明？',
        '如果团队想把风险压低，我们可以先下 500 把试单，足够测市场，不需要大投入。卖得好再放大。',
        '您慢慢考虑，我过几天再跟进。期间团队有任何问题随时问我。'
      ]
    },
    competitor: {
      summary: '不贬低竞品 + 差异化价值 + 免费增值 + 试单对比',
      bullets: [
        '尊重竞品，不踩同行',
        '说清楚我们独有的：免费营销素材、工厂片打客户 Logo、创始人直接对接、阳江协会资源',
        '竞品收费的我们免费：素材、验厂视频、打样修改',
        '建议小单对比，用质量和服务说话',
        '强调长期合作价值，不只是一次交易'
      ],
      talkEn: [
        'It sounds like you are already working with another supplier, and that is completely reasonable. Rather than asking you to switch immediately, may I suggest we run a small side-by-side trial order? You can compare edge retention, packaging, communication speed, and after-sales on your own terms.',
        'A few things we include that most traders charge extra for: a full marketing asset package (photos + videos), a factory promo video branded with your logo, and direct access to me (the founder) — no layers of sales reps.',
        'We respect every supplier. Our goal is to be your most reliable secondary source, not to replace anyone overnight.'
      ],
      talkZh: [
        '听起来您已经在和另一家合作，这很正常。我不建议您马上换掉，不如我们先下一单小的对比一下？您自己对比锋利度、包装、响应速度、售后。',
        '我们有几项是贸易商通常收费的，但我们免费送：整套营销素材（图+视频）、工厂宣传片打您的 Logo、以及直接对接我（创始人），中间没有销售层层转。',
        '我们尊重每一家供应商。我们想做的是您最稳的备选，而不是一夜之间替换谁。'
      ]
    },
    factory: {
      summary: '4家合作工厂家族股权 + 协会资源 + 视频验厂 + 旺季优先',
      bullets: [
        '说清楚模式：我们不拥有工厂，是和 4 家家族股权模式的工厂深度绑定',
        '阳江刀剪产业带 ~75% 中国刀剪产能，协会资源整合',
        '视频验厂随时安排，验厂报告可提供',
        '大订单拆到 2-3 家工厂并行生产，旺季也能排',
        '新客户旺季优先排产承诺'
      ],
      talkEn: [
        'To be transparent: we do not own a single big factory. Instead, we work closely with 4 family-equity manufacturing partners in Yangjiang — the city that produces roughly 75% of China\'s knives and scissors. This gives us flexibility: small orders stay lean, large orders can be split across lines without waiting.',
        'We are glad to set up a live video factory tour so you can see the production floor, QC station, and packing area. If you need a formal audit report for your compliance file, we can also arrange that.',
        'During peak season, we reserve priority slots for long-term partners. For a first-time buyer, we will also push your production ahead of generic traders.'
      ],
      talkZh: [
        '坦白说，我们不拥有一家大工厂。我们是和阳江 4 家家族股权模式的工厂深度绑定——阳江这座城市大概占中国刀剪产能的 75%。这样我们很灵活：小单不浪费，大单可以拆到多条线并行。',
        '我们随时可以安排视频验厂，您亲眼看车间、QC 工位、包装区。如果您合规部门需要正式验厂报告，我们也可以安排。',
        '旺季我们给长期合作伙伴留优先档期。新客户首单我们也会优先排产，比普通贸易商快。'
      ]
    }
  };

  // ============================================================
  // Helpers
  // ============================================================
  function cdBlNow(){ return new Date().toISOString(); }
  function cdBlFindCustomer(id){
    return (S.customers || []).find(function(x){ return x.id === id; }) || null;
  }
  function cdBlFmtTs(ts){
    if(!ts) return '';
    var d = new Date(ts);
    if(isNaN(d.getTime())) return String(ts);
    var pad = function(n){ return String(n).padStart(2,'0'); };
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
  }
  function cdBlCopy(text, done){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ done && done(true); }).catch(function(){ cdBlFallbackCopy(text, done); });
    }else{ cdBlFallbackCopy(text, done); }
  }
  function cdBlFallbackCopy(text, done){
    try{
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); done && done(true);
    }catch(e){ done && done(false); }
  }

  // ============================================================
  // Rule-based blocker detection from a piece of text
  // ============================================================
  function cdBlDetectRules(text){
    if(!text) return [];
    var out = [];
    Object.keys(CD_BLOCKER_RULES).forEach(function(type){
      var rules = CD_BLOCKER_RULES[type];
      for(var i=0;i<rules.length;i++){
        var m = text.match(rules[i]);
        if(m){
          out.push({ type: type, evidence: m[0] });
          break;
        }
      }
    });
    return out;
  }

  // ============================================================
  // Public API: analyze a conversation, create/update blockers
  // ============================================================
  window.cdBlockerAnalyze = async function(customerId, conversationId){
    var c = cdBlFindCustomer(customerId);
    if(!c) return [];
    if(!Array.isArray(c.cdBlockers)) c.cdBlockers = [];
    if(!Array.isArray(c.cdConversations)) c.cdConversations = [];
    var conv = c.cdConversations.find(function(x){ return x.id === conversationId; });
    if(!conv || conv.role !== 'customer') return [];

    var text = (conv.content || '') + ' ' + (conv.subject || '');
    var hits = cdBlDetectRules(text);
    var created = [];

    hits.forEach(function(h){
      // Skip if an active blocker of same type already exists for this customer
      var dup = c.cdBlockers.find(function(b){ return b.type === h.type && b.status === 'active'; });
      if(dup){
        // append evidence if new signal
        if(dup.evidence.indexOf(h.evidence) < 0){
          dup.evidence += ' | ' + h.evidence;
        }
        return;
      }
      var meta = CD_BLOCKER_TYPES[h.type];
      var strategy = CD_BLOCKER_STRATEGIES[h.type];
      var blk = {
        id: 'cd_blk_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
        type: h.type,
        label: meta.label,
        evidence: '客户原文: "' + h.evidence + '"',
        status: 'active',
        detectedAt: cdBlNow(),
        resolvedAt: null,
        strategy: strategy ? strategy.summary : '',
        conversationId: conversationId
      };
      c.cdBlockers.push(blk);
      conv.blockers = conv.blockers || [];
      if(conv.blockers.indexOf(h.type) < 0) conv.blockers.push(h.type);
      created.push(blk);
    });

    if(created.length){
      persist();
      // Don't toast on every auto-analyze; the UI will show badges
    }
    return created;
  };

  window.cdBlockerGetActive = function(customerId){
    var c = cdBlFindCustomer(customerId);
    if(!c || !Array.isArray(c.cdBlockers)) return [];
    return c.cdBlockers.filter(function(b){ return b.status === 'active'; });
  };

  window.cdBlockerResolve = function(customerId, blockerId){
    var c = cdBlFindCustomer(customerId);
    if(!c) return;
    var b = (c.cdBlockers||[]).find(function(x){ return x.id === blockerId; });
    if(!b) return;
    b.status = 'resolved';
    b.resolvedAt = cdBlNow();
    persist();
    toast('✅ 已标记「' + b.label + '」为已解决');
    renderView();
  };

  window.cdBlockerGetStrategies = function(type){
    return CD_BLOCKER_STRATEGIES[type] || null;
  };

  // Insert the recommended talk (EN, by default) into the latest ai_reply draft
  window.cdBlockerInsertTalk = function(customerId, blockerId){
    var c = cdBlFindCustomer(customerId);
    if(!c) return;
    var b = (c.cdBlockers||[]).find(function(x){ return x.id === blockerId; });
    if(!b) return;
    var st = CD_BLOCKER_STRATEGIES[b.type];
    if(!st){ toast('该卡点暂无话术模板', 'err'); return; }

    // Find the latest ai_draft / ai_reply email (unsent)
    var draft = (c.cdEmails||[]).slice().reverse().find(function(e){
      return e.type === 'ai_reply' && e.status !== 'sent';
    });
    if(!draft){
      toast('⚠️ 暂无未发送的AI回复草稿，请先生成回复草稿再插入话术', 'err');
      return;
    }
    // Append the first EN talk line as a new paragraph
    var snippet = '\n\n' + (st.talkEn[0] || '');
    draft.bodyEn = (draft.bodyEn || '') + snippet;
    if(st.talkZh && st.talkZh[0]){
      draft.bodyZh = (draft.bodyZh || '') + '\n\n' + st.talkZh[0];
    }
    draft.status = 'edited';
    // sync conversation
    var conv = (c.cdConversations||[]).find(function(x){ return x.emailId === draft.id && x.type === 'ai_draft'; });
    if(conv) conv.content = draft.bodyEn;
    persist();
    toast('✅ 已将「' + b.label + '」推荐话术插入回复草稿');
    // jump to reply page
    currentView = 'customerDevReply';
    window._cdrCurCid = customerId;
    renderView();
  };

  // Global stats
  window.cdBlockerGetStats = function(){
    var totals = {};
    var resolved = {};
    Object.keys(CD_BLOCKER_TYPES).forEach(function(k){ totals[k] = 0; resolved[k] = 0; });
    (S.customers || []).forEach(function(c){
      (c.cdBlockers || []).forEach(function(b){
        if(totals[b.type] === undefined) totals[b.type] = 0;
        totals[b.type]++;
        if(b.status === 'resolved'){
          if(resolved[b.type] === undefined) resolved[b.type] = 0;
          resolved[b.type]++;
        }
      });
    });
    var out = [];
    Object.keys(CD_BLOCKER_TYPES).forEach(function(k){
      out.push({
        type: k,
        label: CD_BLOCKER_TYPES[k].label,
        icon: CD_BLOCKER_TYPES[k].icon,
        color: CD_BLOCKER_TYPES[k].color,
        total: totals[k] || 0,
        resolved: resolved[k] || 0,
        rate: totals[k] ? Math.round((resolved[k]/totals[k])*100) : 0
      });
    });
    return out;
  };

  // Talk copy button
  window.cdBlkCopyTalk = function(type, which, idx){
    var st = CD_BLOCKER_STRATEGIES[type];
    if(!st) return;
    var arr = which === 'zh' ? st.talkZh : st.talkEn;
    var text = arr[idx] || '';
    cdBlCopy(text, function(ok){
      toast(ok ? '话术已复制到剪贴板' : '复制失败，请手动选择', ok ? 'ok' : 'err');
    });
  };

  // Customer selector
  window.cdBlkSelectCustomer = function(cid){ window._cdBlkCid = cid; renderView(); };
  window.cdBlkToggleTalk = function(type, lang){
    var key = '_cdBlkTalk_' + type;
    window[key] = (window[key] === lang) ? null : lang;
    renderView();
  };

  // ============================================================
  // Rendering
  // ============================================================
  function cdBlkRenderStats(){
    var stats = window.cdBlockerGetStats();
    var max = Math.max.apply(null, stats.map(function(s){ return s.total; }).concat([1]));
    var h = '<div class="cdblk-stats">';
    h += '<div class="cdblk-stats-t">📊 全局卡点统计（' + (S.customers||[]).length + ' 个客户）</div>';
    h += '<div class="cdblk-bars">';
    stats.forEach(function(s){
      var w = Math.round((s.total / max) * 100);
      h += '<div class="cdblk-bar-row">';
      h += '<div class="cdblk-bar-label">' + s.icon + ' ' + s.label + '</div>';
      h += '<div class="cdblk-bar-track"><div class="cdblk-bar-fill" style="width:' + w + '%;background:' + s.color + '"></div></div>';
      h += '<div class="cdblk-bar-num">' + s.total + ' 次 · 解决率 ' + s.rate + '%</div>';
      h += '</div>';
    });
    h += '</div></div>';
    return h;
  }

  function cdBlkRenderBlockerCard(c, b){
    var meta = CD_BLOCKER_TYPES[b.type] || CD_BLOCKER_TYPES.other;
    var st = CD_BLOCKER_STRATEGIES[b.type];
    var h = '<div class="cdblk-card' + (b.status==='resolved'?' resolved':'') + '" style="border-left:4px solid ' + meta.color + '">';
    h += '<div class="cdblk-card-head">';
    h += '<span class="cdblk-card-icon">' + meta.icon + '</span>';
    h += '<div class="cdblk-card-title">';
    h += '<b>' + meta.label + '</b>';
    h += b.status === 'resolved'
      ? '<span class="cdblk-status" style="background:#38a16922;color:#38a169">✅ 已解决 · ' + esc(cdBlFmtTs(b.resolvedAt)) + '</span>'
      : '<span class="cdblk-status" style="background:#c5303022;color:#c53030">🚧 活跃</span>';
    h += '</div>';
    h += '<div class="cdblk-card-actions">';
    if(b.status !== 'resolved'){
      h += '<button class="btn btn-outline btn-sm" onclick="cdBlockerResolve(\'' + c.id + '\',\'' + b.id + '\')">✓ 标记已解决</button>';
      h += '<button class="btn btn-primary btn-sm" onclick="cdBlockerInsertTalk(\'' + c.id + '\',\'' + b.id + '\')">📥 插入回复草稿</button>';
    }
    h += '</div></div>';

    // Evidence
    h += '<div class="cdblk-evidence">🔍 识别依据：<i>' + esc(b.evidence) + '</i></div>';
    h += '<div class="cdblk-meta">检测于 ' + esc(cdBlFmtTs(b.detectedAt)) + (b.strategy ? ' · 策略：' + esc(b.strategy) : '') + '</div>';

    if(st){
      // Bullets
      h += '<div class="cdblk-bullets"><div class="cdblk-sub-t">💡 应对策略</div><ul>';
      st.bullets.forEach(function(x){ h += '<li>' + esc(x) + '</li>'; });
      h += '</ul></div>';

      // Talk tracks (EN / ZH tabs)
      var showLang = window['_cdBlkTalk_' + b.type];
      h += '<div class="cdblk-talk">';
      h += '<div class="cdblk-sub-t">💬 推荐话术'
        + ' <span class="cdblk-tab" onclick="cdBlkToggleTalk(\'' + b.type + '\',\'en\')">英文' + (showLang==='en'?' ▼':'') + '</span>'
        + ' <span class="cdblk-tab" onclick="cdBlkToggleTalk(\'' + b.type + '\',\'zh\')">中文' + (showLang==='zh'?' ▼':'') + '</span>'
        + '</div>';
      if(showLang === 'en'){
        st.talkEn.forEach(function(t, i){
          h += '<div class="cdblk-talk-item"><div class="cdblk-talk-text">' + esc(t) + '</div>'
            + '<button class="btn btn-outline btn-sm" onclick="cdBlkCopyTalk(\'' + b.type + '\',\'en\',' + i + ')">📋 复制</button></div>';
        });
      }else if(showLang === 'zh'){
        st.talkZh.forEach(function(t, i){
          h += '<div class="cdblk-talk-item"><div class="cdblk-talk-text">' + esc(t) + '</div>'
            + '<button class="btn btn-outline btn-sm" onclick="cdBlkCopyTalk(\'' + b.type + '\',\'zh\',' + i + ')">📋 复制</button></div>';
        });
      }else{
        h += '<div class="cdblk-talk-hint">点击上方「英文」或「中文」查看话术模板</div>';
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function cdBlkRenderTimeline(c){
    var all = (c.cdBlockers || []).slice().sort(function(a,b){
      return new Date(a.detectedAt) - new Date(b.detectedAt);
    });
    if(!all.length) return '';
    var h = '<div class="cdblk-timeline"><div class="cdblk-sub-t">🕒 该客户卡点历史（' + all.length + '）</div>';
    all.forEach(function(b){
      var meta = CD_BLOCKER_TYPES[b.type] || {};
      h += '<div class="cdblk-tl-item">';
      h += '<span class="cdblk-tl-dot" style="background:' + (meta.color||'#999') + '">' + (meta.icon||'•') + '</span>';
      h += '<div class="cdblk-tl-body"><b>' + (meta.label||b.type) + '</b>';
      h += ' <small class="text-muted">' + esc(cdBlFmtTs(b.detectedAt)) + '</small>';
      h += b.status === 'resolved'
        ? ' <span class="cdblk-status" style="background:#38a16922;color:#38a169">已解决于 ' + esc(cdBlFmtTs(b.resolvedAt)) + '</span>'
        : ' <span class="cdblk-status" style="background:#c5303022;color:#c53030">活跃中</span>';
      h += '<div class="cdblk-tl-ev">' + esc(b.evidence) + '</div>';
      h += '</div></div>';
    });
    h += '</div>';
    return h;
  }

  function cdBlkRenderPage(root){
    var customers = S.customers || [];
    if(!customers.length){
      root.innerHTML = '<div class="cd-empty">客户台账为空。</div>';
      return;
    }
    var cid = window._cdBlkCid || customers[0].id;
    var c = cdBlFindCustomer(cid) || customers[0];

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '<div><h2 style="margin:0">🚧 谈单卡点识别与应对策略</h2>'
      + '<div class="text-sm text-muted" style="margin-top:4px">6类卡点自动识别 · 应对策略 + 中英文话术 · 一键插入回复草稿</div></div>';
    h += '</div>';

    // Stats overview
    h += cdBlkRenderStats();

    // Customer selector
    h += '<div class="cd-selector"><label class="cd-sel-label">选择客户：</label>';
    h += '<select class="cd-sel" onchange="cdBlkSelectCustomer(this.value)">';
    customers.forEach(function(x){
      var active = (x.cdBlockers||[]).filter(function(b){ return b.status === 'active'; }).length;
      h += '<option value="' + esc(x.id) + '"' + (x.id===c.id?' selected':'') + '>'
        + esc(x.company||x.name||'未命名') + '（' + esc(x.country||'—') + '）' + (active ? ' · 🚧' + active + '活跃卡点' : '') + '</option>';
    });
    h += '</select></div>';

    // Active blockers for this customer
    var active = (c.cdBlockers||[]).filter(function(b){ return b.status === 'active'; });
    var resolved = (c.cdBlockers||[]).filter(function(b){ return b.status === 'resolved'; });

    h += '<div class="cdblk-section">';
    h += '<div class="cdblk-section-t">🚧 当前活跃卡点（' + active.length + '）</div>';
    if(!active.length){
      h += '<div class="cd-empty" style="padding:18px">该客户暂无活跃卡点。客户回复后会自动识别。</div>';
    }else{
      active.forEach(function(b){ h += cdBlkRenderBlockerCard(c, b); });
    }
    h += '</div>';

    if(resolved.length){
      h += '<div class="cdblk-section">';
      h += '<div class="cdblk-section-t">✅ 已解决卡点（' + resolved.length + '）</div>';
      resolved.forEach(function(b){ h += cdBlkRenderBlockerCard(c, b); });
      h += '</div>';
    }

    h += cdBlkRenderTimeline(c);

    h += '<div class="cd-footer-bar"><span class="cd-hint">🔒 本模块只识别卡点 + 提供话术，不自动发送邮件。「插入回复草稿」会把话术追加到最新未发送的AI回复草稿中。</span></div>';

    root.innerHTML = h;
  }

  // ── renderView interception ───────────────────────────────
  var _cdBlkOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'customerDevBlocker'){
      var root = document.getElementById('mainContent');
      if(root){
        try{ cdBlkRenderPage(root); }
        catch(e){ console.warn('[cdBlk] render error', e); root.innerHTML = '<div class="cd-empty">渲染出错：' + esc(e.message||e) + '</div>'; }
      }
      return;
    }
    _cdBlkOrigRV.apply(this, arguments);
  };

  // ── Styles ───────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.cdblk-stats{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:14px;}'
    + '.cdblk-stats-t{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:10px;}'
    + '.cdblk-bars{display:flex;flex-direction:column;gap:6px;}'
    + '.cdblk-bar-row{display:flex;align-items:center;gap:10px;font-size:12.5px;}'
    + '.cdblk-bar-label{width:140px;color:#4a5568;flex-shrink:0;}'
    + '.cdblk-bar-track{flex:1;height:10px;background:#edf2f7;border-radius:5px;overflow:hidden;}'
    + '.cdblk-bar-fill{height:100%;border-radius:5px;}'
    + '.cdblk-bar-num{width:150px;text-align:right;color:#718096;flex-shrink:0;font-size:11.5px;}'
    + '.cdblk-section{margin-bottom:16px;}'
    + '.cdblk-section-t{font-size:14px;font-weight:700;color:#2d3748;margin:10px 0;}'
    + '.cdblk-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:10px;}'
    + '.cdblk-card.resolved{opacity:0.7;}'
    + '.cdblk-card-head{display:flex;align-items:center;gap:10px;margin-bottom:8px;padding-left:8px;}'
    + '.cdblk-card-icon{font-size:22px;}'
    + '.cdblk-card-title{flex:1;font-size:14px;color:#2d3748;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}'
    + '.cdblk-card-actions{display:flex;gap:6px;}'
    + '.cdblk-status{font-size:11px;font-weight:600;padding:2px 9px;border-radius:10px;}'
    + '.cdblk-evidence{background:#fffaf0;padding:8px 10px;border-radius:6px;font-size:12.5px;color:#975a16;margin:6px 0;}'
    + '.cdblk-meta{font-size:11.5px;color:#a0aec0;margin-bottom:8px;}'
    + '.cdblk-sub-t{font-size:13px;font-weight:700;color:#2d3748;margin:10px 0 6px;}'
    + '.cdblk-bullets ul{margin:0;padding-left:20px;font-size:12.5px;color:#4a5568;line-height:1.7;}'
    + '.cdblk-talk{margin-top:10px;border-top:1px dashed #e2e8f0;padding-top:8px;}'
    + '.cdblk-tab{font-size:11.5px;padding:2px 8px;background:#edf2f7;border-radius:10px;cursor:pointer;color:#4a5568;margin-left:6px;}'
    + '.cdblk-tab:hover{background:#e2e8f0;}'
    + '.cdblk-talk-item{display:flex;gap:10px;align-items:flex-start;background:#f7fafc;padding:8px 10px;border-radius:8px;margin:6px 0;}'
    + '.cdblk-talk-text{flex:1;font-size:12.5px;color:#2d3748;line-height:1.6;white-space:pre-wrap;}'
    + '.cdblk-talk-hint{font-size:12px;color:#a0aec0;padding:8px;}'
    + '.cdblk-timeline{margin-top:16px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;}'
    + '.cdblk-tl-item{position:relative;padding-left:28px;padding-bottom:12px;border-left:2px solid #e2e8f0;margin-left:8px;}'
    + '.cdblk-tl-item:last-child{padding-bottom:0;border-left-color:transparent;}'
    + '.cdblk-tl-dot{position:absolute;left:-13px;top:0;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;}'
    + '.cdblk-tl-body{font-size:12.5px;color:#2d3748;}'
    + '.cdblk-tl-ev{font-size:11.5px;color:#718096;margin-top:2px;}'
    + '@media (max-width:800px){'
    + '  .cdblk-bar-label{width:100px;font-size:11.5px;}'
    + '  .cdblk-bar-num{width:110px;}'
    + '  .cdblk-card-head{flex-wrap:wrap;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
