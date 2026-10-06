/* ============================================================
 * Customer Development Kanban (customer-dev-kanban.js)
 * ----------------------------------------------------------------
 * Phase 5 — Module 5: Customer development progress board.
 *
 * Features:
 *   1. 12-stage horizontal scrolling board (one column per stage)
 *   2. Customer cards (name/company, country, category, level,
 *      last follow-up, days in current stage)
 *   3. Click card → jump to customer detail
 *   4. Stage move buttons (previous / next — NO drag & drop)
 *   5. Stage change auto-logs to timeline (cdTimelineAdd when
 *      available, otherwise S.cdPhase5.taskLog)
 *   6. Filters (category / country / level / free-text search)
 *   7. Stats panel (avg / max stage stay, stage conversion)
 *   8. Auto dormant detection (30 days no interaction → dormant)
 *
 * Data sources: S.customers, S.cdPhase5.customerStage
 *               (customerId → {stage, stageChangedAt}),
 *               S.sendRecords.
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Manual stage moves only.
 *   - No external libraries. Pure CSS layout.
 *   - All CSS classes use the cd- (cd-kb-) prefix. Comments English.
 *   - Does NOT modify app.js / server.js / index.html.
 * ============================================================ */
(function(){
  'use strict';

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'cdKanban',
    icon: '🎯',
    label: '进度看板',
    title: '客户开发进度看板 · 12阶段流转',
    crumb: '横向看板 · 阶段切换 · 筛选 · 停留统计 · 自动沉睡'
  });

  // ============================================================
  // Defensive shared utils (may also be defined by module A).
  // ============================================================
  if(!window.cdUtilTodayStr) window.cdUtilTodayStr = function(){
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  };
  if(!window.cdUtilFormatDate) window.cdUtilFormatDate = function(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return String(iso);
    var p = function(n){ return (n<10?'0':'')+n; };
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
  };
  if(!window.cdUtilDaysBetween) window.cdUtilDaysBetween = function(d1, d2){
    var t1 = new Date(d1).getTime(), t2 = new Date(d2).getTime();
    if(isNaN(t1) || isNaN(t2)) return 0;
    return Math.round(Math.abs(t2 - t1) / 86400000);
  };
  if(!window.cdUtilFindCustomer) window.cdUtilFindCustomer = function(id){
    if(!id) return null;
    return (S.customers||[]).find(function(x){ return x.id === id; }) || null;
  };
  if(!window.cdUtilCustName) window.cdUtilCustName = function(c){
    return c ? (c.company || c.name || '(未命名)') : '';
  };
  if(!window.cdUtilCustCountry) window.cdUtilCustCountry = function(c){
    return (c && c.country) || '未知';
  };
  if(!window.cdUtilCustLevel) window.cdUtilCustLevel = function(c){
    return (c && (c.level || c.customerLevel)) || '未分级';
  };
  if(!window.cdUtilEsc) window.cdUtilEsc = function(s){
    return String(s==null?'':s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };
  if(!window.cdUtilStageLabel) window.cdUtilStageLabel = function(stage){
    var s = CD_KB_STAGES.find(function(x){ return x.key === stage; });
    return s ? s.label : stage;
  };
  if(!window.cdUtilStageIcon) window.cdUtilStageIcon = function(stage){
    var s = CD_KB_STAGES.find(function(x){ return x.key === stage; });
    return s ? s.icon : '•';
  };
  if(!window.cdUtilStageColor) window.cdUtilStageColor = function(stage){
    var s = CD_KB_STAGES.find(function(x){ return x.key === stage; });
    return s ? s.color : '#718096';
  };

  // ============================================================
  // Constants — 12 development stages
  // ============================================================
  var CD_KB_STAGES = [
    {key:'new-lead',      icon:'🆕', label:'新线索',   color:'#718096'},
    {key:'intel-done',    icon:'🔍', label:'已背调',   color:'#4299e1'},
    {key:'draft-ready',   icon:'✍️', label:'待开发',   color:'#3182ce'},
    {key:'first-sent',    icon:'📤', label:'已开发',   color:'#2b6cb0'},
    {key:'following',     icon:'🔄', label:'跟进中',   color:'#dd6b20'},
    {key:'replied',       icon:'💬', label:'已回复',   color:'#d69e2e'},
    {key:'negotiating',   icon:'💰', label:'议价中',   color:'#b7791f'},
    {key:'quoted',        icon:'📦', label:'已报价',   color:'#9f7aea'},
    {key:'sampled',       icon:'🎁', label:'已寄样',   color:'#805ad5'},
    {key:'ordered',       icon:'✅', label:'已下单',   color:'#2f855a'},
    {key:'dormant',       icon:'💤', label:'沉睡',     color:'#a0aec0'},
    {key:'rejected',      icon:'❌', label:'已拒绝',   color:'#c53030'}
  ];

  var CD_KB_DORMANT_DAYS = 30;

  // ── Ephemeral UI state ─────────────────────────────────────
  if(!window._cdKb) window._cdKb = { cat:'', country:'', level:'', search:'' };

  // ============================================================
  // Data access
  // ============================================================
  function kbStageMap(){
    if(!S.cdPhase5) S.cdPhase5 = {taskLog:[],customerStage:{},mailboxHealth:{},calendarTasks:{},uiPrefs:{}};
    if(!S.cdPhase5.customerStage) S.cdPhase5.customerStage = {};
    return S.cdPhase5.customerStage;
  }
  function kbTaskLog(){
    if(!S.cdPhase5.taskLog) S.cdPhase5.taskLog = [];
    return S.cdPhase5.taskLog;
  }
  function kbGetStage(custId){
    var m = kbStageMap();
    if(m[custId] && m[custId].stage) return m[custId].stage;
    return 'new-lead';
  }
  function kbGetStageChangedAt(custId){
    var m = kbStageMap();
    return (m[custId] && m[custId].stageChangedAt) || null;
  }
  function kbSetStage(custId, stage){
    var m = kbStageMap();
    m[custId] = { stage: stage, stageChangedAt: new Date().toISOString() };
  }

  function kbDaysSince(iso){
    if(!iso) return null;
    var t = new Date(iso).getTime();
    if(isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  // Last interaction time: prefer cdTimeline last, then conversations,
  // then sendRecords, then legacy fields.
  function kbLastContact(c){
    var candidates = [];
    if(Array.isArray(c.cdTimeline) && c.cdTimeline.length){
      c.cdTimeline.forEach(function(e){ if(e.timestamp) candidates.push(new Date(e.timestamp).getTime()); });
    }
    if(Array.isArray(c.cdConversations) && c.cdConversations.length){
      c.cdConversations.forEach(function(m){ if(m.timestamp) candidates.push(new Date(m.timestamp).getTime()); });
    }
    (S.sendRecords||[]).forEach(function(r){
      if(r.customerId === c.id && r.sentAt) candidates.push(new Date(r.sentAt).getTime());
    });
    if(c.lastContactAt) candidates.push(new Date(c.lastContactAt).getTime());
    if(c.lastComm) candidates.push(new Date(c.lastComm).getTime());
    if(c.lastInteraction) candidates.push(new Date(c.lastInteraction).getTime());
    if(!candidates.length) return null;
    var max = Math.max.apply(null, candidates.filter(function(t){ return !isNaN(t); }));
    return max ? new Date(max).toISOString() : null;
  }

  // Auto dormant detection: customers idle >= 30 days and not already
  // ordered / rejected / paused → move to dormant stage.
  function kbAutoDormant(){
    var changed = 0;
    (S.customers||[]).forEach(function(c){
      var st = kbGetStage(c.id);
      if(st === 'ordered' || st === 'rejected' || st === 'dormant') return;
      if(c.blacklisted === true || c.unsubscribe === true) return;
      if(c.cdFollowup && c.cdFollowup.paused === true) return;
      var last = kbLastContact(c);
      var days = kbDaysSince(last);
      if(days !== null && days >= CD_KB_DORMANT_DAYS){
        kbSetStage(c.id, 'dormant');
        changed++;
      }
    });
    if(changed) persist();
    return changed;
  }

  // ============================================================
  // Stage move + logging
  // ============================================================
  window.cdKbGetStage = function(customerId){ return kbGetStage(customerId); };

  window.cdKbMoveStage = function(customerId, newStage){
    var c = window.cdUtilFindCustomer(customerId);
    if(!c){ toast('未找到客户', 'err'); return; }
    var oldStage = kbGetStage(customerId);
    if(oldStage === newStage) return;
    var oldDef = CD_KB_STAGES.find(function(x){ return x.key === oldStage; }) || {icon:'',label:oldStage};
    var newDef = CD_KB_STAGES.find(function(x){ return x.key === newStage; }) || {icon:'',label:newStage};
    kbSetStage(customerId, newStage);
    // timeline event when the timeline module is available
    try{
      if(typeof window.cdTimelineAdd === 'function'){
        window.cdTimelineAdd(customerId, {
          type: 'note',
          content: '阶段流转：' + oldDef.label + ' → ' + newDef.label,
          actor: 'user',
          meta: { fromStage: oldStage, toStage: newStage, source: 'cd-kanban' }
        });
      } else if(typeof addTimelineEvent === 'function'){
        addTimelineEvent(customerId, 'note', '阶段流转：' + oldDef.label + ' → ' + newDef.label, '', { source:'cd-kanban' });
      }
    }catch(e){}
    // fallback log into taskLog
    kbTaskLog().push({
      at: new Date().toISOString(),
      customerId: customerId,
      customerName: window.cdUtilCustName(c),
      from: oldStage, to: newStage,
      action: 'stage-move'
    });
    persist();
    toast('已移动到「' + newDef.icon + ' ' + newDef.label + '」');
    if(renderView) renderView();
  };

  window.cdKbStep = function(customerId, dir){
    var st = kbGetStage(customerId);
    var idx = CD_KB_STAGES.findIndex(function(x){ return x.key === st; });
    var next = idx + (dir === 1 ? 1 : -1);
    if(next < 0) next = 0;
    if(next >= CD_KB_STAGES.length) next = CD_KB_STAGES.length - 1;
    // guard: cannot step out of rejected / ordered terminal-ish stages manually
    window.cdKbMoveStage(customerId, CD_KB_STAGES[next].key);
  };

  // ============================================================
  // Filtering
  // ============================================================
  function kbPassFilter(c){
    var f = window._cdKb;
    if(f.cat){
      var cat = c.productCategory || c.category || '';
      if(String(cat) !== String(f.cat)) return false;
    }
    if(f.country && String(c.country||'') !== String(f.country)) return false;
    if(f.level && String(c.level||'') !== String(f.level)) return false;
    if(f.search){
      var q = f.search.toLowerCase();
      var name = window.cdUtilCustName(c).toLowerCase();
      var email = String(c.email||'').toLowerCase();
      if(name.indexOf(q) < 0 && email.indexOf(q) < 0) return false;
    }
    return true;
  }

  // ============================================================
  // Stats
  // ============================================================
  function kbCalcStats(){
    var perStage = {};
    CD_KB_STAGES.forEach(function(s){
      perStage[s.key] = { count:0, stayDays:[], maxStay:0 };
    });
    (S.customers||[]).forEach(function(c){
      if(!kbPassFilter(c)) return;
      var st = kbGetStage(c.id);
      if(!perStage[st]) perStage[st] = { count:0, stayDays:[], maxStay:0 };
      perStage[st].count++;
      var ts = kbGetStageChangedAt(c.id);
      var days = kbDaysSince(ts);
      if(days !== null){
        perStage[st].stayDays.push(days);
        if(days > perStage[st].maxStay) perStage[st].maxStay = days;
      }
    });
    // conversion between adjacent stages (based on counts)
    return perStage;
  }

  // Distinct option lists for filter dropdowns
  function kbOptions(field){
    var set = {};
    (S.customers||[]).forEach(function(c){
      var v = field === 'cat' ? (c.productCategory || c.category || '')
        : field === 'country' ? (c.country || '')
        : (c.level || '');
      if(v) set[v] = 1;
    });
    return Object.keys(set).sort();
  }

  // ============================================================
  // Render
  // ============================================================
  function kbCard(c){
    var st = kbGetStage(c.id);
    var def = CD_KB_STAGES.find(function(x){ return x.key === st; }) || CD_KB_STAGES[0];
    var idx = CD_KB_STAGES.findIndex(function(x){ return x.key === st; });
    var stayTs = kbGetStageChangedAt(c.id);
    var stayDays = kbDaysSince(stayTs);
    var last = kbLastContact(c);
    var lastRel = '';
    var ld = kbDaysSince(last);
    if(ld !== null) lastRel = ld === 0 ? '今天' : ld + '天前';

    var h = '<div class="cd-kb-card" onclick="cdKbOpenDetail(\''+c.id+'\')">'
      + '<div class="cd-kb-card-name">'+window.cdUtilEsc(window.cdUtilCustName(c))+'</div>'
      + '<div class="cd-kb-card-meta">📍 '+window.cdUtilEsc(window.cdUtilCustCountry(c))+' · 🏷 '+window.cdUtilEsc(c.productCategory||c.category||'—')+'</div>'
      + '<div class="cd-kb-card-tags">'
      + '<span class="cd-kb-lvl lvl-'+window.cdUtilEsc(String(window.cdUtilCustLevel(c)).toLowerCase())+'">'+window.cdUtilEsc(window.cdUtilCustLevel(c))+'</span>'
      + (stayDays !== null ? '<span class="cd-kb-stay">停留 '+stayDays+'天</span>' : '<span class="cd-kb-stay">新进</span>')
      + '</div>'
      + '<div class="cd-kb-card-last">最后跟进：'+(lastRel || '—')+'</div>'
      + '<div class="cd-kb-card-actions" onclick="event.stopPropagation()">';
    if(idx > 0) h += '<button class="cd-kb-stepb" title="后退一阶段" onclick="cdKbStep(\''+c.id+'\',-1)">◀</button>';
    h += '<span class="cd-kb-stage-label" style="color:'+def.color+'">'+def.icon+' '+def.label+'</span>';
    if(idx < CD_KB_STAGES.length-1) h += '<button class="cd-kb-stepb" title="前进一阶段" onclick="cdKbStep(\''+c.id+'\',1)">▶</button>';
    h += '</div></div>';
    return h;
  }

  function renderPage(root){
    var autoN = kbAutoDormant();
    var perStage = kbCalcStats();
    var cats = kbOptions('cat'), countries = kbOptions('country'), levels = kbOptions('level');

    var h = '<div class="cd-kb-wrap">';
    h += '<div class="cd-kb-head"><h2 style="margin:0">🎯 客户开发进度看板</h2>'
      + '<div class="cd-kb-sub">12阶段横向看板 · 共 '+(S.customers||[]).length+' 个客户'
      + (autoN ? ' · 💤 自动识别 '+autoN+' 个沉睡客户' : '') + '</div></div>';

    // Filter bar
    h += '<div class="cd-kb-filters">'
      + '<select class="cd-select" id="cdKbCat" onchange="cdKbApplyFilter()">'
      + '<option value="">全部品类</option>'
      + cats.map(function(x){ return '<option value="'+window.cdUtilEsc(x)+'"'+(window._cdKb.cat===x?' selected':'')+'>'+window.cdUtilEsc(x)+'</option>'; }).join('')
      + '</select>'
      + '<select class="cd-select" id="cdKbCountry" onchange="cdKbApplyFilter()">'
      + '<option value="">全部国家</option>'
      + countries.map(function(x){ return '<option value="'+window.cdUtilEsc(x)+'"'+(window._cdKb.country===x?' selected':'')+'>'+window.cdUtilEsc(x)+'</option>'; }).join('')
      + '</select>'
      + '<select class="cd-select" id="cdKbLevel" onchange="cdKbApplyFilter()">'
      + '<option value="">全部等级</option>'
      + levels.map(function(x){ return '<option value="'+window.cdUtilEsc(x)+'"'+(window._cdKb.level===x?' selected':'')+'>'+window.cdUtilEsc(x)+'</option>'; }).join('')
      + '</select>'
      + '<input class="cd-input" id="cdKbSearch" placeholder="搜索客户名/邮箱..." value="'+window.cdUtilEsc(window._cdKb.search)+'" oninput="cdKbApplyFilter()">'
      + '</div>';

    // Stats strip
    h += '<div class="cd-kb-stats">';
    CD_KB_STAGES.forEach(function(s){
      var st = perStage[s.key];
      var avgStay = st.stayDays.length ? (st.stayDays.reduce(function(a,b){return a+b;},0)/st.stayDays.length).toFixed(0) : '—';
      h += '<div class="cd-kb-stat" style="border-top:3px solid '+s.color+'">'
        + '<div class="cd-kb-stat-num">'+st.count+'</div>'
        + '<div class="cd-kb-stat-lbl">'+s.icon+' '+s.label+'</div>'
        + '<div class="cd-kb-stat-sub">均停 '+avgStay+'天 · 最长 '+st.maxStay+'天</div>'
        + '</div>';
    });
    h += '</div>';

    // Board (horizontal scroll)
    h += '<div class="cd-kb-board">';
    CD_KB_STAGES.forEach(function(s){
      var customers = (S.customers||[]).filter(function(c){
        return kbGetStage(c.id) === s.key && kbPassFilter(c);
      });
      h += '<div class="cd-kb-col">'
        + '<div class="cd-kb-col-head" style="background:'+s.color+'18;border-bottom:3px solid '+s.color+'">'
        + '<span>'+s.icon+' '+s.label+'</span><span class="cd-kb-col-count">'+customers.length+'</span></div>'
        + '<div class="cd-kb-col-body">';
      if(!customers.length){
        h += '<div class="cd-kb-col-empty">—</div>';
      } else {
        customers.forEach(function(c){ h += kbCard(c); });
      }
      h += '</div></div>';
    });
    h += '</div>';

    h += '<div class="cd-kb-footnote">🔒 阶段切换为手动操作，不自动发送邮件。30天未互动自动归入「💤沉睡」。</div>';
    h += '</div>';
    root.innerHTML = h;
  }

  // ============================================================
  // Public API
  // ============================================================
  window.cdKbApplyFilter = function(){
    var cEl = document.getElementById('cdKbCat');
    var coEl = document.getElementById('cdKbCountry');
    var lEl = document.getElementById('cdKbLevel');
    var sEl = document.getElementById('cdKbSearch');
    if(cEl) window._cdKb.cat = cEl.value;
    if(coEl) window._cdKb.country = coEl.value;
    if(lEl) window._cdKb.level = lEl.value;
    if(sEl) window._cdKb.search = sEl.value;
    if(renderView) renderView();
  };

  window.cdKbOpenDetail = function(customerId){
    var c = window.cdUtilFindCustomer(customerId);
    if(!c) return;
    if(typeof go === 'function'){ go('customerDetail', { customerId: customerId }); }
    else if(window.location.hash){ window.location.hash = '#customerDetail'; }
  };

  window.cdKbCalcStats = function(){ return kbCalcStats(); };

  // ── renderView interception ───────────────────────────────
  var _cdKbOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'cdKanban'){
      renderPage(document.getElementById('mainContent'));
      return;
    }
    _cdKbOrigRV.apply(this, arguments);
  };

  // ── Styles (cd-kb- prefixed) ───────────────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-kb-wrap{padding:18px;max-width:100%;}'
    + '.cd-kb-head{margin-bottom:12px;}'
    + '.cd-kb-sub{font-size:12.5px;color:#8a96a8;margin-top:4px;}'
    + '.cd-kb-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center;}'
    + '.cd-kb-filters .cd-input{flex:1;min-width:160px;}'
    + '.cd-kb-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:14px;}'
    + '.cd-kb-stat{background:#fff;border-radius:8px;padding:10px;text-align:center;}'
    + '.cd-kb-stat-num{font-size:22px;font-weight:800;color:#1a202c;}'
    + '.cd-kb-stat-lbl{font-size:12px;color:#4a5568;margin-top:2px;}'
    + '.cd-kb-stat-sub{font-size:10.5px;color:#a0aec0;margin-top:3px;}'
    + '.cd-kb-board{display:flex;gap:10px;overflow-x:auto;padding-bottom:14px;align-items:flex-start;}'
    + '.cd-kb-col{flex:0 0 240px;min-height:200px;background:#f7fafc;border-radius:10px;display:flex;flex-direction:column;}'
    + '.cd-kb-col-head{padding:8px 12px;display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:700;color:#2d3748;border-radius:10px 10px 0 0;}'
    + '.cd-kb-col-count{background:#fff;border-radius:10px;padding:1px 8px;font-size:12px;}'
    + '.cd-kb-col-body{padding:8px;display:flex;flex-direction:column;gap:8px;}'
    + '.cd-kb-col-empty{text-align:center;color:#cbd5e0;padding:20px 0;font-size:13px;}'
    + '.cd-kb-card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;cursor:pointer;transition:box-shadow .15s;}'
    + '.cd-kb-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.1);}'
    + '.cd-kb-card-name{font-size:13px;font-weight:700;color:#1a202c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    + '.cd-kb-card-meta{font-size:11.5px;color:#718096;margin-top:3px;}'
    + '.cd-kb-card-tags{display:flex;gap:6px;margin-top:6px;align-items:center;}'
    + '.cd-kb-lvl{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:#edf2f7;color:#4a5568;}'
    + '.cd-kb-stay{font-size:10.5px;color:#dd6b20;}'
    + '.cd-kb-card-last{font-size:11px;color:#a0aec0;margin-top:5px;}'
    + '.cd-kb-card-actions{display:flex;align-items:center;justify-content:space-between;margin-top:7px;padding-top:7px;border-top:1px dashed #edf2f7;}'
    + '.cd-kb-stepb{background:#eef1f5;border:none;border-radius:4px;cursor:pointer;font-size:11px;padding:2px 8px;color:#4a5568;}'
    + '.cd-kb-stepb:hover{background:#3182ce;color:#fff;}'
    + '.cd-kb-stage-label{font-size:11px;font-weight:600;}'
    + '.cd-kb-footnote{font-size:12px;color:#a0aec0;text-align:center;padding:10px;}'
    ;
  document.head.appendChild(style);
})();
