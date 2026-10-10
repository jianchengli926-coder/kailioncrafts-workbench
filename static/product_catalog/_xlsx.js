/* ==================================================================
   浏览器端 xlsx 生成器（零依赖，手写 ZIP + OOXML）
   ------------------------------------------------------------------
   为什么手写：编辑器是**单文件纯前端**（要能部署成链接），
   不能引入 SheetJS 之类第三方库。而 .xlsx 本质是一个 ZIP 包
   里放几段 XML —— 用浏览器自带的 CompressionStream('deflate-raw')
   就能压，再用「本地文件头 + 中央目录 + EOCD」拼成合法 ZIP。

   参考：ECMA-376 OOXML SpreadsheetML 最小实现。
   ⚠️ 只做「一行表头 + N 行数据 + 几个 sheet」这一种结构，
      不做样式/公式/图表（够用于产品目录）。

   兼容性考量（踩过的坑）：
   · ZIP 必须用 **deflate-raw**（CompressionStream 的 'deflate' 是 zlib 头，
     会让 Excel 报「文件已损坏」）。
   · 必须写**正确的 CRC32** —— Excel 会校验。
   · 文件名用 UTF-8 并置 general purpose flag bit 11（0x0800），
     否则中文 sheet 名乱码。
   ================================================================== */

var KCXLSX = (function () {

  /* ---------- CRC32 ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var esc = unescape(encodeURIComponent(s));
    var a = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) a[i] = esc.charCodeAt(i);
    return a;
  }

  /* ---------- ZIP 打包 ---------- */
  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }

  function zipSync(files) {
    /* files: [{name, data:Uint8Array}] —— 全存内存，一次性拼出来 */
    var chunks = [], central = [], offset = 0;
    var now = new Date(), t = dosTime(now), dt = dosDate(now);
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var nameB = utf8(f.name);
      var data = f.data;
      var crc = crc32(data);
      var nb = nameB.length, dn = data.length;

      /* 本地文件头 */
      var lh = new Uint8Array(30 + nb);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034B50, true);
      dv.setUint16(4, 20, true);            // version needed
      dv.setUint16(6, 0x0800, true);        // flag: UTF-8 名
      dv.setUint16(8, 0, true);             // method 0 = store（不压，够小且最稳）
      dv.setUint16(10, t, true);
      dv.setUint16(12, dt, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, dn, true);
      dv.setUint32(22, dn, true);
      dv.setUint16(26, nb, true);
      dv.setUint16(28, 0, true);
      lh.set(nameB, 30);
      chunks.push(lh, data);

      /* 中央目录项 */
      var ce = new Uint8Array(46 + nb);
      var cv = new DataView(ce.buffer);
      cv.setUint32(0, 0x02014B50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, t, true);
      cv.setUint16(14, dt, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, dn, true);
      cv.setUint32(24, dn, true);
      cv.setUint16(28, nb, true);
      cv.setUint32(42, offset, true);
      ce.set(nameB, 46);
      central.push(ce);

      offset += lh.length + dn;
    }
    var cdSize = 0;
    for (var k = 0; k < central.length; k++) cdSize += central[k].length;

    /* EOCD */
    var eo = new Uint8Array(22);
    var ev = new DataView(eo.buffer);
    ev.setUint32(0, 0x06054B50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    var all = chunks.concat(central, [eo]);
    var total = 0;
    for (var z = 0; z < all.length; z++) total += all[z].length;
    var out = new Uint8Array(total), pos = 0;
    for (var j = 0; j < all.length; j++) { out.set(all[j], pos); pos += all[j].length; }
    return out;
  }

  /* ---------- XLSX 组装 ---------- */
  function colName(n) {   // 1 → A
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s;
  }
  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      /* 🔴 XML 1.0 不允许这些控制字符，Excel 遇到会报「文件已损坏」 */
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }
  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /* 🔴 2026-10-05 行样式（让 Cover 有层级，不是一列裸文字）
     写法：行数组第 3 个元素是样式标记（sheet.rows 里 [k, v, st]）：
       t1 品牌大字 · t2 金色品名 · t3 弱化副题 · k 小节标题（金色）
       kv 标签/值（标签弱化灰）· d 底部小字说明 · band 浅米底通栏
     cellXfs 顺序（见 STYLES）：0 常规 · 1 表头深底 · 2 文本 · 3 品牌大字
       · 4 金色品名 · 5 弱化副题 · 6 标签灰 · 7 小节标题 · 8 底部说明
     对应关系写死在下表，新增样式时两边同步。 */
  /* ⚠️ `band` 必须在表里！漏了它→ stTag='' → 第 3 格 'band' 被当普通文字
     写进单元格里（利截图里 A/B 列右侧漏出 "band" 字样）。 */
  var ROWSTYLE = { t1: 3, t2: 4, t3: 5, kv: 6, k: 7, d: 8, band: 9 };

  /* sheet: {name, cols:[{w}], rows:[[v,...]], freeze:'D2', autofilter:true, imgs:[]} */
  function sheetXml(sh) {
    var cols = '';
    (sh.cols || []).forEach(function (c, i) {
      cols += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' +
              (c.w || 12) + '" customWidth="1"/>';
    });
    var rows = '';
    var maxR = sh.rows.length;
    var maxC = (sh.cols || []).length;
    sh.rows.forEach(function (row, ri) {
      var r = ri + 1;
      var cells = '';
      /* 🔴 2026-10-05 行样式：row[2] 是**样式标记**（'t1'/'kv'/'band'…）不是内容。
         若照旧row.forEach 全量输出，'t1' 会变成单元格里可见文字（Excel 里能看到）。
         ⇒ 有标记时只输出前 2 格；无标记（数据表）时按原样全量输出。 */
      /* 🔴🔴 2026-10-05 严重 bug（害得 Price List 只剩 2 列）：判据是
         `row[2] 是字符串` ⇒ **表头行第 3 格是 'Item No. (SKU)' 这样的列名**，
         也被判成样式标记 → `ncell=2` → 后32 列的表头与数据**全被丢掉**。
         症状：Excel 里只剩 Photo + No. 两列，"每列都缩窄了、只剩产品图"。
         正解：**白名单**判定 —— 只有 ROWSTYLE 里登记过的标记才算样式，
         其它字符串一律当普通内容。 */
      var stTag = (row.length > 2 && typeof row[2] === 'string' &&
                   typeof ROWSTYLE !== 'undefined' && ROWSTYLE[row[2]] != null)
                  ? row[2] : '';
      var stIdx = stTag ? ROWSTYLE[stTag] : 0;
      var ncell = stTag ? Math.min(2, row.length) : row.length;
      /* 🔴 2026-06-06（利反馈「A 列显示不完全」）：Cover/Contents/Terms 三张表
         的列定义是 [窄边距3, 标签 30, 值 92]（留白边），但数据数组是从第 0 格
         开始的 ⇒ 标签被写进**宽度只有 3 的A 列**里，看起来"挤在一列、显示不全"。
         `padLeft` 让这三张表的数据前面补一个空列，标签正好落到 B 列。
         Price List 不设 padLeft（它没有窄边距列）。 */
      var off = sh.padLeft ? 1 : 0;
      for (var ci = 0; ci < ncell; ci++) {
        var v = row[ci];
        var col = colName(ci + 1 + off);
        if (v == null || v === '') continue;
        var ref = col + r;
        /* 🔴 字符串单元格必须带 t="inlineStr"。
           之前这里写成 `isHead ? ' s="1"' : ' t="inlineStr"'` ——
           表头既带样式又没带 t，Excel/openpyxl 会当成数值单元格，
           读出来是 None（「Item No. (SKU) is not in list」就是这么来的）。
           ⇒ 样式与类型是两个独立属性，必须分别决定。 */
        var isHead = (r === 1 && sh.header !== false && !stTag);
        var tAttr = isNum(v) ? '' : ' t="inlineStr"';
        /* 🔴 2026-10-07：数据行（无样式标记、非表头）用 s=10（换行+顶对齐）。
           原来走 s=0（无 wrapText）⇒ 文字横向溢出到右侧空单元格，
           「O/P 两列有的连在一起、有的分开」，长内容还被邻格挤掉。
           仅数据行改；Cover/Contents/Terms 的普通行仍走 s=0，不受影响。 */
        var sAttr = isHead ? ' s="1"'
                  : (stIdx ? (' s="' + stIdx + '"')
                          : (sh.wrapCells ? ' s="10"' : ''));
        var body = isNum(v) ? ('<v>' + v + '</v>')
                            : ('<is><t xml:space="preserve">' + xmlEsc(v) + '</t></is>');
        cells += '<c r="' + ref + '"' + sAttr + tAttr + '>' + body + '</c>';
      }
      /* 'band' 行铺满浅米底（补空样式格撑出通栏色带） */
      if (stTag === 'band') {
        var nCol = Math.max(3, (sh.cols || []).length);
        for (var bc = 1 + off; bc <= nCol; bc++) {
          if (cells.indexOf('r="' + colName(bc) + r + '"') < 0) {
            cells += '<c r="' + colName(bc) + r + '" s="9"/>';
          }
        }
      }
      var ht = (sh.rowHeights && sh.rowHeights[ri]) ? sh.rowHeights[ri] : '';
      if (stTag === 't1') ht = 34;
      else if (stTag === 't2') ht = 22;
      else if (stTag === 't3') ht = 16;
      else if (stTag === 'band') ht = 20;
      else if (stTag === 'k') ht = 22;
      else if (stTag === 'd') ht = 30;
      rows += '<row r="' + r + '"' +
              (ht ? ' ht="' + ht + '" customHeight="1"' : '') +
              '>' + cells + '</row>';
    });
    /* 🔴 OOXML 层级：<sheetViews> 里才是 <sheetView>。
       之前直接写 <sheetView workbookViewId=…>（漏了外层 <sheetViews>），
       包能打开、数据能读，但**冻结窗格被Excel/openpyxl 静默忽略**（读出 None）。
       冻结是欧美买家最实用的功能（SKU 列要常驻可见），必须写对。 */
    var paneXml = '';
    if (sh.freeze) {
      var m = /^([A-Z]+)(\d+)$/.exec(sh.freeze);
      if (m) {
        var cIdx = 0, letters = m[1];
        for (var i = 0; i < letters.length; i++) cIdx = cIdx * 26 + (letters.charCodeAt(i) - 64);
        paneXml = '<pane xSplit="' + (cIdx - 1) + '" ySplit="' + (m[2] - 1) +
                  '" topLeftCell="' + sh.freeze + '" activePane="bottomRight" state="frozen"/>' +
                  '<selection pane="bottomRight" activeCell="' + sh.freeze +
                  '" sqref="' + sh.freeze + '"/>';
      }
    }
    var view = '<sheetViews><sheetView workbookViewId="0"' +
               (sh.zoom ? ' zoomScale="' + sh.zoom + '" zoomScaleNormal="' + sh.zoom + '"' : '') +
               '>' + paneXml + '</sheetView></sheetViews>';
    var af = (sh.autofilter && maxR > 1)
      ? '<autoFilter ref="A1:' + colName(maxC) + maxR + '"/>' : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (cols ? '<cols>' + cols + '</cols>' : '') +
      view +
      '<sheetData>' + rows + '</sheetData>' +
      af +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>' +
      '</worksheet>';
  }

  /* styles.xml —— 只定义 3 个样式：0=常规 1=表头(深底白字粗体) 2=货币 3=文本 */
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="5">' +
      /* 0 正文灰 · 1 表头白 */
      '<font><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      /* 2 品牌大字 26 · 3 金色品名 14 · 4 弱化灰 10 */
      '<font><b/><sz val="26"/><color rgb="FF1B2A41"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="14"/><color rgb="FFC8A24B"/><name val="Calibri"/></font>' +
      '<font><sz val="10"/><color rgb="FF9AA3AE"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="4">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1B2A41"/>' +
        '<bgColor indexed="64"/></patternFill></fill>' +
      /* 3 浅米底通栏带（与 PDF 目录同一套品牌色） */
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF7F5F0"/>' +
        '<bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    /* 顺序即 s 索引，ROWSTYLE 按此对应：
       0 常规 · 1 表头深底 · 2 文本 · 3 品牌大字 · 4 金色品名
       5 弱化副题 · 6 标签灰 · 7 小节标题 · 8 底部说明 · 9 米底色带
       🔴 2026-10-07（利反馈「O/P 两列有的连在一起有的分开、M 列被收窄」）：
       10 数据单元格（换行 + 顶对齐）—— 数据行原先用 s=0，**没有 wrapText**，
          文字会横向溢出到右侧空单元格，于是「溢出到邻格」的行看起来两列连成一片、
          不溢出时又分得很开，整张表观感很乱（且长内容被邻格挤掉看不见）。
          加上wrapText 后每个格子自己折行，列与列的界线始终干净。
          ⚠️ 换行的前提是行高够 —— 见 sheetXml 里的 rowHeights 计算。*/
    '<cellXfs count="11">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1">' +
        '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' +
        '<alignment wrapText="1" vertical="top"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +
      /* 10 🔴 数据单元格（2026-10-07 建 / 10-08 调对齐）：换行 + **上下左右居中**。
         数据行原先用 s=0（无 wrapText）⇒ 文字横向溢出到右侧空单元格，
         于是有的行「两列连成一片」、有的行分得很开；而且长内容被邻格挤掉看不见。
         换行后每格自己折行，列界始终干净。⚠️ 前提是行高够 —— 见 sheetXml 的行高计算。

         🔴 2026-10-08（利：「初始状态在左上角/左下右上角，改成上下左右居中好看」）：
         对齐从 `vertical="top"`（水平仍是默认左对齐）⇒ **`horizontal="center" vertical="center"`**。
           · 实测改前：数据行 4420 个单元格 h=None(默认左) + v=top —— 与利描述的「左上角」一致。
           · 表头用的是 s=1，本来就center/center，**不受影响**。
           · 只动 s=10 这一个索引（由 `sh.wrapCells` 开关限定**仅 Price List 数据行**使用），
             Cover / Contents / Terms 三张表与其它 10 个样式索引一列没碰。
           · 表内**没有任何合并单元格**（无 mergeCells）⇒ 不存在「合并后居中」的特殊情况。
           · 图片是 `oneCellAnchor` + 固定 `ext`(96×96)，位置由锚点与 ext 决定，
             **与单元格对齐无关** ⇒ 改对齐不会让缩略图移位或变形（已实测核对）。*/
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
        '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* ---------- 图片嵌入 ----------
     xlsx 里的图走标准 OOXML 结构（4 个部件）：
       xl/media/<n>.jpg · xl/drawings/drawing1.xml · xl/drawings/_rels/drawing1.xml.rels
       · <drawing r:id> 挂在 worksheet
     用 **twoCellAnchor**（两点锚定）而不是 oneCellAnchor ——
     前者把图「钉」在两个单元格之间，缩放/换行时不会错位（oneCellAnchor 会飘）。
     ⚠️ 尺寸单位 EMU：1 px = 9525 EMU（96dpi）。 */
  var EMU = 9525;

  function drawingXml(imgs, anchor) {
    /* imgs: [{rId,file,rid,row,col,w,h}] —— row/col 是 0-based 网格坐标
       🔴 2026-10-05 换 oneCellAnchor：
       twoCellAnchor 会**用 from/to 两个锚点推算尺寸**、忽略 a:ext，
       于是图被拉成整个单元格大小（实测变成 200×200，撑满 78pt 行高 + 16 宽列）
       —— 既不统一也压行高。oneCellAnchor 尊重 ext，图就是设定的 96×96，
       行高/列宽变化也不影响它。 */
    var anchors = imgs.map(function (im, k) {
      var col = (im.col || 0), row = (im.row || 0);
      return '<xdr:oneCellAnchor>' +
        '<xdr:from><xdr:col>' + col + '</xdr:col><xdr:colOff>28575</xdr:colOff>' +
        '<xdr:row>' + row + '</xdr:row><xdr:rowOff>28575</xdr:rowOff></xdr:from>' +
        '<xdr:ext cx="' + (im.w * EMU) + '" cy="' + (im.h * EMU) + '"/>' +
        '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (k + 2) + '" name="Picture ' + (k + 1) + '"/>' +
        '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
        '<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
        'r:embed="' + im.rId + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
        '<xdr:spPr><a:xfrm><a:off x="0" y="0"/>' +
        '<a:ext cx="' + (im.w * EMU) + '" cy="' + (im.h * EMU) + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>' +
        '<xdr:clientData/></xdr:oneCellAnchor>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' + anchors + '</xdr:wsDr>';
  }

  function drawingRels(imgs) {
    var r = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    imgs.forEach(function (im) {
      r += '<Relationship Id="' + im.rId + '" ' +
           'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
           'Target="../media/' + im.file + '"/>';
    });
    return r + '</Relationships>';
  }

  /* sheet.imgs: [{data:Uint8Array, row, col, w, h}]  */
  function build(sheets) {
    var files = [];
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    sheets.forEach(function (s, i) {
      ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
            '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    });
    ct += '</Types>';

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var wbs = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    sheets.forEach(function (s, i) {
      wbs += '<sheet name="' + xmlEsc(s.name) + '" sheetId="' + (i + 1) +
             '" r:id="rId' + (i + 1) + '"/>';
    });
    wbs += '</sheets></workbook>';

    var wbr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    sheets.forEach(function (s, i) {
      wbr += '<Relationship Id="rId' + (i + 1) +
             '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
             (i + 1) + '.xml"/>';
    });
    wbr += '<Relationship Id="rId' + (sheets.length + 1) +
           '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
           '</Relationships>';

    files.push({ name: '[Content_Types].xml', data: utf8(ct) });
    files.push({ name: '_rels/.rels', data: utf8(rels) });
    files.push({ name: 'xl/workbook.xml', data: utf8(wbs) });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: utf8(wbr) });
    files.push({ name: 'xl/styles.xml', data: utf8(STYLES) });

    /* ===== 图片嵌入 ===== */
    var imgN = 0;
    var relRid = sheets.length + 2;         // 前面已用掉1..len+1
    sheets.forEach(function (s, i) {
      var imgs = s.imgs || [];
      var xml = sheetXml(s);
      var media = [], drels = [], anchors = [];
      imgs.forEach(function (im, k) {
        var ext = (im.type === 'png') ? 'png' : 'jpg';
        var fn = 'image' + (imgN + 1) + '.' + ext;
        var rId = 'rIdImg' + (k + 1);
        media.push({ name: 'xl/media/' + fn, data: im.data });
        anchors.push({ rId: rId, file: fn, row: im.row || 0, col: im.col || 0,
                       w: im.w || 100, h: im.h || 100 });
        imgN++;
      });
      if (media.length) {
        /* worksheet 末尾挂<drawing>（schema 要求 drawing 在 pageSetup 之后）*/
        var dRid = 'rIdDraw';
        xml = xml.replace('</worksheet>',
          '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
          'r:id="' + dRid + '"/></worksheet>');
        /* worksheet 的 .rels 里加 drawing 关系 */
        var wsRel = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="' + dRid + '" Type="http://schemas.openxmlformats.org/' +
          'officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + (i + 1) + '.xml"/>' +
          '</Relationships>';
        files.push({ name: 'xl/worksheets/_rels/sheet' + (i + 1) + '.xml.rels', data: utf8(wsRel) });
        files.push({ name: 'xl/drawings/drawing' + (i + 1) + '.xml', data: utf8(drawingXml(anchors)) });
        files.push({ name: 'xl/drawings/_rels/drawing' + (i + 1) + '.xml.rels',
                     data: utf8(drawingRels(anchors)) });
        media.forEach(function (m) { files.push(m); });
      }
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: utf8(xml) });
    });
    return zipSync(files);
  }/*@@IMG@@*/

  function download(bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); try { a.remove(); } catch (e) {} }, 1500);
  }

  return { build: build, download: download, colName: colName };
})();
