/* ============================================================
 * P7 Phase7 Module: Advanced Integration
 * ----------------------------------------------------------------
 * Feature 28: MCP Server (basic HTTP version) — config panel,
 *             tool list display, connection test, call logs and
 *             external (Cursor/Claude) wiring instructions.
 * Feature 35: Multi-model orchestration (simplified) — a
 *             task-type -> model mapping plus a unified caller
 *             window.p7CallAIByTask(taskType, messages, opts).
 *
 * HARD RULE: This module NEVER sends any email / WhatsApp. MCP
 * draft tool only produces templates. All CSS classes use the
 * p7- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init (already wired into app.js load/persist) ──
  if(typeof S.p7McpConfig !== 'object' || S.p7McpConfig === null){
    S.p7McpConfig = { enabled:false, port:8765, apiKey:'', logs:[] };
  }
  if(typeof S.p7McpConfig.enabled !== 'boolean') S.p7McpConfig.enabled = false;
  if(!S.p7McpConfig.port) S.p7McpConfig.port = 8765;
  if(!Array.isArray(S.p7McpConfig.logs)) S.p7McpConfig.logs = [];

  if(typeof S.p7ModelRouting !== 'object' || S.p7ModelRouting === null){
    S.p7ModelRouting = { research:'deepseek-r1:7b', writing:'gpt-5.6-terra', summary:'glm-4-flash', enabled:true };
  }
  if(typeof S.p7ModelRouting.enabled !== 'boolean') S.p7ModelRouting.enabled = true;

  // ── Nav injection ──────────────────────────────────────────
  NAV.push({
    key: 'mcpServer',
    icon: '🔌',
    label: 'MCP Server',
    title: 'MCP Server 配置与连接测试',
    crumb: 'HTTP基础版 · 外部AI工具接入工作台'
  });
  NAV.push({
    key: 'modelOrchestration',
    icon: '🧠',
    label: '模型编排',
    title: '多模型任务路由编排',
    crumb: 'research / writing / summary → 模型映射'
  });

  // ── Local constants ────────────────────────────────────────
  // Catalogue of models that callAI() can route to.
  var P7_MODELS = [
    { id:'gpt-5.6-terra',  label:'GPT-5.6 Terra',  tag:'云端', desc:'生成能力强，适合写作/营销文案' },
    { id:'glm-4-flash',    label:'GLM-4 Flash',   tag:'云端', desc:'快速便宜，适合总结/分类' },
    { id:'deepseek-r1:7b', label:'DeepSeek R1 7B',tag:'本地', desc:'推理模型，适合深度分析' },
    { id:'qwen3.5:9b',     label:'Qwen3.5 9B',    tag:'本地', desc:'通用均衡' },
    { id:'qwen2.5:7b',     label:'Qwen2.5 7B',    tag:'本地', desc:'轻量快速' }
  ];

  // Task types and their default model mapping.
  var P7_TASK_TYPES = [
    { key:'research', label:'研究/分析任务', icon:'🔍', desc:'客户背调、市场分析、深度推理', defaultModel:'deepseek-r1:7b' },
    { key:'writing',  label:'写作/生成任务', icon:'✍️', desc:'开发信、报价、营销文案',     defaultModel:'gpt-5.6-terra' },
    { key:'summary',  label:'总结/分类任务', icon:'🏷️', desc:'邮件分类、摘要、标签提取',   defaultModel:'glm-4-flash' }
  ];

  // Workbench AI call scenarios mapped to a task type (for the usage guide).
  var P7_USAGE_MAP = [
    { scenario:'开发信生成 / 跟进邮件草稿', taskType:'writing' },
    { scenario:'客户背调 / 公司深度分析',   taskType:'research' },
    { scenario:'收件箱邮件分类 / 意图识别', taskType:'summary' },
    { scenario:'客户分级策略建议',          taskType:'research' },
    { scenario:'摘要提取 / 知识库问答',    taskType:'summary' }
  ];

  // ── Helpers ────────────────────────────────────────────────
  function p7NowISO(){ return new Date().toISOString(); }

  // Generate a random access key for external MCP clients.
  function p7GenKey(){
    var chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    for(var i = 0; i < 32; i++){
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'p7mcp_' + out;
  }

  // Seed an apiKey on first run so external clients have something to use.
  if(!S.p7McpConfig.apiKey) S.p7McpConfig.apiKey = p7GenKey();

  function p7ModelLabel(id){
    for(var i = 0; i < P7_MODELS.length; i++){
      if(P7_MODELS[i].id === id) return P7_MODELS[i].label;
    }
    return id || '—';
  }

  function p7TaskLabel(key){
    for(var i = 0; i < P7_TASK_TYPES.length; i++){
      if(P7_TASK_TYPES[i].key === key) return P7_TASK_TYPES[i].label;
    }
    return key;
  }

  // Pretty-print a JSON-ish object into a <pre> block.
  function p7Pretty(obj){
    try{ return esc(JSON.stringify(obj, null, 2)); }catch(e){ return esc(String(obj)); }
  }

  // ── Feature 35: Unified task-based AI caller ──────────────
  // Other modules should call window.p7CallAIByTask('writing', msgs, opts)
  // instead of callAI() directly. When routing is disabled, it falls back
  // to the default model (or opts.model if explicitly provided).
  window.p7CallAIByTask = function(taskType, messages, opts){
    opts = opts || {};
    var model;
    if(S.p7ModelRouting && S.p7ModelRouting.enabled !== false){
      model = S.p7ModelRouting[taskType] || opts.model || 'gpt-5.6-terra';
    } else {
      model = opts.model || 'gpt-5.6-terra';
    }
    var callOpts = {
      purpose: opts.purpose || ('p7_orch_' + taskType),
      timeout: opts.timeout || 60000,
      temperature: (typeof opts.temperature === 'number') ? opts.temperature : 0.3,
      model: model
    };
    return callAI(messages, callOpts);
  };

  // ── Feature 35: Config actions ────────────────────────────
  window.p7ToggleRouting = function(){
    S.p7ModelRouting.enabled = !S.p7ModelRouting.enabled;
    persist();
    toast(S.p7ModelRouting.enabled ? '✅ 多模型编排已启用' : '⏸ 多模型编排已关闭（全部使用默认模型 gpt-5.6-terra）');
    renderView();
  };

  window.p7SaveModelRouting = function(){
    var map = { research:'p7_route_research', writing:'p7_route_writing', summary:'p7_route_summary' };
    var changed = false;
    for(var key in map){
      if(!map.hasOwnProperty(key)) continue;
      var el = document.getElementById(map[key]);
      if(el && el.value){
        S.p7ModelRouting[key] = el.value;
        changed = true;
      }
    }
    if(!changed){ toast('未读取到配置项', 'err'); return; }
    persist();
    toast('✅ 模型路由配置已保存');
    renderView();
  };

  window.p7ResetRouting = function(){
    S.p7ModelRouting.research = 'deepseek-r1:7b';
    S.p7ModelRouting.writing  = 'gpt-5.6-terra';
    S.p7ModelRouting.summary  = 'glm-4-flash';
    S.p7ModelRouting.enabled  = true;
    persist();
    toast('✅ 已恢复默认模型路由');
    renderView();
  };

  // ── Feature 35: Three-model speed benchmark ────────────────
  // Runs the same simple prompt through the model assigned to each of the
  // three task types, records wall time and output length.
  window.p7RunModelBench = async function(){
    toast('正在依次测试三模型响应速度（约需数十秒）…');
    var prompt = 'Answer in ONE short English sentence (max 30 words): what is OEM manufacturing in the hardware industry?';
    var results = [];
    for(var i = 0; i < P7_TASK_TYPES.length; i++){
      var tt = P7_TASK_TYPES[i];
      var model = S.p7ModelRouting[tt.key] || 'gpt-5.6-terra';
      var t0 = Date.now();
      try{
        var r = await callAI(
          [{ role:'user', content: prompt }],
          { purpose:'p7_bench', timeout:60000, temperature:0.2, model: model }
        );
        var ms = Date.now() - t0;
        results.push({
          taskType: tt.key, taskLabel: tt.label,
          model: model, ms: ms,
          len: r.error ? 0 : (r.content || '').length,
          status: r.error ? '失败' : '成功',
          error: r.error || ''
        });
      }catch(err){
        results.push({
          taskType: tt.key, taskLabel: tt.label,
          model: model, ms: Date.now() - t0, len: 0,
          status: '异常', error: String(err && err.message || err)
        });
      }
    }
    window._p7BenchResults = results;
    window._p7BenchAt = p7NowISO();
    renderView();
    toast('✅ 三模型对比测试完成');
  };

  // ── Feature 28: MCP config actions ────────────────────────
  window.p7ToggleMcp = function(){
    S.p7McpConfig.enabled = !S.p7McpConfig.enabled;
    persist();
    toast(S.p7McpConfig.enabled ? '✅ MCP Server 已启用' : '⏸ MCP Server 已禁用');
    renderView();
  };

  window.p7RegenMcpKey = function(){
    S.p7McpConfig.apiKey = p7GenKey();
    persist();
    toast('✅ 已生成新访问密钥（请复制保存，旧密钥立即失效）');
    renderView();
  };

  window.p7CopyMcpKey = function(){
    var key = S.p7McpConfig.apiKey || '';
    if(!key) return;
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(key).then(function(){ toast('✅ 密钥已复制到剪贴板'); });
      } else {
        window.prompt('请手动复制访问密钥：', key);
      }
    }catch(e){ window.prompt('请手动复制访问密钥：', key); }
  };

  // Test connection: call search_customers through the backend endpoint.
  window.p7TestMcp = async function(){
    toast('正在测试 MCP 连接（调用 search_customers）…');
    var t0 = Date.now();
    var entry = { time: p7NowISO(), tool:'search_customers', status:'pending', ms:0, result:null, error:'' };
    try{
      var resp = await fetch('/api/mcp/call', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ tool:'search_customers', arguments:{ query:'', country:'', status:'' } })
      });
      var j = await resp.json();
      entry.ms = Date.now() - t0;
      entry.status = j.success ? 'ok' : 'fail';
      entry.result = j.result || null;
      entry.error = j.error || '';
      window._p7McpTestResult = j;
    }catch(e){
      entry.ms = Date.now() - t0;
      entry.status = 'error';
      entry.error = String(e && e.message || e);
      window._p7McpTestResult = { success:false, error: entry.error };
    }
    S.p7McpConfig.logs.push(entry);
    if(S.p7McpConfig.logs.length > 50) S.p7McpConfig.logs = S.p7McpConfig.logs.slice(-50);
    persist();
    renderView();
    toast(entry.status === 'ok' ? '✅ MCP 连接成功' : '⚠️ MCP 连接失败，请查看日志', entry.status === 'ok' ? '' : 'err');
  };

  window.p7ClearMcpLogs = function(){
    S.p7McpConfig.logs = [];
    window._p7McpTestResult = null;
    persist();
    toast('已清空本地 MCP 调用日志');
    renderView();
  };

  // Lazily fetch the exposed tool list from the backend, then re-render.
  function p7EnsureMcpTools(){
    if(window._p7McpTools !== undefined || window._p7McpToolsLoading) return;
    window._p7McpToolsLoading = true;
    fetch('/api/mcp/tools')
      .then(function(r){ return r.json(); })
      .then(function(j){
        window._p7McpTools = j.tools || [];
        window._p7McpToolsMeta = j;
      })
      .catch(function(e){
        window._p7McpTools = { error: String(e && e.message || e) };
      })
      .then(function(){
        window._p7McpToolsLoading = false;
        renderView();
      });
  }

  // ── Render: Model Orchestration page ───────────────────────
  function p7RenderOrchPage(root){
    var h = '<div class="p7-page">';

    // Stat strip
    h += '<div class="p7-stats">'
      + '<div class="p7-stat"><div class="p7-stat-num">' + P7_TASK_TYPES.length + '</div><div class="p7-stat-lbl">🧩 任务类型</div></div>'
      + '<div class="p7-stat"><div class="p7-stat-num">' + P7_MODELS.length + '</div><div class="p7-stat-lbl">🤖 可选模型</div></div>'
      + '<div class="p7-stat ' + (S.p7ModelRouting.enabled ? 'p7-ok' : 'p7-off') + '"><div class="p7-stat-num">' + (S.p7ModelRouting.enabled ? '启用' : '关闭') + '</div><div class="p7-stat-lbl">🔀 路由状态</div></div>'
      + '</div>';

    // ── Panel 1: routing config ──
    h += '<div class="p7-panel">';
    h += '<div class="p7-panel-head">🧭 任务类型 → 模型映射'
      + '<label class="p7-switch"><input type="checkbox" ' + (S.p7ModelRouting.enabled ? 'checked' : '') + ' onchange="p7ToggleRouting()"><span class="p7-slider"></span></label>'
      + '</div>';
    h += '<div class="p7-panel-sub">启用后，工作台各模块按任务类型自动选择对应模型；关闭后全部调用默认模型 <b>gpt-5.6-terra</b>。</div>';

    h += '<table class="p7-table"><thead><tr><th>任务类型</th><th>用途说明</th><th>当前模型</th><th>可选模型</th></tr></thead><tbody>';
    P7_TASK_TYPES.forEach(function(tt){
      var cur = S.p7ModelRouting[tt.key] || tt.defaultModel;
      h += '<tr>';
      h += '<td><b>' + tt.icon + ' ' + esc(tt.label) + '</b><div class="p7-mono">' + esc(tt.key) + '</div></td>';
      h += '<td class="p7-dim">' + esc(tt.desc) + '</td>';
      h += '<td><span class="p7-badge">' + esc(p7ModelLabel(cur)) + '</span><div class="p7-mono">' + esc(cur) + '</div></td>';
      h += '<td><select class="p7-input p7-sel" id="p7_route_' + tt.key + '">';
      P7_MODELS.forEach(function(m){
        h += '<option value="' + esc(m.id) + '"' + (cur === m.id ? ' selected' : '') + '>' + esc(m.label) + '（' + m.tag + '）</option>';
      });
      h += '</select></td>';
      h += '</tr>';
    });
    h += '</tbody></table>';

    h += '<div class="p7-actions">'
      + '<button class="btn btn-sm btn-primary" onclick="p7SaveModelRouting()">💾 保存路由配置</button>'
      + '<button class="btn btn-sm btn-outline" onclick="p7ResetRouting()">↺ 恢复默认</button>'
      + '</div>';
    h += '</div>';

    // ── Panel 2: benchmark ──
    h += '<div class="p7-panel">';
    h += '<div class="p7-panel-head">⏱ 模型速度对比测试'
      + '<button class="btn btn-sm btn-primary" onclick="p7RunModelBench()">🚀 测试三模型速度</button>'
      + '</div>';
    h += '<div class="p7-panel-sub">用同一个简单 prompt 依次调用「研究 / 写作 / 总结」当前配置的模型，记录响应时间与结果长度。仅测试，不写入业务数据。</div>';

    var bench = window._p7BenchResults;
    if(bench && bench.length){
      h += '<table class="p7-table"><thead><tr><th>任务类型</th><th>调用模型</th><th>响应时间</th><th>结果长度</th><th>状态</th></tr></thead><tbody>';
      bench.forEach(function(r){
        h += '<tr>'
          + '<td>' + esc(r.taskLabel) + '</td>'
          + '<td><span class="p7-mono">' + esc(r.model) + '</span></td>'
          + '<td><b>' + r.ms + ' ms</b></td>'
          + '<td>' + r.len + ' 字符</td>'
          + '<td>' + (r.status === '成功' ? '<span class="p7-badge p7-b-ok">成功</span>' : '<span class="p7-badge p7-b-err">' + esc(r.status) + '</span>') + '</td>'
          + '</tr>';
      });
      h += '</tbody></table>';
      h += '<div class="p7-panel-sub">测试时间：' + esc(window._p7BenchAt || '') + '</div>';
    } else {
      h += '<div class="p7-empty">尚未进行测试。点击右上角按钮开始。</div>';
    }
    h += '</div>';

    // ── Panel 3: usage guide ──
    h += '<div class="p7-panel">';
    h += '<div class="p7-panel-head">📖 使用说明</div>';
    h += '<ul class="p7-list">';
    h += '<li><b>统一调用函数：</b>其他模块未来应调用 <code>window.p7CallAIByTask(taskType, messages, opts)</code>，系统会按上表自动选择模型，无需手写 model 参数。</li>';
    h += '<li><b>手动覆盖：</b>在具体生成场景中仍可通过 opts.model 临时指定模型，优先级高于路由表。</li>';
    h += '<li><b>关闭路由：</b>关闭顶部开关后，所有调用统一回落至默认模型 <code>gpt-5.6-terra</code>，便于排障。</li>';
    h += '</ul>';
    h += '<table class="p7-table"><thead><tr><th>工作台场景</th><th>映射任务类型</th></tr></thead><tbody>';
    P7_USAGE_MAP.forEach(function(u){
      h += '<tr><td>' + esc(u.scenario) + '</td><td><span class="p7-badge">' + esc(p7TaskLabel(u.taskType)) + '</span></td></tr>';
    });
    h += '</tbody></table>';
    h += '</div>';

    h += '</div>';
    root.innerHTML = h;
  }

  // ── Render: MCP Server page ───────────────────────────────
  function p7RenderMcpPage(root){
    p7EnsureMcpTools();
    var cfg = S.p7McpConfig;
    var h = '<div class="p7-page">';

    // Stat strip
    h += '<div class="p7-stats">'
      + '<div class="p7-stat ' + (cfg.enabled ? 'p7-ok' : 'p7-off') + '"><div class="p7-stat-num">' + (cfg.enabled ? '启用' : '禁用') + '</div><div class="p7-stat-lbl">🔌 MCP Server</div></div>'
      + '<div class="p7-stat"><div class="p7-stat-num">8080</div><div class="p7-stat-lbl">🌐 工作台端口</div></div>'
      + '<div class="p7-stat"><div class="p7-stat-num">' + (cfg.logs || []).length + '</div><div class="p7-stat-lbl">📜 本地调用日志</div></div>'
      + '</div>';

    // ── Panel 1: config ──
    h += '<div class="p7-panel">';
    h += '<div class="p7-panel-head">⚙️ 服务器配置'
      + '<label class="p7-switch"><input type="checkbox" ' + (cfg.enabled ? 'checked' : '') + ' onchange="p7ToggleMcp()"><span class="p7-slider"></span></label>'
      + '</div>';

    h += '<div class="p7-form-grid">';
    h += '<div class="p7-form-item"><label>端口配置</label>'
      + '<input class="p7-input" type="number" value="' + esc(String(cfg.port)) + '" disabled />'
      + '<div class="p7-hint">提示：实际 MCP HTTP 端点运行在工作台服务器上，端口即工作台端口 <b>8080</b>。此处端口仅作记录展示。</div>'
      + '</div>';
    h += '<div class="p7-form-item"><label>服务器地址（外部连接用）</label>'
      + '<input class="p7-input" readonly value="http://localhost:8080/api/mcp" />'
      + '</div>';
    h += '<div class="p7-form-item"><label>访问密钥（外部客户端鉴权）</label>'
      + '<div class="p7-key-row">'
      + '<input class="p7-input p7-key" readonly value="' + esc(cfg.apiKey || '') + '" />'
      + '<button class="btn btn-sm btn-outline" onclick="p7CopyMcpKey()">📋 复制</button>'
      + '<button class="btn btn-sm btn-outline" onclick="p7RegenMcpKey()">🔄 重新生成</button>'
      + '</div>'
      + '<div class="p7-hint">请妥善保管。外部客户端连接时需在请求头携带此密钥。</div>'
      + '</div>';
    h += '</div>';
    h += '</div>';

    // ── Panel 2: tools list ──
    h += '<div class="p7-panel">';
    h += '<div class="p7-panel-head">🧰 暴露的工具列表 <small style="font-weight:400;color:#718096">（来自 GET /api/mcp/tools）</small></div>';
    var tools = window._p7McpTools;
    if(tools && tools.error){
      h += '<div class="p7-empty">工具列表加载失败：' + esc(tools.error) + '<br>请确认工作台后端已启动。</div>';
    } else if(!tools){
      h += '<div class="p7-empty">正在从后端加载工具列表…</div>';
    } else if(!tools.length){
      h += '<div class="p7-empty">后端未返回任何工具。</div>';
    } else {
      h += '<div class="p7-tool-list">';
      tools.forEach(function(t){
        h += '<div class="p7-tool-card">';
        h += '<div class="p7-tool-name">🛠 <code>' + esc(t.name) + '</code></div>';
        h += '<div class="p7-tool-desc">' + esc(t.description || '') + '</div>';
        var props = (t.inputSchema && t.inputSchema.properties) || {};
        var required = (t.inputSchema && t.inputSchema.required) || [];
        var propKeys = Object.keys(props);
        if(propKeys.length){
          h += '<div class="p7-params">';
          propKeys.forEach(function(pk){
            h += '<span class="p7-param">' + esc(pk) + ' <i>:' + esc(props[pk].type || 'any') + '</i>'
              + (required.indexOf(pk) >= 0 ? ' <em>*</em>' : '') + '</span>';
          });
          h += '</div>';
        }
        h += '</div>';
      });
      h += '</div>';
    }
    h += '</div>';

    // ── Panel 3: connection test ──
    h += '<div class="p7-panel">';
    h += '<div class="p7-panel-head">🧪 连接测试'
      + '<button class="btn btn-sm btn-primary" onclick="p7TestMcp()">▶ 测试 MCP 连接</button>'
      + '</div>';
    h += '<div class="p7-panel-sub">将通过 <code>POST /api/mcp/call</code> 调用 <code>search_customers</code> 工具（空条件，返回客户总数），验证后端 MCP 端点是否正常。</div>';
    var tr = window._p7McpTestResult;
    if(tr){
      if(tr.success){
        h += '<div class="p7-result p7-ok-box">✅ 连接成功</div>';
        h += '<pre class="p7-pre">' + p7Pretty(tr.result) + '</pre>';
      } else {
        h += '<div class="p7-result p7-err-box">❌ 连接失败：' + esc(tr.error || '未知错误') + '</div>';
      }
    } else {
      h += '<div class="p7-empty">尚未测试。点击右上角按钮发起一次连接测试。</div>';
    }
    h += '</div>';

    // ── Panel 4: local logs ──
    h += '<div class="p7-panel">';
    h += '<div class="p7-panel-head">📜 连接日志（本页测试记录，最近50条）'
      + '<button class="btn btn-sm btn-outline" onclick="p7ClearMcpLogs()">🗑 清空</button>'
      + '</div>';
    var logs = (cfg.logs || []).slice().reverse();
    if(!logs.length){
      h += '<div class="p7-empty">暂无调用日志。发起一次连接测试后会在此显示。</div>';
    } else {
      h += '<table class="p7-table"><thead><tr><th>时间</th><th>工具</th><th>耗时</th><th>状态</th></tr></thead><tbody>';
      logs.forEach(function(l){
        var stBadge = l.status === 'ok'
          ? '<span class="p7-badge p7-b-ok">成功</span>'
          : '<span class="p7-badge p7-b-err">' + esc(l.status) + '</span>';
        h += '<tr>'
          + '<td class="p7-mono">' + esc((l.time || '').replace('T', ' ').slice(0, 19)) + '</td>'
          + '<td><code>' + esc(l.tool || '') + '</code></td>'
          + '<td>' + (l.ms ? l.ms + ' ms' : '—') + '</td>'
          + '<td>' + stBadge + '</td>'
          + '</tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div>';

    // ── Panel 5: external wiring instructions ──
    h += '<div class="p7-panel">';
    h += '<div class="p7-panel-head">🔗 外部接入说明（Cursor / Claude 等 MCP 客户端）</div>';
    h += '<ul class="p7-list">';
    h += '<li>在 Cursor / Claude Desktop 等支持 MCP 的客户端中，新增一个 <b>HTTP 类型</b> 的 MCP server。</li>';
    h += '<li>URL 填写：<code>http://localhost:8080/api/mcp</code></li>';
    h += '<li>在请求头 <code>Authorization: Bearer</code> 中填入上方访问密钥。</li>';
    h += '<li><b>注意：</b>本实现为 HTTP 基础版，<u>非标准 stdio MCP</u>，仅适用于支持 HTTP MCP 传输的客户端。</li>';
    h += '</ul>';
    var example = {
      mcpServers: {
        'kailion-workbench': {
          type: 'http',
          url: 'http://localhost:8080/api/mcp',
          headers: { Authorization: 'Bearer ' + (cfg.apiKey || '<YOUR_API_KEY>') }
        }
      }
    };
    h += '<div class="p7-panel-sub">参考配置（mcp.json / claude_desktop_config.json）：</div>';
    h += '<pre class="p7-pre">' + p7Pretty(example) + '</pre>';
    h += '</div>';

    h += '</div>';
    root.innerHTML = h;
  }

  // ── renderView interception ───────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'mcpServer'){
      p7RenderMcpPage(document.getElementById('mainContent'));
      return;
    }
    if(currentView === 'modelOrchestration'){
      p7RenderOrchPage(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p7- prefixed, responsive) ─────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p7-page{padding:4px;}'
    + '.p7-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;}'
    + '.p7-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.p7-stat-num{font-size:24px;font-weight:700;color:#2d3748;}'
    + '.p7-stat-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    + '.p7-stat.p7-ok .p7-stat-num{color:#38a169;}'
    + '.p7-stat.p7-off .p7-stat-num{color:#a0aec0;}'
    + '.p7-panel{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px;}'
    + '.p7-panel-head{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.p7-panel-sub{font-size:12px;color:#718096;margin:0 0 10px;line-height:1.6;}'
    + '.p7-input{width:100%;padding:6px 8px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;box-sizing:border-box;background:#fff;}'
    + '.p7-input[disabled]{background:#edf2f7;color:#718096;}'
    + '.p7-sel{width:auto !important;min-width:180px;}'
    + '.p7-form-grid{display:grid;grid-template-columns:1fr;gap:12px;}'
    + '.p7-form-item label{display:block;font-size:12px;color:#4a5568;font-weight:600;margin-bottom:4px;}'
    + '.p7-hint{font-size:11px;color:#a0aec0;margin-top:4px;line-height:1.5;}'
    + '.p7-key-row{display:flex;gap:6px;align-items:center;}'
    + '.p7-key{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#2d3748;background:#f7fafc;}'
    // Toggle switch
    + '.p7-switch{position:relative;display:inline-block;width:40px;height:22px;flex:0 0 auto;}'
    + '.p7-switch input{opacity:0;width:0;height:0;}'
    + '.p7-slider{position:absolute;cursor:pointer;inset:0;background:#cbd5e0;border-radius:22px;transition:.2s;}'
    + '.p7-slider:before{content:"";position:absolute;height:16px;width:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;}'
    + '.p7-switch input:checked + .p7-slider{background:#38a169;}'
    + '.p7-switch input:checked + .p7-slider:before{transform:translateX(18px);}'
    // Tables
    + '.p7-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:13px;margin-bottom:10px;}'
    + '.p7-table th{background:#f7fafc;text-align:left;padding:8px 10px;font-size:12px;color:#718096;border-bottom:1px solid #e2e8f0;}'
    + '.p7-table td{padding:8px 10px;border-bottom:1px solid #edf2f7;vertical-align:middle;}'
    + '.p7-dim{color:#718096;font-size:12px;}'
    + '.p7-mono{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#a0aec0;}'
    + '.p7-badge{display:inline-block;font-size:11px;padding:2px 10px;border-radius:10px;font-weight:600;background:#edf2f7;color:#4a5568;}'
    + '.p7-badge.p7-b-ok{background:#c6f6d5;color:#22543d;}'
    + '.p7-badge.p7-b-err{background:#fed7d7;color:#742a2a;}'
    + '.p7-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}'
    // Tools cards
    + '.p7-tool-list{display:grid;grid-template-columns:1fr 1fr;gap:10px;}'
    + '.p7-tool-card{border:1px solid #edf2f7;border-radius:8px;padding:10px;background:#fafcff;}'
    + '.p7-tool-name{font-size:13px;font-weight:700;color:#2d3748;margin-bottom:4px;}'
    + '.p7-tool-desc{font-size:12px;color:#4a5568;line-height:1.5;margin-bottom:6px;}'
    + '.p7-params{display:flex;flex-wrap:wrap;gap:4px;}'
    + '.p7-param{font-size:11px;background:#edf2f7;color:#4a5568;padding:2px 8px;border-radius:10px;}'
    + '.p7-param i{color:#718096;font-style:normal;}'
    + '.p7-param em{color:#c05621;font-style:normal;font-weight:700;}'
    // Result / pre
    + '.p7-pre{background:#1a202c;color:#e2e8f0;padding:10px;border-radius:8px;font-size:12px;overflow:auto;max-height:280px;margin:8px 0;white-space:pre-wrap;word-break:break-all;}'
    + '.p7-result{padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;margin:6px 0;}'
    + '.p7-ok-box{background:#c6f6d5;color:#22543d;}'
    + '.p7-err-box{background:#fed7d7;color:#742a2a;}'
    + '.p7-empty{padding:28px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;font-size:13px;}'
    + '.p7-list{margin:6px 0 10px;padding-left:20px;font-size:13px;color:#4a5568;line-height:1.8;}'
    + '.p7-list code, .p7-tool-name code, td code{background:#edf2f7;padding:1px 5px;border-radius:4px;font-size:12px;}'
    // Responsive
    + '@media (max-width:768px){'
    + '  .p7-stats{grid-template-columns:1fr;}'
    + '  .p7-tool-list{grid-template-columns:1fr;}'
    + '  .p7-key-row{flex-direction:column;align-items:stretch;}'
    + '  .p7-table{display:block;overflow-x:auto;}'
    + '  .p7-actions{flex-direction:column;align-items:stretch;}'
    + '  .p7-sel{width:100% !important;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
