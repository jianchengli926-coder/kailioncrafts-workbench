# KaiLionCrafts 工作台 · 交接笔记（HANDOVER）

> 给下一个聊天窗口的我读这个文件就能完全接上。不用翻历史。

## 这是什么
阳江刀剪 B2B 出口企业 KaiLionCrafts 的 Streamlit 外贸企业 AI 工作台。
单文件 `app.py`（约7500行）+ SQLite + JSON，已迭代到 v3。

## 项目位置与启动
- 根目录：`/Volumes/Kingston 1TB NV1 40Gbps/豆包独立站SEO项目/00_AI标准化知识库/AI客户开发工作台/`
- 启动：`python3 -m streamlit run app.py --server.port=8501 --server.address=0.0.0.0 --server.headless true`
- 日志：`/tmp/streamlit.log`
- 公网：Cloudflare Tunnel，密码门 `441723`

## 工作规矩（每次改代码必须遵守）
1. 改前确认 git 干净（`git status`）
2. 改完 `python3 -m py_compile app.py` 必须过
3. AppTest 无头验证：`at.session_state["authed"]=True`，导航 radio label 是"功能导航"
4. 重启 8501（kill 旧进程→重启→curl HTTP 200）
5. commit 后 `git push origin fresh_start`
6. 分支：`fresh_start`，远端 https://github.com/jianchengli926-coder/kailioncrafts-workbench.git
7. 重要改动前备份到 `_backup/`（gitignore）

## 关键文件
- `app.py`：主程序（仪表盘/客户中心/订单台账/社媒矩阵/独立站SEO/产品库/知识库）
- `customer_manager.py`：客户数据，`cm` 单例；客户名字段 `company_name`；现成方法 `get_follow_up_today()`、`get_overdue_follow_up()`、`set_next_follow_up()`
- `finance_db.py`：`fdb` 单例；销售订单表 `sales_orders`，状态已细化为8阶段（待生产/生产中/待验货/待装柜/已发货(在途)/已到港/已完成/已取消）；`trade_extra` JSON列存贸易条款
- `social_db.py`：4品类（Outdoor/Leo、Kitchen/Jason、Scissors/Owen、Accessories/Julia）× 8平台（含WhatsApp）
- `ai_client.py`：`ai.chat(prompt)` 调大模型
- `data/voice_profile.json`：我的语气档案（`_load_voice()`/`_save_voice()`）
- `data/factories.json`：工厂资料库
- `data/workbench.db`：SQLite（订单/采购/收付款/社媒）

## 最近已完成并推送的功能（本轮视频分析落地）
- 仪表盘加"📅 今日待跟进客户"（逾期红+今日黄）
- 客户详情加"⚡快捷话术"5按钮（报价后/样品后/出货/催款/久未联系，一键生成场景化英文邮件，带客户历史+语气档案）
- 订单状态细化为外贸物流8阶段
- 单据中心：一份订单数据出 PI/销售合同/装箱单/商业发票，另带打印版HTML（带公司抬头，Ctrl+P存PDF）
- 更早：账号矩阵三级下钻、语气档案、两步删除确认、工厂资料库、客户详情关联订单收款

## 全量代码审计修复（2026-09-15）
本轮全量读取全部10个py文件（app.py 7523行+其他9个），py_compile+AppTest验证，修复12处问题：
- **P0**：个性化开发信存档客户字段名 bug（name→company_name）；今日待办checkbox只保存最后一项；设置中心API Base字段名错；feishu test_connection假成功
- **P1**：订单默认状态从"询价"改为"待生产"对齐8阶段；非豆包model_lite返回空；仪表盘"待跟进"指标语义修正；新增客户补D级
- **P2**：重复导入清理；仪表盘待办勾选自动保存；旧状态值清理
- 备份：_backup/full-backup-20260915-033238/，git tag pre-full-audit-20260915-033256

## 第二轮深度审计修复（2026-09-15）
- **严重缩进错误**：团队工作空间 tab1-tab4 内容全部跑到 tab 外面（重写整个 tab 结构）；成员统计循环只显示最后一个成员
- **缩进修复**：模型管理当前使用 metric 移回 col4；客户管理 export_csv 从页面级移入 button 块（原每次加载都执行）；SEO listing 字段分配到正确列
- **样式优化**：产品库去掉每行产品后的密集 --- 分割线
- 已推送 commit 5a5fa9b

## 第三轮深度审计修复（2026-09-15）
- **销售管道**：整个页面循环/with块缩进全错（metric在col外、expander在for外、客户列表在for外、转化率在for外），重写整个页面
- **AI调用Trace**：统计和记录列表缩进全错，重写
- **博客SEO**：选题列表container缩进错
- **设置旧页面**：tab1/tab2/col1/for循环缩进全错，重写整个页面
- 已推送 commit 2838551

## 用户明确"不做"的方向（不要再提）
- 浏览器爬虫自动抓社媒/邮箱、n8n自动化、多agent专家团、PWA手机端、权限系统、BI中心
- 不加一级导航（导航已经够多）
- B2C跨境电商那套（选品/铺货/ACOS/FBA/退货率）——他是B2B刀剪，不适用
- 不要过度设计，先做能跑的最小功能

## 当前该干嘛
工作台功能已经完整闭环：客户→今日待办→快捷话术→订单(8阶段)→单据→财务→社媒→知识库。
**下一步不是再加功能，是去录真实客户和订单用一周**。用的时候哪里别扭，再回来改。
