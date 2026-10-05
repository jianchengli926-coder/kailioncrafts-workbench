/* ============================================================
 * Phase 4: Open REST API + Webhook Integration Module
 * ----------------------------------------------------------------
 * - Pure frontend module, loaded AFTER app.js.
 * - Management UI for issuing/revoking API keys, configuring
 *   outbound webhooks, inspecting call/webhook logs, and reading
 *   the embedded API documentation.
 * - The browser talks to the local server (/api/v1/*) which owns
 *   the persistent JSON data store under ./data.
 * - All new CSS classes use the p4- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init (mirrors; source of truth is the backend JSON store) ──
  if(!S.apiKeys) S.apiKeys = [];
  if(!S.apiCallLogs) S.apiCallLogs = [];
  if(!S.webhooks) S.webhooks = [];
  if(!S.webhookLogs) S.webhookLogs = [];

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({key:'apiIntegration', icon:'🔌', label:'API与集成', title:'API与Webhook集成', crumb:'REST API · Webhook · 第三方系统对接'});

  // ── Local helpers ──────────────────────────────────────────
  function p4NowISO(){ return new Date().toISOString(); }

  function p4Fmt(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    var m = String(d.getMonth()+1).padStart(2,'0');
    var day = String(d.getDate()).padStart(2,'0');
    var hh = String(d.getHours()).padStart(2,'0');
    var mm = String(d.getMinutes()).padStart(2,'0');
    return d.getFullYear()+'-'+m+'-'+day+' '+hh+':'+mm;
  }

  // Thin fetch wrapper around the local open API.
  async function p4Api(path, opts){
    opts = opts || {};
    var r = await fetch('/api/v1' + path, {
      method: opts.method || 'GET',
      headers: Object.assign({'Content-Type':'application/json'}, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var data = await r.json().catch(function(){ return {}; });
    if(!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  // Push the current workbench business data (from localStorage) up to the
  // backend so the open API /analytics /customers actually expose real data.
  async function p4SyncSnapshot(){
    try{
      await p4Api('/admin/sync-snapshot', {method:'POST', body:{
        customers: S.customers || [],
        drafts: S.drafts || [],
        sendTasks: S.dailySendTasks || S.sendTasks || [],
        sentCount: (S.sendRecords || []).length,
        replyCount: (S.inbox || []).length
      }});
    }catch(e){ /* non-fatal: panel still renders local cache */ }
  }

  // Load all admin data from the backend, then re-render the active tab.
  window.p4Refresh = async function(){
    var body = document.getElementById('p4-body');
    if(!body) return;
    try{
      var keys = await p4Api('/admin/api-keys');
      S.apiKeys = keys.data || [];
      S.apiCallLogs = keys.logs || [];
      var wh = await p4Api('/admin/webhooks');
      S.webhooks = wh.data || [];
      S.webhookLogs = wh.logs || [];
      // api call logs are read from the same api-keys payload? -> fetch analytics for totals
      try{ var an = await p4Api('/analytics'); S._p4Analytics = an; }catch(e){ S._p4Analytics = null; }
      // API call logs: derive from backend api_logs.json via a lightweight path.
      // We expose them through the analytics call count; for a per-call table we
      // reuse the most recent webhook logs + a note. To keep call logs visible we
      // request them through the admin keys list (already returned above).
    }catch(e){
      body.innerHTML = '<div class="p4-empty">加载失败：'+esc(e.message)+'<br><small>请确认已登录工作台，且后端 server.js 已启动。</small></div>';
      return;
    }
    p4RenderTab();
  };

  // ── Tab rendering ──────────────────────────────────────────
  window.p4SetTab = function(t){ window._p4Tab = t; p4RenderTab(); };

  function p4RenderTab(){
    var body = document.getElementById('p4-body');
    if(!body) return;
    var t = window._p4Tab || 'keys';
    if(t === 'keys') body.innerHTML = p4KeysPanel();
    else if(t === 'webhooks') body.innerHTML = p4WebhooksPanel();
    else body.innerHTML = p4DocsPanel();
  }

  // ── List view (header + tabs) ──────────────────────────────
  window.viewApiIntegration = function(root){
    window._p4Tab = window._p4Tab || 'keys';
    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">🔌 API 与 Webhook 集成</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">开放 REST API · Webhook 事件推送 · 对接 Zapier / n8n / 自研系统</div></div>';
    h += '  <button class="btn btn-outline" onclick="p4Refresh()">🔄 刷新</button>';
    h += '</div>';

    h += '<div class="p4-tabs">';
    h += '  <div class="p4-tab '+(window._p4Tab==='keys'?'on':'')+'" onclick="p4SetTab(\'keys\')">🔑 API Keys</div>';
    h += '  <div class="p4-tab '+(window._p4Tab==='webhooks'?'on':'')+'" onclick="p4SetTab(\'webhooks\')">🪝 Webhooks</div>';
    h += '  <div class="p4-tab '+(window._p4Tab==='docs'?'on':'')+'" onclick="p4SetTab(\'docs\')">📘 API 文档</div>';
    h += '</div>';

    h += '<div id="p4-body"><div class="p4-empty">加载中…</div></div>';
    root.innerHTML = h;

    // Push current workbench data up, then load admin data.
    p4SyncSnapshot().then(function(){ p4Refresh(); });
  };

  // ── Panel 1: API Keys ─────────────────────────────────────
  function p4KeysPanel(){
    var keys = S.apiKeys || [];
    var h = '';
    h += '<div class="flex-between" style="margin-bottom:12px">';
    h += '  <div class="text-sm text-muted">外部系统通过 Header <code>x-api-key</code> 调用开放接口。每个 Key 限流 60 次/分钟。</div>';
    h += '  <button class="btn btn-primary" onclick="p4CreateKey()">➕ 生成新API Key</button>';
    h += '</div>';

    if(!keys.length){
      h += '<div class="p4-empty">还没有 API Key。点击「生成新API Key」为第三方系统颁发访问凭证。</div>';
    } else {
      h += '<table class="p4-table"><thead><tr><th>名称</th><th>Key</th><th>创建时间</th><th>最后使用</th><th>调用次数</th><th>状态</th><th>操作</th></tr></thead><tbody>';
      keys.forEach(function(k){
        h += '<tr>'
          + '<td>'+esc(k.name||'未命名')+'</td>'
          + '<td><code class="p4-mono">'+esc(k.keyPrefix||'')+'</code></td>'
          + '<td>'+p4Fmt(k.createdAt)+'</td>'
          + '<td>'+p4Fmt(k.lastUsedAt)+'</td>'
          + '<td>'+(k.callCount||0)+'</td>'
          + '<td>'+(k.enabled!==false?'<span class="p4-badge on">启用</span>':'<span class="p4-badge off">已撤销</span>')+'</td>'
          + '<td>'+(k.enabled!==false?'<button class="btn btn-outline" onclick="p4RevokeKey(\''+k.id+'\')">撤销</button>':'<span class="text-muted">—</span>')+'</td>'
          + '</tr>';
      });
      h += '</tbody></table>';
    }

    // Call logs summary (from analytics + webhook logs as recent activity).
    var an = S._p4Analytics;
    h += '<div class="p4-stat-row">';
    h += '  <div class="p4-stat"><div class="p4-stat-num">'+(an?an.customersTotal:'—')+'</div><div class="p4-stat-label">API可见客户数</div></div>';
    h += '  <div class="p4-stat"><div class="p4-stat-num">'+(an?an.activeApiKeys:'—')+'</div><div class="p4-stat-label">有效API Key</div></div>';
    h += '  <div class="p4-stat"><div class="p4-stat-num">'+(an?an.totalApiCalls:'—')+'</div><div class="p4-stat-label">累计API调用</div></div>';
    h += '  <div class="p4-stat"><div class="p4-stat-num">'+(an?an.replyRatePct+'%':'—')+'</div><div class="p4-stat-label">回复率</div></div>';
    h += '</div>';

    // Recent API call logs
    h += '<h3 style="margin:18px 0 8px;font-size:15px">最近调用日志（最近 50 条）</h3>';
    var clog = S.apiCallLogs || [];
    if(!clog.length){
      h += '<div class="p4-empty">暂无 API 调用记录。使用 API Key 调用业务接口后会显示在这里。</div>';
    } else {
      h += '<table class="p4-table"><thead><tr><th>时间</th><th>Key</th><th>端点</th><th>状态</th><th>IP</th><th>耗时</th></tr></thead><tbody>';
      clog.forEach(function(l){
        h += '<tr>'
          + '<td>'+p4Fmt(l.time)+'</td>'
          + '<td>'+esc(l.apiKeyName||'—')+'</td>'
          + '<td class="p4-mono">'+esc(l.endpoint||'')+'</td>'
          + '<td>'+(l.status<400?'<span style="color:#38a169">'+l.status+'</span>':'<span style="color:#e53e3e">'+l.status+'</span>')+'</td>'
          + '<td class="text-muted">'+esc(l.ip||'')+'</td>'
          + '<td>'+(l.durationMs||0)+'ms</td>'
          + '</tr>';
      });
      h += '</tbody></table>';
    }

    return h;
  }

  window.p4CreateKey = function(){
    var h = '';
    h += '<div class="modal-head"><h3>生成新 API Key</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body">';
    h += '<div class="p4-field"><label>用途 / 名称（必填）</label>';
    h += '<input class="form-control" id="p4k_name" placeholder="例如：Zapier 客户同步 / n8n 询盘推送"></div>';
    h += '<div class="text-sm text-muted">Key 仅在创建时完整显示一次，请立即复制保存。</div>';
    h += '</div>';
    h += '<div class="modal-foot">';
    h += '<button class="btn btn-outline" onclick="closeModal()">取消</button>';
    h += '<button class="btn btn-primary" onclick="p4SaveKey()">生成</button>';
    h += '</div>';
    openModal(h, true);
  };

  window.p4SaveKey = async function(){
    var name = document.getElementById('p4k_name').value.trim();
    if(!name){ toast('请填写名称','err'); return; }
    try{
      var res = await p4Api('/admin/api-keys', {method:'POST', body:{name:name}});
      var key = res.data.apiKey;
      closeModal();
      var h = '';
      h += '<div class="modal-head"><h3>✅ API Key 已生成</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
      h += '<div class="modal-body">';
      h += '<div class="p4-warn">⚠️ 此 Key 仅显示一次，请立即复制并妥善保存：</div>';
      h += '<div class="p4-key-box" id="p4k_show">'+esc(key)+'</div>';
      h += '<button class="btn btn-primary" onclick="p4CopyKey(\''+esc(key)+'\')">📋 复制 Key</button>';
      h += '<div class="text-sm text-muted" style="margin-top:10px">调用时在 HTTP Header 中携带：<code>x-api-key: '+esc(key.slice(0,12))+'…</code></div>';
      h += '</div>';
      h += '<div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">我已保存</button></div>';
      openModal(h, true);
      p4Refresh();
    }catch(e){ toast('生成失败：'+e.message,'err'); }
  };

  window.p4CopyKey = function(key){
    if(navigator.clipboard) navigator.clipboard.writeText(key).then(function(){ toast('已复制到剪贴板'); });
    else toast('复制失败，请手动选择复制');
  };

  window.p4RevokeKey = function(id){
    confirmDlg('确定撤销该 API Key 吗？撤销后使用它的系统将立即无法调用。', async function(){
      try{ await p4Api('/admin/api-keys/'+id, {method:'DELETE'}); toast('API Key 已撤销'); p4Refresh(); }
      catch(e){ toast('撤销失败：'+e.message,'err'); }
    });
  };

  // ── Panel 2: Webhooks ─────────────────────────────────────
  var P4_EVENTS = [
    {id:'customer.reply',    label:'客户回复 (customer.reply)'},
    {id:'inquiry.new',       label:'新询盘 (inquiry.new)'},
    {id:'sendtask.completed',label:'发送任务完成 (sendtask.completed)'},
    {id:'followup.due',      label:'跟进到期 (followup.due)'}
  ];

  function p4WebhooksPanel(){
    var whs = S.webhooks || [];
    var logs = S.webhookLogs || [];
    var h = '';
    h += '<div class="flex-between" style="margin-bottom:12px">';
    h += '  <div class="text-sm text-muted">事件发生时，服务器向你的 URL 投递带 HMAC-SHA256 签名的 JSON。</div>';
    h += '  <button class="btn btn-primary" onclick="p4AddWebhook()">➕ 添加Webhook</button>';
    h += '</div>';

    if(!whs.length){
      h += '<div class="p4-empty">还没有 Webhook。添加一个端点，在客户回复 / 新询盘等事件发生时自动推送数据。</div>';
    } else {
      whs.forEach(function(w){
        var badges = (w.events||[]).map(function(e){ return '<span class="p4-ev">'+esc(e)+'</span>'; }).join(' ');
        h += '<div class="p4-wh-card">';
        h += '  <div class="p4-wh-url">'+esc(w.url)+' '+(w.enabled!==false?'<span class="p4-badge on">启用</span>':'<span class="p4-badge off">禁用</span>')+'</div>';
        h += '  <div class="p4-wh-meta">事件：'+(badges||'<span class="text-muted">未订阅</span>')+'</div>';
        h += '  <div class="p4-wh-meta">Secret：<code class="p4-mono">'+esc(w.secret)+'</code> · 最近触发：'+p4Fmt(w.lastTriggeredAt)+'</div>';
        h += '  <div class="p4-wh-actions">';
        h += '    <button class="btn btn-outline" onclick="p4TestWebhook(\''+w.id+'\')">🧪 测试</button>';
        h += '    <button class="btn btn-outline" onclick="p4ToggleWebhook(\''+w.id+'\')">'+(w.enabled!==false?'禁用':'启用')+'</button>';
        h += '    <button class="btn btn-outline" onclick="p4DeleteWebhook(\''+w.id+'\')">删除</button>';
        h += '  </div>';
        h += '</div>';
      });
    }

    h += '<h3 style="margin:18px 0 8px;font-size:15px">投递日志（最近 50 条）</h3>';
    if(!logs.length){
      h += '<div class="p4-empty">暂无 Webhook 投递记录。</div>';
    } else {
      h += '<table class="p4-table"><thead><tr><th>时间</th><th>事件</th><th>URL</th><th>状态</th><th>耗时</th></tr></thead><tbody>';
      logs.forEach(function(l){
        h += '<tr>'
          + '<td>'+p4Fmt(l.time)+'</td>'
          + '<td>'+esc(l.event)+'</td>'
          + '<td class="p4-mono" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">'+esc(l.url)+'</td>'
          + '<td>'+(l.ok?'<span style="color:#38a169">'+l.statusCode+'</span>':(l.statusCode||'ERR')+' <span class="text-muted">'+esc(l.error||'')+'</span>')+'</td>'
          + '<td>'+(l.durationMs||0)+'ms</td>'
          + '</tr>';
      });
      h += '</tbody></table>';
    }
    return h;
  }

  window.p4AddWebhook = function(){
    var checks = P4_EVENTS.map(function(e){
      return '<label class="p4-check"><input type="checkbox" value="'+e.id+'"> '+e.label+'</label>';
    }).join('');
    var h = '';
    h += '<div class="modal-head"><h3>添加 Webhook</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body">';
    h += '<div class="p4-field"><label>接收 URL（POST）</label>';
    h += '<input class="form-control" id="p4w_url" placeholder="https://example.com/webhook"></div>';
    h += '<div class="p4-field"><label>订阅事件（可多选）</label><div class="p4-checks">'+checks+'</div></div>';
    h += '<div class="text-sm text-muted">Secret 由系统自动生成，用于校验签名。</div>';
    h += '</div>';
    h += '<div class="modal-foot">';
    h += '<button class="btn btn-outline" onclick="closeModal()">取消</button>';
    h += '<button class="btn btn-primary" onclick="p4SaveWebhook()">创建</button>';
    h += '</div>';
    openModal(h, true);
  };

  window.p4SaveWebhook = async function(){
    var url = document.getElementById('p4w_url').value.trim();
    var evs = [];
    document.querySelectorAll('.p4-check input:checked').forEach(function(cb){ evs.push(cb.value); });
    if(!url){ toast('请填写接收 URL','err'); return; }
    if(!evs.length){ toast('请至少选择一个事件','err'); return; }
    try{
      await p4Api('/admin/webhooks', {method:'POST', body:{url:url, events:evs}});
      closeModal(); toast('Webhook 已创建'); p4Refresh();
    }catch(e){ toast('创建失败：'+e.message,'err'); }
  };

  window.p4TestWebhook = async function(id){
    var w = (S.webhooks||[]).find(function(x){ return x.id===id; });
    if(!w) return;
    try{
      await p4Api('/webhooks/trigger', {method:'POST', body:{
        event: (w.events && w.events[0]) || 'customer.reply',
        payload: { test: true, message: 'This is a test webhook delivery from KaiLionCrafts workbench' }
      }});
      toast('测试投递已发送，请查看日志');
      setTimeout(function(){ p4Refresh(); }, 800);
    }catch(e){ toast('测试失败：'+e.message,'err'); }
  };

  window.p4ToggleWebhook = async function(id){
    var w = (S.webhooks||[]).find(function(x){ return x.id===id; });
    if(!w) return;
    // Toggle via delete+recreate is overkill; the backend exposes no PATCH,
    // so we flip locally and persist through the test trigger log. To keep it
    // simple and reliable, we re-POST the same webhook with toggled enabled.
    try{
      // Delete the old one and recreate with toggled enabled state.
      await p4Api('/admin/webhooks/'+id, {method:'DELETE'});
      await p4Api('/admin/webhooks', {method:'POST', body:{url:w.url, events:w.events, enabled: w.enabled!==false ? false : true}});
      toast('已'+(w.enabled!==false?'禁用':'启用'));
      p4Refresh();
    }catch(e){ toast('操作失败：'+e.message,'err'); }
  };

  window.p4DeleteWebhook = function(id){
    confirmDlg('确定删除该 Webhook 吗？删除后将不再推送事件。', async function(){
      try{ await p4Api('/admin/webhooks/'+id, {method:'DELETE'}); toast('Webhook 已删除'); p4Refresh(); }
      catch(e){ toast('删除失败：'+e.message,'err'); }
    });
  };

  // ── Panel 3: API Docs ──────────────────────────────────────
  function p4DocsPanel(){
    var h = '';
    h += '<div class="p4-doc-box">';
    h += '  <h3>🔐 认证方式</h3>';
    h += '  <p>所有业务接口（除 /health 外）必须在 HTTP Header 携带 <code>x-api-key</code>。管理接口使用 <code>x-admin-token</code>。</p>';
    h += '</div>';

    h += '<div class="p4-doc-box">';
    h += '  <h3>📡 业务接口（需 x-api-key）</h3>';
    h += '  <table class="p4-doc-table"><thead><tr><th>方法</th><th>路径</th><th>说明</th></tr></thead><tbody>';
    h += row('GET','/api/v1/customers','客户列表，支持 ?category=&status=&page=&limit=&search=')
      + row('GET','/api/v1/customers/:id','客户详情')
      + row('POST','/api/v1/customers','新增客户（JSON body）')
      + row('GET','/api/v1/drafts','开发信草稿列表')
      + row('GET','/api/v1/send-tasks','今日发送任务')
      + row('GET','/api/v1/analytics','复盘统计（客户数/已发/回复率等）')
      + row('GET','/api/v1/health','健康检查（无需认证）');
    h += '</tbody></table>';
    h += '</div>';

    h += '<div class="p4-doc-box">';
    h += '  <h3>🧪 curl 示例</h3>';
    h += '  <pre class="p4-code"># 客户列表\ncurl -H "x-api-key: kl_xxxxx" http://localhost:8080/api/v1/customers?limit=20\n\n# 新增客户\ncurl -X POST http://localhost:8080/api/v1/customers \\\n  -H "x-api-key: kl_xxxxx" -H "Content-Type: application/json" \\\n  -d \'{"company":"Acme GmbH","country":"DE","email":"buyer@acme.de"}\'\n\n# 健康检查\ncurl http://localhost:8080/api/v1/health</pre>';
    h += '</div>';

    h += '<div class="p4-doc-box">';
    h += '  <h3>🪝 Webhook 签名校验</h3>';
    h += '  <p>每个 Webhook 请求的 Header 包含 <code>X-Webhook-Signature</code>。用你的 Secret 计算：</p>';
    h += '  <pre class="p4-code">signature = HMAC_SHA256(secret, timestamp + "." + JSON.stringify(payload))</pre>';
    h += '  <p class="text-sm text-muted">请求体为 JSON：{ event, timestamp, payload, signature }。校验通过后再处理事件，防止伪造请求。</p>';
    h += '</div>';
    return h;

    function row(m,p,d){ return '<tr><td><span class="p4-method">'+m+'</span></td><td><code>'+p+'</code></td><td>'+d+'</td></tr>'; }
  }

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'apiIntegration'){ window.viewApiIntegration(document.getElementById('mainContent')); return; }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p4- prefixed, responsive) ─────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p4-empty{padding:36px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.p4-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid #e2e8f0;}'
    + '.p4-tab{padding:8px 18px;cursor:pointer;font-size:14px;color:#4a5568;border-bottom:2px solid transparent;margin-bottom:-2px;}'
    + '.p4-tab.on{color:#2b6cb0;border-bottom-color:#2b6cb0;font-weight:600;}'
    + '.p4-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:16px;}'
    + '.p4-table th,.p4-table td{padding:9px 12px;border-bottom:1px solid #edf2f7;text-align:left;}'
    + '.p4-table th{background:#f7fafc;color:#4a5568;}'
    + '.p4-badge{font-size:11px;color:#fff;padding:2px 8px;border-radius:10px;}'
    + '.p4-badge.on{background:#38a169;}.p4-badge.off{background:#a0aec0;}'
    + '.p4-mono{font-family:Menlo,monospace;font-size:12px;background:#edf2f7;padding:1px 5px;border-radius:4px;}'
    + '.p4-stat-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;}'
    + '.p4-stat{flex:1;min-width:120px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.p4-stat-num{font-size:24px;font-weight:700;color:#2b6cb0;}'
    + '.p4-stat-label{font-size:12px;color:#718096;margin-top:4px;}'
    + '.p4-field{margin-bottom:12px;}'
    + '.p4-field label{display:block;font-size:12px;color:#4a5568;margin-bottom:4px;font-weight:600;}'
    + '.p4-checks{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:4px;}'
    + '.p4-check{font-size:13px;color:#4a5568;display:flex;align-items:center;gap:4px;}'
    + '.p4-warn{background:#fffbeb;border:1px solid #fbd38d;color:#975a16;padding:10px 14px;border-radius:8px;margin-bottom:10px;font-size:13px;}'
    + '.p4-key-box{background:#1a202c;color:#68d391;font-family:Menlo,monospace;font-size:13px;padding:12px;border-radius:8px;word-break:break-all;margin-bottom:10px;}'
    + '.p4-wh-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:10px;}'
    + '.p4-wh-url{font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;}'
    + '.p4-wh-meta{font-size:12px;color:#718096;margin-top:5px;}'
    + '.p4-ev{display:inline-block;background:#ebf8ff;color:#2b6cb0;font-size:11px;padding:2px 8px;border-radius:10px;margin-right:4px;}'
    + '.p4-wh-actions{margin-top:10px;display:flex;gap:8px;}'
    + '.p4-doc-box{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin-bottom:16px;}'
    + '.p4-doc-box h3{margin:0 0 10px;font-size:15px;}'
    + '.p4-doc-table{width:100%;border-collapse:collapse;font-size:13px;}'
    + '.p4-doc-table td{padding:7px 10px;border-top:1px solid #edf2f7;vertical-align:top;}'
    + '.p4-method{display:inline-block;min-width:52px;font-weight:700;font-size:11px;color:#fff;background:#3182ce;padding:2px 6px;border-radius:4px;text-align:center;}'
    + '.p4-code{background:#1a202c;color:#e2e8f0;padding:12px;border-radius:8px;font-family:Menlo,monospace;font-size:12px;overflow-x:auto;white-space:pre;}'
    + '@media (max-width:768px){ .p4-stat-row{flex-direction:column;} .p4-wh-actions{flex-wrap:wrap;} }'
    ;
  document.head.appendChild(style);
})();
