/* ============================================================
 * Customer Development Timeline (customer-dev-timeline.js)
 * ----------------------------------------------------------------
 * Phase 4.4: Customer communication timeline
 *   - 13 event types (auto + manual)
 *   - Type filtering, expand/collapse, manual event form
 *   - Text export (copy / download .txt)
 *   - Stats: total count, last follow-up, avg interval, type counts
 *   - Infrastructure: window.cdTimelineAdd is called by followup /
 *     reply / blocker / dormant modules to record events.
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Records status only.
 *   - Fully client-side free implementation. No paid services.
 *   - Does NOT modify app.js / server.js / other cd-* modules.
 *   - All new CSS classes use the cd- prefix. Code comments in English.
 *   - All persistence goes through persist().
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  (S.customers || []).forEach(function(c){
    if(!Array.isArray(c.cdTimeline)) c.cdTimeline = [];
  });

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'customerDevTimeline',
    icon: '📅',
    label: '沟通时间线',
    title: '客户沟通全生命周期时间线',
    crumb: '自动+手动事件 · 筛选 · 导出 · 统计'
  });

  // ============================================================
  // Constants — 13 event types (strictly per Phase-4 spec)
  // ============================================================
  var CD_TIMELINE_TYPES = {
    first_outreach: { label:'首次开发信', icon:'📧', color:'#3182ce' },
    followup:       { label:'跟进',       icon:'📨', color:'#06b6d4' },
    customer_reply: { label:'客户回复',   icon:'📥', color:'#f59e0b' },
    our_reply:      { label:'我方回复',   icon:'✉️', color:'#2f855a' },
    call:           { label:'通话记录',   icon:'📞', color:'#805ad5' },
    sample_sent:    { label:'样品寄出',   icon:'📦', color:'#d69e2e' },
    quote:          { label:'报价/PI',    icon:'💰', color:'#10b981' },
    order:          { label:'下单',       icon:'✅', color:'#16a34a' },
    paused:         { label:'暂停跟进',   icon:'⏸️', color:'#718096' },
    dormant:        { label:'标记沉睡',   icon:'💤', color:'#a0aec0' },
    wakeup:         { label:'沉睡唤醒',   icon:'🔄', color:'#38b2ac' },
    note:           { label:'备注',       icon:'📝', color:'#4a5568' },
    blocker:        { label:'卡点识别',   icon:'🚧', color:'#c53030' }
  };

  // Types that count as actual "contact" (we talked / they replied).
  // Used by cdTimelineGetLastContact + avg-interval stats.
  var CD_TL_CONTACT_TYPES = [
    'first_outreach','followup','customer_reply','our_reply',
    'call','sample_sent','quote','order','wakeup'
  ];

  // Manual event types exposed in the add-event form.
  var CD_TL_MANUAL_TYPES = ['call','sample_sent','quote','order','note'];

  var CD_TL_ACTORS = {
    system:  { label:'系统', color:'#a0aec0' },
    user:    { label:'我',   color:'#3182ce' },
    ai:      { label:'AI',   color:'#805ad5' },
    customer:{ label:'客户', color:'#f59e0b' }
  };

  var CD_TL_MAX_EVENTS = 300;

  // ============================================================
  // Local helpers
  // ============================================================
  function cdTlNow(){ return new Date().toISOString(); }

  function cdTlFindCustomer(id){
    if(!id) return null;
    return (S.customers || []).find(function(x){ return x.id === id; }) || null;
  }

  function cdTlName(c){ return (c && (c.company || c.name)) || '未命名客户'; }

  // Human timestamp: "2026-10-06 14:23"
  function cdTlFmt(ts){
    if(!ts) return '—';
    var d = new Date(ts);
    if(isNaN(d.getTime())) return String(ts);
    var p = function(n){ return (n<10?'0':'')+n; };
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())
      +' '+p(d.getHours())+':'+p(d.getMinutes());
  }

  // Relative: "3天前"
  function cdTlRel(ts){
    if(!ts) return '';
    var d = new Date(ts).getTime();
    if(isNaN(d)) return '';
    var diff = Date.now() - d;
    var day = 86400000;
    if(diff < 0) return '未来';
    if(diff < 3600000) return Math.max(1, Math.floor(diff/60000)) + '分钟前';
    if(diff < day) return Math.floor(diff/3600000) + '小时前';
    if(diff < day*30) return Math.floor(diff/day) + '天前';
    if(diff < day*365) return Math.floor(diff/day/30) + '个月前';
    return Math.floor(diff/day/365) + '年前';
  }

  function cdTlDaysBetween(a, b){
    if(!a || !b) return null;
    var t1 = new Date(a).getTime(), t2 = new Date(b).getTime();
    if(isNaN(t1) || isNaN(t2)) return null;
    return Math.abs(t2 - t1) / 86400000;
  }

  function cdTlDebounce(fn, ms){
    var t = null;
    return function(){
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function(){ fn.apply(self, args); }, ms);
    };
  }

  function cdTlCopy(text, done){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ done && done(true); })
        .catch(function(){ cdTlFallbackCopy(text, done); });
    }else{
      cdTlFallbackCopy(text, done);
    }
  }
  function cdTlFallbackCopy(text, done){
    try{
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      done && done(true);
    }catch(e){ done && done(false); }
  }

  // ============================================================
  // Global: cdTimelineAdd — the single write entry point used by
  // followup / reply / blocker / dormant modules. Must never throw.
  // ============================================================
  window.cdTimelineAdd = function(customerId, ev){
    try{
      ev = ev || {};
      var c = cdTlFindCustomer(customerId);
      if(!c){ console.warn('[cdTimelineAdd] customer not found:', customerId); return null; }
      if(!Array.isArray(c.cdTimeline)) c.cdTimeline = [];

      var type = ev.type && CD_TIMELINE_TYPES[ev.type] ? ev.type : 'note';
      var event = {
        id: 'cd_tl_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
        type: type,
        timestamp: ev.timestamp || cdTlNow(),
        content: String(ev.content || '').slice(0, 500),
        actor: ev.actor && CD_TL_ACTORS[ev.actor] ? ev.actor : 'system',
        meta: ev.meta && typeof ev.meta === 'object' ? ev.meta : {}
      };
      c.cdTimeline.push(event);
      if(c.cdTimeline.length > CD_TL_MAX_EVENTS){
        c.cdTimeline = c.cdTimeline.slice(-CD_TL_MAX_EVENTS);
      }
      c.lastInteraction = event.timestamp;
      if(typeof persist === 'function') persist();
      return event;
    }catch(e){
      console.warn('[cdTimelineAdd] error:', e);
      return null;
    }
  };

  // ============================================================
  // Global: cdTimelineGet — sorted (newest first), optional filter
  // filterType: string (single type) or array of strings.
  // ============================================================
  window.cdTimelineGet = function(customerId, filterType){
    var c = cdTlFindCustomer(customerId);
    if(!c || !Array.isArray(c.cdTimeline)) return [];
    var list = c.cdTimeline.slice();
    if(filterType){
      var allowed = Array.isArray(filterType) ? filterType : [filterType];
      var set = {};
      allowed.forEach(function(t){ set[t] = 1; });
      list = list.filter(function(e){ return set[e.type]; });
    }
    list.sort(function(a,b){
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    return list;
  };

  // ============================================================
  // Global: cdTimelineStats
  // Returns { totalCount, lastFollowUp, avgInterval, typeCounts }
  // ============================================================
  window.cdTimelineStats = function(customerId){
    var c = cdTlFindCustomer(customerId);
    var out = { totalCount:0, lastFollowUp:null, avgInterval:null, typeCounts:{} };
    if(!c || !Array.isArray(c.cdTimeline)) return out;

    out.totalCount = c.cdTimeline.length;

    // type counts
    c.cdTimeline.forEach(function(e){
      out.typeCounts[e.type] = (out.typeCounts[e.type] || 0) + 1;
    });

    // contact events sorted ascending by time
    var contacts = c.cdTimeline
      .filter(function(e){ return CD_TL_CONTACT_TYPES.indexOf(e.type) >= 0 && e.timestamp; })
      .sort(function(a,b){ return new Date(a.timestamp) - new Date(b.timestamp); });

    if(contacts.length){
      out.lastFollowUp = contacts[contacts.length-1].timestamp;
      if(contacts.length >= 2){
        var gaps = [];
        for(var i=1;i<contacts.length;i++){
          var g = cdTlDaysBetween(contacts[i-1].timestamp, contacts[i].timestamp);
          if(g !== null && g >= 0) gaps.push(g);
        }
        if(gaps.length){
          out.avgInterval = Math.round(gaps.reduce(function(s,x){return s+x;},0)/gaps.length*10)/10;
        }
      }
    }
    return out;
  };

  // ============================================================
  // Global: cdTimelineGetLastContact
  // Priority: cdTimeline contact events → cdFollowup.firstSentAt →
  // S.sendRecords (max sentAt) → c.lastInteraction.
  // Never throws; returns ISO string or null.
  // ============================================================
  window.cdTimelineGetLastContact = function(customerId){
    try{
      var c = cdTlFindCustomer(customerId);
      if(!c) return null;

      // 1) timeline contact events
      if(Array.isArray(c.cdTimeline) && c.cdTimeline.length){
        var max = null;
        c.cdTimeline.forEach(function(e){
          if(CD_TL_CONTACT_TYPES.indexOf(e.type) < 0) return;
          if(!e.timestamp) return;
          if(!max || new Date(e.timestamp) > new Date(max)) max = e.timestamp;
        });
        if(max) return max;
      }

      // 2) followup first sent
      if(c.cdFollowup && c.cdFollowup.firstSentAt) return c.cdFollowup.firstSentAt;

      // 3) sendRecords fallback
      if(Array.isArray(S.sendRecords)){
        var sMax = null;
        S.sendRecords.forEach(function(r){
          if(r.customerId !== customerId) return;
          if(!r.sentAt) return;
          if(!sMax || new Date(r.sentAt) > new Date(sMax)) sMax = r.sentAt;
        });
        if(sMax) return sMax;
      }

      // 4) legacy lastInteraction
      return c.lastInteraction || null;
    }catch(e){
      return null;
    }
  };

  // ============================================================
  // Global: cdTimelineExport — build plain-text transcript
  // ============================================================
  window.cdTimelineExport = function(customerId){
    var c = cdTlFindCustomer(customerId);
    if(!c) return '';
    var evts = window.cdTimelineGet(customerId); // newest first
    var lines = [];
    lines.push('==============================================');
    lines.push('客户沟通时间线 / Communication Timeline');
    lines.push('客户 / Customer: ' + cdTlName(c));
    lines.push('国家 / Country: ' + (c.country || '—'));
    lines.push('导出时间 / Exported: ' + cdTlNow());
    lines.push('事件总数 / Total events: ' + evts.length);
    lines.push('==============================================');
    lines.push('');
    // export chronological (oldest first) for readability
    evts.slice().reverse().forEach(function(e){
      var meta = CD_TIMELINE_TYPES[e.type] || { label:e.type, icon:'•', color:'#999' };
      var actor = CD_TL_ACTORS[e.actor] ? CD_TL_ACTORS[e.actor].label : e.actor;
      lines.push('[' + cdTlFmt(e.timestamp) + '] ' + meta.icon + ' ' + meta.label + ' (' + actor + ')');
      lines.push('  ' + (e.content || ''));
      if(e.meta && e.meta.emailId) lines.push('  [ref: ' + e.meta.emailId + ']');
      lines.push('');
    });
    return lines.join('\n');
  };

  // ============================================================
  // Auto-backfill: derive timeline events from existing c.cdEmails.
  // Idempotent — skips emails that already have a linked timeline event.
  // ============================================================
  function cdTlBackfillFromEmails(c){
    if(!c || !Array.isArray(c.cdEmails)) return;
    if(!Array.isArray(c.cdTimeline)) c.cdTimeline = [];

    // existing linked email ids
    var linked = {};
    c.cdTimeline.forEach(function(e){
      if(e.meta && e.meta.emailId) linked[e.meta.emailId] = 1;
    });

    c.cdEmails.forEach(function(email){
      if(!email || !email.id) return;
      if(linked[email.id]) return;

      var type = null;
      var actor = 'ai';
      if(email.type === 'first'){ type = 'first_outreach'; actor = 'ai'; }
      else if(/^followup/.test(email.type)){ type = 'followup'; actor = 'ai'; }
      else if(email.type === 'reply'){ type = 'customer_reply'; actor = 'customer'; }
      else if(email.type === 'ai_reply'){ type = 'our_reply'; actor = 'ai'; }
      else if(email.type === 'wakeup'){ type = 'wakeup'; actor = 'ai'; }
      if(!type) return;

      var ts = email.sentAt || email.updatedAt || email.createdAt;
      if(!ts) return;

      var summary = (email.typeLabel || email.type) + '：' + (email.subjectEn || email.subjectZh || '(无主题)');
      c.cdTimeline.push({
        id: 'cd_tl_bf_' + email.id,
        type: type,
        timestamp: ts,
        content: summary.slice(0, 300),
        actor: actor,
        meta: { emailId: email.id, backfilled: true }
      });
    });
  }

  // Run backfill for all customers at module load.
  (S.customers || []).forEach(cdTlBackfillFromEmails);

  // ============================================================
  // UI state helpers
  // ============================================================
  function cdTlSelectedCid(){
    var customers = S.customers || [];
    var cid = window._cdTlSelectedCid || (customers[0] && customers[0].id);
    var c = cid ? cdTlFindCustomer(cid) : null;
    if(!c && customers.length){ c = customers[0]; cid = c.id; window._cdTlSelectedCid = cid; }
    return { cid: cid, c: c };
  }

  // ── Page renderers ─────────────────────────────────────────
  function cdTlRenderStatsBar(c){
    var st = window.cdTimelineStats(c.id);
    var h = '<div class="cd-tl-stats">';
    h += '<div class="cd-tl-stat"><div class="cd-tl-stat-n">' + st.totalCount + '</div><div class="cd-tl-stat-l">总沟通次数</div></div>';
    h += '<div class="cd-tl-stat"><div class="cd-tl-stat-n">' + (st.lastFollowUp ? cdTlRel(st.lastFollowUp) : '—') + '</div><div class="cd-tl-stat-l">最后跟进</div></div>';
    h += '<div class="cd-tl-stat"><div class="cd-tl-stat-n">' + (st.avgInterval != null ? st.avgInterval + '天' : '—') + '</div><div class="cd-tl-stat-l">平均跟进间隔</div></div>';
    h += '</div>';

    // type chips
    h += '<div class="cd-tl-typecount">';
    Object.keys(CD_TIMELINE_TYPES).forEach(function(t){
      var n = st.typeCounts[t] || 0;
      if(!n) return;
      var m = CD_TIMELINE_TYPES[t];
      h += '<span class="cd-tl-chip" style="background:' + m.color + '18;color:' + m.color + '">' + m.icon + ' ' + m.label + ' ×' + n + '</span>';
    });
    h += '</div>';
    return h;
  }

  function cdTlRenderFilterBar(c){
    var active = window._cdTlFilters || {}; // {type:true}
    var range = window._cdTlRange || 'all';

    var h = '<div class="cd-tl-filterbar">';
    h += '<div class="cd-tl-filter-t">事件类型：</div>';
    Object.keys(CD_TIMELINE_TYPES).forEach(function(t){
      var m = CD_TIMELINE_TYPES[t];
      var on = !!active[t];
      h += '<label class="cd-tl-fcheck' + (on?' on':'') + '">'
        + '<input type="checkbox" ' + (on?'checked':'') + ' onchange="cdTlToggleFilter(\'' + t + '\')">'
        + m.icon + ' ' + m.label + '</label>';
    });
    h += '</div>';

    h += '<div class="cd-tl-filterbar cd-tl-rangebar">';
    h += '<span class="cd-tl-filter-t">时间范围：</span>';
    [['all','全部'],['7d','近7天'],['30d','近30天'],['90d','近90天']].forEach(function(o){
      h += '<button class="cd-tl-mode' + (range===o[0]?' on':'') + '" onclick="cdTlSetRange(\'' + o[0] + '\')">' + o[1] + '</button>';
    });
    h += '<span style="flex:1"></span>';
    h += '<button class="cd-tl-mode" onclick="cdTlExpandAll(true)">⊕ 全部展开</button>';
    h += '<button class="cd-tl-mode" onclick="cdTlExpandAll(false)">⊖ 全部收起</button>';
    h += '</div>';
    return h;
  }

  function cdTlRenderAddForm(c){
    var open = window._cdTlShowForm === true;
    var h = '<div class="cd-tl-form-wrap">';
    h += '<div class="cd-tl-form-head" onclick="cdTlToggleForm()">➕ 手动记录事件 ' + (open?'▲':'▼') + '</div>';
    if(open){
      h += '<div class="cd-tl-form">';
      h += '<div class="cd-tl-form-row"><label class="cd-tl-form-l">类型</label><select class="cd-tl-input" id="cdTlAddType">';
      CD_TL_MANUAL_TYPES.forEach(function(t){
        var m = CD_TIMELINE_TYPES[t];
        h += '<option value="' + t + '">' + m.icon + ' ' + m.label + '</option>';
      });
      h += '</select></div>';
      h += '<div class="cd-tl-form-row"><label class="cd-tl-form-l">内容</label><textarea class="cd-tl-input" id="cdTlAddContent" rows="3" placeholder="事件摘要，例如：电话沟通了15分钟，客户对XX感兴趣，要求下周三再联系"></textarea></div>';
      h += '<div class="cd-tl-form-row"><label class="cd-tl-form-l">日期时间</label><input class="cd-tl-input" type="datetime-local" id="cdTlAddDate"></div>';
      h += '<div class="cd-tl-form-row"><label class="cd-tl-form-l"></label><button class="btn btn-primary btn-sm" onclick="cdTlSubmitAdd(\'' + c.id + '\')">✅ 添加事件</button></div>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function cdTlRenderEvent(e){
    var m = CD_TIMELINE_TYPES[e.type] || { label:e.type, icon:'•', color:'#999' };
    var actor = CD_TL_ACTORS[e.actor] || { label:e.actor||'?', color:'#999' };
    var collapsed = window._cdTlCollapsed === true;

    var h = '<div class="cd-tl-item">';
    h += '<div class="cd-tl-dot" style="background:' + m.color + '">' + m.icon + '</div>';
    h += '<div class="cd-tl-line"></div>';
    h += '<div class="cd-tl-card" style="border-left:3px solid ' + m.color + '">';
    h += '<div class="cd-tl-card-head">';
    h += '<span class="cd-tl-badge" style="background:' + m.color + '20;color:' + m.color + '">' + m.icon + ' ' + m.label + '</span>';
    h += '<span class="cd-tl-actor" style="color:' + actor.color + '">👤 ' + actor.label + '</span>';
    h += '<span class="cd-tl-ts">' + cdTlFmt(e.timestamp) + ' · ' + cdTlRel(e.timestamp) + '</span>';
    h += '</div>';
    h += '<div class="cd-tl-card-body' + (collapsed?' cd-tl-collapsed':'') + '">' + esc(e.content || '') + '</div>';
    if(e.meta && e.meta.emailId){
      h += '<div class="cd-tl-meta">📎 ' + esc(e.meta.emailId) + (e.meta.backfilled ? ' <span class="cd-tl-bf">自动补录</span>' : '') + '</div>';
    }
    h += '</div></div>';
    return h;
  }

  function cdTlRenderTimeline(c){
    var filters = window._cdTlFilters || {};
    var range = window._cdTlRange || 'all';

    var evts = window.cdTimelineGet(c.id);

    // type filter: if no filters selected → show all
    var hasTypeFilter = Object.keys(filters).some(function(k){ return filters[k]; });
    if(hasTypeFilter){
      evts = evts.filter(function(e){ return filters[e.type]; });
    }

    // range filter
    if(range !== 'all'){
      var days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
      var cutoff = Date.now() - days*86400000;
      evts = evts.filter(function(e){
        var t = new Date(e.timestamp).getTime();
        return !isNaN(t) && t >= cutoff;
      });
    }

    if(!evts.length){
      return '<div class="cd-tl-empty">暂无符合条件的事件。开发信生成/发送、客户回复、AI草稿等操作会自动记录到这里；也可以用上方表单手动添加通话、样品、报价等事件。</div>';
    }

    var h = '<div class="cd-tl-list">';
    evts.forEach(function(e){ h += cdTlRenderEvent(e); });
    h += '</div>';
    return h;
  }

  function cdTlRenderPage(root){
    var customers = S.customers || [];
    var sel = cdTlSelectedCid();
    var cid = sel.cid, c = sel.c;

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '<div><h2 style="margin:0">📅 客户沟通时间线</h2>'
      + '<div class="text-sm text-muted" style="margin-top:4px">13种事件类型 · 自动记录 + 手动补录 · 筛选 / 导出 / 统计</div></div>';
    h += '<div class="cd-tl-actions">';
    h += '<button class="btn btn-outline btn-sm" onclick="cdTlCopyExport(\'' + cid + '\')">📋 复制到剪贴板</button>';
    h += '<button class="btn btn-outline btn-sm" onclick="cdTlDownloadExport(\'' + cid + '\')">⬇️ 下载 .txt</button>';
    h += '</div></div>';

    if(!customers.length){
      h += '<div class="cd-tl-empty">客户台账为空。</div>';
      root.innerHTML = h; return;
    }

    // customer selector
    h += '<div class="cd-tl-selector"><label class="cd-tl-sel-label">选择客户：</label>';
    h += '<select class="cd-tl-sel" onchange="cdTlSelectCustomer(this.value)">';
    customers.forEach(function(x){
      h += '<option value="' + esc(x.id) + '"' + (x.id===cid?' selected':'') + '>'
        + esc(cdTlName(x)) + '（' + esc(x.country||'未知') + '）</option>';
    });
    h += '</select></div>';

    if(!c){ root.innerHTML = h; return; }

    h += cdTlRenderStatsBar(c);
    h += cdTlRenderFilterBar(c);
    h += cdTlRenderAddForm(c);
    h += cdTlRenderTimeline(c);

    h += '<div class="cd-tl-footer">🔒 本模块只记录与展示沟通事件，不自动发送邮件/WhatsApp。</div>';

    root.innerHTML = h;
  }

  // ============================================================
  // Window-exposed UI handlers
  // ============================================================
  window.cdTlSelectCustomer = function(cid){
    window._cdTlSelectedCid = cid;
    window._cdTlFilters = {};
    window._cdTlRange = 'all';
    window._cdTlShowForm = false;
    renderView();
  };

  window.cdTlToggleFilter = function(type){
    window._cdTlFilters = window._cdTlFilters || {};
    window._cdTlFilters[type] = !window._cdTlFilters[type];
    renderView();
  };

  window.cdTlSetRange = function(r){
    window._cdTlRange = r;
    renderView();
  };

  window.cdTlExpandAll = function(expand){
    window._cdTlCollapsed = !expand;
    renderView();
  };

  window.cdTlToggleForm = function(){
    window._cdTlShowForm = !window._cdTlShowForm;
    renderView();
  };

  window.cdTlSubmitAdd = function(cid){
    var typeEl = document.getElementById('cdTlAddType');
    var contentEl = document.getElementById('cdTlAddContent');
    var dateEl = document.getElementById('cdTlAddDate');
    var type = typeEl ? typeEl.value : 'note';
    var content = contentEl ? contentEl.value.trim() : '';
    if(!content){ toast('请填写事件内容', 'err'); return; }

    var ts = cdTlNow();
    if(dateEl && dateEl.value){
      // datetime-local is local time; convert to ISO
      var d = new Date(dateEl.value);
      if(!isNaN(d.getTime())) ts = d.toISOString();
    }

    window.cdTimelineAdd(cid, { type: type, content: content, actor: 'user', timestamp: ts });
    toast('✅ 已添加「' + (CD_TIMELINE_TYPES[type]||{}).label + '」事件');
    window._cdTlShowForm = false;
    renderView();
  };

  window.cdTlCopyExport = function(cid){
    var text = window.cdTimelineExport(cid);
    if(!text){ toast('无可导出内容', 'err'); return; }
    cdTlCopy(text, function(ok){
      toast(ok ? '✅ 时间线已复制到剪贴板' : '复制失败，请手动选择', ok ? 'ok' : 'err');
    });
  };

  window.cdTlDownloadExport = function(cid){
    var text = window.cdTimelineExport(cid);
    if(!text){ toast('无可导出内容', 'err'); return; }
    var c = cdTlFindCustomer(cid);
    var name = cdTlName(c).replace(/[\\\/:*?"<>|]/g, '_').slice(0, 40);
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'timeline_' + name + '_' + new Date().toISOString().slice(0,10) + '.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    toast('✅ 已下载 .txt 文件');
  };

  // ============================================================
  // renderView interception
  // ============================================================
  var _cdTlOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'customerDevTimeline'){
      cdTlRenderPage(document.getElementById('mainContent'));
      return;
    }
    _cdTlOrigRV.apply(this, arguments);
  };

  // ============================================================
  // Styles (cd- prefixed)
  // ============================================================
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-tl-selector{display:flex;align-items:center;gap:10px;margin-bottom:14px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;}'
    + '.cd-tl-sel-label{font-size:13px;color:#4a5568;font-weight:600;}'
    + '.cd-tl-sel{flex:1;max-width:560px;padding:7px 10px;border:1px solid #cbd5e0;border-radius:8px;font-size:13px;background:#fff;}'
    + '.cd-tl-actions{display:flex;gap:6px;}'
    // stats
    + '.cd-tl-stats{display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap;}'
    + '.cd-tl-stat{flex:1;min-width:140px;background:#ebf8ff;border:1px solid #bee3f8;border-radius:10px;padding:12px;text-align:center;}'
    + '.cd-tl-stat-n{font-size:22px;font-weight:700;color:#2b6cb0;}'
    + '.cd-tl-stat-l{font-size:12px;color:#4a5568;margin-top:2px;}'
    + '.cd-tl-typecount{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;}'
    + '.cd-tl-chip{font-size:11.5px;padding:3px 10px;border-radius:10px;}'
    // filter bar
    + '.cd-tl-filterbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin-bottom:8px;}'
    + '.cd-tl-rangebar{margin-bottom:14px;}'
    + '.cd-tl-filter-t{font-size:12.5px;color:#718096;font-weight:600;flex-shrink:0;}'
    + '.cd-tl-fcheck{font-size:12px;color:#4a5568;display:inline-flex;align-items:center;gap:3px;cursor:pointer;padding:2px 6px;border-radius:6px;background:#f7fafc;border:1px solid #e2e8f0;}'
    + '.cd-tl-fcheck.on{background:#ebf8ff;border-color:#90cdf4;color:#2b6cb0;}'
    + '.cd-tl-fcheck input{margin:0;}'
    + '.cd-tl-mode{font-size:12px;padding:4px 12px;border:1px solid #e2e8f0;border-radius:14px;cursor:pointer;background:#fff;color:#4a5568;}'
    + '.cd-tl-mode.on{background:#3182ce;color:#fff;border-color:#3182ce;}'
    // add form
    + '.cd-tl-form-wrap{background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:14px;overflow:hidden;}'
    + '.cd-tl-form-head{padding:10px 14px;font-size:13px;font-weight:600;color:#2d3748;cursor:pointer;background:#f7fafc;}'
    + '.cd-tl-form{padding:14px;display:flex;flex-direction:column;gap:10px;}'
    + '.cd-tl-form-row{display:flex;align-items:flex-start;gap:10px;}'
    + '.cd-tl-form-l{width:80px;font-size:12.5px;color:#718096;font-weight:600;flex-shrink:0;padding-top:7px;}'
    + '.cd-tl-input{flex:1;padding:7px 10px;border:1px solid #cbd5e0;border-radius:8px;font-size:13px;font-family:inherit;box-sizing:border-box;}'
    + 'textarea.cd-tl-input{resize:vertical;}'
    // timeline list
    + '.cd-tl-list{position:relative;padding-left:8px;}'
    + '.cd-tl-item{position:relative;display:flex;gap:12px;margin-bottom:6px;}'
    + '.cd-tl-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;z-index:1;background:#fff;border:2px solid #e2e8f0;}'
    + '.cd-tl-line{position:absolute;left:21px;top:28px;bottom:-6px;width:2px;background:#e2e8f0;}'
    + '.cd-tl-item:last-child .cd-tl-line{display:none;}'
    + '.cd-tl-card{flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin-bottom:8px;}'
    + '.cd-tl-card-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;}'
    + '.cd-tl-badge{font-size:11.5px;font-weight:600;padding:2px 9px;border-radius:10px;}'
    + '.cd-tl-actor{font-size:11.5px;font-weight:600;}'
    + '.cd-tl-ts{font-size:11.5px;color:#a0aec0;margin-left:auto;}'
    + '.cd-tl-card-body{font-size:13px;color:#2d3748;line-height:1.7;white-space:pre-wrap;word-break:break-word;}'
    + '.cd-tl-collapsed{max-height:3.6em;overflow:hidden;}'
    + '.cd-tl-meta{font-size:11px;color:#a0aec0;margin-top:6px;}'
    + '.cd-tl-bf{background:#edf2f7;padding:1px 6px;border-radius:4px;margin-left:4px;}'
    + '.cd-tl-empty{padding:36px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;font-size:13px;line-height:1.8;}'
    + '.cd-tl-footer{margin-top:16px;padding:10px;background:#fff5f5;border:1px solid #fed7d7;border-radius:10px;text-align:center;font-size:12px;color:#c53030;}'
    // responsive
    + '@media (max-width:900px){'
    + '  .cd-tl-filterbar{gap:5px;}'
    + '  .cd-tl-form-row{flex-direction:column;}'
    + '  .cd-tl-form-l{width:auto;padding-top:0;}'
    + '  .cd-tl-stat{min-width:100px;}'
    + '  .cd-tl-ts{margin-left:0;width:100%;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
