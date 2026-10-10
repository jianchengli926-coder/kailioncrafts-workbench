KaiLionCrafts 产品目录编辑器 · 源码包
打包日期：2026-10-09
================================================================

【这是什么】
一个纯前端单文件应用 —— 没有后端、没有构建步骤、没有 npm。
打开 产品目录编辑器.html 就能用。全部逻辑都在 .js 里，可直接读。

【目录结构】
  产品目录编辑器.html      主程序：门禁密码框 + 首屏样式 + 脚本引导
  _editor_app.js           全部业务逻辑（约 290 KB，这是最重要的一个文件）
  _cloud.js                多设备同步通道（可选，见下）
  _xlsx.js                 Excel 导出
  thumbs.js                目录缩略图 base64 表
  _imgindex.json / .js     图库索引（.json 给 http，.js 给 file:// 退路）
  logo.png  qr.png         封面 / 封底素材
  scene_*.jpg              各品类封面背景图（共 8 张）
  data/kc-1bc995ca.json    数据层 —— AES-256-GCM 密文
  data/calibration.json    规格校准报告（174 条改动明细）
  data/calibration.js      同上，file:// 退路
  img/                     产品原图（333 张，PDF 内嵌用的就是这些字节）
  thumb/                   缩略图（329 张）


【怎么打开】
▸ 线上 / 任意 http(s) 环境（推荐）
  把整个 产品目录编辑器/ 目录放到网站根目录，访问
  产品目录编辑器.html。首次会要求输入 6 位密码。
  🔑 密码 = 441723

▸ 本地不想配服务器
  在该目录下执行任意一条，然后浏览器访问 http://localhost:8000/
      python -m http.server 8000
      npx serve .
  ⚠️ 不要用「双击 html」的方式打开 —— 见下面的「已知限制」。


【数据层怎么工作】
  密码 --> PBKDF2-SHA256(150000 次) --> AES-256-GCM 密钥
  用它解 data/kc-1bc995ca.json，解得开 = 密码对。
  所以密码不写在任何前端文件里，改 HTML 也没用，必须真密码。
  ⚠️ 密文文件名是硬编码的：
     _editor_app.js 第 358 行  var DATA_TOKEN = '1bc995ca';
     改文件名必须同步改这一行。


【☁️ _cloud.js 说明】
  它只在 location.protocol === 'https:' 时激活。
  本包**没有**配套的云服务应用，所以它在你的环境里会：
    尝试连接 --> Origin 不匹配 --> 失败 --> 静默回退读静态数据
  不会报错、不会卡住、不影响任何功能，等于自动停用。
  想彻底移除：删掉 _cloud.js，同时删掉
  产品目录编辑器.html 里 <script src="_cloud.js"></script> 那一行。


【已知限制】
1. 本包**不含** data/catalog.json / data/catalog.js。
   那两个是「本地双击打开」的明文退路。没有它们，双击 html 会报错。
   要用 http(s) 打开，或按上面「本地不想配服务器」起个服务。
2. kc-1bc995ca.json 是**打包当天的快照**。线上那份数据以后还会变新，
   这个包不会自动跟着变。


【不要改的红线】（都是实测踩出来的）
- 打印空白首页：@media print 里必须保留 html,body{height:auto;overflow:visible}
- file:// 下 fetch 被 CORS 拦：所以才有 *_index.js / calibration.js 这些退路，
  别把「先 fetch 再退到 script 注入」的分支删掉
- 图片不要在 canvas 里重编码：两道重编码会让整页发灰、照片变糊。
  永远走原始 Blob 字节（PDF 内嵌的就是原图字节）
- 撤销栈粒度 = 一次「聚焦→编辑→失焦」= 1 步。
  若在 input 事件里 pushUndo，每敲一个字符压一条，撤销栈会爆
- 分页是「均分」不是「每页 9 张」，改分页要同步改 pageOfIndex()，
  否则目录页码会指错


【合并到别的项目时】
  用 iframe 套整个目录最简单（同源时 JS 可互通）。
  若要把代码并进别的页面，注意 _editor_app.js 依赖 window.KC_CLOUD
  必须在它**之前**加载（见 html 尾部脚本顺序）。
