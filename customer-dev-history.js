/* ============================================================
 * Customer Development — Send History Box (customer-dev-history.js)
 * ----------------------------------------------------------------
 * Phase 5 — Feature 5.1 : Enhanced send-history workspace.
 *
 * Responsibilities:
 *   1. Top stats panel (total / today / week / month / reply rate /
 *      distribution by category, account, email-type).
 *   2. Multi-filter bar (date range, category, account, type, country,
 *      customer level, post-send status, keyword).
 *   3. History table with row actions.
 *   4. Bilingual full-email viewer modal (EN / ZH).
 *   5. One-click copy, re-edit jump, mark status, jump to customer,
 *      delete (with confirm), CSV export.
 *
 * Also defines the shared cdUtil* helpers on window so that other
 * Phase-5 modules (mailbox, daily-tasks, analytics, kanban, calendar)
 * can reuse them.
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Manual send only.
 *   - No external libraries. Charts are pure CSS/HTML.
 *   - All custom CSS uses the cd- (and cd-hist-) prefix.
 *   - Comments in English. UI text in Chinese.
 *   - Does NOT modify app.js / server.js / index.html.
 * ============================================================ */
(function () {
  'use strict';

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'cdSendHistory',
    icon: '📜',
    label: '发送历史箱',
    title: '发送历史箱 · 统计 / 筛选 / 全文 / 导出',
    crumb: '全量发送记录 · 多条件筛选 · 双语全文查看 · CSV导出'
  });

  // ── Ephemeral UI state ─────────────────────────────────────
  if (!window._cdHist) window._cdHist = {
    dateRange: 'all',     // today | week | month | all | custom
    cat: '', acc: '', type: '', country: '', level: '', status: '', kw: '',
    customFrom: '', customTo: ''
  };

  // ============================================================
  // Shared utilities (defined once, exposed on window)
  // ============================================================

  // Today as YYYY-MM-DD (local time)
  window.cdUtilTodayStr = function () {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  };

  // ISO timestamp -> readable "YYYY-MM-DD HH:MM"
  window.cdUtilFormatDate = function (iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  // Whole days between two YYYY-MM-DD strings (a - b)
  window.cdUtilDaysBetween = function (a, b) {
    var da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
    return Math.round((da - db) / 86400000);
  };

  // Find a customer object by id
  window.cdUtilFindCustomer = function (id) {
    if (!id) return null;
    return (S.customers || []).find(function (x) { return x.id === id; }) || null;
  };

  // Display name for a customer (company preferred)
  window.cdUtilCustName = function (c) {
    if (!c) return '';
    return c.company || (c.contact && c.contact.name) || c.name || '(未命名)';
  };

  // HTML escape (alias of global esc, but safe if esc missing)
  window.cdUtilEsc = function (s) {
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  // Email type key -> Chinese label
  window.cdUtilEmailTypeLabel = function (type) {
    var map = {
      'first-outreach': '首次开发信',
      'day3-followup': 'Day3 跟进',
      'day7-followup': 'Day7 跟进',
      'day14-followup': 'Day14 跟进',
      'day21-followup': 'Day21 跟进',
      'day30-followup': 'Day30 跟进',
      'customer-reply': '客户回复',
      'dormant-wakeup': '沉睡唤醒',
      'other': '其他'
    };
    return map[type] || type || '其他';
  };

  // Customer-development stage key -> Chinese label
  window.cdUtilStageLabel = function (stage) {
    var map = {
      'new-lead': '🆕 新线索',
      'intel-done': '🔍 已背调',
      'draft-ready': '✍️ 待开发',
      'first-sent': '📤 已开发',
      'following': '🔄 跟进中',
      'replied': '💬 已回复',
      'negotiating': '💰 议价中',
      'quoted': '📦 已报价',
      'sampled': '🎁 已寄样',
      'ordered': '✅ 已下单',
      'dormant': '💤 沉睡',
      'rejected': '❌ 已拒绝'
    };
    return map[stage] || stage || '—';
  };

  // Post-send status key -> Chinese label + color
  window.cdUtilPostStatusMeta = function (st) {
    var map = {
      'pending-reply': { label: '待回复', color: '#d69e2e' },
      'replied':       { label: '已回复', color: '#3182ce' },
      'ordered':       { label: '已下单', color: '#38a169' },
      'rejected':      { label: '已拒绝', color: '#c53030' },
      'dormant':       { label: '沉睡',   color: '#805ad5' }
    };
    return map[st] || { label: st || '待回复', color: '#718096' };
  };

  // Trigger a CSV download from headers + rows
  window.cdUtilExportCSV = function (filename, headers, rows) {
    var BOM = '\uFEFF';
    var lines = [];
    lines.push(headers.map(function (h) { return '"' + String(h).replace(/"/g, '""') + '"'; }).join(','));
    rows.forEach(function (r) {
      lines.push(r.map(function (cell) {
        return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"';
      }).join(','));
    });
    var blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  // ============================================================
  // Data helpers (compat layer for extended send-record fields)
  // ============================================================

  // Merge extended fields onto a raw send record with defaults.
  function enhanceRecord(r) {
    return Object.assign({
      country: '',
      emailType: 'other',
      language: 'en',
      customerLevel: '',
      bodySummary: '',
      bodyFull: '',
      bodyFullZh: '',
      postSendStatus: 'pending-reply',
      notes: '',
      tags: []
    }, r);
  }

  // Pull country/level from linked customer when missing on the record.
  function enrichFromCustomer(r) {
    var c = window.cdUtilFindCustomer(r.customerId);
    if (c) {
      if (!r.country) r.country = c.country || '';
      if (!r.customerLevel) r.customerLevel = c.level || '';
      if (!r.productCategory) r.productCategory = c.productCategory || '';
    }
    return r;
  }

  // All records, sorted newest first, with extended fields + customer data.
  function getAllRecords() {
    return (S.sendRecords || [])
      .slice()
      .sort(function (a, b) { return (b.sentAt || '').localeCompare(a.sentAt || ''); })
      .map(function (r) { return enrichFromCustomer(enhanceRecord(r)); });
  }

  // ============================================================
  // Filtering
  // ============================================================

  function matchDateRange(r) {
    var f = window._cdHist;
    var today = window.cdUtilTodayStr();
    var d = (r.sentAt || '').slice(0, 10);
    if (!d) return false;
    if (f.dateRange === 'today') return d === today;
    if (f.dateRange === 'week') {
      // last 7 days inclusive
      var diff = window.cdUtilDaysBetween(today, d);
      return diff >= 0 && diff < 7;
    }
    if (f.dateRange === 'month') {
      var diffM = window.cdUtilDaysBetween(today, d);
      return diffM >= 0 && diffM < 31;
    }
    if (f.dateRange === 'custom') {
      if (f.customFrom && d < f.customFrom) return false;
      if (f.customTo && d > f.customTo) return false;
      return true;
    }
    return true; // all
  }

  function applyFilter(records) {
    var f = window._cdHist;
    return records.filter(function (r) {
      if (!matchDateRange(r)) return false;
      if (f.cat && r.category !== f.cat) return false;
      if (f.acc && r.emailAccountId !== f.acc && r.emailAccountAddress !== f.acc) return false;
      if (f.type && r.emailType !== f.type) return false;
      if (f.country && (r.country || '').toLowerCase().indexOf(f.country.toLowerCase()) < 0) return false;
      if (f.level && r.customerLevel !== f.level) return false;
      if (f.status && r.postSendStatus !== f.status) return false;
      if (f.kw) {
        var kw = f.kw.toLowerCase();
        var hay = [r.customerName, r.email, r.subject, r.country, r.bodySummary, r.notes]
          .join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  // ============================================================
  // Stats
  // ============================================================

  function computeStats(records) {
    var today = window.cdUtilTodayStr();
    var total = records.length;
    var todayN = 0, weekN = 0, monthN = 0, repliedN = 0;
    var catDist = {}, accDist = {}, typeDist = {};
    records.forEach(function (r) {
      var d = (r.sentAt || '').slice(0, 10);
      if (d === today) todayN++;
      var diff = window.cdUtilDaysBetween(today, d);
      if (diff >= 0 && diff < 7) weekN++;
      if (diff >= 0 && diff < 31) monthN++;
      if (r.postSendStatus === 'replied' || r.postSendStatus === 'ordered') repliedN++;
      catDist[r.category || 'unknown'] = (catDist[r.category || 'unknown'] || 0) + 1;
      var ak = r.emailAccountAddress || r.emailAccountId || 'unknown';
      accDist[ak] = (accDist[ak] || 0) + 1;
      typeDist[r.emailType || 'other'] = (typeDist[r.emailType || 'other'] || 0) + 1;
    });
    return {
      total: total, today: todayN, week: weekN, month: monthN,
      replied: repliedN,
      replyRate: total ? Math.round(repliedN / total * 100) : 0,
      catDist: catDist, accDist: accDist, typeDist: typeDist
    };
  }

  // ============================================================
  // Rendering
  // ============================================================

  function renderStatCards(stats) {
    var cards = [
      { n: stats.total, label: '累计发送', c: '#1a365d' },
      { n: stats.today, label: '今日', c: '#dd6b20' },
      { n: stats.week, label: '近7天', c: '#3182ce' },
      { n: stats.month, label: '近30天', c: '#805ad5' },
      { n: stats.replied, label: '已回复/下单', c: '#38a169' },
      { n: stats.replyRate + '%', label: '回复率', c: '#d69e2e' }
    ];
    var h = '<div class="cd-hist-stat-grid">';
    cards.forEach(function (c) {
      h += '<div class="cd-hist-stat-card"><div class="cd-hist-stat-num" style="color:' + c.c + '">' +
        c.n + '</div><div class="cd-hist-stat-label">' + c.label + '</div></div>';
    });
    h += '</div>';
    return h;
  }

  function renderDistRow(title, dist, labelFn) {
    var keys = Object.keys(dist);
    if (!keys.length) return '';
    var max = Math.max.apply(null, keys.map(function (k) { return dist[k]; }));
    var h = '<div class="cd-hist-dist-block"><div class="cd-hist-dist-title">' + title + '</div>';
    keys.forEach(function (k) {
      var pct = max ? Math.round(dist[k] / max * 100) : 0;
      h += '<div class="cd-hist-dist-row">' +
        '<span class="cd-hist-dist-label">' + window.cdUtilEsc(labelFn(k)) + '</span>' +
        '<span class="cd-hist-dist-bar"><span style="width:' + pct + '%"></span></span>' +
        '<span class="cd-hist-dist-num">' + dist[k] + '</span>' +
        '</div>';
    });
    h += '</div>';
    return h;
  }

  function renderFilters(records) {
    var f = window._cdHist;
    var accounts = S.emailAccounts || [];
    // distinct countries / levels from records
    var countries = {}, levels = {};
    records.forEach(function (r) {
      if (r.country) countries[r.country] = 1;
      if (r.customerLevel) levels[r.customerLevel] = 1;
    });
    var countryOpts = Object.keys(countries).sort();
    var levelOpts = Object.keys(levels).sort();

    var typeKeys = ['first-outreach', 'day3-followup', 'day7-followup', 'day14-followup',
      'day21-followup', 'day30-followup', 'customer-reply', 'dormant-wakeup', 'other'];
    var statusKeys = ['pending-reply', 'replied', 'ordered', 'rejected', 'dormant'];

    function opt(v, label, cur) {
      return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label + '</option>';
    }

    var h = '<div class="cd-hist-filter-bar">';
    h += '<select class="cd-hist-input" data-f="dateRange">' +
      opt('all', '全部时间', f.dateRange) +
      opt('today', '今天', f.dateRange) +
      opt('week', '近7天', f.dateRange) +
      opt('month', '近30天', f.dateRange) +
      opt('custom', '自定义', f.dateRange) +
      '</select>';
    if (f.dateRange === 'custom') {
      h += '<input type="date" class="cd-hist-input" data-f="customFrom" value="' + f.customFrom + '" placeholder="从">' +
           '<input type="date" class="cd-hist-input" data-f="customTo" value="' + f.customTo + '" placeholder="到">';
    }
    h += '<select class="cd-hist-input" data-f="cat"><option value="">全部品类</option>';
    if (typeof P2_CAT_LABELS === 'object') {
      Object.keys(P2_CAT_LABELS).forEach(function (k) { h += opt(k, P2_CAT_LABELS[k], f.cat); });
    }
    h += '</select>';
    h += '<select class="cd-hist-input" data-f="acc"><option value="">全部邮箱</option>';
    accounts.forEach(function (a) { h += opt(a.id, (a.displayName || a.email), f.acc); });
    h += '</select>';
    h += '<select class="cd-hist-input" data-f="type"><option value="">全部类型</option>';
    typeKeys.forEach(function (t) { h += opt(t, window.cdUtilEmailTypeLabel(t), f.type); });
    h += '</select>';
    h += '<select class="cd-hist-input" data-f="country"><option value="">全部国家</option>';
    countryOpts.forEach(function (c) { h += opt(c, c, f.country); });
    h += '</select>';
    h += '<select class="cd-hist-input" data-f="level"><option value="">全部等级</option>';
    levelOpts.forEach(function (l) { h += opt(l, l + '级', f.level); });
    h += '</select>';
    h += '<select class="cd-hist-input" data-f="status"><option value="">全部状态</option>';
    statusKeys.forEach(function (s) {
      var m = window.cdUtilPostStatusMeta(s);
      h += opt(s, m.label, f.status);
    });
    h += '</select>';
    h += '<input class="cd-hist-input" data-f="kw" placeholder="关键词(客户/主题/备注)" value="' + window.cdUtilEsc(f.kw) + '">';
    h += '<button class="cd-hist-btn cd-hist-btn-ghost" data-act="resetFilter">清除</button>';
    h += '</div>';
    return h;
  }

  function renderTable(records) {
    if (!records.length) {
      return '<div class="cd-hist-empty">📭 没有符合条件的发送记录。<br><span class="cd-hist-hint">调整筛选条件，或先在「今日任务」中标记发送。</span></div>';
    }
    var h = '<div class="cd-hist-table-wrap"><table class="cd-hist-table"><thead><tr>' +
      '<th>时间</th><th>客户 / 国家</th><th>品类</th><th>类型</th><th>使用邮箱</th>' +
      '<th>主题</th><th>等级</th><th>状态</th><th>操作</th>' +
      '</tr></thead><tbody>';
    records.forEach(function (r) {
      var sm = window.cdUtilPostStatusMeta(r.postSendStatus);
      h += '<tr data-id="' + r.id + '">' +
        '<td class="cd-hist-nowrap">' + window.cdUtilEsc(window.cdUtilFormatDate(r.sentAt)) + '</td>' +
        '<td><b>' + window.cdUtilEsc(r.customerName) + '</b>' +
          '<div class="cd-hist-sub">' + window.cdUtilEsc(r.email || '') + '</div>' +
          '<div class="cd-hist-sub">📍 ' + window.cdUtilEsc(r.country || '—') + '</div></td>' +
        '<td>' + (typeof P2_CAT_LABELS === 'object' ? (P2_CAT_LABELS[r.category] || window.cdUtilEsc(r.category || '—')) : window.cdUtilEsc(r.category || '—')) + '</td>' +
        '<td>' + window.cdUtilEsc(window.cdUtilEmailTypeLabel(r.emailType)) + '</td>' +
        '<td class="cd-hist-nowrap cd-hist-sub">' + window.cdUtilEsc(r.emailAccountAddress || '—') + '</td>' +
        '<td class="cd-hist-subject">' + window.cdUtilEsc(r.subject || '(无主题)') + '</td>' +
        '<td>' + window.cdUtilEsc(r.customerLevel || '—') + '</td>' +
        '<td><span class="cd-hist-tag" style="background:' + sm.color + '22;color:' + sm.color + '">' + sm.label + '</span></td>' +
        '<td class="cd-hist-actions">' +
          '<button class="cd-hist-btn cd-hist-btn-sm" data-act="view" data-id="' + r.id + '" title="查看全文">👁</button>' +
          '<button class="cd-hist-btn cd-hist-btn-sm" data-act="copy" data-id="' + r.id + '" title="复制邮件">📋</button>' +
          '<button class="cd-hist-btn cd-hist-btn-sm" data-act="edit" data-id="' + r.id + '" title="重新编辑">✏️</button>' +
          '<button class="cd-hist-btn cd-hist-btn-sm" data-act="goto" data-id="' + r.id + '" title="跳转客户">👤</button>' +
          '<button class="cd-hist-btn cd-hist-btn-sm cd-hist-btn-danger" data-act="del" data-id="' + r.id + '" title="删除">🗑</button>' +
        '</td>' +
      '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  function renderPage(root) {
    var all = getAllRecords();
    var filtered = applyFilter(all);
    var stats = computeStats(filtered);

    var h = '';
    h += '<div class="cd-hist-header">' +
      '<div><h2 style="margin:0">📜 发送历史箱</h2>' +
      '<div class="cd-hist-hint" style="margin-top:4px">全量发送记录 · 多条件筛选 · 双语全文查看 · 手动发送，工作台不自动发信</div></div>' +
      '<div><button class="cd-hist-btn cd-hist-btn-primary" data-act="export">⬇ 导出CSV</button></div>' +
      '</div>';

    h += renderStatCards(stats);

    // Distribution panel
    h += '<div class="cd-hist-card"><div class="cd-hist-card-title">📊 分布概览（基于当前筛选结果）</div><div class="cd-hist-dist-grid">';
    h += renderDistRow('按品类', stats.catDist, function (k) {
      return (typeof P2_CAT_LABELS === 'object' && P2_CAT_LABELS[k]) ? P2_CAT_LABELS[k] : k;
    });
    h += renderDistRow('按邮箱', stats.accDist, function (k) { return k; });
    h += renderDistRow('按类型', stats.typeDist, function (k) { return window.cdUtilEmailTypeLabel(k); });
    h += '</div></div>';

    h += '<div class="cd-hist-card"><div class="cd-hist-card-title">🔍 筛选</div>' + renderFilters(all) + '</div>';
    h += '<div class="cd-hist-card"><div class="cd-hist-card-title">📋 历史记录（' + filtered.length + ' 条）</div>' + renderTable(filtered) + '</div>';

    h += '<div class="cd-hist-footer">🔒 本模块只记录与展示发送历史，<b>绝不自动发送邮件/WhatsApp</b>。标记状态仅用于本地跟进管理。</div>';

    root.innerHTML = h;
    root._cdHistFiltered = filtered;
  }

  // ============================================================
  // Modal (full email viewer)
  // ============================================================

  function openModal(html) {
    var ov = document.getElementById('cdHistOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'cdHistOverlay';
      ov.className = 'cd-hist-overlay';
      document.body.appendChild(ov);
    }
    ov.innerHTML = '<div class="cd-hist-modal"><div class="cd-hist-modal-head">' +
      '<span>📧 邮件全文</span><button class="cd-hist-btn cd-hist-btn-sm" data-act="closeModal">✕</button></div>' +
      '<div class="cd-hist-modal-body">' + html + '</div></div>';
    ov.style.display = 'flex';
  }
  function closeModal() {
    var ov = document.getElementById('cdHistOverlay');
    if (ov) ov.style.display = 'none';
  }

  // ============================================================
  // Action handlers (exposed on window for inline + delegation)
  // ============================================================

  function findRecord(id) {
    return (S.sendRecords || []).find(function (r) { return r.id === id; }) || null;
  }

  window.cdHistView = function (id) {
    var raw = findRecord(id);
    if (!raw) { toast('记录不存在', 'err'); return; }
    var r = enrichFromCustomer(enhanceRecord(raw));
    var c = window.cdUtilFindCustomer(r.customerId);
    var meta =
      '<div class="cd-hist-modal-meta">' +
      '<div><b>客户：</b>' + window.cdUtilEsc(r.customerName) + ' (' + window.cdUtilEsc(r.email || '') + ')</div>' +
      '<div><b>国家：</b>' + window.cdUtilEsc(r.country || '—') + ' · <b>等级：</b>' + window.cdUtilEsc(r.customerLevel || '—') + '</div>' +
      '<div><b>时间：</b>' + window.cdUtilEsc(window.cdUtilFormatDate(r.sentAt)) + ' · <b>邮箱：</b>' + window.cdUtilEsc(r.emailAccountAddress || '—') + '</div>' +
      '<div><b>主题：</b>' + window.cdUtilEsc(r.subject || '—') + '</div>' +
      '<div><b>类型：</b>' + window.cdUtilEsc(window.cdUtilEmailTypeLabel(r.emailType)) + ' · <b>语言：</b>' + window.cdUtilEsc(r.language || 'en') + '</div>' +
      '</div>';
    var en = r.bodyFull || r.bodySummary || '(未保存正文。可在开发信模块查看完整草稿。)';
    var zh = r.bodyFullZh || '';
    var body = '<div class="cd-hist-modal-cols">' +
      '<div class="cd-hist-modal-col"><div class="cd-hist-modal-coltitle">🇬🇧 English</div><pre class="cd-hist-modal-pre">' + window.cdUtilEsc(en) + '</pre></div>';
    if (zh) {
      body += '<div class="cd-hist-modal-col"><div class="cd-hist-modal-coltitle">🇨🇳 中文对照</div><pre class="cd-hist-modal-pre">' + window.cdUtilEsc(zh) + '</pre></div>';
    }
    body += '</div>';
    if (r.notes) body += '<div class="cd-hist-modal-notes">📝 备注：' + window.cdUtilEsc(r.notes) + '</div>';
    openModal(meta + body);
  };

  window.cdHistCopy = function (id) {
    var raw = findRecord(id);
    if (!raw) return;
    var r = enhanceRecord(raw);
    var text = 'Subject: ' + (r.subject || '') + '\n\n' + (r.bodyFull || r.bodySummary || '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制到剪贴板'); },
        function () { toast('复制失败，请手动选择', 'err'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('已复制到剪贴板'); }
      catch (e) { toast('复制失败', 'err'); }
      document.body.removeChild(ta);
    }
  };

  window.cdHistEdit = function (id) {
    var raw = findRecord(id);
    if (!raw) return;
    toast('正在跳转到开发信引擎，请在其中编辑后手动发送（本工作台不自动发信）');
    if (typeof go === 'function') go('customerDevEmail', { customerId: raw.customerId });
  };

  window.cdHistGoto = function (id) {
    var raw = findRecord(id);
    if (!raw) return;
    if (typeof go === 'function') go('customerDetail', { id: raw.customerId });
  };

  window.cdHistMarkStatus = function (id, status) {
    var raw = findRecord(id);
    if (!raw) return;
    raw.postSendStatus = status;
    // mirror legacy status field for backward compatibility
    if (status === 'replied') raw.status = 'replied';
    else if (status === 'ordered') raw.status = 'ordered';
    else if (status === 'rejected') raw.status = 'rejected';
    else if (status === 'dormant') raw.status = 'dormant';
    else raw.status = 'sent';
    persist();
    var m = window.cdUtilPostStatusMeta(status);
    toast('已标记为：' + m.label);
    renderView();
  };

  window.cdHistDelete = function (id) {
    if (!confirm('确定删除这条发送记录？（仅删除记录，不影响客户数据）')) return;
    S.sendRecords = (S.sendRecords || []).filter(function (r) { return r.id !== id; });
    persist();
    toast('已删除');
    renderView();
  };

  window.cdHistExport = function () {
    var root = document.getElementById('mainContent');
    var rows = (root && root._cdHistFiltered) ? root._cdHistFiltered : getAllRecords();
    var headers = ['时间', '客户', '客户邮箱', '国家', '品类', '邮件类型', '使用邮箱', '主题', '语言', '等级', '发送后状态', '备注'];
    var data = rows.map(function (r) {
      var sm = window.cdUtilPostStatusMeta(r.postSendStatus);
      return [
        window.cdUtilFormatDate(r.sentAt),
        r.customerName, r.email, r.country,
        (typeof P2_CAT_LABELS === 'object' && P2_CAT_LABELS[r.category]) ? P2_CAT_LABELS[r.category] : (r.category || ''),
        window.cdUtilEmailTypeLabel(r.emailType),
        r.emailAccountAddress || '', r.subject || '', r.language || '',
        r.customerLevel || '', sm.label, r.notes || ''
      ];
    });
    window.cdUtilExportCSV('发送历史_' + window.cdUtilTodayStr() + '.csv', headers, data);
    toast('已导出 CSV（' + rows.length + ' 条）');
  };

  window.cdHistResetFilter = function () {
    window._cdHist = { dateRange: 'all', cat: '', acc: '', type: '', country: '', level: '', status: '', kw: '', customFrom: '', customTo: '' };
    renderView();
  };

  // ============================================================
  // Event binding (delegation on root + overlay)
  // ============================================================

  function bindRoot(root) {
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      var act = t.getAttribute('data-act');
      var id = t.getAttribute('data-id');
      if (act === 'export') window.cdHistExport();
      else if (act === 'resetFilter') window.cdHistResetFilter();
      else if (act === 'view' && id) window.cdHistView(id);
      else if (act === 'copy' && id) window.cdHistCopy(id);
      else if (act === 'edit' && id) window.cdHistEdit(id);
      else if (act === 'goto' && id) window.cdHistGoto(id);
      else if (act === 'del' && id) window.cdHistDelete(id);
      else if (act === 'markReplied' && id) window.cdHistMarkStatus(id, 'replied');
      else if (act === 'markOrdered' && id) window.cdHistMarkStatus(id, 'ordered');
      else if (act === 'markRejected' && id) window.cdHistMarkStatus(id, 'rejected');
    });

    // Filter controls
    root.addEventListener('change', function (e) {
      var t = e.target.closest('[data-f]');
      if (!t) return;
      var k = t.getAttribute('data-f');
      window._cdHist[k] = t.value;
      renderView();
    });
    root.addEventListener('input', function (e) {
      var t = e.target.closest('[data-f="kw"]');
      if (!t) return;
      window._cdHist.kw = t.value;
      // live filter on Enter only to avoid re-render on every keystroke;
      // but for responsiveness we re-render on Enter / blur.
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.getAttribute && e.target.getAttribute('data-f') === 'kw') {
        window._cdHist.kw = e.target.value;
        renderView();
      }
    });
  }

  // Overlay close (delegated once)
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act="closeModal"]');
    if (t) { closeModal(); return; }
    var ov = e.target.closest && e.target.closest('.cd-hist-overlay');
    if (ov && e.target === ov) closeModal();
  });

  // ============================================================
  // Page boot
  // ============================================================

  function boot() {
    var root = document.getElementById('mainContent');
    if (!root) return;
    bindRoot(root);
    renderPage(root);
  }

  // ── renderView interception ───────────────────────────────
  var _cdHistOrigRV = window.renderView;
  window.renderView = function () {
    if (currentView === 'cdSendHistory') {
      boot();
      return;
    }
    _cdHistOrigRV.apply(this, arguments);
  };

  // ============================================================
  // Styles (cd-hist- prefixed)
  // ============================================================
  var style = document.createElement('style');
  style.textContent = ''
    + '.cd-hist-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;}'
    + '.cd-hist-hint{font-size:12px;color:#8a96a8;}'
    + '.cd-hist-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px;}'
    + '.cd-hist-stat-card{background:#fff;border:1px solid #e3e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.cd-hist-stat-num{font-size:26px;font-weight:800;}'
    + '.cd-hist-stat-label{font-size:12px;color:#8a96a8;margin-top:4px;}'
    + '.cd-hist-card{background:#fff;border:1px solid #e3e8f0;border-radius:10px;padding:16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(20,41,74,.04);}'
    + '.cd-hist-card-title{font-size:14px;font-weight:700;color:#1a202c;margin-bottom:12px;}'
    + '.cd-hist-dist-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;}'
    + '.cd-hist-dist-block{font-size:12px;}'
    + '.cd-hist-dist-title{font-weight:700;color:#4a5568;margin-bottom:8px;}'
    + '.cd-hist-dist-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;}'
    + '.cd-hist-dist-label{flex:0 0 90px;color:#4a5568;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + '.cd-hist-dist-bar{flex:1;height:8px;background:#edf2f7;border-radius:4px;overflow:hidden;}'
    + '.cd-hist-dist-bar>span{display:block;height:100%;background:linear-gradient(90deg,#3182ce,#63b3ed);}'
    + '.cd-hist-dist-num{flex:0 0 28px;text-align:right;font-weight:700;color:#2d3748;}'
    + '.cd-hist-filter-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}'
    + '.cd-hist-input{padding:6px 10px;border:1px solid #e3e8f0;border-radius:6px;font-size:12.5px;background:#fff;}'
    + '.cd-hist-input:focus{border-color:#1a365d;outline:none;}'
    + '.cd-hist-btn{padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;border:none;transition:all .15s;}'
    + '.cd-hist-btn-primary{background:#1a365d;color:#fff;}'
    + '.cd-hist-btn-primary:hover{background:#14294a;}'
    + '.cd-hist-btn-ghost{background:#eef1f5;color:#4a5568;}'
    + '.cd-hist-btn-sm{padding:3px 8px;font-size:12px;margin:1px;}'
    + '.cd-hist-btn-danger{background:#fff;color:#c53030;border:1px solid #feb2b2;}'
    + '.cd-hist-btn-danger:hover{background:#c53030;color:#fff;}'
    + '.cd-hist-table-wrap{overflow-x:auto;}'
    + '.cd-hist-table{width:100%;border-collapse:collapse;font-size:12.5px;}'
    + '.cd-hist-table th{background:#f7fafc;text-align:left;padding:8px;border-bottom:2px solid #e2e8f0;color:#4a5568;font-weight:600;}'
    + '.cd-hist-table td{padding:8px;border-bottom:1px solid #edf2f7;vertical-align:top;}'
    + '.cd-hist-table tr:hover td{background:#f9fbfd;}'
    + '.cd-hist-sub{font-size:11px;color:#8a96a8;margin-top:2px;}'
    + '.cd-hist-subject{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#2d3748;}'
    + '.cd-hist-nowrap{white-space:nowrap;}'
    + '.cd-hist-actions{white-space:nowrap;}'
    + '.cd-hist-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}'
    + '.cd-hist-empty{text-align:center;padding:40px 20px;color:#8a96a8;font-size:14px;}'
    + '.cd-hist-footer{font-size:12px;color:#8a96a8;text-align:center;padding:12px;}'
    + '.cd-hist-overlay{display:none;position:fixed;inset:0;background:rgba(20,30,50,.5);z-index:9999;align-items:center;justify-content:center;padding:20px;}'
    + '.cd-hist-modal{background:#fff;border-radius:12px;max-width:900px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;}'
    + '.cd-hist-modal-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e2e8f0;font-weight:700;}'
    + '.cd-hist-modal-body{padding:16px 18px;overflow-y:auto;}'
    + '.cd-hist-modal-meta{background:#f7fafc;border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.8;color:#2d3748;margin-bottom:12px;}'
    + '.cd-hist-modal-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;}'
    + '.cd-hist-modal-coltitle{font-weight:700;font-size:13px;margin-bottom:6px;color:#1a365d;}'
    + '.cd-hist-modal-pre{background:#f9fbfd;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:12.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;font-family:inherit;margin:0;}'
    + '.cd-hist-modal-notes{margin-top:12px;font-size:12.5px;color:#4a5568;background:#fffbeb;padding:8px 12px;border-radius:6px;}'
    + '@media (max-width:760px){.cd-hist-modal-cols{grid-template-columns:1fr;}.cd-hist-dist-grid{grid-template-columns:1fr;}}'
    ;
  document.head.appendChild(style);
})();
