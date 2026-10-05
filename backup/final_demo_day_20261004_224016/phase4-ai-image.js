/* ============================================================
 * P4 Phase4: AI Image Personalization (视觉化开发信)
 * ----------------------------------------------------------------
 * - Pure frontend IIFE module, loaded AFTER app.js.
 * - Generates personalized outbound images: company-tailored headers,
 *   product lifestyle shots, holiday greetings. Images are saved to
 *   S.aiImageHistory (already registered in persist()) and can be
 *   previewed, downloaded, copied as <img> HTML, or inserted into the
 *   open draft editor (#dr_body).
 * - Model chain (graceful, NEVER crashes):
 *     1) POST /api/ai/generate            (backend route, if present)
 *     2) callAIImage() -> S.apis cogview   (existing frontend caller)
 *     3) Ollama local flux2-klein         (127.0.0.1:11434 fallback)
 * - HARD RULE: this module NEVER sends email. It only drafts images
 *   and HTML snippets for the user to paste and send manually.
 * - All new CSS classes use the p4- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init (S.aiImageHistory is already persisted by app.js) ──
  if(!S.aiImageHistory) S.aiImageHistory = [];

  // ── Static dictionaries ────────────────────────────────────────
  // Category ids mirror the global CAT_DEFS / P2 dictionary.
  var P4_CATS = [
    {id:'outdoor_knives',        label:'户外刀 Outdoor Knives',        en:'outdoor/camping/hunting knives',   icon:'🔪'},
    {id:'kitchen_knives',        label:'厨房刀 Kitchen Knives',         en:'kitchen chef knives and knife sets', icon:'🔪'},
    {id:'professional_scissors', label:'剪刀 Scissors/Shears',         en:'professional kitchen scissors and shears', icon:'✂️'},
    {id:'kitchen_accessories',   label:'厨房用品 Kitchen Accessories', en:'kitchen utensils and gadgets',     icon:'🍳'}
  ];

  var P4_HOLIDAYS = [
    {id:'christmas',      label:'🎄 Christmas',        en:'warm Christmas greetings'},
    {id:'thanksgiving',   label:'🦃 Thanksgiving',     en:'Thanksgiving appreciation message'},
    {id:'newyear',        label:'🎆 New Year',         en:'happy new year wishes'},
    {id:'chinesenewyear', label:'🏮 Chinese New Year', en:'Chinese New Year blessing'}
  ];

  // Map UI aspect ratios to CogView supported pixel sizes.
  var P4_SIZES = [
    {id:'square',    label:'1:1 方形',     px:'1024x1024'},
    {id:'landscape', label:'16:9 横版',    px:'1792x1024'},
    {id:'portrait',  label:'9:16 竖版',    px:'1024x1792'}
  ];

  // ── Nav injection ────────────────────────────────────────────
  NAV.push({key:'aiImageLibrary', icon:'🖼️', label:'AI图片库', title:'AI个性化图片库', crumb:'生图历史 · 重复使用 · 一键插入开发信'});

  // ── Local helpers ────────────────────────────────────────────
  function p4FmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    var m = String(d.getMonth()+1).padStart(2,'0');
    var day = String(d.getDate()).padStart(2,'0');
    return d.getFullYear()+'-'+m+'-'+day;
  }

  function p4SizeLabel(px){
    for(var i=0;i<P4_SIZES.length;i++) if(P4_SIZES[i].px===px) return P4_SIZES[i].label;
    return px || '—';
  }

  function p4CatMeta(catId){
    for(var i=0;i<P4_CATS.length;i++) if(P4_CATS[i].id===catId) return P4_CATS[i];
    return null;
  }

  function p4HolidayLabel(id){
    for(var i=0;i<P4_HOLIDAYS.length;i++) if(P4_HOLIDAYS[i].id===id) return P4_HOLIDAYS[i].label;
    return id || '';
  }

  // Build an <img> src string from a stored record (URL or base64).
  function p4ImgSrc(rec){
    if(rec.imageUrl) return rec.imageUrl;
    if(rec.imageB64) return 'data:image/png;base64,'+rec.imageB64;
    return '';
  }

  // Pull selling points for a category from the global CAT_DEFS
  // (fallbackKnowledge) without requiring an async API round-trip.
  function p4CatKnowledge(catId){
    var meta = p4CatMeta(catId);
    var en = meta ? meta.en : 'cutlery products';
    var sp = [];
    var summary = '';
    try{
      if(typeof CAT_DEFS !== 'undefined'){
        for(var i=0;i<CAT_DEFS.length;i++){
          if(CAT_DEFS[i].id !== catId) continue;
          var fb = CAT_DEFS[i].fallbackKnowledge || {};
          sp = fb.sellingPoints || [];
          summary = fb.summary || '';
          break;
        }
      }
    }catch(e){ /* CAT_DEFS not ready yet */ }
    // If the async cache populated richer knowledge, merge it in.
    try{
      if(window._catKnowledgeCache && window._catKnowledgeCache[catId]){
        var k = window._catKnowledgeCache[catId];
        if(k.sellingPoints && k.sellingPoints.length) sp = k.sellingPoints;
        if(k.summary) summary = k.summary;
      }
    }catch(e){}
    return { en:en, sellingPoints:sp, summary:summary };
  }

  // Compose a default prompt based on the active generator tab.
  function p4BuildPrompt(){
    var tab = window._p4Tab || 'company';
    var out = '';
    if(tab === 'company'){
      var company = (document.getElementById('p4_company') || {}).value || 'your customer';
      company = company.trim() || 'your customer';
      out = 'A clean professional B2B outbound email banner image for KaiLionCrafts, a Yangjiang (China) cutlery manufacturer. '
        + 'Warm friendly greeting typography saying "Dear '+company+', here is our new product collection". '
        + 'Subtle kitchen knife and scissors product silhouettes in the background, soft studio lighting, '
        + 'corporate trustworthy style, plenty of clean negative space, high resolution, no fake logos. '
        + 'Do not invent certifications or numbers.';
    } else if(tab === 'product'){
      var catId = (document.getElementById('p4_cat') || {}).value || 'kitchen_knives';
      var k = p4CatKnowledge(catId);
      var sp = k.sellingPoints.slice(0,2).join('; ');
      out = 'Professional commercial product photography of '+k.en+', made in Yangjiang China, '
        + 'in a realistic usage scene (modern bright kitchen or outdoor camping table). '
        + 'Key quality cues: '+sp+'. '
        + 'Soft natural lighting, shallow depth of field, clean background, OEM/ODM private-label ready, '
        + 'export-trade catalog style, high detail, 4k. Do not invent brand logos or certifications.';
    } else if(tab === 'holiday'){
      var hid = (document.getElementById('p4_holiday') || {}).value || 'christmas';
      var hlabel = p4HolidayLabel(hid);
      out = 'A warm professional B2B holiday greeting e-card image: '+hlabel+', '
        + 'from KaiLionCrafts cutlery manufacturer to our valued overseas buyers. '
        + 'Elegant seasonal decorations with subtle knife/scissors product accents, '
        + 'generous space for a greeting sentence, professional corporate tone, soft warm colors, high resolution. '
        + 'No fake brand logos.';
    }
    return out;
  }

  // Auto-fill the prompt box when tab / inputs change.
  window.p4RefreshPrompt = function(){
    var ta = document.getElementById('p4_prompt');
    if(ta) ta.value = p4BuildPrompt();
  };

  window.p4SetTab = function(t){
    window._p4Tab = t;
    // Re-render just the modal body to swap input fields.
    p4OpenImageModal(true);
    p4RefreshPrompt();
  };

  // ── Model chain (failover) ────────────────────────────────────
  // Step 1: backend helper route.
  async function p4TryBackend(prompt, sizePx){
    try{
      var r = await fetch('/api/ai/generate', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({prompt:prompt, purpose:'image', model:'cogview-3-flash', size:sizePx})
      });
      if(!r.ok) throw new Error('HTTP '+r.status);
      var j = await r.json();
      var imgs = j.images || (j.data||[]).map(function(d){ return d.url || d.b64_json; }).filter(Boolean);
      if(!imgs || !imgs.length) throw new Error('empty images');
      return p4NormalizeImages(imgs);
    }catch(e){ return null; }
  }

  // Step 2: existing frontend caller (S.apis cogview config).
  async function p4TryCallAIImage(prompt, sizePx){
    if(typeof callAIImage !== 'function') return null;
    try{
      var res = await callAIImage(prompt, {size:sizePx, n:1});
      if(!res || res.error || !res.images || !res.images.length) return null;
      return p4NormalizeImages(res.images);
    }catch(e){ return null; }
  }

  // Step 3: local Ollama flux2-klein (returns base64 images).
  async function p4TryOllamaFlux(prompt, sizePx){
    try{
      var r = await fetch('http://127.0.0.1:11434/api/generate', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model:'x/flux2-klein:4b-fp4',
          prompt:prompt,
          stream:false,
          options:{num_predict:1}
        })
      });
      if(!r.ok) throw new Error('HTTP '+r.status);
      var j = await r.json();
      var imgs = j.images || [];
      if(!imgs.length) throw new Error('no images');
      return { images: imgs.map(function(b){ return 'data:image/png;base64,'+b; }), model:'flux2-klein(local)' };
    }catch(e){ return null; }
  }

  // Normalize mixed URL / base64 / data-uri entries into {url, b64}.
  function p4NormalizeImages(list){
    var out = [];
    for(var i=0;i<list.length;i++){
      var v = String(list[i]||'');
      if(!v) continue;
      if(v.indexOf('data:image') === 0){
        var b = v.split(',')[1] || '';
        out.push({ url: v, b64: b });
      } else if(/^https?:\/\//i.test(v)){
        out.push({ url: v, b64: '' });
      } else {
        // raw base64 payload
        out.push({ url: 'data:image/png;base64,'+v, b64: v });
      }
    }
    return { images: out, model:'cogview-3-flash' };
  }

  // Orchestrate the full failover chain.
  async function p4Generate(prompt, sizePx){
    var chain = [
      {name:'backend', fn: function(){ return p4TryBackend(prompt, sizePx); }},
      {name:'cogview', fn: function(){ return p4TryCallAIImage(prompt, sizePx); }},
      {name:'flux',    fn: function(){ return p4TryOllamaFlux(prompt, sizePx); }}
    ];
    var lastErr = null;
    for(var i=0;i<chain.length;i++){
      try{
        var res = await chain[i].fn();
        if(res && res.images && res.images.length){
          res.usedModel = chain[i].name + (res.model ? ' ('+res.model+')' : '');
          return res;
        }
      }catch(e){ lastErr = e; }
    }
    throw new Error('所有生图模型均不可用（cogview / flux），请稍后重试或在设置中检查 API 配置'+(lastErr?('：'+lastErr.message):''));
  }

  // ── History persistence with size guard ───────────────────────
  function p4SaveRecord(rec){
    S.aiImageHistory.unshift(rec);
    // Keep history bounded; localStorage cannot hold many base64 PNGs.
    if(S.aiImageHistory.length > 30) S.aiImageHistory = S.aiImageHistory.slice(0,30);
    // Warn if the payload is getting heavy.
    var bytes = 0;
    S.aiImageHistory.forEach(function(r){ bytes += (r.imageB64||'').length; });
    if(bytes > 3.5 * 1024 * 1024){
      // Drop oldest base64 records to protect localStorage.
      S.aiImageHistory = S.aiImageHistory.filter(function(r, idx){
        if(idx < 10) return true;
        return !!r.imageUrl && r.imageUrl.indexOf('data:') !== 0;
      });
      toast('图片库容量接近上限，已自动清理较大的本地图片，建议将大图下载后使用 URL 方式','err');
    }
    persist();
  }

  // ── Generator modal ──────────────────────────────────────────
  window.p4OpenImageModal = function(keepOpen){
    if(!window._p4Tab) window._p4Tab = 'company';
    var tab = window._p4Tab;

    var h = '';
    h += '<div class="modal-head"><h3>🖼️ AI 个性化图片生成</h3><span class="modal-close" onclick="closeModal()">×</span></div>';
    h += '<div class="modal-body" style="max-height:74vh;overflow:auto">';

    // Tab bar
    h += '<div class="p4-tabs">';
    h += '  <div class="p4-tab '+(tab==='company'?'on':'')+'" onclick="p4SetTab(\'company\')">🏢 公司定制图</div>';
    h += '  <div class="p4-tab '+(tab==='product'?'on':'')+'" onclick="p4SetTab(\'product\')">🔪 产品场景图</div>';
    h += '  <div class="p4-tab '+(tab==='holiday'?'on':'')+'" onclick="p4SetTab(\'holiday\')">🎁 节日问候图</div>';
    h += '</div>';

    // Tab-specific inputs
    if(tab === 'company'){
      h += '<div class="p4-field"><label>客户公司名称（Dear [Company] 中的占位）</label>';
      h += '<input class="form-control" id="p4_company" placeholder="例如：ABC Kitchenware Co., Ltd." oninput="p4RefreshPrompt()"></div>';
    } else if(tab === 'product'){
      h += '<div class="p4-field"><label>产品品类（自动融入品类卖点）</label>';
      h += '<select class="form-control" id="p4_cat" onchange="p4RefreshPrompt">';
      P4_CATS.forEach(function(c){ h += '<option value="'+c.id+'">'+c.icon+' '+c.label+'</option>'; });
      h += '</select></div>';
    } else {
      h += '<div class="p4-field"><label>节日</label>';
      h += '<select class="form-control" id="p4_holiday" onchange="p4RefreshPrompt">';
      P4_HOLIDAYS.forEach(function(x){ h += '<option value="'+x.id+'">'+x.label+'</option>'; });
      h += '</select></div>';
    }

    h += '<div class="p4-field"><label>图片尺寸</label>';
    h += '<select class="form-control" id="p4_size">';
    P4_SIZES.forEach(function(s){ h += '<option value="'+s.px+'">'+s.label+'（'+s.px+'）</option>'; });
    h += '</select></div>';

    h += '<div class="p4-field"><label>Prompt（可手动编辑）</label>';
    h += '<textarea class="form-control" id="p4_prompt" rows="6" style="font-size:12px;font-family:Menlo,monospace"></textarea></div>';

    h += '<div id="p4_preview_area"></div>';
    h += '</div>';
    h += '<div class="modal-foot">';
    h += '<button class="btn btn-outline" onclick="closeModal()">关闭</button>';
    h += '<button class="btn btn-primary" id="p4_gen_btn" onclick="p4RunGenerate()">✨ 生成图片</button>';
    h += '</div>';

    openModal(h, true);
    // Seed the prompt box after DOM exists.
    p4RefreshPrompt();
  };

  // Actually run generation, with loading state and post-actions.
  window.p4RunGenerate = async function(){
    var prompt = (document.getElementById('p4_prompt') || {}).value || '';
    var sizePx = (document.getElementById('p4_size') || {}).value || '1024x1024';
    if(!prompt.trim()){ toast('请填写 prompt','err'); return; }

    var btn = document.getElementById('p4_gen_btn');
    if(btn){ btn.disabled = true; btn.textContent = '⏳ 生成中（cogview → flux 故障转移）...'; }
    var area = document.getElementById('p4_preview_area');
    if(area) area.innerHTML = '<div class="p4-loading">AI 正在绘制，请稍候（首次可能需要 30-60 秒）...</div>';

    try{
      var res = await p4Generate(prompt, sizePx);
      var img = res.images[0];
      var tab = window._p4Tab;
      var catId = tab === 'product' ? ((document.getElementById('p4_cat')||{}).value || 'kitchen_knives') : '';
      var rec = {
        id: uid(),
        prompt: prompt,
        imageUrl: img.url,
        imageB64: img.b64 || '',
        type: tab,
        category: catId,
        holiday: tab === 'holiday' ? ((document.getElementById('p4_holiday')||{}).value || '') : '',
        size: sizePx,
        model: res.usedModel || '',
        usedInDrafts: [],
        createdAt: new Date().toISOString()
      };
      p4SaveRecord(rec);

      if(area){
        area.innerHTML = ''
          + '<div class="p4-result">'
          + '  <img src="'+img.url+'" class="p4-result-img" alt="AI generated image">'
          + '  <div class="p4-result-actions">'
          + '    <button class="btn btn-outline btn-sm" onclick="p4DownloadImage(\''+rec.id+'\')">⬇️ 下载</button>'
          + '    <button class="btn btn-outline btn-sm" onclick="p4CopyHtml(\''+rec.id+'\')">📋 复制HTML</button>'
          + '    <button class="btn btn-primary btn-sm" onclick="p4InsertIntoDraft(\''+rec.id+'\')">✉️ 插入开发信</button>'
          + '  </div>'
          + '  <div class="text-sm text-muted" style="margin-top:6px">已自动存入图片库 · 模型：'+esc(rec.model)+'</div>'
          + '</div>';
      }
      toast('图片已生成并保存到图片库');
    }catch(e){
      if(area) area.innerHTML = '<div class="p4-loading" style="border-color:#fca5a5;color:#b91c11">⚠️ ' + esc(e.message) + '</div>';
      toast(e.message, 'err');
    }finally{
      if(btn){ btn.disabled = false; btn.textContent = '✨ 生成图片'; }
    }
  };

  // ── Library view (history grid) ──────────────────────────────
  window.viewAiImageLibrary = function(root){
    var list = S.aiImageHistory || [];
    var h = '';
    h += '<div class="flex-between mb16">';
    h += '  <div><h2 style="margin:0">🖼️ AI 个性化图片库</h2>';
    h += '  <div class="text-sm text-muted" style="margin-top:4px">公司定制图 · 产品场景图 · 节日问候图 · 生成后可一键插入开发信草稿</div></div>';
    h += '  <button class="btn btn-primary" onclick="p4OpenImageModal()">✨ 生成新图片</button>';
    h += '</div>';

    // Filter bar
    var fType = window._p4FilterType || 'all';
    h += '<div class="p4-filter-bar">';
    [['all','全部类型'],['company','公司定制'],['product','产品场景'],['holiday','节日问候']].forEach(function(p){
      h += '<button class="btn btn-sm '+(fType===p[0]?'btn-gold':'btn-outline')+'" onclick="p4SetFilterType(\''+p[0]+'\')">'+p[1]+'</button>';
    });
    h += '</div>';

    var filtered = list.filter(function(r){
      return fType === 'all' || r.type === fType;
    });

    if(!filtered.length){
      h += '<div class="p4-empty">还没有生成过图片。点击右上角「生成新图片」，为开发信制作一张个性化配图。</div>';
      root.innerHTML = h;
      return;
    }

    h += '<div class="p4-grid">';
    filtered.forEach(function(r){
      var src = p4ImgSrc(r);
      if(!src) return;
      var typeLabel = r.type==='company'?'🏢 公司定制':r.type==='product'?'🔪 产品场景':'🎁 节日问候';
      var sub = p4CatMeta(r.category) ? p4CatMeta(r.category).label : (r.type==='holiday' ? p4HolidayLabel(r.holiday) : '');
      h += '<div class="p4-card">';
      h += '  <img src="'+src+'" class="p4-card-img" onclick="p4Preview(\''+r.id+'\')">';
      h += '  <div class="p4-card-body">';
      h += '    <div class="p4-card-type">'+typeLabel+(sub?' · '+esc(sub):'')+'</div>';
      h += '    <div class="p4-card-meta">'+p4FmtDate(r.createdAt)+' · '+p4SizeLabel(r.size)+'</div>';
      h += '    <div class="p4-card-actions">';
      h += '      <button class="btn btn-xs btn-outline" onclick="p4Preview(\''+r.id+'\')">👁 预览</button>';
      h += '      <button class="btn btn-xs btn-outline" onclick="p4CopyHtml(\''+r.id+'\')">📋 HTML</button>';
      h += '      <button class="btn btn-xs btn-primary" onclick="p4InsertIntoDraft(\''+r.id+'\')">✉️ 插入</button>';
      h += '      <button class="btn btn-xs btn-outline" onclick="p4DownloadImage(\''+r.id+'\')">⬇️</button>';
      h += '      <button class="btn btn-xs btn-outline" style="color:#dc2626" onclick="p4Delete(\''+r.id+'\')">🗑</button>';
      h += '    </div>';
      h += '  </div>';
      h += '</div>';
    });
    h += '</div>';
    root.innerHTML = h;
  };

  window.p4SetFilterType = function(t){ window._p4FilterType = t; renderView(); };

  function p4Find(id){
    for(var i=0;i<S.aiImageHistory.length;i++) if(S.aiImageHistory[i].id===id) return S.aiImageHistory[i];
    return null;
  }

  // ── Actions: preview / copy HTML / download / insert / delete ──
  window.p4Preview = function(id){
    var r = p4Find(id);
    if(!r) return;
    var src = p4ImgSrc(r);
    openModal(
      '<div class="modal-head"><h3>图片预览</h3><span class="modal-close" onclick="closeModal()">×</span></div>'
      + '<div class="modal-body"><img src="'+src+'" style="max-width:100%;border-radius:8px">'
      + '<div class="text-sm text-muted" style="margin-top:10px;white-space:pre-wrap">'+esc(r.prompt)+'</div></div>'
      + '<div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">关闭</button></div>',
      true);
  };

  window.p4CopyHtml = function(id){
    var r = p4Find(id);
    if(!r) return;
    var src = p4ImgSrc(r);
    var html = '<img src="'+src+'" style="max-width:100%;height:auto" alt="'+esc((r.prompt||'').slice(0,60))+'">';
    p4CopyText(html);
    toast('已复制 <img> HTML 到剪贴板');
  };

  function p4CopyText(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).catch(function(){ p4LegacyCopy(text); });
    } else {
      p4LegacyCopy(text);
    }
  }
  function p4LegacyCopy(text){
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); }catch(e){}
    ta.remove();
  }

  window.p4DownloadImage = function(id){
    var r = p4Find(id);
    if(!r) return;
    var src = p4ImgSrc(r);
    var a = document.createElement('a');
    a.href = src;
    a.download = 'kailion-aiimage-'+id+'.png';
    document.body.appendChild(a); a.click(); a.remove();
    toast('已开始下载');
  };

  window.p4Delete = function(id){
    confirmDlg('确定删除这张图片吗？删除后不可恢复。', function(){
      S.aiImageHistory = S.aiImageHistory.filter(function(x){ return x.id !== id; });
      persist();
      toast('已删除');
      renderView();
    });
  };

  // Insert <img> at the cursor of the open draft editor (#dr_body).
  window.p4InsertIntoDraft = function(id){
    var r = p4Find(id);
    if(!r) return;
    var src = p4ImgSrc(r);
    var ta = document.getElementById('dr_body');
    var snippet = '\n<img src="'+src+'" style="max-width:100%;height:auto">\n';

    if(ta){
      // Insert at current caret position inside the open draft drawer.
      var start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
      var end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
      ta.value = ta.value.slice(0,start) + snippet + ta.value.slice(end);
      ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
      // Remember usage for traceability.
      if(r.usedInDrafts.indexOf('open') === -1) r.usedInDrafts.push('open');
      persist();
      closeModal();
      toast('图片已插入草稿正文，记得点击「保存草稿」');
    } else {
      // No editor open: copy HTML so the user can paste it anywhere.
      p4CopyText(snippet);
      toast('当前没有打开的草稿编辑器，图片 HTML 已复制到剪贴板，请先打开草稿再粘贴','err');
    }
  };

  // ── Editor integration: inject "🖼️ 插入AI图片" button into the
  //    draft editor drawer (built by app.js openDrawer). We watch the
  //    DOM and inject once #dr_body appears. ──────────────────────
  function p4InjectEditorButton(){
    var ta = document.getElementById('dr_body');
    if(!ta) return;
    var wrap = ta.parentElement ? ta.parentElement.querySelector('div[style*="margin-top:6px"]') : null;
    if(!wrap || wrap.querySelector('.p4-insert-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'btn btn-outline btn-sm p4-insert-btn';
    btn.style.marginLeft = '8px';
    btn.textContent = '🖼️ 插入AI图片';
    btn.onclick = function(){ window._p4ReturnAfterInsert = true; p4OpenImageModal(); };
    wrap.appendChild(btn);
  }

  var _p4Observer = new MutationObserver(function(){
    p4InjectEditorButton();
  });
  _p4Observer.observe(document.body, {childList:true, subtree:true});

  // ── renderView interception ──────────────────────────────────
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'aiImageLibrary'){
      window.viewAiImageLibrary(document.getElementById('mainContent'));
      return;
    }
    _origRV.apply(this, arguments);
  };

  // ── Styles (all p4- prefixed, responsive) ────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.p4-empty{padding:40px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    + '.p4-tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;}'
    + '.p4-tab{padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;}'
    + '.p4-tab.on{background:#2d3748;color:#fff;border-color:#2d3748;}'
    + '.p4-field{margin-bottom:12px;}'
    + '.p4-field label{display:block;font-size:12px;color:#4a5568;margin-bottom:4px;font-weight:600;}'
    + '.p4-loading{padding:24px;text-align:center;color:#3182ce;background:#ebf8ff;border:1px solid #bee3f8;border-radius:8px;}'
    + '.p4-result{margin-top:14px;text-align:center;}'
    + '.p4-result-img{max-width:100%;border-radius:10px;border:1px solid #e2e8f0;}'
    + '.p4-result-actions{margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}'
    + '.p4-filter-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}'
    + '.p4-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;}'
    + '.p4-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;}'
    + '.p4-card-img{width:100%;height:150px;object-fit:cover;cursor:pointer;display:block;}'
    + '.p4-card-img:hover{opacity:.92;}'
    + '.p4-card-body{padding:10px 12px;display:flex;flex-direction:column;gap:6px;flex:1;}'
    + '.p4-card-type{font-size:12px;font-weight:600;color:#2d3748;}'
    + '.p4-card-meta{font-size:11px;color:#718096;}'
    + '.p4-card-actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:auto;}'
    + '@media (max-width:768px){'
    + '  .p4-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));}'
    + '  .p4-card-img{height:110px;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
