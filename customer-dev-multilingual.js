/* ============================================================
 * Customer Development Multilingual Center (customer-dev-multilingual.js)
 * ----------------------------------------------------------------
 * Phase 3 · Feature 3.1 — Multilingual outbound support
 *
 * Responsibilities:
 *   - Country -> language recommendation table (CD_COUNTRY_LANG_MAP)
 *   - Language metadata (CD_LANGUAGES): code, native label, RTL, flag
 *   - Per-customer preferred email language (c.cdEmailLang) with auto
 *     recommendation and manual override
 *   - Multilingual center page: stats, mapping table, bulk auto-set
 *
 * HARD RULES:
 *   - NEVER sends email / WhatsApp. Content generation only.
 *   - Fully client-side, free. No paid translation services.
 *   - Does NOT modify app.js / server.js / other cd-* modules.
 *   - CSS classes use the cd- prefix. Code comments in English.
 *
 * Exposes on window (defensive, so customer-dev-email.js can call
 * even if load order shifts):
 *   - window.cdLanguages               -> CD_LANGUAGES array
 *   - window.cdCountryLangMap          -> CD_COUNTRY_LANG_MAP object
 *   - window.cdGetLangMeta(code)      -> metadata object or null
 *   - window.cdRecommendLang(country)  -> lang code string
 *   - window.cdEnsureCustomerLang(c)  -> sets c.cdEmailLang if missing
 *   - window.cdLangStats()             -> { perLang: {code: {customers, emails}}, total }
 * ============================================================ */
(function(){
  'use strict';

  // ============================================================
  // Language metadata
  // ============================================================
  var CD_LANGUAGES = [
    { code:'en', label:'English',       nativeLabel:'English',            rtl:false, flag:'🇬🇧', note:'Default for all markets' },
    { code:'es', label:'Spanish',       nativeLabel:'Español',            rtl:false, flag:'🇪🇸', note:'Latin America (Brazil ⚠️ actually Portuguese)' },
    { code:'pt', label:'Portuguese',    nativeLabel:'Português',          rtl:false, flag:'🇧🇷', note:'Reserved for Brazil (fallback es for now)' },
    { code:'ar', label:'Arabic',        nativeLabel:'العربية',            rtl:true,  flag:'🇸🇦', note:'Middle East / North Africa · RTL' },
    { code:'fr', label:'French',        nativeLabel:'Français',           rtl:false, flag:'🇫🇷', note:'West & North Africa, France' },
    { code:'de', label:'German',        nativeLabel:'Deutsch',            rtl:false, flag:'🇩🇪', note:'Germany / Austria / Switzerland' },
    { code:'ja', label:'Japanese',      nativeLabel:'日本語',             rtl:false, flag:'🇯🇵', note:'Japan' }
  ];

  // ============================================================
  // Country -> language code map.
  // Keys are normalized (lowercase, trimmed). Both Chinese and
  // English names are accepted because c.country may hold either.
  // ============================================================
  var CD_COUNTRY_LANG_MAP = {
    // ── Spanish (Latin America + Spain) ────────────────────
    'mexico':'es', '墨西哥':'es',
    'brazil':'es', '巴西':'es', // ⚠️ TODO: actually pt; fallback es per spec
    'argentina':'es', '阿根廷':'es',
    'chile':'es', '智利':'es',
    'colombia':'es', '哥伦比亚':'es',
    'peru':'es', '秘鲁':'es',
    'venezuela':'es', '委内瑞拉':'es',
    'uruguay':'es', '乌拉圭':'es',
    'paraguay':'es', '巴拉圭':'es',
    'spain':'es', 'españa':'es', '西班牙':'es',
    'bolivia':'es', 'ecuador':'es', 'guatemala':'es',
    'costa rica':'es', 'panama':'es', 'dominican republic':'es',
    'puerto rico':'es', 'cuba':'es', 'honduras':'es',
    'nicaragua':'es', 'el salvador':'es',
    // ── Arabic (Middle East) ───────────────────────────────
    'united arab emirates':'ar', 'uae':'ar', '阿联酋':'ar', '阿联酋阿拉伯联合酋长国':'ar',
    'saudi arabia':'ar', 'saudi':'ar', '沙特':'ar', '沙特阿拉伯':'ar',
    'qatar':'ar', '卡塔尔':'ar',
    'kuwait':'ar', '科威特':'ar',
    'bahrain':'ar', '巴林':'ar',
    'oman':'ar', '阿曼':'ar',
    'jordan':'ar', '约旦':'ar',
    'egypt':'ar', '埃及':'ar',
    'iraq':'ar', '伊拉克':'ar',
    'lebanon':'ar', '黎巴嫩':'ar',
    'israel':'ar',
    // ── French (Africa + France) ────────────────────────────
    'morocco':'fr', '摩洛哥':'fr',
    'algeria':'fr', '阿尔及利亚':'fr',
    'tunisia':'fr', '突尼斯':'fr',
    'senegal':'fr', '塞内加尔':'fr',
    "cote d'ivoire":'fr', 'ivory coast':'fr', '科特迪瓦':'fr',
    'cameroon':'fr', '喀麦隆':'fr',
    'france':'fr', '法国':'fr',
    'belgium':'fr', 'congo':'fr', 'gabon':'fr',
    // ── German ──────────────────────────────────────────────
    'germany':'de', '德国':'de',
    'austria':'de', '奥地利':'de',
    'switzerland':'de', '瑞士':'de',
    'liechtenstein':'de',
    // ── Japanese ─────────────────────────────────────────────
    'japan':'ja', '日本':'ja'
    // Everything else falls back to 'en'
  };

  // ============================================================
  // Public helpers
  // ============================================================
  function cdGetLangMeta(code){
    if(!code) return null;
    return CD_LANGUAGES.find(function(l){ return l.code === code; }) || null;
  }

  function cdRecommendLang(country){
    if(!country) return 'en';
    var key = String(country).toLowerCase().trim();
    // direct hit
    if(CD_COUNTRY_LANG_MAP[key]) return CD_COUNTRY_LANG_MAP[key];
    // partial containment (e.g. "United States of America" contains "united states" not in map -> en)
    for(var k in CD_COUNTRY_LANG_MAP){
      if(key.indexOf(k) >= 0 || k.indexOf(key) >= 0) return CD_COUNTRY_LANG_MAP[k];
    }
    return 'en';
  }

  // Ensure a customer object carries cdEmailLang. Does NOT overwrite
  // a manual user choice — only fills when missing.
  function cdEnsureCustomerLang(c){
    if(!c) return 'en';
    if(!c.cdEmailLang){
      c.cdEmailLang = cdRecommendLang(c.country);
    }
    return c.cdEmailLang;
  }

  // Aggregate stats across all customers + their cdEmails
  function cdLangStats(){
    var perLang = {};
    CD_LANGUAGES.forEach(function(l){
      perLang[l.code] = { lang:l, customers:0, emails:0, generatedEmails:0 };
    });
    (S.customers || []).forEach(function(c){
      var code = cdEnsureCustomerLang(c);
      if(!perLang[code]) perLang[code] = { lang:cdGetLangMeta(code) || {code:code, nativeLabel:code, flag:'🌐'}, customers:0, emails:0, generatedEmails:0 };
      perLang[code].customers++;
      (c.cdEmails || []).forEach(function(e){
        // email-level lang overrides customer lang for counting
        var ecode = e.lang || code;
        if(!perLang[ecode]) perLang[ecode] = { lang:cdGetLangMeta(ecode) || {code:ecode, nativeLabel:ecode, flag:'🌐'}, customers:0, emails:0, generatedEmails:0 };
        perLang[ecode].emails++;
        if(e.status && e.status !== 'not_generated') perLang[ecode].generatedEmails++;
      });
    });
    return { perLang:perLang, total:(S.customers||[]).length };
  }

  // ============================================================
  // Nav injection
  // ============================================================
  NAV.push({
    key: 'customerDevMultilingual',
    icon: '🌍',
    label: '多语言中心',
    title: '多语言开发信 · 西/阿/法/德/日 · RTL',
    crumb: '按国家自动推荐语言 · 批量设置 · 语言统计'
  });

  // ============================================================
  // Global exports (defensive)
  // ============================================================
  window.cdLanguages = CD_LANGUAGES;
  window.cdCountryLangMap = CD_COUNTRY_LANG_MAP;
  window.cdGetLangMeta = cdGetLangMeta;
  window.cdRecommendLang = cdRecommendLang;
  window.cdEnsureCustomerLang = cdEnsureCustomerLang;
  window.cdLangStats = cdLangStats;

  // ============================================================
  // Customer-level language override (called from UI)
  // ============================================================
  window.cdSetCustomerLang = function(cid, code){
    var c = (S.customers || []).find(function(x){ return x.id === cid; });
    if(!c) return;
    c.cdEmailLang = code;
    c.cdEmailLangManual = true; // mark as manual override
    if(c.cdEmailLang === cdRecommendLang(c.country)) c.cdEmailLangManual = false;
    persist();
    toast('✅ 已将 ' + (c.company||c.name||'客户') + ' 的开发信语言设为 ' + (cdGetLangMeta(code)||{}).nativeLabel);
    renderView();
  };

  // Bulk: auto-recommend for all customers that don't have a manual override
  window.cdBulkAutoLang = function(){
    var n = 0;
    (S.customers || []).forEach(function(c){
      if(!c.cdEmailLangManual || !c.cdEmailLang){
        c.cdEmailLang = cdRecommendLang(c.country);
        n++;
      }
    });
    persist();
    toast('✅ 已根据国家自动推荐 ' + n + ' 个客户的语言');
    renderView();
  };

  // ============================================================
  // Rendering
  // ============================================================
  function cdRenderPage(root){
    var stats = cdLangStats();
    var h = '';

    h += '<div class="flex-between mb16">';
    h += '<div><h2 style="margin:0">🌍 多语言中心</h2>'
      + '<div class="text-sm text-muted" style="margin-top:4px">按国家自动推荐开发信语言 · 阿语RTL · 批量设置 · 全程不自动发送</div></div>';
    h += '<button class="btn btn-primary" onclick="cdBulkAutoLang()">⚡ 一键按国家自动推荐全部客户</button>';
    h += '</div>';

    // ── Stats cards ──────────────────────────────────────
    h += '<div class="cdml-stats">';
    CD_LANGUAGES.forEach(function(l){
      var s = stats.perLang[l.code] || { customers:0, emails:0, generatedEmails:0 };
      h += '<div class="cdml-stat">'
        + '<div class="cdml-stat-flag">' + l.flag + '</div>'
        + '<div class="cdml-stat-native">' + esc(l.nativeLabel) + '</div>'
        + '<div class="cdml-stat-num">' + s.customers + ' <small>客户</small></div>'
        + '<div class="cdml-stat-sub">' + s.generatedEmails + '/' + s.emails + ' 封开发信已生成</div>'
        + (l.rtl ? '<div class="cdml-rtl-tag">RTL</div>' : '')
        + '</div>';
    });
    h += '</div>';

    // ── Mapping table ─────────────────────────────────────
    h += '<div class="cdml-card">';
    h += '<div class="cdml-card-t">🗺️ 国家 → 语言映射表</div>';
    h += '<table class="cdml-table"><thead><tr><th>语言</th><th>覆盖国家/地区</th><th>方向</th></tr></thead><tbody>';
    // Group countries by language
    var byLang = {};
    for(var k in CD_COUNTRY_LANG_MAP){
      var code = CD_COUNTRY_LANG_MAP[k];
      // skip duplicate entries (we have both zh and en names) — just collect unique display names
      byLang[code] = byLang[code] || [];
      // only show English-ish keys (skip Chinese-only keys to avoid duplication)
      if(/^[a-z]/i.test(k) && byLang[code].indexOf(k) < 0) byLang[code].push(k);
    }
    CD_LANGUAGES.forEach(function(l){
      var countries = byLang[l.code] || [];
      h += '<tr>'
        + '<td>' + l.flag + ' ' + esc(l.nativeLabel) + '</td>'
        + '<td class="cdml-countries">' + (countries.length ? countries.map(esc).join('、') : '（其余所有国家默认英语）') + '</td>'
        + '<td>' + (l.rtl ? '↔ RTL (右起)' : 'LTR (左起)') + '</td>'
        + '</tr>';
    });
    h += '</tbody></table>';
    h += '<div class="cdml-note">⚠️ 巴西实际官方语言为葡萄牙语，当前按需求先用西语覆盖，待确认后切换为 pt。</div>';
    h += '</div>';

    // ── Per-customer language list ────────────────────────
    h += '<div class="cdml-card">';
    h += '<div class="cdml-card-t">👥 客户语言设置（共 ' + stats.total + ' 个客户）</div>';
    if(!(S.customers || []).length){
      h += '<div class="cdml-empty">客户台账为空。请先在客户模块导入或生成客户。</div>';
    }else{
      h += '<table class="cdml-table"><thead><tr><th>客户</th><th>国家</th><th>推荐语言</th><th>当前语言</th><th>操作</th></tr></thead><tbody>';
      (S.customers || []).forEach(function(c){
        cdEnsureCustomerLang(c);
        var rec = cdRecommendLang(c.country);
        var cur = c.cdEmailLang;
        var meta = cdGetLangMeta(cur) || {};
        var recMeta = cdGetLangMeta(rec) || {};
        var overridden = cur !== rec;
        h += '<tr>'
          + '<td>' + esc(c.company || c.name || '未命名') + '</td>'
          + '<td>' + esc(c.country || '—') + '</td>'
          + '<td>' + (recMeta.flag||'') + ' ' + esc(recMeta.nativeLabel||rec) + '</td>'
          + '<td>' + (meta.flag||'') + ' ' + esc(meta.nativeLabel||cur)
            + (overridden ? ' <span class="cdml-override-tag">手动覆盖</span>' : '') + '</td>'
          + '<td><select class="cdml-sel" onchange="cdSetCustomerLang(\'' + c.id + '\',this.value)">';
        CD_LANGUAGES.forEach(function(l){
          h += '<option value="' + l.code + '"' + (l.code === cur ? ' selected' : '') + '>'
            + l.flag + ' ' + esc(l.nativeLabel) + (l.code === rec ? '（推荐）' : '') + '</option>';
        });
        h += '</select></td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div>';

    h += '<div class="cdml-footer">🔒 本中心只设置客户的开发信语言偏好，不自动发送邮件/WhatsApp。实际生成在「开发信引擎」页进行。</div>';

    root.innerHTML = h;
  }

  // ── renderView interception ───────────────────────────────
  var _cdmlOrigRV = window.renderView;
  window.renderView = function(){
    if(currentView === 'customerDevMultilingual'){
      cdRenderPage(document.getElementById('mainContent'));
      return;
    }
    if(_cdmlOrigRV) _cdmlOrigRV.apply(this, arguments);
  };

  // ── Styles (cd- prefixed, cdml- sub-namespace) ───────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.cdml-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px;}'
    + '.cdml-stat{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;text-align:center;position:relative;}'
    + '.cdml-stat-flag{font-size:26px;}'
    + '.cdml-stat-native{font-size:13px;font-weight:700;color:#2d3748;margin:4px 0;}'
    + '.cdml-stat-num{font-size:22px;font-weight:800;color:#3182ce;}'
    + '.cdml-stat-num small{font-size:12px;font-weight:400;color:#a0aec0;}'
    + '.cdml-stat-sub{font-size:11px;color:#718096;margin-top:4px;}'
    + '.cdml-rtl-tag{position:absolute;top:8px;right:8px;font-size:10px;background:#fed7d7;color:#c53030;padding:1px 6px;border-radius:8px;font-weight:700;}'
    + '.cdml-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px;}'
    + '.cdml-card-t{font-size:14px;font-weight:700;color:#2d3748;margin-bottom:12px;}'
    + '.cdml-table{width:100%;border-collapse:collapse;font-size:12.5px;}'
    + '.cdml-table th,.cdml-table td{padding:8px 10px;border-bottom:1px solid #edf2f7;text-align:left;vertical-align:top;}'
    + '.cdml-table th{background:#f7fafc;color:#4a5568;font-weight:600;}'
    + '.cdml-countries{color:#4a5568;line-height:1.7;}'
    + '.cdml-note{font-size:11.5px;color:#975a16;background:#fffaf0;padding:8px 10px;border-radius:6px;margin-top:10px;}'
    + '.cdml-empty{padding:24px;text-align:center;color:#a0aec0;}'
    + '.cdml-sel{padding:4px 8px;border:1px solid #cbd5e0;border-radius:6px;font-size:12px;}'
    + '.cdml-override-tag{display:inline-block;font-size:10px;background:#fefcbf;color:#975a16;padding:1px 6px;border-radius:8px;margin-left:4px;}'
    + '.cdml-footer{margin-top:8px;padding:12px;background:#fff5f5;border:1px solid #fed7d7;border-radius:10px;text-align:center;font-size:12px;color:#c53030;}'
    ;
  document.head.appendChild(style);
})();
