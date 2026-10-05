/* ============================================================
 * Customer Development Module: Best Send Time Prediction
 * ----------------------------------------------------------------
 * Phase 3 — Feature 3.2 : customer-dev-sending-time.js
 *
 * Predicts the best time to send outreach emails per customer's
 * country timezone, converts it to China time (Leo works 10:00-22:00
 * CST, UTC+8), and labels actionable send windows.
 *
 * Rule basis (free, all client-side):
 *   - Best open windows (customer local): Tue-Thu, 09:00-11:00
 *     and 14:00-16:00.
 *   - Avoid: Mon morning (weekend backlog), Fri afternoon
 *     (weekend prep), deep night.
 *   - DST simplified: standard offsets only, UI labels "约" (~±1h).
 *
 * Views (single NAV entry, internal tabs):
 *   1. Today tasks   — unsent-draft customers grouped by status
 *   2. Customer card — live local clock + best windows + weekday warning
 *   3. Batch slots   — group customers by China time slot (10/12/...)
 *   4. Converter     — manual country + local hour -> China time
 *   5. Stats         — window distribution & timezone counts
 *
 * HARD RULES:
 *   - NEVER auto-send email / WhatsApp. This module only shows
 *     suggested times; Leo sends manually.
 *   - 100% free: pure JS Date math, no paid APIs.
 *   - All CSS classes use the cd- prefix.
 *   - Code comments in English, UI labels in Chinese.
 * ============================================================ */
(function(){
  'use strict';

  // ── Ephemeral UI state (not persisted) ────────────────────
  if(!window._cdSend) window._cdSend = {
    tab: 'today',          // today | card | batch | converter | stats
    selectedId: null,      // customer id for the detail card
    convCountry: 'UTC-5 EST', // converter stores the tz label
    convLocalHour: 10
  };

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'customerDevSendingTime',
    icon: '⏰',
    label: '发送时间',
    title: '最佳发送时间预测 · 按时区换算中国时间',
    crumb: '客户当地周二至周四 9-11/14-16 · 换算 Leo 工作时间 10-22'
  });

  // ============================================================
  // Constants
  // ============================================================

  // China reference offset (CST, UTC+8).
  var CD_CHINA_OFFSET = 8;
  // Leo's working hours (China time).
  var CD_WORK_START = 10;
  var CD_WORK_END   = 22;

  // Country -> timezone table.
  //   offset : hours from UTC (standard time, DST simplified)
  //   label  : human tz label
  //   keys   : lowercase substring match keys (Chinese + English)
  // Order matters: more specific entries must come before generic
  // ones (e.g. US West before generic US).
  var CD_COUNTRY_TIMEZONE = [
    // --- Americas ---
    { offset: -8, label: 'UTC-8 PST', keys: ['美国西部','美西','西海岸','west coast','los angeles','san francisco','seattle','pst','pacific','温哥华','vancouver'] },
    { offset: -5, label: 'UTC-5 EST', keys: ['美国东部','美东','new york','est','eastern','华盛顿','washington'] },
    { offset: -8, label: 'UTC-8 PST', keys: ['加拿大西部','vancouver'] },
    { offset: -5, label: 'UTC-5 EST', keys: ['加拿大','canada','多伦多','toronto','蒙特利尔','montreal'] },
    { offset: -5, label: 'UTC-5 EST', keys: ['美国','united states','america','usa','u.s.','us'] },
    { offset: -6, label: 'UTC-6 CST', keys: ['墨西哥','mexico'] },
    { offset: -3, label: 'UTC-3 BRT', keys: ['巴西','brazil','阿根廷','argentina','buenos aires'] },

    // --- Europe ---
    { offset: 0,  label: 'UTC+0 GMT', keys: ['英国','united kingdom','britain','london','england','苏格兰','scotland','uk','gmt','格林威治'] },
    { offset: 1,  label: 'UTC+1 CET', keys: ['德国','germany','berlin','法国','france','paris','意大利','italy','米兰','milan','罗马','rome','西班牙','spain','madrid','荷兰','netherlands','holland','amsterdam','比利时','belgium','布鲁塞尔','奥地利','austria','维也纳','switzerland','瑞士','苏黎世','波兰','poland','warsaw','捷克','czech','瑞典','sweden','stockholm','挪威','norway','oslo','丹麦','denmark','copenhagen','葡萄牙','portugal','lisbon','芬兰','finland','爱尔兰','ireland','dublin'] },
    { offset: 1,  label: 'UTC+1 WAT', keys: ['摩洛哥','morocco'] },

    // --- Middle East & Africa ---
    { offset: 4,  label: 'UTC+4 GST', keys: ['阿联酋','uae','emirates','dubai','迪拜','阿布扎比'] },
    { offset: 3,  label: 'UTC+3 EAT', keys: ['沙特','saudi','riyadh','阿联酋不算','卡塔尔','qatar','科威特','kuwait'] },
    { offset: 3,  label: 'UTC+3 MSK', keys: ['俄罗斯','russia','moscow','莫斯科','土耳其','turkey','türkiye','istanbul','肯尼亚','kenya','nairobi'] },
    { offset: 2,  label: 'UTC+2 SAST', keys: ['南非','south africa','johannesburg','埃及','egypt','cairo'] },
    { offset: 1,  label: 'UTC+1 WAT', keys: ['尼日利亚','nigeria','lagos'] },

    // --- Asia ---
    { offset: 9,  label: 'UTC+9 JST', keys: ['日本','japan','tokyo','东京','大阪'] },
    { offset: 9,  label: 'UTC+9 KST', keys: ['韩国','korea','seoul','首尔'] },
    { offset: 8,  label: 'UTC+8 SGT', keys: ['新加坡','singapore'] },
    { offset: 7,  label: 'UTC+7 ICT', keys: ['越南','vietnam','hanoi','胡志明','泰国','thailand','bangkok','印尼','indonesia','jakarta','雅加达','曼谷'] },
    { offset: 5.5,label: 'UTC+5:30 IST', keys: ['印度','india','mumbai','new delhi','孟买'] },

    // --- Oceania ---
    { offset: 10, label: 'UTC+10 AEST', keys: ['澳大利亚','australia','sydney','悉尼','melbourne','墨尔本','brisbane','阿德莱德'] },
    { offset: 12, label: 'UTC+12 NZST', keys: ['新西兰','new zealand','auckland','奥克兰','wellington'] },

    // --- China baseline (included for completeness) ---
    { offset: 8,  label: 'UTC+8 CST', keys: ['中国','china','beijing','北京','上海','香港','hong kong'] }
  ];

  // Best windows in customer-local time.
  var CD_LOCAL_WINDOWS = [
    { key: 'am', name: '上午', start: 9,  end: 11 },
    { key: 'pm', name: '下午', start: 14, end: 16 }
  ];

  var CD_WEEKDAYS = ['周日','周一','周二','周三','周四','周五','周六'];
  // Batch slots (China time, hour).
  var CD_BATCH_SLOTS = [10, 12, 14, 16, 18, 20];

  // ============================================================
  // Helpers (reuse app.js globals: S, esc, toast, persist, renderView, currentView)
  // ============================================================
  function cdCustName(c){ return c ? (c.name || c.company || '(未命名客户)') : ''; }
  function cdCustCountry(c){ return (c && (c.country || (c.address && c.address.country) || '')) || ''; }

  // Resolve a country string (Chinese or English) to a timezone entry.
  function cdGetCustomerTimezone(country){
    if(!country) return null;
    var c = String(country).toLowerCase();
    // Exact label match first (converter dropdown stores the tz label).
    for(var i=0;i<CD_COUNTRY_TIMEZONE.length;i++){
      if(CD_COUNTRY_TIMEZONE[i].label.toLowerCase() === c) return CD_COUNTRY_TIMEZONE[i];
    }
    // Fuzzy lowercase substring match on country keys.
    for(var k=0;k<CD_COUNTRY_TIMEZONE.length;k++){
      var t = CD_COUNTRY_TIMEZONE[k];
      for(var j=0;j<t.keys.length;j++){
        if(c.indexOf(t.keys[j]) >= 0) return t;
      }
    }
    return null;
  }

  // Browser runs on Leo's machine = China time. Build a "now" reference.
  function cdChinaNow(){ return new Date(); }

  // Customer local Date (UTC fields, DST-safe) = China time + (offset-8)h.
  function cdLocalDate(country, refDate){
    var tz = cdGetCustomerTimezone(country);
    if(!tz) return null;
    var base = refDate || cdChinaNow();
    var deltaMs = (tz.offset - CD_CHINA_OFFSET) * 3600 * 1000;
    return new Date(base.getTime() + deltaMs);
  }

  // Customer local current time as {hour,minute,weekday}.
  function cdLocalTime(country, refDate){
    var d = cdLocalDate(country, refDate);
    if(!d) return null;
    return {
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      weekday: d.getUTCDay() // 0=Sun ... 6=Sat
    };
  }

  // Convert a customer-local hour -> China hour (0-23 float).
  function cdChinaHourFromLocal(localHour, country){
    var tz = cdGetCustomerTimezone(country);
    if(!tz) return null;
    var h = localHour + (CD_CHINA_OFFSET - tz.offset);
    return h; // raw, may be outside 0-23; caller normalizes
  }

  // Normalize a possibly-raw hour into 0-23 clock.
  function cdNormH(h){ return ((h % 24) + 24) % 24; }

  // Format a float hour as "HH:00" (clock-normalized).
  function cdFmtH(h){
    var hh = Math.floor(cdNormH(h));
    return String(hh).padStart(2,'0') + ':00';
  }

  // Is a given China hour inside Leo's work window [10,22)?
  function cdInWorkHours(chinaHour){
    var h = cdNormH(chinaHour);
    return h >= CD_WORK_START && h < CD_WORK_END;
  }

  // Raw best windows (China clock, may exceed 0-23) for a country.
  function cdBestSendWindows(country){
    var tz = cdGetCustomerTimezone(country);
    if(!tz) return null;
    var shift = CD_CHINA_OFFSET - tz.offset; // local->China
    var raw = CD_LOCAL_WINDOWS.map(function(w){
      return {
        key: w.key,
        name: w.name,
        localLabel: String(w.start).padStart(2,'0') + ':00-' + String(w.end).padStart(2,'0') + ':00',
        chinaStart: w.start + shift,
        chinaEnd:   w.end + shift
      };
    });
    return { tz: tz, windows: raw };
  }

  // Compute actionable China-time slots = overlap(best window, work hours).
  // Returns array of {rs, re} within [10,22].
  function cdActionableSlots(country){
    var bw = cdBestSendWindows(country);
    if(!bw) return [];
    var slots = [];
    bw.windows.forEach(function(w){
      var cs = cdNormH(w.chinaStart);
      var ce = cs + (w.chinaEnd - w.chinaStart); // duration = 2h
      // interval [cs, ce] may wrap past 24; only the [cs, min(ce,24)] part
      // can overlap the daytime work window [10,22].
      var segEnd = Math.min(ce, 24);
      var s = Math.max(cs, CD_WORK_START);
      var e = Math.min(segEnd, CD_WORK_END);
      if(e > s) slots.push({ rs: s, re: e, key: w.key });
    });
    return slots;
  }

  // Recommend a China send time. If best windows overlap work hours,
  // pick the next upcoming actionable slot; otherwise snap to nearest
  // work-hour boundary (10:00 or 20:00).
  function cdRecommendSendTime(country){
    var now = cdChinaNow();
    var nowH = now.getHours() + now.getMinutes()/60;
    var slots = cdActionableSlots(country);

    if(slots.length){
      // upcoming = first slot whose start is still ahead (within today)
      var upcoming = slots.filter(function(s){ return s.rs > nowH; });
      var current  = slots.filter(function(s){ return nowH >= s.rs && nowH <= s.re; });
      if(current.length){
        return { type:'now', label: cdFmtH(current[0].rs)+'-'+cdFmtH(current[0].re),
                 rs: current[0].rs, re: current[0].re, slots: slots };
      }
      if(upcoming.length){
        var u = upcoming.sort(function(a,b){return a.rs-b.rs;})[0];
        return { type:'later', label: cdFmtH(u.rs)+'-'+cdFmtH(u.re),
                 rs: u.rs, re: u.re, slots: slots };
      }
      // all passed today
      var p = slots.sort(function(a,b){return b.rs-a.rs;})[0];
      return { type:'passed', label: cdFmtH(p.rs)+'-'+cdFmtH(p.re)+'（今日已过）',
               rs: p.rs, re: p.re, slots: slots };
    }

    // No actionable overlap: best window falls in China night. Snap.
    var bw = cdBestSendWindows(country);
    var snapTo, note;
    if(bw){
      var mean = cdNormH(bw.windows[0].chinaStart + 1);
      if(mean >= CD_WORK_END - 2 || mean < CD_WORK_START){
        snapTo = { rs: 20, re: 22 };
        note = '最佳时段落在夜间，建议工作时间尾部发送';
      } else {
        snapTo = { rs: CD_WORK_START, re: CD_WORK_START+2 };
        note = '最佳时段落在夜间，建议工作时间开头发送';
      }
    } else {
      snapTo = { rs: CD_WORK_START, re: CD_WORK_START+2 };
      note = '时区未知，建议工作时间发送';
    }
    return { type:'snap', label: cdFmtH(snapTo.rs)+'-'+cdFmtH(snapTo.re),
             rs: snapTo.rs, re: snapTo.re, slots: [], note: note };
  }

  // Cached computed fields on the customer object (not persisted).
  function cdEnrichCustomer(c){
    var country = cdCustCountry(c);
    var tz = cdGetCustomerTimezone(country);
    c.cdTimezone = tz ? tz.label : '时区未知';
    var rec = cdRecommendSendTime(country);
    c.cdBestSendTime = rec ? rec.label : '—';
    return rec;
  }

  // Customers having at least one drafted (unsent, generated/edited) email.
  function cdUnsentCustomers(){
    return (S.customers||[]).filter(function(c){
      if(!Array.isArray(c.cdEmails)) return false;
      return c.cdEmails.some(function(e){
        return e && e.status && (e.status === 'generated' || e.status === 'edited');
      });
    });
  }

  // Weekday warning for customer-local today.
  function cdWeekdayWarn(country){
    var lt = cdLocalTime(country);
    if(!lt) return null;
    var d = lt.weekday;
    if(d === 1) return '⚠️ 客户当地周一：周末邮件堆积，建议稍晚或改周二';
    if(d === 5) return '⚠️ 客户当地周五下午：客户准备周末，打开率偏低';
    if(d === 0 || d === 6) return '🌙 客户当地周末：非工作日，建议工作日发送';
    return null;
  }

  // ============================================================
  // Renderers
  // ============================================================

  function cdShell(body){
    var h = '<div class="cd-page">';
    // tab bar
    var tabs = [
      ['today','📋','今日任务'],
      ['card','🕐','客户时间卡'],
      ['batch','🗓','批量排期'],
      ['converter','🔄','时区换算器'],
      ['stats','📊','统计']
    ];
    h += '<div class="cd-sendtabs">';
    tabs.forEach(function(t){
      h += '<button class="cd-sendtab' + (window._cdSend.tab===t[0]?' active':'')
        + '" onclick="cdSendTab(\'' + t[0] + '\')">' + t[1] + ' ' + t[2] + '</button>';
    });
    h += '</div>';
    h += '<div class="cd-hint" style="margin:6px 2px 10px">⏰ 仅预测建议发送时间，<b>绝不自动发送邮件/WhatsApp</b>。夏令时已简化为标准时区，时间为"约"（±1小时）。Leo 工作时间：中国 10:00-22:00。</div>';
    h += body;
    h += '</div>';
    return h;
  }

  // ---- View 1: Today tasks ----
  function cdRenderToday(root){
    var list = cdUnsentCustomers();
    var now = cdChinaNow();
    var nowH = now.getHours() + now.getMinutes()/60;

    var groups = { now:[], later:[], passed:[] };
    list.forEach(function(c){
      var rec = cdEnrichCustomer(c);
      rec._cust = c;
      if(rec.type === 'now') groups.now.push(rec);
      else if(rec.type === 'later') groups.later.push(rec);
      else groups.passed.push(rec);
    });
    groups.later.sort(function(a,b){return a.rs-b.rs;});

    function cardHtml(rec){
      var c = rec._cust;
      var lt = cdLocalTime(cdCustCountry(c));
      var warn = cdWeekdayWarn(cdCustCountry(c));
      var workOk = cdInWorkHours(nowH);
      var badgeColor = rec.type==='now' ? '#38a169' : (rec.type==='later' ? '#3182ce' : '#a0aec0');
      var badgeTxt = rec.type==='now' ? '✅ 现在可发' : (rec.type==='later' ? '🕘 等待 '+cdFmtH(rec.rs) : '🌙 已过最佳时间');
      return '<div class="cd-card">'
        + '<div class="cd-card-head"><b>' + esc(cdCustName(c)) + '</b>'
        + '<span class="cd-badge" style="background:' + badgeColor + '22;color:' + badgeColor + '">' + badgeTxt + '</span></div>'
        + '<div class="cd-card-meta">'
        + '<div>📍 ' + esc(cdCustCountry(c)||'未知国家') + ' · ' + esc(c.cdTimezone) + '</div>'
        + '<div>🕐 客户当地：' + (lt ? (CD_WEEKDAYS[lt.weekday] + ' ' + String(lt.hour).padStart(2,'0') + ':' + String(lt.minute).padStart(2,'0')) : '—') + '</div>'
        + '<div>📤 建议发送（中国时间）：<b>' + esc(c.cdBestSendTime) + '</b></div>'
        + '<div>💼 现在' + (workOk ? '<b style="color:#38a169">在工作时间内</b>' : '<b style="color:#dd6b20">非工作时间</b>') + '</div>'
        + (warn ? '<div class="cd-warn">' + esc(warn) + '</div>' : '')
        + '</div>'
        + '</div>';
    }

    var h = '';
    if(!list.length){
      h += '<div class="cd-empty">当前没有"已生成/已编辑但未发送"的开发信客户。<br>请先到「开发信引擎」生成开发信，再来这里安排发送时间。</div>';
    } else {
      h += '<div class="cd-stats">'
        + '<div class="cd-stat"><div class="cd-stat-num" style="color:#38a169">' + groups.now.length + '</div><div class="cd-stat-lbl">现在可发</div></div>'
        + '<div class="cd-stat"><div class="cd-stat-num" style="color:#3182ce">' + groups.later.length + '</div><div class="cd-stat-lbl">今日稍后</div></div>'
        + '<div class="cd-stat"><div class="cd-stat-num" style="color:#a0aec0">' + groups.passed.length + '</div><div class="cd-stat-lbl">已过最佳时间</div></div>'
        + '<div class="cd-stat"><div class="cd-stat-num">' + list.length + '</div><div class="cd-stat-lbl">待发送总数</div></div>'
        + '</div>';

      [['now','✅ 现在可发（客户当地正处周二至周四工作时段）',groups.now],
       ['later','🕘 今日稍后',groups.later],
       ['passed','🌙 已过最佳时间（可明日重发或改时段）',groups.passed]].forEach(function(g){
        if(!g[2].length) return;
        h += '<div class="cd-panel"><div class="cd-panel-head">' + g[1] + ' (' + g[2].length + ')</div><div class="cd-cardlist">';
        g[2].forEach(function(rec){ h += cardHtml(rec); });
        h += '</div></div>';
      });
    }
    root.innerHTML = cdShell(h);
  }

  // ---- View 2: Customer time card ----
  function cdRenderCard(root){
    var all = S.customers || [];
    var selId = window._cdSend.selectedId;
    var c = all.find(function(x){return x.id === selId;});
    if(!c && all.length) { c = all[0]; window._cdSend.selectedId = c.id; }

    var h = '<div class="cd-panel"><div class="cd-panel-head">🕐 客户时间卡 · 实时时钟（每分钟自动刷新）</div>';
    h += '<div class="cd-actions"><label style="font-size:12px;color:#718096">选择客户'
      + '<select class="cd-input" style="max-width:320px" onchange="cdSendPick(this.value)">'
      + all.map(function(x){
          return '<option value="' + esc(x.id) + '"' + (c && x.id===c.id?' selected':'') + '>'
            + esc(cdCustName(x)) + '（' + esc(cdCustCountry(x)||'未知') + '）</option>';
        }).join('')
      + '</select></label></div></div>';

    if(!c){
      h += '<div class="cd-empty">暂无客户。请先导入或搜索客户。</div>';
      root.innerHTML = cdShell(h);
      return;
    }

    var country = cdCustCountry(c);
    var tz = cdGetCustomerTimezone(country);
    var lt = cdLocalTime(country);
    var rec = cdEnrichCustomer(c);
    var bw = cdBestSendWindows(country);
    var warn = cdWeekdayWarn(country);
    var now = cdChinaNow();
    var nowH = now.getHours() + now.getMinutes()/60;
    var workOk = cdInWorkHours(nowH);

    h += '<div class="cd-panel"><div class="cd-panel-head">' + esc(cdCustName(c)) + '</div>';
    h += '<div class="cd-clockgrid">';
    // local clock
    h += '<div class="cd-clockbox"><div class="cd-clock-lbl">客户当地时间</div>'
      + '<div class="cd-clock-time">' + (lt ? (String(lt.hour).padStart(2,'0')+':'+String(lt.minute).padStart(2,'0')) : '--:--') + '</div>'
      + '<div class="cd-clock-sub">' + esc(country||'未知国家') + ' · ' + (lt?CD_WEEKDAYS[lt.weekday]:'') + ' · ' + esc(tz?tz.label:'时区未知') + '</div></div>';
    // china clock
    h += '<div class="cd-clockbox"><div class="cd-clock-lbl">中国时间（Leo）</div>'
      + '<div class="cd-clock-time">' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + '</div>'
      + '<div class="cd-clock-sub">' + CD_WEEKDAYS[now.getDay()] + ' · UTC+8 · ' + (workOk?'<b style="color:#38a169">在工作时间内</b>':'<b style="color:#dd6b20">非工作时间</b>') + '</div></div>';
    h += '</div>';

    if(warn) h += '<div class="cd-warn" style="margin-top:10px">' + esc(warn) + '</div>';

    // best windows detail
    h += '<div class="cd-windowlist" style="margin-top:12px">';
    if(bw){
      bw.windows.forEach(function(w){
        h += '<div class="cd-windowrow">'
          + '<div><b>' + w.name + '时段</b> · 客户当地 ' + w.localLabel + '（周二至周四）</div>'
          + '<div>≈ 中国时间 <b>' + cdFmtH(w.chinaStart) + '-' + cdFmtH(w.chinaEnd) + '</b></div>'
          + '</div>';
      });
    } else {
      h += '<div class="cd-empty">无法识别国家时区，请在客户资料中补充国家。</div>';
    }
    h += '</div>';

    h += '<div class="cd-actions" style="margin-top:12px">'
      + '<span class="cd-badge" style="background:#3182ce22;color:#3182ce">📤 建议发送：' + esc(c.cdBestSendTime) + '</span>'
      + (rec.note ? '<span class="cd-hint">' + esc(rec.note) + '</span>' : '')
      + '</div>';
    h += '</div>';

    root.innerHTML = cdShell(h);
  }

  // ---- View 3: Batch slots ----
  function cdRenderBatch(root){
    var list = cdUnsentCustomers();
    var buckets = {};
    CD_BATCH_SLOTS.forEach(function(s){ buckets[s] = []; });

    list.forEach(function(c){
      var rec = cdEnrichCustomer(c);
      // assign to nearest batch slot by recommended start
      var target = CD_BATCH_SLOTS[0];
      var bestDiff = 99;
      CD_BATCH_SLOTS.forEach(function(s){
        var d = Math.abs(cdNormH(rec.rs) - s);
        if(d < bestDiff){ bestDiff = d; target = s; }
      });
      buckets[target].push({ c: c, rec: rec });
    });

    var h = '<div class="cd-panel"><div class="cd-panel-head">🗓 今日批量发送排期（中国时间槽位）</div>'
      + '<div class="cd-hint" style="margin-bottom:10px">按建议发送开始时间就近分配到时间槽。每个时间槽内客户当地都接近周二至周四的上午/下午工作时段。</div>';
    CD_BATCH_SLOTS.forEach(function(s){
      var items = buckets[s];
      h += '<div class="cd-slotrow"><div class="cd-slothead">🕘 ' + String(s).padStart(2,'0') + ':00 <span class="cd-hint">（' + items.length + ' 位客户）</span></div>';
      if(!items.length){
        h += '<div class="cd-hint" style="padding:6px 0">— 无 —</div>';
      } else {
        h += '<div class="cd-cardlist">';
        items.forEach(function(it){
          var lt = cdLocalTime(cdCustCountry(it.c));
          h += '<div class="cd-card">'
            + '<div class="cd-card-head"><b>' + esc(cdCustName(it.c)) + '</b></div>'
            + '<div class="cd-card-meta">'
            + '<div>📍 ' + esc(cdCustCountry(it.c)||'未知') + ' · ' + esc(it.c.cdTimezone) + '</div>'
            + '<div>🕐 客户当地：' + (lt?CD_WEEKDAYS[lt.weekday]+' '+String(lt.hour).padStart(2,'0')+':'+String(lt.minute).padStart(2,'0'):'—') + '</div>'
            + '<div>📤 客户当地最佳：' + (cdBestSendWindows(cdCustCountry(it.c)) ? cdBestSendWindows(cdCustCountry(it.c)).windows.map(function(w){return w.name+' '+w.localLabel;}).join(' / ') : '—') + '</div>'
            + '</div></div>';
        });
        h += '</div>';
      }
      h += '</div>';
    });
    h += '</div>';
    root.innerHTML = cdShell(h);
  }

  // ---- View 4: Converter ----
  function cdRenderConverter(root){
    var country = window._cdSend.convCountry;
    var lh = window._cdSend.convLocalHour;
    var tz = cdGetCustomerTimezone(country);
    var chinaH = tz ? cdChinaHourFromLocal(lh, country) : null;

    var h = '<div class="cd-panel"><div class="cd-panel-head">🔄 时区换算工具</div>';
    h += '<div class="cd-formgrid">'
      + '<label>国家/地区<select class="cd-input" onchange="cdSendConv(\'country\', this.value)">'
      + CD_COUNTRY_TIMEZONE.map(function(t,i){
          return '<option value="' + esc(t.label) + '"' + (tz && t.label===tz.label?' selected':'') + '>' + esc(t.label) + '</option>';
        }).join('')
      + '</select></label>'
      + '<label>客户当地小时 (0-23)<select class="cd-input" onchange="cdSendConv(\'hour\', this.value)">'
      + Array.from({length:24}, function(_,i){ return '<option value="'+i+'"'+(lh===i?' selected':'')+'>'+String(i).padStart(2,'0')+':00</option>'; }).join('')
      + '</select></label>'
      + '</div>';

    h += '<div class="cd-clockgrid" style="margin-top:14px">';
    h += '<div class="cd-clockbox"><div class="cd-clock-lbl">客户当地</div><div class="cd-clock-time">'
      + String(lh).padStart(2,'0') + ':00</div><div class="cd-clock-sub">' + esc(tz?tz.label:'时区未知') + '</div></div>';
    h += '<div class="cd-clockbox"><div class="cd-clock-lbl">= 中国时间</div><div class="cd-clock-time">'
      + (chinaH!==null ? cdFmtH(chinaH) : '--:--') + '</div>'
      + '<div class="cd-clock-sub">UTC+8 · ' + (chinaH!==null ? (cdInWorkHours(chinaH)?'✅ 在工作时间内':'🌙 非工作时间') : '') + '</div></div>';
    h += '</div>';

    if(chinaH!==null){
      h += '<div class="cd-hint" style="margin-top:10px">换算：中国时间 = 客户当地 ' + String(lh).padStart(2,'0') + ':00 + (8 - ' + tz.offset + ')h = ' + cdFmtH(chinaH) + '。'
        + '若客户当地为周二至周四 9-11 或 14-16，即最佳发送窗口。</div>';
    }
    h += '</div>';
    root.innerHTML = cdShell(h);
  }

  // ---- View 5: Stats ----
  function cdRenderStats(root){
    var all = S.customers || [];
    var tzCount = {};
    var slotCount = {};
    CD_BATCH_SLOTS.forEach(function(s){ slotCount[s] = 0; });
    var unknown = 0;

    all.forEach(function(c){
      var tz = cdGetCustomerTimezone(cdCustCountry(c));
      if(!tz){ unknown++; return; }
      tzCount[tz.label] = (tzCount[tz.label]||0) + 1;
      var rec = cdRecommendSendTime(cdCustCountry(c));
      var target = CD_BATCH_SLOTS[0]; var bd = 99;
      CD_BATCH_SLOTS.forEach(function(s){
        var d = Math.abs(cdNormH(rec.rs) - s);
        if(d < bd){ bd = d; target = s; }
      });
      slotCount[target]++;
    });

    var h = '<div class="cd-stats">'
      + '<div class="cd-stat"><div class="cd-stat-num">' + all.length + '</div><div class="cd-stat-lbl">客户总数</div></div>'
      + '<div class="cd-stat"><div class="cd-stat-num">' + Object.keys(tzCount).length + '</div><div class="cd-stat-lbl">覆盖时区数</div></div>'
      + '<div class="cd-stat"><div class="cd-stat-num" style="color:' + (unknown?'#dd6b20':'#38a169') + '">' + unknown + '</div><div class="cd-stat-lbl">时区未知</div></div>'
      + '</div>';

    h += '<div class="cd-panel"><div class="cd-panel-head">🌍 各时区客户数</div><div class="cd-dist">';
    Object.keys(tzCount).sort(function(a,b){return tzCount[b]-tzCount[a];}).forEach(function(k){
      h += '<span class="cd-chip">' + esc(k) + ' ' + tzCount[k] + '</span>';
    });
    h += '</div></div>';

    h += '<div class="cd-panel"><div class="cd-panel-head">📤 建议发送时段分布（中国时间槽）</div><div class="cd-dist">';
    CD_BATCH_SLOTS.forEach(function(s){
      h += '<span class="cd-chip">🕘' + String(s).padStart(2,'0') + ':00 → ' + slotCount[s] + '人</span>';
    });
    h += '</div></div>';

    root.innerHTML = cdShell(h);
  }

  // ============================================================
  // Global handlers
  // ============================================================
  window.cdSendTab = function(t){ window._cdSend.tab = t; renderView(); };
  window.cdSendPick = function(id){ window._cdSend.selectedId = id; renderView(); };
  window.cdSendConv = function(which, val){
    if(which === 'country') window._cdSend.convCountry = val;
    else window._cdSend.convLocalHour = parseInt(val,10) || 0;
    renderView();
  };

  // ============================================================
  // renderView interception
  // ============================================================
  var _cdSendOrigRV = window.renderView;
  window.renderView = function(){
    var main = document.getElementById('mainContent');
    if(!main){ _cdSendOrigRV.apply(this, arguments); return; }
    if(currentView === 'customerDevSendingTime'){
      var tab = window._cdSend.tab;
      if(tab === 'today') cdRenderToday(main);
      else if(tab === 'card') cdRenderCard(main);
      else if(tab === 'batch') cdRenderBatch(main);
      else if(tab === 'converter') cdRenderConverter(main);
      else if(tab === 'stats') cdRenderStats(main);
      else cdRenderToday(main);
      return;
    }
    _cdSendOrigRV.apply(this, arguments);
  };

  // Live clock refresh (only when this view is active).
  setInterval(function(){
    if(typeof currentView !== 'undefined' && currentView === 'customerDevSendingTime'
       && document.getElementById('mainContent')){
      renderView();
    }
  }, 60000);

  // ============================================================
  // Styles (cd- prefixed, responsive)
  // ============================================================
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-sendtabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;}'
    + '.cd-sendtab{font-size:13px;padding:6px 12px;border:1px solid #cbd5e0;border-radius:16px;background:#f7fafc;cursor:pointer;color:#4a5568;}'
    + '.cd-sendtab.active{background:#3182ce;color:#fff;border-color:#3182ce;}'
    + '.cd-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}'
    + '.cd-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;}'
    + '.cd-stat-num{font-size:24px;font-weight:700;color:#2d3748;}'
    + '.cd-stat-lbl{font-size:12px;color:#718096;margin-top:4px;}'
    + '.cd-cardlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;}'
    + '.cd-card{background:#f7fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;}'
    + '.cd-card-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;}'
    + '.cd-card-meta{font-size:12px;color:#4a5568;line-height:1.7;}'
    + '.cd-badge{font-size:11px;padding:2px 8px;border-radius:10px;white-space:nowrap;}'
    + '.cd-warn{margin-top:4px;color:#c05621;background:#feebc8;padding:4px 8px;border-radius:6px;font-size:12px;}'
    + '.cd-clockgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}'
    + '.cd-clockbox{background:#f7fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;}'
    + '.cd-clock-lbl{font-size:12px;color:#718096;}'
    + '.cd-clock-time{font-size:38px;font-weight:700;color:#2d3748;font-variant-numeric:tabular-nums;}'
    + '.cd-clock-sub{font-size:12px;color:#718096;margin-top:4px;}'
    + '.cd-windowlist{display:flex;flex-direction:column;gap:8px;}'
    + '.cd-windowrow{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#2d3748;background:#ebf8ff;padding:8px 10px;border-radius:8px;flex-wrap:wrap;}'
    + '.cd-slotrow{margin-bottom:12px;}'
    + '.cd-slothead{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:6px;}'
    + '.cd-dist{display:flex;flex-wrap:wrap;gap:6px;}'
    + '.cd-chip{font-size:12px;padding:4px 10px;border:1px solid #cbd5e0;border-radius:12px;background:#f7fafc;color:#4a5568;}'
    + '.cd-empty{padding:36px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.cd-formgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}'
    + '.cd-formgrid label{display:flex;flex-direction:column;font-size:12px;color:#718096;gap:4px;}'
    + '.cd-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;}'
    + '.cd-hint{font-size:12px;color:#718096;line-height:1.5;}'
    + '@media(max-width:640px){.cd-stats{grid-template-columns:repeat(2,1fr);}.cd-clockgrid{grid-template-columns:1fr;}.cd-formgrid{grid-template-columns:1fr;}}';
  document.head.appendChild(style);

})();
