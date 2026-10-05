/* ============================================================
 * P5 Phase5: Feishu Daily Broadcast (Webhook Push)
 * ----------------------------------------------------------------
 * - Pure frontend module, loaded AFTER phase4-whatsapp.js.
 * - Pushes a daily workbench summary to a Feishu custom bot
 *   webhook (free, no paid service).
 * - HARD RULE: only pushes internal workbench metrics summary.
 *   Does NOT send emails, WhatsApp, or any external customer msg.
 * - The browser cannot run a true background scheduler, so the
 *   "scheduled push" fires when the workbench page is open and
 *   the current time >= pushTime. This is clearly labeled in UI.
 * - All new CSS classes use the p5- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init ─────────────────────────────────────────────
  if(!S.p5FeishuConfig) S.p5FeishuConfig = {
    webhookUrl: '',
    pushTime: '09:00',
    enabled: false,
    contentToggles: {
      pendingTasks: true,
      yesterdayStats: true,
      followUpCount: true,
      highIntent: true,
      aiSuggestions: true
    },
    lastPushedAt: null,
    pushHistory: []
  };
  if(!Array.isArray(S.p5FeishuConfig.pushHistory)) S.p5FeishuConfig.pushHistory = [];

  // ── Nav injection ─────────────────────────────────────────
  NAV.push({key:'feishuBroadcast', icon:'📢', label:'飞书播报', title:'飞书每日播报配置', crumb:'Webhook定时推送 · 数据汇总 · 手动测试'});

  // ── Local helpers ────────────────────────────────────────
  function p5NowISO(){ return new Date().toISOString(); }

  function p5TodayStr(){
    if(typeof p2TodayStr === 'function') return p2TodayStr();
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p5FmtTime(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')
      +' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  // Yesterday date string (YYYY-MM-DD)
  function p5YesterdayStr(){
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  // Normalize a date-ish value to a YYYY-MM-DD string for comparison.
  function p5ToDateStr(v){
    if(!v) return '';
    var d = new Date(v);
    if(isNaN(d.getTime())) return '';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  // ── Compute broadcast content from global S data ──────────
  function p5BuildBroadcastContent(){
    var cfg = S.p5FeishuConfig;
    var toggles = cfg.contentToggles;
    var today = p5TodayStr();
    var yesterday = p5YesterdayStr();
    var lines = []; // lark_md content lines

    // 1) Pending tasks today
    if(toggles.pendingTasks){
      var pending = 0;
      // Count from dailySendTasks if available
      if(S.dailySendTasks && Array.isArray(S.dailySendTasks.tasks)){
        pending += S.dailySendTasks.tasks.filter(function(t){ return t.status !== 'sent'; }).length;
      }
      // Count from whatsappTasks for today
      if(S.whatsappTasks){
        pending += S.whatsappTasks.filter(function(t){ return t.date === today && t.status === 'pending'; }).length;
      }
      lines.push('**📋 今日待发送任务：** '+pending+' 条');
    }

    // 2) Yesterday stats: sent count, open rate, reply rate
    if(toggles.yesterdayStats){
      var recs = S.sendRecords || [];
      var yRecs = recs.filter(function(r){ return p5ToDateStr(r.sentAt) === yesterday; });
      var yTotal = yRecs.length;
      var yOpens = yRecs.filter(function(r){ return r.opens && r.opens > 0; }).length;
      var yReplies = yRecs.filter(function(r){ return r.replied; }).length;
      var openRate = yTotal ? Math.round(yOpens / yTotal * 100) : 0;
      var replyRate = yTotal ? Math.round(yReplies / yTotal * 100) : 0;
      lines.push('**📊 昨日发送：** '+yTotal+' 条 · 打开率 '+openRate+'% · 回复率 '+replyRate+'%');
    }

    // 3) Follow-up customers due
    if(toggles.followUpCount){
      var nowTs = Date.now();
      var dueFollow = (S.customers||[]).filter(function(c){
        if(c.status === '已回复') return false;
        if(!c.nextFollowUp) return false;
        var fu = new Date(c.nextFollowUp).getTime();
        return !isNaN(fu) && fu <= nowTs;
      }).length;
      lines.push('**🔔 待跟进客户：** '+dueFollow+' 个');
    }

    // 4) High-intent customers not yet followed
    if(toggles.highIntent){
      var hiList = (S.customers||[]).filter(function(c){
        if(c.status === '已回复') return false;
        var score = c.dynamicIntentScore || c.highIntent ? 100 : 0;
        if(c.leadScore) score = c.leadScore;
        if(c.scores && c.scores.total) score = c.scores.total;
        return score >= 70;
      });
      var hiCount = hiList.length;
      var hiNames = hiList.slice(0, 3).map(function(c){
        return c.company || (c.contact && c.contact.name) || '未知';
      }).join('、');
      lines.push('**⭐ 高意向未跟进：** '+hiCount+' 个'+(hiNames ? '（'+hiNames+'）' : ''));
    }

    // 5) AI action suggestions Top 3 (from module B if present)
    if(toggles.aiSuggestions){
      var suggs = S.p5ActionSuggestions || [];
      if(suggs.length){
        var top3 = suggs.slice(0, 3).map(function(s, i){
          return (i+1)+'. '+(s.title || s.text || '建议'+(i+1));
        });
        lines.push('**🤖 AI行动建议：**\n'+top3.join('\n'));
      }else{
        lines.push('**🤖 AI行动建议：** 暂无（请先运行智能建议模块）');
      }
    }

    return {
      title: '📊 KaiLionCrafts 外贸日报 - '+today,
      lines: lines
    };
  }

  // Build the Feishu interactive card JSON payload.
  function p5BuildCardPayload(){
    var content = p5BuildBroadcastContent();
    // Join lines with line breaks; lark_md uses \n for newlines.
    var bodyText = content.lines.join('\n\n');
    if(!bodyText) bodyText = '今日暂无数据。';

    return {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: content.title },
          template: 'blue'
        },
        elements: [
          {
            tag: 'div',
            text: { tag: 'lark_md', content: bodyText }
          },
          {
            tag: 'note',
            elements: [
              { tag: 'plain_text', content: '由 KaiLionCrafts 外贸获客工作台自动推送 · '+new Date().toLocaleString('zh-CN') }
            ]
          }
        ]
      }
    };
  }

  // ── Push via local server proxy (avoids browser CORS) ─────
  async function p5PushBroadcast(isManual){
    var cfg = S.p5FeishuConfig;
    if(!cfg.webhookUrl){
      toast('请先填写飞书自定义机器人 Webhook URL','err');
      return;
    }
    var card = p5BuildCardPayload();
    var record = { time: p5NowISO(), success: false, error: null, manual: !!isManual };

    try{
      var r = await fetch('/api/feishu/send', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ webhookUrl: cfg.webhookUrl, card: card })
      });
      var data = await r.json().catch(function(){ return {}; });
      if(r.ok && data.success){
        record.success = true;
        cfg.lastPushedAt = p5NowISO();
        toast('✅ 推送成功，已发送到飞书群');
      }else{
        record.error = data.error || ('HTTP '+r.status);
        toast('❌ 推送失败：'+record.error, 'err');
      }
    }catch(e){
      record.error = e.message || String(e);
      toast('❌ 推送异常：'+record.error, 'err');
    }

    cfg.pushHistory.unshift(record);
    if(cfg.pushHistory.length > 20) cfg.pushHistory.length = 20;
    persist();
    renderView();
  }

  window.p5PushNow = function(){ p5PushBroadcast(true); };

  // ── Scheduled push status check (NO auto-send) ────────────
  // 仅更新"待推送/已推送"状态提示，绝不自动发送。
  // 所有发送必须由用户手动点击"立即推送测试"按钮触发。
  function p5UpdatePushStatus(){
    var cfg = S.p5FeishuConfig;
    if(!cfg.enabled || !cfg.webhookUrl) return;
    var today = p5TodayStr();
    var statusEl = document.getElementById('p5_push_status');
    if(!statusEl) return;
    // Already pushed today?
    if(cfg.lastPushedAt && p5ToDateStr(cfg.lastPushedAt) === today){
      statusEl.innerHTML = '<span style="color:#38a16p">✅ 今日已推送</span>';
      return;
    }
    // Is current time >= pushTime?
    var now = new Date();
    var nowMin = now.getHours()*60 + now.getMinutes();
    var parts = (cfg.pushTime || '09:00').split(':');
    var pushMin = (parseInt(parts[0],10)||0)*60 + (parseInt(parts[1],10)||0);
    if(nowMin >= pushMin){
      statusEl.innerHTML = '<span style="color:#d69e2e">⏰ 到达推送时间，请手动点击"立即推送测试"</span>';
    } else {
      var remainMin = pushMin - nowMin;
      statusEl.innerHTML = '<span style="color:#718096">🕐 距推送时间还有 ' + remainMin + ' 分钟（不会自动发送）</span>';
    }
  }

  // Refresh push status display every 60 seconds (status only, NO sending).
  setInterval(p5UpdatePushStatus, 60000);
  // Also update once shortly after page load.
  setTimeout(p5UpdatePushStatus, 500);

  // ═══════════════════════════════════════════════════════════
  //  MAIN VIEW
  // ═══════════════════════════════════════════════════════════
  window.viewFeishuBroadcast = function(root){
    var cfg = S.p5FeishuConfig;
    var t = cfg.contentToggles;

    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">📢 飞书每日播报</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">将工作台每日数据汇总推送到你的飞书自定义机器人群 · 完全免费 · 不发送任何客户外部消息</div>';
    h += '  <div id="p5_push_status" style="margin-top:6px;font-size:13px"></div></div>';
    h += '  <button class="btn btn-primary" onclick="p5PushNow()">🧪 立即推送测试</button>';
    h += '</div>';

    // ── Config card ──
    h += '<div class="p5-card">';
    h += '  <div class="p5-card-title">⚙️ 推送配置</div>';

    // Webhook URL
    h += '  <div class="p5-field">';
    h += '    <label>飞书自定义机器人 Webhook URL</label>';
    h += '    <input class="form-control" id="p5_webhook" value="'+esc(cfg.webhookUrl)+'" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx">';
    h += '    <div class="p5-hint">💡 如何获取：飞书群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人 → 复制 Webhook 地址</div>';
    h += '  </div>';

    // Push time + enable
    h += '  <div class="p5-row">';
    h += '    <div class="p5-field">';
    h += '      <label>每日推送时间</label>';
    h += '      <input type="time" class="form-control" id="p5_pushtime" value="'+esc(cfg.pushTime)+'">';
    h += '    </div>';
    h += '    <div class="p5-field">';
    h += '      <label>启用定时推送</label>';
    h += '      <label class="p5-switch">';
    h += '        <input type="checkbox" id="p5_enabled"'+(cfg.enabled?' checked':'')+'>';
    h += '        <span class="p5-slider"></span>';
    h += '      </label>';
    h += '    </div>';
    h += '  </div>';

    h += '  <div class="p5-warn-box">🔒 安全模式：定时设置仅用于显示"待推送"状态提示，<b>不会自动发送</b>。到达推送时间后，请手动点击上方"立即推送测试"按钮确认发送。关闭页面后不会后台推送。</div>';

    // Content toggles
    h += '  <div class="p5-field">';
    h += '    <label>推送内容模块</label>';
    h += '    <div class="p5-toggles">';
    h += p5ToggleItem('pendingTasks',  '📋 今日待发送任务数', t.pendingTasks);
    h += p5ToggleItem('yesterdayStats','📊 昨日发送量/打开率/回复率', t.yesterdayStats);
    h += p5ToggleItem('followUpCount', '🔔 待跟进客户数', t.followUpCount);
    h += p5ToggleItem('highIntent',    '⭐ 高意向未跟进客户', t.highIntent);
    h += p5ToggleItem('aiSuggestions', '🤖 AI行动建议 Top3', t.aiSuggestions);
    h += '    </div>';
    h += '  </div>';

    h += '  <div class="p5-actions">';
    h += '    <button class="btn btn-primary" onclick="p5SaveConfig()">💾 保存配置</button>';
    h += '  </div>';
    h += '</div>';

    // ── Preview card ──
    var preview = p5BuildBroadcastContent();
    h += '<div class="p5-card">';
    h += '  <div class="p5-card-title">👁️ 播报内容预览（当前数据实时计算）</div>';
    h += '  <div class="p5-preview-title">'+esc(preview.title)+'</div>';
    preview.lines.forEach(function(line){
      h += '  <div class="p5-preview-line">'+esc(line)+'</div>';
    });
    h += '</div>';

    // ── Push history ──
    h += '<div class="p5-card">';
    h += '  <div class="p5-card-title">🗂 推送历史（最近 10 次）</div>';
    var hist = (cfg.pushHistory || []).slice(0, 10);
    if(!hist.length){
      h += '<div class="p5-empty">还没有推送记录。点击右上角「🧪 立即推送测试」发送第一条。</div>';
    }else{
      h += '<table class="p5-table"><thead><tr><th>时间</th><th>结果</th><th>类型</th><th>错误信息</th></tr></thead><tbody>';
      hist.forEach(function(r){
        h += '<tr>';
        h += '  <td>'+p5FmtTime(r.time)+'</td>';
        h += '  <td>'+(r.success?'<span class="p5-ok">✅ 成功</span>':'<span class="p5-fail">❌ 失败</span>')+'</td>';
        h += '  <td>'+(r.manual?'手动测试':'定时推送')+'</td>';
        h += '  <td>'+(r.error?esc(r.error):'—')+'</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div>';

    root.innerHTML = h;
  };

  function p5ToggleItem(key, label, checked){
    return '<label class="p5-toggle-row">'
      + '<input type="checkbox" data-toggle="'+key+'"'+(checked?' checked':'')+'>'
      + '<span>'+label+'</span></label>';
  }

  // ── Save config from form ─────────────────────────────────
  window.p5SaveConfig = function(){
    var cfg = S.p5FeishuConfig;
    cfg.webhookUrl = document.getElementById('p5_webhook').value.trim();
    cfg.pushTime = document.getElementById('p5_pushtime').value || '09:00';
    cfg.enabled = document.getElementById('p5_enabled').checked;
    // Read toggles
    var boxes = document.querySelectorAll('[data-toggle]');
    boxes.forEach(function(b){
      cfg.contentToggles[b.getAttribute('data-toggle')] = b.checked;
    });
    persist();
    toast('配置已保存');
    renderView();
  };

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'feishuBroadcast'){
      window.viewFeishuBroadcast(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p5- prefixed, responsive) ─────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p5-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:16px;}'
    + '.p5-card-title{font-size:15px;font-weight:700;color:#2d3748;margin-bottom:14px;}'
    + '.p5-field{margin-bottom:14px;}'
    + '.p5-field label{display:block;font-size:12px;color:#4a5568;margin-bottom:5px;font-weight:600;}'
    + '.p5-hint{font-size:11px;color:#a0aec0;margin-top:4px;line-height:1.5;}'
    + '.p5-row{display:flex;gap:20px;}'
    + '.p5-row>.p5-field{flex:1;}'
    + '.p5-warn-box{background:#fffaf0;border:1px solid #fbd38d;border-radius:8px;padding:10px 14px;font-size:12px;color:#c05621;margin-bottom:14px;line-height:1.6;}'
    + '.p5-toggles{display:flex;flex-direction:column;gap:8px;}'
    + '.p5-toggle-row{display:flex;align-items:center;gap:8px;font-size:13px;color:#4a5568;cursor:pointer;}'
    + '.p5-toggle-row input{width:16px;height:16px;cursor:pointer;}'
    + '.p5-actions{display:flex;gap:8px;margin-top:8px;}'
    // Switch
    + '.p5-switch{position:relative;display:inline-block;width:46px;height:24px;}'
    + '.p5-switch input{opacity:0;width:0;height:0;}'
    + '.p5-slider{position:absolute;cursor:pointer;inset:0;background:#cbd5e0;border-radius:24px;transition:.2s;}'
    + '.p5-slider:before{content:"";position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s;}'
    + '.p5-switch input:checked + .p5-slider{background:#3182ce;}'
    + '.p5-switch input:checked + .p5-slider:before{transform:translateX(22px);}'
    // Preview
    + '.p5-preview-title{font-size:14px;font-weight:700;color:#2b6cb0;margin-bottom:10px;}'
    + '.p5-preview-line{font-size:13px;color:#4a5568;background:#f7fafc;border-radius:6px;padding:8px 12px;margin-bottom:6px;line-height:1.6;}'
    // Table
    + '.p5-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;}'
    + '.p5-table th,.p5-table td{padding:8px 12px;border-bottom:1px solid #edf2f7;text-align:left;}'
    + '.p5-table th{background:#f7fafc;color:#4a5568;}'
    + '.p5-ok{color:#38a169;font-weight:600;}'
    + '.p5-fail{color:#e53e3e;font-weight:600;}'
    + '.p5-empty{padding:30px;text-align:center;color:#a0aec0;font-size:13px;}'
    // Responsive
    + '@media (max-width:768px){'
    + '  .p5-row{flex-direction:column;gap:0;}'
    + '  .p5-table{display:block;overflow-x:auto;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
