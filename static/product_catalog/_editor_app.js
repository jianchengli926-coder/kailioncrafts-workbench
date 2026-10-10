/* ===================================================================
   KaiLionCrafts 产品目录编辑器 v2 —— 应用逻辑
   -------------------------------------------------------------------
   v1 → v2 的变化：
   1. **4 本 → 8 本**：4 品类（厨刀含单刀+套刀 / 剪刀 / 厨房配件 / 户外刀）× 公开版/报价版，
      共 8 个功能栏（按 4 个品类分组显示）—— 2026-10-05 由 10 本 5 品类合并而来
   2. **数据层外置**：源目录用明文 `data/catalog.json`（本机脚本与 file:// 都读它）；
      **线上只发随机名 + AES-256-GCM 加密的 `data/kc-<TOKEN>.json`**（见 loadData）。
      fetch 优先，file:// 双击打开时自动回退到 `<script src="data/…js">`。
   3. **规格校准报告**：173 条已改 + 50 条待实测，编辑器里可查
   4. **H 盘图库**：卡片带 hlib 候选图（H:/上品sku），可在选图弹窗里切
   5. **verify 徽章**：待实测的规格黄色高亮，绝不擅自改

   ⚠️ 铁律：图片零压缩。内置 img/ 走相对路径原图字节；新上传存 IndexedDB
      原始 Blob（不经过 canvas 重编码）；打印前 blob → dataURL。
   =================================================================== */
(function () {
  'use strict';

  var PER_PAGE = 9;              // 3 列 × 3 行
  var LS_PREFIX = 'kc_editor_v2_';
  var PLACE = 'Yangjiang';     // FOB 交货地，报价页口径用

  /* ---------------------------------------------------------------- 状态 */
  var DATA = null;               // catalog.json 内容
  var LIB = null;                // _imgindex.json（内置图库索引）
  var CLOUD_FLAGS = null;        // ☁️ 云端每册的页签开关（load 时随 __flags 一起回来）
  var CLOUD_LOADED = false;      // ☁️ 本次启动的数据**确实来自云端** ⇒ 本地快照不许覆盖它
  var LIB_FAIL = false;          // 图库两条路都断了 → 只提示一次，不再递归重试
  var CALIB = null;              // calibration.json（规格校准数据）
  var CALIB_FAIL = false;        // 同上，避免谎报「文件不存在」
  var BOOKS = [];
  var S = {
    book: '', books: {}, sel: 0, q: '',
    undo: [], redo: [], pvScale: 0.38, exporting: false
  };

  var CAT_ORDER = ['knives', 'sets', 'scissors', 'accessories', 'outdoor'];

  /* ==================================================================
     算价引擎
     -------------------------------------------------------------------
     折扣比例来自全库实测：246 个 SKU **无一例外**都是
        500–999 = FOB × 0.94   （让 6%）
        1,000+  = FOB × 0.88   （让 12%）
     HTS 规则来自全库统计（只有 7 个码），按「品类 + 段码」映射。
     ⚠️ 规则只作默认值，随时可手改；关掉勾选就不再自动覆盖。
     ================================================================== */
  var DISC_T1 = 0.94, DISC_T2 = 0.88;
  var HTS_LIST = ['8211.92.00', '8211.10.00', '8213.00.00', '8215.20.00',
                  '8215.99.00', '4419.19.00'];
  /* [品类, 段码正则, HTS] —— 段码取 SKU 倒数第二段（KL-KN-SET-SS-001 → SS） */
  var HTS_RULES = [
    [/SET/,        /^SS$/,     '8211.10.00'],   // 套刀套装
    [/SET/,        null,       '8211.10.00'],
    [/SC/,         null,       '8213.00.00'],   // 剪刀
    [/OD/,         null,       '8211.92.00'],   // 户外刀
    [/KN/,         null,       '8211.92.00'],   // 厨刀
    // 厨房配件按段码细分
    [/KA/,         /^CB$/,     '4419.19.00'],   // 砧板 = 木制品
    [/KA/,         /^BBQ$|^TG$/, '8215.20.00'],  // 烧烤/工具 = 餐具
    [/KA/,         null,       '8215.99.00']    // 其余配件
  ];
  function segOfSku(sku) {
    var p = String(sku || '').split('-').filter(Boolean);
    if (p.length < 3) return '';
    var s = p[p.length - 2];
    return /^[A-Z]+$/.test(s) ? s : '';
  }
  function autoHts(cat, sku) {
    var seg = segOfSku(sku);
    for (var i = 0; i < HTS_RULES.length; i++) {
      var r = HTS_RULES[i];
      if (!r[0].test(cat)) continue;
      if (r[1] && !r[1].test(seg)) continue;
      return r[2];
    }
    return '';
  }
  function numOf(v) {
    var m = /-?[\d.]+/.exec(String(v == null ? '' : v));
    if (!m) return null;
    var n = parseFloat(m[0]);
    return isNaN(n) ? null : n;
  }
  /* 保留用户输入的精度习惯：输入 1.2 → 输出 1.13（2 位）；输入 39.00 → 36.66（2 位） */
  function money2(n) { return (Math.round(n * 100) / 100).toFixed(2); }
  function thousand(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  /* 根据 FOB 重算三档，并更新锁标与试算条 */
  function recalcPrice(c) {
    if (!c) return;
    var p = c.price = c.price || { fob: '', t1: '', t2: '', hts: '', lead: '30–45 days' };
    var f = numOf(p.fob);
    var elT1 = $('pT1'), elT2 = $('pT2'), elInfo = $('calcInfo');
    var auto = $('ckAuto') ? $('ckAuto').checked : true;
    if (f === null) {
      if (elT1) elT1.value = p.t1 = p.t1 || '';
      if (elT2) elT2.value = p.t2 = p.t2 || '';
      if (elInfo) elInfo.textContent = '先填 FOB 单价';
      setLock('lkT1', false, auto); setLock('lkT2', false, auto);
      updateMini(null, null);
      return;
    }
    if (auto) {
      p.t1 = money2(f * DISC_T1);
      p.t2 = money2(f * DISC_T2);
      if (elT1) elT1.value = p.t1;
      if (elT2) elT2.value = p.t2;
    }
    setLock('lkT1', auto, auto); setLock('lkT2', auto, auto);
    if (elInfo) elInfo.textContent = auto
      ? ('FOB ' + money2(f) + ' → ×0.94 / ×0.88')
      : '自动已关，手动填价';
    updateMini(numOf(p.t1), numOf(p.t2));
  }
  function setLock(id, locked, auto) {
    var el = $(id);
    if (!el) return;
    el.textContent = locked ? '🔒' : (auto ? '🔓' : '✎');
    el.title = locked ? '自动计算中（关掉勾选可手改）'
                       : (auto ? '自动但没算出（FOB 为空）' : '手动填写');
  }
  function updateMini(t1, t2) {
    var a = $('calcA'), b = $('calcB');
    if (!a || !b) return;
    a.textContent = t1 === null ? '—' : thousand(t1 * 1000);
    b.textContent = t2 === null ? '—' : thousand(t2 * 5000);
  }
  function recalcHts(c) {
    if (!c) return;
    var p = c.price = c.price || {};
    var auto = $('ckAutoHts') ? $('ckAutoHts').checked : true;
    if (!auto) { setLock('lkHts', false, false); return; }
    var h = autoHts(c.cat || '', c.sku || '');
    if (h) {
      p.hts = h;
      var el = $('pHts');
      if (el && document.activeElement !== el) el.value = h;
    }
    setLock('lkHts', true, true);
  }

  /* ---------------------------------------------------------------- 工具 */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function money(v) {
    if (v === '' || v == null || isNaN(parseFloat(v))) return '—';
    return '$' + parseFloat(v).toFixed(2);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* SKU 序号补零：111→'111'，8→'008'（SKU 命名 KL-<品类>-<段码>-<3位>） */
  function pad3(n) { n = Math.max(0, Math.floor(Number(n) || 0)); return (n < 100 ? (n < 10 ? '00' : '0') : '') + n; }
  function year() { return new Date().getFullYear(); }
  function issue() {
    var d = new Date();
    var M = ['January','February','March','April','May','June','July','August',
             'September','October','November','December'];
    return M[d.getMonth()] + ' ' + d.getFullYear();
  }
  function uid(p) {
    return p + '_' + Date.now().toString(36) + '_' +
           Math.floor(Math.random() * 1e6).toString(36);
  }
  /* Windows 绝对路径 → file:/// URL（H 盘候选图要用）
     ⚠️ 必须是 file:///H:/path（三斜杠 + 盘符带冒号 + 斜杠），
        写成 file:///H/path 会 ERR_FILE_NOT_FOUND；盘符也不能 encodeURIComponent。 */
  function toFileUrl(p) {
    if (!p) return '';
    if (/^(https?:|data:|blob:|idb:)/i.test(p)) return p;
    var s = String(p).replace(/\\/g, '/');
    if (/^file:/i.test(s)) return s;
    var m = s.match(/^([A-Za-z]):\/(.*)$/);
    if (m) return 'file:///' + m[1].toUpperCase() + ':/' +
      m[2].split('/').map(encodeURIComponent).join('/');
    return s.split('/').map(encodeURIComponent).join('/');
  }

  /* ---------------------------------------------------------------- toast */
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, ms || 2400);
  }

  /* ---------------------------------------------------------------- 弹窗 */
  function modal(title, bodyHtml, footHtml, wide) {
    $('mdTitle').textContent = title;
    $('mdBody').innerHTML = bodyHtml;
    $('mdFoot').innerHTML = footHtml || '<button data-mc="1">关闭</button>';
    $('modal').className = 'modal' + (wide ? ' wide' : '');
    $('mask').classList.add('on');
  }
  function closeModal() { $('mask').classList.remove('on'); }
  var MODALS = {};
  $('mdX').addEventListener('click', closeModal);
  $('mask').addEventListener('mousedown', function (e) {
    if (e.target === $('mask')) closeModal();
  });
  $('mdFoot').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    if (b.getAttribute('data-mc')) { closeModal(); return; }
    var fn = b.getAttribute('data-fn');
    if (fn && MODALS[fn]) { MODALS[fn](); }
  });

  /* ==================================================================
     IndexedDB —— 新上传图片存原始 Blob（零压缩）
     ================================================================== */
  var IDB = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        var rq = indexedDB.open('kc_editor_v2', 1);
        rq.onupgradeneeded = function () {
          var d = rq.result;
          if (!d.objectStoreNames.contains('imgs')) d.createObjectStore('imgs');
        };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
      return dbp;
    }
    function tx(store, mode) {
      return open().then(function (d) {
        return d.transaction(store, mode).objectStore(store);
      });
    }
    return {
      put: function (k, v) {
        return tx('imgs', 'readwrite').then(function (s) {
          return new Promise(function (res, rej) {
            var r = s.put(v, k);
            r.onsuccess = function () { res(k); };
            r.onerror = function () { rej(r.error); };
          });
        });
      },
      get: function (k) {
        return tx('imgs', 'readonly').then(function (s) {
          return new Promise(function (res) {
            var r = s.get(k);
            r.onsuccess = function () { res(r.result || null); };
            r.onerror = function () { res(null); };
          });
        });
      },
      del: function (k) {
        return tx('imgs', 'readwrite').then(function (s) {
          return new Promise(function (res) { var r = s.delete(k); r.onsuccess = r.onerror = function () { res(); }; });
        });
      }
    };
  })();

  var URLCACHE = {}, URLPEND = {};
  /* ☁️ 取图字节：本机 IndexedDB → 云端（取到后顺手缓存回本机）→ null
     为什么要这条回退：手工插入的图（img = 'idb:<key>'）字节只在本机浏览器里，
     同步过去的只有那个 key ⇒ 另一台电脑上是一张空白图（2026-10-09 利报的 bug）。 */
  function imgBlob(key) {
    return IDB.get(key).then(function (b) {
      if (b) return b;
      var cloud = window.KC_CLOUD;
      if (!cloud || !cloud.on) return null;
      return cloud.getImg(key).then(function (bl) {
        if (!bl) return null;
        IDB.put(key, bl);        /* 缓存到本机：下次直接本地读，不再等网络 */
        return bl;
      });
    });
  }
  function blobUrl(key) {
    if (URLCACHE[key]) return Promise.resolve(URLCACHE[key]);
    if (URLPEND[key]) return URLPEND[key];        /* 同一张图别并发拉好几遍 */
    URLPEND[key] = imgBlob(key).then(function (b) {
      delete URLPEND[key];
      if (!b) return null;
      URLCACHE[key] = URL.createObjectURL(b);
      return URLCACHE[key];
    });
    return URLPEND[key];
  }
  function releaseUrls() {
    for (var k in URLCACHE) { try { URL.revokeObjectURL(URLCACHE[k]); } catch (e) {} }
    URLCACHE = {};
  }
  function resolveSrc(src) {
    if (!src) return Promise.resolve('');
    if (src.indexOf('idb:') === 0) return blobUrl(src.slice(4));
    return Promise.resolve(src);
  }
  /* ☁️ 把一张手工插入的图推上云（只有 https 云模式才动；本机读得到才传） */
  function cloudPutImg(key, blob) {
    var cloud = window.KC_CLOUD;
    if (!cloud || !cloud.on) return;
    cloud.putImg(key, blob).then(function (r) {
      if (r && !r.ok && r.reason !== 'off') {
        var why = r.reason === 'too-big'
          ? ('图片太大，约 ' + (r.kb || '?') + ' KB')
          : (r.message || r.reason);
        toast('⚠️ 这张图没能同步到云端（' + why + '）—— 别的电脑会看不到它', 8000);
      }
    }).catch(function () { });
  }
  /* ☁️ 所有「卡片引用了的手工插入图」的 key */
  function localImgKeys() {
    var set = {};
    (BOOKS || []).forEach(function (b) {
      var bs = S.books[b.id];
      if (!bs) return;
      (bs.cards || []).forEach(function (c) {
        if (c.img && c.img.indexOf('idb:') === 0) set[c.img.slice(4)] = 1;
      });
    });
    return Object.keys(set);
  }
  /* ☁️ 开机补齐：本机有、云端还没有的图传上去。
     —— 这条同时负责「把历史遗留的图补上云」：利以前在本机插的图，
        当时没有云通道，现在打开就会自动补传（一次） */
  function cloudSyncImages() {
    var cloud = window.KC_CLOUD;
    if (!cloud || !cloud.on) return;
    var keys = localImgKeys();
    if (!keys.length) return;
    cloud.syncImages(keys, function (k) { return IDB.get(k); }).then(function (r) {
      if (r && r.uploaded) toast('☁️ 已把 ' + r.uploaded + ' 张本机图片同步到云端', 4500);
    }).catch(function () { });
  }
  /* 给 <img> 塞图：blob 走异步补，普通路径直接设 */
  function setImg(el, src) {
    if (!el || !src) return;
    if (src.indexOf('idb:') === 0) {
      blobUrl(src.slice(4)).then(function (u) { if (u) el.src = u; });
    } else el.src = src;
  }

  /* ==================================================================
     数据加载：优先 fetch（云端），file:// 回退 script 注入
     🔒 2026-10-09（利要求：密码门禁 + 随机文件名）
        线上只发 `data/kc-<TOKEN>.json` 一份 —— 内容是 **AES-256-GCM 密文**，
        密钥由门禁密码经 PBKDF2-SHA256(150000 次) 派生。
        源目录里的明文 `data/catalog.json` 仍然保留（本机脚本、file:// 都读它），
        由 `_sync_deploy.py` 在发布同步时**排除**，所以线上抓不到明文数据。
        📌 演进：v1 明文 → v2 base64（可逆，只算门槛）→ v3 AES（本版，没密码解不开）。
     ================================================================== */
  var DATA_TOKEN = '1bc995ca';
  var DATA_JSON = 'data/kc-' + DATA_TOKEN + '.json';   /* 线上唯一数据文件（AES 密文） */
  /* var DATA_JS = 'data/kc-' + DATA_TOKEN + '.js';
     ⚠️ v3 起**故意没有**这个文件：它曾是**明文** script 退路
        （`window.KC_CATALOG = {...}`，下载即可读全量报价），线上绝不能再发。
        file:// 场景已改读源目录的 data/catalog.js。留着这行注释是怕日后有人以为漏了。 */

  /* base64 → UTF-8 文本（仅 v2 旧产物兼容：那时的数据文件是 base64 包装的） */
  function unb64(s) {
    var bin = atob(String(s).replace(/\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  /* 先当明文 JSON 解，解不动再当 base64 解 —— 两种格式都能吃（兼容旧产物） */
  function parseData(txt) {
    var t = String(txt || '').trim();
    if (!t) throw new Error('数据文件是空的');
    try { return JSON.parse(t); } catch (e) { }
    return JSON.parse(unb64(t));
  }
  function fetchData(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.text();
    }).then(parseData);
  }

  /* <script src> 注入退路 —— file:// 下唯一能走的一条。
     ⚠️ v3 起线上不再发任何明文 .js（kc-<TOKEN>.js 曾是明文，等于漏一份全量报价），
        所以这里只服务**源目录**的 data/catalog.js。 */
  function injectCatalogJs(url, res, rej) {
    var s = document.createElement('script');
    s.src = url;
    s.onload = function () {
      var d = window.KC_CATALOG;
      if (!d) {
        /* 🔴 报错要能一眼看出是哪个环节坏：
           实测踩过 —— 生成脚本把 js 里的变量名写成了 KC_DATA，
           而这里只判 KC_CATALOG，于是整页只剩一行红字「未定义 KC_CATALOG」，
           根本看不出是文件内容错了。 */
        var keys = Object.keys(window).filter(function (k) {
          return /^KC_/.test(k);
        });
        rej(new Error(url + ' 已加载但没有 KC_CATALOG —— ' +
          '文件里实际存在的是：' + (keys.length ? keys.join(', ') : '（没有任何 KC_* 变量）') +
          '。多半是生成脚本写错了变量名（应统一为 KC_CATALOG）。'));
        return;
      }
      /* 别只判变量名：顺手查内容是否完整，
         否则半截文件也会静默通过（boot() 里 books 缺失 → 册子全空）。 */
      if (!d.bookDefs || !d.books) {
        rej(new Error(url + ' 有 KC_CATALOG 但内容不完整（缺 bookDefs / books）'));
        return;
      }
      res(d);
    };
    s.onerror = function () {
      rej(new Error('读不到 ' + url + ' —— file:// 下 fetch 一律被 CORS 拦，'
        + '只能靠 <script> 注入；请确认源目录里有 产品目录编辑器/data/catalog.js'));
    };
    document.head.appendChild(s);
  }

  /* ---------- 线上版：AES-256-GCM 解密（密码来自门禁输入） ----------
     🔑 参数必须与 产品目录参考/_encrypt_data.js 严格对齐：
        PBKDF2-SHA256 / iter 150000 / salt 16B ；AES-256-GCM / iv 12B / tag 16B（拼在密文尾）。
        改一边必须同时改另一边，否则会出现「Node 能解、浏览器解不开」这种最难查的错。 */
  function b64buf(s) {
    var bin = atob(String(s).replace(/\s+/g, ''));
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function decryptData(w, pass) {
    if (!pass) return Promise.reject(new Error('没有密码（门禁尚未解锁）'));
    /* crypto.subtle 只在安全上下文可用：https / localhost / file 都可以，
       但 http://192.168.x.x 这种局域网 IP 不行 —— 报清楚，别让人对着白屏猜。 */
    if (!(window.crypto && crypto.subtle && crypto.subtle.decrypt)) {
      return Promise.reject(new Error(
        '当前环境不支持 WebCrypto（crypto.subtle 不可用）—— 数据是加密的，'
        + '必须通过 https:// 或 localhost 打开，不能用局域网 IP 的 http://'));
    }
    var salt = b64buf(w.salt), iv = b64buf(w.iv), ct = b64buf(w.ct);
    return crypto.subtle
      .importKey('raw', new TextEncoder().encode(String(pass)), 'PBKDF2', false, ['deriveKey'])
      .then(function (bk) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: w.iter || 150000, hash: 'SHA-256' },
          bk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      })
      .then(function (key) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct); })
      .then(function (buf) { return JSON.parse(new TextDecoder('utf-8').decode(buf)); });
  }
  function fetchEncrypted(url, pass) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status + ' 读不到 ' + url);
        return r.text();
      })
      .then(function (t) {
        var w = null;
        try { w = JSON.parse(t); } catch (e) { /* 不是 JSON？交给下面兜底 */ }
        if (w && w.ct) return decryptData(w, pass);   /* AES wrapper */
        /* 兜底：万一线上残着旧版 base64 或明文产物，别直接白屏 */
        return parseData(t);
      });
  }

  /* 🔒 file:// / http(s) 走两条不同的路：
       · file://  = 本地双击。读**明文** data/catalog.json（fetch 被 CORS 拦就注入 catalog.js）。
                    文件本来就在自己电脑上，不需要也不该走加密。
       · https:// = 线上。**先问云端**（_cloud.js —— 多台电脑共享同一份）；
                    云端还没有数据、或云端连不上 → 回退到 data/kc-<TOKEN>.json 那份 AES 密文。
                    ⚠️ 这个回退是**刻意**的：宁可让人看到旧数据，也不要因为云端抽风就白屏。
                    明文 catalog.json / catalog.js / kc-<TOKEN>.js 已被 _sync_deploy.py 从线上删掉。 */
  function loadData(pass) {
    if (/^file:$/.test(location.protocol)) {
      return fetchData('data/catalog.json')
        .catch(function () {
          return new Promise(function (res, rej) {
            injectCatalogJs('data/catalog.js', res, rej);
          });
        });
    }
    var cloud = window.KC_CLOUD;
    if (cloud && cloud.on) {
      return cloud.load(pass).then(function (d) {
        if (!d) return fetchEncrypted(DATA_JSON, pass);    /* 云端空 → 拿静态那份兜底 */
        CLOUD_LOADED = true;      /* ☁️ 这份数据是云端给的 ⇒ boot() 里不许再用本地快照翻盘 */
        cloud.watch();                                     /* 连上了才开始轮询 */
        return d;
      }, function (e) {
        console.warn('[KC] 云端不可用，回退静态数据：', (e && e.message) || e);
        return fetchEncrypted(DATA_JSON, pass);
      });
    }
    return fetchEncrypted(DATA_JSON, pass);
  }
  /* 🔴附属数据加载 —— 必须有 file:// 退路。
     file:// 下 fetch 一律被 CORS 拦（实测日志：
     "Access to fetch at 'file:///.../data/calibration.json' from origin 'null'
      has been blocked by CORS policy"），
     而原版 `.catch(function(){ return null; })` 把错误吞成 null，
     后果是两个功能**静默降级**、且一个死循环一个谎报文件不存在：
       - 「选图」：LIB 永远null → 显示「正在读图库索引…」→ 又调 loadJson
         → 又失败 → 递归 openLib()，实测表现是永远转圈、点不 Close 以外任何东西；
       - 「规格校准报告」：报「找不到 data/calibration.json」，
         但文件其实在（69 KB），利会以为要重跑生成器，白折腾。
     正解和 loadData() 同一套：fetch 优先 → 失败走 <script> 注入 → 仍失败才null。
     gs 里按 varName 取全局变量，变量名对不上会报错而不是静默。 */
  function loadJson(path, varName, jsPath) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).catch(function (e) {
      jsPath = jsPath || path.replace(/\.json$/, '.js');
      var v = varName || 'KC_JSON';
      return new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = jsPath;
        s.onload = function () {
          var d = window[v];
          if (!d) {
            var keys = Object.keys(window).filter(function (k) {
              return /^KC_/.test(k);
            });
            rej(new Error(jsPath + ' 已加载但没有 ' + v + ' —— 文件里实际存在的是：'
              + (keys.length ? keys.join(', ') : '（没有任何 KC_* 变量）')));
            return;
          }
          res(d);
        };
        s.onerror = function () { rej(new Error('读不到 ' + path + '（fetch 被 file:// 拦）'
          + ' 且 ' + jsPath + ' 不存在 —— 在项目根目录运行 python _kcdata.py 生成退路')); };
        document.head.appendChild(s);
      });
    }).catch(function (e) {
      /* 真的两条路都断了：保留 null（调用方各有降级 UI），但把原因留在控制台，
         别再让「文件不存在」这种错误结论骗到人。 */
      console.warn('[KC]附属数据加载失败：', (e && e.message) || e);
      return null;
    });
  }

  /* ==================================================================
     启动前的引导
     ================================================================== */
  function boot() {
    BOOKS = (DATA.bookDefs || []).slice();
    BOOKS.forEach(function (b) {
      /* 🔴 cards 必须是**真数组**，这里是最后一道防线：
          数据层有三种可能的形状 —— 本地 catalog.json 是纯数组；旧的云 seed 也是纯数组；
          云 saveBook() 存的是 {cards, flags}。
          2026-10-09 踩过：某一册被存成对象后，`clone(DATA.books[…])` 把整个对象塞进 cards，
          于是 `cards.length === undefined` —— 整册在页面上**静默消失**、一个报错都没有。 */
      var raw = DATA.books[b.id];
      var cards = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.cards) ? raw.cards : []);
      /* ☁️ 页签开关：云端（CLOUD_FLAGS）优先 → 载荷自带 flags → 默认全开 */
      var f = (CLOUD_FLAGS && CLOUD_FLAGS[b.id]) || (raw && raw.flags) || null;
      S.books[b.id] = {
        cards: clone(cards),
        flags: Object.assign({ cover: true, divider: true, back: true }, f || {})
      };
    });
    /* localStorage 恢复（每本独立）
       ⚠️ 快照必须与当前数据层**指纹一致**才恢复。
          否则重跑 _gen_data_v2.py 加了新 SKU（v4 手册户外刀/套刀注入那次），
          旧快照会把新卡片整批盖掉 —— 表现是「数据层明明有 130 张，册子里只有 76 张」，
          而且没有任何报错，极难察觉（实测踩过）。
          指纹 = ver + generated（生成时间），数据层一重跑指纹就变 → 旧快照自动作废。 */
    /* 🔴 指纹 = ver | generated | struct（册数/卡片数）
       generated 现在由生成器自动写时间戳（原来手写死，合并册时没改 →
       浏览器当同一份数据，继续用旧快照，表现为「套刀全没了」）。 */
    var fp = (DATA.ver || '0') + '|' + (DATA.generated || '') + '|' + (DATA.struct || '');

    /* ☁️🔴 云模式下**云端是权威副本**，本地快照绝不能盖它。
       —— 2026-10-09 实测踩过「A 电脑改了、B 电脑看不到」：
          「加产品」不改变指纹 ver|generated|struct（那是生成器写的），
          所以 B 电脑里那份**旧快照永远"有效"**，每次打开都把云端刚取回的新数据整册盖掉；
          B 再一编辑，又把它的旧数据写回云端 ⇒ 两台电脑**互相看不见**，
          而且两边都没有任何报错。这正是用户报的「感觉它好像不怎么同步」。
       处理：云模式下不做「恢复」，反过来把快照**对齐成云端那份** ——
          这样云端万一连不上时，兜底数据也还是最新的。 */
    if (CLOUD_LOADED) {
      BOOKS.forEach(function (b) {
        try {
          localStorage.setItem(LS_PREFIX + b.id, JSON.stringify({
            cards: S.books[b.id].cards, flags: S.books[b.id].flags, fp: fp
          }));
        } catch (e) { /* 空间不够就算了 —— 云端才是权威，本地缓存丢了不影响 */ }
      });
      if (!S.book || !S.books[S.book]) S.book = BOOKS[0].id;
      console.info('[KC] 数据来自云端，本地快照已对齐（不当权威副本用）');
      return;
    }

    BOOKS.forEach(function (b) {
      try {
        var raw = localStorage.getItem(LS_PREFIX + b.id);
        if (!raw) return;
        var o = JSON.parse(raw);
        if (!o || !Array.isArray(o.cards) || !o.cards.length) return;
        if (o.fp !== fp) {
          console.info('数据层已更新（' + fp + '），忽略旧快照：' + b.id);
          localStorage.removeItem(LS_PREFIX + b.id);
          return;
        }
        S.books[b.id].cards = o.cards;
        if (o.flags) S.books[b.id].flags = Object.assign({ cover: true, divider: true, back: true }, o.flags);
      } catch (e) { console.warn('恢复失败', b.id, e); }
    });
    if (!S.book || !S.books[S.book]) S.book = BOOKS[0].id;
  }

  function bookDef(id) {
    for (var i = 0; i < BOOKS.length; i++) if (BOOKS[i].id === id) return BOOKS[i];
    return BOOKS[0];
  }
  /* 同品类的「配对册」—— 公开版 ↔ 报价版（同 cat，withPrice 相反）。
     🔴 2026-10-08：公开版与报价版是两份独立副本，同一份 JSON 必须各导一次；
     实测两册段码计数恒等 ⇒ 同一份 JSON 会拿到同一个号，天然配对。
     这里提供配对册查找，供「同步导入」与「两册对号」用。找不到返回 null。 */
  function twinBook(id) {
    var d = bookDef(id);
    for (var i = 0; i < BOOKS.length; i++) {
      var b = BOOKS[i];
      if (b.id === id) continue;
      if (b.cat === d.cat && !!b.withPrice !== !!d.withPrice) return b;
    }
    return null;
  }
  /* SKU → 段码键（含 SET- 前缀，比 kcSeg 更细：KN-SET-SS → SET-SS，不与 KN-SS 混） */
  function segKeyOf(sku) {
    var m = /^KL-[A-Z]{2}-((?:SET-)?[A-Z]{2,3})-\d{3}$/i.exec(String(sku || '').toUpperCase());
    return m ? m[1] : '(无法解析)';
  }
  function curBook() { return S.books[S.book]; }
  function curDef() { return bookDef(S.book); }
  function cards() { return curBook().cards; }
  function catMeta(k) { return (DATA.catMeta && DATA.catMeta[k]) || { no: '', en: k, cn: k, desc: '' }; }

  /* 全库唯一 SKU 数（封底 "N listed SKUs" 用，避免每本册子各说各话） */
  function skuTotalAll() {
    var seen = {};
    Object.keys(S.books).forEach(function (id) {
      (S.books[id].cards || []).forEach(function (c) { if (c.sku) seen[c.sku] = 1; });
    });
    return Object.keys(seen).length;
  }

  /* SKU 索引表 —— 欧美买手拿到目录第一件事是「照 item no. 翻页」，
     只给章节页码他们还得自己数，所以每 3 列排满整版。 */
  function skuIndexHtml(list, startPage, chunks) {
    var n = list.length;
    var cells = list.map(function (c, i) {
      /* 页码必须与 paginate() 的均分结果一致 —— 用 pageOfIndex，不能用 i/PER_PAGE */
      var p = chunks ? (startPage + pageOfIndex(chunks, i)) : (startPage + Math.floor(i / PER_PAGE));
      return '<span>' + esc(c.sku || '—') + '<i>' + p + '</i></span>';
    }).join('');
    /* 列数随 SKU 数增加：>60 → 7 列，>100 → 8 列。
       户外册 130 个 SKU 用 6 列要占 22 行，把 Contents 下半挤爆（审计实测）。 */
    return '<div class="idxgrid' + (n > 100 ? ' c8' : (n > 60 ? ' c7' : '')) + '">' +
      cells + '</div>';
  }

  /* 本册品类型目 —— Contents 页下半。
     作用：把「这本册子里有哪几条细分产品线、各多少款、翻到哪几页」一次摊开，
     欧美买手不用往后翻才知道自己要的品类在不在册子里。
     段码 → 细分线的映射是按数据层实际 SKU 名归纳的（不写死数量，实时统计）。 */
  var RANGE_MAP = {
    knives: {
      SS: ['Stainless Kitchen Series', '中式与西式不锈钢厨刀'],
      DS: ['Damascus Pattern Series', '大马士革花纹钢系列'],
      HM: ['Hammered Finish Series', '锤纹工艺系列'],
      HC: ['High-Carbon & Hand-Forged', '高碳钢与手工锻造']
    },
    sets: {
      SS: ['Stainless Steel Set Series', '不锈钢套刀 · 块装与礼盒'],
      DC: ['Damascus & Steel Set Series', '大马士革与不锈钢套装']
    },
    scissors: {
      SS: ['Kitchen Scissors', '厨房剪系列'],
      PR: ['Professional & Garden', '专业剪与园艺剪'],
      HC: ['Tailor & Barber', '裁缝剪与理发剪'],
      TI: ['Black-Coated Series', '黑色涂层系列']
    },
    outdoor: {
      DA: ['Folding Blades', '折叠刀系列（DA）'],
      DB: ['Fixed Blades', '直刀系列（DB）'],
      SS: ['Multi-Purpose & EDC', '多用途与随身系列'],
      HC: ['Hand-Forged Hunting', '手工锻造狩猎系列'],
      TI: ['Black-Coated Series', '全黑涂层系列'],
      DS: ['Damascus Fixed Blade', '大马士革直刀']
    },
    accessories: {
      GAD: ['Utensils & Kitchen Gadgets', '厨具与小工具'],
      CU: ['Pots & Pans', '锅具与炊具'],
      BBQ: ['BBQ & Grilling Tools', '烧烤用具'],
      CB: ['Cutting Boards', '砧板与操作台'],
      GR: ['Graters & Zesters', '刨丝器与刨皮器'],
      PL: ['Peelers', '削皮器系列'],
      TG: ['Tongs & Serving Tools', '夹与上菜工具'],
      STO: ['Storage & Containers', '收纳与保鲜容器'],
      SL: ['Slicers & Multi-Blade Sets', '切片器与多刃套装'],
      GP: ['Presses', '压蒜器等压具']
    }
  };
  function rangeTableHtml(cat, list, startPage, chunks) {
    var map = RANGE_MAP[cat] || {};
    var buckets = [], idx = {};
    (list || []).forEach(function (c, i) {
      var s = segOfSku(c.sku) || 'GEN';
      if (!idx[s]) { idx[s] = { seg: s, n: 0, first: i, last: i, sku1: c.sku, sku2: c.sku }; buckets.push(idx[s]); }
      idx[s].n++; idx[s].last = i; idx[s].sku2 = c.sku;
    });
    /* 大册子户外 6 段、配件 10 段，按数量降序 → 买家最关心的线排前面 */
    buckets.sort(function (a, b) { return b.n - a.n; });
    var sp = startPage || 1;
    /* 列数按段数自适应（Contents 页余量有限，段数多就必须多列少行 + 压扁卡片）：
       ≤4 段 → 4 列 1 行（完整卡片）· 5 段 → 5 列 1 行 · ≥6 段 → 5 列 2 行（压扁）。
       ⚠️ 不要用 max-height 硬裁 —— 会把第二行的段码/数量也裁掉，那是硬信息。 */
    var n = buckets.length;
    var col = n <= 4 ? 4 : 5;
    var h = '<div class="rtable c' + col + '">';
    h += buckets.map(function (b) {
      var m = map[b.seg] || ['Item No. ' + b.seg + ' Range', '段码 ' + b.seg];
      var p1 = sp + (chunks ? pageOfIndex(chunks, b.first) : Math.floor(b.first / PER_PAGE));
      var p2 = sp + (chunks ? pageOfIndex(chunks, b.last) : Math.floor(b.last / PER_PAGE));
      return '<div class="rr"><div class="rh"><span class="rc">' + esc(b.seg) + '</span>' +
        '<b class="rq">' + b.n + '</b><span class="ru">items</span></div>' +
        '<div class="rn">' + esc(m[0]) + '</div>' +
        '<div class="rcn">' + esc(m[1]) + '</div>' +
        '<div class="rp">' + esc(b.sku1) + (b.sku2 !== b.sku1 ? ' … ' + esc(b.sku2) : '') +
        '  ·  p. ' + p1 + (p2 > p1 ? '–' + p2 : '') + '</div></div>';
    }).join('');
    return h + '</div>';
  }

  /* 封面文案 —— 4 个品类各一套（2026-10-05 合并厨刀+套刀）
     title 里的 <span class="g"> 是金色高亮；secs 是封面下方的全品类索引条。

     🔴 2026-10-05：原来这里写 5 个品类（Knife Sets 独立一格），
     但公司只有 4 个品类（厨刀含单刀+套刀），索引条会误导客户以为 5 个品类。
     → Knife Sets 并进 Kitchen Knives 一格。
     4 品类 = 4 格 + 'Full Range' 凑满两行 3 列（与 .secs 的 3 列网格一致）。
     ⚠️ 副题长度有硬上限：索引条 .st 实测可用宽仅 86px（cw=86），
        "Single knives & knife sets" 实测 101px → **被裁 15px**（审计报 CLIPPED p1）。
        ⇒ 副题一律用短词，别写完整短语。 */
  var COVER_ALL_SECS = [
    ['Kitchen Knives', 'Single &amp; sets'],
    ['Outdoor', 'Folding &amp; fixed'],
    ['Scissors', 'Kitchen &amp; tailor'],
    ['Accessories', 'BBQ &amp; cookware']
  ];
  /*🔴 索引条显示顺序 ↔ 高亮顺序的映射（单一真源）。
     两处必须同步改，否则户外刀册会高亮到「Scissors」格（实测踩过）。
     用 cat 而不是位置做映射，以后增删品类也不会错位。 */
  var COVER_SEC_CAT = ['knives', 'outdoor', 'scissors', 'accessories'];
  function coverCopy(cat) {
    var M = {
      /* 🔴 合并后厨刀册 = 单刀 + 套刀，标题与导语都要涵盖两者
         （原标题只写 Damascus Kitchen Knives，会让 64 个套刀显得像附属品） */
      knives: {
        title: 'Kitchen Knives<br><span class="g">&amp; Knife Sets</span>',
        lead: 'Single knives plus complete knife sets in VG10 and imported AUS10 Damascus ' +
              'steel — 67 / 73 layers, stable hardness 60±2HRC, long-lasting sharpness.'
      },
      sets: {
        title: 'Knife <span class="g">Sets</span> &amp;<br>Block Sets',
        lead: 'Complete knife sets with wooden blocks, magnetic stands and gift-box presentation — ' +
              'ready for retail shelves and e-commerce listings.'
      },
      scissors: {
        title: 'Precision<br><span class="g">Scissors</span>',
        lead: 'Kitchen shears, tailor\u2019s and barber scissors, garden and pruning tools — ' +
              'hardened stainless blades, precision-aligned cutting action.'
      },
      accessories: {
        title: 'Kitchen <span class="g">Accessories</span><br>&amp; Tools',
        lead: 'Cutting boards, peelers, graters, whisks, strainers, BBQ tools and cookware — ' +
              'the full kitchen line that completes a knife programme.'
      },
      outdoor: {
        title: 'Outdoor Folding<br><span class="g">Knives</span>',
        lead: 'Folding EDC and fixed-blade knives in 14C28N, D2, 154CM and VG10 — ' +
              'ceramic bearings, crossbar / liner locks, US warehouse stock.'
      }
    };
    /* 本册封面下方的 3 个卖点 —— 每个品类不同，也是买手最关心的三点 */
    var PTS = {
      knives: [
        ['Steel', '<b>VG10 &amp; imported AUS10</b> multi-layer Damascus, 67 / 73 layers'],
        ['Hardness', '<b>60±2 HRC</b> heat treatment, edge retention checked on test machines'],
        ['Custom', 'Laser logo, own colour box and carton artwork from <b>50 pcs</b>']
      ],
      sets: [
        ['Configuration', '<b>2 to 12 pieces</b> per set — knife block, magnetic stand or case'],
        ['Packaging', 'Gift-box presentation and retail-ready <b>barcode &amp; labelling</b>'],
        ['Packing', 'Export carton with pallets; full <b>carton data</b> and loading quantity']
      ],
      scissors: [
        ['Blades', '<b>Hardened stainless</b>, precision-aligned and hand-finished'],
        ['Ranges', 'Kitchen shears, tailor, barber, garden, pruning and <b>industrial</b>'],
        ['Testing', 'EN 13130 soluble heavy metals and <b>LFGB</b> reports on request']
      ],
      accessories: [
        ['Range', 'BBQ tools, cookware, boards, peelers, graters and <b>storage</b>'],
        ['Material', 'Food-contact compliant; <b>SGS LFGB</b> available on request'],
        ['Packing', 'Retail blister or colour box, <b>barcode &amp; label</b> service']
      ],
      outdoor: [
        ['Steel', '<b>14C28N, D2, 154CM, VG10</b> — corrosion-resistant outdoor grades'],
        ['Lock &amp; bearing', 'Crossbar / liner lock, <b>ceramic ball bearing</b> pivot'],
        ['Stock', '<b>US warehouse</b> stock dispatched within 1–3 days']
      ]
    };
    var c = M[cat] || { title: esc(catMeta(cat).en), lead: catMeta(cat).desc };
    /* 本册在封面索引条里的位置 —— 高亮它，其余压暗。
       🔴 2026-10-05 修两处：
       ① 合并厨刀+套刀后是 4 品类（原来 5 个，sets 排第 2，套刀并入厨刀后 knives 才是第 1）
       ② 🔴 **数组顺序必须与 COVER_ALL_SECS 的显示顺序逐项一致**，否则高亮整排错位
          （实测踩过：COVER_ALL_SECS 是 knives→outdoor→scissors→accessories，
            这里却写成 knives→scissors→outdoor→accessories
            ⇒ 户外刀册的高亮落在「Scissors」格上，剪刀册落在「Outdoor」格上）。 */
    var order = COVER_SEC_CAT;
    var mi = order.indexOf(cat);
    if (mi < 0) {
      /* 套刀已并入厨刀册 —— 若仍被问到，归到 knives 那一格 */
      cat = 'knives'; mi = 0;
      c = M.knives;
    }
    return { title: c.title, lead: c.lead, pts: PTS[cat] || [], secs: COVER_ALL_SECS,
             mine: mi };
  }

  /* ---------------------------------------------------------------- 保存 */
  var saveTimer = null;
  function markDirty() {
    var d = $('saveDot');
    d.className = 'savedot dirty';
    $('saveTxt').textContent = '未保存';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }
  /* 把某一本册子写进 localStorage。
     🔴 2026-10-08 从 save() 拆出来：save() 只存**当前册**，
     而「同步导入两册」会同时改两本，另一本必须显式落盘，否则刷新就丢。 */
  function saveBook(id) {
    if (!S.books[id]) return false;
    var def = bookDef(id);
    var payload = { cards: S.books[id].cards, flags: S.books[id].flags, ts: Date.now(),
                  /* 数据层指纹：与 boot() 里的恢复判断配对 */
                  fp: (DATA.ver || '0') + '|' + (DATA.generated || '') + '|' + (DATA.struct || '') };
    var str = null, ok = false;
    try { str = JSON.stringify(payload); }
    catch (e) { toast('数据过大 —— 本地缓存跳过，云端照传'); }
    if (str) {
      try { localStorage.setItem(LS_PREFIX + def.id, str); ok = true; }
      catch (e) { toast('浏览器存储空间不足 —— 本地缓存跳过，已改用云端保存'); }
    }
    /* ☁️ 云模式：同一份同时写云端。
       ⚠️ 本地写失败也照传 —— 云版里**云端才是权威副本**，localStorage 只是本地缓存。 */
    var cloud = window.KC_CLOUD;
    if (cloud && cloud.on) {
      cloud.saveBook(id, S.books[id].cards, S.books[id].flags).then(function (r) {
        if (r && !r.ok && r.reason === 'conflict') {
          toast('⚠️ 云端已被另一台电脑更新，「' + def.id + '」这次改动没能上传 —— '
            + '请刷新页面后重做这一册', 7000);
        }
      }).catch(function () { });
    }
    return ok;
  }

  function save() {
    flushPendingEdit();
    var def = curDef();
    var ok = saveBook(def.id);
    var d = $('saveDot');
    var cloudOn = !!(window.KC_CLOUD && window.KC_CLOUD.on);
    if (ok) {
      d.className = 'savedot ok';
      $('saveTxt').textContent = '已保存 ' + pad2(new Date().getHours()) + ':' +
        pad2(new Date().getMinutes());
    } else if (cloudOn) {
      /* 本地存不下但云端在传 —— 别报「保存失败」吓人，那会让人以为白改了 */
      d.className = 'savedot ok';
      $('saveTxt').textContent = '已存云端 ' + pad2(new Date().getHours()) + ':' +
        pad2(new Date().getMinutes());
    } else {
      d.className = 'savedot dirty';
      $('saveTxt').textContent = '保存失败(空间满)';
    }
  }

  /* ---------------------------------------------------------------- 撤销 */
  function snapshot() {
    return { book: S.book, sel: S.sel, cards: clone(cards()), flags: clone(curBook().flags) };
  }
  /* 待结算的文本编辑快照（由 bindEditor 的 focusin 写入）。
     ⚠️ 任何结构性 pushUndo 之前必须先 flush —— 否则用户「改完 SKU 直接点删除」，
        那次文本编辑就永远撤不回来了。 */
  var pendingEdit = null;
  function flushPendingEdit() {
    if (!pendingEdit) return;
    var p = pendingEdit;
    pendingEdit = null;
    S.undo.push(p);
    if (S.undo.length > 60) S.undo.shift();
    S.redo.length = 0;
  }
  function pushUndo() {
    flushPendingEdit();
    S.undo.push(snapshot());
    if (S.undo.length > 60) S.undo.shift();
    S.redo.length = 0;
    updateUndoBtns();
  }
  function applySnap(s) {
    S.books[S.book] = { cards: s.cards, flags: s.flags };
    S.sel = Math.max(0, Math.min(s.sel, s.cards.length - 1));
    renderAll(); markDirty();
  }
  function undo() {
    if (!S.undo.length) { toast('没有可撤销的操作'); return; }
    var s = S.undo.pop();
    S.redo.push(snapshot());
    S.book = s.book;
    applySnap(s); updateUndoBtns(); toast('已撤销');
  }
  function redo() {
    if (!S.redo.length) { toast('没有可重做的操作'); return; }
    var s = S.redo.pop();
    S.undo.push(snapshot());
    S.book = s.book;
    applySnap(s); updateUndoBtns(); toast('已重做');
  }
  function updateUndoBtns() {
    $('btnUndo').style.opacity = S.undo.length ? '1' : '.45';
    $('btnRedo').style.opacity = S.redo.length ? '1' : '.45';
  }

  /* ==================================================================
     渲染 —— 册子切换条（按品类分组）
     ================================================================== */
  function renderBooks() {
    var groups = [];
    BOOKS.forEach(function (b) {
      var g = groups.filter(function (x) { return x.cat === b.cat; })[0];
      if (!g) { g = { cat: b.cat, items: [] }; groups.push(g); }
      g.items.push(b);
    });
    var h = '';
    groups.forEach(function (g) {
      h += '<div class="catgrp"><div class="gtitle">' + esc(catMeta(g.cat).cn) + '</div>';
      g.items.forEach(function (b) {
        var n = (S.books[b.id].cards || []).length;
        h += '<div class="book' + (b.id === S.book ? ' on' : '') + '" data-book="' + esc(b.id) + '">' +
             esc(b.id) + '<span class="bn">' + n + ' 张' +
             (b.withPrice ? ' · 报价' : '') + '</span></div>';
      });
      h += '</div>';
    });
    $('bookbar').innerHTML = h;
  }

  /* ==================================================================
     渲染 —— 左侧名片列表（带徽章）
     ================================================================== */
  function filtered() {
    var q = S.q.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < cards().length; i++) {
      var c = cards()[i];
      if (!q) { out.push({ i: i, c: c }); continue; }
      var hay = (c.sku + ' ' + c.name + ' ' + (c.cat || '')).toLowerCase();
      var hit = hay.indexOf(q) >= 0;
      if (!hit) {
        for (var r = 0; r < c.rows.length; r++) {
          if ((c.rows[r][0] + ' ' + c.rows[r][1]).toLowerCase().indexOf(q) >= 0) { hit = true; break; }
        }
      }
      if (hit) out.push({ i: i, c: c });
    }
    return out;
  }

  function badgesHtml(c, withPrice) {
    var h = '';
    if (c.verify) h += '<span class="badge" title="' + esc(c.verify) + '">待实测</span>';
    if (c.hlib && c.hlib.length) {
      var ex = c.hlib[0].exact;
      h += '<span class="badge v">' + (ex ? 'H盘图 ' + c.hlib.length : 'H盘参考') + '</span>';
    } else {
      h += '<span class="badge v">缺 H 盘图</span>';
    }
    if (withPrice && c.price && c.price.fob) h += '<span class="badge n">有报价</span>';
    return h;
  }

  function renderList() {
    var fl = filtered();
    var host = $('lbody');
    var withPrice = curDef().withPrice;
    var html = '';
    for (var k = 0; k < fl.length; k++) {
      var it = fl[k], c = it.c;
      var isBlob = c.img && c.img.indexOf('idb:') === 0;
      html += '<div class="litem' + (it.i === S.sel ? ' on' : '') + '" data-i="' + it.i + '" draggable="true">' +
        /*🔴 2026-10-05 拖拽排序手柄（利要「点击卡片就能拖、随意排列」）
          现有右上角的 ↑/↓ 按钮**全部保留**，两种方式并存。
          注：拖的是**数据层顺序**，会同步影响 PDF 产品页顺序与 Excel 行顺序。*/
        '<div class="lgrip" title="按住拖动可调整顺序" aria-label="拖动排序">⠿</div>' +
        '<div class="lthumb">' + (c.img
          ? '<img src="' + (isBlob ? '' : esc(c.img)) + '"' + (isBlob ? ' data-blob="' +
            esc(c.img.slice(4)) + '"' : '') + ' alt="">'
          : '<span style="color:#C6CFD9;font-size:15px">＋</span>') + '</div>' +
        '<div class="lmeta"><div class="lsku">' + esc(c.sku || '（未填 SKU）') + '</div>' +
        '<div class="lnm">' + esc(c.name || '（未填产品名）') + '</div>' +
        '<div class="ltag">' + c.rows.length + ' 项规格 · ' + badgesHtml(c, withPrice) + '</div></div></div>';
    }
    if (!html) html = '<div style="padding:40px 16px;text-align:center;color:var(--faint);font-size:12px">' +
      (S.q ? '没有匹配的名片' : '这本册子还没有名片，点下方「＋ 新增」') + '</div>';
    host.innerHTML = html;
    var imgs = host.querySelectorAll('img[data-blob]');
    for (var i = 0; i < imgs.length; i++) {
      (function (im) {
        blobUrl(im.getAttribute('data-blob')).then(function (u) { if (u) im.src = u; });
      })(imgs[i]);
    }
    var total = cards().length;
    $('lcountTxt').innerHTML = S.q
      ? '匹配 <b>' + fl.length + '</b> / ' + total + ' 张'
      : '<b>' + total + '</b> 张名片 · 约 <b>' + Math.max(1, Math.ceil(total / PER_PAGE)) + '</b> 页';
  }

  /* ==================================================================
     渲染 —— 中间编辑区
     ================================================================== */
  function renderEditor() {
    var c = cards()[S.sel];
    var host = $('edBody');
    if (!c) {
      host.innerHTML = '<div class="empty"><div class="big">□</div>' +
        '<p>这本册子还没有名片。<br>点左下角「＋ 新增」开始添加产品。</p></div>';
      $('edTitle').textContent = '编辑';
      $('edHint').textContent = '';
      return;
    }
    var meta = catMeta(c.cat);
    var withPrice = curDef().withPrice;
    var presets = DATA.fieldPresets || [];

    var h = '';
    h += '<div class="ncard">';
    h += '<div class="nchead"><span class="no">' + (S.sel + 1) + '</span>' +
         '<span class="st">' + esc(c.sku || '新名片') + '</span><span class="sp"></span>' +
         '<span style="font-size:10.5px;color:var(--faint)">' + esc(meta.no + ' ' + meta.cn) + '</span></div>';

    /* --- 校准提示条 --- */
    if (c.verify) {
      h += '<div class="vbar"><b>⚠️ 本条规格待实测（AI 原值，未改动）</b><br>' +
           esc(c.verify) + '</div>';
    }
    if (c.hlib && c.hlib.length) {
      var exact = c.hlib[0].exact;
      h += '<div class="vbar" style="' + (exact
        ? 'background:#F2F7FF;border-left-color:#2563EB;color:#1E3A5F'
        : 'background:#FFF7F0;border-left-color:#D2691E;color:#7A3B10') + '">' +
           '<b>' + (exact
             ? 'ℹ H 盘图库有 ' + c.hlib.length + ' 张本 SKU 实拍候选'
             : '⚠ H 盘参考图 ' + c.hlib.length + ' 张（不是本款实拍）') + '</b>' +
           (exact ? '（H:/上品sku）—— 点上方「🖼 选图」可切换。'
                  : ' —— ' + esc(c.hlibNote || 'H 盘没有同名文件夹。')) +
           '</div>';
    }

    /* --- 图片区 --- */
    h += '<div class="fld"><label>产品图（原图直出，不压缩）</label>';
    h += '<div class="imgpick" id="imgPick">' +
         (c.img ? '<img id="curImg" alt="">' : '<div class="ph"><b>▣</b>点击选择图片文件<br>' +
          '或用上方「🖼 选图」<br><span style="color:#B4BFCB">支持 JPG / PNG / WebP</span></div>') +
         '<div class="imgacts">' +
         '<button type="button" data-act="pick">更换</button>' +
         '<button type="button" data-act="lib">图库</button>' +
         '<button type="button" data-act="clear">清除</button></div></div>';
    h += '<div class="imginfo"><span>来源：<b>' + (c.img
        ? (c.img.indexOf('idb:') === 0 ? '本地上传（原文件字节）' : '内置图库 ' + esc(c.img))
        : '未设置') + '</b></span>' +
        (c.imgSize ? '<span>体积：<b>' + esc(c.imgSize) + '</b></span>' : '') +
        (c.imgDims ? '<span>像素：<b>' + esc(c.imgDims) + '</b></span>' : '') + '</div>';
    h += '<input type="file" id="fileIn" accept="image/*" style="display:none"></div>';

    /* --- SKU / 名称 --- */
    h += '<div class="row2">';
    h += '<div class="fld"><label>SKU 编号</label><input type="text" class="mono" id="fSku" value="' +
         esc(c.sku) + '" placeholder="KL-XX-DA-001"></div>';
    h += '<div class="fld"><label>所属品类</label><select id="fCat">' +
         CAT_ORDER.map(function (k) {
           var m = catMeta(k);
           /* 🔴 套刀仍是独立 cat（卡片数据靠它区分单刀/套刀排序），
              但对外只有 4 个品类，所以下拉里显示为「① 厨刀 / Knife Sets 套刀」 */
           var label = (k === 'sets')
             ? (catMeta('knives').no + ' ' + catMeta('knives').cn + ' / Knife Sets 套刀')
             : (m.no + ' ' + m.cn + ' / ' + m.en);
           return '<option value="' + k + '"' + (c.cat === k ? ' selected' : '') + '>' +
                  esc(label) + '</option>';
         }).join('') + '</select></div>';
    h += '</div>';
    h += '<div class="fld"><label>产品名称（英文）</label><input type="text" id="fName" value="' +
         esc(c.name) + '" placeholder="Damascus Nakiri Knife – Abalone Shell Handle"></div>';

    /* --- 规格行 --- */
    h += '<div class="fld"><label>规格明细（左侧题目已预填，右侧数值你填；可增删行）</label>';
    h += '<div class="rows"><div class="rhead"><div class="k">题目</div><div class="v">内容</div></div>';
    for (var i = 0; i < c.rows.length; i++) {
      h += '<div class="rrow" data-r="' + i + '">' +
           '<input type="text" class="k" list="kcFields" value="' + esc(c.rows[i][0]) + '" data-f="k" placeholder="题目">' +
           '<input type="text" class="v" value="' + esc(c.rows[i][1]) + '" data-f="v" placeholder="内容">' +
           '<button class="del" type="button" data-delrow="' + i + '" title="删除此行">×</button></div>';
    }
    h += '</div><div class="radd"><button type="button" id="btnAddRow">＋ 加一行规格</button></div>';
    h += '<datalist id="kcFields">' + presets.map(function (x) {
      return '<option value="' + esc(x) + '">'; }).join('') + '</datalist></div>';

    /* --- 报价块（带自动计算） --- */
    if (withPrice) {
      var p = c.price || { fob: '', t1: '', t2: '', hts: '', lead: '30–45 days' };
      h += '<div class="fld"><label>报价（USD · FOB 阳江）' +
           '<button type="button" id="btnCalcHelp" class="linkbtn" title="算价规则说明">算价规则</button></label>';
      h += '<div class="pbox">';
      h += '<div class="calcbar">' +
           '<label class="ck"><input type="checkbox" id="ckAuto"' +
           (p.auto === false ? '' : ' checked') + '> 自动算 500–999 / 1,000+</label>' +
           '<label class="ck"><input type="checkbox" id="ckAutoHts"' +
           (p.autoHts === false ? '' : ' checked') + '> 自动推荐 HTS</label>' +
           '<span class="cinfo" id="calcInfo"></span></div>';
      h += '<div class="pgrid">';
      h += '<div class="fld"><label style="font-size:9.5px">FOB 单价 <span class="lock" id="lkFob">🔒</span></label>' +
           '<input type="text" id="pFob" value="' + esc(p.fob) + '" placeholder="39.00" inputmode="decimal"></div>';
      h += '<div class="fld"><label style="font-size:9.5px">500–999 <span class="lock" id="lkT1">🔒</span></label>' +
           '<input type="text" id="pT1" value="' + esc(p.t1) + '" placeholder="36.66" inputmode="decimal"></div>';
      h += '<div class="fld"><label style="font-size:9.5px">1,000+ <span class="lock" id="lkT2">🔒</span></label>' +
           '<input type="text" id="pT2" value="' + esc(p.t2) + '" placeholder="34.32" inputmode="decimal"></div>';
      h += '</div><div class="pgrid" style="margin-top:9px">';
      h += '<div class="fld"><label style="font-size:9.5px">HTS (US) <span class="lock" id="lkHts">🔕</span></label>' +
           '<input type="text" id="pHts" value="' + esc(p.hts) + '" placeholder="8211.92.00" list="kcHts">' +
           '<datalist id="kcHts">' + HTS_LIST.map(function (x) {
             return '<option value="' + esc(x) + '">'; }).join('') + '</datalist></div>';
      h += '<div class="fld" style="grid-column:span 2"><label style="font-size:9.5px">交期</label>' +
           '<input type="text" id="pLead" value="' + esc(p.lead) + '" placeholder="30–45 days"></div>';
      h += '</div>';
      h += '<div class="calcmini"><span class="t">快速试算</span>' +
           '<span class="r">500–999 档 1000 pcs：<b id="calcA">—</b></span>' +
           '<span class="r">1,000+ 档 5000 pcs：<b id="calcB">—</b></span></div>';
      h += '</div></div>';
    }

    h += '</div>';

    h += '<div class="tips"><b>怎么用：</b>左侧列表选中名片 → 中间改图/改字/加规格行 → 右侧实时看纸面效果 → ' +
         '顶栏「导出 PDF」。<br>标了 <span class="badge">待实测</span> 的规格是 AI 原值、' +
         '我没有擅自改——拿到样品实测后再改。导出的 PDF 里图片是<b>原始文件字节</b>，不经过任何压缩。</div>';

    host.innerHTML = h;
    $('edTitle').textContent = '编辑名片';
    $('edHint').textContent = '第 ' + (S.sel + 1) + ' / ' + cards().length + ' 张 · ' + meta.cn;
    if (c.img) setImg($('curImg'), c.img);
    // 算价区初始化：锁标 + 试算条（不重算，保持数据层原值）
    if (withPrice) {
      var auto = $('ckAuto') ? $('ckAuto').checked : true;
      recalcPrice(c);
      recalcHts(c);
      if ($('calcInfo') && c.price && numOf(c.price.fob) !== null) {
        $('calcInfo').textContent = auto
          ? ('FOB ' + money2(numOf(c.price.fob)) + ' → ×0.94 / ×0.88')
          : '自动已关，手动填价';
      }
    }
  }

  /* ==================================================================
     渲染 —— 右侧 A4 纸面预览
     ================================================================== */
  /* 🔴 规格值智能截断 —— 卡片版式只有 ~46mm 宽的规格栏，
     而 Set Contents 这类字段在数据层是完整清单（实测最长 261 字符 ≈ 7 行），
     原来直接全量渲染 → 每行折 2~3 行 → specwrap 被 overflow:hidden 裁掉 8~29px
     （全册 80 处裁切，户外/套刀/配件册最严重）。
     正解：**卡片上给摘要，完整值留在编辑器与报价单里** —— 这也是欧美目录的通行做法
     （卡片写 "14 pcs · 12″ Sashimi · 10″ Sashimi · …"，完整清单走 PI / 报价单）。
     截断按语义优先在分隔符处断，不会把 3.5" 腰斩成 3.5。 */
  function specClip(v, max) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    max = max || 52;
    if (s.length <= max) return s;
    /* 优先断在 · ; , / 这些分隔符之前；其次断在空格；最后硬断 */
    var cut = -1;
    for (var i = max; i > max * 0.55; i--) {
      if ('·;,/、，'.indexOf(s.charAt(i)) >= 0) { cut = i; break; }
    }
    if (cut < 0) {
      for (var j = max; j > max * 0.55; j--) {
        if (s.charAt(j) === ' ') { cut = j; break; }
      }
    }
    if (cut < 0) cut = max;
    return s.slice(0, cut).replace(/[\s·;,\/、，-]+$/, '') + ' …';
  }

  function cardHtml(c, withPrice) {
    var h = '<div class="card"><div class="imgbox">';
    if (c.img) {
      var isBlob = c.img.indexOf('idb:') === 0;
      h += '<img src="' + (isBlob ? '' : esc(c.img)) + '"' +
           (isBlob ? ' data-blob="' + esc(c.img.slice(4)) + '"' : '') + ' alt="">';
    } else h += '<div class="ph">NO IMAGE<br>未放产品图</div>';
    /* SKU 放最顶上一行 —— 欧美买家扫描目录时第一眼找的就是 item no.
       原来的 .sku 在图下方，容易被图挤掉视线。 */
    h += '</div><div class="sku">' + esc(c.sku || '—') + '</div>' +
         '<div class="nm">' + esc(c.name || '') + '</div><div class="specwrap"><table class="spec">';
    for (var i = 0; i < c.rows.length; i++) {
      var key = String(c.rows[i][0] == null ? '' : c.rows[i][0]);
      var raw = String(c.rows[i][1] == null ? '' : c.rows[i][1]);
      /* 清单型字段（Set Contents 整套餐刀构成）天生超长 —— 全库 108 条，
         最长 261 字符（14 件套）≈ 7 行，必然撑爆 25.2mm 的 specwrap。
         卡片上给更短的上限：写「件数 + 前两三件 + …」，完整清单走报价单 / PI。 */
      var lim = /set contents/i.test(key) ? 34 : 44;
      var txt = specClip(withDual(raw), lim);
      /* title 挂全文 —— HTML 版鼠标悬停能看全，PDF 无影响但也无害 */
      h += '<tr><td class="k">' + esc(key) + '</td><td class="v"' +
        (txt !== raw.replace(/\s+/g, ' ').trim() ? ' title="' + esc(raw) + '"' : '') +
        '>' + esc(txt) + '</td></tr>';
    }
    h += '</table></div>';
    if (withPrice && c.price) {
      /* 报价块做成小表 —— 买家习惯直接看"哪个数量段多少钱" */
      h += '<div class="pricebox"><table class="ptab">' +
        '<tr><td class="pl">FOB ' + PLACE + '</td><td class="pv">' +
          '<b>' + money(c.price.fob) + '</b></td></tr>' +
        '<tr><td class="pl">500–999 pcs</td><td class="pv">' +
          '<span>' + money(c.price.t1) + '</span></td></tr>' +
        '<tr><td class="pl">1,000+ pcs</td><td class="pv">' +
          '<span>' + money(c.price.t2) + '</span></td></tr>' +
        '<tr><td class="pl">HTS (US)</td><td class="pv">' +
          '<span>' + esc(c.price.hts || '—') + '</span></td></tr>' +
        '</table><div class="pmeta">' +
        /* est=1 = 该价是按段码中值补的估算值，需核定。付PDF 前必须替换成核定价。 */
        (c.price.est ? '<span class="est">EST · 按段码中值估算</span> ' : '') +
        'Lead ' + esc(c.price.lead || '30–45 days') +
          ' · MOQ 50 pcs · USD, FOB ' + PLACE + '</div></div>';
    }
    h += '</div>';
    return h;
  }

  /* 尺寸双单位：欧美买家 inch/mm 两套都要，只给 mm 他们要自己换算 + 猜误差。
     v4 手册和卡片刻意都写成 '8.31″ · 211 mm'，这里只做兜底补全。 */
  function withDual(v) {
    var s = String(v == null ? '' : v);
    if (!s) return s;
    if (/[″"]/.test(s) && /mm/i.test(s)) return s;
    var m = s.match(/^([\d.]+)\s*mm\b(.*)$/i);
    if (m) {
      var inches = parseFloat(m[1]) / 25.4;
      if (isFinite(inches) && inches > 0.4 && inches < 24) {
        return '≈' + inches.toFixed(2) + '″ · ' + m[1] + ' mm' + (m[2] || '');
      }
    }
    return s;
  }

  /* 产品页排布 —— 行数按本页实际卡片数自适应（2026-10-05 改）。
     原来固定 `while (rows.length < 3) rows.push([])` 补满 3 行，导致：
       46 个 SKU = 5 页满9 +末页只挂 1 张 → 末页 2/3 是空白，
       欧、美目录不会让最后一页只放一张图（看起来像漏印）。
     现在：1~3 张 → 1 行 · 4~6 → 2 行 · 7~9 → 3 行，
     `.grow` 是 `flex:1 1 0` 所以行数越少每行越高，卡片自动撑满整页。
     >9 张（不会出现，PER_PAGE=9 上限）时兜底回 3 行。 */
  /* 产品页排布 —— **每行固定 3 张（=九宫格一列），卡片尺寸恒定**
     🔴 2026-10-05 定案（利：「他原来九个怎么排的，你四个也就往前变成四个怎么排的」）：
       绝对不能按卡片数重新分配行列，否则末页 4 张会排成 2×2、
       卡片宽度按 2 列算⇒ **每张比九宫格卡宽一倍**（实测户外册末页 4 张就被放大）。
     正解：
       · 每行恒定 3 张，顺序从左到右填满第一行再填第二行（123 → 第一行，4 → 第二行）
       · 行高用 `flex:0 0 calc((100% - 8mm)/3)` 固定为「九宫格一格高」，
         **不受该行实际卡片数影响** ⇒ 末页 4 张 = 第一行 3 张 + 第二行 1 张，卡片一样大
       · 行内卡片不足 3 个时**不拉伸**（`flex:0 0 calc((100% - 9.2mm)/3)` 已是定宽）
       · 第 3 行没有内容就不输出该行，避免留一个空行框
     PER_PAGE=9 仍是分页基准（每页 9 个），只是**排版不再随末页数量变化**。 */
  function pageCardsHtml(list, withPrice) {
    var n = list.length;
    if (!n) return '';
    var rows = [];
    for (var i = 0; i < n; i += 3) rows.push(list.slice(i, i + 3));
    return rows.map(function (r) {
      return '<div class="grow">' + r.map(function (c) { return cardHtml(c, withPrice); }).join('') + '</div>';
    }).join('');
  }

  function renderPreview() {
    var def = curDef();
    var host = $('pvBody');
    var list = cards();
    /* 与 buildPaper 用同一个 paginate()，否则预览的分页和导出的 PDF 不一致 */
    var PG = paginate(list), nPages = PG.nProd;
    var pages = [];
    for (var i = 0; i < nPages; i++) {
      pages.push('<div class="page"><div class="ph"><div class="t">' + esc(catMeta(def.cat).en) +
        '<span class="cn">' + esc(catMeta(def.cat).cn) + '</span></div><div class="r">' +
        esc(DATA.brand.name) + ' · Product Catalog ' + year() + '</div></div>' +
        '<div class="grid">' +
        pageCardsHtml(PG.chunks[i], def.withPrice) +
        '</div><div class="foot foot--plain"><span>' + esc(DATA.brand.display) + '</span><span>' +
        (i + 1) + ' / ' + nPages + '</span></div></div>');
    }
    var k = S.pvScale;
    var wpx = 210 * 96 / 25.4 * k;
    var hpx = 297 * 96 / 25.4 * k;
    host.innerHTML = '<div style="width:' + wpx + 'px;margin:0 auto">' +
      '<div class="pvbox" style="width:' + wpx + 'px;height:' + (hpx * pages.length + 6) +
      'px"><div class="scaler" style="transform:scale(' + k + ');transform-origin:top left">' +
      pages.join('') + '</div></div></div>';
    var imgs = host.querySelectorAll('img[data-blob]');
    for (var j = 0; j < imgs.length; j++) {
      (function (im) {
        blobUrl(im.getAttribute('data-blob')).then(function (u) { if (u) im.src = u; });
      })(imgs[j]);
    }
  }

  function renderAll() {
    renderBooks(); renderList(); renderEditor(); renderPreview(); updateUndoBtns();
  }

  /* ==================================================================
     编辑区事件
     ================================================================== */
  function bindEditor() {
    var host = $('edBody');

    host.addEventListener('click', function (e) {
      var t = e.target;
      var pick = t.closest ? t.closest('.imgpick') : null;
      if (pick) {
        var bt = t.closest('button');
        var act = bt ? bt.getAttribute('data-act') : null;
        if (act === 'pick') { $('fileIn').click(); return; }
        if (act === 'lib') { openLib(); return; }
        if (act === 'clear') {
          pushUndo();
          cards()[S.sel].img = '';
          delete cards()[S.sel].imgSize;
          delete cards()[S.sel].imgDims;
          renderAll(); markDirty(); toast('已清除图片');
          return;
        }
        $('fileIn').click(); return;
      }
      var del = t.closest ? t.closest('button[data-delrow]') : null;
      if (del) {
        pushUndo();
        cards()[S.sel].rows.splice(+del.getAttribute('data-delrow'), 1);
        renderAll(); markDirty(); return;
      }
      if (t.id === 'btnAddRow') {
        pushUndo();
        cards()[S.sel].rows.push(['', '']);
        renderEditor(); markDirty();
        var rows = host.querySelectorAll('.rrow');
        var last = rows[rows.length - 1];
        if (last) last.querySelector('.k').focus();
        return;
      }
    });

    /* ---- 文本编辑的撤销粒度 ----
       ⚠️ 一次「聚焦 → 编辑 → 失焦」= 1 步。
       若在 input 里 pushUndo，每敲一个字符压一条，栈会被打爆；
       若放到 focusout 才拍快照，headless / 某些浏览器里 blur 时序不可靠 → 撤不掉。
       折中：focusin 拍快照 + focusout 才入栈，且只在「值真的变了」时入栈。 */
    function fieldVal(t) {
      var c = cards()[S.sel];
      if (!c) return '';
      if (t.id === 'fSku') return c.sku || '';
      if (t.id === 'fName') return c.name || '';
      var pf = { pFob: 'fob', pT1: 't1', pT2: 't2', pHts: 'hts', pLead: 'lead' }[t.id];
      if (pf) return (c.price && c.price[pf]) || '';
      var row = t.closest ? t.closest('.rrow') : null;
      if (row) {
        var ri = +row.getAttribute('data-r');
        var f = t.getAttribute('data-f') === 'k' ? 0 : 1;
        return (c.rows[ri] && c.rows[ri][f]) || '';
      }
      return '';
    }
    // 快照里那个字段的原值（用来判断「有没有真改」）
    function snapVal(snap, t) {
      var c = snap.cards[snap.sel];
      if (!c) return '';
      if (t.id === 'fSku') return c.sku || '';
      if (t.id === 'fName') return c.name || '';
      var pf = { pFob: 'fob', pT1: 't1', pT2: 't2', pHts: 'hts', pLead: 'lead' }[t.id];
      if (pf) return (c.price && c.price[pf]) || '';
      var row = t.closest ? t.closest('.rrow') : null;
      if (row) {
        var ri = +row.getAttribute('data-r');
        var f = t.getAttribute('data-f') === 'k' ? 0 : 1;
        return (c.rows[ri] && c.rows[ri][f]) || '';
      }
      return '';
    }

    var editing = null;   // {key, snap, el} —— 与外层 pendingEdit 同步
    host.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t.tagName !== 'INPUT') return;
      // 若正在编辑另一个字段，先结算它
      if (pendingEdit && pendingEdit.el !== t) flushPendingEdit();
      var key = (t.id || '') + '@' + S.book + '#' + S.sel;
      if (pendingEdit && pendingEdit.key === key) { pendingEdit.el = t; return; }
      pendingEdit = { key: key, snap: snapshot(), el: t };
      editing = pendingEdit;
    });
    host.addEventListener('focusout', function (e) {
      var t = e.target;
      if (!pendingEdit || pendingEdit.el !== t) return;
      var snap = pendingEdit.snap;
      pendingEdit = null;
      editing = null;
      // 换卡片，或值真的变了 → 入栈
      if (S.book !== snap.book || S.sel !== snap.sel ||
          String(fieldVal(t)) !== String(snapVal(snap, t))) {
        S.undo.push(snap);
        if (S.undo.length > 60) S.undo.shift();
        S.redo.length = 0;
        updateUndoBtns();
        markDirty();
      }
    });

    // 输入：只更新数据 + 列表 + 预览，绝不重绘编辑区（保光标）
    host.addEventListener('input', function (e) {
      var t = e.target, c = cards()[S.sel];
      if (!c) return;
      if (t.id === 'fSku') { c.sku = t.value; afterEdit(); return; }
      if (t.id === 'fName') { c.name = t.value; afterEdit(); return; }
      if (t.id === 'fCat') { c.cat = t.value; renderList(); renderPreview(); markDirty(); return; }
      var row = t.closest ? t.closest('.rrow') : null;
      if (row && (t.getAttribute('data-f') === 'k' || t.getAttribute('data-f') === 'v')) {
        var ri = +row.getAttribute('data-r');
        while (c.rows.length <= ri) c.rows.push(['', '']);
        c.rows[ri][t.getAttribute('data-f') === 'k' ? 0 : 1] = t.value;
        afterEdit(); return;
      }
      var pf = { pFob: 'fob', pT1: 't1', pT2: 't2', pHts: 'hts', pLead: 'lead' }[t.id];
      if (pf) {
        c.price = c.price || { fob: '', t1: '', t2: '', hts: '', lead: '30–45 days' };
        c.price[pf] = t.value;
        // 🔴 核心：填了 FOB 单价 → 后两档同步算出来
        if (t.id === 'pFob') recalcPrice(c);
        else updateMini(numOf(c.price.t1), numOf(c.price.t2));
        afterEdit(); return;
      }
    });

    // 报价区的勾选框与算价规则按钮
    host.addEventListener('change', function (e) {
      var c = cards()[S.sel];
      if (e.target.id === 'ckAuto' || e.target.id === 'ckAutoHts') {
        if (!c) return;
        c.price = c.price || {};
        c.price.auto = $('ckAuto') ? $('ckAuto').checked : true;
        c.price.autoHts = $('ckAutoHts') ? $('ckAutoHts').checked : true;
        if (e.target.id === 'ckAuto') recalcPrice(c);
        else recalcHts(c);
        afterEdit(); markDirty();
        return;
      }
    });
    host.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'btnCalcHelp') { showCalcHelp(); return; }
    });

    host.addEventListener('change', function (e) {
      if (e.target.id === 'fCat') {
        pushUndo();
        var c = cards()[S.sel];
        c.cat = e.target.value;
        // 换品类 → HTS 跟着换（段码没变的话）
        if ($('ckAutoHts') && $('ckAutoHts').checked) recalcHts(c);
        renderList(); renderPreview(); markDirty();
        return;
      }
      if (e.target.id !== 'fileIn') return;
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      pushUndo();
      setImageFromFile(f);
      e.target.value = '';
    });
  }

  function afterEdit() {
    var c = cards()[S.sel];
    var it = $('lbody').querySelector('.litem.on');
    if (it && c) {
      var sk = it.querySelector('.lsku'); if (sk) sk.textContent = c.sku || '（未填 SKU）';
      var nm = it.querySelector('.lnm');   if (nm) nm.textContent = c.name || '（未填产品名）';
    }
    var t = $('edBody').querySelector('.nchead .st');
    if (t && c) t.textContent = c.sku || '新名片';
    renderPreview();
    markDirty();
  }

  function setImageFromFile(file) {
    var c = cards()[S.sel];
    if (!c) return;
    var probe = new Image();
    var url = URL.createObjectURL(file);
    probe.onload = function () {
      c.imgDims = probe.naturalWidth + ' × ' + probe.naturalHeight;
      URL.revokeObjectURL(url);
      renderAll(); markDirty();
    };
    probe.onerror = function () { URL.revokeObjectURL(url); };
    probe.src = url;
    var key = uid('img');
    c.imgSize = (file.size / 1024).toFixed(0) + ' KB';
    IDB.put(key, file).then(function () {
      if (URLCACHE[key]) { try { URL.revokeObjectURL(URLCACHE[key]); } catch (e) {} delete URLCACHE[key]; }
      c.img = 'idb:' + key;
      renderAll(); markDirty();
      cloudPutImg(key, file);      /* ☁️ 立刻推上云，别的电脑才看得到 */
      toast('图片已插入（' + c.imgSize + '，原文件字节，未压缩）· 正在同步到云端…');
    }).catch(function (err) { console.error(err); toast('图片保存失败：' + err); });
  }

  /* ==================================================================
     算价规则说明
     ================================================================== */
  function showCalcHelp() {
    var h = '<h4>自动算价怎么算的</h4>' +
      '<p>你只要填 <b>FOB 单价</b>，后面两档自动算出来：</p>' +
      '<table class="rt"><thead><tr><th>档位</th><th>算法</th><th>让利</th>' +
      '<th>例：FOB 39.00</th></tr></thead><tbody>' +
      '<tr><td>500–999</td><td>FOB × 0.94</td><td>让 6%</td><td><b>$36.66</b></td></tr>' +
      '<tr><td>1,000+</td><td>FOB × 0.88</td><td>让 12%</td><td><b>$34.32</b></td></tr>' +
      '</tbody></table>' +
      '<p style="color:var(--mute);font-size:11.5px;margin-top:8px">' +
      '这两个比例不是我拍脑袋定的 —— 是把 Excel 主表里 <b>246 个 SKU 的现有报价全部统计了一遍</b>，' +
      '发现<b>无一例外</b>都是这两个比例（246/246），所以直接沿用公司现行规则。</p>' +
      '<div class="tips" style="margin:12px 0 0"><b>要改价怎么办</b><br>' +
      '① 直接在 <code>500–999</code> / <code>1,000+</code> 框里手打 —— 填完自动关掉锁定；<br>' +
      '② 或者取消「自动算」勾选，两个框就变成完全手填，想填多少填多少。<br>' +
      '取消勾选的设置会跟着这张名片存起来。</div>';

    h += '<h4>HTS 怎么自动推荐</h4>' +
      '<p>按「品类 + SKU 段码」自动填，美国 HTS 编码一共用这 6 个：</p>' +
      '<table class="rt"><thead><tr><th>适用</th><th>HTS</th><th>说明</th></tr></thead><tbody>' +
      '<tr><td>厨刀 / 户外刀</td><td><code>8211.92.00</code></td><td> knives, with steel blades</td></tr>' +
      '<tr><td>套刀（成套）</td><td><code>8211.10.00</code></td><td>knives, sets</td></tr>' +
      '<tr><td>剪刀</td><td><code>8213.00.00</code></td><td>scissors</td></tr>' +
      '<tr><td>厨房配件 · 砧板段 CB</td><td><code>4419.19.00</code></td><td>木制品</td></tr>' +
      '<tr><td>厨房配件 · 烧烤/工具段 BBQ、TG</td><td><code>8215.20.00</code></td><td>餐具厨具</td></tr>' +
      '<tr><td>厨房配件 · 其余段</td><td><code>8215.99.00</code></td><td>其他餐具厨具</td></tr>' +
      '</tbody></table>' +
      '<p style="color:var(--mute);font-size:11.5px;margin-top:8px">' +
      '同样是统计现有 246 个 SKU 实际在用的编码得出的。<b>关掉勾选就能手填</b>，' +
      '报给美国客户前建议让对方报关行确认一次 —— 税则归类最终以对方 HS 判定为准。</p>';

    h += '<h4>交期</h4><p>按品类自动带出默认值（<code>Logo: 12d | ODM: 35d</code> 等），' +
      '也可以直接改。存量款 12 天打样、贴牌量产 35 天是我们常用的口径。</p>';

    h += '<h4>快速试算是干什么的</h4>' +
      '<p>报价块底部那行：按当前两档单价 × 数量算出<b>订单总额</b>，方便你在跟客户谈的时候' +
      '心算总价，不用另开计算器。</p>';

    modal('算价规则', h, '<button class="pri" data-mc="1">懂了</button>', true);
  }
  MODALS.calcHelp = function () { showCalcHelp(); };


  /* ==================================================================
     图库的「补充来源」——解决「手动往 img/ 丢图，图库里看不到」
     ------------------------------------------------------------------
     背景（实测结论，2026-10-05）：
       图库列表来自 **静态索引** `_imgindex.json`。往 img/ 里丢图，
       文件本身浏览器**能读到**（实测 onDisk=1500x1100），
       但**不会自动出现在图库里**（实测 inIndex=false）——
       索引不重扫就是看不见。这一点别再假设。

     🔴 2026-10-09 更正 + 升级：旧注释说「file:// 下浏览器没有列目录的
       API」——**只对了一半**。实测（Chrome 154，**不带**
       --allow-file-access-from-files，即真实双击条件）：
         · fetch('img/') 与 XHR 打目录 → 确实都失败（file:// 不许列目录）；
         · 但 `showDirectoryPicker` **在 file:// 下存在且可用**
           （self.isSecureContext === true；真调它抛的是 AbortError
           「用户取消」，**不是 SecurityError** ⇒ 安全门禁已通过，
           真机里会正常弹文件夹选择框）。
       ⇒ 于是有了下面的 `pickImgDir()` / `scanImgDir()`：
         选一次 img 文件夹 → 句柄存 IndexedDB → **以后每次打开自动重扫**，
         用户再也不用点任何东西。

     两条补充来源（都只写 localStorage，都并进「图库」）：
       · `kc_lib_scan_v1` —— 🔄 自动扫描本机 img 目录的快照（新机制·首选）
       · `kc_lib_extra_v1` —— 📁 手动「登记新图」（旧机制·保留兜底）
     ================================================================== */
  var LIB_EXTRA_KEY = 'kc_lib_extra_v1';

  /* 把两条补充来源合并进静态索引（幂等，按 f 全局去重）。
     必须在每次 LIB 赋值后调用，否则刷新一次就丢。 */
  function mergeLibExtra() {
    if (!LIB) return;
    if (!LIB.groups) LIB.groups = {};
    var have = {};
    Object.keys(LIB.groups).forEach(function (k) {
      (LIB.groups[k] || []).forEach(function (it) { have[it.f] = 1; });
    });
    var changed = false;
    function push(group, list) {
      var add = [];
      (list || []).forEach(function (x) {
        var f = 'img/' + x.n;
        if (have[f]) return;
        have[f] = 1;
        add.push({ f: f, s: x.s, d: x.d });
      });
      if (!add.length) return;
      LIB.groups[group] = add.concat(LIB.groups[group] || []);
      changed = true;
    }
    push('我登记的图', libExtra());
    var sc = libScan();
    if (sc && sc.items) push(SCAN_GROUP, sc.items);
    if (!changed) return;
    LIB.total = 0;
    Object.keys(LIB.groups).forEach(function (k) { LIB.total += LIB.groups[k].length; });
  }

  /* '2026-10-09T06:20:31+08:00' 或 1760000000000 → '10-09 06:20' */
  function fmtTs(t) {
    if (!t) return '';
    var d = new Date(t);
    if (isNaN(d.getTime())) return '';
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
           pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function libExtra() {
    try {
      var s = localStorage.getItem(LIB_EXTRA_KEY);
      return s ? (JSON.parse(s) || []) : [];
    } catch (e) { return []; }
  }
  function libExtraSave(arr) {
    try { localStorage.setItem(LIB_EXTRA_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  /* ==================================================================
     🔄 自动扫 img 目录（File System Access，2026-10-09 新增）
     ------------------------------------------------------------------
     目的：往 img\ 丢图 → 打开编辑器图库就能看见，**不用再点任何按钮**。

     三级退路（任何一级失败都不崩、都还能用）：
       L1  FSA 句柄：`showDirectoryPicker` 选一次 → 句柄存 IndexedDB
           （独立库 kc_fs_v1，**不动** kc_editor_v2，免得改到图片那条链）
           → 之后 `queryPermission` 已是 granted 就**静默重扫**。
       L2  webkitdirectory <input>：FSA 不可用/失败时回落到旧的 pickFolder。
       L3  什么都不做，只用静态索引（=改造前的行为，永远保底）。

     🔴 扫描**只用来发现「文件名 + 尺寸」**。图片路径仍然是 `img/xxx.jpg`
        —— 文件确实躺在 img\ 里，`<img src="img/xxx.jpg">` 在 file:// 下
        能直接加载（fetch 不行，但 <img> 行）。所以这里**不搬字节**。
     ================================================================== */
  var FSA_DB = 'kc_fs_v1', FSA_STORE = 'handles', FSA_KEY = 'imgDir';
  var LIB_SCAN_KEY = 'kc_lib_scan_v1';
  /* 组名只描述"索引里还缺的"，因为这组里的条目 = 扫描有、静态索引没有的 */
  var SCAN_GROUP = '本机 img 目录 · 索引里还没有的';

  function fsaSupported() { return typeof window.showDirectoryPicker === 'function'; }

  function fsaDB() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(FSA_DB, 1);
      rq.onupgradeneeded = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains(FSA_STORE)) d.createObjectStore(FSA_STORE);
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function fsaGet() {
    return fsaDB().then(function (d) {
      return new Promise(function (res) {
        var r = d.transaction(FSA_STORE, 'readonly').objectStore(FSA_STORE).get(FSA_KEY);
        r.onsuccess = function () { res(r.result || null); };
        r.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function fsaPut(h) {
    return fsaDB().then(function (d) {
      return new Promise(function (res) {
        var r = d.transaction(FSA_STORE, 'readwrite').objectStore(FSA_STORE).put(h, FSA_KEY);
        r.onsuccess = r.onerror = function () { res(!!h); };
      });
    }).catch(function () { return false; });
  }

  function libScan() {
    try { var s = localStorage.getItem(LIB_SCAN_KEY); return s ? (JSON.parse(s) || null) : null; }
    catch (e) { return null; }
  }
  function libScanSave(o) {
    try { localStorage.setItem(LIB_SCAN_KEY, JSON.stringify(o)); } catch (e) {}
  }

  /* File → '宽 × 高'（解不出来就空串，不阻断） */
  function imgDims(file) {
    return new Promise(function (res) {
      var pr = new Image(), u = URL.createObjectURL(file);
      pr.onload = function () { URL.revokeObjectURL(u); res(pr.naturalWidth + ' × ' + pr.naturalHeight); };
      pr.onerror = function () { URL.revokeObjectURL(u); res(''); };
      pr.src = u;
    });
  }

  /* 目录句柄 → 顶层图片 FileHandle 数组（img\ 是平铺的，不递归子目录） */
  function walkDir(dirHandle) {
    var out = [];
    var it = dirHandle.values();
    function step() {
      return it.next().then(function (r) {
        if (r.done) return out;
        if (r.value && r.value.kind === 'file' && IMG_EXT.test(r.value.name)) out.push(r.value);
        return step();
      });
    }
    return step();
  }

  function scanFiles(fileHandles) {
    return Promise.all(fileHandles.map(function (fh) {
      return fh.getFile().then(function (f) {
        return imgDims(f).then(function (d) {
          return { n: fh.name,
                   s: skuFromName(fh.name) || fh.name.replace(/\.[^.]+$/, ''),
                   d: d };
        });
      });
    }));
  }

  function commitScan(dirName, items) {
    libScanSave({ at: Date.now(), dir: dirName || 'img', items: items });
    if (!LIB) LIB = { groups: {} };
    mergeLibExtra();
    var fresh = (LIB.groups && LIB.groups[SCAN_GROUP]) ? LIB.groups[SCAN_GROUP].length : 0;
    return { ok: true, dir: dirName, scanned: items.length,
             fresh: fresh, total: LIB.total || 0 };
  }

  /* 静默重扫：只在"句柄在 + 权限已授"时干活，其余一律安静退出（不弹窗、不打扰） */
  function scanImgDir() {
    if (!fsaSupported()) return Promise.resolve({ ok: false, reason: 'no-fsa' });
    return fsaGet().then(function (h) {
      if (!h) return { ok: false, reason: 'no-handle' };
      return h.queryPermission({ mode: 'read' }).then(function (p) {
        if (p !== 'granted') return { ok: false, reason: 'need-permission' };
        return walkDir(h)
          .then(scanFiles)
          .then(function (items) {
            if (!items.length) return { ok: false, reason: 'empty' };
            return commitScan(h.name, items);
          });
      });
    }).catch(function (e) { return { ok: false, reason: 'err:' + (e && e.name) }; });
  }

  /* 用户点按钮：走一次文件夹选择（需要用户手势）→ 存句柄 → 扫 */
  function pickImgDir() {
    if (!fsaSupported()) return Promise.resolve({ ok: false, reason: 'no-fsa' });
    return window.showDirectoryPicker({ id: 'kc-imgdir', mode: 'read' })
      .then(function (h) { return fsaPut(h).then(function () { return h; }); })
      .then(function (h) {
        return walkDir(h).then(scanFiles).then(function (items) {
          if (!items.length) return { ok: false, reason: 'empty' };
          return commitScan(h.name, items);
        });
      })
      .catch(function (e) { return { ok: false, reason: 'err:' + (e && e.name) }; });
  }

  /* 开机静默同步一次（有句柄+有权限才动）。返回结果供测试断言。 */
  function autoScanOnBoot() {
    return scanImgDir().then(function (r) {
      if (r.ok && r.fresh > 0) toast('img 目录已同步：索引里新增 ' + r.fresh + ' 张图', 3600);
      return r;
    }).catch(function () { return { ok: false, reason: 'catch' }; });
  }

  function addToLib() {
    modal('登记新图', '' +
      '<h4>把你新放进 img 目录的图登记进图库</h4>' +
      '<div class="tips" style="margin:8px 0 12px;line-height:1.9">' +
      '⚠️ 这是<b>旧方式</b>，结果只存在浏览器里。' +
      '现在推荐用图库右上角的 <b>🔄 扫 img 目录</b>：绑定一次后每次打开自动同步。<br><br>' +
      '不管用哪种，图库列表都来自一份<b>静态索引</b>，所以：<br>' +
      '· 图丢进 <code>img\\</code> 目录 → <b>文件浏览器能读到</b>，但<b>图库里默认看不见</b>；<br>' +
      '· 点了下面这个按钮选一次 <code>img</code> 文件夹 → 新图<b>立刻进图库</b>；<br>' +
      '· 登记过的新图会<b>存进浏览器</b>，下次打开还在，不用重复选。<br>' +
      '</div>' +
      '<div style="padding:14px;border:1px dashed var(--line);border-radius:4px;text-align:center">' +
      '<button class="mbtn pri" id="libGo" style="padding:9px 20px">📁 选择 img 文件夹…</button>' +
      '<div style="font-size:10.5px;color:var(--faint);margin-top:6px" id="libTip">' +
      '就选 <code>产品目录编辑器\\img</code> 这个文件夹本身（不是上级目录）</div></div>' +
      '<div id="libOut"></div>', '<button data-mc="1">关闭</button>', true);

    $('libGo').addEventListener('click', function () {
      pickFolder(function (files) {
        var extra = libExtra();
        var seen = {};
        extra.forEach(function (x) { seen[x.n] = 1; });

        var before = (LIB && LIB.total) || 0;
        var added = 0, dup = 0, noSku = 0;
        var jobs = [];

        files.forEach(function (f) {
          if (!IMG_EXT.test(f.name)) return;
          if (seen[f.name]) { dup++; return; }
          seen[f.name] = 1;
          var sku = skuFromName(f.name);
          if (!sku) noSku++;
          jobs.push({ f: f, sku: sku });
        });

        if (!jobs.length) {
          $('libOut').innerHTML = '<div class="tips" style="color:var(--mute);margin-top:12px">' +
            '这个文件夹里没有新图' + (dup ? '（' + dup + ' 张之前已登记过）' : '') + '。</div>';
          return;
        }

        /* 逐张量尺寸（用 Image 解码拿真实宽高），再写进索引 */
        var todo = jobs.slice(), n = 0, bad = 0;
        $('libTip').textContent = '正在读取尺寸… 0 / ' + jobs.length;
        function next() {
          if (!todo.length) return fin();
          var j = todo.shift();
          var pr = new Image();
          var u = URL.createObjectURL(j.f);
          pr.onload = function () {
            URL.revokeObjectURL(u);
            n++;
            /* 路径写 img/xxx —— 页面按这个相对路径去读磁盘上的原图 */
            extra.push({ n: j.f.name, s: j.sku || j.f.name.replace(/\.[^.]+$/, ''),
                         d: pr.naturalWidth + ' × ' + pr.naturalHeight });
            $('libTip').textContent = '正在读取尺寸… ' + n + ' / ' + jobs.length;
            next();
          };
          pr.onerror = function () {
            URL.revokeObjectURL(u); bad++; n++;
            $('libTip').textContent = '正在读取尺寸… ' + n + ' / ' + jobs.length;
            next();
          };
          pr.src = u;
        }
        function fin() {
          libExtraSave(extra);
          /* 合并进内存索引 —— 走同一个 mergeLibExtra，行为跟刷新后完全一致 */
          if (!LIB) LIB = { groups: {} };
          mergeLibExtra();
          var tot = LIB.total || 0;
          closeModal();
          openLib();          /* 重开一次 = 立刻能看到新图 */
          toast('已登记 ' + jobs.length + ' 张新图（图库现共 ' + tot + ' 张）');
        }
        next();
      });
    });
  }

  /* 🔄 扫 img 目录：FSA 可用就走句柄（选一次、以后自动）；
     不可用/被取消/出错 → 一律回落到旧的「登记新图」（webkitdirectory）。
     🔴 这个函数永远不抛，最差情况就是什么都不做。 */
  function doScanLib() {
    if (!fsaSupported()) { addToLib(); return; }
    if ($('libTip')) $('libTip').textContent = '请在弹出的框里选 产品目录编辑器\\img 这个文件夹';
    pickImgDir().then(function (r) {
      if (r.ok) {
        var extra = r.fresh ? '（其中 ' + r.fresh + ' 张索引里还没有）' : '（索引里都有）';
        toast('已扫到 ' + r.scanned + ' 张图' + extra + ' · 已记住这个文件夹，以后自动同步', 4600);
        closeModal(); openLib();
        return;
      }
      if (r.reason === 'err:AbortError') { toast('已取消，没有改动', 2000); return; }
      if (r.reason === 'empty') { toast('这个文件夹里没找到图片，确认选的是 img 文件夹本身', 4200); return; }
      toast('自动扫描不可用（' + r.reason + '），改用「登记新图」', 4200);
      addToLib();
    }).catch(function () { toast('扫描失败，改用「登记新图」', 3600); addToLib(); });
  }

  function openLib() {
    var c = cards()[S.sel];
    if (!c) return;
    var hl = c.hlib || [];
    var q = '';

    /* ★ H 盘候选区 —— 2026-10-09 收进 <details>，**默认收起**。
       🔴 原因（利）：H 盘是这台电脑的移动盘，换台电脑打开时候选区全是空框，
       视觉上像「坏了」。折起来默认不显示，需要时点一下展开即可。
       用原生 <details>/<summary>：零 JS、无状态，也不影响下面 applyFilter / [data-lib] 点击
       （applyFilter 遍历的是 h4，H 盘标题改成 summary 后自然被排除，其余分组不受影响）。 */
    var hTitle = hl.length
      ? (hl[0].exact ? '本 SKU 实拍候选 ' + hl.length + ' 张'
                     : '参考图 ' + hl.length + ' 张（不是本款实拍）')
      : '本 SKU 在 H 盘没有同名文件夹';
    q += '<details class="hdisk">' +
         '<summary><span class="hdt">★ H 盘图库</span>' +
         '<span class="hds">' + esc(hTitle) + '</span>' +
         '<span class="hdh">' + (hl.length ? '点击展开' : '点开看说明') +
         ' · H 盘不在时这里会显示空图</span></summary><div class="hdbd">';
    if (hl.length) {
      var exact = hl[0].exact;
      q += '<div style="font-size:11.5px;color:var(--mute);margin:0 0 8px">' +
           (exact
             ? '按「像素大小 + 长宽比 + 文件名带 SKU + 内容合理性（自动排除 1688 规格表/满屏特写）」挑的候选。'
             : esc(c.hlibNote || 'H 盘没有与本 SKU 同名的文件夹。')) +
           ' 点一张即插入当前名片（<b>原文件字节直出</b>）。' +
           'H 盘是移动盘，<b>不在时图片显示不出来</b> —— 届时把图拷进 <code>img/</code> 目录即可。</div>';
      q += '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:8px;margin-bottom:6px">';
      hl.forEach(function (it, n) {
        var u = toFileUrl(it.p);
        q += '<div style="border:2px solid ' + (exact ? 'var(--gold)' : '#D2691E') +
             ';border-radius:3px;padding:4px;cursor:pointer;text-align:center;background:#fff" ' +
             'data-lib="' + esc(u) + '" data-dims="' + esc(it.w + ' × ' + it.h) + '" title="' +
             esc(it.p) + '">' +
             '<img loading="lazy" src="' + esc(u) + '" style="max-width:100%;height:64px;' +
             'object-fit:contain;background:#FAFCFD" onerror="this.style.opacity=.25">' +
             '<div style="font-size:8.5px;color:var(--mute);margin-top:3px">' +
             (it.w + '×' + it.h) + '</div>' +
             '<div style="font-size:8px;color:var(--gold-d)">' + (exact ? '实拍 ' : '参考 ') +
             (n + 1) + '</div></div>';
      });
      q += '</div>';
    } else {
      q += '<div style="font-size:11.5px;color:var(--mute);margin-bottom:10px">' +
           '本张 SKU（<code>' + esc(c.sku) + '</code>）在 H:/上品sku 里没找到同名文件夹。' +
           '可以先用内置图，后面换成实拍图。</div>';
    }
    q += '</div></details>';

    /* 内置图库 */
    if (!LIB) {
      /* 🔴 原来这里在 loadJson 失败时 LIB 仍为 null（fetch 被 file:// 拦），
         于是递归 openLib() → 再次进入同一分支 → 无限重试，
         表现为「选图」永远卡在「正在读图库索引…」。
         现在 loadJson 有 script 退路；万一两条路都断，用 LIB_FAIL 标记
         **只提示一次**并说清真实原因，不再空转、不再谎报。 */
      if (LIB_FAIL) {
        q += '<div style="padding:22px;text-align:center;color:#8A6A16;font-size:12px;' +
             'line-height:1.9;background:#F6F1E2;border-left:3px solid #C8A24B;' +
             'border-radius:3px;margin-top:8px">' +
             '<b>内置图库索引读不到</b><br>' +
             '<code>_imgindex.json</code> 和退路 <code>_imgindex.js</code> 都读不到。<br>' +
             '在项目根目录运行 <code>python _kcdata.py</code> 生成退路文件即可。<br>' +
             '<span style="color:var(--faint)">当前仍可用「H 盘图库候选」或手动上传图片。</span>' +
             '</div>';
        modal('选图', q, '<button data-mc="1">关闭</button>', true);
        return;
      }
      q += '<div style="padding:30px;text-align:center;color:var(--faint)">正在读图库索引…</div>';
      modal('选图', q, '<button data-mc="1">关闭</button>', true);
      loadJson('_imgindex.json', 'KC_IMG_INDEX').then(function (j) {
        /* 失败时置 LIB_FAIL 再调 openLib() —— 它会走上面的 LIB_FAIL 分支（那里 return），
           所以只提示一次、不会递归。成功时 LIB 有值，正常渲染。 */
        if (!j) { LIB_FAIL = true; } else { LIB = j; mergeLibExtra(); }
        openLib();
      });
      return;
    }
    var groups = Object.keys(LIB.groups || {});
    /* 每次渲染前都合并一次登记过的图 —— mergeLibExtra 按文件名去重，是幂等的。
       🔴 不这么做的话：点「登记新图」后当场重开弹窗会看不到新图（LIB 已加载、
       不会再走 loadJson 那条分支）—— 实测踩过。 */
    mergeLibExtra();
    groups = Object.keys(LIB.groups || {});
    var sc0 = libScan();
    var meta = '索引 ' + (fmtTs(LIB.generated) || '时间未知') +
               (sc0 && sc0.at ? ' · 本机扫描 ' + fmtTs(sc0.at) : '');
    q += '<h4 id="libHead">内置图库（' + (LIB.total || 0) + ' 张 · 全部已进目录的原图）' +
         '<span style="color:var(--faint);font-weight:400;font-size:11.5px">　' +
         esc(meta) + '</span></h4>';
    q += '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">' +
      '<input id="libQ" placeholder="搜索 SKU / 文件名…" style="flex:1;padding:7px 10px;' +
      'border:1px solid var(--line);border-radius:3px">' +
      '<label style="font-size:11.5px;color:var(--mute);display:flex;align-items:center;gap:4px;' +
      'white-space:nowrap;cursor:pointer"><input type="checkbox" id="libOnlySku"> 只看本张 SKU</label>' +
      '<span style="font-size:11.5px;color:var(--faint);white-space:nowrap" id="libCnt"></span>' +
      '<button class="mbtn pri" id="btnScanLib" style="white-space:nowrap" ' +
      'title="选一次 产品目录编辑器\\img 文件夹。绑定一次以后，每次打开都会自动同步，不用再点">' +
      '🔄 扫 img 目录</button>' +
      '<button class="mbtn" id="btnAddLib" style="white-space:nowrap" ' +
      'title="（旧方式）手动挑图登记进图库，不写磁盘">📁 登记新图</button></div>';
    groups.forEach(function (g) {
      var arr = LIB.groups[g];
      q += '<h4 style="margin-top:10px">' + esc(g) + ' <span style="color:var(--faint);font-weight:400">(' +
           arr.length + ')</span></h4>';
      q += '<div style="display:grid;grid-template-columns:repeat(10,1fr);gap:6px">';
      arr.forEach(function (it) {
        q += '<div style="border:1px solid var(--line);border-radius:3px;padding:3px;cursor:pointer;' +
             'text-align:center;background:#fff" data-lib="' + esc(it.f) + '"' +
             ' data-sku="' + esc(it.s) + '" data-dims="' + esc(it.d || '') + '" title="' + esc(it.s) + '">' +
             '<img loading="lazy" src="' + esc(it.f) + '" style="max-width:100%;height:50px;' +
             'object-fit:contain">' +
             '<div style="font-size:8px;font-family:Consolas,monospace;color:var(--gold-d);' +
             'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">' +
             esc(it.s) + '</div></div>';
      });
      q += '</div>';
    });
    q += '<div style="font-size:11px;color:var(--faint);margin-top:10px;padding-top:8px;' +
         'border-top:1px solid var(--line2)">点任意一张即插入当前名片，<b>原文件字节直出，不压缩</b>。' +
         '往 <code>img\\</code> 丢新图后，只要点过一次 <b>🔄 扫 img 目录</b>（选 ' +
         '<code>产品目录编辑器\\img</code>），' +
         '以后每次打开会自动同步；要上线还得让 AI 重建索引再发布。' +
         'H 盘图是绝对路径，导出 PDF 前请确认 H 盘已连接，或改成用内置图库。</div>';

    modal('选图', q, '<button data-mc="1">取消</button>', true);

    var box = $('mdBody').querySelectorAll('[data-lib]');
    var heads = $('mdBody').querySelectorAll('h4');
    function applyFilter() {
      var v = ($('libQ') ? $('libQ').value : '').trim().toLowerCase();
      var onlySku = $('libOnlySku') ? $('libOnlySku').checked : false;
      var sku = (c.sku || '').toLowerCase();
      var n = 0;
      for (var i = 0; i < box.length; i++) {
        var s = (box[i].getAttribute('data-sku') || '').toLowerCase();
        var f = box[i].getAttribute('data-lib').toLowerCase();
        var isH = box[i].getAttribute('data-sku') === null;   // H 盘候选
        var ok = isH ? true : ((!v || s.indexOf(v) >= 0 || f.indexOf(v) >= 0) &&
                               (!onlySku || s.indexOf(sku) >= 0));
        box[i].style.display = ok ? '' : 'none';
        if (ok) n++;
      }
      for (var h = 0; h < heads.length; h++) {
        /* 🔴 「内置图库（N 张 · 索引 …）」这个总标题（id=libHead）恒显 ——
           它后面紧跟的是**工具条 div**（里面没有 [data-lib]），
           下面那套「看 nextElementSibling 里有没有卡片」的判据会把它
           当成空分组隐藏掉（潜伏已久，2026-10-09 看截图才发现）。
           它本来也不该被当成"某个分组"，直接跳过。 */
        if (heads[h].id === 'libHead') { heads[h].style.display = ''; continue; }
        var nxt = heads[h].nextElementSibling;
        var kids = nxt ? nxt.querySelectorAll('[data-lib]') : [];
        var any = false;
        for (var j = 0; j < kids.length; j++) if (kids[j].style.display !== 'none') { any = true; break; }
        heads[h].style.display = any ? '' : 'none';
      }
      if ($('libCnt')) $('libCnt').textContent = n + ' / ' + box.length;
    }
    if ($('libQ')) $('libQ').addEventListener('input', applyFilter);
    if ($('libOnlySku')) $('libOnlySku').addEventListener('change', applyFilter);
    applyFilter();
    if ($('btnAddLib')) $('btnAddLib').addEventListener('click', function () { addToLib(); });
    if ($('btnScanLib')) $('btnScanLib').addEventListener('click', function () { doScanLib(); });
    $('mdBody').addEventListener('click', function (e) {
      var d = e.target.closest ? e.target.closest('[data-lib]') : null;
      if (!d) return;
      pushUndo();
      c.img = d.getAttribute('data-lib');
      c.imgDims = d.getAttribute('data-dims') || '';
      c.imgSize = '';
      closeModal(); renderAll(); markDirty();
      toast('已插入' + (d.getAttribute('data-sku') ? ' ' + d.getAttribute('data-sku') : ' H 盘候选图'));
    });
  }

  /* ==================================================================
     校准报告
     ================================================================== */
  function openCalib() {
    if (!CALIB) {
      /* 🔴 原来失败文案是「找不到 data/calibration.json，请运行 _gen_data_v2.py」——
         但实测 file:// 下文件**是在的**（69 KB），只是 fetch 被 CORS 拦，
         这条误导会让利白跑一遍生成器（而生成器并不解决 CORS）。
         正解：区分「读不到」和「文件真不存在」，并给出对症的修复动作。 */
      if (CALIB_FAIL) {
        modal('规格校准报告',
          '<div style="font-size:12.5px;line-height:1.9;color:var(--ink)">' +
          '<b style="color:#C0392B">校准数据读不到</b><br>' +
          '<code>data/calibration.json</code> 与退路 <code>data/calibration.js</code> 都读不到。<br>' +
          '在项目根目录运行 <code>python _kcdata.py</code> 生成退路文件。<br>' +
          '<span style="color:var(--mute)">若提示的是「文件不存在」，再运行 ' +
          '<code>python _gen_data_v2.py</code> 重新生成校准数据。</span></div>',
          '<button class="pri" data-mc="1">知道了</button>', true);
        return;
      }
      modal('规格校准报告',
        '<div style="padding:30px;text-align:center;color:var(--faint)">正在读校准数据…</div>',
        '<button data-mc="1">关闭</button>', true);
      loadJson('data/calibration.json', 'KC_CALIBRATION').then(function (j) {
        if (!j) { CALIB_FAIL = true; return; }
        CALIB = j;
        openCalib();          // 读到了 → 递归一次继续往下渲染（这是正常流程，不是死循环）
      });
      return;
    }
    var byCat = CALIB.summary.byCat || {};
    var h = '';
    h += '<div class="tips" style="margin:0 0 12px"><b>怎么做的：</b>' +
         '把 Excel 主表里 AI 生成的规格，逐条拿去比亚马逊 / 阿里巴巴国际站 / 品牌官网' +
         '同类产品的实测尺寸。<b>差距明确（物理上不可能、或与实据差 15% 以上）的才改，' +
         '每条改动都写清来源；<b>不确定的一律保留原值</b>，只在下面第二张表里列出来，' +
         '等拿到样品实测再定。</div>';
    h += '<table class="rt"><thead><tr><th>品类</th><th>已改</th><th>待实测</th>' +
         '<th>小计</th></tr></thead><tbody>';
    Object.keys(byCat).forEach(function (k) {
      var s = byCat[k];
      h += '<tr><td>' + esc(s.cn) + '</td><td>' + s.chg + '</td><td>' + s.flag + '</td><td>' +
           (s.chg + s.flag) + '</td></tr>';
    });
    h += '<tr style="font-weight:700;background:#F6F8FA"><td>合计</td><td>' +
         CALIB.summary.changes + '</td><td>' + CALIB.summary.flags + '</td><td>' +
         (CALIB.summary.changes + CALIB.summary.flags) + '</td></tr></tbody></table>';

    h += '<h4>① 已修改的规格（' + CALIB.changes.length + ' 条）</h4>';
    h += '<div style="max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:4px">' +
         '<table class="rt"><thead><tr><th>SKU</th><th>产品名</th><th>字段</th>' +
         '<th>原值</th><th>改成</th><th>依据</th></tr></thead><tbody>';
    CALIB.changes.forEach(function (c) {
      h += '<tr><td><code>' + esc(c.sku) + '</code><br><span style="color:var(--faint);font-size:10px">' +
           esc(c.catCn) + '</span></td><td>' + esc(c.name) + '</td><td>' + esc(c.col) + '</td>' +
           '<td style="color:var(--err)">' + esc(c.old) + '</td>' +
           '<td style="color:var(--ok);font-weight:700">' + esc(c.new) + '</td>' +
           '<td style="color:var(--mute);font-size:10.5px">' + esc(c.ref) + '</td></tr>';
    });
    h += '</tbody></table></div>';

    h += '<h4>② 待实测（' + CALIB.flags.length + ' 条 · <b>未改动</b>）</h4>';
    h += '<div style="max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:4px">' +
         '<table class="rt"><thead><tr><th>SKU</th><th>产品名</th><th>字段</th>' +
         '<th>现值</th><th>为什么不改</th></tr></thead><tbody>';
    CALIB.flags.forEach(function (c) {
      h += '<tr><td><code>' + esc(c.sku) + '</code><br><span style="color:var(--faint);font-size:10px">' +
           esc(c.catCn) + '</span></td><td>' + esc(c.name) + '</td><td>' + esc(c.col) + '</td>' +
           '<td>' + esc(c.orig) + '</td>' +
           '<td style="color:var(--warn);font-size:10.5px">' + esc(c.note) + '</td></tr>';
    });
    h += '</tbody></table></div>';

    modal('规格校准报告 · ' + CALIB.summary.changes + ' 改 / ' +
          CALIB.summary.flags + ' 待实测', h,
          '<button data-mc="1">关闭</button>' +
          '<button class="pri" data-fn="dlCalib">导出报告 CSV</button>', true);
  }
  MODALS.dlCalib = function () {
    var lines = ['品类,SKU,产品名,字段,原值,新值,依据'];
    CALIB.changes.forEach(function (c) {
      lines.push([c.catCn, c.sku, c.name, c.col, c.old, c.new, c.ref]
        .map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(','));
    });
    lines.push('');
    lines.push('品类,SKU,产品名,字段,现值,为什么不改（未改动）');
    CALIB.flags.forEach(function (c) {
      lines.push([c.catCn, c.sku, c.name, c.col, c.orig, c.note]
        .map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'KaiLionCrafts_规格校准报告_' + CALIB.generated + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    closeModal();
    toast('CSV 已下载（Excel 直接打开不乱码）');
  };

  /* ==================================================================
     名片操作
     ================================================================== */
  function addCard() {
    pushUndo();
    var def = curDef();
    var list = cards();
    var cat = def.cat || (list[S.sel] && list[S.sel].cat) || 'knives';
    var pre = { knives: 'KL-KN', sets: 'KL-KN-SET', scissors: 'KL-SC',
                accessories: 'KL-KA', outdoor: 'KL-OD' }[cat] || 'KL-XX';
    var rows = (cat === 'accessories')
      ? [['Size', ''], ['Material', ''], ['Net Weight', ''], ['Pcs / Carton', ''],
         ['Carton Size (cm)', ''], ['N.W. / Carton', ''], ['MOQ', '']]
      : [['Material', ''], ['Blade', ''], ['Overall', ''], ['Wt · Thk · HRC', ''],
         ['Pcs · Carton', ''], ['N.W. / G.W.', ''], ['MOQ · Load', '']];
    var nc = {
      sku: pre + '-XX-' + pad2(list.length + 1),
      name: '新产品名称',
      rows: rows, img: '', cat: cat,
      price: def.withPrice ? { fob: '', t1: '', t2: '', hts: '', lead: '30–45 days' } : null
    };
    list.splice(S.sel + 1, 0, nc);
    S.sel += 1;
    renderAll(); markDirty();
    toast('已新增名片，填 SKU 和规格吧');
  }
  function dupCard() {
    var c = cards()[S.sel];
    if (!c) { toast('先选一张名片'); return; }
    pushUndo();
    var nc = clone(c);
    nc.sku = c.sku + '-2';
    cards().splice(S.sel + 1, 0, nc);
    S.sel += 1;
    renderAll(); markDirty();
    toast('已复制一张名片');
  }
  function delCard() {
    var list = cards();
    if (!list.length) return;
    var c = list[S.sel];
    modal('删除名片',
      '<p>确定删除 <b>' + esc(c.sku) + '</b>（' + esc(c.name) + '）？</p>' +
      '<p style="color:var(--faint);font-size:11.5px;margin-top:6px">可以用 Ctrl+Z 撤销。</p>',
      '<button data-mc="1">取消</button><button class="pri" data-fn="delOk">删除</button>');
  }
  MODALS.delOk = function () {
    pushUndo();
    cards().splice(S.sel, 1);
    if (S.sel >= cards().length) S.sel = Math.max(0, cards().length - 1);
    closeModal(); renderAll(); markDirty(); toast('已删除');
  };
  /* 拖拽排序：把 from 位置的卡片移到 to 位置（after=true 插到其后）
     ⚠️ 在搜索过滤状态下**禁止调用**（下标与真实顺序不一致）。 */
  function moveItem(from, to, after) {
    if (S.q.trim()) { toast('搜索状态下不能调整顺序', 4000); return; }
    var list = cards();
    if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return;
    flushPendingEdit();
    pushUndo();
    var moved = list.splice(from, 1)[0];
    var at = to > from ? to : to;      /*splice 后目标前移，这里统一按 to 插入 */
    if (after && to > from) at = to;
    if (!after && to > from) at = to - 1;
    if (!after && to < from) at = to;
    list.splice(at, 0, moved);
    S.sel = at;
    renderAll(); markDirty();
    toast('已移动到第 ' + (at + 1) + ' 位');
  }

  /* 恢复默认排序：单刀在前、套刀在后（跟数据层生成顺序一致） */
  function restoreOrder() {
    flushPendingEdit();
    pushUndo();
    var list = cards();
    list.sort(function (a, b) {
      var sa = (a.cat === 'sets' || /-SET-/i.test(a.sku || '')) ? 1 : 0;
      var sb = (b.cat === 'sets' || /-SET-/i.test(b.sku || '')) ? 1 : 0;
      if (sa !== sb) return sa - sb;          /* 单刀组在前 */
      return String(a.sku || '').localeCompare(String(b.sku || ''));
    });
    S.sel = 0;
    renderAll(); markDirty();
    toast('已恢复默认排序（单刀在前、套刀在后）');
  }

  function move(dir) {
    var list = cards();
    var at = S.sel + dir;
    if (at < 0 || at >= list.length) { toast('已经在' + (dir < 0 ? '最前' : '最后') + '一张了'); return; }
    pushUndo();
    var t = list[at];
    list[at] = list[S.sel];
    list[S.sel] = t;
    S.sel = at;
    renderAll(); markDirty();
  }

  /* ==================================================================
     批量导 SKU —— 一个文件夹一批名片，零命令行
     ------------------------------------------------------------------
     为什么要有这个（历史）：
       以前往目录里加 SKU 只能跑 _scan_hsku3.py + _gen_data_v2.py + _kcdata.py
       这条链要 5 分钟、要装 Python、而且扫的是 H 盘移动盘 —— 利用不起来。
       现在改成：直接点「📥 批量导 SKU」→ 选一个文件夹 → 结束。
       浏览器一次性拿到全文件夹（webkitdirectory），SKU 从文件夹名来，
       图从文件夹里的图来，规格从同目录的 Excel/CSV 来（可选）。

     目录结构约定（三种都支持，按优先级）：
       A. 根/  厨刀 / KL-KN-SS-001 / 任意图.jpg        ← 用 KL-KN-SS-001 当 SKU
       B. 根/  厨刀 /  01.jpg 02.jpg ...               ← 文件夹名即 SKU
       C. 根/  KL-KN-SS-001.jpg ...                    ← 文件名即 SKU，图在根

     🔴 图片存 IndexedDB 原始 Blob（跟 setImageFromFile 同一套），
        所以是**原文件字节**、不压缩，导出 PDF 不会糊。
     ================================================================== */
  var SKURE = /\b(KL-[A-Z]{2}(?:-[A-Z]{2,3})*-[A-Z]{2}-\d{3}(?:-[A-Z]{2})?)\b/;

  function skuFromName(name) {
    var s = String(name || '').trim();
    var up = s.toUpperCase();
    var m = up.match(SKURE);
    if (m) return m[1];
    /* 退化：把文件名里的常见修饰剥掉，只留像 SKU 的那一段 */
    m = up.match(/KL-[A-Z0-9-]{4,}/);
    if (m) return m[0].replace(/[-_]+$/, '');
    return null;
  }

  function pickFolder(cb) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.webkitdirectory = true;
    inp.setAttribute('webkitdirectory', '');
    inp.setAttribute('directory', '');
    inp.style.position = 'fixed';
    inp.style.left = '-9999px';
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var fs = Array.prototype.slice.call(inp.files || []);
      setTimeout(function () { try { inp.remove(); } catch (e) {} }, 0);
      if (fs.length) cb(fs);
    });
    inp.click();
  }

  var IMG_EXT = /\.(jpe?g|png|webp|avif|bmp)$/i;
  var TXT_EXT = /\.(csv|txt|tsv|json)$/i;

  function openBulk() {
    var def = curDef();
    var q = '';
    q += '<h4>批量导 SKU —— 选一个文件夹</h4>';
    q += '<div class="tips" style="margin:8px 0 12px;line-height:1.95">' +
      '<b>文件夹怎么摆</b>（三种都认，按这个顺序找SKU）：<br>' +
      '<code>根目录\\品类\\SKU名\\图片.jpg</code>　← 推荐，SKU 名就是文件夹名<br>' +
      '<code>根目录\\SKU名\\01.jpg 02.jpg…</code>　← 也行，图多时用这个<br>' +
      '<code>根目录\\KL-KN-SS-001.jpg…</code>　　← 图直接摊在根目录<br>' +
      '每张卡会<b>自动取第一张能解码的图</b>（跳过截图/文档类小图），' +
      'SKU 从文件夹名或文件名里认（认 <code>KL-XX-YYY-NNN</code> 这种格式）。' +
      '</div>';
    q += '<div style="font-size:11.5px;color:var(--mute);margin-bottom:10px">' +
      '规格行先给空白模板，导完在左边逐张填 —— 想自动带规格的话，把 ' +
      '<b>同名的 .csv/.txt</b> 一起放进 SKU 文件夹，本功能会读第一行做产品名。</div>';
    q += '<div style="display:flex;gap:8px;margin-bottom:12px">' +
      '<label style="flex:1;font-size:11.5px"><input type="checkbox" id="bkSkip" checked> ' +
      '跳过已存在的同名 SKU（不覆盖）</label>' +
      '<label style="flex:1;font-size:11.5px"><input type="checkbox" id="bkFirst" checked> ' +
      '每个 SKU 只取 1 张主图</label>' +
      '</div>';
    q += '<div style="padding:14px;border:1px dashed var(--line);border-radius:4px;' +
      'text-align:center;background:var(--paper2,#FAFCFD)">' +
      '<button class="mbtn pri" id="bkGo" style="padding:9px 20px;font-size:12.5px">📁 选择文件夹…</button>' +
      '<div style="font-size:10.5px;color:var(--faint);margin-top:6px" id="bkTip">' +
      '会打开系统文件夹选择框 · 选最外层那个文件夹（含所有 SKU 的那个）</div></div>';
    q += '<div id="bkOut"></div>';
    modal('批量导 SKU', q,
      '<button data-mc="1">关闭</button><button class="pri" data-mc="1">完成</button>', true);

    $('bkGo').addEventListener('click', function () {
      var skip = $('bkSkip').checked;
      var first = $('bkFirst').checked;
      $('bkTip').textContent = '正在读取…';
      pickFolder(function (files) { bulkImport(files, skip, first); });
    });
  }

  function bulkImport(files, skipExist, firstOnly) {
    var def = curDef();
    var list = cards();
    var existing = {};
    list.forEach(function (c) { if (c.sku) existing[c.sku.toUpperCase()] = 1; });

    /* ---- 按 SKU 归组：key = {sku, imgs:[], texts:[]} ---- */
    var groups = {};
    var order = [];
    var skipped = 0;

    files.forEach(function (f) {
      var rel = f.webkitRelativePath || f.name;
      var parts = rel.split('/').filter(function (x) { return x; });
      if (parts.length < 2) return;           /* 至少要在某一级文件夹里 */
      var file = parts[parts.length - 1];
      var dirs = parts.slice(0, parts.length - 1);
      var sku = null;

      /* A: 根/品类/SKU名/图 —— 取倒数第二级目录名 */
      if (!sku && dirs.length >= 2) sku = skuFromName(dirs[dirs.length - 1]);
      /* B: 根/SKU名/图 —— 取最后一级目录名 */
      if (!sku) sku = skuFromName(dirs[dirs.length - 1]);
      /* C: 根/图 */
      if (!sku) sku = skuFromName(file);

      if (!sku) { skipped++; return; }
      var K = sku.toUpperCase();
      if (!groups[K]) { groups[K] = { sku: sku, imgs: [], txts: [] }; order.push(K); }
      if (IMG_EXT.test(file)) groups[K].imgs.push(f);
      else if (TXT_EXT.test(file)) groups[K].txts.push(f);
    });

    var keys = order.filter(function (K) {
      if (skipExist && existing[K]) return false;
      return true;
    });
    var dupSkipped = order.length - keys.length;

    if (!keys.length) {
      $('bkOut').innerHTML = '<div class="tips" style="color:var(--bad)">' +
        (order.length
          ? '找到 ' + order.length + ' 个 SKU，但都已存在（取消「跳过已存在」可强制导入）。'
          : '没认出任何 SKU。文件夹名或图片名里要能匹配 <code>KL-XX-YYY-NNN</code>。')
        + '</div>';
      $('bkTip').textContent = '选最外层那个文件夹（含所有 SKU 的那个）';
      return;
    }

    /* ---- 先问尺寸：主图要能解码才算数 ---- */
    var todo = keys.slice();
    var made = 0, noImg = 0, failed = 0;
    var report = [];
    var t0 = Date.now();

    function nextOne() {
      if (!todo.length) return finish();
      var K = todo.shift();
      var g = groups[K];
      var cands = firstOnly ? g.imgs.slice(0, 6) : g.imgs.slice();
      tryPick(cands, 0, function (file, dims) {
        var nc = {
          sku: g.sku,
          name: g.txtName || '新产品名称',
          rows: def.withPrice
            ? [['Material', ''], ['Blade', ''], ['Overall', ''], ['Wt · Thk · HRC', ''],
               ['Pcs · Carton', ''], ['N.W. / G.W.', ''], ['MOQ · Load', '']]
            : [['Material', ''], ['Blade', ''], ['Overall', ''], ['Wt · Thk · HRC', ''],
               ['Pcs · Carton', ''], ['N.W. / G.W.', ''], ['MOQ · Load', '']],
          img: '', cat: def.cat || (list[S.sel] && list[S.sel].cat) || 'knives',
          price: def.withPrice ? { fob: '', t1: '', t2: '', hts: '', lead: 'Logo: 12d | ODM: 35d' } : null
        };
        if (file) {
          var key = uid('img');
          nc.imgDims = dims;
          nc.imgSize = (file.size / 1024).toFixed(0) + ' KB';
          IDB.put(key, file).then(function () {
            nc.img = 'idb:' + key;
            cloudPutImg(key, file);      /* ☁️ 立即同步，别等下次开机补 */
            pushUndo();
            list.push(nc);
            existing[K] = 1;
            made++;
            report.push({ sku: g.sku, ok: 1, dim: dims });
            paint();
            nextOne();
          }).catch(function (e) {
            failed++;
            report.push({ sku: g.sku, ok: 0, note: '存图失败' });
            nextOne();
          });
        } else {
          noImg++;
          report.push({ sku: g.sku, ok: 2 });
          pushUndo();
          list.push(nc);
          existing[K] = 1;
          made++;
          paint();
          nextOne();
        }
      });
    }

    /* 依次试候选图，跳过解码失败的（截图/文档缩略图 decode 成功但通常很小，
       用最小边长兜底过滤） */
    function tryPick(arr, i, cb) {
      if (i >= arr.length) return cb(null, '');
      var f = arr[i];
      var pr = new Image();
      var u = URL.createObjectURL(f);
      var settled = false;
      pr.onload = function () {
        if (settled) return; settled = true;
        var w = pr.naturalWidth, h = pr.naturalHeight;
        URL.revokeObjectURL(u);
        /* 主图至少 300×300，且长边不小于 1.2 倍短边（排掉细长条） */
        if (Math.min(w, h) < 300) return tryPick(arr, i + 1, cb);
        cb(f, w + ' × ' + h);
      };
      pr.onerror = function () {
        if (settled) return; settled = true;
        URL.revokeObjectURL(u);
        tryPick(arr, i + 1, cb);
      };
      pr.src = u;
    }

    function paint() {
      $('bkTip').textContent = '已处理 ' + (made + noImg + failed) + ' / ' + keys.length;
      S.sel = list.length - 1;
      renderAll(); markDirty();
    }

    function finish() {
      var sec = ((Date.now() - t0) / 1000).toFixed(1);
      var good = report.filter(function (r) { return r.ok === 1; }).length;
      var h = '<div class="tips" style="margin-top:14px;line-height:1.9">' +
        '<b>导入完成</b>（' + sec + 's）<br>' +
        '新增名片 <b>' + made + '</b> 张：其中带主图 <b>' + good + '</b> · 无可用图 ' + noImg + '<br>' +
        (skipped ? '认不出 SKU 而跳过 <b>' + skipped + '</b> 个文件<br>' : '') +
        (dupSkipped ? '因已存在而跳过 <b>' + dupSkipped + '</b> 个 SKU<br>' : '') +
        (failed ? '失败 <b>' + failed + '</b><br>' : '') +
        '</div>';
      var noImgList = report.filter(function (r) { return r.ok === 2; });
      if (noImgList.length) {
        h += '<div style="font-size:11px;color:var(--mute);margin-top:8px">' +
          '没图的（去「🖼 选图」或直接拖图进去）：' +
          noImgList.slice(0, 30).map(function (r) { return esc(r.sku); }).join('、') +
          (noImgList.length > 30 ? ' …等 ' + noImgList.length + ' 个' : '') + '</div>';
      }
      $('bkOut').innerHTML = h;
      $('bkTip').textContent = '完成';
      renderAll(); markDirty();
      toast('已导入 ' + made + ' 张名片（带图 ' + good + '）');
    }

    nextOne();
  }


  /* ==================================================================
     备份 / 导入
     ================================================================== */
  function exportJson() {
    var out = { app: 'kc-editor', ver: 2, ts: new Date().toISOString(), books: {} };
    var blobKeys = {};
    BOOKS.forEach(function (b) {
      var bs = S.books[b.id];
      var cs = clone(bs.cards);
      cs.forEach(function (c) {
        if (c.img && c.img.indexOf('idb:') === 0) blobKeys[c.img.slice(4)] = 1;
      });
      out.books[b.id] = { cards: cs, flags: bs.flags };
    });
    var keys = Object.keys(blobKeys);
    modal('导出备份',
      '<p>将导出全部 <b>' + BOOKS.length + '</b> 本册子的名片结构' +
      '（SKU / 名称 / 规格行 / 报价 / 图片引用 / H 盘候选）。</p>' +
      (keys.length ? '<p style="margin-top:8px;color:var(--warn)">⚠️ 本机含 <b>' + keys.length +
        '</b> 张你新上传的图片。JSON 只存<b>文字与结构</b>，图片要另外从浏览器里导出。</p>' : ''),
      '<button data-mc="1">取消</button><button class="pri" data-fn="dlJson">下载 JSON</button>');
  }
  MODALS.dlJson = function () {
    var out = { app: 'kc-editor', ver: 2, ts: new Date().toISOString(),
                /* 带数据层指纹：导入时如果与当前数据层不一致会提示，避免整批覆盖新 SKU */
                fp: (DATA.ver || '0') + '|' + (DATA.generated || '') + '|' + (DATA.struct || ''),
                books: {} };
    BOOKS.forEach(function (b) {
      out.books[b.id] = { cards: S.books[b.id].cards, flags: S.books[b.id].flags };
    });
    var blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'KaiLionCrafts_目录备份_v2_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    closeModal();
    toast('JSON 已下载');
  };
  function importJson() {
    var i = document.createElement('input');
    i.type = 'file'; i.accept = 'application/json,.json';
    i.onchange = function () {
      var f = i.files && i.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var o = JSON.parse(fr.result);
          if (!o.books) throw new Error('格式不对');
          /* 指纹不一致 = 备份时的数据层比现在旧/新，直接覆盖会把新 SKU 抹掉 */
          var curFp = (DATA.ver || '0') + '|' + (DATA.generated || '');
          if (o.fp && o.fp !== curFp &&
              !confirm('这份备份来自另一个数据层版本：\n备份：' + o.fp +
                       '\n当前：' + curFp +
                       '\n\n仍然导入？导入后当前数据层里新增的 SKU 会被备份里的旧内容覆盖。')) {
            return;
          }
          pushUndo();
          Object.keys(o.books).forEach(function (id) {
            if (S.books[id]) {
              S.books[id].cards = o.books[id].cards;
              if (o.books[id].flags) S.books[id].flags = o.books[id].flags;
            }
          });
          S.sel = 0;
          renderAll(); markDirty(); toast('已导入备份');
        } catch (e) { toast('导入失败：' + e.message); }
      };
      fr.readAsText(f);
    };
    i.click();
  }

  /* ==================================================================
     导出 PDF
     ================================================================== */
  var PAPER_CSS = null;
  function ensurePaperCss() {
    if (PAPER_CSS) return;
    PAPER_CSS =
'#paper{position:fixed;left:-99999px;top:0;width:210mm;background:#fff}' +
'@media print{' +
  /* ⚠️ html/body 必须 height:auto —— 否则多出一张全空白首页（实测 31 → 32 页） */
  'html,body{height:auto;overflow:visible;margin:0;padding:0;background:#fff}' +
  '#paper{position:static;left:auto;width:auto}' +
'}' +
'#paper *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
'#paper .page{width:210mm;height:297mm;padding:12mm 13mm 10mm;position:relative;' +
'page-break-after:always;overflow:hidden;background:#fff;display:flex;flex-direction:column}' +
'#paper .page:last-child{page-break-after:auto}' +
'#paper .ph{display:flex;align-items:baseline;justify-content:space-between;' +
'border-bottom:.6mm solid #C8A24B;padding-bottom:1.4mm;margin-bottom:3.4mm;flex:0 0 auto}' +
'#paper .ph .t{font-size:10.5pt;font-weight:700;color:#1B2A41}' +
'#paper .ph .t .cn{font-weight:400;color:#5C6B7A;font-size:9pt;margin-left:2mm}' +
'#paper .ph .r{font-size:7pt;color:#5C6B7A;letter-spacing:.06em;text-transform:uppercase}' +
'#paper .grid{display:flex;flex-direction:column;gap:4mm;flex:1 1 auto;min-height:0}' +
/* 🔴 2026-10-05 定案：行高**固定为九宫格一格高**（不随该行卡片数变化）。
   之前 `flex:1 1 0` 会让"只有 1 张的那一行"抢走全部剩余空间，
   连带 `.card{height:100%}` 把卡片撑成两倍高（末页 4 张时第一行 3 张被拉高、第二行 1 张也拉高）。
   ⇒ 改成 `flex:0 0 calc((100% - 8mm)/3)`：3 行均分页高、每行恒定，
      末页 4 张 = 第一行 3 张 + 第二行 1 张，**卡片尺寸与满页九宫格完全一致**。
      gap 4mm × 2 = 8mm，故减去 8mm。 */
'#paper .grid .grow{display:flex;gap:4.6mm;flex:0 0 calc((100% - 8mm) / 3);min-height:0}' +
'#paper .grid .grow > .card{flex:0 0 calc((100% - 9.2mm) / 3);min-width:0}' +
'#paper .card{border:.25mm solid #DDE3E9;border-radius:1.2mm;padding:1.5mm 2mm 1.8mm;' +
'display:flex;flex-direction:column;overflow:hidden;background:#fff;min-height:0;height:100%}' +
'#paper .card .imgbox{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center}' +
'#paper .card .imgbox img{max-width:46mm;max-height:100%;width:auto;height:auto;object-fit:contain}' +
'#paper .card .imgbox .ph{color:#C6CFD9;font-size:7pt;text-align:center;padding:6mm 2mm;' +
'border:.2mm dashed #DDE3E9;border-radius:1mm;width:80%}' +
/* SKU 徽章 —— 原来是固定 height:3.2mm + padding-top:.6mm，6.2pt 文字实际需要约 4mm，
   溢出被卡片 overflow:hidden 裁掉半行（截图实测：序号下沿被切）。
   正解：改成 inline-block 徽章（高度由内容决定 + flex 居中），外框自己撑开。 */
'#paper .sku{flex:0 0 auto;display:inline-flex;align-items:center;align-self:flex-start;' +
'height:auto;min-height:3.4mm;padding:.5mm 1.6mm;margin:1.4mm 0 .8mm;border-radius:.7mm;' +
'background:#F6F1E2;border:.25mm solid #E4D6AE;font-family:Consolas,monospace;' +
'font-size:6.4pt;line-height:1.25;font-weight:700;color:#8A6A16;letter-spacing:.04em;' +
'white-space:nowrap}' +
'#paper .nm{flex:0 0 auto;min-height:6.6mm;max-height:9.9mm;font-size:7pt;font-weight:700;' +
'line-height:1.2;overflow:hidden;margin-bottom:.8mm;color:#1B2A41;' +
'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}' +
/* 🔴 specwrap 高度：实测最坏情况 = 户外册 9 行规格（KL-OD-DA-001…，DA 段）
   + 2 个值各折 1 行 → 需要 111px(29.4mm)。原 20.4mm(77px) 只能装 7 个单行
   → 全册 80 处规格被裁。现给 30.6mm（124px），并配合 specClip() 长值取摘要。 */
'#paper .specwrap{flex:0 0 auto;height:30.6mm;margin-top:.6mm;overflow:hidden}' +
'#paper table.spec{width:100%;border-collapse:collapse;font-size:5.5pt;line-height:1.45}' +
'#paper table.spec td{padding:0;vertical-align:top}' +
'#paper table.spec td.k{color:#5C6B7A;white-space:nowrap;padding-right:1.2mm;width:16mm}' +
'#paper table.spec td.v{color:#1B2A41}' +
/* 报价块：改成「数量段 → 价格」两列表，欧美买家习惯这样读阶梯价 */
'#paper .pricebox{flex:0 0 auto;margin-top:.9mm;padding-top:.8mm;' +
'border-top:.3mm solid #C8A24B;overflow:hidden}' +
'#paper table.ptab{width:100%;border-collapse:collapse;font-size:5.6pt;line-height:1.42}' +
'#paper table.ptab td{padding:.28mm 0;vertical-align:top}' +
'#paper table.ptab td.pl{color:#5C6B7A;white-space:nowrap;padding-right:1.4mm}' +
'#paper table.ptab td.pv{text-align:right;font-family:Consolas,monospace;color:#1B2A41;font-weight:600}' +
'#paper table.ptab td.pv b{color:#8A6A16;font-weight:700}' +
'#paper .pricebox .pmeta{font-size:5.2pt;color:#8B98A5;margin-top:.5mm;' +
'border-top:.2mm dashed #DDE3E9;padding-top:.5mm}' +
'#paper .pricebox .pmeta .est{color:#B26A00;font-weight:700;letter-spacing:.02em}' +
/* 🔴 页脚必须永远贴在页面最底部。
   原来只有 `flex:0 0 auto`，前面内容不满 297mm 时页脚就浮在页面中间
   （About / How to Order / Contents 三页都这样，实测截图确认）。
   正解：加 `margin-top:auto` —— 在 flex 列容器里把余量全推到页脚之前。 */
'#paper .foot{flex:0 0 auto;margin-top:auto;display:flex;justify-content:space-between;' +
'align-items:center;padding-top:1.2mm;font-size:6pt;color:#5C6B7A}' +
/* 🔴 有 .fill 的页面，页脚**必须**关掉 margin-top:auto。
   两者都在抢剩余空间：.fill{flex:1} 要撑开、.foot 的 auto margin 也要吃掉余量，
   结果 .fill 被压到溢出 —— 实测 About 页底部「品类速览四格」被页脚压住、文字重叠。
   正解：.fill 自己撑开，页脚紧跟其后（padding-top 提供间距）。
   兄弟选择器正好命中：DOM 里 .fill 紧邻 .foot 之前。 */
'#paper .fill + .foot{margin-top:0}' +
'#paper .cover{background:#0B1321;color:#fff;padding:0;display:block;position:relative;overflow:hidden}' +
/* v4 手册封面版式：左侧深色文字栏（占 57%）+ 右侧满幅实拍（43%）
   ⚠️ 不用整页蒙版 —— 整页蒙版会把实拍压成灰底，浪费掉高分辨率场景照 */
'#paper .cover .coverbg{position:absolute;top:0;right:0;width:43%;height:100%;object-fit:cover}' +
'#paper .cover .bgfade{position:absolute;top:0;right:0;width:52%;height:100%;' +
'background:linear-gradient(90deg,#0B1321 0%,rgba(11,19,33,.55) 26%,rgba(11,19,33,0) 60%)}' +
'#paper .cover .cbar{position:absolute;top:0;left:0;width:57%;height:100%;' +
'background:linear-gradient(160deg,#0B1321 0%,#111E33 58%,#16243A 100%)}' +
'#paper .cover .cbar .dec{position:absolute;inset:0;opacity:.5;' +
'background:repeating-linear-gradient(58deg,rgba(200,162,75,.16) 0 .3mm,transparent .3mm 3.4mm)}' +
'#paper .cover .inner{position:absolute;inset:0;padding:15mm 15mm 11mm 17mm;' +
'display:flex;flex-direction:column;width:57%}' +
/* logo.png 是「图形+中英文名」整幅图，但四周留白多 →
   按 height 限高会把字压得看不见。这里放宽 + 提高高度。 */
'#paper .cover .logo{height:13mm;width:auto;max-width:64mm;object-fit:contain;' +
'object-position:left center;margin-bottom:5mm}' +
'#paper .cover .kicker{font-size:7.2pt;letter-spacing:.4em;color:#E3C87F;text-transform:uppercase}' +
'#paper .cover h1{font-size:26pt;line-height:1.1;margin:4mm 0 0;font-weight:800;letter-spacing:-.01em}' +
'#paper .cover h1 .g{color:#C8A24B}' +
'#paper .cover h1 .cn{display:block;font-size:12pt;font-weight:400;color:#9FB2C6;letter-spacing:.16em;' +
'margin-top:2.6mm}' +
'#paper .cover .rule{width:20mm;height:1mm;background:#C8A24B;margin:5mm 0 4mm}' +
'#paper .cover .sm{font-size:8.4pt;color:#C6D2DF;line-height:1.62;max-width:118mm}' +
/* 本册亮点：欧美目录封面下半常放 3 个卖点，把左栏空白填满 */
'#paper .cover .pts{margin-top:7mm;display:flex;flex-direction:column;gap:3.4mm;max-width:120mm}' +
'#paper .cover .pts .pt{display:flex;gap:3mm;align-items:flex-start;border-left:.9mm solid #C8A24B;' +
'padding-left:2.6mm}' +
'#paper .cover .pts .pt .pk{font-size:6.2pt;letter-spacing:.14em;color:#C8A24B;text-transform:uppercase;' +
'flex:0 0 20mm;padding-top:.4mm}' +
'#paper .cover .pts .pt .pv{font-size:7.4pt;line-height:1.5;color:#C6D2DF}' +
'#paper .cover .pts .pt .pv b{color:#fff}' +
'#paper .cover .cat{margin-top:auto}' +
'#paper .cover .cat .row{display:flex;align-items:baseline;gap:2.4mm;font-size:8.4pt;color:#DCE6F0;' +
'padding:1.9mm 0;border-top:.25mm solid rgba(200,162,75,.34)}' +
'#paper .cover .cat .row b{color:#E3C87F;font-family:Consolas,monospace;font-size:7.4pt;width:8mm;' +
'letter-spacing:.06em}' +
'#paper .cover .cat .row .n{margin-left:auto;color:#8FA2B6;font-size:7.2pt;' +
'font-family:Consolas,monospace}' +
/* 全品类索引条：5 个卡片在 57% 栏里横排必然溢出（min-width:auto 撑破容器，
   "ACCESSORIES" 这种长词会跑到右边的场景图上 —— 实测踩过）。
   正解：改 3 列 grid + min-width:0 + overflow:hidden，2 行放完，最后一格补"全册说明"。 */
'#paper .cover .secs{display:grid;grid-template-columns:repeat(3,1fr);gap:2.2mm;margin-top:4mm}' +
'#paper .cover .secs>div{min-width:0;border:.3mm solid rgba(200,162,75,.42);border-radius:.8mm;' +
'padding:1.9mm 2.2mm;overflow:hidden}' +
'#paper .cover .secs .sn{font-size:5.6pt;letter-spacing:.1em;color:#C8A24B;text-transform:uppercase;' +
'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
'#paper .cover .secs .st{font-size:6.8pt;color:#EAF0F6;margin-top:.7mm;line-height:1.3;' +
'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
/* 本册高亮卡：金色描边 + 微透底 */
'#paper .cover .secs>div.on{border-color:#C8A24B;background:rgba(200,162,75,.16)}' +
'#paper .cover .secs>div.on .sn{color:#F0D89B}' +
/* 第 6 格：虚线"索取全目录"入口，跟实线品类卡区分开 */
'#paper .cover .secs>div.more{border-style:dashed;border-color:rgba(200,162,75,.3);background:transparent}' +
'#paper .cover .secs>div.more .sn{color:#8FA2B6}' +
'#paper .cover .secs>div.more .st{color:#A9BBCD}' +
/* 底栏：改成**纵向三行**，不用 space-between 左右对撞。
   原来左右分栏时 57% 宽度根本放不下两列长文本 → 两边各自换行、参差不齐。 */
'#paper .cover .brandbar{margin-top:4.4mm;padding-top:3.2mm;border-top:.35mm solid #C8A24B;' +
'display:flex;flex-direction:column;gap:1.5mm}' +
/*🔴 brandbar 三行不能用 flex 排（2026-10-05 截图实测踩过）。
   根因：`.l` / `.c` 里的长文本（法定主体全称 "Yangjiang Kaili International
   Trading Co., Ltd."、中文全称）是**裸文本节点**，不是元素 ——
   flex 布局里裸文本**无法收缩**（min-content 不可压缩），于是压力全部转嫁到
   同行的 `<b>` 和 `.sep` 上：品牌名和中文名被压成竖条单字，
   分隔符 `|` 被压到 1.2px 再叠 overflow:hidden 直接裁没（实测 cw=1/sw=9）。
   ✅ 正解：三行都回到**普通文本流**（display:block + line-height），
   文字按容器宽度自然换行；分隔符只是普通字符，不需要任何 flex 保护。
   需要视觉分组的地方用 `<b>`（品牌名）/颜色深浅区分即可。 */
'#paper .cover .brandbar .l{display:block;font-size:7pt;line-height:1.42;color:#C6D2DF}' +
    '#paper .cover .brandbar .l b{color:#fff;font-size:8.2pt}' +
    '#paper .cover .brandbar .l .sep{color:#3E4E63;padding:0 1.4mm}' +
'#paper .cover .brandbar .c{display:block;font-size:6.4pt;line-height:1.75;color:#8FA2B6;' +
    'overflow-wrap:anywhere}' +
    '#paper .cover .brandbar .c b{color:#C8A24B;font-weight:400}' +
    /* 联系方式整体不可断：域名、电话、WhatsApp 号码被折断会很难看，
       宁可让它整体挪到下一行。 */
    '#paper .cover .brandbar .u{white-space:nowrap}' +
'#paper .about{padding:12mm 13mm 10mm}' +
'#paper .h2{font-size:19pt;font-weight:800;margin:0 0 1.5mm}' +
'#paper .h2 .cn{font-size:11pt;font-weight:400;color:#5C6B7A;margin-left:3mm}' +
'#paper .lead{font-size:8.6pt;color:#5C6B7A;line-height:1.62;margin:0 0 7mm;max-width:165mm}' +
'#paper .block{margin-bottom:6mm}' +
'#paper .block h3{font-size:9.6pt;margin:0 0 2.2mm;color:#8A6A16;letter-spacing:.05em;' +
'text-transform:uppercase}' +
'#paper .block p,#paper ul.tick li{font-size:8.3pt;line-height:1.66;margin:0 0 2mm;color:#2E3D4E}' +
'#paper ul.tick{margin:0;padding-left:4.4mm}' +
'#paper ul.tick li{margin-bottom:1.6mm}' +
'#paper ul.tick li b{color:#1B2A41}' +
'#paper .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin:2mm 0 7mm}' +
'#paper .kpi .b{border:.25mm solid #DDE3E9;border-radius:1mm;padding:3mm 2mm;text-align:center;background:#F6F8FA}' +
'#paper .kpi .b .n{font-size:14pt;font-weight:800;color:#1B2A41}' +
'#paper .kpi .b .l{font-size:6.4pt;color:#5C6B7A;margin-top:.8mm}' +
/* 质保条：欧美买家在下单前必看的一条硬信息 */
'#paper .wty{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin:0 0 6mm}' +
'#paper .wty .wb{border:.25mm solid #DDE3E9;border-left:.9mm solid #C8A24B;border-radius:1mm;' +
'padding:2.4mm 2.6mm;background:#F6F8FA}' +
'#paper .wty .wn{font-size:9.4pt;font-weight:800;color:#1B2A41;line-height:1.1}' +
'#paper .wty .wl{font-size:6.4pt;color:#5C6B7A;margin-top:.8mm;line-height:1.35}' +
'#paper .eng{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin-bottom:5mm}' +
'#paper .eng .e2{border:.25mm solid #DDE3E9;border-radius:1mm;padding:3mm 3.4mm;background:#FBFCFD}' +
'#paper .eng .e2 .e2t{font-size:9pt;font-weight:800;color:#1B2A41;letter-spacing:.02em}' +
'#paper .eng .e2 .e2s{font-size:6.4pt;color:#8A6A16;letter-spacing:.08em;margin:.8mm 0 1.6mm}' +
'#paper .eng .e2 p{font-size:7.1pt;line-height:1.58;color:#5C6B7A;margin:0}' +
/* 品类速览四格：填 About 页下半，同时回答「这家做不做我要的东西」 */
'#paper .rng{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;margin-top:6mm}' +
'#paper .rng .rg{border-top:.3mm solid #C8A24B;padding-top:2mm}' +
'#paper .rng .rn{font-family:Consolas,monospace;font-size:6.4pt;color:#C8A24B;letter-spacing:.1em}' +
'#paper .rng .rl{font-size:8pt;font-weight:700;color:#1B2A41;margin:1mm 0 1.2mm;line-height:1.25}' +
'#paper .rng .rd{font-size:6.5pt;line-height:1.5;color:#5C6B7A}' +
'#paper table.toc{width:100%;border-collapse:collapse;font-size:8.6pt}' +
'#paper table.toc th{text-align:left;font-size:7pt;letter-spacing:.1em;text-transform:uppercase;' +
'color:#5C6B7A;border-bottom:.3mm solid #C8A24B;padding:0 0 2mm;font-weight:600}' +
'#paper table.toc td{padding:2.7mm 0;border-bottom:.2mm solid #DDE3E9}' +
'#paper table.toc td.n{font-family:Consolas,monospace;color:#8A6A16;width:12mm;font-weight:700}' +
'#paper table.toc td.pg{text-align:right;color:#5C6B7A;font-family:Consolas,monospace}' +
/* ---- How to Order 页 ---- */
'#paper .terms2{display:grid;grid-template-columns:1fr 1fr;gap:2.6mm 7mm}' +
'#paper .terms2 .t2{font-size:7.4pt;line-height:1.52;color:#2E3D4E;border-left:.8mm solid #D8C48A;' +
'padding-left:2.4mm}' +
'#paper .terms2 .t2 b{display:block;color:#1B2A41;font-size:8.2pt;letter-spacing:.04em;' +
'text-transform:uppercase;margin-bottom:.6mm}' +
/* 流程卡序号 —— 原来 position:absolute + top:-2.2mm 挂在**边框外侧**，
   视觉上像贴边的小圆点（实测：顶到卡片上沿、偏左、不明显）。
   正解：改成卡内左侧的**垂直居中大圆徽章** —— 用 grid 把序号和文字并排，
   序号在卡内居中、字号放大到 9pt，整体协调且一眼能扫到顺序。 */
'#paper .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:3.4mm 5mm}' +
'#paper .steps .s{border:.25mm solid #DDE3E9;border-radius:1.2mm;padding:2.8mm 3mm;' +
'display:grid;grid-template-columns:6.2mm 1fr;column-gap:2.6mm;align-items:start}' +
'#paper .steps .s b{grid-row:1 / span 2;width:6.2mm;height:6.2mm;border-radius:50%;' +
'background:#C8A24B;color:#fff;font-size:9pt;font-weight:700;line-height:6.2mm;' +
'text-align:center;align-self:start;margin-top:.2mm;box-shadow:0 .3mm 1mm rgba(200,162,75,.45)}' +
'#paper .steps .s i{display:block;font-style:normal;font-size:8.4pt;font-weight:700;' +
'color:#1B2A41;line-height:1.25;align-self:center}' +
'#paper .steps .s span{display:block;font-size:6.9pt;line-height:1.5;color:#5C6B7A;' +
'margin-top:.8mm}' +
/* ---- SKU 索引 ---- */
'#paper .idxhead{font-size:7.2pt;color:#5C6B7A;margin:0 0 2.6mm;padding-bottom:1.6mm;' +
'border-bottom:.25mm solid #DDE3E9}' +
'#paper .idx{overflow:hidden}' +
/* 🔴 索引列数按 SKU 数自适应：户外册 130 个 SKU 用 6 列要排 22 行（≈77mm），
   把 Contents 页下半的「本册品类型目」整个挤出页底 196px（审计实测）。
   加列换行数：>60 用 7 列，>100 用 8 列（行数少 → 页脚上方不被吃满）。 */
'#paper .idxgrid{column-count:6;column-gap:4mm;font-family:Consolas,monospace;font-size:6.2pt;' +
'line-height:1.62;color:#2E3D4E}' +
'#paper .idxgrid.c7{column-count:7;column-gap:3.4mm;font-size:5.9pt}' +
'#paper .idxgrid.c8{column-count:8;column-gap:2.8mm;font-size:5.6pt}' +
'#paper .idxgrid span{display:flex;justify-content:space-between;gap:1mm;' +
'break-inside:avoid;padding:.3mm 0}' +
'#paper .idxgrid i{font-style:normal;color:#A0AEBB;min-width:4.6mm;text-align:right;' +
'flex:0 0 auto;font-variant-numeric:tabular-nums}' +
'#paper .insp{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm}' +
'#paper .insp .ib{font-size:6.9pt;line-height:1.55;color:#5C6B7A;border-top:.3mm solid #C8A24B;' +
'padding-top:1.8mm}' +
'#paper .insp .ib .lb{font-size:7.4pt;font-weight:700;color:#1B2A41;letter-spacing:.04em;' +
'text-transform:uppercase;margin-bottom:.9mm}' +
/* ---- 余量填充容器（About / How to Order / Contents 三页）----
   这三页内容高度固定（文案是写死的），不满 297mm 时底部空 135~279px
   （截图实测：内容全顶在上面，下半页一条白）。
   🔴 两次踩坑才定出正解：
     1) `justify-content:space-between` → 余量**均摊到每处缝隙**，
        标题被拉开 20mm 远离正文，区块内部行距变形（截图复核：更难看）。
     2) 单一 `.sp{margin-top:auto}` → auto 是**独吞**全部余量，
        45mm 的空档全灌进一个缝隙，中间成一片空白（截图复核：也不行）。
   ✅ 正解：**多个 `.sp` 用 flex-grow 权重瓜分余量**。
      flex 项设 `flex:1 0 0` 且容器有剩余空间时，浏览器按 grow 系数分配比例 ——
      于是余量变成"几个可控的大缝隙"，既填满页高，区块内部又紧凑不变形。 */
/* ⚠️ 底部必须留呼吸：`.fill` 撑满整页高度后，末块（如 About 页的品类速览四格）
   底边会正好贴上页脚顶边，视觉上像两层内容粘在一起（截图实测）。
   padding-bottom 4mm 让末块与页脚脱开。 */
'#paper .fill{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;' +
'padding-bottom:4mm;box-sizing:border-box}' +
'#paper .fill > *{flex-shrink:0;margin-top:0;margin-bottom:0}' +
'#paper .fill > .h2{margin-bottom:2.6mm}' +
'#paper .fill > .lead{margin-bottom:5mm}' +
'#paper .fill > .idxhead{margin-bottom:2.4mm}' +
'#paper .fill > .faq{margin-top:2mm}' +
/* 非 .sp 的相邻块之间给固定基础间距（4.5mm）—— 不能让所有块都贴在一起 */
'#paper .fill > * + *{margin-top:4.5mm}' +
'#paper .fill > .idx{margin-bottom:0}' +
/* ---- 读图解（Contents 页）----
   ⚠️ 大册子（套刀 64 / 户外 130 SKU）索引区行数多，Contents 页余量很紧，
   这块 23mm 的解说要让位。解法：容器高度自适应 + 内容超了就压缩内边距，
   最次情况隐藏中文副标题那行（英文主句保留，信息不丢）。 */
'#paper .howto{margin-top:4.4mm;border:.25mm solid #E3E8ED;border-left:1.2mm solid #C8A24B;' +
'border-radius:1mm;padding:2.6mm 3.2mm;background:#FCFDFE;flex:0 1 auto;min-height:0;' +
'overflow:hidden}' +
'#paper .howto .hl{font-size:7.9pt;font-weight:700;color:#1B2A41;margin-bottom:2mm}' +
'#paper .howto .hl .cn{font-weight:400;font-size:7.1pt;color:#5C6B7A;margin-left:2mm}' +
'#paper .howto .hs{display:grid;grid-template-columns:repeat(4,1fr);gap:0 3.6mm;list-style:none;' +
'margin:0;padding:0}' +
'#paper .howto .hs li{display:grid;grid-template-columns:4.2mm 1fr;column-gap:1.6mm;' +
'align-items:start;font-size:6.5pt;line-height:1.45;color:#5C6B7A;min-width:0}' +
'#paper .howto .hs li b{width:4.2mm;height:4.2mm;border-radius:50%;background:#1B2A41;color:#fff;' +
'font-size:6pt;font-weight:700;line-height:4.2mm;text-align:center} ' +
/* ⚠️ .sp 必须**最后**声明（同特异性下后写的赢）。
      权重：sp = 1 份，sp2 = 2 份（一页里余量多的地方给更多权重）。 */
'#paper .fill > .sp{flex:1 1 0;min-height:0;margin-top:0}' +
'#paper .fill > .sp2{flex:2 1 0;min-height:0;margin-top:0}' +
/* ---- 本册品类型目（Contents 页下半）----
   把「这本册子里到底有哪几类东西」摊开：段码 + 数量 + 细分线名 + 页码。
   段码是内部编号，但对买手有用 —— 报单时按段码整段询价效率最高。 */
/* 🔴 列数按段数自适应：4 段 → 4 列一行；6 段（户外）/ 10 段（厨房配件）→ 3 列。
   固定 4 列时户外册 6 段排 2 行、配件册 10 段排 3 行，
   在 Contents 页有限余量里直接把 .fill 撑爆（审计实测 db=194px 溢出）。
   ⚠️ 用 class 不用 CSS 自定义属性 —— `repeat(var(--rtcol,n),1fr)` 在
   未注册 @property 的情况下整条声明失效，grid 回退到 auto 列，
   实测卡片被压到 26px 宽、文字全裁（审计 cw=26 sw=82）。
   ⚠️ 必须 `align-items:start` + `flex:0 0 auto`：
   .rtable 是 .fill（flex 列）的子项，默认 align-items:stretch 会把它
   拉到填满剩余高度，内部 grid 行随之被拉高 —— 实测单卡高飙到 732px
   （应为 60px），整块直接溢出页底 511px。 */
/* 🔴 大册子（户外 130 SKU / 套刀 64 SKU）的 Contents 页余量很紧：
   索引区行数多 → 「本册品类型目」这块会被挤到页底外（审计实测溢出 24~97px）。
   ⚠️ 不要用 max-height 裁 —— 那会把第二行卡片的段码/数量也裁掉，是硬信息。
   正解：段数多时**每张卡压成两行**（段码+数量 一行 · 英文细分线 一行），
   6 段 / 10 段都用 5 列一行排完，纵向只占一行高度。 */
'#paper .rtable{flex:0 0 auto;display:grid;grid-template-columns:repeat(4,1fr);' +
/* 🔴 align-items:start → 每格按自身内容收缩 ⇒ 同一行出现「一个高一个矮」，
     视觉上很不统一（利2026-10-05 指出第 5 格字符多就更高）。
     正解：**stretch**（grid 默认）让同一行所有卡拉到最高那格的高度，
     内容不变、只统一上下边界。所有列数变体都要跟着 stretch。 */
'gap:2.6mm 3mm;align-items:stretch}' +
'#paper .rtable.c5{grid-template-columns:repeat(5,1fr);gap:2.4mm 2.6mm}' +
'#paper .rtable.c5 .rn{font-size:6.2pt;margin:1mm 0 .3mm;line-height:1.28}' +
'#paper .rtable.c5 .rcn{display:none}' +
'#paper .rtable.c5 .rq{font-size:9.4pt}' +
'#paper .rtable.c5 .rp{font-size:5.3pt;padding-top:.8mm}' +
'#paper .rtable.c3{grid-template-columns:repeat(3,1fr)}' +
'#paper .rtable.c5{grid-template-columns:repeat(5,1fr);gap:2.6mm 2.6mm}' +
/* 5 列时卡片更窄 → 字号跟着收，避免文字撑破卡片 */
'#paper .rtable.c5 .rn{font-size:6.3pt;margin:1.1mm 0 .4mm}' +
'#paper .rtable.c5 .rcn{font-size:5.8pt;margin-bottom:.9mm}' +
'#paper .rtable.c5 .rq{font-size:9.6pt}' +
'#paper .rtable.c5 .rp{font-size:5.4pt}' +
'#paper .rtable .rr{border:.25mm solid #E3E8ED;border-left:1.1mm solid #C8A24B;' +
'border-radius:.9mm;padding:1.9mm 2.3mm;min-width:0;overflow:hidden;background:#FCFDFE}' +
'#paper .rtable .rh{display:flex;align-items:baseline;gap:1.6mm;min-width:0}' +
'#paper .rtable .rc{font-family:Consolas,monospace;font-size:6.2pt;font-weight:700;color:#8A6A16;' +
'background:#F6F1E2;border:.25mm solid #E4D6AE;border-radius:.5mm;padding:.2mm 1.1mm;' +
'line-height:1.3;white-space:nowrap}' +
'#paper .rtable .rq{font-size:11pt;font-weight:800;color:#1B2A41;line-height:1}' +
'#paper .rtable .ru{font-size:5.8pt;color:#8A97A4;letter-spacing:.06em;text-transform:uppercase}' +
'#paper .rtable .rn{font-size:6.9pt;font-weight:700;color:#1B2A41;line-height:1.32;margin:1.3mm 0 .5mm;' +
'overflow-wrap:anywhere;min-width:0}' +
'#paper .rtable .rcn{font-size:6.2pt;color:#5C6B7A;line-height:1.32;margin-bottom:1.1mm;' +
'overflow-wrap:anywhere;min-width:0}' +
'#paper .rtable .rp{font-size:5.9pt;color:#A0AEBB;font-family:Consolas,monospace;' +
'border-top:.25mm solid #EDF1F4;padding-top:1.1mm;letter-spacing:.01em;line-height:1.4;' +
'word-break:break-all;min-width:0}' +
/* ---- FAQ（How to Order 页下半） ---- */
'#paper .faq{display:grid;grid-template-columns:1fr 1fr;gap:2.4mm 7mm;margin-top:2mm}' +
'#paper .faq .q{font-size:7.2pt;line-height:1.55;color:#2E3D4E;border-left:.8mm solid #D8C48A;' +
'padding-left:2.4mm}' +
'#paper .faq .q b{display:block;color:#1B2A41;margin-bottom:.4mm}' +
/* 流程收尾条：把 FAQ 之后的空档变成行动召唤 */
'#paper .cnote{margin-top:5mm;border-left:1.4mm solid #C8A24B;background:#F6F8FA;border-radius:1mm;' +
'padding:3.2mm 4.2mm;font-size:7.6pt;line-height:1.6;color:#2E3D4E}' +
'#paper .cnote b{color:#1B2A41;font-size:8.4pt;margin-right:1.6mm}' +
'#paper .cnote a{color:#8A6A16;font-weight:700;text-decoration:none;' +
'border-bottom:.3mm solid #C8A24B}' +
'#paper .divider{padding:0;display:block;background:#1B2A41;color:#fff}' +
'#paper .divider .divbg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
'#paper .divider .divveil{position:absolute;inset:0;background:linear-gradient(102deg,#1B2A41 0%,' +
'rgba(27,42,65,.97) 32%,rgba(27,42,65,.80) 56%,rgba(27,42,65,.46) 100%)}' +
'#paper .divider .dwrap{position:absolute;inset:0;padding:12mm 13mm 10mm;display:flex;flex-direction:column}' +
'#paper .divider .no{font-family:Consolas,monospace;font-size:15pt;color:#C8A24B;letter-spacing:.2em}' +
'#paper .divider h2{font-size:28pt;font-weight:800;margin:4mm 0 3mm}' +
'#paper .divider .cn{font-size:14pt;color:#A9BBCD;margin-bottom:7mm}' +
'#paper .divider .bar{width:24mm;height:1mm;background:#C8A24B;margin-bottom:7mm}' +
'#paper .divider p{font-size:9pt;color:#D2DCE6;line-height:1.7;max-width:132mm;margin:0}' +
'#paper .divider .stat{margin-top:10mm;display:flex;gap:12mm}' +
'#paper .divider .stat div{font-size:8pt;color:#A9BBCD}' +
'#paper .divider .stat b{display:block;font-size:16pt;color:#fff;font-weight:800}' +
'#paper .divider .dfoot{flex:0 0 auto;display:flex;justify-content:flex-end;margin-top:4mm;' +
'padding-top:1.2mm;border-top:.25mm solid rgba(200,162,75,.35);font-size:6pt;color:#B9C7D6}' +
'#paper .terms{font-size:7.8pt;line-height:1.72;color:#2E3D4E}' +
'#paper .terms h3{font-size:9pt;color:#8A6A16;margin:0 0 2mm;text-transform:uppercase;' +
'letter-spacing:.05em}' +
/* CTA 改成「双引擎供应」的收尾条：不再是 margin-top:auto 的贴底大块，
   缩成一条紧凑横幅紧跟在 eng 区块下方，视觉上有从能力→行动的连贯感。 */
'#paper .cta{margin-top:3.4mm;border-left:1.4mm solid #C8A24B;background:#F6F8FA;' +
'border-radius:1mm;padding:3.2mm 4.2mm 3.4mm;display:flex;align-items:center;gap:5mm}' +
'#paper .cta .t{font-size:10pt;font-weight:800;color:#1B2A41;white-space:nowrap;line-height:1.2}' +
'#paper .cta .b{font-size:7.8pt;line-height:1.6;color:#2E3D4E}' +
'#paper .cta .b b{color:#8A6A16}' +
'#paper .contact{display:flex;gap:6mm;margin-top:5mm;align-items:flex-start}' +
'#paper .contact .qrwrap{text-align:center;flex:0 0 34mm}' +
'#paper .contact .qr{width:34mm;border:.3mm solid #DDE3E9;border-radius:1mm}' +
'#paper .contact .cap{font-size:5.8pt;color:#5C6B7A;letter-spacing:.1em;margin-top:1mm}' +
'#paper .contact .c{flex:1;font-size:8.6pt;line-height:1.8;color:#2E3D4E}' +
'#paper .contact .c .nm{font-size:11pt;font-weight:800;color:#1B2A41;display:block}' +
'#paper .contact .legal{font-size:8pt;line-height:1.7}' +
/* ---- 封底（版式对齐 v4 手册尾页 p152） ---- */
/* 封底：flex 列布局，bkcards 用 margin-top:auto 顶到页面底部，
   否则底部留一大片空白（页面是固定 297mm，内容不满就露白）。 */
'#paper .backcover{background:#0B1321;color:#fff;padding:11mm 13mm 8mm;display:flex;' +
'flex-direction:column;height:297mm}' +
'#paper .backcover .bklogo{display:flex;align-items:center;gap:4mm;margin-bottom:5mm}' +
'#paper .backcover .bklogo img{height:12mm;width:auto;max-width:58mm;object-fit:contain;' +
'object-position:left center}' +
'#paper .backcover .bktag{font-size:6.6pt;letter-spacing:.2em;color:#7E8FA3;text-transform:uppercase}' +
'#paper .backcover .bkcols{display:grid;grid-template-columns:1.05fr 1.25fr .62fr;gap:8mm}' +
'#paper .backcover h4{font-size:6.6pt;letter-spacing:.16em;color:#C8A24B;text-transform:uppercase;' +
'margin:0 0 2.4mm;font-weight:700}' +
'#paper .backcover .bkstrong{font-size:8pt;line-height:1.5;color:#fff;font-weight:700;margin-bottom:1.8mm}' +
'#paper .backcover .bkdim{font-size:7pt;line-height:1.68;color:#A9BBCD;margin-bottom:1.8mm}' +
'#paper .backcover .bkdim.bktiny{font-size:6.4pt;color:#7E8FA3;line-height:1.55}' +
'#paper .backcover .bklinks span{display:inline-block;width:15mm;color:#7E8FA3}' +
'#paper .backcover .bkqr{text-align:center}' +
'#paper .backcover .bkqr img{width:30mm;background:#fff;padding:1.4mm;border-radius:.8mm}' +
'#paper .backcover .bkqr .cap{font-size:6pt;letter-spacing:.14em;color:#C8A24B;margin:1.4mm 0 1mm}' +
/* bkcards 紧跟口号区；剩余空间由 bkfoot 的 margin-top:auto 吃掉 */
'#paper .backcover .bkcards{display:grid;grid-template-columns:.85fr 1.4fr;gap:8mm;margin-top:5mm}' +
/* 封底中间的品牌承诺区：放大口号 + 四格硬数据。
   原来只有一行小字口号，占不满页高 → 上下两段大空白（实测截图确认）。
   现在这块有实质内容，版面重心也更平衡。 */
/* 口号区 margin:auto（上下都 auto）→ 空白在它上下均分；
   bkcards 的 margin-top:auto 会把余量全吸走 → 口号区下方留空。
   改成：口号区 margin-top:auto（吸收三栏之后的余量），
   bkcards margin-top:固定间距（紧跟口号区），
   最后由 bkfoot 的 margin-top:auto 吸收剩余 → 余量落在页脚上方，视觉最稳。 */
'#paper .backcover .bkslogan{margin:auto 0 0;padding:6mm 0 5mm;' +
'border-top:.25mm solid rgba(200,162,75,.3);border-bottom:.25mm solid rgba(200,162,75,.3);' +
'text-align:center}' +
'#paper .backcover .bkslogan .s1{font-size:19pt;font-weight:800;color:#fff;letter-spacing:.005em;' +
'line-height:1.18}' +
'#paper .backcover .bkslogan .s2{font-size:8.4pt;color:#8FA2B6;margin-top:2.8mm;letter-spacing:.06em}' +
'#paper .backcover .sgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6mm;margin-top:6mm}' +
'#paper .backcover .sgrid .sg{border-left:.9mm solid #C8A24B;padding-left:2.6mm;text-align:left}' +
'#paper .backcover .sgrid .sg b{display:block;font-size:15pt;font-weight:800;color:#fff;' +
'line-height:1.05}' +
'#paper .backcover .sgrid .sg i{display:block;font-style:normal;font-size:6.6pt;color:#8FA2B6;' +
'line-height:1.42;margin-top:1.4mm}' +
'#paper .backcover .bkcard{border-left:1.2mm solid #C8A24B;background:#131F33;border-radius:.8mm;' +
'padding:3.4mm 4mm}' +
'#paper .backcover .bkcard .lb{font-size:6.2pt;letter-spacing:.16em;color:#C8A24B;text-transform:uppercase;' +
'margin-bottom:1.6mm}' +
'#paper .backcover .bkcard .nm{font-size:11pt;font-weight:800;color:#fff;margin-bottom:1.4mm}' +
'#paper .backcover .bklist{list-style:none;margin:0 0 2mm;padding:0;font-size:7pt;line-height:1.72;color:#A9BBCD}' +
'#paper .backcover .bklist b{color:#E3C87F}' +
'#paper .backcover .bkfoot{border-top:.25mm solid rgba(200,162,75,.3);color:#7E8FA3;' +
'margin-top:5mm;padding-top:1.8mm}';
    var st = document.createElement('style');
    st.id = 'paperCss';
    st.textContent = PAPER_CSS;
    document.head.appendChild(st);
    PAPER_CSS = true;
  }

  /* ===== 产品分页：均分（不用固定 9 张一刀切）=====
     46 SKU → 6 页 → [8,8,8,8,7,7]，而不是 5 页满9 + 末页只挂 1 张。
     页数不变（都是 ceil(N/9)），但每页都饱满、末页不空旷。 */
  /* ===== 产品分页 =====
     🔴 2026-10-05 改回「每页满 PER_PAGE 个」（PER_PAGE = 9，3×3）。
     之前被我改成"均分"（46 → [8,8,8,8,7,7]）是想解决"末页只挂1 张的空旷感"，
     但**副作用是整册有7~8 页都只放 8 个**（110 SKU → [9,9,9,9,9,9,8,8,8,8,8,8,8]），
     每一页右下角都空一格 ⇒ 页面看起来"不完整"、像漏印（利 2026-10-05 指出）。
     ⇒ **均分是错的**：欧美目录的做法是前面每页排满，只允许最后一页不满。
        110 → [9×12, 2]，末页只有 2 个是正常的（尾页）。 */
  function paginate(list) {
    var N = list.length;
    if (!N) return { nProd: 1, chunks: [[]] };
    var nProd = Math.ceil(N / PER_PAGE);
    var chunks = [];
    for (var i = 0; i < N; i += PER_PAGE) chunks.push(list.slice(i, i + PER_PAGE));
    return { nProd: nProd, chunks: chunks };
  }

  /* 第 idx 个 SKU（0 起）在第几页 —— 供 SKU 索引与段码表算页码。
     🔴 必须与 paginate() 的分页结果一致，否则目录页码会指错
     （分页算法改过两次：满页 → 均分 → 满页，这里必须跟着）。 */
  function pageOfIndex(chunks, idx) {
    for (var i = 0; i < chunks.length; i++) {
      if (idx < chunks[i].length) return i;
      idx -= chunks[i].length;
    }
    return chunks.length - 1;
  }

  /* 封面图文件名。默认 scene_<cat>.jpg（户外另有 scene_outdoor_cover.jpg）。
     🔴 剪刀是特例（利 2026-10-09）：封面右侧图框是 43%×100% = **0.304 的竖条**，
        而 scene_scissors.jpg 是 1980×1400 横版 → `object-fit:cover` 会在横版上
        再横切一刀、只留中间 21.5%，于是封面上只剩剪刀的枢轴连接处，看不出是剪刀。
        ⇒ 剪刀改用专门的 0.304 竖版图 scene_scissors_cover.jpg（`_scene_portrait.py`
          生成：镜像 + 右对齐重裁，让刀刃落在右侧未被深蓝渐变压暗的清晰区）。
        ⚠️ 不能直接覆盖 scene_scissors.jpg —— 主目录 PDF（_build_pdf_v22.py）
          把它当整页横版分隔页背景（.divbg，A4 297×210）用。 */
  var COVER_OVERRIDE = { scissors: 'scene_scissors_cover.jpg' };
  function coverFor(cat) {
    if (COVER_OVERRIDE[cat]) return COVER_OVERRIDE[cat];
    return 'scene_' + cat + (cat === 'outdoor' ? '_cover' : '') + '.jpg';
  }

  function buildPaper(bookId) {
    ensurePaperCss();
    var def = bookDef(bookId);
    var b = S.books[bookId];
    var list = b.cards;
    var meta = catMeta(def.cat);
    var wp = def.withPrice;
    var B = DATA.brand;

    var groups = [{ key: def.cat, meta: meta, list: list }];
    /* 产品分页 —— 均分而非「每页 9 张」（2026-10-05 改，见 paginate()）。
       原来固定 PER_PAGE=9 从头切到尾：46 SKU = 5 页满9 + 末页**只挂 1 张**，
       末页 2/3 空白像漏印。现在 46 → 6 页 [8,8,8,8,7,7]，页数不变但每页饱满。 */
    var PG_ = paginate(list), nProd = PG_.nProd, pageChunks = PG_.chunks;
    /* 前置页 = 封面 + About + Contents（SKU 索引）；末页 = 封底。
       How to Order 已移到产品页之后、封底之前（仍占 1 页，已计入下面的 +1）。
       分隔页（divider）已删除 —— 它与封面同图同标题同数字，纯重复；
       它的品类名／SKU 数／OEM／MOQ 信息已并进封面。2026-10-05 */
    var pageTotal = 3 + nProd + 1 + 1;

    var pg = 1, pages = [];

    /* 封面 —— 版式对齐 v4 合并手册：左深色文字栏 + 右满幅实拍 */
    if (b.flags.cover) {
      var cover = coverFor(def.cat);
      var COVER_COPY = coverCopy(def.cat);
      /* 索引条：3 列 grid → **4 个品类 + OEM/ODM + Full Range = 6 格**，
         整齐排成两行 3 列（2026-10-05 合并厨刀+套刀后由 5 品类改为 4）。
         高亮本册那一格（class=on），CSS 负责金色描边 + 微透底。 */
      var secs = COVER_COPY.secs.map(function (s, i) {
        return '<div' + (i === COVER_COPY.mine ? ' class="on"' : '') +
          '><div class="sn">' + esc(s[0]) + '</div><div class="st">' + s[1] + '</div></div>';
      }).join('') +
        /* 🔴 .secs 是 3 列 grid（repeat(3,1fr)）。4 品类 + 1 个 Full Range = 5 格
           → 排成 3+2，第二行只有 2 格、右边空一格，看着不齐。
           ⇒ 补第 6 格（OEM/ODM 能力），凑成整齐的 3+3。
           ⚠️ .st 副题实测可用宽仅 86px（cw=86）：
              'Single knives & knife sets'=101px ✗ · 'Private label & custom'=90px ✗
              ⇒ 一律用 ≤13 字符的短词。 */
        '<div class="more"><div class="sn">OEM / ODM</div>' +
        '<div class="st">Private label</div></div>' +
        '<div class="more"><div class="sn">Full Range</div>' +
        '<div class="st">Send us your list</div></div>';
      /* 公开版写「no prices shown」太消极（封面是最第一印象），
         改成中性的版本标识；「价格见报价版」放在 Terms/报价版里说。 */
      var validity = wp ? 'Quotation edition · prices FOB, valid 30 days from issue'
                        : 'Public edition · specification reference';
      pages.push('<div class="page cover">' +
        '<img class="coverbg" src="' + esc(cover) + '" alt="">' +
        '<div class="bgfade"></div><div class="cbar"><div class="dec"></div></div>' +
        '<div class="inner">' +
        '<img class="logo" src="logo.png" alt="">' +
        '<div class="kicker">Product Catalog ' + year() + ' · ' +
          (wp ? 'Quotation Edition' : 'Public Edition') + '</div>' +
        '<h1>' + COVER_COPY.title + '<span class="cn">' + esc(meta.cn) + '</span></h1>' +
        '<div class="rule"></div>' +
        '<div class="sm">' + esc(COVER_COPY.lead) + '</div>' +
        '<div class="pts">' + COVER_COPY.pts.map(function (p) {
          return '<div class="pt"><div class="pk">' + esc(p[0]) + '</div>' +
            '<div class="pv">' + p[1] + '</div></div>';
        }).join('') + '</div>' +
        /* 品类条：品类号 + 品类名 + SKU 数 + OEM/MOQ。
           原来 OEM/MOQ 只出现在分隔页上，而分隔页已删（与封面同图同标题同数字，纯重复），
           所以这三个口径上提到封面 —— 欧美买手在封面就能判断"能不能做我的单"。 */
        '<div class="cat"><div class="row"><b>' + esc(meta.no) + '</b><span>' +
          esc(meta.en) + '</span><span class="n">' + list.length + ' SKUs</span>' +
          '<span class="sep">·</span><span class="n">OEM / ODM: Yes</span>' +
          '<span class="sep">·</span><span class="n">MOQ from 50 pcs</span></div></div>' +
        '<div class="secs">' + secs + '</div>' +
        /* 底栏三行：① 品牌+法定主体 ② 联系方式一行 ③ 版本/有效期一行。
           原来左右分栏在 57% 宽度里两列长文本互相挤、换行参差（实测踩过）。
           🔴 邮箱/网址/电话用 <u> 包起来 —— CSS 里给 .u 加 white-space:nowrap，
           否则 overflow-wrap:anywhere 会把 WhatsApp 号码从中间折断
           （截图实测：「WhatsApp +86 134 2124/ 5300」断成两行，很难看）。 */
        '<div class="brandbar">' +
          '<div class="l"><b>' + esc(B.display) + '</b><span class="sep">|</span>' +
            esc(B.legal || '') + '<span class="sep">|</span>' + esc(B.cn || '') + '</div>' +
          '<div class="c"><b class="u">' + esc(B.site || '') + '</b>' +
            '<span class="sep">&nbsp;·&nbsp;</span><span class="u">' + esc(B.email || '') + '</span>' +
            '<span class="sep">&nbsp;·&nbsp;</span><span class="u">' + esc(B.phone || '') + '</span>' +
            (B.whatsapp ? '<span class="sep">&nbsp;·&nbsp;</span><span class="u">' +
              esc(B.whatsapp) + '</span>' : '') + '</div>' +
          '<div class="c">' + validity + '<span class="sep">&nbsp;·&nbsp;</span>' +
            'Issue ' + issue() + '</div>' +
        '</div></div></div>');
      pg++;
    }

    /* About —— 按欧美买手阅读习惯：先说"我们是谁/为什么可信"，再说"这本册子怎么用" */
    var allSku = skuTotalAll();
    pages.push('<div class="page about"><div class="ph"><div class="t">' +
      'About ' + esc(B.name) + '<span class="cn">公司简介</span></div><div class="r">' +
      esc(B.name) + ' · Product Catalog ' + year() + '</div></div>' +
      /* 🔴 fill 容器：余量自动均分到各区块之间。
         原来 About / How to Order / Contents 三页内容不满 297mm，
         底部空 135~279px（截图实测）—— 观感是「内容顶在上面，下面空一大块」。
         正解：`flex:1` + `space-between` → 空白摊成均匀呼吸感，不是全堆在底部。
         配合 `.fill>*{flex-shrink:0}` 保证内容本身不被压扁。 */
      '<div class="fill">' +
      '<div class="kpi">' +
      '<div class="b"><div class="n">' + allSku + '+</div><div class="l">Listed SKUs</div></div>' +
      '<div class="b"><div class="n">160+</div><div class="l">Export Destinations</div></div>' +
      '<div class="b"><div class="n">70%</div><div class="l">Yangjiang Cluster<br>Output Share</div></div>' +
      '<div class="b"><div class="n">85%</div><div class="l">National<br>Export Share</div></div></div>' +
      '<div class="lead"><b>' + esc(B.display) + '</b> is the export brand of ' +
      esc(B.legal || '') + ', based in Yangjiang, Guangdong — the Yangjiang cluster produces ' +
      'about <b>70% of China&rsquo;s knives and scissors</b> and accounts for roughly <b>85% of ' +
      'national knife exports</b>. We work through <b>deep strategic manufacturing ' +
      'partnerships</b> in the local cutlery cluster, giving factory-level pricing, full ' +
      'production visibility and one accountable contact from your drawing to your shelf.</div>' +
      '<div class="two" style="display:grid;grid-template-columns:1fr 1fr;gap:7mm">' +
      '<div class="block"><h3>What we supply</h3><ul class="tick">' +
      /* 🔴 2026-10-05 合并厨刀+套刀：这里原来写 5 条（Knife sets 独立一条），
         与封底的「4 core categories」自相矛盾 ⇒ 客户会问"到底是几个品类"。
         → 套刀并进厨刀那一条。 */
      '<li><b>Kitchen knives &amp; knife sets</b> — single chef, santoku, cleaver, nakiri, ' +
      'slicer, bread, paring, plus boxed sets, block sets and gift-box presentation.</li>' +
      '<li><b>Professional scissors</b> — kitchen shears, tailor, barber, garden, pruning.</li>' +
      '<li><b>Outdoor knives</b> — folding EDC, fixed blade, camping sets.</li>' +
      '<li><b>Kitchen accessories</b> — BBQ tools, cookware, cutting boards, peelers, holders.</li>' +
      '</ul></div>' +
      '<div class="block"><h3>Services for importers</h3><ul class="tick">' +
      '<li><b>OEM / ODM</b> — blade steel, handle material, blade finish, heat treatment.</li>' +
      '<li><b>Private label</b> — laser logo, printed colour box, carton artwork, barcode &amp; labels.</li>' +
      '<li><b>Quality control</b> — three-stage: incoming, in-process, pre-shipment AQL.</li>' +
      '<li><b>Logistics</b> — FOB / CIF / DDP; sea, air and express; US warehouse stock.</li>' +
      '</ul></div></div>' +
      /* .sp：余量全部落在这一个缝隙里 → 上半段（KPI + 简介 + 双栏）保持紧凑，
         保修条及以下自然下沉，页脚仍由 .foot 的 margin-top:auto 贴底。 */
      '<div class="sp"></div>' +
      '<div class="wty"><div class="wb"><div class="wn">Lifetime</div><div class="wl">Structural warranty</div></div>' +
        '<div class="wb"><div class="wn">10 years</div><div class="wl">Edge quality guarantee</div></div>' +
        '<div class="wb"><div class="wn">2 years</div><div class="wl">Assembly guarantee</div></div>' +
        '<div class="wb"><div class="wn">Zero defect</div><div class="wl">Release standard</div></div></div>' +
      /* 双引擎供应：欧美买家最关心「交期靠不靠谱」 */
      '<h3 class="h2" style="font-size:12pt">Two-Engine Supply<span class="cn">双引擎供应</span></h3>' +
      '<div class="eng"><div class="e2"><div class="e2t">US Warehouse Stock</div>' +
        '<div class="e2s">现货 · 1–3 天发货</div>' +
        '<p>In-stock knives, kitchen tools and outdoor equipment held in the United States — ' +
        'dispatched within 1–3 days after US dispatch. Light customisation in warehouse: ' +
        'laser logo, simple packaging, small sets. Ideal for Amazon / Shopify sellers and ' +
        'retailers needing fast replenishment.</p></div>' +
      '<div class="e2"><div class="e2t">Yangjiang Manufacturing</div>' +
        '<div class="e2s">深度定制 · OEM / ODM</div>' +
        '<p>Full OEM and ODM: blade profile, steel, tooling, structure and gift-set ' +
        'development through our cluster partners. Samples 10–15 days, bulk 30–45 days, ' +
        'sea or air freight 20–35 days door to door.</p></div></div>' +
      /* CTA 紧跟双引擎区块（原 margin-top:auto 会把它推到底部，脱离上下文显得孤立）。
         现在它是「双引擎供应」的自然收尾 —— 两条路走完，下一步就是发询盘。 */
      '<div class="sp"></div>' +
      '<div class="cta"><div class="t">Send us your<br>specification</div><div class="b">' +
      'Email your SKU list and quantities — FOB pricing within one working day.<br>' +
      '<b>' + esc(B.email || '') + '</b> &nbsp;·&nbsp; <b>' + esc(B.site || '') + '</b> · ' +
      esc(B.phone || '') + (B.whatsapp ? ' · ' + esc(B.whatsapp) : '') + '</div></div>' +
      /* 品类速览：把 About 页下半的空档填成有用信息（欧美买家常在这里确认
         「这家到底做不做我要的东西」），顺带给出四类的关键资质口径。 */
      '<div class="rng"><div class="rg"><div class="rn">01</div>' +
        '<div class="rl">Kitchen Knives</div>' +
        '<div class="rd">Damascus &amp; high-carbon stainless · single knives, boxed sets</div></div>' +
        '<div class="rg"><div class="rn">02</div>' +
        '<div class="rl">Professional Scissors</div>' +
        '<div class="rd">Kitchen, tailor, barber, garden, pruning · EN 13130 available</div></div>' +
        '<div class="rg"><div class="rn">03</div>' +
        '<div class="rl">Outdoor Knives</div>' +
        '<div class="rd">Folding EDC, fixed blade, camping sets · US warehouse stock</div></div>' +
        '<div class="rg"><div class="rn">04</div>' +
        '<div class="rl">Kitchen Accessories</div>' +
        '<div class="rd">BBQ tools, cookware, boards, peelers · SGS LFGB on request</div></div></div>' +
      '</div>' +
      '<div class="foot"><span>' + esc(meta.en) + '</span><span>' + esc(B.name) +
      ' · Product Catalog ' + year() + ' · ' + pg + ' / ' + pageTotal + '</span></div></div>');
    pg++;


    /* 目录（含 SKU 索引表 —— 买手最常用的是「照SKU 找页」，不是只看章节页码）
       🔴 prodStart 必须 +1：此刻 pg 还指向 Contents 自己（它是第 N 页），
       而产品页是 Contents 之后那一页 = pg+1。
       （2026-10-05 实测踩过：漏 +1 → 46 个 SKU 的目录页码全写 3、实际都在第 4 页，
        买手照页码翻会全部翻错。PDF 抽文本逐条比对才发现，页码连续性校验查不出这种错。） */
    var prodStart = pg + 1;
    pages.push('<div class="page about"><div class="ph"><div class="t">Contents<span class="cn">目录</span>' +
      '</div><div class="r">' +       esc(B.name) + ' · Product Catalog ' + year() + '</div></div>' +
      '<div class="fill">' +
      '<h2 class="h2">Contents<span class="cn">产品目录</span></h2>' +
      '<table class="toc"><thead><tr><th></th><th>Category</th><th>Edition</th><th>Items</th>' +
      '<th style="text-align:right">Page</th></tr></thead><tbody>' +
      '<tr><td class="n">' + esc(meta.no) + '</td><td><b>' + esc(meta.en) +
      '</b> <span style="color:#5C6B7A">' + esc(meta.cn) + '</span></td>' +
      '<td style="color:#5C6B7A">' + (wp ? 'Quotation' : 'Public') + '</td>' +
      '<td style="color:#5C6B7A">' + list.length + ' SKUs</td>' +
      '<td class="pg">' + prodStart + '–' + (prodStart + nProd - 1) + '</td></tr>' +
      '</tbody></table>' +
      /* 余量分配：Contents 页余量最大（实测 ~180px），
         第一处给 1 份（章节表→索引），第二处给 2 份（索引→本册内容）。 */
      '<div class="sp"></div>' +
      '<h2 class="h2">Item Index<span class="cn">SKU 索引</span></h2>' +
      '<div class="idxhead">Item No. (SKU) — pages are listed in catalog order. ' +
        'Prices are shown in the Quotation Edition only.</div>' +
      '<div class="idx">' + skuIndexHtml(list, prodStart, pageChunks) + '</div>' +
      /* 读图解：欧美目录的标准元素 —— 拿一个真实卡片做解剖，
         标清 item no. / 名称 / 规格表 / 报价块各在哪、怎么读。
         作用是让第一次翻这本册子的买家 5 秒知道"该去哪找我要的数"，
         同时把 Contents 页下半的空档填成有用信息。
         ⚠️ 大册子（SKU 多 → 索引区行数多）余量不够，这块会被压扁甚至裁字，
         所以只在 SKU ≤ 50 时显示（实测套刀 64 会被压扁裁字，户外 130 更要让位）。 */
      (list.length <= 50 ?
      '<div class="howto"><div class="ht">' +
      '<div class="hl">How to read an item page<span class="cn">怎么看产品页</span></div>' +
      '<ol class="hs">' +
        '<li><b>1</b><span>Product photo — actual production item, not a rendering.</span></li>' +
        '<li><b>2</b><span>Item No. — quote this exact reference in your inquiry and PI.</span></li>' +
        '<li><b>3</b><span>Name and specification table — steel, handle, size, weight, packing.</span></li>' +
        (wp ? '<li><b>4</b><span>Price block — FOB ' + PLACE + ', quantity breaks, HTS and lead time.</span></li>'
             : '<li><b>4</b><span>Quotation Edition of this catalog carries the matching price list.</span></li>') +
      '</ol></div></div>' : '') +
      /* 品类速览 + 阅读说明：欧美买家常在目录页就判断"这本册子有没有我要的品类" */
      '<div class="sp"></div>' +
      '<h2 class="h2">What&rsquo;s Inside<span class="cn">本册内容</span></h2>' +
      '<div class="lead" style="margin-bottom:4mm">' + esc(meta.desc) + '</div>' +
      '<div class="insp"><div class="ib"><div class="lb">Item No.</div>' +
        'Every product carries its own item number in the format KL-… Quote this exact ' +
        'reference in your inquiry, PI and carton marking.</div>' +
      '<div class="ib"><div class="lb">Specifications</div>' +
        'Steel, handle, dimensions and weight per item. Lengths are shown in inches ' +
        'with the metric equivalent in millimetres.</div>' +
      '<div class="ib"><div class="lb">' + (wp ? 'Prices' : 'Pricing') + '</div>' +
        (wp ? 'FOB ' + PLACE + ' in USD, shown by quantity break. HTS code for US customs ' +
              'and lead time are listed with each item.'
            : 'This Public Edition shows no prices. The matching Quotation Edition carries ' +
              'FOB pricing, HTS codes and lead times.') + '</div>' +
      '<div class="ib"><div class="lb">Ordering</div>' +
        'MOQ, payment terms, packing and certification details are on the How to Order page.</div></div>' +
      /* 本册品类细分：目录页就把「这本册子里有哪些品类」摊开，买手不用翻到后面才知道。
         也把 Contents 页下半的空档填成有用信息。 */
      '<h2 class="h2">Product Range in This Book<span class="cn">本册品类型目</span></h2>' +
      /* rangeTableHtml 自带 .rtable 容器（列数按段数自适应），这里不要再包一层 ——
         嵌套同名容器会让外层那个没有 grid 列定义，被拉伸到填满 .fill 高度。 */
      rangeTableHtml(def.cat, list, prodStart, pageChunks) +
      '</div>' +
      '<div class="foot"><span>' + esc(B.display) + ' · ' + esc(B.name) +
        ' · Product Catalog ' + year() + '</span><span>' + pg +
      ' / ' + pageTotal + '</span></div></div>');
    pg++;

    /* 分隔页已于 2026-10-05 删除。
       原因：与 P1 封面**同一张场景图、同一个品类标题、同一组数字（SKUs/OEM/MOQ）**，
       是纯重复页，白占 1 页。其信息已上提到封面 .cat 条。
       依据：Spyderco / Global / Kuhn Rikon / Zwilling 四份真实目录都没有"重复封面"的分隔页。
       如需恢复，见_editor_app.js.bak_before_hto。 */

    /* 产品网格页 —— 按 pageChunks 均分结果逐页渲染（不再固定 9 张一刀切） */
    for (var ci = 0; ci < pageChunks.length; ci++) {
      var chunk = pageChunks[ci];
      var left = B.display + '  ·  ' + meta.no + ' ' + meta.en;
      if (wp) left += '  ·  Prices FOB, valid 30 days from ' + issue();
      pages.push('<div class="page"><div class="ph"><div class="t">' + esc(meta.en) +
        '<span class="cn">' + esc(meta.cn) + '</span></div><div class="r">' +
        esc(B.name) + ' · Product Catalog ' + year() + '</div></div>' +
        /* 每行恒 3 张、卡片尺寸恒为九宫格一格（末页排不满也保持原大小） */
        '<div class="grid">' + pageCardsHtml(chunk, wp) + '</div>' +
        '<div class="foot"><span>' + esc(left) + '</span><span>' + pg +
        ' / ' + pageTotal + '</span></div></div>');
      pg++;
    }

/*@@HTO_MOVED@@*/
    /* How to Order —— 已移到产品页之后、封底之前。
       依据：2026-10-05 调研 Spyderco / Global / Kuhn Rikon / Zwilling 四份真实目录，
       没有一份把下单流程放进前 5 页；欧美买手是带着 SKU 任务翻目录的，
       所以「先见货、后看怎么下单」。条款摘要仍保留在封底 Terms at a Glance。 */
    pages.push('<div class="page about"><div class="ph"><div class="t">' +
      'How to Order<span class="cn">下单流程</span></div><div class="r">' +
      esc(B.name) + ' · Product Catalog ' + year() + '</div></div>' +
      '<div class="fill">' +
      '<h2 class="h2">Ordering Terms<span class="cn">贸易条款</span></h2>' +
      '<div class="terms2">' +
      '<div class="t2"><b>MOQ</b><span>50 pcs per model / colour for knives and scissors; ' +
        '100 pcs per model for knife sets and accessories.</span></div>' +
      '<div class="t2"><b>Payment</b><span>30% T/T deposit, balance against B/L copy. ' +
        'L/C at sight and 30% deposit + 70% against inspection report also accepted.</span></div>' +
      '<div class="t2"><b>Lead time</b><span>Stock items 7–15 days. Custom items 25–35 days ' +
        'after sample approval. Sample 10–15 days for custom development.</span></div>' +
      (wp ? '<div class="t2"><b>Quote validity</b><span>30 days from the date of issue. ' +
        'Prices are re-confirmed after expiry. All prices are FOB ' + esc(PLACE) + ', USD.</span></div>'
          : '<div class="t2"><b>Pricing</b><span>Prices are quoted on request — email your SKU ' +
            'list and quantities for an FOB quotation within one working day.</span></div>') +
      '<div class="t2"><b>Incoterms</b><span>FOB, CIF and DDP on request. Yangjiang / ' +
        'Shenzhen port. Sea 20–35 days door to door; air freight 5–8 days.</span></div>' +
      '<div class="t2"><b>Packing</b><span>Colour box or plain white box with your own artwork; ' +
        'export carton with pallets. Full carton data and loading quantity supplied on request.</span></div>' +
      '<div class="t2"><b>Quality claims</b><span>Pre-shipment inspection photos and video for every ' +
        'lot. Claims must be raised within 15 days of arrival, with photo evidence.</span></div>' +
      '<div class="t2"><b>Certification</b><span>SGS LFGB food contact, EN 13130 soluble heavy ' +
        'metals, US FDA lead migration and material certificates (EN 10204-3.1) available on request.</span></div>' +
      '</div>' +
      '<h2 class="h2">Order Process<span class="cn">流程</span></h2>' +
      '<div class="sp"></div>' +
      '<div class="steps"><div class="s"><b>1</b><i>Inquiry</i>' +
        '<span>Send SKU list, quantities, destination port and any artwork files.</span></div>' +
        '<div class="s"><b>2</b><i>Quotation</i>' +
        '<span>FOB price, carton data, loading quantity and lead time within one working day.</span></div>' +
        '<div class="s"><b>3</b><i>Sample</i>' +
        '<span>Stock samples 3–5 days; custom samples 10–15 days, DHL / FedEx at your cost.</span></div>' +
        '<div class="s"><b>4</b><i>PI &amp; deposit</i>' +
        '<span>Proforma invoice issued; 30% deposit starts production.</span></div>' +
        '<div class="s"><b>5</b><i>Production</i>' +
        '<span>Progress photos on request; three-stage in-house quality control.</span></div>' +
        '<div class="s"><b>6</b><i>Shipment</i>' +
        '<span>Pre-shipment inspection, then B/L, packing list and certificate set issued.</span></div></div>' +
      /* 余量落在这一个缝隙 → Terms 八条款 + 六步流程保持紧凑，
         FAQ 八条 + 收尾条下沉到下半页，整页重心平衡。 */
      '<div class="sp"></div>' +
      '<h2 class="h2">Common Questions<span class="cn">常见问题</span></h2>' +
      '<div class="faq">' +
      '<div class="q"><b>Can I mix different models in one order?</b>' +
        'Yes — mixed-model cartons are normal. MOQ applies per model and colour.</div>' +
      '<div class="q"><b>Do you supply the packaging with my own brand?</b>' +
        'Yes. Laser logo, printed colour box, barcode, label and export carton artwork.</div>' +
      '<div class="q"><b>Can you ship to the USA from stock?</b>' +
        'Yes — US warehouse stock dispatches within 1–3 days after US dispatch.</div>' +
      '<div class="q"><b>Are test reports available?</b>' +
        'LFGB, FDA lead migration and EN 13130 reports are available on request for the ' +
        'applicable models.</div>' +
      '<div class="q"><b>How do you confirm knife legality for my market?</b>' +
        'Import rules differ by country. Send your destination and we confirm before ' +
        'shipment.</div>' +
      '<div class="q"><b>Do you have a sample policy?</b>' +
        'Stock samples ship in 3–5 days; custom samples take 10–15 days, freight at your cost.</div>' +
      '<div class="q"><b>Which documents ship with the goods?</b>' +
        'Commercial invoice, packing list, B/L, and the certificate set you requested — ' +
        'LFGB, FDA or EN 13130 as applicable.</div>' +
      '<div class="q"><b>Can you ship DDP?</b>' +
        'Yes. DDP is available for most destinations; sea and air freight quoted on request.</div>' +
      '</div>' +
      /* 下单流程收尾条：让「六步走完 = 可以下单了」这个信号明确落下来 */
      '<div class="cnote"><b>Ready to order?</b> Send your SKU list, quantities and destination ' +
        'port — FOB pricing within one working day, carton data and loading quantity on request. ' +
        '<a href="#" onclick="return false">Email ' + esc(B.email || '') + '</a></div>' +
      '</div>' +
      '<div class="foot"><span>' + esc(meta.en) + '</span><span>' + esc(B.name) +
      ' · Product Catalog ' + year() + ' · ' + pg + ' / ' + pageTotal + '</span></div></div>');
    pg++;
    /* 封底 —— 版式对齐 v4 手册尾页（p152）：
       深底 + 三栏（CONTACT US / OUR PROMISE / 二维码）+ 底部两卡（创始人 / 供应品类）
       ⚠️ 5 本册子封底**完全一致**（用户要求「最后的页面可以是一样的」），
          只在页脚标当前册名，方便核对。 */
    var TOTAL_SKU = skuTotalAll();
    pages.push('<div class="page backcover">' +
      '<div class="bklogo"><img src="logo.png" alt=""><div class="bktag">' +
        esc(B.display) + ' · ' + esc(B.tagline || 'Crafted in Yangjiang') + '</div></div>' +
      '<div class="bkcols">' +
        '<div class="bkcol"><h4>Contact Us</h4>' +
          '<div class="bkstrong">' + esc(B.legal || '') + '</div>' +
          '<div class="bkdim">' + esc(B.cn || '') + '</div>' +
          '<div class="bkdim">' + esc(B.address ||
            '2F, No.166 Shengping Road, Dongcheng Town, Yangdong District, ' +
            'Yangjiang, Guangdong 529931, China') + '</div>' +
          '<div class="bkdim bklinks"><span>Web</span> ' + esc(B.site || '') +
            '<br><span>Email</span> ' + esc(B.email || '') +
            '<br><span>Tel</span> ' + esc(B.phone || '') +
            (B.whatsapp ? '<br><span>WhatsApp</span> ' + esc(B.whatsapp) : '') + '</div>' +
          '<h4 style="margin-top:4mm">Brand</h4>' +
          '<div class="bkdim">' + esc(B.cnBrand || '') + ' · ' + esc(B.founded || '2025') +
            '<br>' + esc(B.madein || 'Made in Yangjiang, Connected to the World') + '</div>' +
          '<h4 style="margin-top:4mm">Business</h4>' +
          '<div class="bkdim">B2B export · OEM / ODM · private label · supply-chain ' +
            'collaboration for importers, wholesalers, brand owners and online retailers.</div>' +
          '<h4 style="margin-top:4mm">Terms at a Glance</h4>' +
          '<div class="bkdim">FOB / CIF / DDP on request · 30% T/T deposit, balance against ' +
            'B/L copy · stock 7–15 days, custom 25–35 days · US warehouse stock ' +
            'dispatched within 1–3 days.</div>' +
        '</div>' +
        '<div class="bkcol"><h4>Our Promise</h4>' +
          '<div class="bkstrong">Trust First · Value Second · Price Last</div>' +
          '<div class="bkdim">We build long-term trust, not one-shot deals.</div>' +
          '<div class="bkdim">36 partner factories anchored in the Yangjiang cutlery cluster — ' +
            'deep strategic manufacturing partnerships, one accountable partner from ' +
            'your drawing to your shelf.</div>' +
          '<div class="bkdim">Small batches welcome — light customisation from 50 pcs. ' +
            'Pre-shipment proof: photos and video of every lot.<br>' +
            'US warehouse stock dispatched within 1–3 days.</div>' +
          '<h4 style="margin-top:4mm">Quality &amp; Certification</h4>' +
          '<div class="bkdim">Three-stage QC: incoming, in-process and pre-shipment AQL.<br>' +
            'SGS LFGB food contact · US FDA lead migration · EN 13130 soluble heavy metals · ' +
            'EN 10204-3.1 material certificates · FSC chain of custody.<br>' +
            'Reports issued on request for the applicable models.</div>' +
          '<h4 style="margin-top:4mm">Warranty</h4>' +
          '<div class="bkdim">Lifetime structural warranty · 10-year edge guarantee · ' +
            '2-year assembly guarantee · zero-defect release standard.</div>' +
        '</div>' +
        '<div class="bkcol bkqr"><img class="qr" src="qr.png" alt="">' +
          '<div class="cap">Scan to visit</div>' +
          '<div class="bkdim">' + esc(B.site || '') + '</div>' +
          '<div class="bkdim bktiny">4 core categories<br>Kitchen knives · Outdoor knives<br>' +
            'Scissors · Kitchen accessories</div>' +
        '</div>' +
      '</div>' +
      /* 中间原来是空口号带 → 改成「品牌承诺 + 四个数据格」的实心区块。
         原来只有一行字，占不满 297mm 页高，中间留出两大段空白（实测截图确认）。
         现在放大口号 + 加四格硬数据，把版面填满且信息量对得起欧美买家的阅读预期。 */
      '<div class="bkslogan"><div class="s1">' +
        esc(B.madein || 'Made in Yangjiang, Connected to the World') + '</div>' +
        '<div class="s2">' + esc(B.promise || 'Trust First · Value Second · Price Last') +
        ' &nbsp;·&nbsp; ' + esc(B.cnBrand || '') + ' &nbsp;·&nbsp; ' +
        esc(B.display || '') + '</div>' +
        '<div class="sgrid">' +
          '<div class="sg"><b>' + TOTAL_SKU + '+</b><i>Listed SKUs</i></div>' +
          '<div class="sg"><b>36</b><i>Partner factories<br>Yangjiang cluster</i></div>' +
          '<div class="sg"><b>160+</b><i>Export<br>destinations</i></div>' +
          '<div class="sg"><b>50 pcs</b><i>MOQ · samples<br>10–15 days</i></div>' +
        '</div></div>' +
      '<div class="bkcards">' +
        '<div class="bkcard"><div class="lb">Founder &amp; CEO</div>' +
          '<div class="nm">Leo Li · 利建成</div>' +
          '<div class="bkdim">' + esc(B.legal || '') + '</div>' +
          '<div class="bkdim">Trust First · Value Second · Price Last.<br>' +
            'Email your SKU list and quantities — FOB pricing within one working day.</div>' +
        '</div>' +
        '<div class="bkcard"><div class="lb">What We Supply</div>' +
          '<ul class="bklist">' +
            '<li><b>Kitchen Knives</b> — chef\u2019s, santoku, cleaver, bread, sashimi</li>' +
            '<li><b>Professional Scissors</b> — kitchen, tailor, garden, industrial</li>' +
            '<li><b>Outdoor Knives</b> — folding EDC, fixed blade, camping sets</li>' +
            '<li><b>Kitchen Accessories</b> — BBQ tools, cookware, boards, holders</li>' +
          '</ul>' +
          '<div class="bkdim bktiny">' + TOTAL_SKU + ' listed SKUs · 36 partner factories · ' +
            'exports to 160+ countries</div>' +
        '</div>' +
      '</div>' +
      /* 封底页脚右端改成页码（原来只放网址）→ 与前面各页 `N / Total` 统一，
         买家翻到最后一页仍能确认整册页数。 */
      '<div class="foot bkfoot"><span>' + esc(meta.en) + ' · ' +
        esc(B.name) + ' · Product Catalog ' + year() + '</span><span>' +
        pageTotal + ' / ' + pageTotal + '</span></div></div>');

    return { html: pages.join(''), pageTotal: pageTotal, skuTotal: list.length };
  }

  /* blob: URL 在部分 Chrome 打印会丢 → 打印前转 dataURL */
  function inlineBlobImages(root) {
    var imgs = root.querySelectorAll('img[data-blob]');
    var chain = Promise.resolve();
    for (var i = 0; i < imgs.length; i++) {
      (function (im) {
        chain = chain.then(function () {
          var k = im.getAttribute('data-blob');
          return imgBlob(k).then(function (b) {
            if (!b) return null;
            return new Promise(function (res) {
              var fr = new FileReader();
              fr.onload = function () { im.src = fr.result; im.removeAttribute('data-blob'); res(null); };
              fr.onerror = function () { res(null); };
              fr.readAsDataURL(b);
            });
          }).catch(function () { return null; });
        });
      })(imgs[i]);
    }
    return chain;
  }
  function waitImages(root) {
    var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
    var pending = imgs.filter(function (im) { return !im.complete; });
    return Promise.all(pending.map(function (im) {
      return new Promise(function (res) {
        var done = false;
        var fin = function () { if (!done) { done = true; res(); } };
        im.addEventListener('load', fin);
        im.addEventListener('error', fin);
        setTimeout(fin, 5000);
      });
    }));
  }

  function doExport(bookId, done) {
    if (S.exporting) { toast('正在导出，请稍候…'); return; }
    var def = bookDef(bookId);
    S.exporting = true;
    save();
    var paper = $('paper');
    paper.innerHTML = '';
    var info;
    try { info = buildPaper(bookId); }
    catch (e) {
      S.exporting = false; console.error(e);
      toast('构建失败：' + e.message); return;
    }
    paper.innerHTML = info.html;
    toast('正在准备「' + def.id + '」' + info.pageTotal + ' 页…', 8000);

    var finish = function () {
      S.exporting = false;
      document.title = 'KaiLionCrafts 产品目录编辑器';
      if (done) done();
    };
    var cleanup = function () {
      window.removeEventListener('afterprint', cleanup);
      paper.innerHTML = '';
      finish();
    };
    inlineBlobImages(paper)
      .then(function () { return waitImages(paper); })
      .then(function () {
        releaseUrls();
        document.title = def.file;
        toast('已生成 ' + info.pageTotal + ' 页 / ' + info.skuTotal +
              ' 张名片。在打印窗口选「另存为 PDF」。', 6000);
        setTimeout(function () {
          window.print();
          setTimeout(cleanup, 90000);
        }, 400);
        window.addEventListener('afterprint', cleanup);
      })
      .catch(function (e) {
        console.error(e);
        S.exporting = false;
        toast('导出出错：' + e);
        if (done) done();
      });
  }

  /* ==================================================================
     导出 Excel 产品目录（line sheet）—— 与 PDF 同源，实时同步
     ------------------------------------------------------------------
     列设计依据 2026-10-05 对欧美 B2B line sheet 的调研（真实样本：
     Fastenal、Zwilling 经销价目表、marketvalue.cn、Globalsources、Blade HQ）：
     · 🔴 进口商/批发商的 Excel **纯文字表格、不嵌图** —— 嵌图会破坏排序筛选、
       329 张让文件臃肿。图片以 `Photo File` 列（SKU.jpg）承载。
     · 列序 = 身份识别 → 物理规格 → 物流箱规 → 商务条款 → 合规元数据。
     · 必含 `Unit of Measure`(EA/SET) 与 `MOQ Basis` —— 缺了买家会回邮件问。
     · Sheet 名只用英文（中文会让买家觉得是机翻）。
     · 视图：冻结表头+SKU 列、自动筛选、横向 A4。
     ================================================================== */
  /* 🔴 2026-10-05 Cover/Contents/Terms 行高估算（利：「某一行有两行三行，
     没有完全显示出来」）
     Excel 行高是**固定值**，长文本不会自动换行撑高 ⇒ 被截断。
     按「最宽那列的字符容量」估算折行数，给足行高。 */
  function autoRowHeights(rows, cols, base, minH) {
    var lastW = (cols && cols.length ? cols[cols.length - 1].w : 92) || 92;
    var perLine = Math.max(20, Math.floor(lastW * 1.05));
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || [], maxLen = 0;
      for (var j = 0; j < r.length; j++) {
        var v = r[j];
        if (v == null || v === '') continue;
        maxLen = Math.max(maxLen, String(v).length);
      }
      var lines = Math.max(1, Math.ceil(maxLen / perLine));
      out.push(Math.min(Math.max(minH || 15, (base || 15) * lines), 120));
    }
    return out;
  }

  /* base64 → Uint8Array（缩略图嵌入用） */
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  /* 🔴 列序按 2026-10-05 联网核实的真实样本调整（Restaurantware / The Store Room /
     Adstronaut line sheet）：**首图在最左，紧邻 Product Name**。
     行业实测那些图的尺寸是 110×61 ~ 181×94 px —— 刻意用极小缩略图，
     买家用图的唯一目的是「30 秒内认出这是哪把刀」，不是替代看图。
     `Photo File` 列保留（行业标准做法：photo file naming），但降为次要信息。 */
  function xlsxCommonCols() {
    return [
      { h: 'Photo', w: 16 }, { h: 'No.', w: 6 },
      { h: 'Item No. (SKU)', w: 19 }, { h: 'Product Name', w: 40 },
      { h: 'Product Type', w: 22 },
      { h: 'Unit of Measure', w: 12 },
      { h: 'Blade Steel', w: 17 }, { h: 'Blade Length', w: 13 },
      /* 🔴 2026-10-07 列宽调整（利：「M 列被收窄、O/P 两列观感乱」）。
     **只加宽实测确实放不下的 4 列，其余一列没动**。测量方法：扫全部 8 册 658 张卡
     （注意要算上卡片 `rows` 里的回退值 —— 只看 `xlsx` 命名空间会误判Set Contents 为空），
     按「最长内容 ÷ (列宽×1.02) = 折行数」筛出 >4 行的列：
       Set Contents    261 字符 / 原宽 34 → 8 行 ⇒ 加宽到 60（5 行）
       Overall Length  148 字符 / 原宽 14 → 11 行 ⇒ 加宽到 46（4 行）
       Handle Material 111 字符 / 原宽 19 →  6 行 ⇒ 加宽到 43（3 行）
       Finish          113 字符 / 原宽 15 →  8 行 ⇒ 加宽到 44（3 行）
     不动的（≤3 行）：Blade Length · Color Options · Blade Steel · Lock / Mechanism · 全部数值列。
     列数、列顺序、列名一律没动。*/
      { h: 'Overall Length', w: 46 }, { h: 'Blade Thickness', w: 12 },
      { h: 'Hardness (HRC)', w: 12 }, { h: 'Net Weight', w: 12 },
      { h: 'Handle Material', w: 43 }, { h: 'Finish', w: 44 },
      { h: 'Color Options', w: 20 }, { h: 'Set Contents', w: 60 },
      { h: 'Lock / Mechanism', w: 15 },
      { h: 'Pcs per Carton', w: 12 }, { h: 'Carton Size (cm)', w: 17 },
      { h: 'CBM / Carton', w: 11 }, { h: 'N.W. / Carton (kg)', w: 13 },
      { h: 'G.W. / Carton (kg)', w: 13 },
      { h: '20GP Load (pcs)', w: 12 }, { h: '40HQ Load (pcs)', w: 12 },
      { h: 'MOQ (pcs)', w: 10 }, { h: 'MOQ Basis', w: 30 }
    ];
  }
  function xlsxBizCols() {
    return [
      { h: 'FOB Price (USD)', w: 13 }, { h: 'Tier 2 (500-999)', w: 13 },
      { h: 'Tier 3 (1000+)', w: 13 }, { h: 'Discount % @ T3', w: 12 },
      { h: 'Lead Time', w: 22 }
    ];
  }
  function xlsxCompCols() {
    /* ⚠️ 顺序必须与 Python 版 `_gen_excel.py` 的 COMP_HEAD 完全一致，
       否则两份 Excel 的列会错位（利2026-10-05 指出两版"差别挺大"）。
       Photo File 放最后 —— 它只是照片文件名参考，不是采购决策字段。
       🔴 2026-10-06（利定）：删掉原来的最后一列 `Data Source`
          （值如「装箱借自 KL-KN-SS-001」「FOB 为售价区间中位，需核定」）。
          理由：这张表是**发给客户看的**，内部核算备注对采购没有价值，
          写出去反而暴露"这批数据是估算的"，影响议价与信任。
          数据层 `xlsx` 里的 borrowFrom / est 标记全部保留（编辑器卡片上仍能看到），
          只是不再写进交付给客户的 Excel。 */
    /* 🔴 2026-10-08（利定）：删掉 `Photo File` 列。
       它只写一个文件名（`KL-KN-DS-001.jpg`），而图片就在左边Photo 列里，
       对采购没有实际意义，去掉后 Price List 38 列 → 37 列。 */
    return [
      { h: 'Country of Origin', w: 13 }, { h: 'HTS Code (US)', w: 13 },
      { h: 'Certification', w: 30 }, { h: 'OEM / ODM', w: 30 },
      { h: 'Barcode', w: 26 }, { h: 'Suggested Retail (USD)', w: 15 }
    ];
  }

  /* 从卡片的 rows（[[标签,值],…]）取第一个命中的标签值 */
  function rowGet(card, labels) {
    var rows = card.rows || [], m = {};
    for (var i = 0; i < rows.length; i++) m[rows[i][0]] = rows[i][1];
    for (var j = 0; j < labels.length; j++) {
      var v = m[labels[j]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }
  /* 🔴 2026-10-05 拆解"合并格"（浏览器版 Excel 大量列为空的根因）
     卡片的 rows 把多个字段塞进一个格（这是 PDF 卡片版的排版需要）：
       'Wt · Thk · HRC'  = '330 g · 2.3 mm · 58–60'
       'Pcs · Carton'    = '25 · 47 × 39 × 18'
       'N.W. / G.W.'     = '8.2 kg / 9.6 kg'
       'MOQ · Load'      = '100 pcs · 21,200/51,500'
     而 Excel 价格表要的是**拆开后的独立列**（Thickness / Hardness / Carton Size / CBM / G.W. / 装柜量）。
     之前浏览器版只 `rowGet(['Thickness'])` → 找不到 ⇒ 整列为空（实测 J/K/L/O/S/T/V/W/X 全空）。
     正解：按下标从合并格里取，与 `_gen_data_v2.py` 的 build_rows 拼装顺序严格对应。 */
  function splitCell(card, label, idx) {
    var raw = rowGet(card, [label]);
    if (!raw) return '';
    var parts = String(raw).split(/\s*[·/]\s*/);
    return (parts[idx] || '').trim();
  }
  function numOf(s) {
    if (!s) return '';
    var m = /-?\d+(?:\.\d+)?/.exec(String(s).replace(/,/g, ''));
    return m ? Number(m[0]) : '';
  }
  function rowNum(card, labels) {
    var s = rowGet(card, labels);
    if (!s) return '';
    var t = s.replace(/,/g, '');
    var m = /-?\d+(?:\.\d+)?/.exec(t);
    if (!m) return '';
    var v = parseFloat(m[0]);
    if (!isFinite(v)) return '';
    return (m[0].indexOf('.') < 0) ? Math.round(v) : v;
  }
  function moneyOf(s) {
    if (!s) return '';
    var m = /-?\d+(?:\.\d+)?/.exec(String(s).replace(/,/g, ''));
    if (!m) return '';
    var v = parseFloat(m[0]);
    return isFinite(v) ? v : '';
  }
  /* 段码：KL-<品类>[-SET]-<段码>-<序号>（SET 是品类标记，不是段码）*/
  function kcSeg(sku) {
    var m = /^KL-[A-Z]{2}(?:-SET)?-([A-Z]{2,3})-\d{3}/i.exec(String(sku || '').toUpperCase());
    return m ? m[1] : '';
  }
  /* 🔴 同一段码在不同品类含义不同（实测）：HC 户外=折叠/厨刀 2个/剪刀=厨房剪 */
  var SEGBLK_CAT = {
    outdoor: { DA: 'Folding Knives', DB: 'Fixed Blade & Trainers', DS: 'Fixed Blade & Trainers',
               SS: 'Fixed Blade & Trainers', HC: 'Folding Knives', TI: 'Camping & Multi-Blade' },
    knives:  { DS: 'Damascus & Pattern Blades', SS: 'High-Carbon Stainless',
               HM: 'Hammered & Forged', HC: 'Hammered & Forged' },
    scissors:{ PR: 'Poultry & Multipurpose', SS: 'Kitchen & Multipurpose',
               HC: 'Kitchen Shears', TI: 'Garden & Pruning' },
    accessories: {}
  };
  function isSetCard(card) {
    return (card.cat === 'sets') || (/-SET-/i.test(card.sku || ''));
  }
  /* MOQ 基数：多色 → per SKU per color，否则 per SKU */
  function moqBasisOf(card) {
    var co = rowGet(card, ['Color Options', 'Color Variants']);
    var multi = false;
    if (co) {
      if (/[\/、,]/.test(co)) multi = true;
      else {
        var COLORS = ['Black', 'White', 'Brown', 'Green', 'Blue', 'Red', 'Grey', 'Gray',
                      'Yellow', 'Stainless', 'Natural', 'Ivory', 'Rose'];
        var n = 0;
        for (var i = 0; i < COLORS.length; i++) {
          if (co.toLowerCase().indexOf(COLORS[i].toLowerCase()) >= 0) n++;
        }
        multi = n >= 2;
      }
    }
    return multi ? 'per SKU per color' : 'per SKU (mixable across colors)';
  }

  /* 🔴 2026-10-06：Excel 首图改为**双源**。
     现象（利 2026-10-06 报）：导入的 KL-KN-HM-006 导 PDF 有图，导 Excel 没图。
     根因：PDF 走 `imgSrc()` → `blobUrl()` 能读 IndexedDB；
     而这里只查**静态** `KC_THUMBS`（thumbs.js，330 条），新导入的图存在 IndexedDB
     （`c.img = 'idb:xxx'`）根本不在里面 → 空白。
     修法：先照旧塞静态缩略图，再把 `c.img` 指向 idb: 的卡片列成清单，
     导出前用 `fillXlsxIdbImages()` 逐个从 IDB 取出补进去（Blob → 缩到长边 200px
     再转 bytes，与 _gen_thumbs.py 的静态缩略图同规格，控制在 3–4 KB/张）。
     ⚠️ 行号一律是 xlsx 网格坐标：第 0 行=表头，第 i 条数据 = i+1（与 drawingXml 一致）。 */
  function xlsxImgTargets(sheets) {
    var out = [];
    sheets.forEach(function (sh) {
      if (!sh.imgs || !sh.skus) return;
      var have = {};
      sh.imgs.forEach(function (x) { have[x.row] = 1; });
      sh.skus.forEach(function (sku, i) {
        if (have[i + 1]) return;              /* 已有静态图 */
        out.push({ sheet: sh, row: i + 1, sku: sku });
      });
    });
    return out;
  }
  /* 从 IndexedDB 补齐缺失首图（幂等：已有图就跳过） */
  function fillXlsxIdbImages(sheets) {
    var t = xlsxImgTargets(sheets);
    if (!t.length) return Promise.resolve(0);
    var sh = t[0].sheet;
    var w = sh.imgs.length ? sh.imgs[0].w : 96;
    var h = sh.imgs.length ? sh.imgs[0].h : 96;
    return Promise.all(t.map(function (o) {
      var card = null;
      Object.keys(S.books).some(function (bid) {
        var f = (S.books[bid].cards || []).filter(function (c) { return c.sku === o.sku; })[0];
        if (f) { card = f; return true; }
        return false;
      });
      if (!card || !card.img || card.img.indexOf('idb:') !== 0) return Promise.resolve(0);
      return imgBlob(card.img.slice(4)).then(function (blob) {
        if (!blob) return 0;
        return blobToThumbBytes(blob, 200).then(function (bytes) {
          if (!bytes) return 0;
          o.sheet.imgs.push({ data: bytes, row: o.row, col: 0, w: w, h: h });
          return 1;
        });
      }).catch(function () { return 0; });
    })).then(function (r) {
      return r.reduce(function (a, b) { return a + b; }, 0);
    });
  }
  /* Blob → 长边 200px 的 JPEG bytes（浏览器端缩图，异步） */
  function blobToThumbBytes(blob, maxSide) {
    return new Promise(function (res) {
      var fr = new FileReader();
      fr.onerror = function () { res(null); };
      fr.onload = function () {
        var pr = new Image();
        pr.onerror = function () { res(null); };
        pr.onload = function () {
          try {
            var mw = pr.naturalWidth, mh = pr.naturalHeight;
            var s = Math.min(1, maxSide / Math.max(mw, mh));
            var cw = Math.max(1, Math.round(mw * s)), ch = Math.max(1, Math.round(mh * s));
            var cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            cv.getContext('2d').drawImage(pr, 0, 0, cw, ch);
            cv.toBlob(function (b2) {
              if (!b2) return res(null);
              var fr2 = new FileReader();
              fr2.onerror = function () { res(null); };
              fr2.onload = function () {
                /* 🔴 readAsArrayBuffer 给的是 ArrayBuffer，必须直接 new Uint8Array(buf)；
                   原来写成 String(fr2.result) 会得到 "[[object ArrayBuffer]]"（19 字符），
                   塞进 xlsx 后那张图直接坏掉（利截图里第 28 行空白就是它）。*/
                try { res(new Uint8Array(fr2.result)); }
                catch (e) { res(null); }
              };
              fr2.readAsArrayBuffer(b2);
            }, 'image/jpeg', 0.75);
          } catch (e) { res(null); }
        };
        pr.src = fr.result;
      };
      fr.readAsDataURL(blob);   /* 老 IE/Edge 也认 */
    });
  }

  function buildXlsxSheets(bookId) {
    var def = bookDef(bookId);
    var list = S.books[bookId].cards;
    var wp = !!def.withPrice;
    var B = DATA.brand;
    var meta = catMeta(def.cat);

    /* ---- 区块划分（与 Python 版_gen_excel.py 保持一致） ---- */
    var FALLBACK = {
      outdoor: 'Folding Knives', knives: 'Damascus & Pattern Blades',
      scissors: 'Kitchen & Multipurpose', accessories: 'Tools & Containers'
    };
    var items = list.map(function (c) {
      var seg = kcSeg(c.sku);
      var set = isSetCard(c);
      var t = set ? 'Knife Sets' : (SEGBLK_CAT[def.cat][seg] || FALLBACK[def.cat]);
      return { c: c, set: set, type: t };
    });
    /* 单刀在前、套刀在后；组内保持原有顺序 */
    items.sort(function (a, b) { return (a.set ? 1 : 0) - (b.set ? 1 : 0); });
    /* 🔴 钉死每条数据在 xlsx 里的网格行号（+1 跳过表头）。
       图片锚点必须用它，不能用 body.length 反推（会随任何 push 改动而错位）。 */
    items.forEach(function (it, i) { it._xlsxRow = i + 1; });

    /* ---- Sheet 1: Cover ----
       🔴 2026-10-05 补版式（利：「导出的excel 感觉都是版本错乱的，就堆叠在一起」）：
       原来只有纯文本数组，没有任何层级/配色/Logo，Excel 里就是一列裸文字。
       现在加 **行样式标记** `st`（t1=品牌大字 / t2=品名 / k=小节标题 / d=说明）
       + `img:logo.png`，与 Python 版（`_gen_excel.py` 的 sheet_cover）版式对齐。 */
    var cover = [
      /* Logo 行：图片走 imgs 嵌入，**不放任何文字**（原来留了 '[Logo]' 文字占位，
         会在单元格里露出 "logo" 字样）。行高由 rowHeights 撑开。 */
      ['', '', ''],
      ['KaiLionCrafts', '', 't1'],
      [meta.en, '', 't2'],
      ['Product Price List / Line Sheet', '', 't3'],
      [''],
      ['', '', 'band'],            /* 纯色带行：两格都空，只铺底色 */
      [meta.no + '  ' + meta.en, list.length + ' SKUs  ·  ' +
        (wp ? 'Quotation Edition' : 'Public Edition'), 'band'],
      [''],
      ['', '', 'band'],
      ['Currency', 'USD (FOB Yangjiang / Guangzhou)', 'kv'],
      ['Incoterms', 'FOB / CIF / DDP on request  ·  Incoterms 2020', 'kv'],
      ['Payment terms', '30% T/T deposit, balance against B/L copy  ·  L/C at sight above USD 30,000', 'kv'],
      ['Production lead time', 'Stock 7-15 days  ·  Custom 25-35 days  (Yangjiang cluster)', 'kv'],
      ['Origin', 'China  ·  Yangjiang, Guangdong', 'kv'],
      ['MOQ basis', 'Per SKU, mixable across items  ·  per colour for multi-colour items', 'kv'],
      [''],
      ['Contact', '', 'k'],
      ['Company', B.legal || 'Yangjiang Kaili International Trading Co., Ltd.', 'kv'],
      ['Brand', 'KaiLionCrafts', 'kv'],
      ['Website', B.site || 'kailioncrafts.com', 'kv'],
      ['Email', B.email || '', 'kv'],
      ['Phone / WhatsApp', (B.phone || '') + (B.whatsapp ? '  ·  ' + B.whatsapp : ''), 'kv'],
      ['Address', B.address || '', 'kv'],
      [''],
      ['Terms', '', 'k'],
      ['Prices are indicative and subject to change without notice. Final quotation is ' +
       'confirmed on order. HTS codes are for US customs reference; final classification is ' +
       'determined by the importing broker.', '', 'd'],
      ['We work through deep strategic manufacturing partnerships in the Yangjiang cutlery ' +
       'cluster. We are a trading and supply-chain partner, not a factory.', '', 'd']
    ];
    /* Cover 的 Logo：thumbs.js 里的 __logo__（base64）→ 走同一套 imgs 通道 */
    var coverImgs = [];
    if (typeof KC_THUMBS !== 'undefined' && KC_THUMBS['__logo__']) {
      try {
        coverImgs.push({ data: b64ToBytes(KC_THUMBS['__logo__']), row: 0, col: 0,
                         w: 132, h: 132 });
      } catch (e) { /* Logo 失败不阻断 */ }
    }
    var COVER_COLS = [{ w: 3 }, { w: 32 }, { w: 92 }];
    var shCover = {
      name: 'Cover', header: false, padLeft: true,
      cols: COVER_COLS, rows: cover, imgs: coverImgs,
      /*🔴 不再全填 0（0 高度 = 整行消失，之前"某行没显示"就是这个原因） */
      rowHeights: (function () {
        var h = autoRowHeights(cover, COVER_COLS, 16, 16);
        if (h.length) h[0] = 104;          /* Logo 行 */
        return h;
      })(),
      zoom: 100
    };

    /* ---- Sheet 2: Contents ---- */
    var byType = {};
    items.forEach(function (it) { (byType[it.type] = byType[it.type] || []).push(it); });
    var rowsC = [['Section', 'Item No. Range', 'Items', 'Unit']];
    Object.keys(byType).sort(function (a, b) { return byType[b].length - byType[a].length; })
      .forEach(function (k) {
        var arr = byType[k];
        rowsC.push([k, arr[0].c.sku + '  -  ' + arr[arr.length - 1].c.sku, arr.length,
                    arr[0].set ? 'SET' : 'EA']);
      });
    rowsC.push(['TOTAL', '', list.length, '']);
    var CONTENTS_COLS = [{ w: 3 }, { w: 36 }, { w: 36 }, { w: 10 }, { w: 10 }];
    var shContents = {
      name: 'Contents', padLeft: true, cols: CONTENTS_COLS,
      rows: rowsC, rowHeights: autoRowHeights(rowsC, CONTENTS_COLS, 16, 16), zoom: 100
    };

    /* ---- Sheet 3: Terms ---- */
    var TERMS_COLS = [{ w: 3 }, { w: 28 }, { w: 96 }];
    var termsRows = [['Terms & Conditions'], [''],
        ['Ordering', 'Send your SKU list, quantities and destination port. FOB pricing is ' +
          'returned within one working day.'],
        ['MOQ basis', 'MOQ applies per SKU and is mixable across items within one order. ' +
          'For items with multiple colour options, MOQ applies per SKU per colour.'],
        ['Payment', '30% T/T deposit with order, balance against copy B/L. L/C at sight ' +
          'accepted for orders above USD 30,000.'],
        ['Shipping', 'FOB Yangjiang / Guangzhou (Guangzhou Nansha Port) as standard; CIF and ' +
          'DDP on request. Sea 20-35 days door to door.'],
        ['Packing', 'Export carton quantity, carton dimensions, CBM and 20GP / 40HQ loading ' +
          'quantity are listed per item.'],
        ['Lead Time', 'Stock 7-15 days. Custom 25-35 days after drawing approval and deposit.'],
        ['Custom Tooling', 'OEM / ODM: blade profile, steel, handle material, finish, ' +
          'packaging, colour box and carton artwork.'],
        ['Price Validity', 'Indicative pricing, subject to change without notice. Final prices ' +
          'confirmed per order. Items marked EST carry an estimated price pending confirmation.'],
        ['HTS', 'HTS codes are for US customs reference only; final classification is ' +
          'determined by the importing broker.']];
    var shTerms = {
      name: 'Terms', header: false, padLeft: true, cols: TERMS_COLS, zoom: 100,
      rows: termsRows, rowHeights: autoRowHeights(termsRows, TERMS_COLS, 16, 16)
    };

    /* ---- Sheet 4: Price List ---- */
    var cols = xlsxCommonCols();
    if (wp) cols = cols.concat(xlsxBizCols());
    else cols = cols.concat([{ h: 'Lead Time', w: 22 }]);
    cols = cols.concat(xlsxCompCols());
    var head = cols.map(function (c) { return c.h; });
    var body = [head];
    /*首图：200px 长边缩略图在 96dpi 下约 150px 显示高⇒ 行高给足，否则图被压扁 */
    var imgH = 96, imgW = 96;   /* 96px ≈ 72pt，配 rowHeights 用 */
    var imgs = [];
    /* 公开版卡的 price 是 null（不显示价格），但**HTS 码与 Lead Time 不是价格**，
       欧美买家在公开版同样需要（HS 码算关税、交期排产）。⇒ 预先建一张
       「SKU → 报价版 price」的索引，公开版据此补HTS/Lead。 */
    var priceBySku = {};
    Object.keys(S.books || {}).forEach(function (bid) {
      (S.books[bid].cards || []).forEach(function (c) {
        if (c.sku && c.price && !priceBySku[c.sku]) priceBySku[c.sku] = c.price;
      });
    });

    items.forEach(function (it, idx) {
      var c = it.c, p = c.price || {};
      /*🔴 2026-10-08：`pAll`（公开版从报价版借 HTS/Lead 用的）随「全表统一」改造后
         已无引用 —— HTS 与 Lead Time 现在都是写死的统一值，不再逐卡取值。*/
      /* 🔴 Excel 专用字段在card.xlsx 里（2026-10-05 加进数据层的 `xlsx` 命名空间）。
         PDF 卡片版不用它们，所以以前数据层里没有 ⇒ 浏览器导出的 Price List
         这几列全是空的。优先读 xlsx，其次回落 rows。 */
      var X = c.xlsx || {};
      var moq = rowGet(c, ['MOQ', 'MOQ · Load', 'MOQ ·']);
      var moqNum = rowNum(c, ['MOQ', 'MOQ · Load', 'MOQ ·']);
      var row = [
        '',                /* Photo 列：留空，实图用 drawing 嵌（不能写文本） */
        idx + 1,
        c.sku || '',
        c.name || '',
        it.type,
        /* UOM：套刀且名字里有 "N-Piece/N-Pcs" 才算 SET，否则 EA */
        (function () {
          if (!it.set) return 'EA';
          return /\d+\s*[- ]?(?:Piece|Pcs|pc|PCS)/.test(c.name || '') ? 'SET' : 'EA';
        })(),
        rowGet(c, ['Material', 'Blade Material', 'Materials']),
        (X.bladeLen || rowGet(c, ['Blade Length', 'Blade'])),
        (X.sizeOverall || rowGet(c, ['Size / Overall', 'Overall Length', 'Overall'])),
        /* ↓ 以下 5 列从"合并格"里拆出来（见 splitCell 注释） */
        (X.thickness || splitCell(c, 'Wt · Thk · HRC', 1)),   /* Blade Thickness */
        (X.hrc || splitCell(c, 'Wt · Thk · HRC', 2)),   /* Hardness (HRC) */
        (function () {                /* Net Weight —— 兼容 v4 卡的独立标签 */
          var a = X.netWeight || rowGet(c, ['Net Weight', 'Net Weight (est)']);
          if (a) return a;
          return splitCell(c, 'Wt · Thk · HRC', 0);
        })(),
        (X.handle || rowGet(c, ['Handle Material'])),
        (X.finish || rowGet(c, ['Finish'])),
        /* 颜色：v4 卡用 'Color Variants'，其余品类卡片无此字段 ⇒ 询价项 */
        (X.color || rowGet(c, ['Color Options', 'Color Variants']) || 'on request'),
        rowGet(c, ['Set Contents']),
        rowGet(c, ['Lock']),
        /* ↓ 装箱组：从'Pcs · Carton' 拆成 装箱数 / 箱规 / CBM */
        numOf(X.pcsCarton) || numOf(splitCell(c, 'Pcs · Carton', 0)) ||
          numOf(rowGet(c, ['Pcs / Carton', 'Pieces'])),
        (X.cartonSize || splitCell(c, 'Pcs · Carton', 1) ||
           rowGet(c, ['Carton Size (cm)']) || 'on request'),
        (numOf(X.cbm) || numOf(rowGet(c, ['CBM / Carton'])) || 'on request'),
        numOf(X.nwCarton) || numOf(splitCell(c, 'N.W. / G.W.', 0)) ||
          numOf(rowGet(c, ['N.W. / Carton'])),
        numOf(X.gwCarton) || numOf(splitCell(c, 'N.W. / G.W.', 1)) ||
          numOf(rowGet(c, ['G.W. / Carton'])),
        /* 装柜量在'MOQ · Load' 的第 2 段：'100 pcs · 21,200/51,500' */
        (numOf(X.gpc20) || numOf(splitCell(c, 'MOQ · Load', 1).split('/')[0])),
        (numOf(X.gpc40) || numOf(splitCell(c, 'MOQ · Load', 1).split('/')[1]) || 'on request'),
        /* 🔴 缺 MOQ 时写 on request，不留空也不编造（欧美买家看到空白会回邮件问） */
        (moqNum !== '' ? moqNum : 'on request'),
        (moqNum !== '' ? moqBasisOf(c) : 'on request - confirm with quotation')
      ];
      /* 🔴 2026-10-08（利定）：Lead Time **全表统一** = `Logo: 15d | ODM: 30d`。
         旧数据有两套（81 行 `30–45 days` / 29 行套刀 `Logo: 12d | ODM: 35d`），
         同一张表里交期不一致会让买家怀疑是不是有两个工厂/两条产线。
         ⚠️ 取舍：套刀工序多，原本 12d/35d 偏保守；统一成 15d/30d 后套刀交期
         相对更紧。**如果对套刀交期没把握，改这里回退成按 isSet 分别取值。*/
      var LEAD_UNIFIED = 'Logo: 15d | ODM: 30d';
      if (wp) {
        row.push(moneyOf(p.fob), moneyOf(p.t1), moneyOf(p.t2), 0.12, LEAD_UNIFIED);
      } else {
        /*公开版不显示价格（正确），但 **HTS 与Lead Time 不是价格**——
          它们是规格与物流信息，欧美买家在公开版也需要（HS 码要算关税、交期要排产）。
          数据层公开版 price 为 null ⇒ 从报价版借这两个字段。 */
        row.push(LEAD_UNIFIED);
      }
      /* HTS / Lead Time：2026-10-08 起**全表统一**（见下面 row.push 的注释）。
         ⚠️ 下面几列在**数据层卡片里没有**（PDF 卡片版不需要它们，只有 Excel 主表有）：
         Color Options / CBM / Certification / Barcode / Suggested Retail。
         浏览器端拿不到 ⇒ 写明确占位而不是留空（空cell 会被买家当成"漏填"）。
         `on request` = 可询价项，是欧美 line sheet 的通行写法。 */
      /* 🔴 2026-10-08（利定）：HTS / Certification / OEM-ODM / Barcode / Lead Time
         五项**全表统一**，不再按卡片逐个取值 —— 否则同一批货里同段码的行会不一致
         （实测旧数据：套刀 29 行写 `on request`/`Available`、单刀 81 行写具体值）。
         「on request / Available」这类占位词等于告诉买家"这项我们不确定"，
         给客户看不如统一给一个明确说法。
         ⚠️ HTS 例外说明：真实税则确实按品类不同（单刀 8211.92.00、
         套刀 8211.10.00 —— 海关归类不同），但既然利要求统一，就统一按品类走
         （`guessHts(def.cat)`，段码不参与—— 段码变量 `seg` 只在 items 构造时是局部
         变量，不在 forEach 这个作用域里，别直接引用）。
         **报价前请与报关行确认套刀归类是否需要改回 8211.10.00**，
         否则可能影响美国进口关税（税率不同）。 */
      row.push('China', guessHts(def.cat) || '8211.92.00',
               'FDA-compliant (21 CFR) food-contact · LFGB tested · CE marked',
               'Logo · Handle · Blade Shape · Full Packaging · ODM',
               'Assigned per your market (EAN-13 / UPC-A)');
      row.push(numOf(X.msrp) || rowNum(c, ['Suggested Retail', 'Retail']) || '');
      /* 🔴 2026-10-06（利定）：原本这里还push 一个「数据来源」列，已删除。
         🔴 2026-10-08（利定）：原本还有 `Photo File` 列（写 c.sku + '.jpg'），也已删除。
         这张表是给客户看的：内部核算备注与文件名索引都不该出现在交付物里。
         borrowFrom / est 信息仍在编辑器卡片与localStorage 里，报价前自己看。*/
      body.push(row);

      /* ---- 首图：从缩略图库取 bytes，交给 KCXLSX 嵌入 ----
         缩略图规格 200px 长边 / q75（实测 3.6 KB/张，130 张 ≈ 0.5 MB）。
         file:// 下 fetch 读不了图片，所以用 `thumbs.js` 的 base64 退路。
         🔴 行号基准（2026-10-06 修）：xlsx 网格坐标是 **0-based，且第 0 行是表头**，
         所以第 i 条数据（items 从 0 数）对应网格行 = i + 1。
         原来写 `body.length - 1`：body[0] 是表头 ⇒第一条数据 body.length=2 ⇒ 得 1，
         整体**上移了一行** —— 表现是每张图都压在上一行，第 1 行空白、
         倒数第 2 行的图被下一行挤掉（利截图里就是第 28 行空、第 27/29 有图）。*/
      var b64 = (typeof KC_THUMBS !== 'undefined') ? KC_THUMBS[c.sku] : null;
      if (b64) {
        try {
          imgs.push({ data: b64ToBytes(b64), row: it._xlsxRow, col: 0,
                       w: imgW, h: imgH });
        } catch (e) { /* 单张失败不阻断整表 */ }
      }
    });
    var shList = {
      name: 'Price List', cols: cols, rows: body, imgs: imgs,
      /* 🔴 数据行换行（配合 _xlsx.js 的 s=10 样式）。
         只影响这张表：Cover/Contents/Terms 的普通行仍走 s=0 不折行，版式原样。 */
      wrapCells: true,
      /* 🔴 供 fillXlsxIdbImages 定位：行号 i ↔ SKU（新导入的图在 IndexedDB，不在
         静态 KC_THUMBS 里，导出前要异步补进去，否则 Excel 那格是空的） */
      skus: items.map(function (it) { return it.c.sku || ''; }),
      /* 🔴 行高必须给足，否则缩略图被压扁（96px 图需要 ≥72pt 行高）
         🔴 2026-10-07（利反馈「M 列被收窄、O/P 两列时合时分」）：
         开了 wrapText 后**行高必须按内容算**，否则固定 74pt 只能放 4 行，
         113 字符的 Finish（列宽 15）要 8 行 ⇒ 文字被裁掉，等于白改。
         做法：每行按「该行最宽的那个格子 / 该列可用宽度」估算折行数，
               乘行高取上限。下限 74（保证缩略图不变形），上限 200（太高就不像样）。
         ⚠️ 只影响行高与字是否折行，**不碰任何数据与列顺序**。*/
      rowHeights: (function () {
        /* 每字符可容纳宽度≈列宽（Excel 宽度单位 ≈ 1 个数字字符） */
        var CH_PER_W = 1.02;
        var LINE_PT = 12.5;               /* 10pt 字体单行行高 */
        var h = [30];// 表头
        for (var r = 0; r < body.length - 1; r++) {
          var row = body[r + 1] || [];
          var lines = 1;
          for (var c = 0; c < row.length && c < cols.length; c++) {
            var v = row[c];
            if (v == null || v === '') continue;
            /* Photo 列（0）留给图片，不参与文字折行 */
            if (c === 0) continue;
            var wpx = (cols[c] && cols[c].w) || 12;
            var need = Math.ceil(String(v).length / Math.max(4, wpx * CH_PER_W));
            if (need > lines) lines = need;
          }
          h.push(Math.min(Math.max(74, Math.ceil(lines * LINE_PT) + 6), 200));
        }
        return h;
      })(),
      freeze: 'D2', autofilter: true, zoom: 90
    };

    /* 🔴 2026-10-06（利定）：**删掉第 5 个 sheet「Listing Details」**。
       原意是放截图独有的 SEO/ALT/长尾词/USP 等电商上架字段，但看过的反馈是
       「感觉这些内容乱乱的」—— 对外发给客户的 B2B line sheet 里，这些字段
       一是绝大多数 SKU 为空（空列），二是亚马逊标题/关键词属于平台运营内部
       词，给采购看没有意义反而显得不专业。
       只保留 4 个 sheet：Cover / Contents / Terms / Price List。
       ⚠️ 数据层 `xlsx` 命名空间里的这些字段**不删**，导入功能仍在写入，
          只是不再单独成 sheet（以后要恢复，重新加一个 sheet 即可）。 */
    return [shCover, shContents, shTerms, shList];
  }

  /* Excel 导出**预览 → 确认 → 下载**（2026-10-05）
     为什么加预览：浏览器版xlsx 是手写 OOXML，样式/列宽/图片位置一旦有问题，
     下载后才发现就得重来。预览能一眼看出「有几张 sheet、多少行多少列、
     有没有嵌图、封面字段齐不齐」，确认无误再下载。
     🔴 2026-10-06：改成**两段异步** —— 先同步搭好表结构并渲染预览，
        再 `fillXlsxIdbImages()` 把 IndexedDB 里的新图补进去，最后才 KCXLSX.build()。
        否则新导入的产品在预览里就显示「无图」，用户会以为还是坏的。 */
  function previewXlsx(bookId) {
    if (typeof KCXLSX === 'undefined') { toast('Excel 模块未加载'); return; }
    save();
    var def = bookDef(bookId);
    var sheets;
    try {
      sheets = buildXlsxSheets(bookId);
    } catch (e) {
      console.error(e);
      toast('生成失败：' + (e && e.message ? e.message : e), 6000);
      return;
    }
    var pl = sheets[sheets.length - 1];      /* Price List */
    var miss = xlsxImgTargets(sheets).length;
    /* 有缺失图就等异步补齐再显示「生成中」，让用户看到进度而不是干等 */
    if (miss) {
      var pd = $('saveDot');
      if (pd) { pd.className = 'savedot dirty'; $('saveTxt').textContent = '正在读取图片…'; }
    }
    fillXlsxIdbImages(sheets).then(function (nFilled) {
      finishXlsxPreview(bookId, def, sheets, nFilled);
    });
  }

  function finishXlsxPreview(bookId, def, sheets, nFilled) {
    var bytes;
    try {
      bytes = KCXLSX.build(sheets);
    } catch (e) {
      console.error(e);
      toast('生成失败：' + (e && e.message ? e.message : e), 6000);
      return;
    }
    var list = sheets[sheets.length - 1];
    var nImg = (list.imgs || []).length;
    var nRow = list.rows.length - 1;
    var fname = (def.file || def.id) + '.xlsx';
    var sizeKB = (bytes.length / 1024).toFixed(0);

    /* 校验项：把「可能出问题的地方」显式列出来，而不是等下载后才发现 */
    var checks = [
      ['Sheet 数', sheets.length + ' 个（Cover / Contents / Terms / Price List）',
        sheets.length === 4],
      ['数据行', nRow + ' 行 × ' + list.cols.length + ' 列', nRow > 0],
      ['嵌图', nImg + ' 张' + (nImg ? '' : '  ⚠ 一张都没有'), nImg > 0],
      ['图片覆盖率', nImg + ' / ' + nRow + '（' +
        (nRow ? Math.round(100 * nImg / nRow) : 0) + '%）',
        nRow > 0 && nImg >= nRow * 0.95],
      ['冻结窗格', list.freeze || '（无）', !!list.freeze],
      ['自动筛选', list.autofilter ? '有' : '（无）', !!list.autofilter],
      ['文件大小', sizeKB + ' KB', true],
    ];
    var okAll = true;
    var rows = checks.map(function (c) {
      var ok = !!c[2];
      if (!ok && c[0] !== '文件大小') okAll = false;
      return '<tr><td>' + esc(c[0]) + '</td><td>' + esc(c[1]) + '</td>' +
             '<td style="text-align:right;color:' + (ok ? '#2E7D32' : '#C62828') +
             ';font-weight:500">' + (ok ? 'OK' : '注意') + '</td></tr>';
    }).join('');

    /* 封面/目录字段清单（确认口径没漏） */
    var coverInfo = sheets[0].rows.filter(function (r) { return r && r[0]; })
      .map(function (r) { return esc(r[0]); }).join(' · ');

    /* === 🔴 完整预览：把 4 个 sheet 的内容**按行渲染成 HTML 表格** ===
       要求（利2026-10-05）：「我下载是什么样子，预览就要是什么样子」。
       ⇒ 不能只给统计数字，必须能看到真实的行与列。
       实现：直接遍历 buildXlsxSheets 返回的数据，与写xlsx 用的是同一份数组，
             所以预览 == 下载内容（同一数据源，不会出现"预览对、下载错"）。 */
    function sheetTable(sh, maxRow) {
      var hdr = sh.cols.map(function (c) { return c.h; });
      var h = '<table class="pv"><thead><tr>';
      hdr.forEach(function (c, i) {
        h += '<th class="' + (i === 0 ? 'c-photo' : (i < 6 ? '' : 'c-opt')) + '">' + esc(c) + '</th>';
      });
      h += '</tr></thead><tbody>';
      var n = Math.min(sh.rows.length, (maxRow || 0) + 1);
      for (var r = 0; r < n; r++) {
        h += '<tr' + (r === 0 ? ' class="hd"' : '') + '>';
        for (var c = 0; c < hdr.length; c++) {
          var v = sh.rows[r][c];
          if (v === '' || v == null) v = '';
          var cls = c === 0 ? 'c-photo' : (c < 6 ? '' : 'c-opt');
          h += '<td class="' + cls + '" title="' + esc(v) + '">' + esc(v) + '</td>';
        }
        h += '</tr>';
      }
      h += '</tbody></table>';
      if (sh.rows.length > n) {
        h += '<div class="pvm">… 其余 ' + (sh.rows.length - n) + ' 行省略（下载后是完整的）</div>';
      }
      return h;
    }

    var LISTROWS = 12;      /* Price List 先看 12 行，够判断格式对不对 */
    /* 默认停在 Price List（最后一个）。**不要写死索引** —— sheet 数会变
       （2026-10-06 删掉了第 5 个「Listing Details」）。 */
    var DEFAULT_TAB = sheets.length - 1;
    var h = '';
    h += '<h4>导出前预览 —— ' + esc(fname) + '</h4>';
    h += '<table class="rt pvchk"><tbody>' + rows + '</tbody></table>';
    h += '<div class="pvtabs">';
    /* 🔴 页签**按实际 sheet 数组动态生成** —— 原来写死 4 个，
       增删 sheet 之后就对不上了（利 2026-10-05 报过）。 */
    sheets.forEach(function (s, i) {
      h += '<button class="pvt' + (i === DEFAULT_TAB ? ' on' : '') + '" data-pvt="' + i + '">' +
           esc(s.name) + '</button>';
    });
    h += '</div>';
    h += '<div id="pvBox" class="xlpvbox">' +
         sheetTable(sheets[Math.min(DEFAULT_TAB, sheets.length - 1)], LISTROWS) + '</div>';
    h += '<div style="font-size:11.5px;color:var(--mute);margin:8px 0 12px;line-height:1.8">' +
         '<b>封面字段</b>：' + coverInfo + '</div>';
    h += '<div class="tips" style="line-height:1.9;margin-bottom:6px">' +
         '预览与下载<b>同一数据源</b>，所见即所得。' +
         '要改数据先关掉这个窗口，在左侧改完再回来导。</div>';
    modal('导出 Excel · 完整预览', h,
      '<button data-mc="1">取消</button>' +
      '<button class="pri" data-fn="xlsxOk">确认导出</button>', true);

    /* sheet 切换 */
    var pvb = $('pvBox'), pvts = document.querySelectorAll('.pvt');
    Array.prototype.forEach.call(pvts, function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(pvts, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        var si = +b.getAttribute('data-pvt');
        /* Price List 行高按内容算（列多、行高 74pt），其余表看前 60 行即可 */
        var sh = sheets[si];
        pvb.innerHTML = (sh.name === 'Price List')
          ? sheetTable(sh, LISTROWS) : sheetTable(sh, 60);
      });
    });

    function reallyDownload() {
      try {
        KCXLSX.download(bytes, fname);
        toast('已导出 ' + fname + '（' + nRow + ' 行 × ' + list.cols.length +
              ' 列，' + nImg + ' 张图，' + sizeKB + ' KB）', 6000);
      } catch (e) {
        toast('下载失败：' + (e && e.message ? e.message : e), 6000);
      }
    }
    MODALS.xlsxOk = function () { closeModal(); reallyDownload(); };
    MODALS.xlsxJustDl = function () { closeModal(); reallyDownload(); };
  }

  /* 直连下载（不经预览）—— 🔴 2026-10-06 同样要等 IndexedDB 图补齐，
     否则「⊞ 导出 Excel」出的文件里新导入产品没图（PDF 有Excel 没有的根因）。 */
  function exportXlsx(bookId) {
    if (typeof KCXLSX === 'undefined') { toast('Excel 模块未加载'); return; }
    save();
    var sheets, def;
    try {
      sheets = buildXlsxSheets(bookId);
      def = bookDef(bookId);
    } catch (e) {
      console.error(e);
      toast('Excel 导出失败：' + (e && e.message ? e.message : e), 6000);
      return;
    }
    var miss = xlsxImgTargets(sheets).length;
    var go = function () {
      try {
        var bytes = KCXLSX.build(sheets);
        var fname = (def.file || def.id) + '.xlsx';
        KCXLSX.download(bytes, fname);
        var pl = sheets[sheets.length - 1];
        toast('已导出 ' + fname + '（' + (pl.rows.length - 1) + ' 行 × ' +
              pl.cols.length + ' 列，' + sheets.length + ' 个 sheet，' +
              (pl.imgs || []).length + ' 张图）', 5000);
      } catch (e) {
        console.error(e);
        toast('Excel 导出失败：' + (e && e.message ? e.message : e), 6000);
      }
    };
    if (!miss) return go();
    var pd = $('saveDot');
    if (pd) { pd.className = 'savedot dirty'; $('saveTxt').textContent = '正在读取图片…'; }
    fillXlsxIdbImages(sheets).then(go);
  }

  function exportAllXlsx() {
    if (typeof KCXLSX === 'undefined') { toast('Excel 模块未加载'); return; }
    save();
    var list = BOOKS.slice();
    var i = 0;
    var step = function () {
      if (i >= list.length) { toast(list.length + ' 本 Excel 全部导出完成', 5000); return; }
      var b = list[i];
      var def = bookDef(b.id);
      var sheets;
      try { sheets = buildXlsxSheets(b.id); }
      catch (e) { console.error(e); toast(b.id + ' 导出失败：' + e, 5000); i++; return setTimeout(step, 700); }
      /* 🔴 逐本等IndexedDB 图补齐再 build（与单本导出同一条链路） */
      fillXlsxIdbImages(sheets).then(function () {
        try {
          KCXLSX.download(KCXLSX.build(sheets), (def.file || b.id) + '.xlsx');
        } catch (e) { console.error(e); toast(b.id + ' 导出失败：' + e, 5000); }
        i++;
        setTimeout(step, 700);   /* 🔴 浏览器连点下载会被拦，逐个来 */
      });
    };
    step();
  }

  /* ==================================================================
     导入产品资料（AI 截图识别结果 · JSON）
     ------------------------------------------------------------------
     用途：利用别的 AI 对产品截图做分析，得到结构化字段（4 个页签：
     基础SKU / SEO·命名 / 中英文描述 / 市场定位），把这批 JSON 导进目录，
     导出 Excel 时能直接用。**功能定位 = 数据来源之一，不是替代 Excel 主表。**

     JSON 格式（每个产品一条，可多产品）：
     {
       "book": "厨刀公开版",          // 可选，缺省用当前册
       "cat": "knives",              // 可选，缺省用当前册的cat
       "originalSku": "KL-CK-CHEF-001",   // 截图里的原编号，仅留痕
       "nameCn": "黑檀柄不锈钢西式厨师刀",
       "nameEn": "Professional Chef Knife Stainless Steel Black Wood Handle",
       "category": "Kitchen Knives",
       "material": "High Carbon Stainless Steel",
       "handle": "Black Pakkawood / Composite Wood",
       "bladeLen": "8 inch (20cm)",
       "overallLen": "33cm",
       "color": "Silver blade with matte black handle and silver rivets",
       "finish": "Satin / Brushed finish on blade",
       "texture": "Wood grain texture on handle",
       "styleDesc": "Classic Western professional chef knife with ergonomic handle",
       "seg": "SS",                       // 可选，缺省按材料/成套自动推断
       "isSet": false,
       "priceLo": 18, "priceHi": 45,       // 售价区间 → 取中位
       "msrpLo": 22, "msrpHi": 38,         // 建议零售价
       "moq": 100,
       "hTS": "8211.92.00",
       // 以下是电商上架字段（⚠️ 2026-10-06 起「Listing Details」sheet 已删，
       // 不再单独成表；但仍然解析并存在卡片的 xlsx 命名空间里，随时可恢复）
       "descEn": "...", "descCn": "...",
       "amazonTitle": "...", "bulletPoint": "...",
       "seoFile": "...jpg", "seoTitle": "...",
       "altEn": "...", "altCn": "...",
       "kwEn": "chef knife,professional kitchen knife",
       "kwCn": "厨师刀,西式主厨刀",
       "longTail": ["...","...", "..."],
       "positioning": "...", "targetMarket": "...",
       "usp": ["...","..."], "competitors": "Victorinox, Fibrox",
       "platforms": "Amazon, 独立站, 阿里巴巴",
       "imageDataUrl": "data:image/jpeg;base64,...."   // 白底图
     }

     ⚠️ 借值规则：截图没有的装箱字段（厚度/硬度/净重/箱规/CBM/装柜量等）
        **从现有卡片按「同段码」借实测值**，并打 `est:1` 标记。
        借不到就留空 —— 绝不编造。
     ================================================================== */

  /* 段码推断：优先用 JSON 里指定的 seg，否则按材料/成套特征判*/
  function inferSeg(o) {
    if (o.seg) return String(o.seg).toUpperCase();
    var mat = String(o.material || '') + ' ' + String(o.nameEn || '');
    if (o.isSet || /\bset\b|piece|block stand/i.test(String(o.nameEn || ''))) return 'SS';
    if (/damascus|pattern| Damascus/i.test(mat)) return 'DS';
    if (/hammer|forged|锤纹/i.test(mat)) return 'HM';
    return 'SS';
  }

  /* 借同段码的装箱实测值（从当前册已有卡片里找）
     🔴 2026-10-05 加 isSet：单刀与套刀装箱量差一个数量级（套刀 25 pcs/箱，
     单刀几十把一箱），混借会算错 LOGO 报价与 20GP/40GP 装载量。优先同段码同类型。*/
  function borrowPacking(cat, seg, isSet, skipSku) {
    var pool = [], poolAny = [];
    Object.keys(S.books || {}).forEach(function (bid) {
      (S.books[bid].cards || []).forEach(function (c) {
        if (c.sku === skipSku) return;
        if (kcSeg(c.sku) !== seg) return;
        var X = c.xlsx || {};
        var D = {};
        (c.rows || []).forEach(function (r) { D[r[0]] = r[1]; });
        if (X.thickness || D.Thickness) {
          var e = { X: X, D: D, sku: c.sku };
          poolAny.push(e);
          if (!!/^KL-[A-Z]{2}-SET-/.test(c.sku || '') === !!isSet) pool.push(e);
        }
      });
    });
    if (!pool.length) pool = poolAny;      /* 同类型没有就退到同段码任意 */
    if (!pool.length) return null;
    var num = function (v) { var m = v ? /-?\d+(?:\.\d+)?/.exec(String(v).replace(/,/g, '')) : null; return m ? Number(m[0]) : ''; };
    var txt = function (v) { return v ? String(v).trim() : ''; };
    return {
      thickness: txt(pool[0].X.thickness || pool[0].D.Thickness),
      hrc: txt(pool[0].X.hrc || pool[0].D.HRC),
      netWeight: txt(pool[0].X.netWeight || pool[0].D['Net Weight'] || pool[0].D['Wt · Thk · HRC']),
      pcsCarton: num(pool[0].X.pcsCarton || pool[0].D['Pcs / Carton'] || pool[0].D['Pcs · Carton']),
      cartonSize: txt(pool[0].X.cartonSize || pool[0].D['Carton Size (cm)']),
      cbm: num(pool[0].X.cbm || pool[0].D['CBM / Carton']),
      nw: num(pool[0].X.nwCarton || pool[0].D['N.W. / Carton']),
      gw: num(pool[0].X.gwCarton || pool[0].D['G.W. / Carton']),
      gpc20: num(pool[0].X.gpc20),
      gpc40: num(pool[0].X.gpc40),
      sampleLead: txt(pool[0].X.sampleLead),
      prodLead: txt(pool[0].X.prodLead),
      from: pool[0].sku,
      n: pool.length
    };
  }

  /* ==================================================================
     C. 两册对号自检 —— 公开版 ↔ 报价版 是否仍然同构
     🔴 2026-10-08 加。掉号的唯一条件就是两册卡片集合不同构
        （某次只导了一册、或某册里增删过卡）。这个面板把它一眼摊开：
        张数 / 段码计数 / SKU 差集 / 按产品名的「谁漏了」诊断。
     ================================================================== */
  function pairCheck() {
    var pairs = [];
    BOOKS.forEach(function (b) {
      if (b.withPrice) return;              /* 每对只以公开版为基准取一次 */
      var t = twinBook(b.id);
      if (t) pairs.push([b, t]);
    });
    if (!pairs.length) { toast('没有找到任何配对册（同品类公开/报价）', 4000); return; }

    var allOk = true, bad = 0;
    var h = '<p class="tips" style="margin:0 0 10px;line-height:1.7">' +
            '检查每个品类的 <b>公开版 ↔ 报价版</b> 是否仍然同构。' +
            '两册卡片集合一致 ⇒ 下次导入分配到的号必然配对；' +
            '<b>任何一边多/少，都会导致下次导入掉号。</b></p>';

    pairs.forEach(function (pr) {
      var pub = pr[0], quo = pr[1];
      var A = (S.books[pub.id] || {}).cards || [];
      var B = (S.books[quo.id] || {}).cards || [];
      var sa = {}, sb = {};
      A.forEach(function (c) { if (c.sku) sa[c.sku] = 1; });
      B.forEach(function (c) { if (c.sku) sb[c.sku] = 1; });
      var ksa = Object.keys(sa).sort(), ksb = Object.keys(sb).sort();
      var onlyA = ksa.filter(function (k) { return !sb[k]; });
      var onlyB = ksb.filter(function (k) { return !sa[k]; });
      /* 段码计数对照 */
      var segA = {}, segB = {};
      ksa.forEach(function (k) { var s = segKeyOf(k); segA[s] = (segA[s] || 0) + 1; });
      ksb.forEach(function (k) { var s = segKeyOf(k); segB[s] = (segB[s] || 0) + 1; });
      var segs = {};
      Object.keys(segA).concat(Object.keys(segB)).forEach(function (s) { segs[s] = 1; });
      var segDiff = Object.keys(segs).filter(function (s) {
        return (segA[s] || 0) !== (segB[s] || 0);
      }).sort();
      /* 按产品名比 —— 直接指出「哪个产品漏了 / 哪册多了一张」 */
      var origA = {}, origB = {};
      A.forEach(function (c) { var n = String(c.name || '').trim().toLowerCase(); if (n) origA[n] = String(c.name).trim(); });
      B.forEach(function (c) { var n = String(c.name || '').trim().toLowerCase(); if (n) origB[n] = String(c.name).trim(); });
      var nameOnlyA = Object.keys(origA).filter(function (k) { return !origB[k]; }).sort();
      var nameOnlyB = Object.keys(origB).filter(function (k) { return !origA[k]; }).sort();
      var dupA = A.length - ksa.length, dupB = B.length - ksb.length;
      var ok = !onlyA.length && !onlyB.length && !segDiff.length && !dupA && !dupB;
      if (!ok) { allOk = false; bad++; }

      h += '<h4 style="margin:16px 0 6px">' + esc(pub.cat) + ' · ' + (ok
        ? '<span style="color:#0F6E56">✓ 对齐</span>'
        : '<span style="color:#C62828">✗ 不同构</span>') + '</h4>';
      h += '<table class="rt"><thead><tr><th>册子</th><th>张数</th><th>只有这册有</th>' +
           '<th>重复 SKU</th></tr></thead><tbody>';
      h += '<tr><td>' + esc(pub.id) + '</td><td>' + A.length + '</td><td>' +
           (onlyA.length ? '<span style="color:#C62828">' + onlyA.length + ' 个</span>' : '—') +
           '</td><td>' + (dupA ? '<span style="color:#C62828">' + dupA + '</span>' : '—') + '</td></tr>';
      h += '<tr><td>' + esc(quo.id) + '</td><td>' + B.length + '</td><td>' +
           (onlyB.length ? '<span style="color:#C62828">' + onlyB.length + ' 个</span>' : '—') +
           '</td><td>' + (dupB ? '<span style="color:#C62828">' + dupB + '</span>' : '—') + '</td></tr>';
      h += '</tbody></table>';
      /* 段码计数 */
      h += '<table class="rt" style="margin-top:8px"><thead><tr><th>段码</th><th>' +
           esc(pub.id) + '</th><th>' + esc(quo.id) + '</th><th></th></tr></thead><tbody>';
      Object.keys(segs).sort().forEach(function (s) {
        var d = (segA[s] || 0) !== (segB[s] || 0);
        h += '<tr><td><code>' + esc(s) + '</code></td><td>' + (segA[s] || 0) + '</td><td>' +
             (segB[s] || 0) + '</td><td>' + (d ? '<span style="color:#C62828">✗ 不等</span>' : '') + '</td></tr>';
      });
      h += '</tbody></table>';
      /* 差集明细 */
      if (onlyA.length || onlyB.length) {
        h += '<div style="margin-top:8px;font-size:12px;line-height:1.9">';
        if (onlyA.length) h += '<b style="color:#C62828">只在' + esc(pub.id) + '：</b>' +
          onlyA.slice(0, 20).map(esc).join('、') + (onlyA.length > 20 ? ' …共 ' + onlyA.length + ' 个' : '') + '<br>';
        if (onlyB.length) h += '<b style="color:#C62828">只在' + esc(quo.id) + '：</b>' +
          onlyB.slice(0, 20).map(esc).join('、') + (onlyB.length > 20 ? ' …共 ' + onlyB.length + ' 个' : '') + '<br>';
        h += '</div>';
      }
      if (nameOnlyA.length || nameOnlyB.length) {
        h += '<div style="margin-top:8px;font-size:12px;line-height:1.9;color:#8A4B00">' +
             '<b>谁漏了（按产品名比）：</b><br>';
        if (nameOnlyA.length) h += '只在公开版：' +
          nameOnlyA.slice(0, 12).map(function (k) { return esc(origA[k]); }).join('、') +
          (nameOnlyA.length > 12 ? ' …共 ' + nameOnlyA.length + ' 个' : '') + '<br>';
        if (nameOnlyB.length) h += '只在报价版：' +
          nameOnlyB.slice(0, 12).map(function (k) { return esc(origB[k]); }).join('、') +
          (nameOnlyB.length > 12 ? ' …共 ' + nameOnlyB.length + ' 个' : '') + '<br>';
        h += '</div>';
      }
    });

    h += '<p style="margin-top:14px;font-size:12.5px;color:' +
         (allOk ? '#0F6E56' : '#C62828') + '">' + (allOk
           ? '✓ ' + pairs.length + ' 组配对册全部对齐，可以放心导入新产品。'
           : '✗ ' + bad + ' 组配对册不同构 —— 先按上面的清单补齐，再导入新产品，' +
             '否则新产品在两册会拿到不同的号。') + '</p>';

    modal('两册对号检查', h,
      '<button data-mc="1">关闭</button>' +
      '<button class="mbtn" data-fn="pcRefresh">重新检查</button>', true);
    MODALS.pcRefresh = function () { pairCheck(); };
  }

  function openImportJson() {
    var def = curDef();
    var h = '';
    h += '<h4>导入产品资料（JSON）</h4>';
    h += '<div class="tips" style="margin:8px 0 12px;line-height:1.9">' +
         '<b>用法</b>：点「📂 选择 .json 文件」直接选文件（<b>推荐，不用打开也不用复制</b>），' +
         '读完自动解析；也可以把 JSON 内容直接粘进下面的框。<br>' +
         '文件内容是<b>单个产品对象</b>或<b>数组</b>（多产品）都支持。<br>' +
         '<b>会自动做的事</b>：分配 SKU（该册该段码的<b>第一个空号</b>）、' +
         '截图没有的装箱字段按<b>同段码</b>借现有实测值并标 <code>est</code>、白底图入库做首图。' +
         '</div>';
    h += '<div class="fld"><label>目标册子</label><select id="impBook">' +
         BOOKS.map(function (b) {
           return '<option value="' + esc(b.id) + '"' + (b.id === S.book ? ' selected' : '') + '>' +
                  esc(b.id) + '（当前 ' + (S.books[b.id].cards.length) + ' 张）</option>';
         }).join('') + '</select></div>';
    /* 🔴 2026-10-08 加「同时导入同品类的另一册」：
       一次导入只写一册是代码写死的，所以公开版/报价版本来必须导两次。
       勾上后一次写两册 —— 两册段码计数相等 ⇒ 号自动配对，从机制上杜绝
       「只导一册 → 下次导入掉号」。 */
    h += '<div class="fld" id="impTwinWrap"></div>';
    /* 🔴 2026-10-05 加「选 JSON 文件」入口（利：「我打不开这个 json 文件」）
       —— 双击 .json 会用编辑器打开、看不懂也复制不出来，粘贴框等于没用。
       两条路并存：选文件（一键，推荐）/ 手动粘贴（临时改一行时用）。 */
    h += '<div class="fld"><label>选JSON 文件（推荐）</label>' +
         '<div style="display:flex;gap:8px;align-items:center">' +
         '<button class="mbtn" id="impPick" style="padding:7px 14px">📂 选择 .json 文件</button>' +
         '<span id="impFile" style="font-size:11.5px;color:var(--mute)">未选择</span>' +
         '</div></div>';
    h += '<div class="fld"><label>或直接粘贴 JSON</label>' +
         '<textarea id="impJson" rows="10" spellcheck="false" ' +
         'style="width:100%;font:11px/1.5 Consolas,monospace;padding:8px;' +
         'border:1px solid var(--line);border-radius:4px" ' +
         'placeholder=\'{"nameEn":"Professional Chef Knife...","material":"High Carbon Stainless Steel","moq":100}\'></textarea></div>';
    h += '<div id="impPrev"></div>';
    h += '<div class="tips" style="font-size:11px;color:var(--mute)">' +
         '当前册品类：<code>' + esc(def.cat) + '</code>　·　' +
         '段码提示：SS=高碳不锈钢 / DS=大马士革 / HM=锤纹 / SET-SS=套刀' +
         '</div>';
    modal('导入产品资料', h,
      '<button data-mc="1">取消</button>' +
      '<button class="mbtn" data-fn="impParse">解析并预览</button>' +
      '<button class="pri" data-fn="impGo">确认导入</button>', true);

    var parsed = null;
    var picked = false;      /* 是否已从文件读入 */

    /* 配对册勾选框：随「目标册子」下拉实时刷新。
       没有配对册（该品类只有一本）时禁用并说明，避免用户以为勾了却没用。 */
    function renderTwin() {
      var w = $('impTwinWrap');
      if (!w) return;
      var tw = twinBook($('impBook').value);
      w.innerHTML = '<label>导入范围</label>' +
        '<label style="display:flex;align-items:flex-start;gap:7px;font-size:12.5px;' +
        'cursor:' + (tw ? 'pointer' : 'default') + ';line-height:1.6">' +
        '<input type="checkbox" id="impTwin" style="margin-top:3px"' +
        (tw ? ' checked' : ' disabled') + '>' +
        '<span>' + (tw
          ? '同时导入同品类的另一册：<code>' + esc(tw.id) + '</code>' +
            '<br><span style="color:var(--mute);font-size:11.5px">' +
            '两册段码计数相等 ⇒ SKU 自动配对同号；不勾就只导本册</span>'
          : '<span style="color:#B26A00">该品类没有配对册（只有这一本），只能导入本册</span>') +
        '</span></label>';
    }
    if ($('impBook')) $('impBook').addEventListener('change', renderTwin);
    renderTwin();

    /* 当前是否要同步到配对册；返回配对册 id（不需要时 null） */
    function twinTarget(bookId) {
      var cb = $('impTwin');
      if (!cb || !cb.checked || cb.disabled) return null;
      var t = twinBook(bookId);
      return t ? t.id : null;
    }

    /* 选文件：读进 textarea，之后「解析并预览」直接用它 */
    if ($('impPick')) {
      $('impPick').addEventListener('click', function () {
        var f = document.createElement('input');
        f.type = 'file';
        f.accept = '.json,application/json,text/plain';
        f.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(f);
        f.addEventListener('change', function () {
          var file = f.files && f.files[0];
          setTimeout(function () { try { f.remove(); } catch (e) { } }, 0);
          if (!file) return;
          var fr = new FileReader();
          fr.onload = function () {
            $('impJson').value = String(fr.result || '');
            $('impFile').textContent = '已读入：' + file.name + '（' +
              Math.round(file.size / 1024) + ' KB）';
            picked = true;
            MODALS.impParse();          /* 读完直接解析，省一次点击 */
          };
          fr.onerror = function () { toast('文件读取失败', 4000); };
          fr.readAsText(file, 'utf-8');
        });
        f.click();
      });
    }

    MODALS.impParse = function () {
      var txt = ($('impJson').value || '').trim();
      if (!txt) { toast(picked ? '文件是空的' : '请先选 json 文件，或直接粘贴 JSON', 4000); return; }
      try {
        var j = JSON.parse(txt);
        parsed = Array.isArray(j) ? j : [j];
      } catch (e) {
        toast('JSON 解析失败：' + e.message, 6000);
        return;
      }
      /* 预览表 */
      var bookId = $('impBook').value;
      var d2 = bookDef(bookId);
      /* 是否同步到配对册（勾选框实时读） */
      var twinId = twinTarget(bookId);
      /* 🔴 一次导入多个产品时必须**逐个递增**（原来直接 base.seq + i，
         若一批里有 3 个同段码的，第 2 个就会撞上已有号 → impGo 里被"跳过重名"
         静默丢弃，用户以为导进去了其实没有）。这里按 段码 分组各自计数。 */
      var seqPool = {};
      /* 配对册独立计数：它自己的卡片集合决定自己的号（两册应同构 ⇒ 号相同） */
      var seqPoolT = {};
      var rows = parsed.map(function (o, i) {
        var seg = inferSeg(o);
        var isSet = !!o.isSet;
        var key = (isSet ? 'SET-' : '') + seg;
        var base = nextSegNo(d2.cat, seg, isSet, bookId);
        var cur = seqPool[key] = (seqPool[key] == null ? base.seq : seqPool[key] + 1);
        var sku = base.pre + pad3(cur);
        var skuT = '';
        if (twinId) {
          var baseT = nextSegNo(d2.cat, seg, isSet, twinId);
          var curT = seqPoolT[key] = (seqPoolT[key] == null ? baseT.seq : seqPoolT[key] + 1);
          skuT = baseT.pre + pad3(curT);
        }
        var mid = priceMid(o);
        return { i: i, o: o, sku: sku, seg: seg, skuT: skuT,
                 name: o.nameEn || o.nameCn || '(无名称)',
                 mid: mid, moq: o.moq || '',
                 hasImg: !!o.imageDataUrl };
      });
      var twinDef = twinId ? bookDef(twinId) : null;
      var h2 = '<h4 style="margin-top:14px">待导入 ' + rows.length + ' 个产品' +
               (twinId ? '（同步到 <code>' + esc(twinId) + '</code>）' : '') + '</h4>';
      if (twinId) {
        var mis = rows.filter(function (r) { return r.skuT && r.skuT !== r.sku; }).length;
        h2 += '<div class="tips" style="margin:6px 0 8px;font-size:11.5px;' +
              (mis ? 'color:#C62828;border-color:#F0B9B9;background:#FDF3F3' : '') + '">' +
              (mis
                ? '⚠ 有 ' + mis + ' 个产品在两册分配到的号<b>不一致</b>（下方红字）——' +
                  '说明两册卡片集合已不同构，导入后会掉号。建议先点顶部「两册对号」查清。'
                : '✓ 两册同构：将生成<b>配对同号</b>的 SKU（一册公开、一册含报价）。') +
              '</div>';
      }
      h2 += '<table class="rt"><thead><tr><th>#</th><th>将生成 SKU' +
            (twinId ? '（本册 ↔ ' + esc(twinId) + '）' : '') + '</th><th>产品名</th>' +
            '<th>段码</th><th>FOB 中位</th><th>MOQ</th><th>首图</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        var skuCell = '<code>' + esc(r.sku) + '</code>';
        if (twinId) {
          skuCell += r.skuT === r.sku
            ? '<br><span style="color:#0F6E56;font-size:11px">↔ ' + esc(r.skuT) + '</span>'
            : '<br><span style="color:#C62828;font-size:11px">⚠ ' + esc(r.skuT) + '</span>';
        }
        h2 += '<tr><td>' + (r.i + 1) + '</td><td>' + skuCell + '</td>' +
              '<td>' + esc(r.name) + '</td><td>' + esc(r.seg) + '</td>' +
              '<td>' + (r.mid ? ('$' + r.mid + (r.o.priceLo !== r.o.priceHi ? ' est' : '')) : '—') + '</td>' +
              '<td>' + (r.moq || '—') + '</td>' +
              '<td>' + (r.hasImg ? '有' : '<span style="color:#C62828">缺</span>') + '</td></tr>';
      });
      h2 += '</tbody></table>';
      h2 += '<div style="font-size:11px;color:var(--mute);margin-top:6px">' +
            '标 <code>est</code> 的是从售价区间推算或借来的值，报价前请核定。</div>';
      $('impPrev').innerHTML = h2;
      MODALS._rows = rows;
      MODALS._book = bookId;
      MODALS._twinId = twinId;
      toast('解析成功：' + rows.length + ' 个产品待导入' + (twinId ? '（含配对册）' : ''));
    };

    MODALS.impGo = function () {
      var rows = MODALS._rows;
      if (!rows || !rows.length) { toast('先点「解析并预览」'); return; }
      var bookId = MODALS._book || $('impBook').value;
      /* 🔴 2026-10-08：勾了「同时导入同品类另一册」就一次写两册。
         公开版写 price:null、报价版写 FOB 价块（由各自 bookDef.withPrice 决定），
         两册段码计数相等 ⇒ 分配到的号相同 ⇒ 天然配对。
         目标册永远先写（r.sku），配对册用 r.skuT。 */
      var twinId = MODALS._twinId || null;
      var targets = [{ id: bookId, skuOf: function (r) { return r.sku; } }];
      if (twinId && twinId !== bookId) {
        targets.push({ id: twinId, skuOf: function (r) { return r.skuT || r.sku; } });
      }
      var added = 0, addedBy = {}, dupSkipped = [], mainSku = '';
      rows.forEach(function (r) {
        var o = r.o, seg = r.seg;
        /* 白底图 → IndexedDB：**每行只入库一次**，两册共用同一个 key
           （本技能产出的 JSON 本就不含图，用户手动插图，这里是兜底路径） */
        var imgKey = '', imgPut = null, imgBytes = 0;
        if (o.imageDataUrl) {
          try {
            var byte = dataUrlToBytes(o.imageDataUrl);
            imgKey = uid('img'); imgBytes = byte.length;
            var imgBlobObj = new Blob([byte],
              { type: o.imageDataUrl.slice(5, o.imageDataUrl.indexOf(';')) });
            imgPut = IDB.put(imgKey, imgBlobObj);
            cloudPutImg(imgKey, imgBlobObj);   /* ☁️ 批量导入的图也要上云 */
          } catch (e) { imgKey = ''; }
        }
        targets.forEach(function (tg, ti) {
          var list = S.books[tg.id].cards;
          var sku = tg.skuOf(r);
          /* 重名不再静默丢弃：原来直接 return，用户看到「已导入 N 个」以为全进去了。
             改成记账 + 结束时报出来。*/
          if (list.some(function (c) { return c.sku === sku; })) {
            dupSkipped.push(tg.id + ' ' + sku); return;
          }
          var def = bookDef(tg.id);
          var bp = borrowPacking(def.cat, seg, o.isSet, sku);
          /* 规格行：材料/柄材/长度/表面工艺/颜色/装箱（借来的标 est） */
          var est = bp ? ' (est)' : '';
          var rowsSpec = [
            ['Material', o.material || ''],
            ['Handle Material', o.handle || ''],
            ['Finish', o.finish || ''],
            ['Blade', o.bladeLen || ''],
            ['Overall', o.overallLen || ''],
            ['Color', o.color || ''],
            ['Texture', o.texture || ''],
            ['Style', o.styleDesc || ''],
            ['Wt · Thk · HRC', [o.netWeight, bp && bp.thickness, bp && bp.hrc].filter(Boolean).join(' · ') + est],
            ['Pcs · Carton', [bp && bp.pcsCarton, bp && bp.cartonSize].filter(Boolean).join(' · ') + est],
            ['N.W. / G.W.', [bp && bp.nw, bp && bp.gw].filter(Boolean).join(' / ') + est],
            ['MOQ · Load', [(o.moq || (bp && bp.moq) || ''), bp && bp.gpc20, bp && bp.gpc40].filter(Boolean).join(' · ')]
          ];
          rowsSpec = rowsSpec.filter(function (x) { return String(x[1]).trim() !== ''; });
          if (!rowsSpec.length) rowsSpec = [['Material', '']];
          var mid = priceMid(o);
          var card = {
            sku: sku, name: o.nameEn || o.nameCn || '', cat: def.cat,
            img: '', rows: rowsSpec, xlsx: buildXlsxFromJson(o, bp, mid),
            price: def.withPrice
              ? { fob: mid ? mid.toFixed(2) : '', est: 1,
                   t1: mid ? (mid * 0.94).toFixed(2) : '',
                   t2: mid ? (mid * 0.88).toFixed(2) : '',
                   hts: o.hTS || guessHts(def.cat, seg),
                   lead: (bp && bp.prodLead) || '30–45 days' }
              : null
          };
          list.push(card);
          added++;
          addedBy[tg.id] = (addedBy[tg.id] || 0) + 1;
          if (ti === 0 && !mainSku) mainSku = sku;
          /* 两册共用同一个 IndexedDB key ⇒ 只在写入成功后挂上 */
          if (imgKey && imgPut) {
            (function (c, k, n) {
              imgPut.then(function () { c.img = 'idb:' + k; c.imgSize = (n / 1024).toFixed(0) + ' KB'; })
                    .catch(function () { });
            })(card, imgKey, imgBytes);
          }
        });
      });
      closeModal();
      S.book = bookId; S.sel = Math.max(0, S.books[bookId].cards.length - 1);
      renderAll(); markDirty();
      /* 🔴 同步导入会改到配对册 —— markDirty 只（延迟 700ms）保存当前册，
         另一册根本不会存。一次批量写两册，**两册都立即落盘**，
         否则「导完立刻关标签页」会丢掉其中一半（实测：只有当前册被写进 localStorage）。 */
      saveBook(bookId);
      if (twinId && addedBy[twinId]) saveBook(twinId);
      var parts = Object.keys(addedBy).map(function (bid) { return bid + ' ' + addedBy[bid] + ' 张'; });
      if (added) {
        toast('已导入 ' + parts.join(' + ') + (mainSku ? ' · SKU ' + mainSku : ''),
          targets.length > 1 ? 7000 : 3600);
      } else {
        toast('0 个导入：SKU 已存在（' + dupSkipped.join('、') + '）', 5000);
      }
      if (dupSkipped.length) {
        setTimeout(function () {
          toast('跳过重名 ' + dupSkipped.length + ' 个：' + dupSkipped.join('、') +
                '。如需覆盖，先在左侧删掉同名卡片。', 7000);
        }, 300);
      }
    };
  }

  /* data:image/...;base64,xxxx → Uint8Array */
  function dataUrlToBytes(u) {
    var i = String(u).indexOf(',');
    if (i < 0) return new Uint8Array(0);
    var b64 = String(u).slice(i + 1);
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return out;
  }

  /* 售价区间取中位数 */
  function priceMid(o) {
    var lo = numOf(o.priceLo), hi = numOf(o.priceHi);
    if (lo === '' && hi === '') return '';
    if (lo === '') return hi;
    if (hi === '') return lo;
    return (Number(lo) + Number(hi)) / 2;
  }
  function msrpMid(o) {
    var lo = numOf(o.msrpLo), hi = numOf(o.msrpHi);
    if (lo === '' && hi === '') return '';
    if (lo === '') return hi;
    if (hi === '') return lo;
    return (Number(lo) + Number(hi)) / 2;
  }
  function guessHts(cat, seg) {
    if (cat === 'scissors') return '8213.00.00';
    if (cat === 'outdoor') return '8211.92.00';
    if (cat === 'accessories') return '8215.99.00';
    return '8211.92.00';
  }
  /* 该「品类+段码」序列的下一个可用序号。
     🔴 2026-10-05 修正（原来全局扫所有册取 max → 厨刀导 HM 刀拿到户外的 48，
     分配出 KL-KN-HM-049）。实测真实规则：**每个 段码 独立连续编号**，实测数据
       KN-DS 001–019 / KN-SS 001–020 / KN-HC 001–002 / KN-HM 001–005
       KN-SET-SS 001–035 / KN-SET-DC 001–029
     所以必须按前缀精确取 max，且**只看目标册自己**：公开版与报价版是两个独立
     副本，从同一个"段内第一个空号"起算 → 同一份 JSON 导进两册会拿到同一个号，
     两册自然配对（若把同 cat 另一册也算进已用，先导公开版会让报价版跳号）。*/
  function nextSegNo(cat, seg, isSet, bookId) {
    var catCode = ({ knives: 'KN', scissors: 'SC', accessories: 'KA', outdoor: 'OD' })[cat] || 'KN';
    var pre = 'KL-' + catCode + '-' + (isSet ? 'SET-' : '') + String(seg || 'SS').toUpperCase() + '-';
    var used = {};
    ((S.books[bookId] || {}).cards || []).forEach(function (c) {
      var s = String(c.sku || '');
      if (s.indexOf(pre) !== 0) return;
      var n = parseInt(s.slice(pre.length), 10);
      if (n > 0) used[n] = 1;
    });
    /* 从 1 起找第一个空号：段内连续，补号安全 */
    var n = 1;
    while (used[n]) n++;
    return { seq: n, pre: pre };
  }
  /* 截图独有字段 → xlsx 命名空间。
     ⚠️ 2026-10-06 起这些字段**不再单独成 sheet**（Listing Details 已删），
     仍继续解析保存，方便以后恢复或给内部用。 */
  function buildXlsxFromJson(o, bp, mid) {
    var m = msrpMid(o);
    return {
      color: o.color || '', cbm: (bp && bp.cbm) || '', cert: o.cert || '',
      oem: o.oem || 'Available', barcode: o.barcode || '',
      msrp: m ? String(m) : '', gpc20: (bp && bp.gpc20) || '', gpc40: (bp && bp.gpc40) || '',
      sampleLead: (bp && bp.sampleLead) || '', prodLead: (bp && bp.prodLead) || '',
      bladeLen: o.bladeLen || '', sizeOverall: o.overallLen || '',
      netWeight: o.netWeight || '', pcsCarton: (bp && bp.pcsCarton) || '',
      cartonSize: (bp && bp.cartonSize) || '', nwCarton: (bp && bp.nw) || '',
      gwCarton: (bp && bp.gw) || '', thickness: (bp && bp.thickness) || '',
      hrc: (bp && bp.hrc) || '', finish: o.finish || '', handle: o.handle || '',
      /* ---- 截图独有：Listing Details ---- */
      nameCn: o.nameCn || '', descEn: o.descEn || '', descCn: o.descCn || '',
      amazonTitle: o.amazonTitle || '', bulletPoint: o.bulletPoint || '',
      seoFile: o.seoFile || '', seoTitle: o.seoTitle || '',
      altEn: o.altEn || '', altCn: o.altCn || '',
      kwEn: o.kwEn || '', kwCn: o.kwCn || '',
      longTail: (o.longTail || []).join(' | '),
      positioning: o.positioning || '', targetMarket: o.targetMarket || '',
      usp: (o.usp || []).join(' | '), competitors: o.competitors || '',
      platforms: o.platforms || '',
      originalSku: o.originalSku || '',
      styleDesc: o.styleDesc || '', texture: o.texture || '',
      borrowFrom: (bp && bp.from) || ''
    };
  }

  function exportCurrent() {
    if (S.exporting) { toast('正在导出，请稍候'); return; }
    save();
    doExport(S.book);
  }

  function exportAll() {
    if (S.exporting) { toast('正在导出，请稍候'); return; }
    save();
    var list = BOOKS.slice();
    modal('导出全部 ' + list.length + ' 本',
      '<p>将<b>依次</b>弹出 ' + list.length + ' 次打印窗口（每次选「另存为 PDF」并起不同文件名）：</p>' +
      '<div style="max-height:300px;overflow:auto;margin:8px 0"><table class="rt"><thead><tr>' +
      '<th>#</th><th>册子</th><th>张数</th><th>文件名</th></tr></thead><tbody>' +
      list.map(function (b, n) {
        return '<tr><td>' + (n + 1) + '</td><td>' + esc(b.id) + '</td><td>' +
          S.books[b.id].cards.length + '</td><td><code>' + esc(b.file) + '.pdf</code></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p style="color:var(--faint);font-size:11.5px">关掉一个打印窗口才会弹下一个，' +
      '请不要一次取消整批。建议先把每本的文件名改好再存。</p>',
      '<button data-mc="1">取消</button><button class="pri" data-fn="doAll">开始导出</button>', true);
  }
  MODALS.doAll = function () {
    closeModal();
    var i = 0;
    var step = function () {
      if (i >= list.length) { toast(list.length + ' 本全部导出完成'); return; }
      var b = list[i];
      toast('导出第 ' + (i + 1) + '/' + list.length + ' 本：' + b.id, 6000);
      S.book = b.id;
      renderAll();
      i++;
      doExport(b.id, function () { setTimeout(step, 900); });
    };
    step();
  };

  /* ==================================================================
     帮助
     ================================================================== */
  MODALS.help = function () {
    var h = '<h4>这个程序做什么</h4>' +
      '<p>把 Excel 主表里 ' + BOOKS.reduce(function (a, b) { return a + S.books[b.id].cards.length / 2; }, 0) +
      ' 个 SKU，按 4 个品类 + 户外刀搬进一个可编辑界面，改完直接导出 PDF。以后加新产品不用再让我重跑脚本。</p>';
    h += '<h4>册子（' + BOOKS.length + ' 个功能栏）</h4><ul>';
    BOOKS.forEach(function (b) {
      h += '<li><b>' + esc(b.id) + '</b> — ' + S.books[b.id].cards.length + ' 张 · ' +
           (b.withPrice ? '带 FOB 报价' : '无报价（发客户看款）') + '</li>';
    });
    h += '</ul><p style="color:var(--faint);font-size:11.5px">各本<b>完全独立</b>：改公开版不影响报价版。' +
      '顶栏点书名切换。</p>';
    h += '<h4>公开版 / 报价版怎么加新产品</h4>' +
      '<p>每本册子<b>自带一份卡片</b>，所以同一个新产品要分别在公开版、报价版各出现一次。' +
      '顶栏「导入」里勾上 <b>「同时导入同品类的另一册」</b>，一次就写两册、' +
      'SKU 自动配对同号（公开版不带价、报价版带 FOB 两档价）。<br>' +
      '顶栏「<b>两册对号</b>」可随时检查两册是否仍同构 —— ' +
      '任何一边多/少，都会让下次导入掉号（同一产品在两册拿到不同编号）。</p>';
    h += '<h4>规格校准</h4>' +
      '<p>顶栏「📋 校准报告」能看：<b>173 条已改</b>（每条带实测依据）+ <b>50 条待实测</b>（<b>未改动</b>）。' +
      '编辑器里带 <span class="badge">待实测</span> 的卡片，编辑区顶部有黄色提示条。</p>';
    h += '<h4>产品图</h4><ul>' +
      '<li><b>内置图库</b>（' + (LIB ? LIB.total : '…') + ' 张）= 已进目录的原图，相对路径直读</li>' +
      '<li><b>H 盘候选</b> = H:/上品sku 里同名 SKU 文件夹的图，' +
      '按「像素 + 内容合理性（排除表格截图/局部特写）」自动挑前 6 张</li>' +
      '<li><b>本地上传</b> = 存进浏览器 IndexedDB 原始 Blob，<b>不压缩</b></li></ul>';
    h += '<h4>导出 PDF</h4><ul>' +
      '<li>顶栏「⤓ 导出 PDF」= 只导当前这一本</li>' +
      '<li>「⤓ 导出全部」= 依次弹 ' + BOOKS.length + ' 次打印窗口</li>' +
      '<li>打印窗口目标选<b>「另存为 PDF」</b>，纸张 A4，<b>边距「无」</b>，勾上「背景图形」</li></ul>';
    h += '<h4>快捷键</h4><p><span class="kbd">Ctrl+Z</span> 撤销 · ' +
      '<span class="kbd">Ctrl+Y</span> 重做 · <span class="kbd">Ctrl+S</span> 立即保存 · ' +
      '<span class="kbd">Ctrl+P</span> 导出</p>';
    h += '<h4>数据安全</h4><p>改动自动存在本机浏览器里。换电脑或清缓存前，请用顶栏「备份 JSON」导一份。</p>';
    modal('使用说明', h, '<button class="pri" data-mc="1">开始用</button>', true);
  };

  /* ==================================================================
     顶栏 / 全局事件
     ================================================================== */
  function bindTop() {
    $('bookbar').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.book') : null;
      if (!b) return;
      flushPendingEdit();
      S.book = b.getAttribute('data-book');
      S.sel = 0; S.q = ''; $('lsearch').value = '';
      renderAll(); save();
    });

    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnCalib').addEventListener('click', openCalib);
    $('btnBulk').addEventListener('click', openBulk);
    $('btnPaste').addEventListener('click', openImportJson);
    $('btnExport').addEventListener('click', exportCurrent);
    $('btnXlsx').addEventListener('click', function () { previewXlsx(S.book); });
    $('btnExportAll').addEventListener('click', exportAll);

    $('lsearch').addEventListener('input', function () { S.q = this.value; renderList(); });
    $('lbody').addEventListener('click', function (e) {
      var it = e.target.closest ? e.target.closest('.litem') : null;
      if (!it) return;
      flushPendingEdit();
      S.sel = +it.getAttribute('data-i');
      renderList(); renderEditor(); renderPreview();
    });
    /* ---- 名片列表拖拽排序（2026-10-05）
       拖动的是**数据层顺序**，会同步影响 PDF 产品页顺序与 Excel 行顺序。
       ⚠️ 有搜索过滤时**禁用拖拽** —— 过滤后的下标与真实顺序对不上，
          拖了就会把卡片放错位置。 */
    (function bindDnd() {
      var box = $('lbody'), dragFrom = -1, dragTo = -1;
      box.addEventListener('dragstart', function (e) {
        var it = e.target.closest ? e.target.closest('.litem') : null;
        if (!it) return;
        if (S.q.trim()) {           /* 过滤中 → 禁止 */
          e.preventDefault();
          toast('搜索状态下不能拖动排序，请先清空搜索框', 4000);
          return;
        }
        dragFrom = +it.getAttribute('data-i');
        it.classList.add('dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (err) { }
      });
      box.addEventListener('dragover', function (e) {
        if (dragFrom < 0) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) { }
        var it = e.target.closest ? e.target.closest('.litem') : null;
        if (!it) return;
        dragTo = +it.getAttribute('data-i');
        var r = it.getBoundingClientRect();
        var after = (e.clientY - r.top) > r.height / 2;
        box.querySelectorAll('.litem').forEach(function (x) { x.classList.remove('dropbefore', 'dropafter'); });
        it.classList.add(after ? 'dropafter' : 'dropbefore');
      });
      box.addEventListener('drop', function (e) {
        e.preventDefault();
        var it = e.target.closest ? e.target.closest('.litem') : null;
        box.querySelectorAll('.litem').forEach(function (x) { x.classList.remove('dropbefore', 'dropafter'); });
        if (!it || dragFrom < 0) return;
        var to = +it.getAttribute('data-i');
        var after = it.classList.contains('dropafter');
        moveItem(dragFrom, to, after);
        dragFrom = -1; dragTo = -1;
      });
      box.addEventListener('dragend', function () {
        box.querySelectorAll('.litem').forEach(function (x) {
          x.classList.remove('dragging', 'dropbefore', 'dropafter');
        });
        dragFrom = -1;
      });
    })();

    $('btnAdd').addEventListener('click', addCard);
    $('btnDup').addEventListener('click', dupCard);
    $('btnDel').addEventListener('click', delCard);

    $('btnMoveUp').addEventListener('click', function () { move(-1); });
    $('btnMoveDn').addEventListener('click', function () { move(1); });
    $('btnRestore').addEventListener('click', restoreOrder);
    $('btnDel2').addEventListener('click', delCard);
    $('btnImgFromLib').addEventListener('click', openLib);

    $('pvScale').addEventListener('change', function () {
      S.pvScale = parseFloat(this.value) || 0.38;
      renderPreview();
    });

    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); e.shiftKey ? redo() : undo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); toast('已保存'); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); exportCurrent(); return; }
      if (typing) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); flushPendingEdit();
        S.sel = Math.min(cards().length - 1, S.sel + 1);
        renderList(); renderEditor(); renderPreview(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); flushPendingEdit();
        S.sel = Math.max(0, S.sel - 1);
        renderList(); renderEditor(); renderPreview(); }
    });

    window.addEventListener('beforeunload', function () {
      flushPendingEdit();
      if ($('saveDot').className.indexOf('dirty') >= 0) save();
    });
  }

  function injectTopTools() {
    var anchor = $('btnCalib');
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:6px;margin-left:12px;padding-left:12px;' +
      'border-left:1px solid rgba(255,255,255,.16)';
    var items = [
      { id: 'btnLib', t: '图库', fn: function () { openLib(); } },
      { id: 'btnPair', t: '两册对号', fn: pairCheck },
      { id: 'btnBackup', t: '备份 JSON', fn: exportJson },
      { id: 'btnImport', t: '恢复备份', fn: importJson },
      { id: 'btnHelp', t: '?', fn: function () { MODALS.help(); } }
    ];
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.className = 'tbtn'; b.id = it.id; b.textContent = it.t;
      if (it.id === 'btnHelp') b.style.cssText = 'width:30px;padding:6px 0;text-align:center';
      b.addEventListener('click', it.fn);
      wrap.appendChild(b);
    });
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
  }

  var PV_CSS =
'.pvbox{position:relative;overflow:hidden}' +
'.pvbox .scaler{width:210mm}' +
'.pvbox .page{width:210mm;height:297mm;padding:12mm 13mm 10mm;position:relative;' +
'overflow:hidden;background:#fff;display:flex;flex-direction:column;' +
'border-bottom:1px dashed #C6CFD9}' +
'.pvbox .ph{display:flex;align-items:baseline;justify-content:space-between;' +
'border-bottom:.6mm solid #C8A24B;padding-bottom:1.4mm;margin-bottom:3.4mm;flex:0 0 auto}' +
'.pvbox .ph .t{font-size:10.5pt;font-weight:700;color:#1B2A41}' +
'.pvbox .ph .t .cn{font-weight:400;color:#5C6B7A;font-size:9pt;margin-left:2mm}' +
'.pvbox .ph .r{font-size:7pt;color:#5C6B7A;letter-spacing:.06em}' +
'.pvbox .grid{display:flex;flex-direction:column;gap:4mm;flex:1 1 auto;min-height:0}' +
'.pvbox .grid .grow{display:flex;gap:4.6mm;flex:1 1 0;min-height:0}' +
'.pvbox .grid .grow > .card{flex:0 0 calc((100% - 9.2mm) / 3);min-width:0}' +
'.pvbox .card{border:.25mm solid #DDE3E9;border-radius:1.2mm;padding:1.5mm 2mm 1.8mm;' +
'display:flex;flex-direction:column;overflow:hidden;background:#fff;min-height:0;height:100%}' +
'.pvbox .card .imgbox{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center}' +
'.pvbox .card .imgbox img{max-width:46mm;max-height:100%;width:auto;height:auto;object-fit:contain}' +
'.pvbox .card .imgbox .ph{color:#C6CFD9;font-size:7pt;text-align:center;padding:6mm 2mm;' +
'border:.2mm dashed #DDE3E9;border-radius:1mm;width:80%}' +
'.pvbox .sku{flex:0 0 auto;height:3.2mm;font-family:Consolas,monospace;font-size:6.2pt;' +
'font-weight:700;color:#8A6A16;letter-spacing:.03em;padding-top:.6mm}' +
'.pvbox .nm{flex:0 0 auto;min-height:6.6mm;max-height:9.9mm;font-size:7pt;font-weight:700;' +
'line-height:1.2;overflow:hidden;margin-bottom:.8mm;color:#1B2A41;' +
'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}' +
'.pvbox .specwrap{flex:0 0 auto;height:25mm;overflow:hidden}' +
'.pvbox table.spec{width:100%;border-collapse:collapse;font-size:5.5pt;line-height:1.45}' +
'.pvbox table.spec td{padding:0;vertical-align:top}' +
'.pvbox table.spec td.k{color:#5C6B7A;white-space:nowrap;padding-right:1.2mm;width:16mm}' +
'.pvbox table.spec td.v{color:#1B2A41}' +
'.pvbox .pricebox{flex:0 0 auto;height:7mm;margin-top:.8mm;padding-top:.9mm;' +
'border-top:.25mm solid #DDE3E9;font-size:5.8pt;line-height:1.5;overflow:hidden;color:#5C6B7A}' +
'.pvbox .pricebox .fob{font-weight:700;color:#8A6A16}' +
'.pvbox .pricebox .sub{color:#5C6B7A}' +
'.pvbox .foot{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;' +
'margin-top:2.6mm;padding-top:1.2mm;font-size:6pt;color:#5C6B7A}';

  function injectPvCss() {
    var st = document.createElement('style');
    st.textContent = PV_CSS;
    document.head.appendChild(st);
  }

  /* ==================================================================
     启动
     ================================================================== */
  function fail(msg, detail) {
    /* 失败页要能一眼看出**是哪一环坏了、怎么修**。
       原版把真实原因塞在 <small> 里（默认 13px 灰色），
       在整屏白底上几乎看不见 —— 实测利看到的就是「只有标题 + 三行通用建议」，
       真正的原因（变量名写错）看不清，等于没给线索。 */
    document.body.innerHTML =
      '<div style="padding:48px 60px;font:15px/1.9 \'Segoe UI\',Arial,sans-serif;color:#1B2A41;' +
      'max-width:900px">' +
      '<div style="font-size:22px;font-weight:800;color:#C0392B;margin-bottom:18px">' +
      '⚠ ' + esc(msg) + '</div>' +
      (detail || '') +
      '<hr style="border:0;border-top:1px solid #E3E8ED;margin:26px 0 16px">' +
      '<div style="font-size:13px;color:#5C6B7A;line-height:1.8">' +
      '<b>快速排查：</b><br>' +
      '1. 确认 <code>产品目录编辑器\\data\\</code> 里有 <code>kc-' + DATA_TOKEN + '.json</code>（线上加密版）' +
      '或 <code>catalog.json</code>（源目录明文版）<br>' +
      '2. 确认同名的 <code>.js</code> 退路存在，且首行是 ' +
      '<code>window.KC_CATALOG = ' + '{' + '</code><br>' +
      '3. 在项目根目录运行 <code>python _gen_data_v2.py</code> 或 ' +
      '<code>python _kcdata.py</code>（后者会重新生成并自检）' +
      '</div></div>';
  }

  function init() {
    injectPvCss();
    injectTopTools();
    $('brandLogo').src = DATA.brand.logo || 'logo.png';
    $('brandName').textContent = DATA.brand.name || 'KaiLionCrafts';
    $('brandSub').textContent = 'Product Catalog Editor v2 · ' + BOOKS.length + ' 册';
    S.pvScale = parseFloat($('pvScale').value) || 0.38;
    bindTop();
    bindEditor();
    renderAll();
    setTimeout(function () {
      var host = $('pvBody');
      host.scrollTop = 0;
    }, 120);
    // 静默预载图库索引与校准数据
    /* 预加载（失败只记标志，不阻塞启动 —— 打开选图/校准时才真正需要） */
    /* ☁️ 云模式下图库索引是**跟着数据一起来的**（KC_CLOUD 把它放在 __lib，
       startWith 已经铺进 LIB）；这时就不要再回头读静态 _imgindex.json 把它盖掉。 */
    if (LIB) {
      mergeLibExtra();
      autoScanOnBoot().catch(function () { });
    } else {
      loadJson('_imgindex.json', 'KC_IMG_INDEX')
        .then(function (j) { if (j) { LIB = j; mergeLibExtra(); } else { LIB_FAIL = true; } })
        /* 开机静默同步一次 img 目录：只有「句柄在 + 权限已授」才动，
           其余情况安静退出（首次用之前没绑过句柄，自然是 no-op）。 */
        .then(function () { return autoScanOnBoot(); })
        .catch(function () { });
    }
    loadJson('data/calibration.json', 'KC_CALIBRATION')
      .then(function (j) { if (j) { CALIB = j; } else { CALIB_FAIL = true; } });

    console.log('[KC Editor v2] ready ·', BOOKS.length, 'books ·',
      BOOKS.reduce(function (a, b) { return a + S.books[b.id].cards.length; }, 0) / 2, 'unique SKUs');
  }

  function dataFail(e) {
    fail('数据层未加载',
      '<div style="font-size:16px;font-weight:700;color:#8A6A16;background:#F6F1E2;' +
      'border-left:4px solid #C8A24B;padding:12px 16px;border-radius:4px;margin-bottom:20px">' +
      '具体原因：' + esc(e.message) + '</div>' +
      '<div style="color:#2E3D4E">' +
      (/^file:$/.test(location.protocol)
        ? '本地（file://）请确认源目录里有：<br>' +
          '<code>data/catalog.json</code>（明文，主路径）<br>' +
          '<code>data/catalog.js</code>（file:// 退路，必须以 ' +
          '<code>window.KC_CATALOG = ' + '{' + '</code> 开头）'
        : '线上请确认：<br>' +
          '<code>data/kc-' + DATA_TOKEN + '.json</code> 存在（AES-256-GCM 密文）<br>' +
          '且地址是 <code>https://</code> —— 加密数据在局域网 IP 的 <code>http://</code> 下解不开') +
      '</div>');
  }

  /* 🔑 带密码启动。**门禁判定密码对不对走的就是这里**：
     拿用户输入的密码当 AES 密钥去解密数据，解得开 = 密码对，解不开 = 密码错。
     因此哪怕有人把门禁那段 js 改成「无条件放行」，没有真密码依旧白屏。 */
  function startWith(pass) {
    return loadData(pass).then(function (d) {
      DATA = d;
      /* ☁️ 云端把图库索引也一起带回来了（load 时挂在 __lib 上），先摘出来再 boot */
      if (d && d.__lib) { LIB = d.__lib; delete d.__lib; }
      /* ☁️ 云端的页签开关（封面/分隔页/封底）也一起回来，挂在 __flags 上 */
      if (d && d.__flags) { CLOUD_FLAGS = d.__flags; delete d.__flags; }
      boot();
      /* ☁️ 补齐「本机有、云端还没有」的手工插入图 ——
         包括云通道上线**之前**利在本机插的那批（在有的那台机器上打开就会自动补传）。 */
      cloudSyncImages();
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
      else init();
      return true;
    });
  }
  /* 供门禁脚本调用（门禁脚本在 body 里、本文件之前，用户输入时本文件已就绪） */
  window.KC_BOOT = startWith;

  /* 没被锁就直接启动（file:// 本地双击；或会话内已解锁的刷新）；
     被锁则**什么都不做**，等门禁把密码递过来。
     「是否已被锁」由 html 顶部那段脚本在首帧就定好（它同时看 kc_gate_ok 和 kc_pass），
     这里只读结果，不改判据，免得出现「有锁没门」的白屏。 */
  (function () {
    if (/\bkc-locked\b/.test(document.documentElement.className)) return;
    var saved = null;
    try { saved = sessionStorage.getItem('kc_pass'); } catch (e) { }
    startWith(saved).catch(function (e) {
      console.warn('[KC Editor] 数据层启动失败：', e && e.message);
      dataFail(e);
    });
  })();

  window.KCE = { S: S, save: save, exportBook: doExport, buildPaper: buildPaper,
                 MODALS: MODALS, getData: function () { return DATA; },
                 _libRaw: function () { return LIB; },
                 /* 🖼 图片同步自检钩子 */
                 _imgKeys: function () { return localImgKeys(); },
                 _syncImgs: cloudSyncImages,
                 _imgBlob: imgBlob,
                 /* ☁️ 供 _cloud.js 判断「现在方不方便自动刷新」——
                    正在改字段 / 开着弹窗 / 光标在输入框里，都不能刷，会把人打的字冲掉。 */
                 _idle: function () {
                   if (pendingEdit) return false;
                   var m = $('mask');
                   if (m && m.classList.contains('on')) return false;
                   var ae = document.activeElement;
                   if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return false;
                   if (ae && ae.isContentEditable) return false;
                   return true;
                 },
                 _cloudStatus: function () { return window.KC_CLOUD ? window.KC_CLOUD.status() : null; },
                 cards: cards, bookDefs: function () { return DATA.bookDefs; },
                 openBulk: openBulk, openLib: openLib,
                 _bulkImport: bulkImport,
                 _openImportJson: openImportJson,
                 _pairCheck: pairCheck,
                 _twinBook: twinBook,
                 _nextSegNo: nextSegNo,
                 _saveBook: saveBook,
                 _buildXlsxSheets: buildXlsxSheets,
                 _fillXlsxIdbImages: fillXlsxIdbImages,
                 _xlsxImgTargets: xlsxImgTargets,
                 _libState: function () { return { total: LIB ? LIB.total : null,
                                               generated: LIB ? (LIB.generated || null) : null,
                                               hasExtra: !!LIB_EXTRA_KEY,
                                               extra: libExtra().length,
                                               scan: libScan(),
                                               fsa: fsaSupported(),
                                               merged: LIB ? Object.keys(LIB.groups).map(function (k) { return k + '=' + LIB.groups[k].length; }) : null }; },
                 _scanImgDir: scanImgDir,
                 _pickImgDir: pickImgDir,
                 _autoScanOnBoot: autoScanOnBoot,
                 _libScan: libScan,
                 _libScanSave: libScanSave,
                 _fsaSupported: fsaSupported,
                 _addToLib: addToLib,
                 _libRegister: function (name, b64) {
                   /* 测试钩子：等价于 addToLib 里pickFolder 回调的核心逻辑 */
                   return new Promise(function (res) {
                     var bin = atob(b64);
                     var u8 = new Uint8Array(bin.length);
                     for (var j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j);
                     var fl = new File([u8], name, { type: 'image/jpeg' });
                     var extra = libExtra(), seen = {};
                     extra.forEach(function (x) { seen[x.n] = 1; });
                     if (seen[name]) return res({ skipped: 'already' });
                     var pr = new Image(), u = URL.createObjectURL(fl);
                     pr.onload = function () {
                       URL.revokeObjectURL(u);
                       var d = pr.naturalWidth + ' × ' + pr.naturalHeight;
                       extra.push({ n: name, s: skuFromName(name) || name.replace(/\.[^.]+$/, ''), d: d });
                       libExtraSave(extra);
                       if (!LIB) LIB = { groups: {} };
                       mergeLibExtra();
                       res({ added: 1, dims: d, total: LIB.total });
                     };
                     pr.onerror = function () { URL.revokeObjectURL(u); res({ err: 'decode' }); };
                     pr.src = u;
                   });
                 },
                 setBook: function (id) {
                   if (!S.books[id]) return false;
                   S.book = id; S.sel = 0; flushPendingEdit(); renderAll(); return true;
                 } };
})();
