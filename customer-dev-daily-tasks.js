/* ============================================================
 * Customer Development — Daily Tasks Enhanced (customer-dev-daily-tasks.js)
 * ----------------------------------------------------------------
 * Phase 5 — Feature 5.3 : Enhanced daily task board.
 *
 * Integrates 6 task streams:
 *   1. 📤 Pending first outreach (generated drafts not yet sent)
 *   2. 🔄 Due follow-up rounds (Day3/7/14/21/30)
 *   3. 💤 Dormant wake-up (customers idle 30+ days)
 *   4. 📨 Pending customer replies (need AI reply draft)
 *   5. 📋 Pending background intel / due-diligence
 *   6. ✍️ Pending draft generation (customers with email, no draft yet)
 *
 * Plus:
 *   - Task management: status, mark-sent (records account + time),
 *     skip (with reason), priority, best-time sort, category grouping,
 *     account-assignment suggestion, batch ops, per-task notes.
 *   - Daily quota: 3 accounts × 5 = 15/day, real-time, per-account,
 *     per-category, over-limit warning, auto-reset by date.
 *   - Completion stats: today / this-week completion rate, average
 *     daily sends, consecutive check-in days.
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Manual send only.
 *   - No external libraries.
 *   - All custom CSS uses the cd- (and cd-dt-) prefix.
 *   - Comments in English. UI text in Chinese.
 *   - Does NOT modify app.js / server.js / index.html.
 * ============================================================ */
(function () {
  'use strict';

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'cdDailyTasks',
    icon: '📋',
    label: '每日任务',
    title: '每日任务 · 6类任务 / 配额 / 完成率',
    crumb: '待发送/待跟进/沉睡唤醒/待回复/待背调/待生成 · 15封/天配额'
  });

  // ── Ephemeral UI state ─────────────────────────────────────
  if (!window._cdDt) window._cdDt = {
    tab: 'all',
    groupByCat: false,
    sortByTime: true,
    selected: {}   // taskId -> true for batch ops
  };

  var QUOTA_PER_ACCOUNT = 5;

  // ============================================================
  // Task log helpers (persisted in S.cdPhase5.taskLog)
  // ============================================================

  function ensurePhase5() {
    if (!S.cdPhase5) S.cdPhase5 = { taskLog: [], customerStage: {}, mailboxHealth: {}, calendarTasks: {}, uiPrefs: {} };
    if (!Array.isArray(S.cdPhase5.taskLog)) S.cdPhase5.taskLog = [];
    return S.cdPhase5;
  }

  // Get today's done / skipped sets from taskLog
  function todayTaskState() {
    var p5 = ensurePhase5();
    var today = (window.cdUtilTodayStr && window.cdUtilTodayStr()) || '';
    var done = [], skipped = [], noted = {};
    p5.taskLog.forEach(function (l) {
      if (l.date !== today) return;
      if (l.action === 'sent' || l.action === 'done') done.push(l.taskId);
      else if (l.action === 'skipped') skipped.push(l.taskId);
      else if (l.action === 'noted' && l.note) noted[l.taskId] = l.note;
    });
    return { done: done, skipped: skipped, noted: noted };
  }

  function logTask(taskId, action, meta) {
    var p5 = ensurePhase5();
    p5.taskLog.push(Object.assign({
      date: (window.cdUtilTodayStr && window.cdUtilTodayStr()) || '',
      taskId: taskId,
      action: action,
      timestamp: new Date().toISOString()
    }, meta || {}));
    persist();
  }

  // ============================================================
  // Quota
  // ============================================================

  function getQuota() {
    var accounts = S.emailAccounts || [];
    var today = (window.cdUtilTodayStr && window.cdUtilTodayStr()) || '';
    // reset daily counters if date changed (mirror p2ResetDailyCounters)
    accounts.forEach(function (a) {
      if (a.dailySentDate !== today) { a.dailySentCount = 0; a.dailySentDate = today; }
    });
    var total = accounts.length * QUOTA_PER_ACCOUNT;
    var used = 0;
    var perAccount = accounts.map(function (a) {
      var u = a.dailySentCount || 0;
      used += u;
      return { id: a.id, name: a.displayName || a.email, used: u, max: QUOTA_PER_ACCOUNT, full: u >= QUOTA_PER_ACCOUNT };
    });
    // category usage from sendRecords today
    var catUsed = {};
    (S.sendRecords || []).forEach(function (r) {
      if ((r.sentAt || '').slice(0, 10) !== today) return;
      catUsed[r.category || 'unknown'] = (catUsed[r.category || 'unknown'] || 0) + 1;
    });
    return { total: total, used: used, remaining: Math.max(0, total - used), perAccount: perAccount, catUsed: catUsed };
  }

  // Suggest an account for the next task (round-robin among not-full)
  function suggestAccount() {
    var q = getQuota();
    var avail = q.perAccount.filter(function (a) { return !a.full; });
    if (!avail.length) return null;
    return avail[0];
  }

  // ============================================================
  // Task collectors (6 streams)
  // ============================================================

  // 1. Pending first outreach: generated/edited drafts not yet sent
  function collectPendingSends() {
    var out = [];
    (S.customers || []).forEach(function (c) {
      (c.cdEmails || []).forEach(function (e) {
        if (e && (e.status === 'generated' || e.status === 'edited')) {
          out.push({
            id: 'send_' + c.id + '_' + e.type,
            type: 'send',
            customerId: c.id,
            customerName: window.cdUtilCustName(c),
            country: c.country || '',
            productCategory: c.productCategory || '',
            emailType: e.type || 'first-outreach',
            emailTypeLabel: e.typeLabel || window.cdUtilEmailTypeLabel(e.type || 'first-outreach'),
            subject: e.subjectEn || '',
            priority: c.leadScore || c.scores ? 'high' : 'mid',
            bestTime: recommendTime(c)
          });
        }
      });
    });
    return out;
  }

  // 2. Due follow-up rounds
  function collectDueFollowups() {
    if (typeof window.cdFollowupGetDueCustomers !== 'function') return [];
    var list = window.cdFollowupGetDueCustomers() || [];
    return list.map(function (d) {
      var c = window.cdUtilFindCustomer(d.customerId);
      return {
        id: 'followup_' + d.customerId + '_' + d.stepKey,
        type: 'followup',
        customerId: d.customerId,
        customerName: d.customerName,
        country: d.country || '',
        productCategory: d.productCategory || '',
        emailType: d.stepKey || 'day7-followup',
        emailTypeLabel: d.stepLabel || '跟进',
        subject: d.angle || '',
        priority: 'high',
        bestTime: recommendTime(c || { country: d.country })
      };
    });
  }

  // 3. Dormant wake-up
  function collectDormant() {
    try {
      if (typeof window.cdDormantGetList === 'function') {
        var list = window.cdDormantGetList() || [];
        return list.slice(0, 20).map(function (d) {
          var c = window.cdUtilFindCustomer(d.customerId || d.id);
          return {
            id: 'wakeup_' + (d.customerId || d.id),
            type: 'wakeup',
            customerId: d.customerId || d.id,
            customerName: d.customerName || window.cdUtilCustName(c),
            country: (c && c.country) || '',
            productCategory: (c && c.productCategory) || '',
            emailType: 'dormant-wakeup',
            emailTypeLabel: '沉睡唤醒',
            subject: d.recommendedAngle || '节日/新品问候',
            priority: 'low',
            bestTime: recommendTime(c || {})
          };
        });
      }
    } catch (e) {}
    // fallback
    var out = [];
    (S.customers || []).forEach(function (c) {
      var last = c.lastContactAt || c.lastComm || c.lastInteraction;
      var days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : 9999;
      if (days >= 30 && days < 180) {
        if (c.cdFollowup && c.cdFollowup.active && !c.cdFollowup.paused) return;
        out.push({
          id: 'wakeup_' + c.id,
          type: 'wakeup',
          customerId: c.id,
          customerName: window.cdUtilCustName(c),
          country: c.country || '',
          productCategory: c.productCategory || '',
          emailType: 'dormant-wakeup',
          emailTypeLabel: '沉睡唤醒',
          subject: days >= 90 ? '节日问候+新品推荐' : '新品/行业动态分享',
          priority: 'low',
          bestTime: recommendTime(c)
        });
      }
    });
    return out.slice(0, 20);
  }

  // 4. Pending customer replies (last msg is from customer, no our reply after)
  function collectPendingReplies() {
    var out = [];
    (S.customers || []).forEach(function (c) {
      if (!Array.isArray(c.cdConversations) || !c.cdConversations.length) return;
      var convs = c.cdConversations;
      var lastCustIdx = -1;
      for (var i = convs.length - 1; i >= 0; i--) {
        if (convs[i].role === 'customer') { lastCustIdx = i; break; }
      }
      if (lastCustIdx < 0) return;
      var hasOurReply = false;
      for (var j = lastCustIdx + 1; j < convs.length; j++) {
        if (convs[j].role === 'us') { hasOurReply = true; break; }
      }
      if (hasOurReply) return;
      var lastC = convs[lastCustIdx];
      out.push({
        id: 'reply_' + c.id + '_' + lastCustIdx,
        type: 'reply',
        customerId: c.id,
        customerName: window.cdUtilCustName(c),
        country: c.country || '',
        productCategory: c.productCategory || '',
        emailType: 'customer-reply',
        emailTypeLabel: '客户回复',
        subject: String(lastC.content || '').substring(0, 60),
        priority: 'high',
        bestTime: recommendTime(c)
      });
    });
    return out;
  }

  // 5. Pending background intel (no intel result yet)
  function collectPendingIntel() {
    var out = [];
    (S.customers || []).forEach(function (c) {
      if (c.blacklisted || c.unsubscribe) return;
      var hasEmail = false;
      try { if (typeof getCustomerPrimaryEmail === 'function') hasEmail = !!getCustomerPrimaryEmail(c); } catch (e) { hasEmail = !!c.email; }
      if (!hasEmail) return;
      // consider intel done if c.intel exists with any content
      if (c.intel && (c.intel.summary || c.intel.founded || c.intel.size)) return;
      out.push({
        id: 'intel_' + c.id,
        type: 'intel',
        customerId: c.id,
        customerName: window.cdUtilCustName(c),
        country: c.country || '',
        productCategory: c.productCategory || '',
        emailType: 'other',
        emailTypeLabel: 'AI背调',
        subject: '需生成客户背调报告',
        priority: c.leadScore ? 'mid' : 'low',
        bestTime: '任意时间（后台任务）'
      });
    });
    return out.slice(0, 30);
  }

  // 6. Pending draft generation (has email, no cdEmails drafts yet)
  function collectPendingDrafts() {
    var out = [];
    (S.customers || []).forEach(function (c) {
      if (c.blacklisted || c.unsubscribe) return;
      var hasEmail = false;
      try { if (typeof getCustomerPrimaryEmail === 'function') hasEmail = !!getCustomerPrimaryEmail(c); } catch (e) { hasEmail = !!c.email; }
      if (!hasEmail) return;
      // already has drafts?
      if (Array.isArray(c.cdEmails) && c.cdEmails.length) return;
      // already sent to this customer?
      if ((S.sendRecords || []).some(function (r) { return r.customerId === c.id; })) return;
      out.push({
        id: 'draft_' + c.id,
        type: 'draft',
        customerId: c.id,
        customerName: window.cdUtilCustName(c),
        country: c.country || '',
        productCategory: c.productCategory || '',
        emailType: 'first-outreach',
        emailTypeLabel: '生成开发信',
        subject: '需生成首封开发信',
        priority: c.leadScore ? 'high' : 'mid',
        bestTime: recommendTime(c)
      });
    });
    return out.slice(0, 30);
  }

  function recommendTime(c) {
    try {
      if (typeof window.cdRecommendSendTime === 'function') {
        var rec = window.cdRecommendSendTime(c.country || '');
        if (rec) return rec.label;
      }
    } catch (e) {}
    return '建议工作时间发送';
  }

  function getAllTasks() {
    return []
      .concat(collectPendingSends())
      .concat(collectDueFollowups())
      .concat(collectDormant())
      .concat(collectPendingReplies())
      .concat(collectPendingIntel())
      .concat(collectPendingDrafts());
  }

  // ============================================================
  // Completion stats
  // ============================================================

  function computeStats() {
    var p5 = ensurePhase5();
    var today = (window.cdUtilTodayStr && window.cdUtilTodayStr()) || '';
    // today's sent count from taskLog
    var todaySent = p5.taskLog.filter(function (l) { return l.date === today && (l.action === 'sent' || l.action === 'done'); }).length;
    // this week (last 7 days)
    var weekSent = 0;
    var dailyBuckets = {};
    p5.taskLog.forEach(function (l) {
      if (l.action !== 'sent' && l.action !== 'done') return;
      var diff = window.cdUtilDaysBetween(today, l.date);
      if (diff >= 0 && diff < 7) weekSent++;
      dailyBuckets[l.date] = (dailyBuckets[l.date] || 0) + 1;
    });
    // consecutive check-in days: walk backwards from today
    var streak = 0;
    var d = new Date();
    for (var i = 0; i < 365; i++) {
      var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (dailyBuckets[ds] && dailyBuckets[ds] > 0) streak++;
      else if (i === 0) { /* today not sent yet, streak not broken */ }
      else break;
      d.setDate(d.getDate() - 1);
    }
    var activeTasks = getAllTasks();
    var st = todayTaskState();
    var doneCount = activeTasks.filter(function (t) { return st.done.indexOf(t.id) >= 0; }).length;
    var completionRate = activeTasks.length ? Math.round(doneCount / activeTasks.length * 100) : 0;
    return {
      todaySent: todaySent,
      weekSent: weekSent,
      streak: streak,
      activeCount: activeTasks.length,
      doneCount: doneCount,
      completionRate: completionRate,
      avgDailySent: weekSent ? Math.round(weekSent / 7) : 0
    };
  }

  // ============================================================
  // Rendering
  // ============================================================

  var TYPE_META = {
    send:     { icon: '📤', color: '#3182ce', label: '待发送首次' },
    followup: { icon: '🔄', color: '#dd6b20', label: '待发送跟进' },
    wakeup:   { icon: '💤', color: '#805ad5', label: '沉睡唤醒' },
    reply:    { icon: '📨', color: '#d69e2e', label: '待回复客户' },
    intel:    { icon: '📋', color: '#2f855a', label: '待背调' },
    draft:    { icon: '✍️', color: '#e53e3e', label: '待生成开发信' }
  };

  function typeBadge(t) {
    var m = TYPE_META[t.type] || TYPE_META.send;
    return '<span class="cd-dt-badge" style="background:' + m.color + '22;color:' + m.color + '">' + m.icon + ' ' + m.label + '</span>';
  }

  function priorityLabel(p) {
    if (p === 'high') return '<span class="cd-dt-pri cd-dt-pri-high">高</span>';
    if (p === 'low') return '<span class="cd-dt-pri cd-dt-pri-low">低</span>';
    return '<span class="cd-dt-pri cd-dt-pri-mid">中</span>';
  }

  function renderQuota(q) {
    var pct = q.total ? Math.round(q.used / q.total * 100) : 0;
    var over = q.used > q.total;
    var h = '<div class="cd-dt-quota' + (over ? ' over' : '') + '">'
      + '<div class="cd-dt-quota-head"><b>📊 今日发送配额</b>'
      + (over ? '<span class="cd-dt-warn">⚠️ 已超限！请暂停发送</span>' : '<span class="cd-dt-hint">3邮箱 × 5封 = 15封/天，防封禁</span>')
      + '</div>'
      + '<div class="cd-dt-quota-nums"><span class="cd-dt-quota-used">' + q.used + '</span> / <span class="cd-dt-quota-total">' + q.total + '</span> 已发送 · 剩余 <b>' + q.remaining + '</b> 封</div>'
      + '<div class="cd-dt-quota-bar"><span style="width:' + Math.min(100, pct) + '%"></span></div>';
    if (q.perAccount.length) {
      h += '<div class="cd-dt-quota-accs">';
      q.perAccount.forEach(function (a) {
        h += '<span class="cd-dt-chip' + (a.full ? ' full' : '') + '">' + window.cdUtilEsc(a.name) + ' ' + a.used + '/' + a.max + '</span>';
      });
      h += '</div>';
    }
    // category usage
    var catKeys = Object.keys(q.catUsed);
    if (catKeys.length) {
      h += '<div class="cd-dt-quota-cat"><span class="cd-dt-hint">品类已发：</span>';
      catKeys.forEach(function (k) {
        var label = (typeof P2_CAT_LABELS === 'object' && P2_CAT_LABELS[k]) ? P2_CAT_LABELS[k] : k;
        h += '<span class="cd-dt-chip">' + window.cdUtilEsc(label) + ' ' + q.catUsed[k] + '</span>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function renderStats(s) {
    var cards = [
      { n: s.todaySent, label: '今日已发', c: '#dd6b20' },
      { n: s.weekSent, label: '近7天已发', c: '#3182ce' },
      { n: s.completionRate + '%', label: '今日完成率', c: '#38a169' },
      { n: s.avgDailySent, label: '日均发送', c: '#805ad5' },
      { n: s.streak + '天', label: '连续打卡', c: '#d69e2e' },
      { n: s.activeCount, label: '待办任务', c: '#c53030' }
    ];
    var h = '<div class="cd-dt-stat-grid">';
    cards.forEach(function (c) {
      h += '<div class="cd-dt-stat-card"><div class="cd-dt-stat-num" style="color:' + c.c + '">' + c.n + '</div><div class="cd-dt-stat-label">' + c.label + '</div></div>';
    });
    h += '</div>';
    return h;
  }

  function renderTaskRow(t, st, q) {
    var done = st.done.indexOf(t.id) >= 0;
    var skipped = st.skipped.indexOf(t.id) >= 0;
    var note = st.noted[t.id] || '';
    var sel = window._cdDt.selected[t.id] ? ' checked' : '';
    var catLabel = (typeof P2_CAT_LABELS === 'object' && P2_CAT_LABELS[t.productCategory]) ? P2_CAT_LABELS[t.productCategory] : (t.productCategory || '—');

    var h = '<div class="cd-dt-task' + (done ? ' done' : '') + (skipped ? ' skipped' : '') + '">'
      + '<label class="cd-dt-check"><input type="checkbox" data-act="toggleSel" data-id="' + t.id + '"' + sel + '></label>'
      + '<div class="cd-dt-task-main">'
      + '<div class="cd-dt-task-head">' + typeBadge(t) + priorityLabel(t.priority)
      + '<b style="margin-left:6px">' + window.cdUtilEsc(t.customerName) + '</b>'
      + '<span class="cd-dt-hint" style="margin-left:auto">📍 ' + window.cdUtilEsc(t.country || '—') + ' · 🗂 ' + window.cdUtilEsc(catLabel) + '</span>'
      + '</div>'
      + '<div class="cd-dt-task-detail">📧 ' + window.cdUtilEsc(t.emailTypeLabel)
      + (t.subject ? ' · ' + window.cdUtilEsc(t.subject.substring(0, 60)) : '') + '</div>'
      + '<div class="cd-dt-task-detail cd-dt-time">🕐 ' + window.cdUtilEsc(t.bestTime) + '</div>'
      + (note ? '<div class="cd-dt-note">📝 ' + window.cdUtilEsc(note) + '</div>' : '')
      + '</div>'
      + '<div class="cd-dt-task-actions">';
    if (!done && !skipped) {
      if (t.type === 'send') h += '<button class="cd-dt-btn" data-act="goEdit" data-id="' + t.id + '">✏️ 编辑发送</button>';
      else if (t.type === 'followup') h += '<button class="cd-dt-btn" data-act="goFollowup" data-id="' + t.id + '">✨ 生成跟进</button>';
      else if (t.type === 'reply') h += '<button class="cd-dt-btn" data-act="goReply" data-id="' + t.id + '">📨 回复草稿</button>';
      else if (t.type === 'intel') h += '<button class="cd-dt-btn" data-act="goIntel" data-id="' + t.id + '">🔍 开始背调</button>';
      else if (t.type === 'draft') h += '<button class="cd-dt-btn" data-act="goDraft" data-id="' + t.id + '">✍️ 生成开发信</button>';
      else if (t.type === 'wakeup') h += '<button class="cd-dt-btn" data-act="goWakeup" data-id="' + t.id + '">💤 生成唤醒</button>';
      h += '<button class="cd-dt-btn cd-dt-btn-success" data-act="markSent" data-id="' + t.id + '">✅ 已发送</button>';
      h += '<button class="cd-dt-btn" data-act="skip" data-id="' + t.id + '">✖ 跳过</button>';
      h += '<button class="cd-dt-btn" data-act="addNote" data-id="' + t.id + '">📝 备注</button>';
    } else if (done) {
      h += '<span class="cd-dt-badge" style="background:#38a16922;color:#38a169">✅ 已完成</span>';
    } else {
      h += '<span class="cd-dt-badge" style="background:#a0aec022;color:#718096">⏭ 已跳过</span>';
    }
    h += '</div></div>';
    return h;
  }

  function renderPage(root) {
    var q = getQuota();
    var s = computeStats();
    var st = todayTaskState();
    var all = getAllTasks();

    // sort
    if (window._cdDt.sortByTime) {
      all.sort(function (a, b) {
        // high priority first, then by customer name
        var pa = a.priority === 'high' ? 0 : (a.priority === 'mid' ? 1 : 2);
        var pb = b.priority === 'high' ? 0 : (b.priority === 'mid' ? 1 : 2);
        return pa - pb;
      });
    }

    var active = all.filter(function (t) { return st.done.indexOf(t.id) < 0 && st.skipped.indexOf(t.id) < 0; });
    var doneList = all.filter(function (t) { return st.done.indexOf(t.id) >= 0 || st.skipped.indexOf(t.id) >= 0; });

    var h = '<div class="cd-dt-header">'
      + '<div><h2 style="margin:0">📋 每日任务工作台</h2>'
      + '<div class="cd-dt-hint" style="margin-top:4px">' + (window.cdUtilTodayStr && window.cdUtilTodayStr()) + ' · 6类任务聚合 · 手动发送，工作台不自动发信</div></div>'
      + '</div>';

    h += renderStats(s);
    h += renderQuota(q);

    // Tabs
    h += '<div class="cd-dt-tabs">';
    var tabs = [['all', '全部']].concat(Object.keys(TYPE_META).map(function (k) {
      return [k, TYPE_META[k].icon + ' ' + TYPE_META[k].label];
    }));
    tabs.forEach(function (tb) {
      var count = tb[0] === 'all' ? active.length : active.filter(function (x) { return x.type === tb[0]; }).length;
      h += '<div class="cd-dt-tab' + (window._cdDt.tab === tb[0] ? ' on' : '') + '" data-act="tab" data-tab="' + tb[0] + '">' + tb[1] + ' <span class="cd-dt-tab-n">' + count + '</span></div>';
    });
    h += '</div>';

    // toolbar
    h += '<div class="cd-dt-toolbar">'
      + '<label class="cd-dt-hint"><input type="checkbox" data-act="toggleSort"' + (window._cdDt.sortByTime ? ' checked' : '') + '> 按优先级排序</label>'
      + '<label class="cd-dt-hint"><input type="checkbox" data-act="toggleGroup"' + (window._cdDt.groupByCat ? ' checked' : '') + '> 按品类分组</label>'
      + '<span style="flex:1"></span>'
      + '<button class="cd-dt-btn cd-dt-btn-success" data-act="batchSent">✅ 批量标记已发送</button>'
      + '<button class="cd-dt-btn" data-act="batchSkip">✖ 批量跳过</button>'
      + '</div>';

    // filtered tasks
    var filtered = window._cdDt.tab === 'all' ? active : active.filter(function (t) { return t.type === window._cdDt.tab; });
    if (!filtered.length) {
      h += '<div class="cd-dt-empty">🎉 该分类下今日暂无待办任务。</div>';
    } else if (window._cdDt.groupByCat) {
      var groups = {};
      filtered.forEach(function (t) {
        var k = t.productCategory || 'unknown';
        groups[k] = groups[k] || [];
        groups[k].push(t);
      });
      Object.keys(groups).forEach(function (k) {
        var label = (typeof P2_CAT_LABELS === 'object' && P2_CAT_LABELS[k]) ? P2_CAT_LABELS[k] : k;
        h += '<div class="cd-dt-group"><div class="cd-dt-group-title">🗂 ' + window.cdUtilEsc(label) + ' (' + groups[k].length + ')</div>';
        groups[k].forEach(function (t) { h += renderTaskRow(t, st, q); });
        h += '</div>';
      });
    } else {
      h += '<div class="cd-dt-list">';
      filtered.forEach(function (t) { h += renderTaskRow(t, st, q); });
      h += '</div>';
    }

    if (doneList.length) {
      h += '<div class="cd-dt-done-head">✅ 今日已处理（' + doneList.length + '）</div>';
      h += '<div class="cd-dt-list">';
      doneList.forEach(function (t) { h += renderTaskRow(t, st, q); });
      h += '</div>';
    }

    // account suggestion
    var sug = suggestAccount();
    if (sug) {
      h += '<div class="cd-dt-suggest">💡 建议下一封使用邮箱：<b>' + window.cdUtilEsc(sug.name) + '</b>（今日已发 ' + sug.used + '/' + sug.max + '）</div>';
    } else if (q.perAccount.length) {
      h += '<div class="cd-dt-suggest cd-dt-suggest-warn">⚠️ 所有邮箱今日配额已满，请明天再发或手动重置计数。</div>';
    }

    h += '<div class="cd-dt-footer">🔒 本工作台只聚合任务提醒，<b>绝不自动发送邮件/WhatsApp</b>。点击任务按钮跳转到对应模块手动生成/发送。</div>';

    root.innerHTML = h;
  }

  // ============================================================
  // Action handlers
  // ============================================================

  function findTask(id) { return getAllTasks().find(function (t) { return t.id === id; }); }

  window.cdDtMarkSent = function (taskId) {
    var t = findTask(taskId);
    if (!t) return;
    // pick suggested account
    var q = getQuota();
    var avail = q.perAccount.filter(function (a) { return !a.full; });
    var accountId = avail.length ? avail[0].id : (S.emailAccounts && S.emailAccounts[0] ? S.emailAccounts[0].id : null);
    // create a send record (manual send recorded)
    var c = window.cdUtilFindCustomer(t.customerId);
    var acc = (S.emailAccounts || []).find(function (a) { return a.id === accountId; });
    var email = '';
    try { if (typeof getCustomerPrimaryEmail === 'function') email = getCustomerPrimaryEmail(c); } catch (e) {}
    if (!email && c) email = c.email || '';
    var record = {
      id: 'rec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      customerId: t.customerId,
      customerName: t.customerName,
      email: email,
      emailAccountId: accountId,
      emailAccountAddress: acc ? acc.email : '',
      sentAt: new Date().toISOString(),
      subject: t.subject || '',
      category: t.productCategory || '',
      status: 'sent',
      openStatus: 'unknown',
      clickStatus: 'none',
      followUpStatus: 'pending',
      emailType: t.emailType || 'first-outreach',
      postSendStatus: 'pending-reply'
    };
    if (!S.sendRecords) S.sendRecords = [];
    S.sendRecords.unshift(record);
    // bump account counter
    if (acc) { acc.dailySentCount = (acc.dailySentCount || 0) + 1; acc.dailySentDate = (window.cdUtilTodayStr && window.cdUtilTodayStr()) || ''; acc.totalSent = (acc.totalSent || 0) + 1; acc.lastSentAt = record.sentAt; }
    logTask(taskId, 'sent', { accountId: accountId, sendRecordId: record.id });
    try { if (typeof addTimelineEvent === 'function') addTimelineEvent(t.customerId, 'email', '任务标记已发送', '通过 ' + (acc ? acc.email : '') + ' 发送', { taskId: taskId }); } catch (e) {}
    persist();
    toast('✅ 已标记发送，配额已扣减');
    renderView();
  };

  window.cdDtSkip = function (taskId, reason) {
    if (!reason) reason = prompt('跳过原因（可选）：') || '手动跳过';
    logTask(taskId, 'skipped', { reason: reason });
    toast('已跳过该任务');
    renderView();
  };

  window.cdDtAddNote = function (taskId) {
    var note = prompt('添加备注：');
    if (!note) return;
    logTask(taskId, 'noted', { note: note });
    toast('备注已保存');
    renderView();
  };

  window.cdDtBatchSent = function () {
    var ids = Object.keys(window._cdDt.selected).filter(function (k) { return window._cdDt.selected[k]; });
    if (!ids.length) { toast('请先勾选任务', 'err'); return; }
    if (!confirm('将勾选的 ' + ids.length + ' 个任务标记为已发送？（按可用邮箱顺序分配）')) return;
    ids.forEach(function (id) { window.cdDtMarkSent(id); });
    window._cdDt.selected = {};
  };

  window.cdDtBatchSkip = function () {
    var ids = Object.keys(window._cdDt.selected).filter(function (k) { return window._cdDt.selected[k]; });
    if (!ids.length) { toast('请先勾选任务', 'err'); return; }
    var reason = prompt('批量跳过原因：') || '批量跳过';
    ids.forEach(function (id) { logTask(id, 'skipped', { reason: reason }); });
    window._cdDt.selected = {};
    persist();
    toast('已批量跳过 ' + ids.length + ' 个任务');
    renderView();
  };

  // Navigation jump helpers
  function jumpTo(taskId, view, params) {
    var t = findTask(taskId);
    if (!t) return;
    if (typeof go === 'function') go(view, params || { customerId: t.customerId });
    toast('已跳转，请在目标模块手动生成/发送（本工作台不自动发信）');
  }
  window.cdDtGoEdit = function (id) { jumpTo(id, 'customerDevEmail'); };
  window.cdDtGoFollowup = function (id) { jumpTo(id, 'customerDevFollowup'); };
  window.cdDtGoReply = function (id) { jumpTo(id, 'customerDevReply'); };
  window.cdDtGoIntel = function (id) { jumpTo(id, 'customerDevIntel'); };
  window.cdDtGoDraft = function (id) { jumpTo(id, 'customerDevEmail'); };
  window.cdDtGoWakeup = function (id) { jumpTo(id, 'customerDevDormant'); };

  // ============================================================
  // Event binding
  // ============================================================

  function bindRoot(root) {
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      var act = t.getAttribute('data-act');
      var id = t.getAttribute('data-id');
      if (act === 'tab') { window._cdDt.tab = t.getAttribute('data-tab'); renderView(); }
      else if (act === 'toggleSort') { window._cdDt.sortByTime = t.checked; renderView(); }
      else if (act === 'toggleGroup') { window._cdDt.groupByCat = t.checked; renderView(); }
      else if (act === 'toggleSel') {
        if (t.checked) window._cdDt.selected[id] = true;
        else delete window._cdDt.selected[id];
      }
      else if (act === 'markSent') window.cdDtMarkSent(id);
      else if (act === 'skip') window.cdDtSkip(id);
      else if (act === 'addNote') window.cdDtAddNote(id);
      else if (act === 'batchSent') window.cdDtBatchSent();
      else if (act === 'batchSkip') window.cdDtBatchSkip();
      else if (act === 'goEdit') window.cdDtGoEdit(id);
      else if (act === 'goFollowup') window.cdDtGoFollowup(id);
      else if (act === 'goReply') window.cdDtGoReply(id);
      else if (act === 'goIntel') window.cdDtGoIntel(id);
      else if (act === 'goDraft') window.cdDtGoDraft(id);
      else if (act === 'goWakeup') window.cdDtGoWakeup(id);
    });
  }

  function boot() {
    var root = document.getElementById('mainContent');
    if (!root) return;
    bindRoot(root);
    renderPage(root);
  }

  // ── renderView interception ───────────────────────────────
  var _cdDtOrigRV = window.renderView;
  window.renderView = function () {
    if (currentView === 'cdDailyTasks') {
      boot();
      return;
    }
    _cdDtOrigRV.apply(this, arguments);
  };

  // ============================================================
  // Styles (cd-dt- prefixed)
  // ============================================================
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-dt-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;}'
    + '.cd-dt-hint{font-size:12px;color:#8a96a8;}'
    + '.cd-dt-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px;}'
    + '.cd-dt-stat-card{background:#fff;border:1px solid #e3e8f0;border-radius:10px;padding:12px;text-align:center;}'
    + '.cd-dt-stat-num{font-size:24px;font-weight:800;}'
    + '.cd-dt-stat-label{font-size:11.5px;color:#8a96a8;margin-top:4px;}'
    + '.cd-dt-quota{background:linear-gradient(135deg,#ebf8ff,#f0fff4);border:1px solid #bee3f8;border-radius:12px;padding:14px;margin-bottom:14px;}'
    + '.cd-dt-quota.over{background:linear-gradient(135deg,#fed7d7,#fff5f5);border-color:#fc8181;}'
    + '.cd-dt-quota-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:14px;}'
    + '.cd-dt-warn{color:#c53030;font-weight:700;font-size:12.5px;}'
    + '.cd-dt-quota-nums{font-size:13px;color:#4a5568;margin-bottom:8px;}'
    + '.cd-dt-quota-used{font-size:22px;font-weight:800;color:#dd6b20;}'
    + '.cd-dt-quota-total{font-size:16px;color:#718096;}'
    + '.cd-dt-quota-bar{height:10px;background:#edf2f7;border-radius:5px;overflow:hidden;margin:6px 0;}'
    + '.cd-dt-quota-bar>span{display:block;height:100%;background:linear-gradient(90deg,#dd6b20,#ed8936);transition:width .3s;}'
    + '.cd-dt-quota-accs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}'
    + '.cd-dt-quota-cat{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center;}'
    + '.cd-dt-chip{display:inline-block;font-size:11.5px;background:#ebf8ff;color:#2b6cb0;padding:2px 9px;border-radius:10px;}'
    + '.cd-dt-chip.full{background:#fed7d7;color:#c53030;}'
    + '.cd-dt-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}'
    + '.cd-dt-tab{padding:6px 14px;border:1px solid #e2e8f0;border-radius:16px;cursor:pointer;font-size:12.5px;background:#fff;color:#4a5568;}'
    + '.cd-dt-tab.on{background:#3182ce;color:#fff;border-color:#3182ce;font-weight:600;}'
    + '.cd-dt-tab-n{font-size:11px;background:#edf2f7;border-radius:8px;padding:1px 7px;margin-left:4px;}'
    + '.cd-dt-tab.on .cd-dt-tab-n{background:rgba(255,255,255,.25);color:#fff;}'
    + '.cd-dt-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;padding:8px 12px;background:#f7fafc;border-radius:8px;}'
    + '.cd-dt-list{display:flex;flex-direction:column;gap:10px;margin-bottom:16px;}'
    + '.cd-dt-group{margin-bottom:14px;}'
    + '.cd-dt-group-title{font-size:13px;font-weight:700;color:#2d3748;margin-bottom:8px;padding-left:4px;}'
    + '.cd-dt-task{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start;}'
    + '.cd-dt-task.done{opacity:.55;border-style:dashed;}'
    + '.cd-dt-task.skipped{opacity:.45;border-style:dashed;}'
    + '.cd-dt-check{margin-top:4px;}'
    + '.cd-dt-task-main{flex:1;min-width:0;}'
    + '.cd-dt-task-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13.5px;}'
    + '.cd-dt-task-detail{font-size:12.5px;color:#4a5568;margin-top:5px;line-height:1.6;}'
    + '.cd-dt-time{color:#2b6cb0;}'
    + '.cd-dt-note{font-size:12px;color:#975a16;background:#fffbeb;padding:4px 8px;border-radius:4px;margin-top:5px;display:inline-block;}'
    + '.cd-dt-task-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;flex-shrink:0;}'
    + '.cd-dt-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}'
    + '.cd-dt-pri{display:inline-block;padding:1px 7px;border-radius:4px;font-size:10.5px;font-weight:700;}'
    + '.cd-dt-pri-high{background:#fed7d7;color:#c53030;}'
    + '.cd-dt-pri-mid{background:#feebc8;color:#c05621;}'
    + '.cd-dt-pri-low{background:#e2e8f0;color:#718096;}'
    + '.cd-dt-btn{padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid #e2e8f0;background:#fff;color:#4a5568;}'
    + '.cd-dt-btn:hover{background:#f7fafc;}'
    + '.cd-dt-btn-success{background:#38a169;color:#fff;border-color:#38a169;}'
    + '.cd-dt-btn-success:hover{background:#2f855a;}'
    + '.cd-dt-done-head{font-size:13px;font-weight:700;color:#38a169;margin:14px 0 8px;}'
    + '.cd-dt-empty{text-align:center;padding:30px;color:#8a96a8;font-size:13.5px;}'
    + '.cd-dt-suggest{background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:10px 14px;font-size:13px;color:#22543d;margin-bottom:14px;}'
    + '.cd-dt-suggest-warn{background:#fffbeb;border-color:#f6e05e;color:#975a16;}'
    + '.cd-dt-footer{font-size:12px;color:#8a96a8;text-align:center;padding:12px;}'
    + '@media (max-width:900px){.cd-dt-task{flex-direction:column;}.cd-dt-task-actions{justify-content:flex-start;}}'
    ;
  document.head.appendChild(style);
})();
