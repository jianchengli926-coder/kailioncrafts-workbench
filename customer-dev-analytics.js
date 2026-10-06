/* ============================================================
 * Customer Development Analytics & Funnel (customer-dev-analytics.js)
 * ----------------------------------------------------------------
 * Phase 5 — Module 4: Send statistics & development funnel.
 *
 * Features:
 *   1. Time-range selector (today / yesterday / 7d / 30d / month /
 *      last-month / custom)
 *   2. Core KPI cards (sent / replied / reply-rate / interested /
 *      quotes / samples / orders / order-rate / avg reply time /
 *      avg follow-up rounds)
 *   3. Multi-dimension breakdowns (category / mailbox / country /
 *      email-type / language / customer-level)
 *   4. 10-stage development funnel (count + conversion + avg stay,
 *      rendered as pure-CSS horizontal bars)
 *   5. Trend charts (pure CSS: bar series, horizontal bars,
 *      conic-gradient pie) — NO Canvas / SVG / external libs
 *   6. CSV export (stats report + funnel data)
 *
 * Data sources: S.sendRecords, S.customers, S.emailAccounts,
 *               S.cdPhase5.customerStage.
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Read-only dashboard.
 *   - No external chart libraries. Pure CSS / HTML.
 *   - All CSS classes use the cd- (cd-an-) prefix. Comments in English.
 *   - Does NOT modify app.js / server.js / index.html.
 * ============================================================ */
(function(){
  'use strict';

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'cdAnalytics',
    icon: '📊',
    label: '统计漏斗',
    title: '发送统计与客户开发漏斗分析',
    crumb: 'KPI指标 · 多维统计 · 10阶段漏斗 · 趋势图 · CSV导出'
  });

  // ============================================================
  // Defensive shared utils (module A may also define these; we
  // only define when missing so load order never breaks).
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
  if(!window.cdUtilCustLevel) window.cdUtilCustLevel = function(c){
    return (c && (c.level || c.customerLevel)) || '未分级';
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
  if(!window.cdUtilStageLabel) window.cdUtilStageLabel = function(stage){
    var s = CD_AN_STAGES.find(function(x){ return x.key === stage; });
    return s ? s.label : stage;
  };
  if(!window.cdUtilStageIcon) window.cdUtilStageIcon = function(stage){
    var s = CD_AN_STAGES.find(function(x){ return x.key === stage; });
    return s ? s.icon : '•';
  };
  if(!window.cdUtilStageColor) window.cdUtilStageColor = function(stage){
    var s = CD_AN_STAGES.find(function(x){ return x.key === stage; });
    return s ? s.color : '#718096';
  };
  if(!window.cdUtilExportCSV) window.cdUtilExportCSV = function(filename, headers, rows){
    var csv = headers.join(',') + '\n';
    rows.forEach(function(r){
      csv += r.map(function(cell){
        var v = String(cell==null?'':cell);
        if(/[",\n]/.test(v)) v = '"' + v.replace(/"/g,'""') + '"';
        return v;
      }).join(',') + '\n';
    });
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 100);
  };

  // ============================================================
  // Constants — 12 development stages (shared with kanban module)
  // ============================================================
  var CD_AN_STAGES = [
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

  // 10 funnel stages (kanban minus dormant / rejected)
  var CD_AN_FUNNEL = ['new-lead','intel-done','draft-ready','first-sent',
    'following','replied','negotiating','quoted','sampled','ordered'];

  var CD_AN_RANGES = [
    {key:'today',     label:'今日'},
    {key:'yesterday', label:'昨日'},
    {key:'7d',        label:'近7天'},
    {key:'30d',       label:'近30天'},
    {key:'thisMonth', label:'本月'},
    {key:'lastMonth', label:'上月'},
    {key:'custom',    label:'自定义'}
  ];

  // ── Ephemeral UI state ─────────────────────────────────────
  if(!window._cdAn) window._cdAn = { range:'30d', cStart:'', cEnd:'' };

  // ============================================================
  // Date range helpers
  // ============================================================
  function anMidnight(d){ var x = new Date(d); x.setHours(0,0,0,0); return x; }
  function anEndOfDay(d){ var x = new Date(d); x.setHours(23,59,59,999); return x; }

  // Resolve the currently selected range into {start:Date, end:Date}
  function anResolveRange(){
    var r = window._cdAn.range;
    var now = new Date();
    var start, end = now;
    if(r === 'today'){ start = anMidnight(now); }
    else if(r === 'yesterday'){ start = anMidnight(new Date(now.getTime()-86400000)); end = anEndOfDay(new Date(now.getTime()-86400000)); }
    else if(r === '7d'){ start = anMidnight(new Date(now.getTime()-6*86400000)); end = anEndOfDay(now); }
    else if(r === '30d'){ start = anMidnight(new Date(now.getTime()-29*86400000)); end = anEndOfDay(now); }
    else if(r === 'thisMonth'){ start = anMidnight(new Date(now.getFullYear(), now.getMonth(), 1)); end = anEndOfDay(now); }
    else if(r === 'lastMonth'){ start = anMidnight(new Date(now.getFullYear(), now.getMonth()-1, 1)); end = anEndOfDay(new Date(now.getFullYear(), now.getMonth(), 0)); }
    else if(r === 'custom'){
      start = window._cdAn.cStart ? new Date(window._cdAn.cStart+'T00:00:00') : anMidnight(new Date(now.getTime()-29*86400000));
      end = window._cdAn.cEnd ? anEndOfDay(new Date(window._cdAn.cEnd+'T00:00:00')) : anEndOfDay(now);
    }
    else { start = anMidnight(new Date(now.getTime()-29*86400000)); end = anEndOfDay(now); }
    return { start: start, end: end };
  }

  function anInRange(iso, range){
    if(!iso) return false;
    var t = new Date(iso).getTime();
    if(isNaN(t)) return false;
    return t >= range.start.getTime() && t <= range.end.getTime();
  }

  // ============================================================
  // Data access (defensive against missing / legacy fields)
  // ============================================================
  function anAllRecords(){ return S.sendRecords || []; }
  function anAllCustomers(){ return S.customers || []; }
  function anAllAccounts(){ return S.emailAccounts || []; }
  function anStageMap(){
    if(!S.cdPhase5) S.cdPhase5 = {taskLog:[],customerStage:{},mailboxHealth:{},calendarTasks:{},uiPrefs:{}};
    if(!S.cdPhase5.customerStage) S.cdPhase5.customerStage = {};
    return S.cdPhase5.customerStage;
  }
  function anGetStage(custId){
    var m = anStageMap();
    if(m[custId] && m[custId].stage) return m[custId].stage;
    return 'new-lead';
  }
  function anGetStageChangedAt(custId){
    var m = anStageMap();
    return (m[custId] && m[custId].stageChangedAt) || null;
  }

  // A record counts as a "reply" if flagged on the record or the
  // linked customer has a customer-sent conversation in range.
  function anRecordIsReply(r){
    return (r.status === 'replied') || (r.postSendStatus === 'replied');
  }

  // Distinct customers who sent us a reply inside the range.
  function anRepliedCustomerIds(range){
    var ids = {};
    // from records
    anAllRecords().forEach(function(r){
      if(anRecordIsReply(r) && r.customerId && !ids[r.customerId]) ids[r.customerId] = 1;
    });
    // from conversations / timestamps
    anAllCustomers().forEach(function(c){
      if(!Array.isArray(c.cdConversations)) return;
      for(var i=0;i<c.cdConversations.length;i++){
        var m = c.cdConversations[i];
        if(m && m.role === 'customer' && m.timestamp && anInRange(m.timestamp, range)){
          ids[c.id] = 1; break;
        }
      }
    });
    return Object.keys(ids);
  }

  // ============================================================
  // Metric computation
  // ============================================================
  function anComputeMetrics(range){
    var recs = anAllRecords().filter(function(r){ return anInRange(r.sentAt, range); });
    var sentCount = recs.length;

    // distinct customers who got at least one send in range
    var sentCustIds = {};
    recs.forEach(function(r){ if(r.customerId) sentCustIds[r.customerId] = 1; });

    var repliedIds = anRepliedCustomerIds(range);
    var repliedSet = {}; repliedIds.forEach(function(id){ repliedSet[id] = 1; });
    // restrict replies to customers we actually sent to in range (more accurate reply-rate)
    var repliedToSent = repliedIds.filter(function(id){ return sentCustIds[id]; });

    // stage-based business counts across ALL customers (not range-bound)
    var stageCount = {};
    CD_AN_STAGES.forEach(function(s){ stageCount[s.key] = 0; });
    anAllCustomers().forEach(function(c){
      var st = anGetStage(c.id);
      if(stageCount[st] == null) stageCount[st] = 0;
      stageCount[st]++;
    });

    var interested = (stageCount.replied||0) + (stageCount.negotiating||0);
    var quotes = stageCount.quoted||0;
    var samples = stageCount.sampled||0;
    var orders = stageCount.ordered||0;

    // avg follow-up rounds = avg records per customer in range
    var rounds = sentCount && Object.keys(sentCustIds).length
      ? sentCount / Object.keys(sentCustIds).length : 0;

    // avg reply time (hours): earliest send → earliest customer reply
    var replyHours = [];
    repliedIds.forEach(function(cid){
      var c = window.cdUtilFindCustomer(cid);
      if(!c || !Array.isArray(c.cdConversations)) return;
      var sends = recs.filter(function(r){ return r.customerId === cid; });
      if(!sends.length) return;
      var earliestSend = Math.min.apply(null, sends.map(function(r){ return new Date(r.sentAt).getTime(); }));
      var firstReply = null;
      c.cdConversations.forEach(function(m){
        if(m.role === 'customer' && m.timestamp){
          var t = new Date(m.timestamp).getTime();
          if(!isNaN(t) && t >= earliestSend){
            if(firstReply === null || t < firstReply) firstReply = t;
          }
        }
      });
      if(firstReply !== null){
        var hrs = (firstReply - earliestSend) / 3600000;
        if(hrs >= 0) replyHours.push(hrs);
      }
    });
    var avgReplyHrs = replyHours.length
      ? replyHours.reduce(function(a,b){ return a+b; },0) / replyHours.length : 0;

    return {
      sent: sentCount,
      sentCustomers: Object.keys(sentCustIds).length,
      replied: repliedToSent.length,
      replyRate: sentCount ? repliedToSent.length / sentCount : 0,
      interested: interested,
      quotes: quotes,
      samples: samples,
      orders: orders,
      orderRate: sentCount ? orders / sentCount : 0,
      avgReplyHrs: avgReplyHrs,
      avgRounds: rounds,
      stageCount: stageCount
    };
  }

  // Multi-dimension grouping: returns [{key,label,count,pct}]
  function anGroupBy(recs, fieldFn, labelFn){
    var map = {};
    recs.forEach(function(r){
      var k = fieldFn(r) || '未知';
      if(!map[k]) map[k] = 0;
      map[k]++;
    });
    var arr = Object.keys(map).map(function(k){
      return { key: k, label: labelFn ? labelFn(k) : k, count: map[k] };
    });
    arr.sort(function(a,b){ return b.count - a.count; });
    var total = arr.reduce(function(a,b){ return a+b.count; },0) || 1;
    arr.forEach(function(x){ x.pct = x.count / total; });
    return arr;
  }

  function anDimensionData(range){
    var recs = anAllRecords().filter(function(r){ return anInRange(r.sentAt, range); });
    function custOf(r){ return window.cdUtilFindCustomer(r.customerId); }
    return {
      byCategory: anGroupBy(recs,
        function(r){ return r.category || (custOf(r) && custOf(r).productCategory) || ''; }),
      byMailbox: anGroupBy(recs,
        function(r){ return r.emailAccountAddress || r.emailAccountId || ''; }),
      byCountry: anGroupBy(recs,
        function(r){ return r.country || (custOf(r) && custOf(r).country) || ''; }),
      byType: anGroupBy(recs,
        function(r){ return r.emailType || ''; },
        function(k){ return window.cdUtilEmailTypeLabel(k); }),
      byLanguage: anGroupBy(recs,
        function(r){ return r.language || ''; }),
      byLevel: anGroupBy(recs,
        function(r){ return r.customerLevel || (custOf(r) && custOf(r).level) || ''; })
    };
  }

  // ============================================================
  // Funnel computation (10 stages over all customers)
  // ============================================================
  function anComputeFunnel(){
    var counts = [];
    var totalCustomers = anAllCustomers().length || 1;
    CD_AN_FUNNEL.forEach(function(key, idx){
      var def = CD_AN_STAGES.find(function(x){ return x.key === key; });
      // count customers AT this stage (customers who have reached at least this stage)
      var atStage = 0;
      anAllCustomers().forEach(function(c){
        var st = anGetStage(c.id);
        var stIdx = CD_AN_STAGES.findIndex(function(x){ return x.key === st; });
        var fIdx = idx;
        // customer counts in this funnel stage if their position is at or beyond
        // this stage within the funnel ordering (ignore dormant/rejected)
        var stFunnelPos = CD_AN_FUNNEL.indexOf(st);
        if(stFunnelPos >= fIdx) atStage++;
      });
      var changedSum = 0, changedN = 0, maxStay = 0;
      anAllCustomers().forEach(function(c){
        var st = anGetStage(c.id);
        if(st !== key) return;
        var ts = anGetStageChangedAt(c.id);
        if(ts){
          var days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
          if(!isNaN(days)){ changedSum += days; changedN++; if(days > maxStay) maxStay = days; }
        }
      });
      var stayAvg = changedN ? changedSum / changedN : 0;
      counts.push({
        key: key, icon: def.icon, label: def.label, color: def.color,
        count: atStage,
        convFromPrev: idx === 0 ? 1 : (counts[idx-1].count ? atStage / counts[idx-1].count : 0),
        convOverall: atStage / totalCustomers,
        stayAvg: stayAvg, stayMax: maxStay
      });
    });
    return counts;
  }

  // ============================================================
  // Trend computation (last N calendar days)
  // ============================================================
  function anComputeTrends(days){
    days = days || 30;
    var labels = [], sentArr = [], replyArr = [], rateArr = [];
    for(var i = days-1; i >= 0; i--){
      var d = new Date(); d.setHours(0,0,0,0);
      d = new Date(d.getTime() - i*86400000);
      var key = window.cdUtilFormatDate(d);
      labels.push(key.slice(5)); // MM-DD
      var dayStart = d.getTime(), dayEnd = dayStart + 86399999;
      var sent = 0, replied = 0;
      anAllRecords().forEach(function(r){
        var t = new Date(r.sentAt).getTime();
        if(isNaN(t)) return;
        if(t >= dayStart && t <= dayEnd){
          sent++;
          if(anRecordIsReply(r)) replied++;
        }
      });
      sentArr.push(sent);
      replyArr.push(replied);
      rateArr.push(sent ? replied / sent : 0);
    }
    return { labels: labels, sent: sentArr, replied: replyArr, rate: rateArr };
  }

  // ============================================================
  // Render helpers (pure CSS charts)
  // ============================================================
  function anPct(x, digits){ return (x*100).toFixed(digits==null?1:digits) + '%'; }
  function anNum(n){ return String(n); }

  function anKpiCard(num, label, color){
    return '<div class="cd-an-kpi">'
      + '<div class="cd-an-kpi-num" style="color:'+(color||'#1a365d')+'">'+num+'</div>'
      + '<div class="cd-an-kpi-label">'+label+'</div></div>';
  }

  // Horizontal bar row for dimension breakdown
  function anBarRow(item, max){
    var w = max ? Math.round(item.count / max * 100) : 0;
    return '<div class="cd-an-barrow">'
      + '<div class="cd-an-barrow-label" title="'+window.cdUtilEsc(item.label)+'">'+window.cdUtilEsc(item.label)+'</div>'
      + '<div class="cd-an-barrow-track"><div class="cd-an-barrow-fill" style="width:'+w+'%"></div></div>'
      + '<div class="cd-an-barrow-val">'+item.count+' <small>'+anPct(item.pct,0)+'</small></div>'
      + '</div>';
  }

  function anDimensionBlock(title, arr, color){
    if(!arr || !arr.length) return '<div class="cd-an-block"><div class="cd-an-block-title">'+title+'</div><div class="cd-an-empty">暂无数据</div></div>';
    var max = arr[0].count;
    var h = '<div class="cd-an-block"><div class="cd-an-block-title">'+title+'</div>';
    arr.slice(0, 10).forEach(function(x){
      h += anBarRow(x, max);
    });
    h += '</div>';
    return h;
  }

  // Pure-CSS vertical bar series (send / reply trend)
  function anVBarSeries(labels, data, color){
    var max = Math.max.apply(null, data.concat([1]));
    var h = '<div class="cd-an-vbars">';
    data.forEach(function(v, i){
      var hgt = Math.round(v / max * 100);
      h += '<div class="cd-an-vbar-wrap" title="'+labels[i]+': '+v+'">'
        + '<div class="cd-an-vbar" style="height:'+hgt+'%;background:'+color+'"></div>'
        + '<div class="cd-an-vbar-val">'+v+'</div>'
        + '</div>';
    });
    h += '</div>';
    // x labels (thin)
    h += '<div class="cd-an-vlabels">';
    labels.forEach(function(l){ h += '<span>'+l+'</span>'; });
    h += '</div>';
    return h;
  }

  // Pure-CSS conic-gradient pie for mailbox distribution
  function anPie(arr){
    if(!arr || !arr.length) return '<div class="cd-an-empty">暂无数据</div>';
    var palette = ['#3182ce','#dd6b20','#2f855a','#d69e2e','#805ad5','#e53e3e','#319795'];
    var total = arr.reduce(function(a,b){ return a+b.count; },0) || 1;
    var acc = 0, grad = [];
    arr.forEach(function(x, i){
      var start = acc / total * 100;
      acc += x.count;
      var end = acc / total * 100;
      grad.push(palette[i % palette.length] + ' ' + start + '% ' + end + '%');
    });
    var h = '<div class="cd-an-pie-wrap">'
      + '<div class="cd-an-pie" style="background:conic-gradient('+grad.join(',')+')"></div>'
      + '<div class="cd-an-legend">';
    arr.forEach(function(x, i){
      h += '<div class="cd-an-legend-item"><span class="cd-an-dot" style="background:'+palette[i%palette.length]+'"></span>'
        + window.cdUtilEsc(x.label) + ' <b>'+x.count+'</b> ('+anPct(x.pct,0)+')</div>';
    });
    h += '</div></div>';
    return h;
  }

  // ============================================================
  // Main page render
  // ============================================================
  function renderPage(root){
    var range = anResolveRange();
    var m = anComputeMetrics(range);
    var dim = anDimensionData(range);
    var funnel = anComputeFunnel();
    var trend = anComputeTrends(30);

    var h = '';
    h += '<div class="cd-an-wrap">';

    // Header + range selector
    h += '<div class="cd-an-head">'
      + '<div><h2 style="margin:0">📊 发送统计与漏斗分析</h2>'
      + '<div class="cd-an-sub">数据范围：'+window.cdUtilFormatDate(range.start)+' ~ '+window.cdUtilFormatDate(range.end)+'</div></div>'
      + '</div>';

    h += '<div class="cd-an-ranges">';
    CD_AN_RANGES.forEach(function(r){
      h += '<button class="cd-an-range-btn'+(window._cdAn.range===r.key?' on':'')+'" onclick="cdAnSetRange(\''+r.key+'\')">'+r.label+'</button>';
    });
    h += '<button class="cd-an-range-btn" onclick="cdAnExportStats()">⬇ 导出统计</button>';
    h += '<button class="cd-an-range-btn" onclick="cdAnExportFunnel()">⬇ 导出漏斗</button>';
    h += '</div>';

    if(window._cdAn.range === 'custom'){
      h += '<div class="cd-an-custom">自定义：'
        + '<input type="date" class="cd-input" id="cdAnCStart" value="'+window._cdAn.cStart+'">'
        + ' 至 <input type="date" class="cd-input" id="cdAnCEnd" value="'+window._cdAn.cEnd+'">'
        + ' <button class="cd-btn cd-btn-primary" onclick="cdAnApplyCustom()">应用</button></div>';
    }

    // KPI cards
    h += '<div class="cd-an-kpis">';
    h += anKpiCard(anNum(m.sent), '发送量', '#1a365d');
    h += anKpiCard(anNum(m.replied), '回复量', '#2f855a');
    h += anKpiCard(anPct(m.replyRate), '回复率', '#319795');
    h += anKpiCard(anNum(m.interested), '意向客户', '#d69e2e');
    h += anKpiCard(anNum(m.quotes), '报价数', '#9f7aea');
    h += anKpiCard(anNum(m.samples), '样品数', '#805ad5');
    h += anKpiCard(anNum(m.orders), '下单数', '#2f855a');
    h += anKpiCard(anPct(m.orderRate), '下单率', '#2b6cb0');
    h += anKpiCard(m.avgReplyHrs ? m.avgReplyHrs.toFixed(1)+'h' : '—', '平均回复时间', '#dd6b20');
    h += anKpiCard(m.avgRounds ? m.avgRounds.toFixed(1) : '—', '平均跟进轮次', '#4a5568');
    h += '</div>';

    // Funnel
    h += '<div class="cd-an-block"><div class="cd-an-block-title">🧭 客户开发漏斗（10阶段）'
      + '<small class="cd-an-hint"> 数量 = 累计到达该阶段客户数 · 转化率 = 相对上一阶段</small></div>';
    var maxF = funnel[0] ? funnel[0].count : 1;
    funnel.forEach(function(f){
      var w = maxF ? Math.round(f.count / maxF * 100) : 0;
      h += '<div class="cd-an-frow">'
        + '<div class="cd-an-fstage">'+f.icon+' '+f.label+'</div>'
        + '<div class="cd-an-ftrack"><div class="cd-an-ffill" style="width:'+w+'%;background:'+f.color+'">'
        + '<span class="cd-an-fcount">'+f.count+'</span></div></div>'
        + '<div class="cd-an-fmeta">'
        + '<span title="相对上一阶段转化率">转化 '+(f.convFromPrev*100).toFixed(0)+'%</span>'
        + '<span title="相对新线索">整体 '+anPct(f.convOverall,0)+'</span>'
        + '<span title="当前阶段平均停留天数">均停 '+f.stayAvg.toFixed(0)+'天</span>'
        + '<span title="最长停留天数">最长 '+f.stayMax+'天</span>'
        + '</div></div>';
    });
    h += '</div>';

    // Trends
    h += '<div class="cd-an-grid2">';
    h += '<div class="cd-an-block"><div class="cd-an-block-title">📈 近30天发送量趋势</div>' + anVBarSeries(trend.labels, trend.sent, '#3182ce') + '</div>';
    h += '<div class="cd-an-block"><div class="cd-an-block-title">📥 近30天回复量趋势</div>' + anVBarSeries(trend.labels, trend.replied, '#2f855a') + '</div>';
    h += '</div>';

    h += '<div class="cd-an-grid2">';
    h += anDimensionBlock('🏷 品类对比', dim.byCategory, '#3182ce');
    h += anDimensionBlock('🌍 国家 TOP10', dim.byCountry, '#dd6b20');
    h += '</div>';

    h += '<div class="cd-an-grid2">';
    h += anDimensionBlock('✉️ 邮件类型分布', dim.byType, '#805ad5');
    h += '<div class="cd-an-block"><div class="cd-an-block-title">📮 邮箱使用分布</div>' + anPie(dim.byMailbox) + '</div>';
    h += '</div>';

    h += '<div class="cd-an-grid2">';
    h += anDimensionBlock('🗣 语言分布', dim.byLanguage, '#319795');
    h += anDimensionBlock('⭐ 客户等级分布', dim.byLevel, '#d69e2e');
    h += '</div>';

    h += '<div class="cd-an-footnote">🔒 本模块为只读统计面板，不发送任何邮件。图表全部由纯CSS渲染，无外部图表库。</div>';
    h += '</div>';

    root.innerHTML = h;
    bindEvents(root);
  }

  // Event delegation
  function bindEvents(root){
    root.addEventListener('click', function(e){
      // range buttons handled via onclick; reserved for future delegation
    });
  }

  // ============================================================
  // Public API
  // ============================================================
  window.cdAnSetRange = function(r){
    window._cdAn.range = r;
    if(renderView) renderView();
  };
  window.cdAnApplyCustom = function(){
    var s = document.getElementById('cdAnCStart');
    var e = document.getElementById('cdAnCEnd');
    if(s) window._cdAn.cStart = s.value || '';
    if(e) window._cdAn.cEnd = e.value || '';
    if(renderView) renderView();
  };
  window.cdAnCalcFunnel = function(){ return anComputeFunnel(); };
  window.cdAnCalcTrends = function(days){ return anComputeTrends(days||30); };

  window.cdAnExportStats = function(){
    var range = anResolveRange();
    var m = anComputeMetrics(range);
    var dim = anDimensionData(range);
    var headers = ['指标', '数值'];
    var rows = [
      ['时间范围', window.cdUtilFormatDate(range.start)+' ~ '+window.cdUtilFormatDate(range.end)],
      ['发送量', m.sent],
      ['回复量', m.replied],
      ['回复率', anPct(m.replyRate)],
      ['意向客户', m.interested],
      ['报价数', m.quotes],
      ['样品数', m.samples],
      ['下单数', m.orders],
      ['下单率', anPct(m.orderRate)],
      ['平均回复时间(h)', m.avgReplyHrs ? m.avgReplyHrs.toFixed(2) : ''],
      ['平均跟进轮次', m.avgRounds ? m.avgRounds.toFixed(2) : ''],
      ['', ''],
      ['按品类', ''],
    ];
    dim.byCategory.forEach(function(x){ rows.push([x.label, x.count, anPct(x.pct)]); });
    rows.push(['', ''], ['按国家', '']);
    dim.byCountry.slice(0,10).forEach(function(x){ rows.push([x.label, x.count, anPct(x.pct)]); });
    window.cdUtilExportCSV('cd-an-stats.csv', headers, rows);
    toast('统计报表已导出');
  };

  window.cdAnExportFunnel = function(){
    var f = anComputeFunnel();
    var headers = ['阶段', '客户数', '相对上阶段转化率', '相对新线索转化率', '平均停留天数', '最长停留天数'];
    var rows = f.map(function(x){
      return [x.icon+' '+x.label, x.count, anPct(x.convFromPrev), anPct(x.convOverall),
        x.stayAvg.toFixed(1), x.stayMax];
    });
    window.cdUtilExportCSV('cd-an-funnel.csv', headers, rows);
    toast('漏斗数据已导出');
  };

  // ── renderView interception ───────────────────────────────
  var _cdAnOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'cdAnalytics'){
      renderPage(document.getElementById('mainContent'));
      return;
    }
    _cdAnOrigRV.apply(this, arguments);
  };

  // ── Styles (cd-an- prefixed) ───────────────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-an-wrap{padding:18px;max-width:100%;}'
    + '.cd-an-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;}'
    + '.cd-an-sub{font-size:12.5px;color:#8a96a8;margin-top:4px;}'
    + '.cd-an-ranges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}'
    + '.cd-an-range-btn{padding:6px 14px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;color:#4a5568;font-size:13px;cursor:pointer;}'
    + '.cd-an-range-btn:hover{border-color:#3182ce;color:#3182ce;}'
    + '.cd-an-range-btn.on{background:#1a365d;color:#fff;border-color:#1a365d;font-weight:600;}'
    + '.cd-an-custom{margin-bottom:14px;font-size:13px;color:#4a5568;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.cd-an-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px;}'
    + '.cd-an-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.cd-an-kpi-num{font-size:26px;font-weight:800;}'
    + '.cd-an-kpi-label{font-size:12px;color:#8a96a8;margin-top:4px;}'
    + '.cd-an-block{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px;}'
    + '.cd-an-block-title{font-size:14px;font-weight:700;color:#1a202c;margin-bottom:12px;}'
    + '.cd-an-hint{font-weight:400;color:#a0aec0;font-size:12px;margin-left:6px;}'
    + '.cd-an-empty{color:#a0aec0;font-size:13px;text-align:center;padding:16px;}'
    + '.cd-an-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;}'
    + '@media(max-width:900px){.cd-an-grid2{grid-template-columns:1fr;}}'
    + '.cd-an-barrow{display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:12.5px;}'
    + '.cd-an-barrow-label{width:90px;flex-shrink:0;color:#4a5568;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    + '.cd-an-barrow-track{flex:1;height:14px;background:#edf2f7;border-radius:4px;overflow:hidden;}'
    + '.cd-an-barrow-fill{height:100%;background:#3182ce;border-radius:4px;}'
    + '.cd-an-barrow-val{width:70px;flex-shrink:0;text-align:right;color:#2d3748;}'
    + '.cd-an-vbars{display:flex;align-items:flex-end;gap:3px;height:130px;padding:0 4px;border-bottom:1px solid #e2e8f0;}'
    + '.cd-an-vbar-wrap{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;position:relative;}'
    + '.cd-an-vbar{width:70%;border-radius:3px 3px 0 0;min-height:2px;}'
    + '.cd-an-vbar-val{font-size:9px;color:#a0aec0;margin-top:2px;}'
    + '.cd-an-vlabels{display:flex;gap:3px;padding:4px;}'
    + '.cd-an-vlabels span{flex:1;font-size:8px;color:#cbd5e0;text-align:center;transform:rotate(-45deg);white-space:nowrap;}'
    + '.cd-an-pie-wrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}'
    + '.cd-an-pie{width:120px;height:120px;border-radius:50%;flex-shrink:0;}'
    + '.cd-an-legend{flex:1;font-size:12px;color:#4a5568;}'
    + '.cd-an-legend-item{margin-bottom:4px;display:flex;align-items:center;gap:6px;}'
    + '.cd-an-dot{width:10px;height:10px;border-radius:2px;display:inline-block;}'
    + '.cd-an-frow{display:flex;align-items:center;gap:10px;margin-bottom:9px;font-size:13px;}'
    + '.cd-an-fstage{width:104px;flex-shrink:0;color:#2d3748;font-weight:600;}'
    + '.cd-an-ftrack{flex:1;height:22px;background:#f7fafc;border-radius:5px;overflow:hidden;}'
    + '.cd-an-ffill{height:100%;border-radius:5px;min-width:30px;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;}'
    + '.cd-an-fcount{color:#fff;font-size:12px;font-weight:700;}'
    + '.cd-an-fmeta{width:230px;flex-shrink:0;display:flex;gap:8px;font-size:11px;color:#718096;flex-wrap:wrap;}'
    + '@media(max-width:900px){.cd-an-fmeta{width:auto;}}'
    + '.cd-an-footnote{font-size:12px;color:#a0aec0;text-align:center;padding:10px;}'
    ;
  document.head.appendChild(style);
})();
