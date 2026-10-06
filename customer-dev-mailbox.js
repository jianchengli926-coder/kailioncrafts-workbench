/* ============================================================
 * Customer Development — Mailbox Health & Warmup (customer-dev-mailbox.js)
 * ----------------------------------------------------------------
 * Phase 5 — Feature 5.2 : Enhanced email-account management.
 *
 * Responsibilities:
 *   1. Email-account cards (3 accounts): today count X/5, status
 *      (normal / warning / cooldown), health score, total sent /
 *      replies / reply rate.
 *   2. Health detail per account: reply rate, bounce rate, complaint
 *      rate, consecutive send days, last-sent time, warmup status.
 *   3. CRUD for accounts, manual daily-count reset, manual bounce /
 *      complaint logging, jump to filtered send-history.
 *   4. 4-week warmup plan panel (week1: 2/day, week2: 3/day,
 *      week3: 4/day, week4: 5/day) with current phase progress.
 *   5. Send-strategy advice (interval ≥30 min, avoid late night,
 *      content diversity).
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Manual send only.
 *   - No external libraries.
 *   - All custom CSS uses the cd- (and cd-mb-) prefix.
 *   - Comments in English. UI text in Chinese.
 *   - Does NOT modify app.js / server.js / index.html.
 * ============================================================ */
(function () {
  'use strict';

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'cdMailbox',
    icon: '📮',
    label: '邮箱管理',
    title: '邮箱管理 · 健康度 / 预热计划 / 发送策略',
    crumb: '3邮箱健康度评分 · 退信投诉记录 · 4周预热计划'
  });

  // ── Ephemeral UI state ─────────────────────────────────────
  if (!window._cdMb) window._cdMb = { editId: '', expandedId: '' };

  // Warmup plan: phase -> daily target + label
  var WARMUP_PLAN = [
    { phase: 0, label: '已预热（成熟邮箱）', dailyTarget: 5, desc: '可按常规节奏每日 5 封发送' },
    { phase: 1, label: '第 1 周 · 预热起步', dailyTarget: 2, desc: '每日 2 封，建立信誉，避免触发风控' },
    { phase: 2, label: '第 2 周 · 缓慢加量', dailyTarget: 3, desc: '每日 3 封，观察退信与投诉' },
    { phase: 3, label: '第 3 周 · 接近常规', dailyTarget: 4, desc: '每日 4 封，继续监控健康度' },
    { phase: 4, label: '第 4 周 · 完成预热', dailyTarget: 5, desc: '每日 5 封，可转入成熟节奏' }
  ];

  // ============================================================
  // Data helpers
  // ============================================================

  // Ensure extended fields exist on an account object.
  function enhanceAccount(a) {
    a.status = a.status || 'normal';
    a.warmupPhase = (a.warmupPhase == null) ? 0 : a.warmupPhase;
    a.totalReplies = a.totalReplies || 0;
    a.bounceCount = a.bounceCount || 0;
    a.complaintCount = a.complaintCount || 0;
    a.consecutiveSendDays = a.consecutiveSendDays || 0;
    a.notes = a.notes || '';
    if (a.healthScore == null) a.healthScore = 100;
    return a;
  }

  // Compute health score 0-100 for an account based on stats.
  // Factors: bounce rate, complaint rate, reply rate, daily-limit pressure.
  function computeHealth(a) {
    enhanceAccount(a);
    var total = a.totalSent || 0;
    var score = 100;
    // bounce penalty: 1 bounce -> -10 points, cap -40
    var bounceRate = total ? a.bounceCount / total : 0;
    score -= Math.min(40, a.bounceCount * 10 + Math.round(bounceRate * 100));
    // complaint penalty: 1 complaint -> -20 points, cap -50
    score -= Math.min(50, a.complaintCount * 20);
    // low reply rate penalty (only when there is enough data)
    if (total >= 10) {
      var replyRate = a.totalReplies / total;
      if (replyRate < 0.05) score -= 15;
      else if (replyRate < 0.1) score -= 8;
      else if (replyRate > 0.25) score += 5; // bonus
    }
    // over-limit today penalty
    var today = (window.cdUtilTodayStr && window.cdUtilTodayStr()) || '';
    if (a.dailySentDate === today && (a.dailySentCount || 0) > (a.dailyLimit || 5)) score -= 10;
    score = Math.max(0, Math.min(100, score));
    a.healthScore = score;
    // derive status
    if (score < 50 || a.complaintCount > 0) a.status = 'cooldown';
    else if (score < 75 || bounceRate > 0.05) a.status = 'warning';
    else a.status = 'normal';
    return a;
  }

  // Get all accounts with extended fields + computed health.
  function getAccounts() {
    return (S.emailAccounts || []).map(function (a) {
      enhanceAccount(a);
      return computeHealth(a);
    });
  }

  // Count replies for an account from sendRecords (postSendStatus replied/ordered).
  function refreshReplyCount(acc) {
    var recs = (S.sendRecords || []).filter(function (r) {
      return r.emailAccountId === acc.id || r.emailAccountAddress === acc.email;
    });
    acc.totalSent = recs.length;
    acc.totalReplies = recs.filter(function (r) {
      return r.postSendStatus === 'replied' || r.postSendStatus === 'ordered' || r.status === 'replied' || r.status === 'ordered';
    }).length;
    if (recs.length) {
      recs.sort(function (a, b) { return (b.sentAt || '').localeCompare(a.sentAt || ''); });
      acc.lastSentAt = recs[0].sentAt || acc.lastSentAt;
    }
    return acc;
  }

  // ============================================================
  // Rendering
  // ============================================================

  function statusBadge(a) {
    var map = {
      normal:   { label: '正常', color: '#38a169' },
      warning:  { label: '警告', color: '#dd6b20' },
      cooldown: { label: '冷却', color: '#c53030' }
    };
    var m = map[a.status] || map.normal;
    return '<span class="cd-mb-tag" style="background:' + m.color + '22;color:' + m.color + '">● ' + m.label + '</span>';
  }

  function scoreColor(s) {
    if (s >= 80) return '#38a169';
    if (s >= 60) return '#d69e2e';
    return '#c53030';
  }

  function renderAccountCard(a) {
    var today = (window.cdUtilTodayStr && window.cdUtilTodayStr()) || '';
    var usedToday = (a.dailySentDate === today) ? (a.dailySentCount || 0) : 0;
    var limit = a.dailyLimit || 5;
    var full = usedToday >= limit;
    var replyRate = a.totalSent ? Math.round(a.totalReplies / a.totalSent * 100) : 0;
    var bounceRate = a.totalSent ? (a.bounceCount / a.totalSent * 100).toFixed(1) : '0.0';
    var complaintRate = a.totalSent ? (a.complaintCount / a.totalSent * 100).toFixed(1) : '0.0';
    var warmup = WARMUP_PLAN[a.warmupPhase] || WARMUP_PLAN[0];
    var expanded = window._cdMb.expandedId === a.id;

    var h = '<div class="cd-mb-card' + (expanded ? ' expanded' : '') + '">';
    h += '<div class="cd-mb-card-head" data-act="toggle" data-id="' + a.id + '">';
    h += '<div class="cd-mb-card-head-main">'
      + '<div class="cd-mb-card-name">📧 ' + window.cdUtilEsc(a.displayName || a.email) + '</div>'
      + '<div class="cd-mb-card-mail">' + window.cdUtilEsc(a.email) + '</div>'
      + '<div class="cd-mb-card-badges">' + statusBadge(a)
      + '<span class="cd-mb-tag" style="background:#ebf8ff;color:#2b6cb0">🔥 预热P' + a.warmupPhase + '</span>'
      + '</div>'
      + '</div>';
    h += '<div class="cd-mb-card-head-side">'
      + '<div class="cd-mb-score" style="color:' + scoreColor(a.healthScore) + '">' + a.healthScore + '<small>分</small></div>'
      + '<div class="cd-mb-count' + (full ? ' full' : '') + '">' + usedToday + '/' + limit + '</div>'
      + '<div class="cd-mb-hint">今日已发</div>'
      + '</div>';
    h += '</div>';

    // compact stats row
    h += '<div class="cd-mb-mini-stats">'
      + '<div><b>' + a.totalSent + '</b><span>总发送</span></div>'
      + '<div><b>' + a.totalReplies + '</b><span>总回复</span></div>'
      + '<div><b>' + replyRate + '%</b><span>回复率</span></div>'
      + '<div><b>' + a.consecutiveSendDays + '</b><span>连续天数</span></div>'
      + '</div>';

    // expanded detail
    if (expanded) {
      h += '<div class="cd-mb-detail">';
      h += '<div class="cd-mb-detail-grid">'
        + '<div><span class="cd-mb-dlabel">退信数</span><span class="cd-mb-dval" style="color:#c53030">' + a.bounceCount + ' (' + bounceRate + '%)</span></div>'
        + '<div><span class="cd-mb-dlabel">投诉数</span><span class="cd-mb-dval" style="color:#c53030">' + a.complaintCount + ' (' + complaintRate + '%)</span></div>'
        + '<div><span class="cd-mb-dlabel">最近发送</span><span class="cd-mb-dval">' + window.cdUtilEsc(window.cdUtilFormatDate(a.lastSentAt)) + '</span></div>'
        + '<div><span class="cd-mb-dlabel">SMTP</span><span class="cd-mb-dval">' + window.cdUtilEsc(a.smtpServer || '—') + ':' + window.cdUtilEsc(a.smtpPort || '') + '</span></div>'
        + '</div>';
      // warmup progress
      h += '<div class="cd-mb-warmup">'
        + '<div class="cd-mb-warmup-title">🔥 ' + warmup.label + ' · 目标 ' + warmup.dailyTarget + ' 封/天</div>'
        + '<div class="cd-mb-hint">' + warmup.desc + '</div>'
        + '<div class="cd-mb-warmup-bar"><span style="width:' + Math.min(100, Math.round(usedToday / warmup.dailyTarget * 100)) + '%"></span></div>'
        + '<div class="cd-mb-hint">今日进度：' + usedToday + ' / ' + warmup.dailyTarget + ' 封</div>'
        + '</div>';
      // actions
      h += '<div class="cd-mb-actions">'
        + '<button class="cd-mb-btn" data-act="edit" data-id="' + a.id + '">✏️ 编辑</button>'
        + '<button class="cd-mb-btn" data-act="resetCount" data-id="' + a.id + '">♻️ 重置今日计数</button>'
        + '<button class="cd-mb-btn cd-mb-btn-warn" data-act="bounce" data-id="' + a.id + '">📉 记录退信</button>'
        + '<button class="cd-mb-btn cd-mb-btn-danger" data-act="complaint" data-id="' + a.id + '">🚫 记录投诉</button>'
        + '<button class="cd-mb-btn" data-act="history" data-id="' + a.id + '">📜 查看发送历史</button>'
        + '<button class="cd-mb-btn cd-mb-btn-danger" data-act="del" data-id="' + a.id + '">🗑 删除</button>'
        + '</div>';
      // warmup phase switcher
      h += '<div class="cd-mb-warmup-switch"><span class="cd-mb-dlabel">设置预热阶段：</span>';
      WARMUP_PLAN.forEach(function (w) {
        h += '<button class="cd-mb-chip' + (a.warmupPhase === w.phase ? ' on' : '') + '" data-act="setWarmup" data-id="' + a.id + '" data-phase="' + w.phase + '">P' + w.phase + '</button>';
      });
      h += '</div>';
      if (a.notes) h += '<div class="cd-mb-notes">📝 ' + window.cdUtilEsc(a.notes) + '</div>';
      h += '</div>';
    }

    h += '</div>';
    return h;
  }

  function renderForm(accounts) {
    var editId = window._cdMb.editId;
    var a = editId ? accounts.find(function (x) { return x.id === editId; }) : null;
    if (!window._cdMb.showForm) return '';
    var h = '<div class="cd-mb-form-card"><div class="cd-mb-form-title">' + (a ? '编辑邮箱账户' : '添加邮箱账户') + '</div>'
      + '<div class="cd-mb-form-grid">'
      + '<div><label class="cd-mb-dlabel">显示名称</label><input class="cd-mb-input" id="cdMbF_displayName" value="' + window.cdUtilEsc(a ? a.displayName : '') + '" placeholder="如: Leo - KaiLion"></div>'
      + '<div><label class="cd-mb-dlabel">邮箱地址</label><input class="cd-mb-input" id="cdMbF_email" value="' + window.cdUtilEsc(a ? a.email : '') + '" placeholder="sales@kailioncrafts.com"></div>'
      + '<div><label class="cd-mb-dlabel">SMTP服务器</label><input class="cd-mb-input" id="cdMbF_smtpServer" value="' + window.cdUtilEsc(a ? a.smtpServer : '') + '" placeholder="smtp.exmail.qq.com"></div>'
      + '<div><label class="cd-mb-dlabel">端口</label><input class="cd-mb-input" id="cdMbF_smtpPort" value="' + window.cdUtilEsc(a ? a.smtpPort : '465') + '"></div>'
      + '<div><label class="cd-mb-dlabel">授权码/密码</label><input class="cd-mb-input" type="password" id="cdMbF_password" value="' + window.cdUtilEsc(a ? a.password : '') + '"></div>'
      + '<div><label class="cd-mb-dlabel">每日上限</label><input class="cd-mb-input" type="number" id="cdMbF_dailyLimit" value="' + (a ? (a.dailyLimit || 5) : 5) + '" min="1" max="10"></div>'
      + '<div><label class="cd-mb-dlabel">备注</label><input class="cd-mb-input" id="cdMbF_notes" value="' + window.cdUtilEsc(a ? a.notes : '') + '" placeholder="邮箱用途/说明"></div>'
      + '</div>'
      + '<div class="cd-mb-form-actions">'
      + '<button class="cd-mb-btn cd-mb-btn-primary" data-act="save">💾 保存</button>'
      + '<button class="cd-mb-btn" data-act="cancelForm">取消</button>'
      + '</div></div>';
    return h;
  }

  function renderAdvice() {
    var h = '<div class="cd-mb-advice"><div class="cd-mb-advice-title">💡 发送策略建议</div><ul>'
      + '<li>⏱ 同一邮箱两次发送间隔 ≥ 30 分钟，避免被判定为群发。</li>'
      + '<li>🌍 发送时间按客户当地工作时段（北京时间 20:00–23:00 对应欧美上午），避开凌晨深夜。</li>'
      + '<li>🎨 每封邮件主题与正文保持差异，避免连续发送相同模板导致被标记垃圾邮件。</li>'
      + '<li>📉 退信率 > 5% 或出现投诉时，立即进入冷却（暂停 3–7 天）并检查客户邮箱有效性。</li>'
      + '<li>🔥 新邮箱必须按 4 周预热计划逐步加量（2→3→4→5 封/天），不要一开始就满额发送。</li>'
      + '<li>🔄 3 个邮箱轮换使用，均匀分担发送量，降低单账号风控风险。</li>'
      + '</ul></div>';
    return h;
  }

  function renderPage(root) {
    // refresh reply counts from sendRecords before rendering
    (S.emailAccounts || []).forEach(function (a) { refreshReplyCount(a); });
    var accounts = getAccounts();

    var h = '<div class="cd-mb-header">'
      + '<div><h2 style="margin:0">📮 邮箱管理</h2>'
      + '<div class="cd-mb-hint" style="margin-top:4px">健康度评分 · 4周预热计划 · 退信/投诉记录 · 手动发送，工作台不自动发信</div></div>'
      + '<button class="cd-mb-btn cd-mb-btn-primary" data-act="add"' + (accounts.length >= 3 ? ' disabled' : '') + '>＋ 添加邮箱</button>'
      + '</div>';

    if (!accounts.length) {
      h += '<div class="cd-mb-empty">📭 尚未配置邮箱账户。点击右上角「添加邮箱」开始（最多 3 个）。</div>';
    } else {
      accounts.forEach(function (a) { h += renderAccountCard(a); });
    }

    h += renderForm(accounts);
    h += renderAdvice();
    h += '<div class="cd-mb-footer">🔒 本模块只管理邮箱配置与健康度，<b>绝不自动发送邮件</b>。SMTP 密码仅本地保存，不会用于自动发信。</div>';

    root.innerHTML = h;
  }

  // ============================================================
  // Action handlers
  // ============================================================

  function findAcc(id) { return (S.emailAccounts || []).find(function (a) { return a.id === id; }); }

  window.cdMbSave = function () {
    var displayName = document.getElementById('cdMbF_displayName').value.trim();
    var email = document.getElementById('cdMbF_email').value.trim();
    var smtpServer = document.getElementById('cdMbF_smtpServer').value.trim();
    var smtpPort = document.getElementById('cdMbF_smtpPort').value.trim();
    var password = document.getElementById('cdMbF_password').value;
    var dailyLimit = parseInt(document.getElementById('cdMbF_dailyLimit').value, 10) || 5;
    var notes = document.getElementById('cdMbF_notes').value.trim();
    if (!email || email.indexOf('@') < 0) { toast('请输入有效邮箱地址', 'err'); return; }
    if (!S.emailAccounts) S.emailAccounts = [];
    var editId = window._cdMb.editId;
    if (editId) {
      var acc = findAcc(editId);
      if (acc) Object.assign(acc, { displayName, email, smtpServer, smtpPort, password, dailyLimit, notes });
    } else {
      if (S.emailAccounts.length >= 3) { toast('最多配置 3 个邮箱', 'err'); return; }
      S.emailAccounts.push({
        id: 'acc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        displayName: displayName || email,
        email: email, smtpServer: smtpServer, smtpPort: smtpPort, password: password,
        dailyLimit: Math.min(dailyLimit, 10),
        dailySentCount: 0, dailySentDate: (window.cdUtilTodayStr && window.cdUtilTodayStr()) || '',
        totalSent: 0, totalReplies: 0, bounceCount: 0, complaintCount: 0,
        consecutiveSendDays: 0, warmupPhase: 1, status: 'normal',
        notes: notes, healthScore: 100,
        createdAt: new Date().toISOString()
      });
    }
    window._cdMb.showForm = false; window._cdMb.editId = '';
    persist();
    toast('✅ 邮箱已保存');
    renderView();
  };

  window.cdMbDelete = function (id) {
    if (!confirm('确定删除该邮箱账户？发送历史记录将保留，但该账户将不再用于新任务分配。')) return;
    S.emailAccounts = (S.emailAccounts || []).filter(function (a) { return a.id !== id; });
    persist();
    toast('已删除邮箱');
    renderView();
  };

  window.cdMbResetCount = function (id) {
    var acc = findAcc(id);
    if (!acc) return;
    acc.dailySentCount = 0;
    acc.dailySentDate = (window.cdUtilTodayStr && window.cdUtilTodayStr()) || '';
    persist();
    toast('今日计数已重置');
    renderView();
  };

  window.cdMbRecordBounce = function (id) {
    var acc = findAcc(id);
    if (!acc) return;
    acc.bounceCount = (acc.bounceCount || 0) + 1;
    persist();
    toast('已记录 1 次退信，健康度已重算');
    renderView();
  };

  window.cdMbRecordComplaint = function (id) {
    var acc = findAcc(id);
    if (!acc) return;
    if (!confirm('记录投诉会将邮箱状态切换为「冷却」，确定？')) return;
    acc.complaintCount = (acc.complaintCount || 0) + 1;
    acc.status = 'cooldown';
    persist();
    toast('已记录投诉，邮箱进入冷却状态');
    renderView();
  };

  window.cdMbSetWarmup = function (id, phase) {
    var acc = findAcc(id);
    if (!acc) return;
    acc.warmupPhase = parseInt(phase, 10) || 0;
    persist();
    toast('预热阶段已设置为 P' + acc.warmupPhase);
    renderView();
  };

  window.cdMbGoHistory = function (id) {
    var acc = findAcc(id);
    if (acc && window._cdHist) {
      window._cdHist.acc = acc.id;
      window._cdHist.dateRange = 'all';
    }
    if (typeof go === 'function') go('cdSendHistory');
  };

  // ============================================================
  // Event binding
  // ============================================================

  function bindRoot(root) {
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      var act = t.getAttribute('data-act');
      var id = t.getAttribute('data-id');
      if (act === 'toggle') {
        window._cdMb.expandedId = (window._cdMb.expandedId === id) ? '' : id;
        renderView();
      } else if (act === 'add') {
        window._cdMb.showForm = true; window._cdMb.editId = '';
        renderView();
      } else if (act === 'edit') {
        window._cdMb.showForm = true; window._cdMb.editId = id;
        renderView();
      } else if (act === 'cancelForm') {
        window._cdMb.showForm = false; window._cdMb.editId = '';
        renderView();
      } else if (act === 'save') window.cdMbSave();
      else if (act === 'del') window.cdMbDelete(id);
      else if (act === 'resetCount') window.cdMbResetCount(id);
      else if (act === 'bounce') window.cdMbRecordBounce(id);
      else if (act === 'complaint') window.cdMbRecordComplaint(id);
      else if (act === 'setWarmup') window.cdMbSetWarmup(id, t.getAttribute('data-phase'));
      else if (act === 'history') window.cdMbGoHistory(id);
    });
  }

  function boot() {
    var root = document.getElementById('mainContent');
    if (!root) return;
    bindRoot(root);
    renderPage(root);
  }

  // ── renderView interception ───────────────────────────────
  var _cdMbOrigRV = window.renderView;
  window.renderView = function () {
    if (currentView === 'cdMailbox') {
      boot();
      return;
    }
    _cdMbOrigRV.apply(this, arguments);
  };

  // ============================================================
  // Styles (cd-mb- prefixed)
  // ============================================================
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-mb-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;}'
    + '.cd-mb-hint{font-size:12px;color:#8a96a8;}'
    + '.cd-mb-card{background:#fff;border:1px solid #e3e8f0;border-radius:12px;padding:14px 16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(20,41,74,.04);}'
    + '.cd-mb-card.expanded{border-color:#3182ce;box-shadow:0 2px 8px rgba(49,130,206,.12);}'
    + '.cd-mb-card-head{display:flex;justify-content:space-between;align-items:flex-start;cursor:pointer;gap:12px;}'
    + '.cd-mb-card-name{font-size:15px;font-weight:700;color:#1a202c;}'
    + '.cd-mb-card-mail{font-size:12.5px;color:#4a5568;margin-top:2px;}'
    + '.cd-mb-card-badges{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;}'
    + '.cd-mb-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}'
    + '.cd-mb-card-head-side{text-align:right;}'
    + '.cd-mb-score{font-size:24px;font-weight:800;}'
    + '.cd-mb-score small{font-size:12px;font-weight:600;color:#8a96a8;margin-left:2px;}'
    + '.cd-mb-count{font-size:18px;font-weight:700;color:#2c5282;margin-top:2px;}'
    + '.cd-mb-count.full{color:#c53030;}'
    + '.cd-mb-mini-stats{display:flex;gap:18px;margin-top:12px;padding-top:12px;border-top:1px dashed #e2e8f0;flex-wrap:wrap;}'
    + '.cd-mb-mini-stats>div{display:flex;flex-direction:column;}'
    + '.cd-mb-mini-stats b{font-size:16px;color:#1a202c;}'
    + '.cd-mb-mini-stats span{font-size:11px;color:#8a96a8;}'
    + '.cd-mb-detail{margin-top:14px;padding-top:14px;border-top:1px solid #e2e8f0;}'
    + '.cd-mb-detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px;}'
    + '.cd-mb-dlabel{font-size:11px;color:#8a96a8;display:block;}'
    + '.cd-mb-dval{font-size:13px;color:#2d3748;font-weight:600;}'
    + '.cd-mb-warmup{background:linear-gradient(135deg,#fffbeb,#fefcbf22);border:1px solid #f6e05e;border-radius:8px;padding:10px 12px;margin-bottom:12px;}'
    + '.cd-mb-warmup-title{font-size:13px;font-weight:700;color:#975a16;margin-bottom:4px;}'
    + '.cd-mb-warmup-bar{height:8px;background:#edf2f7;border-radius:4px;overflow:hidden;margin:8px 0;}'
    + '.cd-mb-warmup-bar>span{display:block;height:100%;background:linear-gradient(90deg,#d69e2e,#ed8936);}'
    + '.cd-mb-actions{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;}'
    + '.cd-mb-warmup-switch{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;}'
    + '.cd-mb-chip{padding:3px 10px;border-radius:12px;border:1px solid #e2e8f0;background:#fff;font-size:12px;cursor:pointer;}'
    + '.cd-mb-chip.on{background:#3182ce;color:#fff;border-color:#3182ce;}'
    + '.cd-mb-notes{font-size:12px;color:#4a5568;background:#f7fafc;padding:8px 10px;border-radius:6px;}'
    + '.cd-mb-btn{padding:6px 12px;border-radius:6px;font-size:12.5px;cursor:pointer;border:1px solid #e2e8f0;background:#fff;color:#4a5568;transition:all .15s;}'
    + '.cd-mb-btn:hover{background:#f7fafc;}'
    + '.cd-mb-btn-primary{background:#1a365d;color:#fff;border-color:#1a365d;}'
    + '.cd-mb-btn-primary:hover{background:#14294a;}'
    + '.cd-mb-btn-warn{color:#dd6b20;border-color:#fbd38d;}'
    + '.cd-mb-btn-danger{color:#c53030;border-color:#feb2b2;}'
    + '.cd-mb-btn:disabled{opacity:.5;cursor:not-allowed;}'
    + '.cd-mb-form-card{background:#fffbeb;border:1px solid #f6e05e;border-radius:12px;padding:14px 16px;margin-bottom:14px;}'
    + '.cd-mb-form-title{font-size:14px;font-weight:700;margin-bottom:10px;color:#975a16;}'
    + '.cd-mb-form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:12px;}'
    + '.cd-mb-input{width:100%;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;box-sizing:border-box;}'
    + '.cd-mb-input:focus{border-color:#1a365d;outline:none;}'
    + '.cd-mb-form-actions{display:flex;gap:8px;}'
    + '.cd-mb-advice{background:#ebf8ff;border:1px solid #bee3f8;border-radius:12px;padding:14px 16px;margin-bottom:14px;}'
    + '.cd-mb-advice-title{font-weight:700;color:#2c5282;margin-bottom:8px;font-size:14px;}'
    + '.cd-mb-advice ul{margin:0;padding-left:20px;font-size:12.5px;line-height:1.9;color:#2d3748;}'
    + '.cd-mb-empty{text-align:center;padding:40px;color:#8a96a8;font-size:14px;}'
    + '.cd-mb-footer{font-size:12px;color:#8a96a8;text-align:center;padding:12px;}'
    ;
  document.head.appendChild(style);
})();
