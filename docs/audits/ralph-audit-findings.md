# dsh-douyin-agent 全面审查 findings（Ralph 循环单一事实源）

- 起点：ea3e930，分支 feat/backlog-status-redesign。
- 本文件由每轮 worker 更新：完整性矩阵 → 问题清单 → 修复记录 → 剩余覆盖。
- 基线：全量 `node --test tests/*.test.mjs` ≈ 1381 pass / 10 fail（真实 Edge、ffmpeg、F:\codex 三类环境性）。

## 一、功能完整性矩阵（维度 0）

图例：✅已实现 ｜ ⚠️部分实现/漂移 ｜ ❌缺口（F=本轮就地修，D=待用户裁决）｜ 🚫红线

| # | 功能 | UI 入口/文案承诺 | 前端调用 | 后端路由/服务 | 测试 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 模型连接 | 基础设置卡（下拉×2） | model autosave | POST /model/configure（native-settings.mjs:81） | native-model-settings 等 | ✅ |
| 2 | 人格卡编辑 | textarea + 载入最新 | persona autosave | POST /persona/configure（:73） | persona-memory | ✅ |
| 3 | 字数/token 预算条（2000 黄 3000 红，不阻断） | 方案:26 + 预览稿:206-217 | 纯前端 | 无需后端 | 无 | ❌F1 未实现（实装只有字数 client.js:436）→ 本轮补齐 |
| 4 | 人设自动补写 | 开关占位（client.js:439 恒 false，标注「后续批次接入」） | 无 | persona.autowrite 不存在 | 无 | ⚠️D1 有意缓行（UI 已诚实标注），缺口清单待裁决 |
| 5 | 自主观看开关/启停 | 视频观看卡 | /watch/schedule | :66 → ScheduledWatch | native-watch | ✅ |
| 6 | 观看时段单行分隔（斜杠/空格/逗号/换行） | client.js:460 文案 + 方案:27 | /video/configure | video-limits.savePolicy | video-limits | ❌F2 list()（client.js:273）只切 `[\n,;，；]+`，按文案输入必报错 → 本轮修 |
| 7 | 观看主题单行分隔 | client.js:474 同承诺 | /watch/options | watch-options | watch-options | ❌同 F2 → 本轮修 |
| 8 | 时段预设排序（全天→谷→晚间） | 方案 v2.3 ① | client.js:457-459 | — | — | ✅ |
| 9 | 静默观看 | 开关贴标题 | /mode/configure | :89 | — | ✅ |
| 10 | 「换一批推荐」按钮 | 预览稿:237 | 无 | 方案表格无契约 | 无 | ⚠️D2 预览/方案矛盾，待裁决（不擅自加） |
| 11 | 好友互动总开关 | 好友互动卡开关 | /interactions/configure（client.js:484） | native-settings.mjs:80 | native-client(mock) | ❌F3 硬伤：transport `writes` 白名单缺该路由（native-settings-transport.mjs:6），DSH RPC 模式点击即 400 → 本轮修 |
| 12 | 许可名单 CRUD | 勾选+保存 | /chat/contacts + /chat/configure | :103,:107 configureContacts | native-client:233 | ✅ |
| 13 | 群聊响应昵称 | client.js:498 输入行 | /chat/configure groupMentionNames | chat-service 消费 | chat-permissions | ✅ |
| 14 | 待答五态卡 | 五态胶囊+服务端裁剪按钮 | /chat/unanswered(+resolve/end/retry) | :42,:104-106 | chat-unanswered* | ✅ |
| 15 | 待答已等待时长+下次尝试 | 方案:28 + 预览稿:282 | —（后端已透出 nextRetryAt，chat-service.mjs:343） | 已透出 | 无 | ❌F4 前端未渲染 → 本轮补 |
| 16 | 立即尝试（retry） | 实装文案「安全重新检查」 | /chat/unanswered/retry | :106 | chat-unanswered | ✅（文案差异但行为对应，不修） |
| 17 | 回复处理记录/最近分享 | details 行 | state.chat/share | — | — | ✅ |
| 18 | 足迹列表 /watched | 观看足迹 tab | loadWatched | :48 → persona-memory.watched（days 1-90 校验 :319） | persona-memory | ✅ |
| 19 | DSH connection.fetch 足迹注册 | — | GET /watched?days | 注册为 POST（native-settings-transport.mjs:82） | 无 | ❌F5 method 不匹配 → 本轮修 |
| 20 | 封面缩略图（三级回退） | 预览稿:340、client.js:527 文字占位「封面截图」 | 无 /thumb 调用 | 无 /thumb；帧缓存仅内存 60s TTL（video-storyboard.mjs:93） | 无 | ❌F6 文案不实（本轮改「暂无封面」）+ D3 链路缺口待裁决 |
| 21 | 足迹文案「封面来自本机观察缓存」 | client.js:521 | — | 无持久缓存 | 无 | ❌并入 F6 文案修正 |
| 22 | 记忆管理四区 | 预览稿:角色卡/时间线/清理/原始记录 | 实装：角色卡指针/兴趣/观察/快照 | 清理（memory.forget）未接；未走宿主 memory.* | 无 | ⚠️D4 信息架构漂移，待裁决 |
| 23 | 打开记忆文件夹按钮 | client.js:534 文案承诺开文件夹 | /browser/open（开抖音页） | :71 | — | ⚠️D5 文案≠行为，但 aa594c3 已裁决折中，待用户裁决 |
| 24 | 公开评论开关/上限/统计 | 公开评论卡 | /comments/configure | :99 | autonomous-comments | ✅ |
| 25 | 待核对评论 | dy-inner | /comments/resolve | :100 | — | ✅ |
| 26 | 音频后端 Whisper/MiMo/MiniMax | 下拉 | /media/configure | :116 白名单 | media | ✅ |
| 27 | Magpie 云端选项 | 方案:32 + 预览稿:427 | 无 | 全库无实现（media 白名单均无） | 无 | ❌F7=D6 大改，缺口清单待裁决 |
| 28 | 日报生成/按日读取 | 观看日报卡 | /reports/generate + /reports/read?date | :119/:41 | daily-report | ✅（transport 经 client.js:184 与 transport:7 双 regex 放行，routes Set 未列，一致性瑕疵记录） |
| 29 | 日报 Markdown 渲染 | 预览稿:434 | pre-wrap 纯文本（client.js:572） | — | — | ⚠️D7 渲染器选型待裁决 |
| 30 | 自检/修复/复制 | 自检卡 | /diagnostics(+repair) | :59-64 | diagnostics* | ✅ |
| 31 | 前端错误环 | 最近前端错误卡 | window error + sessionStorage | 纯前端 | — | ✅ |
| 32 | 今日用量 2×2 | 自检与用量卡 | state.usage | :38 | — | ✅ |
| 33 | 状态摘要跳转按钮 | client.js:419 文案「查看待答」 | setCategory(summary.tab) | — | — | ❌F8 tab 为基础设置/视频观看时文案错误 → 本轮修 |
| 34 | desktop 足迹数据 | desktop main.jsx:298 调 /api/douyin-browser/watched | 同左 | **app.mjs 无该前缀路由（仅 /api/reports/read）** | desktop 测试未覆盖 | ❌F9 desktop 足迹必报错 → 本轮修 |
| 35 | 红线项（SMS/QR、自动发布、自动点赞、轮询参数群） | — | — | — | — | 🚫红线，不做 |

## 二、问题清单（编号 / 证据 / 状态）

| 编号 | 证据（文件:行号） | 影响 | 状态 |
| --- | --- | --- | --- |
| F1 | client.js:436（只有字数）；方案:26；预览稿:206-217 | 承诺的预算条缺失，长人格卡无压缩预警 | 本轮修 |
| F2 | client.js:273 `list=/[\n,;，；]+/` vs :460/:474 承诺「斜杠或空格分隔」；方案:27 | 按文案输入「09:00-12:00 / 14:00-18:00」必报「时段请填写完整」 | 本轮修 |
| F3 | native-settings-transport.mjs:6 writes 缺 `interactions/configure`；client.js:484 调用；native-settings.mjs:80 case 存在 | DSH RPC 模式好友互动总开关点击必 400 | 本轮修 |
| F4 | chat-service.mjs:343 透出 nextRetryAt；client.js:344-373 未渲染 | 待答卡缺「已等待/下次尝试」承诺信息 | 本轮修 |
| F5 | native-settings-transport.mjs:82 `/watched?days=14` 注册为 POST | DSH carrier-fetch 模式足迹 method 不匹配 | 本轮修 |
| F6 | client.js:527 恒显「封面截图」、:521「封面来自本机观察缓存」；video-storyboard.mjs:93 60s TTL 内存缓存 | 文案承诺有封面，实际无封面链路 | 本轮文案改诚实；链路=D3 |
| F7 | 全库 grep magpie 仅方案文档命中 | 承诺的音频后端不存在 | =D6 待裁决 |
| F8 | client.js:419 固定文案「查看待答」+ summary.tab 可为基础设置/视频观看（:394-396） | 跳转目标与文案不符 | 本轮修 |
| F9 | desktop/ui-api/src/main.jsx:298 vs app.mjs 全文无 /api/douyin-browser/* | desktop 足迹面板永远报错 | 本轮修 |
| M1 | client.js routes Set（:9）缺 /reports/read，经 :184 regex 放行 | 三方一致性口径瑕疵，功能可用 | 不修（行为正确，记录） |
| M2 | PANEL_CSS 定义 dy-sep/dy-btn/dy-perm 未被 JSX 使用 | 死代码但为预览稿冻结契约 | 不修（宪法 2.1 冻结契约，保留） |
| M3 | spark/* 留在 routes Set 与 OPERATIONS | 无 UI 入口，后端 410 防线 | 不修 |

## 三、缺口清单（2026-11-08 第二批裁决更新）

| 编号 | 内容 | 裁决 | 说明 |
| --- | --- | --- | --- |
| D1 | persona.autowrite 定时补写 | ⏸ 挂起待语义裁决 | 发现设计冲突：原契约「在人格卡末尾补一段观察」与「只有用户明确保存才能修改手编区」（saveManualText explicit 防线，persona-memory.mjs:339）冲突；生成区本已随观察自动同步（syncCard:262），再追加即重复。两个可行语义：a) 改为「控制 context() 是否注入生成区观察列表」（防上下文膨胀，不写卡，只影响喂给模型的上下文）；b) 生成区内新增专用补写段（需新标记区+预算检查+同步保护）。等用户选定后实施。 |
| D2 | 「换一批推荐」按钮 | 🚫 不做 | 预览稿与方案文档矛盾、语义未定，维持现状。 |
| D3 | 足迹封面链路（/thumb） | ⏸ 暂缓（下一批） | 250-400 行 + 帧缓存持久化有隐私面（磁盘落盘、清理上限），需单独批次与隐私评估。 |
| D4 | 记忆管理对齐预览稿（清理/时间线搜索/结构化编辑） | ⏸ 暂缓 | 依赖宿主 memory.* 能力核实；信息架构漂移不阻塞使用。 |
| D5 | 「打开记忆文件夹」按钮 | ✅ D5a 已修（ba2c28a） | 文案诚实化为「打开抖音」+ 说明改为「记忆文件在抖音页面旁的本机目录」；OPERATIONS 标签同步。 |
| D6 | Magpie 音频后端 | ⏸ 挂起待前置核实 | 前置事实无法本机核实：Magpie（GLM 系）chat API 是否支持音频输入（input_audio content part）不能凭猜测实现（AGENTS.md 不编造 API）。需先在真实 Magpie 端点验证音频请求合同，再决定走 OpenAI 兼容 chat-audio 还是宿主 llm 服务桥接。 |
| D7 | 日报 Markdown 渲染 | ✅ 已修（ba2c28a） | 复用 DSH 原生 `MarkdownText` 原语（与 Button 同一 primitives 包，无需自写渲染器，GFM+TeX+不信任内容防护自带）；labels 中文化；原语不可用时回落纯文本 pre-wrap。 |

## 四、修复记录（第 1 轮，2026-11-08）

| 提交 | 内容 | 验证 |
| --- | --- | --- |
| f320ddf | F3 transport writes 补 `interactions/configure`；F5 `/watched?days=14|30` 注册改 GET；新增 tests/native-settings-transport.test.mjs（纯 Node 白名单单测 2 项） | node --check ✓；新套件 2/2 绿 |
| 4171c8c | F2 时段/主题 `list()` 分隔符归一化（`[\s,;，；/]+`，昵称保持窄分隔）；F4 retrying 待答卡渲染已等待/下次尝试（chat-service 已透出的 nextRetryAt 接上）；F1 人格卡字数/token 预算条（2000 黄/3000 红/不阻断，纯前端）；F8 状态摘要按钮文案跟随 tab（好友互动→查看待答，其余→去处理）；F6 足迹占位文案改「暂无封面」+说明改「封面缓存尚未接入」；native-client.test.mjs 同步 8 处断言 | node --check ✓；括号栈扫描 OK；native-client 6/6 绿（真机 Edge） |
| d21dea1 | F9 app.mjs 补 `GET /api/douyin-browser/watched`（desktop 足迹面板此前必报错）；watch-http.test.mjs 加路由测试（token 403、聚合协议、days 90 边界、非法 days 回落） | watch-http 3/3 绿 |

- 定向套件：backlog-state-api + friend-ui-races + persona-memory 31 绿；native-settings-transport 2 绿；watch-http 3 绿；native-client 6 绿（Edge）；desktop ui-api 30 绿（重建 gitignored dist 后）。
- 括号平衡：node --check exit 0 + 逐字符栈扫描 OK（临时脚本已删）。
- dy-* 一致性扫描：无 CSS 缺失 class；dy-sep/dy-btn/dy-perm 为预览稿冻结契约死代码（M2，保留）。

## 五、剩余覆盖范围

- 维度 0-7 首轮核对完成：矩阵 35 项无「未核实」；F1-F6/F8/F9 已修；D1-D7 待用户裁决（清单见上）。
- 全量基线（2026-11-08，含新增 3 测试）：1404 tests / 1385 pass / 9 fail / 3 cancelled / 7 skipped；12 个非通过项全部为三类环境性失败（真实 Edge×5、ffmpeg×5、外部 QQ 目录 `D:\总数据库\聊天机器人` 路径×2 含 3 cancelled），失败数不高于基线（10），无回归。
- 维度 4 setter 核对：26 组 useState 解构与全部 setXxx 引用配对（setInterval/setItem/setTimeout 为宿主 API 误报）。
- 维度 2 三方一致性机械核对：client routes ↔ transport writes ↔ native-settings case 零断链。
- 交付链路：提交已 push origin（ea3e930..ece3496）；live junction `C:\Users\LoKi\.dsh\profiles\desktop\node_modules\dsh-douyin-browser-local` 指回仓库，native-settings-transport.mjs / client.js / app.mjs 与 HEAD 字节一致。
- 环境性不碰：真实 Edge、ffmpeg、F:\codex（verification/native-settings.test.mjs、settings-transport.test.mjs 因 SDK 路径整文件跳过属正常）。
- 后续轮次候选：D1-D7 等用户裁决；desktop 记忆管理页（main.jsx:442）仅为跳转占位与插件端漂移核对。

## 六、终版结论（第 2 轮父会话收口验收，2026-11-08）

- 抽查修复落盘属实：native-settings-transport.mjs:6（interactions/configure）、:7（watched GET）；app.mjs:274（desktop watched 路由）；client.js:535（「暂无封面」诚实文案）。
- 验收复跑：定向纯 Node 五套件 36/36 绿；desktop ui-api 30/30 绿（首跑出现 1 例 groupMentionNames 竞态偶发断言，连续两轮复跑全绿，判定为既有偶发非回归，不修——与插件端 friend-ui-races 同类时序测试）；native-client（真实 Edge）6/6 绿。
- 完成条件核对：维度 0-7 全覆盖；矩阵 35 项无「未核实」；清单无「确认未修」（F1-F9 已修，M1-M3 记录不修理由，D1-D7 为待用户裁决缺口非未修项）；全量基线 1385 pass / 9 fail 全环境性，不高于基线 10。
- 提交链：ea3e930 → f320ddf → 4171c8c → d21dea1 → ece3496 → c29e198，均已 push origin feat/backlog-status-redesign；live junction 字节一致（c29e198 记录）。
- 待用户裁决：缺口清单 D1-D7（见第三节），任何一项开工前需明确授权；D2/D5 语义与信息架构需先定契约。
- 结论：Ralph 循环审计任务完成。D1-D7 裁决前不再自行推进。
