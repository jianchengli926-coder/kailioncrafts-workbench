/* ============================================================
 * Customer Development Send Calendar (customer-dev-calendar.js)
 * ----------------------------------------------------------------
 * Phase 5 — Module 6: Send calendar view.
 *
 * Features:
 *   1. Month view (default) — standard 7-col calendar grid.
 *      Each cell shows: planned sends, sent count, quota used
 *      (X/15), pending replies. Color coding:
 *        green  ≤10 sent / yellow 11-14 / red =15 (quota full)
 *   2. Week view — 7 detailed day columns
 *   3. Day view — single day detail (pending tasks + sent records
 *      + customer replies)
 *   4. Click a date → day detail panel
 *   5. Today highlighted; dot indicators on days with tasks
 *   6. Prev / next month, jump-to-today
 *   7. Manual task creation (reminder stored to
 *      S.cdPhase5.calendarTasks[dateStr])
 *   8. Month stats: total sent, completion rate, replies, reply
 *      rate, busiest day, consecutive send days
 *
 * Data sources: S.sendRecords, S.customers, S.emailAccounts,
 *               S.dailySendTasks, S.cdPhase5.calendarTasks,
 *               S.cdPhase5.taskLog.
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Task reminders only.
 *   - No external libraries. Pure CSS grid.
 *   - All CSS classes use the cd- (cd-cal-) prefix. Comments English.
 *   - Does NOT modify app.js / server.js / index.html.
 * ============================================================ */
(function(){
  'use strict';

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'cdCalendar',
    icon: '📅',
    label: '发送日历',
    title: '发送日历视图 · 月/周/日 · 配额颜色 · 任务提醒',
    crumb: '每日计划 · 已发送 · 配额X/15 · 待回复 · 手动任务'
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
  if(!window.cdUtilIsSameDay) window.cdUtilIsSameDay = function(iso, dateStr){
    if(!iso || !dateStr) return false;
    return window.cdUtilFormatDate(iso) === dateStr;
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
  if(!window.cdUtilEsc) window.cdUtilEsc = function(s){
    return String(s==null?'':s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };
  if(!window.cdUtilEmailTypeLabel) window.cdUtilEmailTypeLabel = function(type){
    var map = {
      'first-outreach':'首次开发信', 'day3-followup':'第3天跟进',
      'day7-followup':'第7天跟进', 'day14-followup':'第14天跟进',
      'day21-followup':'第21天跟进', 'day30-followup':'第30天跟进',
      'customer-reply':'客户回复', 'dormant-wakeup':'沉睡唤醒', 'other':'其他'
    };
    return map[type] || type || '其他';
  };

  var CD_CAL_DAILY_QUOTA = 15; // 3 accounts x 5 = 15/day

  // ── Ephemeral UI state ─────────────────────────────────────
  if(!window._cdCal) window._cdCal = {
    view: 'month',          // month | week | day
    year: new Date().getFullYear(),
    month: new Date().getMonth(),   // 0-based
    selectedDate: window.cdUtilTodayStr(),
    detailDate: null        // date shown in day-detail panel
  };

  // ============================================================
  // Data access
  // ============================================================
  function calCalendarTasks(){
    if(!S.cdPhase5) S.cdPhase5 = {taskLog:[],customerStage:{},mailboxHealth:{},calendarTasks:{},uiPrefs:{}};
    if(!S.cdPhase5.calendarTasks) S.cdPhase5.calendarTasks = {};
    return S.cdPhase5.calendarTasks;
  }
  function calTaskLog(){
    if(!S.cdPhase5.taskLog) S.cdPhase5.taskLog = [];
    return S.cdPhase5.taskLog;
  }

  function calDateStr(y, m, d){
    return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  }

  // Aggregate data for one calendar day (dateStr = YYYY-MM-DD)
  window.cdCalGetDayData = function(dateStr){
    var sent = (S.sendRecords||[]).filter(function(r){
      return window.cdUtilIsSameDay(r.sentAt, dateStr);
    });
    // pending replies: customers whose last conversation is from customer
    var pendingReplies = 0;
    (S.customers||[]).forEach(function(c){
      if(!Array.isArray(c.cdConversations) || !c.cdConversations.length) return;
      var last = c.cdConversations[c.cdConversations.length-1];
      if(last && last.role === 'customer' && last.timestamp && window.cdUtilIsSameDay(last.timestamp, dateStr)){
        pendingReplies++;
      }
    });
    // planned tasks on this day: manual calendar tasks + daily send tasks
    var manualTasks = (calCalendarTasks()[dateStr]) || [];
    var planned = manualTasks.length;
    // dailySendTasks only stores today's tasks; count them for today
    if(S.dailySendTasks && S.dailySendTasks.date === dateStr && Array.isArray(S.dailySendTasks.tasks)){
      planned += S.dailySendTasks.tasks.filter(function(t){
        return t.status !== 'sent' && t.status !== 'skipped';
      }).length;
    }
    var replied = sent.filter(function(r){ return r.status === 'replied' || r.postSendStatus === 'replied'; }).length;
    return {
      date: dateStr,
      sentCount: sent.length,
      sentRecords: sent,
      planned: planned,
      manualTasks: manualTasks,
      pendingReplies: pendingReplies,
      replied: replied
    };
  };

  // Quota color class: green ≤10, yellow 11-14, red =15
  function calQuotaClass(n){
    if(n >= CD_CAL_DAILY_QUOTA) return 'full';
    if(n >= 11) return 'warn';
    return 'ok';
  }

  // ============================================================
  // Month stats
  // ============================================================
  function calMonthStats(y, m){
    var daysInMonth = new Date(y, m+1, 0).getDate();
    var perDay = {}, totalSent = 0, totalReplies = 0, completedPlanned = 0, totalPlanned = 0;
    for(var d = 1; d <= daysInMonth; d++){
      var ds = calDateStr(y, m, d);
      var dd = window.cdCalGetDayData(ds);
      perDay[ds] = dd;
      totalSent += dd.sentCount;
      totalReplies += dd.replied;
      totalPlanned += dd.planned;
    }
    // busiest day
    var busiest = null, maxN = 0;
    Object.keys(perDay).forEach(function(ds){
      if(perDay[ds].sentCount > maxN){ maxN = perDay[ds].sentCount; busiest = ds; }
    });
    // consecutive send days (counting backwards from today in this month)
    var streak = 0;
    var todayStr = window.cdUtilTodayStr();
    for(var i = daysInMonth; i >= 1; i--){
      var ds2 = calDateStr(y, m, i);
      if(ds2 > todayStr) continue; // future days don't count
      if(perDay[ds2].sentCount > 0) streak++;
      else if(ds2 < todayStr) break; // stop at first idle past day
    }
    return {
      totalSent: totalSent,
      totalReplies: totalReplies,
      replyRate: totalSent ? totalReplies / totalSent : 0,
      totalPlanned: totalPlanned,
      completionRate: totalPlanned ? Math.min(1, totalSent / totalPlanned) : 0,
      busiest: busiest,
      busiestCount: maxN,
      streak: streak
    };
  }

  // ============================================================
  // Render: month grid
  // ============================================================
  function calDayCell(dateStr, isToday, inMonth){
    var dd = window.cdCalGetDayData(dateStr);
    var qc = calQuotaClass(dd.sentCount);
    var dayNum = Number(dateStr.slice(8));
    var h = '<div class="cd-cal-cell'+(isToday?' today':'')+(inMonth?'':' out')+' '+qc+'" data-date="'+dateStr+'">'
      + '<div class="cd-cal-daynum">'+dayNum+(isToday?' <span class="cd-cal-todaydot">●</span>':'')+'</div>';
    if(dd.sentCount){
      h += '<div class="cd-cal-sent">📤 '+dd.sentCount+'/'+CD_CAL_DAILY_QUOTA+'</div>';
    }
    if(dd.planned){
      h += '<div class="cd-cal-planned">📋 '+dd.planned+'待发</div>';
    }
    if(dd.pendingReplies){
      h += '<div class="cd-cal-reply">📥 '+dd.pendingReplies+'待复</div>';
    }
    if(dd.manualTasks.length){
      h += '<div class="cd-cal-dots">';
      dd.manualTasks.forEach(function(){ h += '<span class="cd-cal-dot"></span>'; });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function calRenderMonth(root){
    var st = window._cdCal;
    var y = st.year, m = st.month;
    var todayStr = window.cdUtilTodayStr();
    var firstDay = new Date(y, m, 1).getDay(); // 0=Sun
    var daysInMonth = new Date(y, m+1, 0).getDate();
    var prevDays = new Date(y, m, 0).getDate();

    var h = '<div class="cd-cal-grid">';
    // weekday header
    var wd = ['日','一','二','三','四','五','六'];
    wd.forEach(function(w){ h += '<div class="cd-cal-wd">'+w+'</div>'; });
    // leading days from previous month
    for(var i = firstDay-1; i >= 0; i--){
      var pd = prevDays - i;
      var pm = m === 0 ? 11 : m-1;
      var py = m === 0 ? y-1 : y;
      h += calDayCell(calDateStr(py, pm, pd), false, false);
    }
    // this month
    for(var d = 1; d <= daysInMonth; d++){
      var ds = calDateStr(y, m, d);
      h += calDayCell(ds, ds === todayStr, true);
    }
    // trailing days to fill full weeks
    var totalCells = firstDay + daysInMonth;
    var remain = (7 - (totalCells % 7)) % 7;
    for(var j = 1; j <= remain; j++){
      var nm = m === 11 ? 0 : m+1;
      var ny = m === 11 ? y+1 : y;
      h += calDayCell(calDateStr(ny, nm, j), false, false);
    }
    h += '</div>';
    return h;
  }

  // ============================================================
  // Render: week view (7 columns of detail)
  // ============================================================
  function calRenderWeek(root){
    var st = window._cdCal;
    var today = new Date();
    // anchor: selectedDate's week
    var anchor = new Date(st.selectedDate+'T00:00:00');
    var dow = anchor.getDay();
    var monday = new Date(anchor); monday.setDate(anchor.getDate() - (dow === 0 ? 6 : dow-1));
    var h = '<div class="cd-cal-week">';
    for(var i = 0; i < 7; i++){
      var d = new Date(monday); d.setDate(monday.getDate()+i);
      var ds = calDateStr(d.getFullYear(), d.getMonth(), d.getDate());
      var dd = window.cdCalGetDayData(ds);
      var qc = calQuotaClass(dd.sentCount);
      var wd = ['一','二','三','四','五','六','日'][i];
      h += '<div class="cd-cal-wcol '+qc+'">'
        + '<div class="cd-cal-whead">'+wd+' · '+d.getMonth()+1+'/'+d.getDate()+(ds===window.cdUtilTodayStr()?' <b>今天</b>':'')+'</div>'
        + '<div class="cd-cal-wsent">已发 '+dd.sentCount+'/'+CD_CAL_DAILY_QUOTA+'</div>'
        + '<div class="cd-cal-wplanned">待发任务 '+dd.planned+'</div>'
        + '<div class="cd-cal-wreply">待回复 '+dd.pendingReplies+'</div>'
        + '<div class="cd-cal-wlist">';
      dd.sentRecords.slice(0,5).forEach(function(r){
        h += '<div class="cd-cal-wrec">📧 '+window.cdUtilEsc(r.customerName||r.email||'')+'</div>';
      });
      dd.manualTasks.forEach(function(t){
        h += '<div class="cd-cal-wtask">📝 '+window.cdUtilEsc(t.text||'')+'</div>';
      });
      h += '</div>'
        + '<button class="cd-btn cd-btn-ghost cd-btn-sm" onclick="cdCalDayDetail(\''+ds+'\')">详情</button>'
        + '</div>';
    }
    h += '</div>';
    return h;
  }

  // ============================================================
  // Render: day detail panel
  // ============================================================
  function calDayDetailHTML(dateStr){
    var dd = window.cdCalGetDayData(dateStr);
    var h = '<div class="cd-cal-detail">'
      + '<div class="cd-cal-detail-head"><h3 style="margin:0">📅 '+dateStr+' 详情</h3>'
      + '<button class="cd-btn cd-btn-ghost cd-btn-sm" onclick="cdCalCloseDetail()">关闭</button></div>'
      + '<div class="cd-cal-detail-kpis">'
      + '<div>已发送 <b>'+dd.sentCount+'</b>/'+CD_CAL_DAILY_QUOTA+'</div>'
      + '<div>待发任务 <b>'+dd.planned+'</b></div>'
      + '<div>待回复 <b>'+dd.pendingReplies+'</b></div>'
      + '</div>';

    h += '<div class="cd-cal-detail-sec"><b>📤 已发送记录（'+dd.sentRecords.length+'）</b>';
    if(!dd.sentRecords.length){ h += '<div class="cd-cal-empty">当日无发送记录</div>'; }
    else {
      h += '<div class="cd-cal-dlist">';
      dd.sentRecords.forEach(function(r){
        h += '<div class="cd-cal-drow">'+window.cdUtilFormatDate(r.sentAt).slice(11)
          + ' · '+window.cdUtilEsc(r.customerName||r.email||'')
          + ' · <small>'+window.cdUtilEmailTypeLabel(r.emailType)+'</small>'
          + '</div>';
      });
      h += '</div>';
    }
    h += '</div>';

    h += '<div class="cd-cal-detail-sec"><b>📋 手动任务提醒（'+dd.manualTasks.length+'）</b>';
    if(!dd.manualTasks.length){ h += '<div class="cd-cal-empty">当日无手动任务</div>'; }
    else {
      h += '<div class="cd-cal-dlist">';
      dd.manualTasks.forEach(function(t, i){
        h += '<div class="cd-cal-drow">📝 '+window.cdUtilEsc(t.text||'')
          + ' <button class="cd-btn cd-btn-ghost cd-btn-sm" onclick="cdCalDelTask(\''+dateStr+'\','+i+')">删除</button></div>';
      });
      h += '</div>';
    }
    h += '</div>';

    // quick add task
    h += '<div class="cd-cal-detail-sec"><b>➕ 添加待发送提醒</b>'
      + '<input class="cd-input" id="cdCalNewTaskText" placeholder="例如：给美国客户发样品跟进" style="width:60%">'
      + ' <button class="cd-btn cd-btn-primary cd-btn-sm" onclick="cdCalAddTask(\''+dateStr+'\')">添加</button>'
      + '</div>';

    h += '</div>';
    return h;
  }

  // ============================================================
  // Main page render
  // ============================================================
  function renderPage(root){
    var st = window._cdCal;
    var monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    var ms = calMonthStats(st.year, st.month);

    var h = '<div class="cd-cal-wrap">';

    // Header
    h += '<div class="cd-cal-head">'
      + '<h2 style="margin:0">📅 发送日历</h2>'
      + '<div class="cd-cal-nav">'
      + '<button class="cd-btn cd-btn-ghost" onclick="cdCalPrevMonth()">◀ 上一月</button>'
      + '<button class="cd-btn cd-btn-primary" onclick="cdCalToday()">回到今天</button>'
      + '<button class="cd-btn cd-btn-ghost" onclick="cdCalNextMonth()">下一月 ▶</button>'
      + '<span class="cd-cal-title">'+st.year+'年 '+monthNames[st.month]+'</span>'
      + '</div>';
    // view switch
    h += '<div class="cd-cal-viewtabs">'
      + '<button class="cd-cal-vtab'+(st.view==='month'?' on':'')+'" onclick="cdCalSetView(\'month\')">月视图</button>'
      + '<button class="cd-cal-vtab'+(st.view==='week'?' on':'')+'" onclick="cdCalSetView(\'week\')">周视图</button>'
      + '<button class="cd-cal-vtab'+(st.view==='day'?' on':'')+'" onclick="cdCalSetView(\'day\')">日视图</button>'
      + '</div></div>';

    // Month stats strip
    h += '<div class="cd-cal-ms">'
      + '<div class="cd-cal-ms-item"><b>'+ms.totalSent+'</b><span>总发送</span></div>'
      + '<div class="cd-cal-ms-item"><b>'+(ms.completionRate*100).toFixed(0)+'%</b><span>完成率</span></div>'
      + '<div class="cd-cal-ms-item"><b>'+ms.totalReplies+'</b><span>回复量</span></div>'
      + '<div class="cd-cal-ms-item"><b>'+(ms.replyRate*100).toFixed(1)+'%</b><span>回复率</span></div>'
      + '<div class="cd-cal-ms-item"><b>'+(ms.busiest?ms.busiest.slice(5):'—')+'</b><span>最忙一天('+ms.busiestCount+')</span></div>'
      + '<div class="cd-cal-ms-item"><b>'+ms.streak+'天</b><span>连续发送</span></div>'
      + '</div>';

    // view body
    if(st.view === 'month'){
      h += calRenderMonth(root);
    } else if(st.view === 'week'){
      h += calRenderWeek(root);
    } else {
      // day view
      h += calDayDetailHTML(st.selectedDate);
    }

    // day detail overlay (when a date was clicked in month view)
    if(st.detailDate){
      h += '<div class="cd-cal-overlay" onclick="if(event.target===this)cdCalCloseDetail()">'
        + calDayDetailHTML(st.detailDate) + '</div>';
    }

    h += '<div class="cd-cal-legend">'
      + '<span><i class="cd-cal-lg" style="background:#c6f6d5"></i>配额充足 ≤10</span>'
      + '<span><i class="cd-cal-lg" style="background:#fefcbf"></i>接近上限 11-14</span>'
      + '<span><i class="cd-cal-lg" style="background:#fed7d7"></i>已满载 =15</span>'
      + '<span>🔒 仅提醒与记录，不自动发送邮件</span></div>';

    h += '</div>';
    root.innerHTML = h;

    // bind cell clicks via delegation
    root.querySelectorAll('.cd-cal-cell').forEach(function(cell){
      cell.addEventListener('click', function(){
        var ds = cell.getAttribute('data-date');
        if(ds) window.cdCalDayDetail(ds);
      });
    });
  }

  // ============================================================
  // Public API
  // ============================================================
  window.cdCalPrevMonth = function(){
    var st = window._cdCal;
    st.month--; if(st.month < 0){ st.month = 11; st.year--; }
    if(renderView) renderView();
  };
  window.cdCalNextMonth = function(){
    var st = window._cdCal;
    st.month++; if(st.month > 11){ st.month = 0; st.year++; }
    if(renderView) renderView();
  };
  window.cdCalToday = function(){
    var st = window._cdCal;
    var n = new Date();
    st.year = n.getFullYear(); st.month = n.getMonth();
    st.selectedDate = window.cdUtilTodayStr();
    if(renderView) renderView();
  };
  window.cdCalSetView = function(v){
    window._cdCal.view = v;
    if(v === 'day') window._cdCal.selectedDate = window._cdCal.selectedDate || window.cdUtilTodayStr();
    if(renderView) renderView();
  };
  window.cdCalDayDetail = function(dateStr){
    window._cdCal.selectedDate = dateStr;
    if(window._cdCal.view === 'day'){
      if(renderView) renderView();
    } else {
      window._cdCal.detailDate = dateStr;
      if(renderView) renderView();
    }
  };
  window.cdCalCloseDetail = function(){
    window._cdCal.detailDate = null;
    if(renderView) renderView();
  };
  window.cdCalAddTask = function(dateStr){
    var el = document.getElementById('cdCalNewTaskText');
    var text = el ? el.value.trim() : '';
    if(!text){ toast('请输入任务内容', 'err'); return; }
    var tasks = calCalendarTasks();
    if(!tasks[dateStr]) tasks[dateStr] = [];
    tasks[dateStr].push({ id: 'cdcal_'+Date.now().toString(36), text: text, at: new Date().toISOString() });
    calTaskLog().push({ at: new Date().toISOString(), date: dateStr, action: 'add-calendar-task', text: text });
    persist();
    toast('已添加 '+dateStr+' 的提醒');
    if(renderView) renderView();
  };
  window.cdCalDelTask = function(dateStr, idx){
    var tasks = calCalendarTasks();
    if(tasks[dateStr] && tasks[dateStr][idx] != null){
      tasks[dateStr].splice(idx, 1);
      persist();
      toast('已删除任务');
      if(renderView) renderView();
    }
  };

  // ── renderView interception ───────────────────────────────
  var _cdCalOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'cdCalendar'){
      renderPage(document.getElementById('mainContent'));
      return;
    }
    _cdCalOrigRV.apply(this, arguments);
  };

  // ── Styles (cd-cal- prefixed) ───────────────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-cal-wrap{padding:18px;max-width:100%;}'
    + '.cd-cal-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;}'
    + '.cd-cal-nav{display:flex;gap:6px;align-items:center;}'
    + '.cd-cal-title{font-size:16px;font-weight:700;margin-left:8px;color:#1a365d;}'
    + '.cd-cal-viewtabs{display:flex;gap:4px;}'
    + '.cd-cal-vtab{padding:5px 14px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;font-size:13px;color:#4a5568;border-radius:14px;}'
    + '.cd-cal-vtab.on{background:#1a365d;color:#fff;border-color:#1a365d;font-weight:600;}'
    + '.cd-cal-ms{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:14px;}'
    + '.cd-cal-ms-item{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center;}'
    + '.cd-cal-ms-item b{font-size:20px;color:#1a365d;display:block;}'
    + '.cd-cal-ms-item span{font-size:11px;color:#8a96a8;}'
    + '.cd-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;}'
    + '.cd-cal-wd{text-align:center;font-size:12px;font-weight:700;color:#4a5568;padding:6px 0;background:#edf2f7;border-radius:4px;}'
    + '.cd-cal-cell{min-height:96px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:6px;font-size:11px;cursor:pointer;overflow:hidden;}'
    + '.cd-cal-cell:hover{box-shadow:0 2px 6px rgba(0,0,0,.1);}'
    + '.cd-cal-cell.out{opacity:.4;background:#f7fafc;}'
    + '.cd-cal-cell.today{border:2px solid #1a365d;}'
    + '.cd-cal-cell.ok{background:#f0fff4;}'
    + '.cd-cal-cell.warn{background:#fffbeb;}'
    + '.cd-cal-cell.full{background:#fff5f5;}'
    + '.cd-cal-daynum{font-weight:700;color:#2d3748;}'
    + '.cd-cal-todaydot{color:#e53e3e;}'
    + '.cd-cal-sent{margin-top:3px;font-weight:600;color:#2b6cb0;}'
    + '.cd-cal-planned{margin-top:2px;color:#b7791f;}'
    + '.cd-cal-reply{margin-top:2px;color:#2f855a;}'
    + '.cd-cal-dots{margin-top:3px;display:flex;gap:2px;}'
    + '.cd-cal-dot{width:6px;height:6px;border-radius:50%;background:#805ad5;}'
    + '.cd-cal-week{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;}'
    + '.cd-cal-wcol{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:12px;}'
    + '.cd-cal-wcol.ok{border-top:3px solid #48bb78;}'
    + '.cd-cal-wcol.warn{border-top:3px solid #ecc94b;}'
    + '.cd-cal-wcol.full{border-top:3px solid #f56565;}'
    + '.cd-cal-whead{font-weight:700;color:#2d3748;margin-bottom:6px;}'
    + '.cd-cal-wsent{color:#2b6cb0;} .cd-cal-wplanned{color:#b7791f;} .cd-cal-wreply{color:#2f855a;}'
    + '.cd-cal-wlist{margin:6px 0;min-height:30px;}'
    + '.cd-cal-wrec,.cd-cal-wtask{font-size:10.5px;color:#4a5568;padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    + '.cd-cal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;}'
    + '.cd-cal-detail{background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:85vh;overflow:auto;padding:18px;}'
    + '.cd-cal-detail-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}'
    + '.cd-cal-detail-kpis{display:flex;gap:14px;font-size:13px;color:#4a5568;margin-bottom:14px;}'
    + '.cd-cal-detail-sec{margin-bottom:14px;font-size:13px;}'
    + '.cd-cal-dlist{margin-top:6px;}'
    + '.cd-cal-drow{padding:5px 0;border-bottom:1px dashed #edf2f7;font-size:12.5px;color:#2d3748;display:flex;justify-content:space-between;gap:8px;align-items:center;}'
    + '.cd-cal-empty{color:#a0aec0;font-size:12px;padding:8px 0;}'
    + '.cd-cal-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#4a5568;margin-top:14px;align-items:center;}'
    + '.cd-cal-lg{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;}'
    + '@media(max-width:900px){.cd-cal-week{grid-template-columns:1fr;}}'
    ;
  document.head.appendChild(style);
})();
