/* ============================================================
 * P5 Phase5: WhatsApp 24h / 72h Compliance Reminder
 * ----------------------------------------------------------------
 * - Pure frontend module, loaded AFTER phase4-whatsapp.js.
 * - Explains the WhatsApp Business API 24-hour customer-care window
 *   and the 72-hour cooldown recommendation.
 * - Lists customers from S.whatsappRecords sorted by urgency,
 *   shows a live countdown, and offers safe manual actions
 *   (open wa.me in a new tab — NEVER auto-send).
 * - All new CSS classes use the p5- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init (reuse phase4 collections, no new persisted key) ──
  if(!Array.isArray(S.whatsappRecords)) S.whatsappRecords = [];
  if(!Array.isArray(S.whatsappTemplates)) S.whatsappTemplates = [];

  // ── Nav injection ─────────────────────────────────────────
  NAV.push({key:'waCompliance', icon:'⏰', label:'WA合规提醒', title:'WhatsApp合规检查', crumb:'24h窗口 · 72h冷却 · 模板消息提醒'});

  // ── Local helpers ────────────────────────────────────────
  function p5cNormalizeWa(raw){
    if(!raw) return '';
    return String(raw).replace(/[^\d]/g, '');
  }

  function p5cFmtTime(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  // ── Core: compliance status calculation ─────────────────
  // windowStart = customer's last repliedAt if exists, else our sentAt.
  // The 24h free-reply window begins when the CUSTOMER last messaged us.
  // If we never got a reply, the window starts from our outbound sentAt
  // (conservative assumption).
  function p5CalcWACompliance(record){
    if(!record) return {status:'unknown', remaining:null, hours:null};
    var windowStart = record.repliedAt || record.sentAt;
    if(!windowStart) return {status:'unknown', remaining:null, hours:null};

    var startTs = new Date(windowStart).getTime();
    if(isNaN(startTs)) return {status:'unknown', remaining:null, hours:null};

    var nowTs = Date.now();
    var elapsedH = (nowTs - startTs) / 3600000; // hours since window start
    var remaining = 24 - elapsedH; // hours left in 24h window

    // Also compute hours since the very last activity (for 72h cooldown).
    var lastActivity = record.repliedAt || record.sentAt;
    var lastTs = new Date(lastActivity).getTime();
    var hoursSinceLast = (nowTs - lastTs) / 3600000;

    if(remaining > 4){
      return {status:'active', remaining:remaining, hours:hoursSinceLast};
    }
    if(remaining > 0){
      return {status:'expiring', remaining:remaining, hours:hoursSinceLast};
    }
    if(hoursSinceLast <= 72){
      return {status:'expired', remaining:0, hours:hoursSinceLast};
    }
    return {status:'cooldown', remaining:0, hours:hoursSinceLast};
  }

  // Public API so other modules can check compliance for a customer.
  window.p5CheckWACompliance = function(customerId){
    var recs = (S.whatsappRecords||[]).filter(function(r){ return r.customerId === customerId; });
    if(!recs.length) return {status:'norecord', remaining:null, hours:null};
    // Use the most recent record for this customer.
    recs.sort(function(a,b){
      var ta = new Date(a.repliedAt || a.sentAt || 0).getTime();
      var tb = new Date(b.repliedAt || b.sentAt || 0).getTime();
      return tb - ta;
    });
    return p5CalcWACompliance(recs[0]);
  };

  // Format remaining hours into a human countdown string.
  function p5FmtCountdown(remaining){
    if(remaining === null || remaining === undefined) return '—';
    if(remaining <= 0) return '已过期';
    var totalMin = Math.max(0, Math.round(remaining * 60));
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if(h > 0) return '剩余 '+h+' 小时 '+m+' 分';
    return '剩余 '+m+' 分钟';
  }

  // Status meta: label + color + sort order.
  var P5C_STATUS_META = {
    expiring:  {label:'即将过期', color:'#d69e2e', sort:0},
    expired:   {label:'已过期',   color:'#e53e3e', sort:1},
    active:    {label:'24h窗口内', color:'#38a169', sort:2},
    cooldown:  {label:'72h冷却期', color:'#718096', sort:3},
    unknown:   {label:'无记录',   color:'#a0aec0', sort:4},
    norecord:  {label:'无记录',   color:'#a0aec0', sort:4}
  };

  // ── Build the enriched record list ────────────────────────
  function p5BuildList(){
    var recs = S.whatsappRecords || [];
    // One entry per customer: use the most recent record.
    var byCustomer = {};
    recs.forEach(function(r){
      var cid = r.customerId || r.phone;
      if(!cid) return;
      var existing = byCustomer[cid];
      var rTs = new Date(r.repliedAt || r.sentAt || 0).getTime();
      var eTs = existing ? new Date(existing.repliedAt || existing.sentAt || 0).getTime() : 0;
      if(!existing || rTs > eTs) byCustomer[cid] = r;
    });

    var list = Object.keys(byCustomer).map(function(cid){
      var r = byCustomer[cid];
      var comp = p5CalcWACompliance(r);
      return { record: r, comp: comp };
    });

    // Sort by urgency: expiring → expired → active → cooldown → unknown.
    list.sort(function(a,b){
      var sa = P5C_STATUS_META[a.comp.status] ? P5C_STATUS_META[a.comp.status].sort : 9;
      var sb = P5C_STATUS_META[b.comp.status] ? P5C_STATUS_META[b.comp.status].sort : 9;
      if(sa !== sb) return sa - sb;
      // Within same status, sort by remaining time ascending (most urgent first).
      return (a.comp.remaining || 0) - (b.comp.remaining || 0);
    });

    return list;
  }

  // ── Action: open wa.me with compliance guard ─────────────
  window.p5OpenWaGuarded = function(customerId, phone){
    var comp = window.p5CheckWACompliance(customerId);
    var norm = p5cNormalizeWa(phone);
    if(!norm){ toast('号码无效','err'); return; }

    if(comp.status === 'expired' || comp.status === 'cooldown'){
      var msg = comp.status === 'cooldown'
        ? '⚠️ 该客户已超过72小时未互动，建议冷却一段时间后再联系。\n\n仍然要打开 WhatsApp 吗？（你需要手动发送消息，系统不会自动发送）'
        : '⚠️ 该客户已超过24小时免费回复窗口。\n\n根据 WhatsApp Business 规则，超过24小时后应使用模板消息（Template Message）。\n\n仍然要打开 WhatsApp 手动发送吗？';
      confirmDlg(msg, function(){
        window.open('https://wa.me/'+norm, '_blank');
      });
    }else{
      window.open('https://wa.me/'+norm, '_blank');
    }
  };

  // ── Action: mark customer as cooldown ─────────────────────
  window.p5MarkCooldown = function(customerId){
    var c = (S.customers||[]).find(function(x){ return x.id === customerId; });
    if(!c){ toast('未找到客户','err'); return; }
    c.waCooldown = true;
    persist();
    toast('已标记为冷却，建议 7 天后再联系');
    renderView();
  };

  // ── Action: list available templates for expired customers ──
  window.p5ShowTemplates = function(customerId){
    var tpls = S.whatsappTemplates || [];
    var h = '';
    h += '<div class="modal-head"><h3>📋 可用模板消息</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body">';
    h += '<div class="p5c-modal-tip">该客户已超过24小时免费回复窗口。根据 WhatsApp Business 规则，请使用以下模板消息之一（需在 WhatsApp Business 平台预先审核通过）。</div>';
    if(!tpls.length){
      h += '<div class="p5-empty">还没有模板。请到 WhatsApp 管理页面创建模板。</div>';
    }else{
      tpls.forEach(function(t){
        h += '<div class="p5c-tpl-item">';
        h += '  <div class="p5c-tpl-name">'+esc(t.name)+'</div>';
        h += '  <div class="p5c-tpl-body">'+esc(t.content)+'</div>';
        h += '</div>';
      });
    }
    h += '</div>';
    h += '<div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">关闭</button></div>';
    openModal(h, true);
  };

  // ═══════════════════════════════════════════════════════════
  //  MAIN VIEW
  // ═══════════════════════════════════════════════════════════
  window.viewWaCompliance = function(root){
    var list = p5BuildList();

    // Stats
    var nActive = list.filter(function(x){ return x.comp.status === 'active'; }).length;
    var nExpiring = list.filter(function(x){ return x.comp.status === 'expiring'; }).length;
    var nExpired = list.filter(function(x){ return x.comp.status === 'expired'; }).length;
    var nCooldown = list.filter(function(x){ return x.comp.status === 'cooldown'; }).length;

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">⏰ WhatsApp 合规检查</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">24小时客户服务窗口 · 72小时冷却建议 · 帮助你合规使用 WhatsApp Business</div></div>';
    h += '</div>';

    // Rule explanation card
    h += '<div class="p5c-rule-card">';
    h += '  <div class="p5c-rule-title">📖 WhatsApp Business 24小时规则说明</div>';
    h += '  <div class="p5c-rule-body">';
    h += '    <p>• <b>24小时窗口</b>：客户主动发消息后，你可以在 <b>24小时</b> 内免费回复（普通消息即可）。</p>';
    h += '    <p>• <b>超过24小时</b>：必须使用经过 WhatsApp 审核的 <b>模板消息（Template Message）</b>，普通消息会被限制或收费。</p>';
    h += '    <p>• <b>72小时冷却</b>：建议超过72小时未互动的客户先冷却，避免频繁打扰导致被举报封号。</p>';
    h += '  </div>';
    h += '</div>';

    // Stats strip
    h += '<div class="p5c-stats">';
    h += '  <div class="p5c-stat"><div class="p5c-stat-num" style="color:#38a169">'+nActive+'</div><div class="p5c-stat-lbl">✅ 24h窗口内</div></div>';
    h += '  <div class="p5c-stat"><div class="p5c-stat-num" style="color:#d69e2e">'+nExpiring+'</div><div class="p5c-stat-lbl">⚠️ 即将过期（&lt;4h）</div></div>';
    h += '  <div class="p5c-stat"><div class="p5c-stat-num" style="color:#e53e3e">'+nExpired+'</div><div class="p5c-stat-lbl">❌ 已过期（需模板）</div></div>';
    h += '  <div class="p5c-stat"><div class="p5c-stat-num" style="color:#718096">'+nCooldown+'</div><div class="p5c-stat-lbl">⏳ 72h冷却期</div></div>';
    h += '</div>';

    // Customer list
    if(!list.length){
      h += '<div class="p5c-empty">还没有 WhatsApp 发送记录。<br>请到「💬 WhatsApp」页面生成任务并标记发送后，这里会自动显示合规状态。</div>';
    }else{
      h += '<div class="p5c-list">';
      list.forEach(function(item){
        var r = item.record;
        var comp = item.comp;
        var meta = P5C_STATUS_META[comp.status] || P5C_STATUS_META.unknown;
        var c = (S.customers||[]).find(function(x){ return x.id === r.customerId; });

        h += '<div class="p5c-card p5c-'+comp.status+'">';
        h += '  <div class="p5c-card-head">';
        h += '    <div class="p5c-who">'+esc(r.customerName || (c && (c.company || (c.contact && c.contact.name))) || '未知客户')+'</div>';
        h += '    <span class="p5c-badge" style="background:'+meta.color+'">'+meta.label+'</span>';
        h += '  </div>';
        h += '  <div class="p5c-meta">';
        h += '    <span class="p5c-phone">📱 +'+esc(r.phone || '')+'</span>';
        h += '    <span class="p5c-time">最后互动：'+p5cFmtTime(r.repliedAt || r.sentAt)+'</span>';
        h += '  </div>';

        // Countdown / status line
        if(comp.status === 'active' || comp.status === 'expiring'){
          h += '  <div class="p5c-countdown" data-remaining="'+(comp.remaining||0)+'">⏳ '+p5FmtCountdown(comp.remaining)+'</div>';
        }else if(comp.status === 'expired'){
          h += '  <div class="p5c-countdown p5c-red">🔴 已超过24小时窗口 · 已过去 '+Math.round(comp.hours)+' 小时</div>';
        }else if(comp.status === 'cooldown'){
          h += '  <div class="p5c-countdown p5c-gray">⚪ 已冷却 '+Math.round(comp.hours)+' 小时 · 建议7天后再联系</div>';
        }

        // Action buttons
        h += '  <div class="p5c-actions">';
        if(comp.status === 'active' || comp.status === 'expiring'){
          h += '    <button class="btn btn-outline btn-sm" onclick="p5OpenWaGuarded(\''+r.customerId+'\',\''+r.phone+'\')">💬 发送消息</button>';
        }else if(comp.status === 'expired'){
          h += '    <button class="btn btn-outline btn-sm" onclick="p5ShowTemplates(\''+r.customerId+'\')">📝 使用模板消息</button>';
          h += '    <button class="btn btn-outline btn-sm" onclick="p5OpenWaGuarded(\''+r.customerId+'\',\''+r.phone+'\')">💬 仍手动发送</button>';
        }else if(comp.status === 'cooldown'){
          if(c && !c.waCooldown){
            h += '    <button class="btn btn-outline btn-sm" onclick="p5MarkCooldown(\''+r.customerId+'\')">⏳ 标记冷却</button>';
          }else{
            h += '    <span class="p5c-cooldown-badge">已标记冷却</span>';
          }
        }
        h += '  </div>';
        h += '</div>';
      });
      h += '</div>';
    }

    root.innerHTML = h;
  };

  // ── Live countdown refresh (every 60 seconds) ─────────────
  // Re-render only when on the compliance view, so countdowns tick.
  setInterval(function(){
    if(typeof currentView !== 'undefined' && currentView === 'waCompliance'){
      // Soft re-render: just update countdown numbers instead of full rerender.
      var els = document.querySelectorAll('.p5c-countdown[data-remaining]');
      if(!els.length) return;
      // Simplest correct approach: full rerender is cheap for this list size.
      renderView();
    }
  }, 60000);

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'waCompliance'){
      window.viewWaCompliance(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p5c- prefixed, responsive) ────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p5c-rule-card{background:#ebf8ff;border:1px solid #bee3f8;border-radius:10px;padding:14px 18px;margin-bottom:16px;}'
    + '.p5c-rule-title{font-size:14px;font-weight:700;color:#2b6cb0;margin-bottom:8px;}'
    + '.p5c-rule-body{font-size:12.5px;color:#2c5282;line-height:1.8;}'
    + '.p5c-rule-body p{margin:2px 0;}'
    + '.p5c-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}'
    + '.p5c-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.p5c-stat-num{font-size:26px;font-weight:700;}'
    + '.p5c-stat-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    + '.p5c-empty{padding:40px;text-align:center;color:#a0aec0;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;font-size:13px;line-height:1.8;}'
    + '.p5c-list{display:flex;flex-direction:column;gap:10px;}'
    + '.p5c-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;border-left:4px solid #e2e8f0;}'
    + '.p5c-card.p5c-active{border-left-color:#38a169;}'
    + '.p5c-card.p5c-expiring{border-left-color:#d69e2e;background:#fffaf0;}'
    + '.p5c-card.p5c-expired{border-left-color:#e53e3e;background:#fff5f5;}'
    + '.p5c-card.p5c-cooldown{border-left-color:#718096;opacity:.85;}'
    + '.p5c-card-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;}'
    + '.p5c-who{font-weight:600;font-size:14px;color:#2d3748;}'
    + '.p5c-badge{font-size:11px;color:#fff;padding:2px 10px;border-radius:10px;font-weight:600;}'
    + '.p5c-meta{display:flex;gap:16px;font-size:12px;color:#718096;margin-bottom:8px;flex-wrap:wrap;}'
    + '.p5c-phone{color:#2b6cb0;font-weight:600;}'
    + '.p5c-countdown{font-size:13px;font-weight:600;color:#d69e2e;margin-bottom:8px;}'
    + '.p5c-countdown.p5c-red{color:#e53e3e;}'
    + '.p5c-countdown.p5c-gray{color:#718096;}'
    + '.p5c-actions{display:flex;gap:8px;flex-wrap:wrap;}'
    + '.p5c-cooldown-badge{font-size:12px;color:#718096;font-style:italic;}'
    + '.p5c-modal-tip{background:#fffaf0;border:1px solid #fbd38d;border-radius:8px;padding:10px 12px;font-size:12.5px;color:#c05621;margin-bottom:12px;line-height:1.6;}'
    + '.p5c-tpl-item{background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:8px;}'
    + '.p5c-tpl-name{font-weight:600;font-size:13px;color:#2d3748;margin-bottom:4px;}'
    + '.p5c-tpl-body{font-size:12.5px;color:#4a5568;white-space:pre-wrap;}'
    + '@media (max-width:768px){'
    + '  .p5c-stats{grid-template-columns:repeat(2,1fr);}'
    + '  .p5c-card-head{flex-direction:column;align-items:flex-start;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
