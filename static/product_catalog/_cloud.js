/* ===================================================================
   KaiLionCrafts 产品目录编辑器 · 云同步通道（v4 · 2026-10-09）
   -------------------------------------------------------------------
   解决什么：同一份产品数据，在**多台电脑**上打开同一条链接都能看到、
   都能改 —— 不用再「导出 JSON → 交给 AI → 重新发布」这一圈。

   ⚠️ file:// 本地双击**完全不碰这个文件**（ON === false），
      走的还是老的明文 data/catalog.json，行为一个字都不变。

   云端存什么：表 kc_docs，一行一份文档
       meta              全局（ver / generated / struct / brand / bookDefs / catMeta / fieldPresets）
       bk_0 … bk_7       8 本册子的卡片数组
       imgindex          图库索引
   载荷一律 **AES-256-GCM 密文**，钥匙 = 门禁密码（PBKDF2-SHA256 / 150000 次迭代）。
   ⇒ 就算有人拿到云端数据，手里也只有密文，跟现在线上的 kc-<TOKEN>.json 同一级别。
      （云端表的 RLS 是开放的，这一点是**刻意**的：访问控制靠门禁密码 + 密文，
        不是靠身份。所以别把明文塞进 payload。）

   并发：每行带 revision。写入 = `update(...).eq('doc_key', K).eq('revision', 期望值)`。
        **影响 0 行 = 别人先改过** → 明确报冲突，绝不闷声覆盖。
        这是需求里「两个人同时改」的兜底：宁可让人重做一次，也不能悄悄丢数据。

   暴露：window.KC_CLOUD
       .on            是否云模式（https 才 true）
       .load(pass)    拉全量 → 组装成 catalog 对象（云端为空时返回 null）
       .saveBook(id, cards, flags)   写回一册
       .seed()        首次把本地这份数据整体上传到云端
       .watch()       开始定时轮询
       .status()      状态快照（给 UI 与自检脚本用）
   =================================================================== */
(function () {
  'use strict';

  /* ---------- publicConfig（云服务开通时返回，只含可公开字段） ---------- */
  var CFG = {
    endpoint: 'https://video-reverse-prompt.app.workbuddy.host',
    relay: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    /* publishableKey 只标识「哪个应用」，本身不带权限；服务端还会做 Origin 精确匹配 */
    key: 'wbpk_Q3dPEvPtlxsXzhoXDgg8zn_EKtCU0YCdgPrETfC6hACj560dQmiA0vt',
    sdk: 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js',
    table: 'kc_docs',
    /* 🖼 图片表 —— 浏览器里插入的图（卡片 img = 'idb:xxx'）字节存这儿，
       让别的电脑也能看到同一张图。不与 kc_docs 混在一起是为了 load() 不被大字段拖慢。 */
    tableImg: 'kc_imgs',
    /* 固定盐（盐本来就不是秘密）。固定它 = 一次 PBKDF2 就能覆盖全部文档，省掉每次保存的几百毫秒 */
    salt: 'uOhl4HGQL+Mlncw9KCUucg==',
    iter: 150000,
    pollMs: 15000
  };

  /* 只有 https 才走云：file:// 是老路径；http:// 下 crypto.subtle 不可用，也走不了 */
  var ON = /^https:$/.test(location.protocol);

  var CL = {
    sdkP: null, c: null, pass: '',
    defs: [], idx: {}, rev: {}, meta: null,
    timer: null, busy: false,
    lastSync: 0, state: ON ? 'boot' : 'off', note: ''
  };

  /* ---------------------------------------------------------- 编码 / 密码学 */
  function b64(u8) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s);
  }
  function unb64(str) {
    var bin = atob(String(str).replace(/\s+/g, ''));
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function cryptoOk() {
    return !!(window.crypto && crypto.subtle && crypto.subtle.decrypt && crypto.subtle.encrypt);
  }

  var keyCache = {};
  /* 参数必须与 _editor_app.js 的 decryptData() / 产品目录参考/_encrypt_data.js 严格对齐：
     PBKDF2-SHA256 / iter 150000 / salt 16B ；AES-256-GCM / iv 12B / tag 拼在密文尾。
     改一边就要同时改另外两边，否则出现「Node 能解、浏览器解不开」这种最难查的错。 */
  function derive(pass, saltB64, iter) {
    if (keyCache[saltB64]) return Promise.resolve(keyCache[saltB64]);
    return crypto.subtle
      .importKey('raw', new TextEncoder().encode(String(pass)), 'PBKDF2', false, ['deriveKey'])
      .then(function (bk) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: unb64(saltB64), iterations: iter || CFG.iter, hash: 'SHA-256' },
          bk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      })
      .then(function (k) { keyCache[saltB64] = k; return k; });
  }
  function dec(w) {
    if (!w || !w.ct) return Promise.reject(new Error('载荷是空的或者是明文'));
    return derive(CL.pass, w.salt || CFG.salt, w.iter).then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, k, unb64(w.ct));
    }).then(function (buf) {
      var txt = new TextDecoder('utf-8').decode(buf);
      try { return JSON.parse(txt); } catch (e) { throw new Error('解密出来的不是 JSON'); }
    });
  }
  function enc(obj) {
    return derive(CL.pass, CFG.salt, CFG.iter).then(function (k) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle
        .encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(obj)))
        .then(function (ct) {
          return { salt: CFG.salt, iv: b64(iv), iter: CFG.iter, ct: b64(new Uint8Array(ct)) };
        });
    });
  }

  /* ---------------------------------------------------------- SDK / 客户端 */
  function ensureSdk() {
    if (window.WorkBuddyCloud) return Promise.resolve();
    if (CL.sdkP) return CL.sdkP;
    CL.sdkP = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = CFG.sdk;
      s.onload = function () {
        if (window.WorkBuddyCloud) res();
        else { CL.sdkP = null; rej(new Error('云 SDK 加载了但没有 WorkBuddyCloud 全局')); }
      };
      s.onerror = function () { CL.sdkP = null; rej(new Error('云 SDK 加载失败（CDN 不可达）')); };
      document.head.appendChild(s);
    });
    return CL.sdkP;
  }
  function client() {
    if (CL.c) return CL.c;
    /* endpoint + publishableKey 两个都必须传（来自 publicConfig）；
       relay 只有网页版微信扫码登录才用得上，这里顺手带上，不影响其它调用。 */
    CL.c = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: CFG.endpoint,
      oauthRelayBaseUrl: CFG.relay,
      publishableKey: CFG.key
    });
    return CL.c;
  }
  function db() { return client().database.from(CFG.table); }

  /* ---------------------------------------------------------- 顶栏状态灯 */
  var COL = { boot: '#93A6B9', ok: '#7ED8A8', warn: '#E3C87F', err: '#F0997B', off: '#93A6B9' };
  function mountBadge() {
    if (!ON) return null;
    var top = document.querySelector('.top');
    if (!top) return null;
    var el = document.getElementById('kcCloud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kcCloud';
      el.className = 'savedot';
      el.style.cssText = 'cursor:pointer;user-select:none;white-space:nowrap';
      el.innerHTML = '<i></i><span id="kcCloudTxt">云端</span>';
      var sp = top.querySelector('.sp');
      if (sp && sp.nextSibling) top.insertBefore(el, sp.nextSibling);
      else top.appendChild(el);
      el.addEventListener('click', onBadgeClick);
    }
    return el;
  }
  function setBadge(state, text) {
    CL.state = state;
    CL.note = text || '';
    var el = mountBadge();
    if (!el) return;
    var i = el.querySelector('i'), t = el.querySelector('span');
    if (i) i.style.background = COL[state] || COL.boot;
    if (t) t.textContent = text || '';
    el.title = el.title || '';
  }
  function onBadgeClick() {
    if (CL.state === 'empty') { seed(); return; }
    if (CL.state === 'conflict') { location.reload(); return; }
    var tip = {
      ok: '云端已是最新（' + stamp(CL.lastSync) + '）',
      busy: '正在和云端同步…',
      err: '云端暂时连不上：' + (CL.note || '未知原因'),
      boot: '正在连接云端…',
      off: '本地模式（file:// 双击），不走云端'
    }[CL.state] || '';
    if (tip) toast(tip);
  }

  /* ---------------------------------------------------------- 小工具 */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  var toastTimer = null;
  function toast(msg, ms) {
    var el = document.getElementById('toast');
    if (!el) { console.log('[KC Cloud]', msg); return; }
    el.textContent = msg;
    el.style.cssText = 'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);' +
      'background:rgba(27,42,65,.94);color:#fff;padding:9px 16px;border-radius:8px;' +
      'font-size:13px;z-index:9999;max-width:82vw;text-align:center;line-height:1.5';
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.display = 'none'; }, ms || 3200);
  }
  function fail(msg) { return Promise.reject(new Error(msg)); }

  /* ---------------------------------------------------------- 读取 */
  /* 返回：catalog 对象（含 __lib）｜ null（云端还没有数据） */
  function load(pass) {
    CL.pass = pass || CL.pass || '';
    if (!ON) return Promise.resolve(null);
    if (!cryptoOk()) return fail('当前环境不支持 WebCrypto，云同步需要 https:// 打开');
    setBadge('boot', '连接云端…');

    return ensureSdk()
      .then(function () {
        return db().select('doc_key,kind,label,revision,payload');
      })
      .then(function (r) {
        if (r && r.error) throw new Error(r.error.message || r.error.code || '云端读取失败');
        var rows = (r && r.data) || [];
        CL.rev = {};
        rows.forEach(function (x) { CL.rev[x.doc_key] = x.revision; });
        if (!rows.length) { setBadge('empty', '云端还没有数据 · 点这里上传'); return null; }

        var byKey = {};
        rows.forEach(function (x) { byKey[x.doc_key] = x; });
        if (!byKey.meta) { setBadge('empty', '云端还没有数据 · 点这里上传'); return null; }

        return dec(byKey.meta.payload).then(function (meta) {
          var defs = meta.bookDefs || [];
          CL.meta = meta;
          CL.defs = defs;
          CL.idx = {};
          defs.forEach(function (b, i) { CL.idx[b.id] = i; });

          var jobs = defs.map(function (b, i) {
            var row = byKey['bk_' + i];
            if (!row) return Promise.resolve([]);
            /* 单册解不开不该拖垮整页（比如某册是别的密码加密的）——退成空册并留痕 */
            return dec(row.payload).catch(function (e) {
              console.warn('[KC Cloud] 第 ' + i + ' 册解密失败：', e && e.message);
              return [];
            });
          });
          var pLib = byKey.imgindex ? dec(byKey.imgindex.payload).catch(function () { return null; })
            : Promise.resolve(null);

          return Promise.all(jobs.concat([pLib])).then(function (all) {
            var lib = all.pop();
            var out = meta;
            out.books = {};
            /* 🔴 云端每册有**两种形状**，必须都认：
                 ① 纯数组 [card, card, …]        —— 早期 seed() 写进去的
                 ② { cards:[…], flags:{…} }      —— saveBook() 写进去的（多带页签开关状态）
                   ⚠️ 2026-10-09 踩过：load() 只按数组读，saveBook() 却写对象 ⇒
                      某一册一旦被保存过，下次打开 `S.books[册].cards` 变成对象、
                      `cards.length` 是 undefined，整册**静默消失**（诊断里连键都没有，
                      因为 JSON.stringify 会丢掉值为 undefined 的键，假象是「云端没回来」）。
                   ⇒ 这里统一成「数组 + 单独一份 flags」，向后兼容两种历史数据。 */
            var flags = {};
            defs.forEach(function (b, i) {
              var v = all[i];
              if (Array.isArray(v)) {
                out.books[b.id] = v;
              } else if (v && Array.isArray(v.cards)) {
                out.books[b.id] = v.cards;
                if (v.flags) flags[b.id] = v.flags;
              } else {
                out.books[b.id] = [];
                if (v) console.warn('[KC Cloud] 「' + b.id + '」云端载荷形状不认识，按空册处理');
              }
            });
            out.__flags = flags;              /* 每册的页签开关，由 _editor_app.js 取走 */
            out.__lib = lib || null;          /* 图库索引，由 _editor_app.js 取走 */
            CL.lastSync = Date.now();
            setBadge('ok', '已同步 ' + stamp(CL.lastSync));
            return out;
          });
        });
      })
      .catch(function (e) {
        CL.note = (e && e.message) || String(e);
        setBadge('err', '云端连不上 · 点这里看原因');
        throw e;                              /* 交给调用方决定是否回退静态数据 */
      });
  }

  /* 只问「有没有变化」，不拉载荷 —— 轮询专用，几十字节 */
  function probe() {
    return db().select('doc_key,revision').then(function (r) {
      if (r && r.error) throw new Error(r.error.message || r.error.code);
      var rows = (r && r.data) || [];
      var changed = [];
      rows.forEach(function (x) {
        var old = CL.rev[x.doc_key];
        if (old !== undefined && Number(x.revision) !== Number(old)) changed.push(x.doc_key);
      });
      return changed;
    });
  }
  function labelOf(key) {
    if (key === 'meta') return '全局数据';
    if (key === 'imgindex') return '图库索引';
    var m = /^bk_(\d+)$/.exec(key);
    if (m) {
      var b = CL.defs[Number(m[1])];
      return (b && b.id) || ('第 ' + m[1] + ' 册');
    }
    return key;
  }
  /* 现在方不方便立刻刷新？
     只要**没在编辑、没开弹窗**就能自动应用 —— 否则会把用户正在打的字冲掉。 */
  function canAutoApply() {
    var K = window.KCE;
    if (!K || !K._idle) return false;
    try { return !!K._idle(); } catch (e) { return false; }
  }
  function watch() {
    if (!ON || CL.timer) return;
    CL.timer = setInterval(function () {
      if (CL.busy || document.hidden) return;
      probe().then(function (changed) {
        if (!changed.length) { CL.lastSync = Date.now(); if (CL.state === 'ok') setBadge('ok', '已同步 ' + stamp(CL.lastSync)); return; }
        var names = changed.map(labelOf).join('、');
        setBadge('conflict', '☁ 另一台电脑改了「' + names + '」· 点这里刷新');
        /* ☁️ 自动应用：利要的是「实时同步」，不该要求人盯着顶栏有没有亮灯。
           没在编辑就自己刷新到位；正在打字/开着弹窗才退回「点一下」的手动方式。 */
        if (canAutoApply()) {
          CL.autoPending = true;
          toast('另一台电脑更新了：' + names + ' —— 正在自动刷新…', 4000);
          setTimeout(function () { if (CL.autoPending) location.reload(); }, 900);
        } else {
          toast('另一台电脑更新了：' + names + ' —— 你正在编辑，处理完点顶栏云图标刷新', 8000);
        }
      }).catch(function () { /* 轮询失败安静处理，下一轮再试 */ });
    }, CFG.pollMs);
  }

  /* ---------------------------------------------------------- 写入 */
  function fpNow() {
    var m = CL.meta || {};
    return (m.ver || '0') + '|' + (m.generated || '') + '|' + (m.struct || '');
  }
  /* 写一册。返回 {ok:true} 或 {ok:false, reason:'conflict'|...} */
  function saveBook(id, cards, flags) {
    if (!ON) return Promise.resolve({ ok: false, reason: 'off' });
    var i = CL.idx[id];
    if (i === undefined) return Promise.resolve({ ok: false, reason: 'unknown-book:' + id });
    /* 🔴 形状闸门：只接受真数组。
       2026-10-09 踩过：内存里 `cards` 一旦被污染成对象，这里就会把
       `{cards:{cards:{…}}}` 层层嵌套写进云端，而且**没有任何报错**，
       表现只是「打开少一册」。宁可不写，也不能把脏数据推上去。 */
    if (!Array.isArray(cards)) {
      CL.note = '「' + id + '」的 cards 不是数组（' + (typeof cards) + '），已拒绝写入';
      setBadge('err', '☁ 这一册数据异常 · 已拒绝上传');
      console.warn('[KC Cloud] saveBook 拒绝写入：', CL.note);
      return Promise.resolve({ ok: false, reason: 'bad-cards' });
    }
    var key = 'bk_' + i;
    var payload = { cards: cards, flags: flags, ts: Date.now(), fp: fpNow() };
    var exp = CL.rev[key];

    CL.busy = true;
    setBadge('busy', '同步中…');
    var rec = null;
    return enc(payload).then(function (w) {
      rec = { payload: w, revision: (Number(exp) || 0) + 1, updated_at: new Date().toISOString() };
      var q = db().update(rec);
      /* 有 revision 记录才做乐观锁；没有（比如刚从静态数据起步）就按 key 直接写 */
      if (exp !== undefined) q = q.eq('revision', exp);
      return q.eq('doc_key', key).select('doc_key,revision');
    }).then(function (r) {
      CL.busy = false;
      if (r && r.error) throw new Error(r.error.message || r.error.code);
      var rows = (r && r.data) || [];
      /* 🔴 影响 0 行 = 行不存在 或 版本对不上（别人先改了）—— 两种情况都不能装作成功 */
      if (!rows.length) {
        /* 但「行不存在」是另一回事：云端还是空的时候（比如第一次从静态数据起步），
           update 永远命中 0 行，会让用户以为改的东西压根没同步上去。
           ⇒ 手里**没有 revision 期望值**就说明不是冲突，补一条（upsert）。 */
        if (exp === undefined) {
          return db().upsert({
            doc_key: key, kind: 'book', label: id,
            payload: rec.payload, revision: 1, updated_at: rec.updated_at
          }, { onConflict: 'doc_key' }).select('doc_key,revision').then(function (r2) {
            if (r2 && r2.error) throw new Error(r2.error.message || r2.error.code);
            var rr = (r2 && r2.data) || [];
            if (!rr.length) { setBadge('conflict', '☁ 写入没成功 · 点这里刷新'); return { ok: false, reason: 'conflict' }; }
            CL.rev[key] = rr[0].revision;
            CL.lastSync = Date.now();
            setBadge('ok', '已同步 ' + stamp(CL.lastSync));
            return { ok: true, revision: rr[0].revision, created: true };
          });
        }
        setBadge('conflict', '☁ 云端已更新 · 点这里刷新');
        return { ok: false, reason: 'conflict' };
      }
      CL.rev[key] = rows[0].revision;
      CL.lastSync = Date.now();
      setBadge('ok', '已同步 ' + stamp(CL.lastSync));
      return { ok: true, revision: rows[0].revision };
    }).catch(function (e) {
      CL.busy = false;
      CL.note = (e && e.message) || String(e);
      setBadge('err', '云端写入失败 · 点这里看原因');
      return { ok: false, reason: 'error', message: CL.note };
    });
  }

  /* 首次播种：把本机这份完整数据整体搬到云端（只在云端为空时用） */
  function seed() {
    if (!ON) { toast('本地双击模式不需要上传'); return Promise.resolve({ ok: false, reason: 'off' }); }
    var K = window.KCE;
    if (!K || !K.getData) { toast('编辑器还没就绪，稍后再试'); return Promise.resolve({ ok: false, reason: 'no-kce' }); }
    var data = K.getData();
    if (!data) { toast('本机还没有数据可以上传'); return Promise.resolve({ ok: false, reason: 'no-data' }); }
    if (!CL.pass) { toast('请先输入密码解锁，再上传'); return Promise.resolve({ ok: false, reason: 'no-pass' }); }

    var defs = data.bookDefs || [];
    var lib = (K._libRaw ? K._libRaw() : null);
    if (!defs.length) { toast('数据里没有册子定义，无法上传'); return Promise.resolve({ ok: false, reason: 'no-defs' }); }

    /* 🔴 形状闸门：任何一册不是真数组就**整批中止**。
       播种是「整体覆盖」动作，掺一册空数据上去就等于删掉一整册；
       宁可不上传，也不能让云端被空册盖掉（2026-10-09 实测踩过：seed 从内存读，
       而内存那册已被污染成空，于是把空写回云端，污染自我传播）。 */
    var bad = defs.filter(function (b) { return !Array.isArray(data.books[b.id]); });
    if (bad.length) {
      var names = bad.map(function (b) { return b.id; }).join('、');
      CL.note = '形状异常，已中止上传：' + names;
      setBadge('err', '☁ 有 ' + bad.length + ' 册数据异常 · 已中止上传');
      toast('「' + names + '」数据形状异常，已中止上传以免覆盖云端。请刷新页面重试。', 8000);
      return Promise.resolve({ ok: false, reason: 'bad-shape', books: bad.map(function (b) { return b.id; }) });
    }

    CL.busy = true;
    setBadge('busy', '上传中…');
    CL.meta = { ver: data.ver, generated: data.generated, struct: data.struct,
                brand: data.brand, bookDefs: data.bookDefs,
                catMeta: data.catMeta, fieldPresets: data.fieldPresets };
    CL.defs = defs;
    CL.idx = {};
    defs.forEach(function (b, i) { CL.idx[b.id] = i; });

    function put(key, kind, label, obj) {
      return enc(obj).then(function (w) {
        return db().upsert({
          doc_key: key, kind: kind, label: label, payload: w,
          revision: 1, updated_at: new Date().toISOString()
        }, { onConflict: 'doc_key' }).select('doc_key,revision');
      }).then(function (r) {
        if (r && r.error) throw new Error(r.error.message || r.error.code);
        var rows = (r && r.data) || [];
        if (rows.length) CL.rev[key] = rows[0].revision;
        return rows.length ? 1 : 0;
      });
    }

    var jobs = [put('meta', 'meta', 'meta', CL.meta)];
    defs.forEach(function (b, i) {
      /* 🔴 与 saveBook() 用**同一种形状** {cards, flags}。
         以前这里写纯数组、saveBook() 写对象，两种形状混在云端 ⇒ load() 只能认一种，
         另一种整册静默消失（2026-10-09 实测踩过）。 */
      jobs.push(put('bk_' + i, 'book', b.id + '', {
        cards: data.books[b.id] || [],
        flags: { cover: true, divider: true, back: true }
      }));
    });
    if (lib) jobs.push(put('imgindex', 'imgindex', 'imgindex', lib));

    return Promise.all(jobs).then(function (counts) {
      CL.busy = false;
      var n = counts.reduce(function (a, b) { return a + b; }, 0);
      CL.lastSync = Date.now();
      setBadge('ok', '已同步 ' + stamp(CL.lastSync));
      toast('已上传 ' + n + ' 份文档到云端 · 以后任何电脑打开这条链接都能看到', 5200);
      return { ok: true, uploaded: n };
    }).catch(function (e) {
      CL.busy = false;
      CL.note = (e && e.message) || String(e);
      setBadge('err', '上传失败 · 点这里看原因');
      toast('上传失败：' + CL.note, 5000);
      return { ok: false, reason: 'error', message: CL.note };
    });
  }

  /* ================================================================
     🖼 图片同步
     背景：卡片里手工插入的图，字节存在**本机 IndexedDB**，卡片字段只写
           `img = 'idb:<key>'`。文字数据会同步，字节不会 ⇒ 另一台电脑上
           这张卡片**一片空白**（2026-10-09 利报的现象）。
     做法：把字节也放上云（表 kc_imgs，一行一张图）。
     为什么不用云存储：云存储强制要求**登录态**，而本应用刻意没有账号体系
           （单密码 + 多台电脑，利明确「只有我一个人」）。
           图片是产品图，静态 img/ 目录里本来就公开托管着同样性质的图，
           所以放同一张表里既最省事也不增加暴露面。
     体积控制：>600KB 的图先压到长边 1800px / JPEG q0.92 再上传
           （1800px 就是本目录印刷件的既有标准，见 _import_4k.py）。
     ================================================================ */
  var IMG_MAXB64 = 6 * 1024 * 1024;      /* 单张图 base64 上限（约 4.5MB 原图） */
  function dbImg() { return client().database.from(CFG.tableImg); }

  /* 大图压一压：小图原样保真（可能是带透明通道的 PNG），大图转 1800px JPEG */
  function shrink(blob) {
    return new Promise(function (res) {
      try {
        if (!/^image\//.test(blob.type || '')) return res(blob);
        if (blob.size <= 600 * 1024) return res(blob);
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth, h = img.naturalHeight;
            var sc = Math.min(1, 1800 / Math.max(w, h));
            var cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(w * sc));
            cv.height = Math.max(1, Math.round(h * sc));
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            cv.toBlob(function (out) {
              try { URL.revokeObjectURL(url); } catch (e) { }
              /* 压完反而更大就别用（极少数高压缩比的小 PNG） */
              res(out && out.size < blob.size ? out : blob);
            }, 'image/jpeg', 0.92);
          } catch (e) { try { URL.revokeObjectURL(url); } catch (e2) { } res(blob); }
        };
        img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) { } res(blob); };
        img.src = url;
      } catch (e) { res(blob); }
    });
  }
  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onerror = function () { rej(new Error('读图片失败')); };
      fr.onload = function () {
        var s = String(fr.result), i = s.indexOf(',');
        res(i >= 0 ? s.slice(i + 1) : s);
      };
      fr.readAsDataURL(blob);
    });
  }
  function b64ToBlob(s, mime) {
    var bin = atob(s), n = bin.length, u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime || 'image/jpeg' });
  }

  /* 推一张图上去（键就用 IndexedDB 里那把 key，天然去重） */
  function putImg(key, blob) {
    if (!ON) return Promise.resolve({ ok: false, reason: 'off' });
    if (!key || !blob) return Promise.resolve({ ok: false, reason: 'bad-arg' });
    return shrink(blob).then(function (b) {
      return blobToB64(b).then(function (s) {
        if (s.length > IMG_MAXB64) return { ok: false, reason: 'too-big', kb: Math.round(s.length / 1024) };
        return dbImg().upsert({
          key: key, mime: b.type || 'image/jpeg', bytes: b.size,
          b64: s, updated_at: new Date().toISOString()
        }, { onConflict: 'key' }).then(function (r) {
          if (r && r.error) throw new Error(r.error.message || r.error.code);
          return { ok: true, kb: Math.round(b.size / 1024) };
        });
      });
    }).catch(function (e) {
      CL.note = (e && e.message) || String(e);
      return { ok: false, reason: 'error', message: CL.note };
    });
  }
  /* 取一张图（本机没有时用） */
  function getImg(key) {
    if (!ON) return Promise.resolve(null);
    return dbImg().select('mime,b64').eq('key', key).then(function (r) {
      if (r && r.error) throw new Error(r.error.message || r.error.code);
      var rows = (r && r.data) || [];
      if (!rows.length) return null;
      return b64ToBlob(rows[0].b64, rows[0].mime);
    }).catch(function () { return null; });
  }
  /* 云端已有哪些图（只取 key，几十字节） */
  function imgKeys() {
    return dbImg().select('key').then(function (r) {
      if (r && r.error) throw new Error(r.error.message || r.error.code);
      var set = {};
      ((r && r.data) || []).forEach(function (x) { set[x.key] = 1; });
      return set;
    });
  }
  /* 删一张云端的图（换图后清理旧字节 / 自检脚本清场用） */
  function delImg(key) {
    if (!ON) return Promise.resolve({ ok: false, reason: 'off' });
    return dbImg().delete().eq('key', key).then(function (r) {
      if (r && r.error) throw new Error(r.error.message || r.error.code);
      return { ok: true };
    }).catch(function (e) {
      return { ok: false, reason: 'error', message: (e && e.message) || String(e) };
    });
  }
  /* 补齐：把「卡片引用了、本机有、云端还没有」的图传上去。
     getLocal(key) 由 _editor_app.js 传进来（它才摸得到 IndexedDB）。 */
  function syncImages(keys, getLocal) {
    if (!ON || !keys || !keys.length || !getLocal) return Promise.resolve({ ok: true, uploaded: 0, checked: 0 });
    return imgKeys().then(function (have) {
      var need = keys.filter(function (k) { return !have[k]; });
      if (!need.length) return { ok: true, uploaded: 0, checked: keys.length, missing: 0 };
      var up = 0, chain = Promise.resolve();
      need.forEach(function (k) {
        chain = chain.then(function () {
          return Promise.resolve(getLocal(k)).then(function (b) {
            if (!b) return;                       /* 本机也没有 ⇒ 留着空白，等有图的那台机器来补 */
            return putImg(k, b).then(function (r) { if (r && r.ok) up++; });
          });
        });
      });
      return chain.then(function () {
        if (up) setBadge('ok', '已同步 ' + up + ' 张图 · ' + stamp(Date.now()));
        return { ok: true, uploaded: up, checked: keys.length };
      });
    }).catch(function (e) {
      return { ok: false, reason: 'error', message: (e && e.message) || String(e) };
    });
  }

  /* ---------------------------------------------------------- 状态快照 */
  function status() {
    return {
      on: ON,
      state: CL.state,
      note: CL.note,
      lastSync: CL.lastSync,
      rev: JSON.parse(JSON.stringify(CL.rev)),
      defs: CL.defs.map(function (b) { return b.id; }),
      books: CL.defs.length,
      pass: CL.pass ? 'set' : '',
      sdk: !!window.WorkBuddyCloud,
      crypto: cryptoOk()
    };
  }

  window.KC_CLOUD = {
    on: ON, CFG: CFG,
    load: load, saveBook: saveBook, seed: seed, watch: watch, status: status,
    /* 🖼 图片通道 */
    putImg: putImg, getImg: getImg, imgKeys: imgKeys, syncImages: syncImages, delImg: delImg,
    probe: probe, setBadge: setBadge, toast: toast, mountBadge: mountBadge,
    /* 仅供自检脚本调用（_verify_cloud_crypto.js），不参与业务逻辑 */
    _crypto: {
      dec: dec, enc: enc, derive: derive, b64: b64, unb64: unb64,
      setPass: function (p) { CL.pass = p; keyCache = {}; },
      salt: CFG.salt, iter: CFG.iter
    }
  };

  /* 顶栏状态灯：本地模式显示一行说明；https 等 load() 来点亮 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { if (ON) mountBadge(); });
  } else if (ON) { mountBadge(); }
})();
