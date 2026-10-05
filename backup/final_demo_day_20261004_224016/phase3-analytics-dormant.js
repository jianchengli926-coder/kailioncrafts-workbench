/**
 * Phase3 Analytics & Dormant Customers
 * - Enhanced outreach review dashboard (p3Dashboard)
 * - Dormant customer auto-detection + AI wake-up drafts
 *
 * Loaded via <script> after app.js. No SMTP auto-send.
 * All new CSS classes use p3- prefix.
 */
(function(global){
  'use strict';

  /* ── State init (safe defaults) ─────────────────────────── */
  if(!S.dormantCustomers) S.dormantCustomers = [];
  if(!S.wakeupDrafts) S.wakeupDrafts = [];
  if(!S.replyDrafts) S.replyDrafts = []; // compat with other modules

  /* ── Constants ──────────────────────────────────────────── */
  const P3_CAT_COLORS = {
    outdoor_knives: '#c05621',
    kitchen_knives: '#2b6cb0',
    professional_scissors: '#805ad5',
    kitchen_accessories: '#d69e2e'
  };
  const P3_CAT_LABELS = {
    outdoor_knives: '户外刀',
    kitchen_knives: '厨房刀',
    professional_scissors: '剪刀',
    kitchen_accessories: '厨房用品'
  };
  const P3_EXCLUDE_STATUS = ['已成交', '不再联系'];
  const P3_COOLING_DAYS = 90;

  /* ── Helpers ───────────────────────────────────────────── */
  function p3TodayStr(){
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function p3DaysBetween(dateStr){
    if(!dateStr) return 9999;
    const t = new Date(dateStr).getTime();
    if(isNaN(t)) return 9999;
    return Math.floor((Date.now() - t) / 86400000);
  }
  function p3Uid(){ return 'p3_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function p3CatColor(catId){ return P3_CAT_COLORS[catId] || '#718096'; }
  function p3CatLabel(catId){ return P3_CAT_LABELS[catId] || catId || '未分类'; }

  /* ── NAV injection ──────────────────────────────────────── */
  NAV.push({key:'p3Dashboard', icon:'📊', label:'复盘看板V2', title:'开发复盘看板V2', crumb:'全维度数据 · 品类/邮箱/趋势分析'});
  NAV.push({key:'dormantCustomers', icon:'😴', label:'沉睡客户', title:'沉睡客户唤醒', crumb:'自动识别 · AI唤醒话术 · 冷却池'});

  /* ============================================================
   * Feature 1: Enhanced Dashboard (viewP3Dashboard)
   * ============================================================ */

  /** Compute all dashboard metrics from S */
  function p3ComputeStats(){
    const recs = S.sendRecords || [];
    const customers = S.customers || [];
    const inbox = S.inbox || [];
    const drafts = S.drafts || [];
    const accounts = S.emailAccounts || [];
    const followUps = S.followUpReminders || [];

    const total = recs.length;
    const opened = recs.filter(r => r.openStatus === 'opened').length;
    const clicked = recs.filter(r => r.clickStatus === 'clicked').length;
    const bounced = recs.filter(r => r.bounce === true).length;

    // Distinct customers who received at least one send
    const sentCustomerIds = new Set(recs.map(r => r.customerId).filter(Boolean));
    const sentCustomerCount = sentCustomerIds.size;

    // Distinct customers who replied (have inbox entry)
    const repliedCustomerIds = new Set(inbox.map(i => i.customerId).filter(Boolean));
    const repliedCount = [...repliedCustomerIds].filter(id => sentCustomerIds.has(id)).length;

    // Converted: status 已成交, or has inquiry/quote
    const inqCustIds = new Set((S.inquiries || []).map(i => i.customerId).filter(Boolean));
    const quoteCustIds = new Set((S.quotes || []).map(q => q.customerId).filter(Boolean));
    const convertedCount = customers.filter(c => {
      if(c.status === '已成交') return true;
      if(inqCustIds.has(c.id)) return true;
      if(quoteCustIds.has(c.id)) return true;
      return false;
    }).filter(c => sentCustomerIds.has(c.id)).length;

    // By category
    const catStats = {};
    Object.keys(P3_CAT_LABELS).forEach(catId => {
      catStats[catId] = { sent:0, opened:0, replied:0 };
    });
    recs.forEach(r => {
      const c = customers.find(x => x.id === r.customerId);
      const cat = (typeof normalizeCatId === 'function') ? normalizeCatId(c && c.productCategory) : (r.category || '');
      if(catStats[cat]){
        catStats[cat].sent++;
        if(r.openStatus === 'opened') catStats[cat].opened++;
      }
    });
    // replies per category
    inbox.forEach(i => {
      const c = customers.find(x => x.id === i.customerId);
      const cat = (typeof normalizeCatId === 'function') ? normalizeCatId(c && c.productCategory) : '';
      if(catStats[cat]) catStats[cat].replied++;
    });

    // By email account
    const acctStats = accounts.map(a => {
      const aRecs = recs.filter(r => r.accountId === a.id);
      const aOpened = aRecs.filter(r => r.openStatus === 'opened').length;
      const aBounced = aRecs.filter(r => r.bounce === true).length;
      return {
        id: a.id, name: a.name || a.email || a.id,
        total: aRecs.length, opened: aOpened, bounced: aBounced,
        openRate: aRecs.length ? Math.round(aOpened/aRecs.length*100) : 0,
        bounceRate: aRecs.length ? Math.round(aBounced/aRecs.length*100) : 0
      };
    });

    // Time trend: last 7 days and 30 days
    const trendDays = 30;
    const trendMap = {};
    for(let i = trendDays-1; i >= 0; i--){
      const d = new Date(Date.now() - i*86400000);
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      trendMap[key] = { sent:0, replied:0 };
    }
    recs.forEach(r => {
      const key = (r.sentAt || '').slice(0,10);
      if(trendMap[key]) trendMap[key].sent++;
    });
    inbox.forEach(i => {
      const key = (i.receivedAt || '').slice(0,10);
      if(trendMap[key]) trendMap[key].replied++;
    });
    const trendData = Object.keys(trendMap).sort().map(k => ({ date:k, ...trendMap[k] }));

    // Follow-up effectiveness
    const fu3 = followUps.filter(f => f.followDay === 3);
    const fu7 = followUps.filter(f => f.followDay === 7);
    const fu3Replied = fu3.filter(f => repliedCustomerIds.has(f.customerId)).length;
    const fu7Replied = fu7.filter(f => repliedCustomerIds.has(f.customerId)).length;

    // Draft quality distribution
    const qDist = { A:0, B:0, C:0, D:0 };
    drafts.forEach(d => {
      const g = (d.qualityGrade || '').toUpperCase();
      if(qDist[g] !== undefined) qDist[g]++;
    });

    return {
      total, opened, clicked, bounced,
      sentCustomerCount, repliedCount, convertedCount,
      openRate: total ? Math.round(opened/total*100) : null,
      clickRate: total ? Math.round(clicked/total*100) : null,
      bounceRate: total ? Math.round(bounced/total*100) : null,
      replyRate: sentCustomerCount ? Math.round(repliedCount/sentCustomerCount*100) : null,
      convRate: sentCustomerCount ? Math.round(convertedCount/sentCustomerCount*100) : null,
      catStats, acctStats, trendData,
      fu3Total: fu3.length, fu3Replied,
      fu7Total: fu7.length, fu7Replied,
      fu3Rate: fu3.length ? Math.round(fu3Replied/fu3.length*100) : null,
      fu7Rate: fu7.length ? Math.round(fu7Replied/fu7.length*100) : null,
      qDist,
      insufficient: total < 5
    };
  }

  /** Render a rate cell: show value or "数据不足" */
  function p3RateCell(val, suffix){
    suffix = suffix || '%';
    if(val === null || val === undefined) return '<span style="color:var(--gray)">数据不足</span>';
    return '<b>' + val + suffix + '</b>';
  }

  window.viewP3Dashboard = function(root){
    const s = p3ComputeStats();

    // Category horizontal bars
    const maxCatSent = Math.max(1, ...Object.values(s.catStats).map(c => c.sent));
    const catBarsHtml = Object.keys(P3_CAT_LABELS).map(catId => {
      const c = s.catStats[catId];
      const pct = Math.round(c.sent / maxCatSent * 100);
      const replyRate = c.sent ? Math.round(c.replied/c.sent*100) : 0;
      const color = p3CatColor(catId);
      return `
        <div class="p3-cat-row">
          <div class="p3-cat-label">${p3CatLabel(catId)}</div>
          <div class="p3-cat-bar-wrap">
            <div class="p3-cat-bar" style="width:${pct}%;background:${color}"></div>
          </div>
          <div class="p3-cat-num">${c.sent}封 · 回复${c.replied} (${replyRate}%)</div>
        </div>`;
    }).join('');

    // Time trend CSS bars (last 14 days visible of 30)
    const visibleTrend = s.trendData.slice(-14);
    const maxTrend = Math.max(1, ...visibleTrend.map(t => t.sent));
    const trendHtml = visibleTrend.map(t => {
      const h = Math.round(t.sent / maxTrend * 100);
      const dayLabel = t.date.slice(5); // MM-DD
      return `
        <div class="p3-trend-col" title="${t.date}: ${t.sent}发送 / ${t.replied}回复">
          <div class="p3-trend-bar" style="height:${h}%;background:var(--primary)"></div>
          <div class="p3-trend-label">${dayLabel}</div>
        </div>`;
    }).join('');

    // Conic-gradient donut for draft quality
    const qTotal = s.qDist.A + s.qDist.B + s.qDist.C + s.qDist.D;
    let conicParts = [];
    let accPct = 0;
    const qColors = { A:'#38a169', B:'#3182ce', C:'#d69e2e', D:'#e53e3e' };
    ['A','B','C','D'].forEach(g => {
      const pct = qTotal ? (s.qDist[g]/qTotal*100) : 0;
      if(pct > 0){
        conicParts.push(`${qColors[g]} ${accPct}% ${accPct+pct}%`);
        accPct += pct;
      }
    });
    const donutStyle = qTotal > 0
      ? `background: conic-gradient(${conicParts.join(',')})`
      : `background: #e2e8f0`;
    const donutHtml = qTotal > 0 ? `
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        <div class="p3-donut" style="${donutStyle}">
          <div class="p3-donut-hole"><span>${qTotal}</span></div>
        </div>
        <div>
          ${['A','B','C','D'].map(g => `
            <div style="display:flex;align-items:center;gap:8px;font-size:13px;margin:3px 0">
              <span style="width:12px;height:12px;border-radius:3px;background:${qColors[g]};display:inline-block"></span>
              <span>${g} 级</span>
              <b style="margin-left:auto">${s.qDist[g]}</b>
            </div>`).join('')}
        </div>
      </div>` : '<div class="text-sm" style="color:var(--gray)">暂无草稿数据</div>';

    root.innerHTML = `
      <div style="background:linear-gradient(120deg,var(--primary),#2c5282);color:#fff;padding:16px 20px;border-radius:10px;margin-bottom:16px">
        <div style="font-weight:700;font-size:17px">📊 开发复盘看板 V2</div>
        <div style="font-size:12.5px;opacity:.85;margin-top:4px">全维度数据 · 品类/邮箱账户/时间趋势/跟进效果/草稿质量</div>
      </div>

      <!-- 1a. Core metric cards -->
      <div class="card card-pad mb16">
        <div class="card-title">核心指标</div>
        <div class="stat-grid">
          <div class="stat-card"><div class="stat-label">总发送量</div><div class="stat-value">${s.total}</div></div>
          <div class="stat-card"><div class="stat-label">打开率</div><div class="stat-value" style="color:var(--green)">${p3RateCell(s.openRate)}</div></div>
          <div class="stat-card"><div class="stat-label">点击率</div><div class="stat-value" style="color:var(--orange)">${p3RateCell(s.clickRate)}</div></div>
          <div class="stat-card"><div class="stat-label">回复率</div><div class="stat-value" style="color:var(--primary)">${p3RateCell(s.replyRate)}</div></div>
          <div class="stat-card"><div class="stat-label">转化率</div><div class="stat-value" style="color:#38a169">${p3RateCell(s.convRate)}</div></div>
          <div class="stat-card"><div class="stat-label">退信率</div><div class="stat-value" style="color:var(--red)">${p3RateCell(s.bounceRate)}</div></div>
        </div>
        ${s.insufficient ? '<div class="text-sm mt8" style="color:var(--orange)">⚠️ 发送记录不足5条，部分指标显示为"数据不足"，避免误导。</div>' : ''}
      </div>

      <!-- 1b. By category -->
      <div class="card card-pad mb16">
        <div class="card-title">📦 按品类统计</div>
        <div style="margin-top:12px">${catBarsHtml}</div>
      </div>

      <!-- 1c. By email account -->
      <div class="card card-pad mb16">
        <div class="card-title">📧 按邮箱账户统计</div>
        ${s.acctStats.length ? `
          <div style="overflow-x:auto;margin-top:8px">
          <table class="p3-table">
            <thead><tr><th>账户</th><th>发送量</th><th>打开率</th><th>退信率</th></tr></thead>
            <tbody>
              ${s.acctStats.map(a => `
                <tr>
                  <td>${esc(a.name)}</td>
                  <td>${a.total}</td>
                  <td>${a.total ? a.openRate + '%' : '—'}</td>
                  <td style="color:${a.bounceRate > 5 ? 'var(--red)' : 'inherit'}">${a.total ? a.bounceRate + '%' : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table></div>` : '<div class="text-sm" style="color:var(--gray)">暂无邮箱账户</div>'}
      </div>

      <!-- 1d. Time trend -->
      <div class="card card-pad mb16">
        <div class="card-title">📈 近14天发送趋势</div>
        <div class="p3-trend-chart">${trendHtml}</div>
        <div class="text-sm mt8" style="color:var(--gray)">柱高 = 当日发送量。悬停查看详情。</div>
      </div>

      <!-- 1e. Follow-up effectiveness -->
      <div class="card card-pad mb16">
        <div class="card-title">🔔 跟进效果对比</div>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-label">第3天跟进</div>
            <div class="stat-value" style="color:var(--primary)">${p3RateCell(s.fu3Rate)}</div>
            <div class="text-sm" style="color:var(--gray);margin-top:4px">${s.fu3Replied} / ${s.fu3Total} 封获回复</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">第7天跟进</div>
            <div class="stat-value" style="color:var(--orange)">${p3RateCell(s.fu7Rate)}</div>
            <div class="text-sm" style="color:var(--gray);margin-top:4px">${s.fu7Replied} / ${s.fu7Total} 封获回复</div>
          </div>
        </div>
      </div>

      <!-- 1f. Draft quality distribution -->
      <div class="card card-pad mb16">
        <div class="card-title">📝 开发信质量分布</div>
        ${donutHtml}
      </div>

      <!-- 1g. Export -->
      <div style="text-align:center;margin:20px 0">
        <button class="btn btn-primary" onclick="p3ExportCSV()">⬇️ 导出CSV报告</button>
      </div>
    `;
  };

  /** Export dashboard data to CSV with BOM */
  window.p3ExportCSV = function(){
    const s = p3ComputeStats();
    const today = p3TodayStr().replace(/-/g, '');
    const lines = [];

    lines.push('\uFEFF开发复盘看板V2 报告');
    lines.push('导出日期,' + p3TodayStr());
    lines.push('');
    lines.push('=== 核心指标 ===');
    lines.push('总发送量,' + s.total);
    lines.push('打开率,' + (s.openRate === null ? '数据不足' : s.openRate + '%'));
    lines.push('点击率,' + (s.clickRate === null ? '数据不足' : s.clickRate + '%'));
    lines.push('回复率,' + (s.replyRate === null ? '数据不足' : s.replyRate + '%'));
    lines.push('转化率,' + (s.convRate === null ? '数据不足' : s.convRate + '%'));
    lines.push('退信率,' + (s.bounceRate === null ? '数据不足' : s.bounceRate + '%'));
    lines.push('');

    lines.push('=== 按品类统计 ===');
    lines.push('品类,发送量,打开数,回复数,回复率');
    Object.keys(P3_CAT_LABELS).forEach(catId => {
      const c = s.catStats[catId];
      const rr = c.sent ? Math.round(c.replied/c.sent*100) + '%' : '0%';
      lines.push(p3CatLabel(catId) + ',' + c.sent + ',' + c.opened + ',' + c.replied + ',' + rr);
    });
    lines.push('');

    lines.push('=== 按邮箱账户 ===');
    lines.push('账户,发送量,打开率,退信率');
    s.acctStats.forEach(a => {
      lines.push(a.name + ',' + a.total + ',' + a.openRate + '%,' + a.bounceRate + '%');
    });
    lines.push('');

    lines.push('=== 时间趋势(近30天) ===');
    lines.push('日期,发送量,回复数');
    s.trendData.forEach(t => lines.push(t.date + ',' + t.sent + ',' + t.replied));
    lines.push('');

    lines.push('=== 跟进效果 ===');
    lines.push('第3天跟进回复率,' + (s.fu3Rate === null ? '数据不足' : s.fu3Rate + '%') + '(' + s.fu3Replied + '/' + s.fu3Total + ')');
    lines.push('第7天跟进回复率,' + (s.fu7Rate === null ? '数据不足' : s.fu7Rate + '%') + '(' + s.fu7Replied + '/' + s.fu7Total + ')');
    lines.push('');

    lines.push('=== 草稿质量分布 ===');
    lines.push('等级,数量');
    ['A','B','C','D'].forEach(g => lines.push(g + ',' + s.qDist[g]));

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '开发复盘_' + today + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('CSV报告已导出');
  };

  /* ============================================================
   * Feature 2: Dormant Customer Wake-up (viewDormantCustomers)
   * ============================================================ */

  /**
   * Scan customers for dormant status.
   * Condition A: has sendRecords but no inbox reply in 14+ days
   * Condition B: no interaction at all for 30+ days
   * Exclude: 已成交, 不再联系, blacklisted, unsubscribe
   */
  window.p3ScanDormant = function(){
    const customers = S.customers || [];
    const recs = S.sendRecords || [];
    const inbox = S.inbox || [];
    const followUps = S.followUpReminders || [];
    const today = p3TodayStr();

    // Build reply map: customerId -> last reply date
    const replyMap = {};
    inbox.forEach(i => {
      if(!i.customerId) return;
      if(!replyMap[i.customerId] || (i.receivedAt || '') > replyMap[i.customerId]){
        replyMap[i.customerId] = i.receivedAt || '';
      }
    });

    // Build last send map
    const lastSendMap = {};
    recs.forEach(r => {
      if(!r.customerId) return;
      if(!lastSendMap[r.customerId] || (r.sentAt || '') > lastSendMap[r.customerId]){
        lastSendMap[r.customerId] = r.sentAt || '';
      }
    });

    const results = [];
    customers.forEach(c => {
      // Exclude blacklisted / unsubscribed
      if(c.blacklisted === true || c.unsubscribed === true) return;
      if(P3_EXCLUDE_STATUS.indexOf(c.status) >= 0) return;

      const lastReply = replyMap[c.id] || null;
      const lastSend = lastSendMap[c.id] || null;
      const lastInteract = c.lastInteraction || lastReply || lastSend || c.createdAt;
      const dormantDays = p3DaysBetween(lastInteract);

      // Condition A: has sendRecords, no reply in 14+ days
      // (includes both "never replied" and "replied once but silent since")
      let reason = null;
      if(lastSend){
        const daysSinceReply = lastReply ? p3DaysBetween(lastReply) : Infinity;
        if(daysSinceReply >= 14){
          reason = lastReply
            ? '上次回复后' + daysSinceReply + '天无新回复'
            : '已发送但' + dormantDays + '天无回复';
        }
      } else if(!lastSend && !lastReply && dormantDays >= 30){
        // Condition B: no send, no reply, no interaction for 30+ days
        reason = dormantDays + '天无任何互动';
      }
      if(!reason) return;

      // Check cooling pool
      const existing = (S.dormantCustomers || []).find(d => d.customerId === c.id);
      if(existing && existing.wakeupStatus === 'cooling' && existing.coolUntil){
        if(new Date(existing.coolUntil).getTime() > Date.now()){
          return; // still cooling, skip
        }
      }

      const cat = (typeof normalizeCatId === 'function') ? normalizeCatId(c.productCategory) : '';
      results.push({
        customerId: c.id,
        dormantDays: dormantDays,
        lastInteraction: lastInteract || '',
        category: cat,
        reason: reason,
        wakeupStatus: existing ? existing.wakeupStatus : 'pending',
        coolUntil: existing ? existing.coolUntil : null
      });
    });

    // Sort: most dormant first
    results.sort((a,b) => b.dormantDays - a.dormantDays);
    S.dormantCustomers = results;
    if(typeof persist === 'function') persist();
    return results;
  };

  /** Determine wake-up strategy by dormant days */
  function p3StrategyFor(days){
    if(days >= 60) return 'last_resort';
    if(days >= 30) return 'new_value';
    return 'light_touch';
  }
  function p3StrategyLabel(s){
    return s === 'light_touch' ? '轻触达(14-30天)' : s === 'new_value' ? '新价值(30-60天)' : '最后通牒(60天+)';
  }

  /** Generate AI wake-up email draft */
  window.p3GenerateWakeup = async function(customerId){
    const c = (S.customers || []).find(x => x.id === customerId);
    if(!c){ toast('客户不存在', 'err'); return; }

    const dormant = (S.dormantCustomers || []).find(d => d.customerId === customerId);
    const days = dormant ? dormant.dormantDays : p3DaysBetween(c.lastInteraction);
    const strategy = p3StrategyFor(days);
    const cat = (typeof normalizeCatId === 'function') ? normalizeCatId(c.productCategory) : '';
    const catLabel = p3CatLabel(cat);
    const brand = (S.companyFacts && S.companyFacts.brandName) || 'KaiLionCrafts';
    const companyName = (S.companyFacts && S.companyFacts.companyName) || 'KaiLionCrafts';

    // Build history context
    const cRecs = (S.sendRecords || []).filter(r => r.customerId === customerId);
    const cInbox = (S.inbox || []).filter(i => i.customerId === customerId);
    const historyLines = [];
    cRecs.slice(-3).forEach(r => {
      historyLines.push('Sent ' + (r.sentAt || '').slice(0,10) + ': ' + (r.subject || '(no subject)') + (r.openStatus === 'opened' ? ' [opened]' : ''));
    });
    cInbox.slice(-2).forEach(i => {
      historyLines.push('Reply ' + (i.receivedAt || '').slice(0,10) + ': ' + ((i.aiSummary && i.aiSummary.intent) || '(no summary)'));
    });

    const strategyGuide = {
      light_touch: 'Light touch: greet briefly, share one valuable industry insight or new product info, do NOT push for order. Keep it warm and low-pressure.',
      new_value: 'New value: introduce a new product, certification, or limited offer. Give a clear reason to reply. Keep it professional.',
      last_resort: 'Last resort: politely ask if they still have needs. If no reply, you will pause contact. Be respectful and concise.'
    };

    const prompt = `You are writing a wake-up follow-up email to a B2B buyer who has gone silent.

Customer:
- Company: ${c.company || 'Unknown'}
- Country: ${c.country || 'Unknown'}
- Product category: ${catLabel}
- Has been dormant for: ${days} days

Previous communication history (most recent last):
${historyLines.length ? historyLines.join('\n') : '(No prior records)'}

Strategy: ${p3StrategyLabel(strategy)}
${strategyGuide[strategy]}

Company info:
- Brand: ${brand}
- Company: ${companyName}
- Category focus: ${catLabel}

Write the email in ENGLISH (default for international B2B). Include:
1. A concise, attention-grabbing subject line
2. Body with: greeting, one value point tailored to the strategy, a soft CTA, professional sign-off as ${brand} team
3. Keep it under 120 words. No hype, no pressure.

Output format EXACTLY:
SUBJECT: <subject line>
BODY:
<email body paragraphs>
`;

    toast('AI正在生成唤醒话术...', 'info');
    const r = await callAI([{role:'user', content:prompt}], {purpose:'wakeup', timeout:60000});
    if(r.error){ toast('AI生成失败: ' + r.error, 'err'); return; }

    const content = r.content || '';
    const subjMatch = content.match(/SUBJECT:\s*(.+)/i);
    const bodyMatch = content.match(/BODY:?\s*([\s\S]+)/i);
    const subject = subjMatch ? subjMatch[1].trim() : 'Following up from ' + brand;
    const body = bodyMatch ? bodyMatch[1].trim() : content.trim();

    // Chinese translation (secondary)
    const transPrompt = `Translate this B2B email to Chinese (简体中文), keep it professional:

Subject: ${subject}

${body}`;
    let translation = '';
    try {
      const rt = await callAI([{role:'user', content:transPrompt}], {purpose:'wakeup_translate', timeout:45000});
      if(!rt.error) translation = rt.content || '';
    } catch(e) { /* translation optional */ }

    const draft = {
      id: p3Uid(),
      customerId: customerId,
      strategy: strategy,
      subject: subject,
      body: body,
      translation: translation,
      createdAt: new Date().toISOString(),
      status: 'generated'
    };
    S.wakeupDrafts = S.wakeupDrafts || [];
    S.wakeupDrafts.unshift(draft);

    // Update dormant status
    const d = (S.dormantCustomers || []).find(x => x.customerId === customerId);
    if(d) d.wakeupStatus = 'generated';

    if(typeof persist === 'function') persist();
    toast('唤醒话术已生成 ✓');
    if(currentView === 'dormantCustomers') renderView();
    p3OpenWakeupDrawer(draft);
  };

  /** Open drawer to view/edit a wake-up draft */
  function p3OpenWakeupDrawer(draft){
    const c = (S.customers || []).find(x => x.id === draft.customerId);
    const html = `
      <div style="padding:20px">
        <div style="font-weight:700;font-size:16px;margin-bottom:4px">🤖 AI唤醒话术</div>
        <div class="text-sm" style="color:var(--gray);margin-bottom:16px">
          ${esc(c ? c.company : '')} · ${p3StrategyLabel(draft.strategy)}
        </div>

        <label class="text-sm" style="font-weight:600">主题</label>
        <input id="p3WkSubj" class="p3-input" value="${esc(draft.subject)}" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;margin:6px 0 14px">

        <label class="text-sm" style="font-weight:600">正文 (English)</label>
        <textarea id="p3WkBody" class="p3-input" rows="10" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;margin:6px 0 14px;resize:vertical">${esc(draft.body)}</textarea>

        ${draft.translation ? `
        <details style="margin-bottom:14px">
          <summary class="text-sm" style="cursor:pointer;font-weight:600">查看中文翻译</summary>
          <div style="background:#f7fafc;padding:10px;border-radius:6px;margin-top:8px;font-size:13px;white-space:pre-wrap">${esc(draft.translation)}</div>
        </details>` : ''}

        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="p3SaveWakeup('${draft.id}')">💾 保存修改</button>
          <button class="btn btn-outline btn-sm" onclick="p3CopyWakeup('${draft.id}')">📋 复制全部</button>
          <button class="btn btn-outline btn-sm" onclick="p3MarkWakeupSent('${draft.id}')">✅ 标记已手动发送</button>
          <button class="btn btn-outline btn-sm" style="color:var(--red)" onclick="closeDrawer()">关闭</button>
        </div>
        <div class="text-sm mt8" style="color:var(--orange)">⚠️ 本系统不自动发送邮件。请复制内容到企业邮箱手动发送。</div>
      </div>`;
    openDrawer(html);
  }

  /** Save edited wake-up draft */
  window.p3SaveWakeup = function(draftId){
    const d = (S.wakeupDrafts || []).find(x => x.id === draftId);
    if(!d) return;
    const subj = document.getElementById('p3WkSubj');
    const body = document.getElementById('p3WkBody');
    if(subj) d.subject = subj.value;
    if(body) d.body = body.value;
    if(typeof persist === 'function') persist();
    toast('已保存');
  };

  /** Copy subject+body to clipboard */
  window.p3CopyWakeup = function(draftId){
    const d = (S.wakeupDrafts || []).find(x => x.id === draftId);
    if(!d) return;
    const text = 'Subject: ' + d.subject + '\n\n' + d.body;
    if(navigator.clipboard){
      navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板 ✓'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      toast('已复制到剪贴板 ✓');
    }
  };

  /** Mark wake-up as manually sent */
  window.p3MarkWakeupSent = function(draftId){
    const d = (S.wakeupDrafts || []).find(x => x.id === draftId);
    if(!d) return;
    d.status = 'sent';
    d.sentAt = new Date().toISOString();

    // Update customer lastInteraction
    const c = (S.customers || []).find(x => x.id === d.customerId);
    if(c) c.lastInteraction = new Date().toISOString();

    // Remove from dormant list or mark as woken
    const di = (S.dormantCustomers || []).findIndex(x => x.customerId === d.customerId);
    if(di >= 0) S.dormantCustomers.splice(di, 1);

    if(typeof persist === 'function') persist();
    closeDrawer();
    toast('已标记发送，客户从沉睡列表移除 ✓');
    if(currentView === 'dormantCustomers') renderView();
  };

  /** Add customer to cooling pool (90 days) */
  window.p3CoolingWakeup = function(customerId){
    const d = (S.dormantCustomers || []).find(x => x.customerId === customerId);
    if(!d) return;
    d.wakeupStatus = 'cooling';
    d.coolUntil = new Date(Date.now() + P3_COOLING_DAYS*86400000).toISOString();
    if(typeof persist === 'function') persist();
    toast('已加入冷却池 (' + P3_COOLING_DAYS + '天)');
    if(currentView === 'dormantCustomers') renderView();
  };

  /** View customer detail */
  window.p3ViewCustomer = function(customerId){
    if(typeof go === 'function'){ go('customers', {id: customerId}); }
  };

  /** Main dormant customers view */
  window.viewDormantCustomers = function(root){
    // Auto-scan on first view (if list is empty)
    if(!S.dormantCustomers || S.dormantCustomers.length === 0){
      p3ScanDormant();
    }

    const all = S.dormantCustomers || [];
    const pending = all.filter(d => d.wakeupStatus !== 'cooling');
    const cooling = all.filter(d => d.wakeupStatus === 'cooling');

    // Tabs
    const activeTab = (root.getAttribute('data-p3tab') || 'pending');
    const list = activeTab === 'cooling' ? cooling : pending;

    // Filters (stored on root element)
    const fDays = root.getAttribute('data-p3fdays') || 'all';
    const fCat = root.getAttribute('data-p3fcat') || 'all';
    const fStatus = root.getAttribute('data-p3fstatus') || 'all';

    let filtered = list.slice();
    if(fDays === '14-30') filtered = filtered.filter(d => d.dormantDays >= 14 && d.dormantDays < 30);
    if(fDays === '30-60') filtered = filtered.filter(d => d.dormantDays >= 30 && d.dormantDays < 60);
    if(fDays === '60+') filtered = filtered.filter(d => d.dormantDays >= 60);
    if(fCat !== 'all') filtered = filtered.filter(d => d.category === fCat);
    if(fStatus !== 'all') filtered = filtered.filter(d => d.wakeupStatus === fStatus);

    const custMap = {};
    (S.customers || []).forEach(c => custMap[c.id] = c);

    root.innerHTML = `
      <div style="background:linear-gradient(120deg,#805ad5,#553c9a);color:#fff;padding:16px 20px;border-radius:10px;margin-bottom:16px">
        <div style="font-weight:700;font-size:17px">😴 沉睡客户唤醒</div>
        <div style="font-size:12.5px;opacity:.85;margin-top:4px">自动识别久未回复客户 · AI生成唤醒话术 · 冷却池管理</div>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
        <button class="btn ${activeTab==='pending'?'btn-primary':''} btn-sm" onclick="p3SetTab('pending')">待唤醒 (${pending.length})</button>
        <button class="btn ${activeTab==='cooling'?'btn-primary':''} btn-sm" onclick="p3SetTab('cooling')">冷却中 (${cooling.length})</button>
        <div style="flex:1"></div>
        <button class="btn btn-outline btn-sm" onclick="p3ScanDormant();renderView()">🔄 重新扫描</button>
      </div>

      ${activeTab === 'pending' ? `
      <!-- Filters -->
      <div class="card card-pad mb16" style="padding:12px 16px">
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:13px">
          <span style="color:var(--gray)">筛选:</span>
          <select class="p3-select" onchange="p3SetFilter('fdays', this.value)">
            <option value="all">全部天数</option>
            <option value="14-30" ${fDays==='14-30'?'selected':''}>14-30天</option>
            <option value="30-60" ${fDays==='30-60'?'selected':''}>30-60天</option>
            <option value="60+" ${fDays==='60+'?'selected':''}>60天以上</option>
          </select>
          <select class="p3-select" onchange="p3SetFilter('fcat', this.value)">
            <option value="all">全部品类</option>
            ${Object.keys(P3_CAT_LABELS).map(catId =>
              `<option value="${catId}" ${fCat===catId?'selected':''}>${p3CatLabel(catId)}</option>`
            ).join('')}
          </select>
          <select class="p3-select" onchange="p3SetFilter('fstatus', this.value)">
            <option value="all">全部状态</option>
            <option value="pending" ${fStatus==='pending'?'selected':''}>待生成</option>
            <option value="generated" ${fStatus==='generated'?'selected':''}>已生成话术</option>
          </select>
        </div>
      </div>` : ''}

      <!-- Customer list -->
      ${filtered.length === 0 ? `
        <div class="card card-pad mb16" style="text-align:center;padding:40px;color:var(--gray)">
          ${activeTab === 'cooling' ? '冷却池为空 🎉' : '暂无符合条件的沉睡客户 🎉'}
        </div>
      ` : `
      <div class="card card-pad mb16" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
        <table class="p3-table">
          <thead><tr>
            <th>客户公司</th><th>国家</th><th>品类</th><th>沉睡天数</th><th>最后互动</th><th>原因</th><th>状态</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${filtered.map(d => {
              const c = custMap[d.customerId] || {};
              const daysColor = d.dormantDays >= 60 ? 'var(--red)' : d.dormantDays >= 30 ? 'var(--orange)' : 'var(--primary)';
              const stLabel = d.wakeupStatus === 'cooling' ? '冷却中' : d.wakeupStatus === 'generated' ? '已生成' : '待生成';
              return `
              <tr>
                <td><b>${esc(c.company || '(未知)')}</b></td>
                <td>${esc(c.country || '—')}</td>
                <td><span style="color:${p3CatColor(d.category)}">●</span> ${p3CatLabel(d.category)}</td>
                <td style="color:${daysColor};font-weight:700">${d.dormantDays}天</td>
                <td class="text-sm" style="color:var(--gray)">${(d.lastInteraction || '').slice(0,10) || '—'}</td>
                <td class="text-sm">${esc(d.reason || '')}</td>
                <td>${stLabel}</td>
                <td style="white-space:nowrap">
                  ${activeTab === 'pending' ? `
                    <button class="btn btn-primary btn-xs" onclick="p3GenerateWakeup('${d.customerId}')">🤖 生成话术</button>
                    <button class="btn btn-outline btn-xs" onclick="p3CoolingWakeup('${d.customerId}')">🧊 冷却</button>
                  ` : `
                    <span class="text-sm" style="color:var(--gray)">至 ${(d.coolUntil || '').slice(0,10)}</span>
                  `}
                  <button class="btn btn-outline btn-xs" onclick="p3ViewCustomer('${d.customerId}')">👁 查看</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        </div>
      </div>`}

      <!-- Generated drafts summary -->
      ${(S.wakeupDrafts || []).length > 0 && activeTab === 'pending' ? `
      <div class="card card-pad mb16">
        <div class="card-title">📝 已生成唤醒草稿 (${S.wakeupDrafts.length})</div>
        ${S.wakeupDrafts.slice(0,5).map(w => {
          const c = custMap[w.customerId] || {};
          return `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #edf2f7">
            <div style="flex:1">
              <div class="text-sm"><b>${esc(c.company || '')}</b> · ${p3StrategyLabel(w.strategy)}</div>
              <div class="text-sm" style="color:var(--gray)">${esc(w.subject)}</div>
            </div>
            <button class="btn btn-outline btn-xs" onclick="p3OpenDraftById('${w.id}')">查看</button>
          </div>`;
        }).join('')}
      </div>` : ''}
    `;
  };

  /** Tab switcher */
  window.p3SetTab = function(tab){
    const root = document.getElementById('mainContent');
    root.setAttribute('data-p3tab', tab);
    renderView();
  };

  /** Filter setter */
  window.p3SetFilter = function(key, val){
    const root = document.getElementById('mainContent');
    const map = { fdays: 'data-p3fdays', fcat: 'data-p3fcat', fstatus: 'data-p3fstatus' };
    root.setAttribute(map[key], val);
    renderView();
  };

  /** Open a saved draft by id */
  window.p3OpenDraftById = function(draftId){
    const d = (S.wakeupDrafts || []).find(x => x.id === draftId);
    if(d) p3OpenWakeupDrawer(d);
  };

  /* ============================================================
   * renderView monkey-patch
   * ============================================================ */
  const _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'p3Dashboard'){
      const c = document.getElementById('mainContent');
      if(c) window.viewP3Dashboard(c);
      return;
    }
    if(currentView === 'dormantCustomers'){
      const c = document.getElementById('mainContent');
      if(c) window.viewDormantCustomers(c);
      return;
    }
    _origRV.apply(this, arguments);
  };

  /* ============================================================
   * CSS injection
   * ============================================================ */
  const style = document.createElement('style');
  style.textContent = `
    .p3-table { width:100%; border-collapse:collapse; font-size:13.5px; }
    .p3-table th { text-align:left; padding:10px 12px; background:#f7fafc; border-bottom:2px solid #e2e8f0; font-weight:600; color:#4a5568; white-space:nowrap; }
    .p3-table td { padding:10px 12px; border-bottom:1px solid #edf2f7; }
    .p3-table tbody tr:hover { background:#f7fafc; }

    .p3-cat-row { display:flex; align-items:center; gap:10px; margin:8px 0; }
    .p3-cat-label { width:70px; font-size:13px; color:#4a5568; flex-shrink:0; }
    .p3-cat-bar-wrap { flex:1; background:#edf2f7; border-radius:4px; height:20px; overflow:hidden; }
    .p3-cat-bar { height:100%; border-radius:4px; transition:width .3s; }
    .p3-cat-num { font-size:12px; color:#718096; white-space:nowrap; min-width:140px; }

    .p3-trend-chart { display:flex; align-items:flex-end; gap:3px; height:120px; padding-top:10px; }
    .p3-trend-col { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; min-width:20px; }
    .p3-trend-bar { width:100%; max-width:24px; border-radius:3px 3px 0 0; min-height:2px; }
    .p3-trend-label { font-size:9px; color:#a0aec0; margin-top:3px; transform:rotate(-45deg); white-space:nowrap; }

    .p3-donut { width:100px; height:100px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .p3-donut-hole { width:55px; height:55px; background:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:18px; }

    .p3-input:focus { outline:none; border-color:var(--primary); }
    .p3-select { padding:5px 8px; border:1px solid #e2e8f0; border-radius:6px; font-size:13px; background:#fff; }

    @media (max-width: 768px) {
      .p3-table { font-size:12.5px; }
      .p3-table th, .p3-table td { padding:8px 8px; }
      .p3-cat-num { min-width:100px; font-size:11px; }
    }
  `;
  document.head.appendChild(style);

})(window);
