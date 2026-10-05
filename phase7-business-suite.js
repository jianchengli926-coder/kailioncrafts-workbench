/* ============================================================
 * P7 Phase7 Module: Business Suite
 * ----------------------------------------------------------------
 * Feature 26: PDF Proforma Invoice auto-generator (print-to-PDF,
 *             no external libs). Pure front-end.
 * Feature 29: CSV bidirectional sync (export / import / field
 *             mapping / conflict handling) — Google Sheets /
 *             Feishu Bitable compatible.
 * Feature 30: Knowledge-base → GEO content mapping
 *             (Generate → Enrich → Optimize).
 * Feature 33: Visual follow-up workflow editor (simplified):
 *             template management + visual progress timeline.
 *
 * HARD RULE: This module NEVER sends any email / WhatsApp. It only
 * generates documents, drafts, previews and local files. All CSS
 * classes use the p7- prefix.
 * ============================================================ */
(function(){
  'use strict';

  // ── State init (already wired into app.js load/persist) ──
  if(!Array.isArray(S.p7Invoices)) S.p7Invoices = [];
  if(!S.p7InvoiceConfig) S.p7InvoiceConfig = {companyName:'KaiLionCrafts', bankInfo:{bankName:'',accountNo:'',swift:'',beneficiary:''}, invoicePrefix:'PI', nextNumber:1};
  if(!Array.isArray(S.p7CsvSyncLogs)) S.p7CsvSyncLogs = [];
  if(!S.p7CsvSyncConfig) S.p7CsvSyncConfig = {fieldMapping:{}, direction:'export', lastSync:null};
  if(!Array.isArray(S.p7GeoContents)) S.p7GeoContents = [];

  // ── Nav injection (4 entries) ─────────────────────────────
  NAV.push({ key:'invoiceGenerator', icon:'🧾', label:'形式发票', title:'PDF Proforma Invoice 自动生成', crumb:'PI编号 · 产品明细 · 打印PDF · 银行信息' });
  NAV.push({ key:'csvSync',          icon:'🔁', label:'CSV同步', title:'Google Sheets / 飞书多维表 双向同步', crumb:'字段映射 · 导入导出 · 冲突处理 · 同步日志' });
  NAV.push({ key:'geoContent',       icon:'🌐', label:'GEO内容', title:'知识库 → GEO 内容映射', crumb:'Generate生成 · Enrich丰富 · Optimize优化' });
  NAV.push({ key:'workflowVisual',   icon:'📊', label:'可视化流程', title:'跟进 Workflow 可视化编辑器', crumb:'序列模板 · 进度时间轴 · 序列统计' });

  // ── Shared helpers ────────────────────────────────────────
  function p7NowISO(){ return new Date().toISOString(); }

  function p7FmtDate(iso){
    if(!iso) return '—';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function p7FindCustomer(id){
    return (S.customers||[]).find(function(x){ return x.id === id; }) || null;
  }

  function p7CustomerEmail(c){
    if(!c) return '';
    try{ if(typeof getCustomerPrimaryEmail === 'function'){ var e = getCustomerPrimaryEmail(c); if(e) return e; } }catch(e){}
    return (c.contact && c.contact.email) || '';
  }

  // Robust JSON extraction from AI response
  function p7ParseAIJSON(content){
    if(!content) return null;
    try{
      var m = String(content).match(/```json\s*([\s\S]*?)```/);
      if(m && m[1]) return JSON.parse(m[1]);
      m = String(content).match(/\{[\s\S]*\}/);
      if(m) return JSON.parse(m[0]);
      return null;
    }catch(e){
      console.warn('[p7] AI JSON parse failed:', e, content);
      return null;
    }
  }

  // ============================================================
  // Feature 26: PDF Proforma Invoice
  // ============================================================
  if(!window._p7InvTab) window._p7InvTab = 'new';
  window.p7SetInvTab = function(t){ window._p7InvTab = t; renderView(); };

  // transient invoice draft items (not persisted until generated)
  if(!Array.isArray(window._p7InvItems)) window._p7InvItems = [ {description:'', quantity:1, unitPrice:0} ];

  function p7GenInvoiceNo(){
    var cfg = S.p7InvoiceConfig || {};
    var prefix = cfg.invoicePrefix || 'PI';
    var d = new Date();
    var ymd = '' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
    var seq = String(cfg.nextNumber || 1).padStart(3,'0');
    return prefix + ymd + '-' + seq;
  }

  window.p7AddInvRow = function(){
    window._p7InvItems.push({ description:'', quantity:1, unitPrice:0 });
    renderView();
  };

  window.p7DelInvRow = function(i){
    window._p7InvItems.splice(i, 1);
    if(window._p7InvItems.length === 0) window._p7InvItems.push({description:'',quantity:1,unitPrice:0});
    renderView();
  };

  // live subtotal recalc
  window.p7RecalcInv = function(){
    var total = 0;
    for(var i=0;i<window._p7InvItems.length;i++){
      var qtyEl = document.getElementById('p7_inv_qty_'+i);
      var prEl = document.getElementById('p7_inv_price_'+i);
      if(!qtyEl || !prEl) continue;
      var qty = parseFloat(qtyEl.value)||0;
      var price = parseFloat(prEl.value)||0;
      var sub = qty*price;
      var subEl = document.getElementById('p7_inv_sub_'+i);
      if(subEl) subEl.textContent = sub.toFixed(2);
      total += sub;
    }
    var tEl = document.getElementById('p7_inv_grandtotal');
    if(tEl) tEl.textContent = total.toFixed(2);
  };

  // Build professional printable invoice HTML
  function p7BuildInvoiceHtml(inv){
    var cfg = S.p7InvoiceConfig || {};
    var bank = inv.bankInfo || {};
    var rowsHtml = inv.items.map(function(it, i){
      return '<tr>'
        + '<td>' + (i+1) + '</td>'
        + '<td style="text-align:left">' + esc(it.description||'') + '</td>'
        + '<td>' + (it.quantity||0) + '</td>'
        + '<td>$ ' + Number(it.unitPrice||0).toFixed(2) + '</td>'
        + '<td>$ ' + Number(it.total||0).toFixed(2) + '</td>'
        + '</tr>';
    }).join('');

    var html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
      + '<title>Proforma Invoice ' + esc(inv.invoiceNo) + '</title>'
      + '<style>'
      + 'body{font-family:"Helvetica Neue",Arial,sans-serif;color:#1a202c;margin:0;padding:36px;font-size:13px;}'
      + '.wrap{max-width:820px;margin:0 auto;}'
      + '.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #2d3748;padding-bottom:14px;}'
      + '.brand h1{font-size:22px;margin:0;color:#2d3748;letter-spacing:.5px;}'
      + '.brand p{margin:4px 0 0;color:#718096;font-size:11px;}'
      + '.doctitle{font-size:30px;font-weight:800;color:#3182ce;letter-spacing:3px;}'
      + '.meta{display:flex;justify-content:space-between;margin:18px 0;}'
      + '.box{border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;flex:1;margin:0 6px;}'
      + '.box h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;color:#718096;letter-spacing:1px;}'
      + '.box .v{font-size:13px;line-height:1.6;}'
      + 'table{width:100%;border-collapse:collapse;margin:10px 0 18px;}'
      + 'th{background:#2d3748;color:#fff;padding:8px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.5px;}'
      + 'td{padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;}'
      + '.tot{display:flex;justify-content:flex-end;margin-top:8px;}'
      + '.tot table{width:280px;margin:0;}'
      + '.tot td{text-align:right;}'
      + '.tot .grand{font-weight:800;font-size:15px;color:#2d3748;background:#f7fafc;}'
      + '.terms{display:flex;gap:12px;margin:18px 0;}'
      + '.terms .box{flex:1;}'
      + '.bank table{margin:4px 0;}'
      + '.bank td{text-align:left;border:none;padding:3px 6px;}'
      + '.sign{display:flex;justify-content:space-between;margin-top:40px;}'
      + '.sign .line{width:220px;border-top:1px solid #2d3748;padding-top:6px;font-size:11px;color:#718096;text-align:center;}'
      + '.foot{margin-top:26px;font-size:10px;color:#a0aec0;text-align:center;border-top:1px solid #edf2f7;padding-top:8px;}'
      + '@media print{body{padding:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.wrap{max-width:100%;}}'
      + '</style></head><body><div class="wrap">'
      + '<div class="head"><div class="brand"><h1>' + esc(cfg.companyName||'KaiLionCrafts') + '</h1><p>Proforma Invoice · Commercial Document</p></div>'
      + '<div class="doctitle">PROFORMA<br>INVOICE</div></div>'
      + '<div class="meta"><div class="box"><h4>Invoice No.</h4><div class="v">' + esc(inv.invoiceNo) + '</div></div>'
      + '<div class="box"><h4>Date</h4><div class="v">' + p7FmtDate(inv.createdAt) + '</div></div>'
      + '<div class="box"><h4>Delivery Date</h4><div class="v">' + esc(inv.deliveryDate||'—') + '</div></div></div>'
      + '<div class="meta"><div class="box"><h4>From (Seller)</h4><div class="v">' + esc(cfg.companyName||'KaiLionCrafts') + '<br>Yangjiang, Guangdong, China</div></div>'
      + '<div class="box"><h4>To (Buyer)</h4><div class="v">' + esc(inv.customerName||'') + '</div></div></div>'
      + '<table><thead><tr><th style="width:40px">#</th><th style="text-align:left">Description</th><th style="width:70px">Qty</th><th style="width:110px">Unit Price (USD)</th><th style="width:110px">Amount (USD)</th></tr></thead><tbody>'
      + rowsHtml
      + '</tbody></table>'
      + '<div class="tot"><table><tr><td>Subtotal</td><td>$ ' + Number(inv.subtotal||0).toFixed(2) + '</td></tr>'
      + '<tr class="grand"><td>TOTAL</td><td>$ ' + Number(inv.total||0).toFixed(2) + '</td></tr></table></div>'
      + '<div class="terms"><div class="box"><h4>Payment Terms</h4><div class="v">' + esc(inv.paymentTerms||'—') + '</div></div>'
      + '<div class="box bank"><h4>Bank Information</h4>'
      + '<table><tr><td>Bank:</td><td>' + esc(bank.bankName||'—') + '</td></tr>'
      + '<tr><td>Account:</td><td>' + esc(bank.accountNo||'—') + '</td></tr>'
      + '<tr><td>SWIFT:</td><td>' + esc(bank.swift||'—') + '</td></tr>'
      + '<tr><td>Beneficiary:</td><td>' + esc(bank.beneficiary||'—') + '</td></tr></table></div></div>'
      + '<div class="sign"><div class="line">Seller Signature / Stamp</div><div class="line">Buyer Confirmation</div></div>'
      + '<div class="foot">This is a computer-generated proforma invoice (printed from 外贸获客AI工作台) and valid without signature unless otherwise required.</div>'
      + '</div></body></html>';
    return html;
  }

  // Open print window with saved/generated HTML
  window.p7PrintInvoice = function(invId){
    var inv = (S.p7Invoices||[]).find(function(x){ return x.id === invId; });
    if(!inv){ toast('发票不存在', 'err'); return; }
    var html = inv.pdfHtml || p7BuildInvoiceHtml(inv);
    var w = window.open('', '_blank');
    if(!w){ toast('浏览器拦截了弹窗，请允许弹窗后重试', 'err'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(function(){ try{ w.focus(); w.print(); }catch(e){} }, 300);
  };

  window.p7DelInvoice = function(invId){
    S.p7Invoices = (S.p7Invoices||[]).filter(function(x){ return x.id !== invId; });
    persist(); toast('已删除发票'); renderView();
  };

  window.p7SaveInvoiceConfig = function(){
    var cfg = S.p7InvoiceConfig || {};
    cfg.companyName = (document.getElementById('p7_cfg_company')||{}).value || cfg.companyName || 'KaiLionCrafts';
    cfg.invoicePrefix = (document.getElementById('p7_cfg_prefix')||{}).value || cfg.invoicePrefix || 'PI';
    cfg.nextNumber = parseInt((document.getElementById('p7_cfg_nextnum')||{}).value, 10) || 1;
    cfg.bankInfo = cfg.bankInfo || {};
    cfg.bankInfo.bankName = (document.getElementById('p7_cfg_bankname')||{}).value || '';
    cfg.bankInfo.accountNo = (document.getElementById('p7_cfg_account')||{}).value || '';
    cfg.bankInfo.swift = (document.getElementById('p7_cfg_swift')||{}).value || '';
    cfg.bankInfo.beneficiary = (document.getElementById('p7_cfg_beneficiary')||{}).value || '';
    S.p7InvoiceConfig = cfg;
    persist(); toast('✅ 发票配置已保存'); renderView();
  };

  window.p7GenerateInvoice = function(){
    var cEl = document.getElementById('p7_inv_customer');
    var cid = cEl ? cEl.value : '';
    var c = p7FindCustomer(cid);
    if(!c){ toast('请选择客户', 'err'); return; }

    var items = [];
    var subtotal = 0;
    for(var i=0;i<window._p7InvItems.length;i++){
      var dEl = document.getElementById('p7_inv_desc_'+i);
      var qEl = document.getElementById('p7_inv_qty_'+i);
      var pEl = document.getElementById('p7_inv_price_'+i);
      if(!dEl) continue;
      var desc = (dEl.value||'').trim();
      if(!desc) continue; // skip empty rows
      var qty = parseFloat(qEl.value)||0;
      var price = parseFloat(pEl.value)||0;
      var total = qty*price;
      items.push({ description:desc, quantity:qty, unitPrice:price, total:total });
      subtotal += total;
    }
    if(items.length === 0){ toast('请至少填写一行产品明细（描述不能为空）', 'err'); return; }

    var termsEl = document.getElementById('p7_inv_terms');
    var delEl = document.getElementById('p7_inv_delivery');
    var cfg = S.p7InvoiceConfig || {};

    var inv = {
      id: uid(),
      invoiceNo: p7GenInvoiceNo(),
      customerId: c.id,
      customerName: c.company,
      items: items,
      subtotal: subtotal,
      total: subtotal,
      paymentTerms: termsEl ? termsEl.value : '',
      deliveryDate: delEl ? delEl.value : '',
      bankInfo: Object.assign({}, cfg.bankInfo||{}),
      status: 'draft',
      createdAt: p7NowISO()
    };
    inv.pdfHtml = p7BuildInvoiceHtml(inv);
    S.p7Invoices.push(inv);
    // bump sequence number
    S.p7InvoiceConfig.nextNumber = (cfg.nextNumber||1) + 1;
    // reset draft items
    window._p7InvItems = [ {description:'',quantity:1,unitPrice:0} ];
    try{ addTimelineEvent(c.id, 'invoice', '生成形式发票 ' + inv.invoiceNo, '金额 $' + subtotal.toFixed(2)); }catch(e){}
    persist(); toast('✅ 发票 ' + inv.invoiceNo + ' 已生成，正在调起打印…');
    renderView();
    window.p7PrintInvoice(inv.id);
  };

  function p7RenderInvoicePage(root){
    var cfg = S.p7InvoiceConfig || {};
    var b = cfg.bankInfo || {};
    var h = '<div class="p7-page">';
    h += '<div class="p7-tabs">'
      + '<div class="p7-tab' + (window._p7InvTab==='new'?' on':'') + '" onclick="p7SetInvTab(\'new\')">🧾 新建发票</div>'
      + '<div class="p7-tab' + (window._p7InvTab==='history'?' on':'') + '" onclick="p7SetInvTab(\'history\')">🗂 历史发票</div>'
      + '<div class="p7-tab' + (window._p7InvTab==='config'?' on':'') + '" onclick="p7SetInvTab(\'config\')">⚙️ 发票配置</div>'
      + '</div>';

    if(window._p7InvTab === 'new'){
      h += '<div class="p7-panel">';
      h += '<div class="p7-panel-head">新建 Proforma Invoice <span class="p7-tag">编号自动：' + esc(p7GenInvoiceNo()) + '</span></div>';
      h += '<div class="p7-form-grid">';
      // customer select
      h += '<label class="p7-field"><span>客户</span><select class="p7-input" id="p7_inv_customer">';
      (S.customers||[]).forEach(function(c){
        h += '<option value="' + c.id + '">' + esc(c.company) + (c.country ? ' · ' + esc(c.country) : '') + '</option>';
      });
      h += '</select></label>';
      // payment terms
      h += '<label class="p7-field"><span>付款条件</span><select class="p7-input" id="p7_inv_terms">';
      ['T/T 30% deposit, balance before shipment','T/T 50% deposit, balance before shipment','T/T 100% before shipment','L/C at sight','Western Union','PayPal'].forEach(function(t){
        h += '<option value="' + esc(t) + '">' + esc(t) + '</option>';
      });
      h += '</select></label>';
      // delivery date
      h += '<label class="p7-field"><span>交期</span><input class="p7-input" type="date" id="p7_inv_delivery" /></label>';
      h += '</div>'; // form-grid

      // items table
      h += '<div class="p7-items-head">📦 产品明细 <button class="btn btn-sm btn-outline" onclick="p7AddInvRow()">+ 添加行</button></div>';
      h += '<table class="p7-table p7-items"><thead><tr><th style="width:40px">#</th><th>描述 Description</th><th style="width:80px">数量</th><th style="width:110px">单价(USD)</th><th style="width:110px">小计</th><th style="width:50px"></th></tr></thead><tbody>';
      window._p7InvItems.forEach(function(it, i){
        h += '<tr>'
          + '<td>' + (i+1) + '</td>'
          + '<td><input class="p7-input" id="p7_inv_desc_' + i + '" value="' + esc(it.description||'') + '" placeholder="e.g. 8 inch Stainless Kitchen Knife" /></td>'
          + '<td><input class="p7-input" type="number" min="0" id="p7_inv_qty_' + i + '" value="' + (it.quantity||1) + '" oninput="p7RecalcInv()" /></td>'
          + '<td><input class="p7-input" type="number" min="0" step="0.01" id="p7_inv_price_' + i + '" value="' + (it.unitPrice||0) + '" oninput="p7RecalcInv()" /></td>'
          + '<td class="p7-sub" id="p7_inv_sub_' + i + '">' + ((it.quantity||0)*(it.unitPrice||0)).toFixed(2) + '</td>'
          + '<td><button class="btn btn-sm btn-outline" onclick="p7DelInvRow(' + i + ')">✖</button></td>'
          + '</tr>';
      });
      h += '</tbody><tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">合计 Total (USD)</td><td class="p7-grand" id="p7_inv_grandtotal">0.00</td><td></td></tr></tfoot></table>';

      // bank info preview (pre-filled from config, editable per-invoice)
      h += '<div class="p7-bank-preview"><b>🏦 银行信息（预填自配置，可直接在配置页修改）：</b>'
        + ' ' + esc(b.bankName||'未设置') + ' · 账号 ' + esc(b.accountNo||'—') + ' · SWIFT ' + esc(b.swift||'—') + '</div>';

      h += '<div class="p7-actions"><button class="btn btn-primary" onclick="p7GenerateInvoice()">🧾 生成并打印PDF</button>'
        + '<span class="p7-note">生成后自动调起浏览器打印，选择"另存为PDF"即可下载（纯前端，无外部库）</span></div>';
      h += '</div>';
    }
    else if(window._p7InvTab === 'history'){
      var list = (S.p7Invoices||[]).slice().reverse();
      if(list.length === 0){
        h += '<div class="p7-empty">还没有任何发票。从"新建发票"开始。</div>';
      } else {
        h += '<table class="p7-table"><thead><tr><th>发票编号</th><th>客户</th><th>金额(USD)</th><th>日期</th><th>状态</th><th>操作</th></tr></thead><tbody>';
        list.forEach(function(inv){
          h += '<tr>'
            + '<td class="p7-mono">' + esc(inv.invoiceNo) + '</td>'
            + '<td>' + esc(inv.customerName) + '</td>'
            + '<td>$ ' + Number(inv.total||0).toFixed(2) + '</td>'
            + '<td>' + p7FmtDate(inv.createdAt) + '</td>'
            + '<td><span class="p7-badge blue">' + esc(inv.status||'draft') + '</span></td>'
            + '<td class="p7-op"><button class="btn btn-sm btn-primary" onclick="p7PrintInvoice(\'' + inv.id + '\')">🖨 查看/重印PDF</button>'
            + '<button class="btn btn-sm btn-outline" onclick="p7DelInvoice(\'' + inv.id + '\')">🗑 删除</button></td>'
            + '</tr>';
        });
        h += '</tbody></table>';
      }
    }
    else { // config
      h += '<div class="p7-panel"><div class="p7-panel-head">发票与公司配置</div>';
      h += '<div class="p7-form-grid">'
        + '<label class="p7-field"><span>公司名称（抬头）</span><input class="p7-input" id="p7_cfg_company" value="' + esc(cfg.companyName||'') + '" /></label>'
        + '<label class="p7-field"><span>发票前缀</span><input class="p7-input" id="p7_cfg_prefix" value="' + esc(cfg.invoicePrefix||'PI') + '" /></label>'
        + '<label class="p7-field"><span>下一序号</span><input class="p7-input" type="number" min="1" id="p7_cfg_nextnum" value="' + (cfg.nextNumber||1) + '" /></label>'
        + '</div>';
      h += '<div class="p7-subhead">🏦 收款银行信息（显示在发票上）</div>';
      h += '<div class="p7-form-grid">'
        + '<label class="p7-field"><span>银行名称 Bank Name</span><input class="p7-input" id="p7_cfg_bankname" value="' + esc(b.bankName||'') + '" /></label>'
        + '<label class="p7-field"><span>账号 Account No.</span><input class="p7-input" id="p7_cfg_account" value="' + esc(b.accountNo||'') + '" /></label>'
        + '<label class="p7-field"><span>SWIFT Code</span><input class="p7-input" id="p7_cfg_swift" value="' + esc(b.swift||'') + '" /></label>'
        + '<label class="p7-field"><span>受益人 Beneficiary</span><input class="p7-input" id="p7_cfg_beneficiary" value="' + esc(b.beneficiary||'') + '" /></label>'
        + '</div>';
      h += '<div class="p7-actions"><button class="btn btn-primary" onclick="p7SaveInvoiceConfig()">💾 保存配置</button></div>';
      h += '</div>';
    }
    h += '</div>';
    root.innerHTML = h;
  }

  // ============================================================
  // Feature 29: CSV bidirectional sync
  // ============================================================
  if(!window._p7CsvTab) window._p7CsvTab = 'export';
  window.p7SetCsvTab = function(t){ window._p7CsvTab = t; renderView(); };

  // field definitions for export targets
  var P7_EXPORT_FIELDS = {
    customers: [
      {key:'company',label:'公司名称',get:function(c){return c.company||'';}},
      {key:'contactName',label:'联系人',get:function(c){return (c.contact||{}).name||'';}},
      {key:'contactTitle',label:'职位',get:function(c){return (c.contact||{}).title||'';}},
      {key:'email',label:'邮箱',get:function(c){return p7CustomerEmail(c);}},
      {key:'phone',label:'电话',get:function(c){return (c.contact||{}).phone||'';}},
      {key:'country',label:'国家',get:function(c){return c.country||'';}},
      {key:'city',label:'城市',get:function(c){return c.city||'';}},
      {key:'source',label:'来源',get:function(c){return c.source||'';}},
      {key:'grade',label:'等级',get:function(c){return (c.scores||{}).grade||'';}},
      {key:'status',label:'状态',get:function(c){return c.status||'';}},
      {key:'tags',label:'标签',get:function(c){return (c.tags||[]).join('; ');}},
      {key:'products',label:'产品',get:function(c){return (c.products||[]).join('; ');}},
      {key:'website',label:'网站',get:function(c){return c.website||'';}},
      {key:'createdAt',label:'创建时间',get:function(c){return c.createdAt||'';}}
    ],
    drafts: [
      {key:'customerName',label:'客户公司',get:function(d){return d.customerName||d.customer||'';}},
      {key:'email',label:'客户邮箱',get:function(d){return d.email||'';}},
      {key:'subject',label:'主题',get:function(d){return d.subject||'';}},
      {key:'body',label:'正文',get:function(d){return String(d.body||'').replace(/[\r\n]/g,' ');}},
      {key:'status',label:'状态',get:function(d){return d.status||'';}},
      {key:'createdAt',label:'创建时间',get:function(d){return d.createdAt||'';}}
    ],
    sendRecords: [
      {key:'customerName',label:'客户公司',get:function(r){return r.customerName||'';}},
      {key:'subject',label:'主题',get:function(r){return r.subject||'';}},
      {key:'sentAt',label:'发送时间',get:function(r){return r.sentAt||'';}},
      {key:'status',label:'发送状态',get:function(r){return r.status||'';}},
      {key:'openStatus',label:'打开状态',get:function(r){return r.openStatus||'';}}
    ]
  };
  if(!window._p7ExpObject) window._p7ExpObject = 'customers';
  window.p7SetExpObject = function(o){ window._p7ExpObject = o; renderView(); };

  // CSV escape one cell
  function p7CsvCell(v){ return '"' + String(v==null?'':v).replace(/"/g,'""') + '"'; }

  // state-machine CSV parser (handles quoted fields containing commas)
  function p7ParseCSV(text){
    var rows = [], row = [], field = '', inQuotes = false;
    if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
    for(var i=0;i<text.length;i++){
      var ch = text[i];
      if(inQuotes){
        if(ch === '"'){
          if(text[i+1] === '"'){ field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else {
        if(ch === '"') inQuotes = true;
        else if(ch === ','){ row.push(field); field = ''; }
        else if(ch === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
        else if(ch === '\r'){ /* skip CR */ }
        else field += ch;
      }
    }
    if(field !== '' || row.length > 0){ row.push(field); rows.push(row); }
    return rows;
  }

  function p7AddLog(entry){
    entry.id = uid();
    entry.timestamp = p7NowISO();
    S.p7CsvSyncLogs.push(entry);
    S.p7CsvSyncConfig.lastSync = entry.timestamp;
    persist();
  }

  window.p7DoExport = function(){
    var obj = window._p7ExpObject;
    var fields = P7_EXPORT_FIELDS[obj] || [];
    // collect checked fields
    var checked = [];
    fields.forEach(function(f){
      var el = document.getElementById('p7_exp_f_' + f.key);
      if(el && el.checked) checked.push(f);
    });
    if(checked.length === 0){ toast('请至少选择一个导出字段', 'err'); return; }
    var list = (obj === 'customers' ? S.customers : obj === 'drafts' ? S.drafts : S.sendRecords) || [];
    if(!list.length){ toast('暂无数据可导出', 'err'); return; }
    var headers = checked.map(function(f){ return f.label; });
    var rows = list.map(function(item){
      return checked.map(function(f){ return p7CsvCell(f.get(item)); }).join(',');
    });
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n'); // BOM (U+FEFF) prepended for Excel/Feishu
    var blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var names = {customers:'客户台账',drafts:'开发信草稿',sendRecords:'发送记录'};
    a.href = url;
    a.download = (names[obj]||obj) + '_' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    p7AddLog({ direction:'export', recordCount:list.length, fileName:a.download, conflicts:0, objectType:obj });
    toast('✅ 已导出 ' + list.length + ' 条记录（带BOM，Excel/飞书可直接打开）');
    renderView();
  };

  // ── Import flow ──
  window._p7CsvParsed = null;   // { headers:[], rows:[[...]] }
  window._p7CsvMapping = {};    // colIndex -> targetField
  window._p7CsvConflictMode = 'skip';

  // target customer fields for import mapping
  var P7_IMPORT_TARGETS = [
    {key:'company',label:'公司名称'},
    {key:'contactName',label:'联系人姓名'},
    {key:'contactTitle',label:'职位'},
    {key:'email',label:'邮箱'},
    {key:'phone',label:'电话'},
    {key:'country',label:'国家'},
    {key:'city',label:'城市'},
    {key:'products',label:'产品（分号分隔）'},
    {key:'website',label:'网站'},
    {key:'notes',label:'备注'}
  ];

  window.p7OnCsvFile = function(input){
    var file = input.files && input.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(e){
      var text = String(e.target.result || '');
      var rows = p7ParseCSV(text);
      if(rows.length < 2){ toast('CSV数据为空或只有表头', 'err'); return; }
      var headers = rows[0].map(function(h){ return (h||'').trim(); });
      var dataRows = rows.slice(1).filter(function(r){ return r.join('').trim() !== ''; });
      window._p7CsvParsed = { headers: headers, rows: dataRows, fileName: file.name };
      // auto-match similar column names
      window._p7CsvMapping = {};
      headers.forEach(function(h, idx){
        var hl = h.toLowerCase();
        P7_IMPORT_TARGETS.forEach(function(t){
          if(window._p7CsvMapping[idx]) return;
          var tl = t.key.toLowerCase();
          var kl = t.label.toLowerCase();
          if(hl.indexOf(tl) >= 0 || kl.indexOf(hl) >= 0 || hl.indexOf(kl.slice(0,2)) >= 0 ||
             (tl === 'email' && hl.indexOf('mail') >= 0) ||
             (tl === 'company' && (hl.indexOf('company') >= 0 || hl.indexOf('公司') >= 0 || hl.indexOf('企业') >= 0)) ||
             (tl === 'country' && (hl.indexOf('country') >= 0 || hl.indexOf('国家') >= 0 || hl.indexOf('region') >= 0))){
            window._p7CsvMapping[idx] = t.key;
          }
        });
      });
      toast('✅ 已解析 ' + dataRows.length + ' 行，请确认字段映射');
      renderView();
    };
    reader.readAsText(file, 'UTF-8');
  };

  window.p7SetCsvMapping = function(colIdx, targetKey){
    window._p7CsvMapping[colIdx] = targetKey || null;
  };

  window.p7SetConflictMode = function(m){ window._p7CsvConflictMode = m; };

  window.p7ConfirmImport = function(){
    var parsed = window._p7CsvParsed;
    if(!parsed){ toast('请先上传CSV文件', 'err'); return; }
    var map = window._p7CsvMapping || {};
    var mode = window._p7CsvConflictMode || 'skip';
    var created = 0, skipped = 0, updated = 0, conflicts = 0;

    parsed.rows.forEach(function(row){
      var rec = { contact:{}, products:[] };
      Object.keys(map).forEach(function(colIdx){
        var t = map[colIdx];
        if(!t) return;
        var val = row[colIdx] != null ? String(row[colIdx]).trim() : '';
        if(t === 'company') rec.company = val;
        else if(t === 'contactName') rec.contact.name = val;
        else if(t === 'contactTitle') rec.contact.title = val;
        else if(t === 'email') rec.contact.email = val;
        else if(t === 'phone') rec.contact.phone = val;
        else if(t === 'country') rec.country = val;
        else if(t === 'city') rec.city = val;
        else if(t === 'products') rec.products = val ? val.split(/[;；,，]/).filter(Boolean) : [];
        else if(t === 'website') rec.website = val;
        else if(t === 'notes') rec.notes = val;
      });
      if(!rec.company && !rec.contact.email){ skipped++; return; } // empty row

      // dedup by email
      var existing = null;
      if(rec.contact.email){
        existing = (S.customers||[]).find(function(c){
          var e = p7CustomerEmail(c);
          return e && e.toLowerCase() === rec.contact.email.toLowerCase();
        });
      }
      if(existing){
        conflicts++;
        if(mode === 'update'){
          if(!existing.contact) existing.contact = {};
          Object.assign(existing.contact, rec.contact);
          if(rec.country) existing.country = rec.country;
          if(rec.city) existing.city = rec.city;
          if(rec.website) existing.website = rec.website;
          if(rec.products && rec.products.length) existing.products = rec.products;
          updated++;
        } else if(mode === 'skip'){
          skipped++;
        } else { // mark
          existing.tags = existing.tags || [];
          if(existing.tags.indexOf('CSV冲突') < 0) existing.tags.push('CSV冲突');
          skipped++;
        }
      } else {
        rec.id = uid();
        rec.source = 'CSV导入';
        rec.status = '待跟进';
        rec.tags = ['CSV导入'];
        rec.createdAt = p7NowISO();
        rec.scores = rec.scores || {grade:'C'};
        S.customers.push(rec);
        created++;
      }
    });

    p7AddLog({ direction:'import', recordCount:created+updated, fileName:parsed.fileName, conflicts:conflicts, objectType:'customers', detail:'新增'+created+' 更新'+updated+' 跳过'+skipped });
    window._p7CsvParsed = null;
    window._p7CsvMapping = {};
    toast('✅ 导入完成：新增 ' + created + '，更新 ' + updated + '，跳过/冲突 ' + (skipped+conflicts));
    renderView();
  };

  window.p7CancelImport = function(){ window._p7CsvParsed = null; window._p7CsvMapping = {}; renderView(); };

  function p7RenderCsvPage(root){
    var h = '<div class="p7-page">';
    h += '<div class="p7-tabs">'
      + '<div class="p7-tab' + (window._p7CsvTab==='export'?' on':'') + '" onclick="p7SetCsvTab(\'export\')">📤 导出CSV</div>'
      + '<div class="p7-tab' + (window._p7CsvTab==='import'?' on':'') + '" onclick="p7SetCsvTab(\'import\')">📥 导入CSV</div>'
      + '<div class="p7-tab' + (window._p7CsvTab==='logs'?' on':'') + '" onclick="p7SetCsvTab(\'logs\')">📜 同步日志</div>'
      + '</div>';

    if(window._p7CsvTab === 'export'){
      h += '<div class="p7-panel"><div class="p7-panel-head">导出为 CSV（可直接导入 Google Sheets / 飞书多维表）</div>';
      // object picker
      h += '<div class="p7-seg">'
        + [['customers','👥 客户台账'],['drafts','✉️ 开发信草稿'],['sendRecords','📨 发送记录']].map(function(p){
          return '<div class="p7-segitem' + (window._p7ExpObject===p[0]?' on':'') + '" onclick="p7SetExpObject(\'' + p[0] + '\')">' + p[1] + '</div>';
        }).join('') + '</div>';
      // field checkboxes
      var fields = P7_EXPORT_FIELDS[window._p7ExpObject] || [];
      h += '<div class="p7-fieldgrid">';
      fields.forEach(function(f){
        h += '<label class="p7-check"><input type="checkbox" id="p7_exp_f_' + f.key + '" checked /> ' + esc(f.label) + '</label>';
      });
      h += '</div>';
      h += '<div class="p7-actions"><button class="btn btn-primary" onclick="p7DoExport()">📤 导出CSV（带BOM）</button>'
        + '<span class="p7-note">导出后可粘贴到 Google Sheets / 飞书多维表编辑，再用导入功能回流</span></div>';
      h += '</div>';
    }
    else if(window._p7CsvTab === 'import'){
      var parsed = window._p7CsvParsed;
      if(!parsed){
        h += '<div class="p7-panel"><div class="p7-panel-head">从 CSV 导入客户（Google Sheets / 飞书导出的CSV）</div>';
        h += '<div class="p7-drop"><input type="file" accept=".csv" onchange="p7OnCsvFile(this)" /></div>';
        h += '<div class="p7-note">支持引号包裹的含逗号字段；按邮箱自动去重。</div></div>';
      } else {
        // field mapping + preview
        h += '<div class="p7-panel"><div class="p7-panel-head">字段映射：' + esc(parsed.fileName) + ' <span class="p7-tag">' + parsed.rows.length + ' 行</span></div>';
        h += '<table class="p7-table"><thead><tr><th>CSV列名</th><th>→ 映射到客户字段</th></tr></thead><tbody>';
        parsed.headers.forEach(function(col, idx){
          h += '<tr><td>' + esc(col) + '</td><td><select class="p7-input p7-sel" onchange="p7SetCsvMapping(' + idx + ', this.value)">'
            + '<option value="">（不导入）</option>';
          P7_IMPORT_TARGETS.forEach(function(t){
            h += '<option value="' + t.key + '"' + (window._p7CsvMapping[idx]===t.key?' selected':'') + '>' + esc(t.label) + '</option>';
          });
          h += '</select></td></tr>';
        });
        h += '</tbody></table>';

        // preview 5 rows
        h += '<div class="p7-subhead">👁 预览前5行</div>';
        h += '<table class="p7-table p7-prev"><thead><tr>' + parsed.headers.map(function(x){ return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
        parsed.rows.slice(0,5).forEach(function(row){
          h += '<tr>' + row.map(function(cell){ return '<td>' + esc(String(cell).slice(0,30)) + '</td>'; }).join('') + '</tr>';
        });
        h += '</tbody></table>';

        // conflict mode
        h += '<div class="p7-subhead">⚠️ 冲突处理（按邮箱去重）</div>';
        h += '<div class="p7-seg">'
          + [['skip','跳过已存在'],['update','更新已有客户'],['mark','标记冲突标签']].map(function(p){
            return '<div class="p7-segitem' + (window._p7CsvConflictMode===p[0]?' on':'') + '" onclick="p7SetConflictMode(\'' + p[0] + '\')">' + p[1] + '</div>';
          }).join('') + '</div>';

        h += '<div class="p7-actions">'
          + '<button class="btn btn-primary" onclick="p7ConfirmImport()">✅ 确认导入 ' + parsed.rows.length + ' 行</button>'
          + '<button class="btn btn-outline" onclick="p7CancelImport()">取消</button></div>';
        h += '</div>';
      }
    }
    else { // logs
      var logs = (S.p7CsvSyncLogs||[]).slice().reverse();
      if(logs.length === 0){
        h += '<div class="p7-empty">暂无同步记录。导出或导入一次后会自动记录。</div>';
      } else {
        h += '<table class="p7-table"><thead><tr><th>方向</th><th>对象</th><th>记录数</th><th>文件名</th><th>冲突</th><th>时间</th></tr></thead><tbody>';
        logs.forEach(function(l){
          h += '<tr>'
            + '<td>' + (l.direction==='export'?'📤 导出':'📥 导入') + '</td>'
            + '<td>' + esc(l.objectType||'—') + '</td>'
            + '<td>' + (l.recordCount||0) + '</td>'
            + '<td class="p7-mono">' + esc(l.fileName||'—') + (l.detail ? '<br><small>'+esc(l.detail)+'</small>' : '') + '</td>'
            + '<td>' + (l.conflicts||0) + '</td>'
            + '<td>' + p7FmtDate(l.timestamp) + '</td>'
            + '</tr>';
        });
        h += '</tbody></table>';
      }
    }
    h += '</div>';
    root.innerHTML = h;
  }

  // ============================================================
  // Feature 30: Knowledge-base → GEO content mapping
  // ============================================================
  if(!window._p7GeoTab) window._p7GeoTab = 'generate';
  window.p7SetGeoTab = function(t){ window._p7GeoTab = t; renderView(); };
  window._p7GeoEditingId = null;

  function p7GeoCategories(){
    var f = S.companyFacts || {};
    if(f.categories && f.categories.length) return f.categories;
    return ['户外刀具', '厨房刀具', '剪刀', '厨房工具'];
  }

  window.p7GenGeoContent = async function(){
    var catEl = document.getElementById('p7_geo_cat');
    var typeEl = document.getElementById('p7_geo_type');
    if(!catEl || !typeEl){ toast('表单异常', 'err'); return; }
    var category = catEl.value;
    var ctype = typeEl.value;
    var f = S.companyFacts || {};
    var typeLabel = {product:'产品描述(product)', blog:'博客文章(blog)', landing:'落地页文案(landing)'}[ctype] || ctype;

    toast('AI 正在生成 ' + typeLabel + ' 内容…');
    var prompt = '你是B2B外贸独立站SEO内容专家，面向海外B2B买家。\n'
      + '【公司事实】品牌：' + (f.brandName||'KaiLionCrafts') + '；公司：' + (f.companyName||'阳江市锴利国际贸易有限公司')
      + '；业务模式：' + (f.businessModel||'OEM/ODM/Private Label')
      + '；品类：' + ((f.categories||[]).join(',') || '户外刀具、厨房刀具、剪刀、厨房工具') + '\n'
      + (f.certifications && f.certifications.length ? '认证：' + f.certifications.join(',') + '\n' : '')
      + (f.moq ? 'MOQ：' + f.moq + '\n' : '') + (f.leadTime ? '交期：' + f.leadTime + '\n' : '')
      + '【任务】为品类「' + category + '」生成一篇英文SEO' + typeLabel + '。\n'
      + '要求：Title 50-60字符；Meta Description 150-160字符；正文使用<h2>/<h3>标签的HTML片段，300-600词；专业自然；不要编造具体价格/数字/认证。\n'
      + '只输出JSON：{"title":"...","metaDescription":"...","content":"<h2>...</h2>...","keywords":["..."],"longtail":["..."]}。';

    try{
      var r = await callAI([{role:'user',content:prompt}], {purpose:'p7_geo', timeout:60000, temperature:0.3, model:'gpt-5.6-terra'});
      if(r.error){ toast('AI生成失败：' + (r.error||'未知错误'), 'err'); return; }
      var j = p7ParseAIJSON(r.content);
      if(!j || !j.title){ toast('AI返回格式异常', 'err'); return; }
      var rec = {
        id: uid(),
        category: category,
        contentType: ctype,
        title: String(j.title).slice(0,200),
        metaDescription: String(j.metaDescription||'').slice(0,300),
        content: String(j.content||''),
        keywords: (j.keywords||[]).slice(0,10),
        longtail: (j.longtail||[]).slice(0,10),
        status: 'generated',
        enrichHistory: [],
        createdAt: p7NowISO()
      };
      S.p7GeoContents.push(rec);
      persist(); toast('✅ 内容已生成，可在历史列表查看/丰富/优化');
      window._p7GeoTab = 'history';
      renderView();
    }catch(err){
      console.warn('[p7] geo gen failed', err);
      toast('生成出错：' + (err.message||err), 'err');
    }
  };

  // Enrich: AI adds keyword density, longtail, internal link suggestions
  window.p7EnrichGeo = async function(id){
    var rec = (S.p7GeoContents||[]).find(function(x){ return x.id === id; });
    if(!rec){ toast('内容不存在', 'err'); return; }
    toast('AI 正在丰富内容（关键词密度/长尾词/内链建议）…');
    var prompt = '你是B2B外贸SEO专家。请丰富以下已生成的' + (rec.contentType==='blog'?'博客':rec.contentType==='landing'?'落地页':'产品') + '内容：\n'
      + '品类：' + rec.category + '\n标题：' + rec.title + '\n正文：\n' + rec.content + '\n'
      + '任务：1) 自然增加目标关键词密度；2) 补充2-3个长尾词嵌入正文；3) 给出2-3条内部链接建议（锚文本+指向页面类型）。\n'
      + '只输出JSON：{"content":"...（完整新正文，含<h2><h3>）","addedLongtail":["..."],"internalLinks":[{"anchor":"...","pointsTo":"..."}],"notes":"..."}';
    try{
      var r = await callAI([{role:'user',content:prompt}], {purpose:'p7_geo', timeout:60000, temperature:0.4, model:'gpt-5.6-terra'});
      if(r.error){ toast('AI丰富失败：' + (r.error||'未知错误'), 'err'); return; }
      var j = p7ParseAIJSON(r.content);
      if(!j || !j.content){ toast('AI返回格式异常', 'err'); return; }
      var before = rec.content;
      rec.enrichHistory = rec.enrichHistory || [];
      rec.enrichHistory.push({ at:p7NowISO(), notes:j.notes||'', addedLongtail:(j.addedLongtail||[]).slice() });
      rec.content = String(j.content);
      rec.enrichedLongtail = (j.addedLongtail||[]).slice();
      rec.internalLinkSuggestions = (j.internalLinks||[]).slice();
      rec.status = 'enriched';
      persist(); toast('✅ 内容已丰富（可在历史中查看前后对比）'); renderView();
    }catch(err){ toast('丰富出错：' + (err.message||err), 'err'); }
  };

  // Optimize: deterministic SEO checklist score (local, no AI)
  function p7ScoreGeo(rec){
    var checks = [];
    var titleLen = (rec.title||'').length;
    checks.push({ name:'Title 长度 50-60 字符', pass: titleLen>=50 && titleLen<=60, detail:'当前 '+titleLen+' 字符', ok:'保持50-60', bad:'偏短或偏长' });
    var mdLen = (rec.metaDescription||'').length;
    checks.push({ name:'Meta Description 长度 150-160', pass: mdLen>=150 && mdLen<=160, detail:'当前 '+mdLen+' 字符', ok:'长度合适', bad:'调整到150-160字符' });
    var hasH1 = /<h1[\s>]/i.test(rec.content||'');
    checks.push({ name:'正文含唯一 H1', pass: hasH1, detail: hasH1?'已检测到H1':'未检测到H1', ok:'H1唯一且含主关键词', bad:'补充唯一H1并含主关键词' });
    var h2count = (rec.content.match(/<h2[\s>]/gi)||[]).length;
    checks.push({ name:'H2 层级清晰（≥2个H2）', pass: h2count>=2, detail:'检测到 '+h2count+' 个H2', ok:'层级合理', bad:'补充H2小节划分' });
    var h3count = (rec.content.match(/<h3[\s>]/gi)||[]).length;
    checks.push({ name:'H3 子层级', pass: h3count>=0, detail:'检测到 '+h3count+' 个H3', ok:'按需使用H3', bad:'在H2下补充H3要点' });
    var kw = (rec.keywords||[])[0] || '';
    var kwLower = (rec.content||'').toLowerCase();
    var kwCount = kw ? kwLower.split(kw.toLowerCase()).length - 1 : 0;
    checks.push({ name:'主关键词在正文中出现 3-8 次', pass: kwCount>=3 && kwCount<=8, detail:'出现 '+kwCount+' 次', ok:'密度合适', bad:'调整关键词密度' });
    checks.push({ name:'图片 alt 建议', pass: false, detail:'建议为配图撰写含关键词的alt', ok:'已规划alt', bad:'为每张产品图写描述性alt' });
    checks.push({ name:'内部链接建议', pass: (rec.internalLinkSuggestions||[]).length>0, detail:(rec.internalLinkSuggestions||[]).length+' 条建议', ok:'内链已规划', bad:'在正文插入2-3条内链锚文本' });
    var passed = checks.filter(function(c){ return c.pass; }).length;
    var score = Math.round(passed / checks.length * 100);
    return { checks: checks, score: score };
  }

  window.p7ScoreGeoContent = function(id){
    window._p7GeoScoreId = id;
    renderView();
  };

  window.p7DelGeo = function(id){
    S.p7GeoContents = (S.p7GeoContents||[]).filter(function(x){ return x.id !== id; });
    persist(); toast('已删除内容'); renderView();
  };

  window.p7EditGeo = function(id){
    window._p7GeoEditingId = (window._p7GeoEditingId === id) ? null : id;
    renderView();
  };

  window.p7SaveGeoEdit = function(id){
    var rec = (S.p7GeoContents||[]).find(function(x){ return x.id === id; });
    if(!rec) return;
    var tEl = document.getElementById('p7_geo_edit_title_'+id);
    var mEl = document.getElementById('p7_geo_edit_meta_'+id);
    var cEl = document.getElementById('p7_geo_edit_content_'+id);
    if(tEl) rec.title = tEl.value;
    if(mEl) rec.metaDescription = mEl.value;
    if(cEl) rec.content = cEl.value;
    window._p7GeoEditingId = null;
    persist(); toast('✅ 内容已保存'); renderView();
  };

  window.p7ExportGeo = function(id, fmt){
    var rec = (S.p7GeoContents||[]).find(function(x){ return x.id === id; });
    if(!rec) return;
    var blob, a;
    if(fmt === 'md'){
      var md = '# ' + rec.title + '\n\n'
        + '**Meta Description:** ' + rec.metaDescription + '\n\n'
        + '**Keywords:** ' + (rec.keywords||[]).join(', ') + '\n\n'
        + '**Long-tail:** ' + (rec.longtail||[]).join(', ') + '\n\n---\n\n'
        + rec.content.replace(/<[^>]+>/g, '') + '\n';
      blob = new Blob([md], {type:'text/markdown;charset=utf-8'});
      a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (rec.title||'geo-content').replace(/[\\/:*?"<>|]/g,'_').slice(0,60) + '.md';
    } else {
      var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(rec.title) + '</title>'
        + '<meta name="description" content="' + esc(rec.metaDescription) + '"></head><body>'
        + '<h1>' + esc(rec.title) + '</h1>' + rec.content + '</body></html>';
      blob = new Blob([html], {type:'text/html;charset=utf-8'});
      a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (rec.title||'geo-content').replace(/[\\/:*?"<>|]/g,'_').slice(0,60) + '.html';
    }
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('✅ 已导出 ' + fmt.toUpperCase());
  };

  function p7RenderGeoPage(root){
    var cats = p7GeoCategories();
    var h = '<div class="p7-page">';
    h += '<div class="p7-tabs">'
      + '<div class="p7-tab' + (window._p7GeoTab==='generate'?' on':'') + '" onclick="p7SetGeoTab(\'generate\')">✨ 生成 Generate</div>'
      + '<div class="p7-tab' + (window._p7GeoTab==='history'?' on':'') + '" onclick="p7SetGeoTab(\'history\')">🗂 历史/丰富/优化</div>'
      + '</div>';

    if(window._p7GeoTab === 'generate'){
      h += '<div class="p7-panel"><div class="p7-panel-head">AI 生成 SEO 内容草稿</div>';
      h += '<div class="p7-form-grid">'
        + '<label class="p7-field"><span>产品品类</span><select class="p7-input" id="p7_geo_cat">';
      cats.forEach(function(c){ h += '<option value="' + esc(c) + '">' + esc(c) + '</option>'; });
      h += '</select></label>'
        + '<label class="p7-field"><span>内容类型</span><select class="p7-input" id="p7_geo_type">'
        + '<option value="product">产品描述 product</option>'
        + '<option value="blog">博客文章 blog</option>'
        + '<option value="landing">落地页文案 landing</option>'
        + '</select></label></div>';
      h += '<div class="p7-actions"><button class="btn btn-primary" onclick="p7GenGeoContent()">✨ AI 生成内容</button>'
        + '<span class="p7-note">自动注入公司事实（S.companyFacts），输出Title/Meta/正文/关键词/长尾词</span></div>';
      h += '</div>';
    }
    else {
      var list = (S.p7GeoContents||[]).slice().reverse();
      if(list.length === 0){
        h += '<div class="p7-empty">还没有生成任何GEO内容。从"生成"开始。</div>';
      } else {
        list.forEach(function(rec){
          var scoring = p7ScoreGeo(rec);
          var editing = window._p7GeoEditingId === rec.id;
          var showScore = window._p7GeoScoreId === rec.id;
          h += '<div class="p7-geo-card">';
          h += '<div class="p7-geo-head"><b>' + esc(rec.title) + '</b>'
            + '<span class="p7-badge blue">' + esc(rec.category) + '</span>'
            + '<span class="p7-badge gray">' + esc(rec.contentType) + '</span>'
            + '<span class="p7-badge ' + (rec.status==='enriched'?'green':'blue') + '">' + esc(rec.status) + '</span>'
            + '<span class="p7-score-circle s' + (scoring.score>=80?'g':scoring.score>=60?'y':'r') + '">' + scoring.score + '</span></div>';
          h += '<div class="p7-geo-meta">📅 ' + p7FmtDate(rec.createdAt) + ' · 关键词：' + esc((rec.keywords||[]).join(', ')) + '</div>';

          if(editing){
            h += '<div class="p7-editbox">'
              + '<label class="p7-field"><span>Title</span><input class="p7-input" id="p7_geo_edit_title_'+rec.id+'" value="' + esc(rec.title) + '" /></label>'
              + '<label class="p7-field"><span>Meta Description</span><input class="p7-input" id="p7_geo_edit_meta_'+rec.id+'" value="' + esc(rec.metaDescription) + '" /></label>'
              + '<label class="p7-field"><span>正文（HTML）</span><textarea class="p7-input" rows="6" id="p7_geo_edit_content_'+rec.id+'">' + esc(rec.content) + '</textarea></label>'
              + '<div class="p7-actions"><button class="btn btn-primary" onclick="p7SaveGeoEdit(\''+rec.id+'\')">💾 保存</button>'
              + '<button class="btn btn-outline" onclick="p7EditGeo(\''+rec.id+'\')">取消</button></div></div>';
          } else {
            h += '<div class="p7-geo-body">' + rec.content + '</div>';
          }

          if(showScore){
            h += '<div class="p7-checklist">';
            scoring.checks.forEach(function(c){
              h += '<div class="p7-check ' + (c.pass?'ok':'bad') + '">' + (c.pass?'✅':'⚠️') + ' ' + esc(c.name)
                + ' <small>(' + esc(c.detail) + ')</small> — ' + (c.pass?esc(c.ok):esc(c.bad)) + '</div>';
            });
            h += '</div>';
          }

          h += '<div class="p7-actions">'
            + '<button class="btn btn-sm btn-primary" onclick="p7EnrichGeo(\''+rec.id+'\')">✨ Enrich 丰富</button>'
            + '<button class="btn btn-sm btn-outline" onclick="p7ScoreGeoContent(\''+rec.id+'\')">🔍 Optimize 优化评分</button>'
            + '<button class="btn btn-sm btn-outline" onclick="p7EditGeo(\''+rec.id+'\')">✏️ 编辑</button>'
            + '<button class="btn btn-sm btn-outline" onclick="p7ExportGeo(\''+rec.id+'\',\'md\')">⬇️ MD</button>'
            + '<button class="btn btn-sm btn-outline" onclick="p7ExportGeo(\''+rec.id+'\',\'html\')">⬇️ HTML</button>'
            + '<button class="btn btn-sm btn-outline" onclick="p7DelGeo(\''+rec.id+'\')">🗑 删除</button>'
            + '</div>';
          h += '</div>';
        });
      }
      h += '<div class="p7-geo-foot">💡 以上内容可直接用于 <b>kailioncrafts.com</b> 独立站产品页 / 博客 / 落地页（GEO: Generate → Enrich → Optimize）。</div>';
    }
    h += '</div>';
    root.innerHTML = h;
  }

  // ============================================================
  // Feature 33: Visual workflow editor (simplified)
  // ============================================================
  if(!window._p7WfTab) window._p7WfTab = 'progress';
  window.p7SetWfTab = function(t){ window._p7WfTab = t; renderView(); };
  if(!window._p7WfCustId && (S.customers||[])[0]) window._p7WfCustId = S.customers[0].id;

  // local template create/edit (operates on shared S.p6Sequences)
  window.p7WfNewTemplate = function(){
    S.p6Sequences.push({
      id: uid(),
      name: '新建序列 ' + (S.p6Sequences.length + 1),
      isDefault: false,
      steps: [ {day:1,label:'首次触达'}, {day:3,label:'跟进1'}, {day:7,label:'跟进2'} ],
      createdAt: p7NowISO()
    });
    persist(); renderView();
  };

  window.p7WfSaveTemplate = function(seqId){
    var seq = (S.p6Sequences||[]).find(function(s){ return s.id === seqId; });
    if(!seq) return;
    var nameEl = document.getElementById('p7_wf_tpl_name_'+seqId);
    if(nameEl) seq.name = nameEl.value.trim() || seq.name;
    var steps = [];
    for(var i=0;i<12;i++){
      var dEl = document.getElementById('p7_wf_tpl_day_'+seqId+'_'+i);
      var lEl = document.getElementById('p7_wf_tpl_label_'+seqId+'_'+i);
      if(!dEl) break;
      var day = parseInt(dEl.value,10);
      if(isNaN(day) || day<0) day = 1;
      steps.push({ day:day, label:(lEl&&lEl.value)||('Step '+(i+1)) });
    }
    if(steps.length===0){ toast('至少需要1个步骤','err'); return; }
    seq.steps = steps;
    persist(); toast('✅ 序列模板已保存'); renderView();
  };

  window.p7WfDelTemplate = function(seqId){
    var used = (S.p6SequenceAssignments||[]).some(function(a){ return a.sequenceId === seqId; });
    if(used){ toast('该序列已被客户使用，无法删除','err'); return; }
    S.p6Sequences = (S.p6Sequences||[]).filter(function(s){ return s.id !== seqId; });
    persist(); toast('已删除模板'); renderView();
  };

  window.p7WfSetCust = function(cid){ window._p7WfCustId = cid; renderView(); };

  window.p7WfAssign = function(){
    var cid = window._p7WfCustId;
    var sEl = document.getElementById('p7_wf_assign_seq');
    if(!cid || !sEl || !sEl.value){ toast('请选择客户和序列','err'); return; }
    // reuse phase6 assignment if available, else local simplified assign
    if(typeof window.p6AssignSequence === 'function'){
      window.p6AssignSequence(cid, sEl.value);
    } else {
      var seq = (S.p6Sequences||[]).find(function(s){ return s.id === sEl.value; });
      var c = p7FindCustomer(cid);
      if(!seq || !c){ toast('客户或序列不存在','err'); return; }
      var start = p7NowISO();
      (S.p6SequenceAssignments||[]).push({
        id: uid(), customerId: cid, customerName: c.company,
        sequenceId: seq.id, sequenceName: seq.name, currentStep: 0,
        startDate: start, status: 'active',
        steps: seq.steps.map(function(st,i){ return { step:i, dueDate:start, status:'pending' }; }),
        createdAt: start
      });
      persist(); toast('✅ 已分配序列'); renderView();
    }
  };

  function p7WfRenderTemplates(){
    var h = '<div class="p7-panel"><div class="p7-panel-head">📋 序列模板管理 <button class="btn btn-sm btn-outline" onclick="p7WfNewTemplate()">+ 新建模板</button></div>';
    (S.p6Sequences||[]).forEach(function(seq){
      h += '<div class="p7-tpl-card">';
      h += '<input class="p7-input" id="p7_wf_tpl_name_'+seq.id+'" value="' + esc(seq.name) + '" />';
      h += '<div class="p7-tpl-steps">';
      seq.steps.forEach(function(st,i){
        h += '<div class="p7-tpl-step"><span class="p7-stepno">Step'+(i+1)+'</span>'
          + '<input class="p7-input p7-day" type="number" min="0" id="p7_wf_tpl_day_'+seq.id+'_'+i+'" value="'+st.day+'" />'
          + '<span class="p7-daylbl">天</span>'
          + '<input class="p7-input p7-lbl" id="p7_wf_tpl_label_'+seq.id+'_'+i+'" value="'+esc(st.label||'')+'" />'
          + '</div>';
      });
      h += '</div>';
      h += '<div class="p7-actions">'
        + '<button class="btn btn-sm btn-primary" onclick="p7WfSaveTemplate(\''+seq.id+'\')">💾 保存</button>'
        + '<button class="btn btn-sm btn-outline" onclick="p7WfDelTemplate(\''+seq.id+'\')">🗑 删除</button>'
        + (seq.isDefault?'<span class="p7-tag">默认</span>':'')
        + '</div></div>';
    });
    h += '</div>';
    return h;
  }

  function p7WfRenderProgress(){
    var cid = window._p7WfCustId;
    var c = p7FindCustomer(cid);
    var h = '<div class="p7-panel"><div class="p7-panel-head">👤 选择客户查看跟进进度</div>';
    h += '<select class="p7-input p7-sel" onchange="p7WfSetCust(this.value)">';
    (S.customers||[]).forEach(function(x){
      h += '<option value="'+x.id+'"'+(x.id===cid?' selected':'')+'>'+esc(x.company)+'</option>';
    });
    h += '</select></div>';

    if(!c){ return h + '<div class="p7-empty">未选择客户</div></div>'; }

    // find latest assignment for this customer (any status)
    var assigns = (S.p6SequenceAssignments||[]).filter(function(a){ return a.customerId === cid; });
    assigns.sort(function(a,b){ return new Date(b.createdAt) - new Date(a.createdAt); });
    var a = assigns[0];

    if(!a){
      h += '<div class="p7-panel"><div class="p7-empty">📭 ' + esc(c.company) + ' 还未分配任何跟进序列。</div>';
      h += '<div class="p7-assignbar"><select class="p7-input p7-sel" id="p7_wf_assign_seq">';
      (S.p6Sequences||[]).forEach(function(s){ h += '<option value="'+s.id+'">'+esc(s.name)+'</option>'; });
      h += '</select><button class="btn btn-primary" onclick="p7WfAssign()">▶ 分配并开始</button></div>';
      h += '</div>';
      return h + '</div>';
    }

    // visual timeline
    h += '<div class="p7-panel"><div class="p7-panel-head">' + esc(c.company) + ' · <span class="p7-tag">' + esc(a.sequenceName) + '</span> '
      + p7WfStatusBadge(a.status) + '</div>';
    h += '<div class="p7-wf-timeline">';
    a.steps.forEach(function(st, i){
      var cls = 'p7-wf-node';
      var icon = '○';
      if(st.status === 'done'){ cls += ' done'; icon = '✓'; }
      else if(a.status==='active' && i === a.currentStep){ cls += ' cur'; icon = '●'; }
      else { cls += ' future'; icon = '○'; }
      h += '<div class="'+cls+'">'
        + '<div class="p7-wf-dot">'+icon+'</div>'
        + '<div class="p7-wf-info"><b>Step'+(i+1)+' · '+esc((a.steps[i].label)||'跟进')+'</b>'
        + '<div class="p7-wf-date">计划：' + p7FmtDate(st.dueDate) + '</div>'
        + '<div class="p7-wf-status">' + (st.status==='done'?'已完成':(i===a.currentStep&&a.status==='active'?'进行中':'待开始')) + '</div>'
        + '</div></div>';
    });
    h += '</div>';
    h += '<div class="p7-actions"><span class="p7-note">开始于 ' + p7FmtDate(a.startDate) + ' · 当前第 ' + (a.currentStep+1) + '/' + a.steps.length + ' 步</span></div>';
    h += '</div>';
    return h + '</div>';
  }

  function p7WfStatusBadge(s){
    if(s==='active') return '<span class="p7-badge blue">进行中</span>';
    if(s==='completed') return '<span class="p7-badge green">已完成</span>';
    if(s==='cooldown') return '<span class="p7-badge gray">冷却</span>';
    return '<span class="p7-badge gray">'+esc(s)+'</span>';
  }

  function p7WfRenderStats(){
    var seqs = S.p6Sequences || [];
    var assigns = S.p6SequenceAssignments || [];
    var active = assigns.filter(function(a){ return a.status==='active'; });
    var done = assigns.filter(function(a){ return a.status==='completed'; });
    var avgSteps = assigns.length
      ? Math.round(assigns.reduce(function(s,a){ return s + (a.currentStep||0); },0) / assigns.length * 10) / 10
      : 0;
    var h = '<div class="p7-stats">'
      + '<div class="p7-stat"><div class="p7-stat-num">'+seqs.length+'</div><div class="p7-stat-lbl">📋 序列模板总数</div></div>'
      + '<div class="p7-stat"><div class="p7-stat-num">'+active.length+'</div><div class="p7-stat-lbl">🔄 进行中客户</div></div>'
      + '<div class="p7-stat"><div class="p7-stat-num">'+done.length+'</div><div class="p7-stat-lbl">✅ 已完成序列</div></div>'
      + '<div class="p7-stat"><div class="p7-stat-num">'+avgSteps+'</div><div class="p7-stat-lbl">📈 平均完成步数</div></div>'
      + '</div>';
    return h;
  }

  function p7RenderWfPage(root){
    var h = '<div class="p7-page">';
    h += '<div class="p7-stats">' + p7WfRenderStats() + '</div>';
    h += '<div class="p7-tabs">'
      + '<div class="p7-tab' + (window._p7WfTab==='progress'?' on':'') + '" onclick="p7SetWfTab(\'progress\')">📊 跟进进度时间轴</div>'
      + '<div class="p7-tab' + (window._p7WfTab==='templates'?' on':'') + '" onclick="p7SetWfTab(\'templates\')">📋 序列模板</div>'
      + '</div>';
    if(window._p7WfTab === 'templates') h += p7WfRenderTemplates();
    else h += p7WfRenderProgress();
    h += '</div>';
    root.innerHTML = h;
  }

  // ============================================================
  // renderView interception (4 views chained)
  // ============================================================
  var _origRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'invoiceGenerator'){ p7RenderInvoicePage(document.getElementById('mainContent')); return; }
    if(currentView === 'csvSync'){ p7RenderCsvPage(document.getElementById('mainContent')); return; }
    if(currentView === 'geoContent'){ p7RenderGeoPage(document.getElementById('mainContent')); return; }
    if(currentView === 'workflowVisual'){ p7RenderWfPage(document.getElementById('mainContent')); return; }
    _origRV.apply(this, arguments);
  };

  // ============================================================
  // Styles (all p7- prefixed, responsive)
  // ============================================================
  var style = document.createElement('style');
  style.textContent = ''
    + '.p7-page{padding:4px;}'
    + '.p7-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}'
    + '.p7-tab{padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;color:#4a5568;}'
    + '.p7-tab.on{background:#3182ce;color:#fff;border-color:#3182ce;font-weight:600;}'
    + '.p7-panel{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px;}'
    + '.p7-panel-head{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}'
    + '.p7-subhead{font-size:13px;font-weight:700;color:#2d3748;margin:14px 0 8px;}'
    + '.p7-form-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:10px;}'
    + '.p7-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#718096;}'
    + '.p7-input{width:100%;padding:6px 8px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;box-sizing:border-box;font-family:inherit;}'
    + 'textarea.p7-input{resize:vertical;}'
    + '.p7-sel{width:auto !important;flex:1;min-width:140px;}'
    + '.p7-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;}'
    + '.p7-note{font-size:12px;color:#718096;}'
    + '.p7-tag{font-size:11px;padding:2px 8px;border-radius:10px;background:#edf2f7;color:#4a5568;}'
    + '.p7-badge{font-size:11px;padding:2px 10px;border-radius:10px;font-weight:600;color:#fff;display:inline-block;}'
    + '.p7-badge.blue{background:#3182ce;}.p7-badge.green{background:#38a169;}.p7-badge.gray{background:#a0aec0;}'
    + '.p7-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:13px;margin-bottom:12px;}'
    + '.p7-table th{background:#f7fafc;text-align:left;padding:8px 10px;font-size:12px;color:#718096;border-bottom:1px solid #e2e8f0;}'
    + '.p7-table td{padding:8px 10px;border-bottom:1px solid #edf2f7;vertical-align:middle;}'
    + '.p7-mono{font-family:Menlo,monospace;font-size:12px;}'
    + '.p7-op{white-space:nowrap;}'
    + '.p7-empty{padding:40px;text-align:center;color:#718096;background:#f7fafc;border:1px dashed #cbd5e0;border-radius:10px;}'
    // invoice items
    + '.p7-items-head{display:flex;justify-content:space-between;align-items:center;margin:12px 0 8px;font-weight:700;font-size:13px;}'
    + '.p7-items input{min-width:0;}'
    + '.p7-sub{font-family:Menlo,monospace;font-weight:600;}'
    + '.p7-grand{font-weight:800;font-size:15px;color:#2d3748;text-align:right;}'
    + '.p7-bank-preview{margin-top:12px;font-size:12px;color:#4a5568;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;}'
    // segmented control
    + '.p7-seg{display:inline-flex;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:12px;}'
    + '.p7-segitem{padding:6px 14px;font-size:12px;cursor:pointer;background:#fff;color:#4a5568;}'
    + '.p7-segitem.on{background:#3182ce;color:#fff;font-weight:600;}'
    + '.p7-fieldgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px;}'
    + '.p7-check{font-size:13px;color:#4a5568;display:flex;align-items:center;gap:6px;}'
    + '.p7-drop{border:2px dashed #cbd5e0;border-radius:10px;padding:30px;text-align:center;margin:10px 0;}'
    + '.p7-prev{font-size:12px;}'
    // GEO
    + '.p7-geo-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:12px;}'
    + '.p7-geo-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}'
    + '.p7-geo-meta{font-size:12px;color:#718096;margin:6px 0;}'
    + '.p7-geo-body{font-size:13px;color:#2d3748;line-height:1.7;background:#f7fafc;border-radius:8px;padding:10px;margin:8px 0;}'
    + '.p7-geo-body h2{font-size:16px;margin:10px 0 6px;color:#2d3748;}'
    + '.p7-geo-body h3{font-size:14px;margin:8px 0 4px;color:#4a5568;}'
    + '.p7-score-circle{margin-left:auto;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:14px;}'
    + '.p7-score-circle.sg{background:#38a169;}.p7-score-circle.sy{background:#d69e2e;}.p7-score-circle.sr{background:#e53e3e;}'
    + '.p7-checklist{margin:10px 0;display:flex;flex-direction:column;gap:4px;}'
    + '.p7-check{font-size:12px;padding:5px 8px;border-radius:6px;}'
    + '.p7-check.ok{background:#f0fff4;color:#22543d;}'
    + '.p7-check.bad{background:#fff5f5;color:#742a2a;}'
    + '.p7-check small{color:#718096;}'
    + '.p7-editbox{background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin:8px 0;display:flex;flex-direction:column;gap:8px;}'
    + '.p7-geo-foot{font-size:12px;color:#718096;text-align:center;margin-top:8px;padding:10px;}'
    // workflow visual
    + '.p7-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}'
    + '.p7-stat{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;}'
    + '.p7-stat-num{font-size:24px;font-weight:700;color:#2d3748;}'
    + '.p7-stat-lbl{font-size:12px;color:#718096;margin-top:2px;}'
    + '.p7-tpl-card{border:1px solid #edf2f7;border-radius:8px;padding:10px;margin-bottom:10px;background:#fafcff;}'
    + '.p7-tpl-steps{margin:8px 0;display:flex;flex-direction:column;gap:5px;}'
    + '.p7-tpl-step{display:flex;align-items:center;gap:6px;font-size:12px;}'
    + '.p7-stepno{width:44px;color:#718096;font-weight:600;}'
    + '.p7-day{width:60px;}'
    + '.p7-daylbl{color:#a0aec0;}'
    + '.p7-lbl{flex:1;}'
    + '.p7-assignbar{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}'
    + '.p7-wf-timeline{display:flex;flex-direction:column;gap:0;margin:14px 0;}'
    + '.p7-wf-node{display:flex;gap:12px;position:relative;padding-bottom:18px;}'
    + '.p7-wf-node:not(:last-child)::before{content:"";position:absolute;left:13px;top:26px;bottom:0;width:2px;background:#e2e8f0;}'
    + '.p7-wf-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;background:#e2e8f0;color:#fff;z-index:1;}'
    + '.p7-wf-node.done .p7-wf-dot{background:#38a169;}'
    + '.p7-wf-node.cur .p7-wf-dot{background:#3182ce;box-shadow:0 0 0 4px rgba(49,130,206,.2);}'
    + '.p7-wf-node.future .p7-wf-dot{background:#cbd5e0;}'
    + '.p7-wf-info{font-size:13px;padding-top:3px;}'
    + '.p7-wf-date{font-size:11px;color:#718096;}'
    + '.p7-wf-status{font-size:11px;color:#4a5568;}'
    // responsive
    + '@media (max-width:768px){'
    + '  .p7-stats{grid-template-columns:repeat(2,1fr);}'
    + '  .p7-form-grid{grid-template-columns:1fr;}'
    + '  .p7-fieldgrid{grid-template-columns:1fr 1fr;}'
    + '  .p7-table{display:block;overflow-x:auto;}'
    + '  .p7-actions{flex-direction:column;align-items:stretch;}'
    + '  .p7-assignbar{flex-direction:column;}'
    + '  .p7-sel{width:100% !important;}'
    + '}'
    ;
  document.head.appendChild(style);
})();
