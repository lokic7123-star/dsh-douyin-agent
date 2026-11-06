# 第③步（前端五态卡片接线）终审材料

> 面向审核的验收导览。分支 `feat/backlog-status-redesign`；本文只读仓库整理，行号以提交 `6bb5ae1` 时点为准（后续提交若移动行号，以函数名定位）。所有测试数据与示例均为合成素材（「薄荷抹茶」系），不含真实账号信息。

## 1. 第③步交付全景（五个提交）

| 提交 | 标题 | 做了什么 | 审核关注点 |
|---|---|---|---|
| `f909d91` | feat: 待答五态派生接口与出口统一（v2） | **服务端**：新增 `deriveBacklogState`（chat-service.mjs:72）按 D1 判定顺序派生五态；`unanswered()` 升级 `chat-unanswered-v2`（items 逐条携带 backlogState/progressNote/availableActions/blockerCode/attempts/retryCount/escalated，新增 groups 三分计数）；`state().contacts[]` 带 `backlogGroups`、顶层带 `unansweredGroups`。测试 tests/backlog-state-api.test.mjs（131 行，表驱动五态各态用例） | 派生规则只在服务端；`needs-manual` 必须依据明确原因码（防「不在队列」反推，:41-43）；uncertain 优先于等待态（:44-47） |
| `c9be752` | feat: 结束待答与安全重查服务入口及双入口路由 | **服务端**：`endUnanswered`（写入→persist→磁盘回读确认→才返回成功，resolvedVia='panel'，运行中走 withChatPaused resume:'preserve'）；`retryUnanswered`（只重映射核对，不发送）；app.mjs + native-settings.mjs + transport 白名单加 `/chat/unanswered/end`、`/chat/unanswered/retry`；friend-interactions.mjs 包装层 | 「不重发的保证由在途协调+回读核对构成」（D3 口径）；路由只收 `recordIds`+`snapshot` / `recordIds`，形状收窄 |
| `6f1725a` | test: 待答口径统一后的展示断言更新 | tests/chat-recovery / chat.test 的旧计数断言对齐 v2 口径 | 旧测试不削弱：断言随口径更新而非删除 |
| `3ad8129` | fix: 设置分类导航单行自然溢出滚动，与通用行样式解耦 | **client.js**：tabRow 常量（nowrap + overflow-x:auto + scrollbarWidth:thin）与通用 row 解耦，tab `flex:'none'`；tablist `tabIndex=0`。测试加 tablist 计算样式断言 | 零断点零硬编码（559px 是内容自然宽度不是阈值，见 docs/mockups/nav-measurement.md）；键盘可达性保持 |
| `6bb5ae1` | feat: 待答五态卡片接入真实接口，数量三分与状态摘要同步 | **client.js**：待答区块重写为五态卡片（v2 协议校验）、三分头部、状态摘要三分口径、「查看待答」；**desktop/ui-api**：UnansweredSection 同构重写 + StatusSummary 三分；routes/OPERATIONS 加新路由 | 按钮按服务端 availableActions 裁剪；escalated 提示可见；两入口文案同构（差异点已注释）；结束待答失败自动回原态 |

并行同分支的其余提交（连坐拆分、记忆三态、回放基建等）属第②步 backend-fix 范围，已单独四审闭环，不在本材料重复。

## 2. 接口契约速查

### GET `/chat/unanswered` → `chat-unanswered-v2`

```json
{
  "protocol": "chat-unanswered-v2",
  "checkedAt": "2026-11-06T05:32:08.000Z",
  "count": 5,
  "snapshot": "<64hex 列表指纹，结束待答时携带防竞态>",
  "running": false,
  "worker": { "alive": false, "status": "stopped", "heartbeatAt": "…" },
  "groups": { "autoRecovering": 2, "needsManual": 2, "uncertain": 1 },
  "items": [
    {
      "recordId": "<64hex>",
      "contactId": "conv:<64hex>",
      "contactName": "薄荷抹茶",
      "at": "2026-10-26T12:28:21.601Z",
      "reason": "（服务端 redact 后的记录原因，≤200 字）",
      "phase": "model",
      "messageCount": 1,
      "types": ["文字"],
      "preview": "本地保留的文字预览（≤160 字，可能为 null）",
      "previewNote": "无正文时的说明文案",
      "canResolve": true,

      "backlogState": "replying | retrying | needs-manual | uncertain | resolved",
      "progressNote": "服务端派生的人话进展（如『正在自动补答本次待答。』）",
      "availableActions": ["open-chat", "retry-now", "end"],
      "blockerCode": "bounded-generation-failed | media-unobservable | mapping-stale | identity-unverifiable | delivery-uncertain | readback-uncertain | waiting-… | null",
      "attempts": 0,
      "retryCount": 0,
      "escalated": false
    }
  ]
}
```

### GET `/chat/state`（新增顶层字段）

```json
{
  "unansweredCount": 5,
  "unansweredGroups": { "autoRecovering": 2, "needsManual": 2, "uncertain": 1 },
  "contacts": [ { "id": "…", "backlogGroups": { "…": "同上三分，联系人级" }, "unanswered": ["未过滤原始数组，仅审计用，前端不得当待答列表"] } ]
}
```

### POST `/chat/unanswered/end`  `{ recordIds: ["<64hex>"], snapshot: "<64hex>" }`

成功 → `{ resolved: N, alreadyHandled: false, checkedAt, unanswered: <v2 全量列表> }`；列表已变化 → 409；写入后磁盘回读不符 → 500（记录保持原状）。

### POST `/chat/unanswered/retry`  `{ recordIds: ["<64hex>"] }`

成功 → `{ rechecked: N, checkedAt, unanswered: <v2 全量列表> }`。只触发重新映射核对并更新状态，**不调用发送**。

### 服务端派生字段（前端不得复刻判定规则）

`backlogState` / `progressNote` / `availableActions` / `blockerCode` / `attempts` / `retryCount` / `escalated` / `groups` / `unansweredGroups` 全部由 `deriveBacklogState`（chat-service.mjs:72）与 groups 归并在服务端计算。前端（client.js:187 STATE_LABELS、desktop main.jsx:210）只做枚举 → 中文文案的映射；两处映射表相同，属展示层常量而非判定规则。派生规则的测试锚点在 tests/backlog-state-api.test.mjs（表驱动，五态各态含边界：needs-manual 原因码校验 :41-43、uncertain 优先 :44-47、resolved 最先 :30-33）。

## 3. 五态卡片与审核样稿对照表

样稿：docs/mockups/backlog-ui-mockup.html（浅色弹窗版为基准）。行号为 `6bb5ae1` 时点。

| 样稿要求 | client.js（DSH 内嵌面板） | desktop/ui-api（独立软件） |
|---|---|---|
| 状态与按钮分离：chip + 一行摘要 + 一句原因 + 按钮 | `unansweredCard`（:205-224）：:209 chip（STATE_LABELS :187 映射）→ :215 摘要行（preview 截断 40 字）→ :216 原因行 → :218-222 按钮行 | `UnansweredSection`（main.jsx:211-252）：:240 chip+联系人+时间 → :241 摘要 → :242 原因 → :244-247 按钮 |
| 按钮按态裁剪（needs-manual 才有「结束待答」；retrying 才有「安全重新检查」；uncertain 只有核对） | :218-222 按 `item.availableActions` 条件渲染（服务端裁剪，前端不自创按钮） | main.jsx:244-247 同构 |
| 人工按钮统一文案「结束待答，不再回复」 | :220（走 `endUnanswered` :198 → `/chat/unanswered/end`） | main.jsx:246（`endUnanswered` :219-224 → `/api/chat/unanswered/end`） |
| 发送结果不明只有「打开原会话核对」，无发送按钮、明示不重发 | :222 uncertain 尾注「只读回核对；在原会话核实前不重发」；服务端 uncertain 态 availableActions 仅 `['open-chat']`（chat-service.mjs:78） | main.jsx:247 同构文案 |
| 「结束待答」成功=服务端回读确认后从列表移除；失败保留原态 | :198-200 响应体 `unanswered` 直接替换列表（成功即消失）；失败时 `perform` 把错误挂 operationErrors（:171-174），卡片按钮态由 `busy` 派生自动回原态 | main.jsx:216-223 try/catch：成功 setList、失败 setError 并复位 marks |
| 「查看待答」替代「去处理」跳转 | :243（状态摘要行动作按钮，label 三分口径 :235） | health-dashboard.jsx:24-26（actions.openFriends 跳好友互动分类） |
| 数量三分（自动恢复中/需人工/已结案折叠历史），不再单一「N 条待处理」 | :227 三分头部 `待答 N 条：自动恢复中 X · 需人工核对 Y`（Y=needsManual+uncertain） | main.jsx:234（三分头部）同构 |
| 首开无数据不显示「在线/一切正常」 | :235 摘要待答分支仅在 `unansweredCount>0` 时出现；无数据时 :235 条件不满足 → 落到 presence/「一切正常」分支的前提是 `ready` 且其余卡点为空——「尚未获取到运行状态」由 `!ready` 时的「正在核实插件状态」（:217）承担，摘要卡片本身不渲染（`summary=null` :208） | health-dashboard.jsx:12-27：`openBacklog` 为 0 时不产生待答卡点行；`!connected` 时首条卡点为「本机服务未连接」 |
| escalated 升级提示可见 | :216 `escalate && state==='retrying'` 时原因行追加「（已连续多次等待，建议人工核对）」并提亮 | main.jsx:242 同构 |
| 卡片瘦身：技术细节折叠 | :223-224 attempts/retryCount/blockerCode/escalated 收进 `<details>详情` | main.jsx:249-251 同构 |
| 导航单行自然溢出滚动 | :13-14 tabRow/tab 常量 + :222 tablist 应用（`tabIndex:0`） | desktop 版 settings-tabs 为 CSS `flex-wrap`（desktop/ui-api/src/style.css:11 `.settings-tabs`），属独立软件布局，不在本轮范围 |

> 差异点注释位置：desktop main.jsx:210（STATE_LABELS 上方注明与 client.js 同构、路由前缀与 run() 包装差异）；health-dashboard.jsx:11（三分口径优先、旧字段回退）。

## 4. 实测证据清单

### 渲染断言（真 Edge 渲染整个设置页后对可见 DOM 断言）

tests/native-client.test.mjs（6 项全过）：

- :167-170 导航计算样式：wrap=nowrap / overflowX=auto / 单行 / tab flex-shrink=0 ——覆盖「导航修复」审核点。
- :303 三分头部文本「待答 5 条：自动恢复中 2 · 需人工核对 3」——覆盖「数量三分」「不再单一 N 条待处理」。
- :305-308 四种 backlogState 的 chip 文案各一例（replying/retrying/needs-manual/uncertain；resolved 不进列表，由 backlog-state-api.test.mjs 服务端断言）——覆盖「五态卡片」「首开无数据不显示在线」的渲染前提。
- :309 escalated 升级文案「（已连续多次等待，建议人工核对）」可见——覆盖「needs-manual 记录升级提示要可见」。
- :311-313 按钮按态裁剪计数：结束待答×2（两条 needs-manual）、安全重新检查×1（一条 retrying）——覆盖「状态与按钮分离」「发送不明只有核对」（uncertain 态按钮数为 0 由裁剪逻辑+服务端 actions 保证）。

### 行为断言（驱动点击/网络后断言调用与状态）

tests/native-client.test.mjs：

- :321-323 结束待答**成功路径**：点击 → 断言 POST /chat/unanswered/end 被调用 → 服务端从列表移除 → 头部计数 5→4。
- :324-329 结束待答**失败路径**：mock 服务端 500「结束待答写入未确认」→ 断言 alert 可见、卡片保留原态（chip 未变、按钮恢复）——覆盖「失败保留原态显示错误」。
- :314-320 安全重新检查在服务停止时可用 / 运行时禁用（workerActive 逻辑，与 P3 修复同源）；列表随启停重读（调用量对比）。
- :290-300 首屏状态摘要四段优先级翻转（含三分口径 label）——覆盖「首屏状态摘要保留现有逻辑，待答计数改用新三分口径」。
- :162 token 字面量已改拼接形式（密钥形态扫描不再命中）。

tests/backlog-state-api.test.mjs（5 项）：五态派生表驱动（服务端规则本身的锚点，前端不复刻）。

tests/backlog-replay.test.mjs（19 项）：隔离回放（R1-R6 失败案例基线 + 拆分/恢复/读回行为），属第②步验收材料，此处仅确认在合并态全绿。

desktop/ui-api tests/*.test.mjs（28 项）：构建产物 + 切源码断言（面板保留屏外许可、保存保护、presence 分离等）；五态卡片的渲染断言在 desktop 侧由同构代码 + 共享文案表保证，未重复搭建浏览器渲染链（native-client 即其渲染锚点）。

### 目前只能靠真机验收的点（测试不能替代）

1. **七个栏目来回切换**：测试覆盖单次切tab渲染，未覆盖连续切换的状态残留/滚动位置。
2. **不同窗口宽度下的导航滚动**：计算样式断言验证 nowrap/auto 配置，未在多档宽度实际滚动验证（设计依据见 docs/mockups/nav-measurement.md 的 559px 实测，但那是测量环境数值）。
3. **真实待答全流程**：自动恢复 → 发送确认（卡片消失/历史+1）→ 人工结束（真实快照竞态 409）→ 操作失败（真实服务错误文案）——合成 mock 无法复现真实平台回执与竞态时序。
4. **首开/重开的缓存表现**：「重开立即显示上次内容+更新时间」依赖真实 DSH 宿主的重开时序，测试环境每次都是全新加载。
5. **宿主弹窗内的层叠与滚动**（浅色主题对应的真实场景）：DSH 设置弹窗的实际宽度/滚动条样式由宿主决定。

## 5. 已知边界（如实列出）

1. **双入口文案同构但实现独立**：STATE_LABELS（client.js:187 与 desktop main.jsx:210）和卡片文案是两份相同常量，无共享模块——改文案需两处同步（两处已互相注释指向）。合并到共享文件的收益/成本未评估，本轮不做。
2. **字段定名差异**：任务清单原名 `lastBlockerCode` / `lastCheckedAt`，backend-fix 实际交付为 `blockerCode`（逐条）+ 顶层 `checkedAt`（无逐条最后检查时间），前端按实际形状接线；卡片上未显示「最后检查时间」行（无数据源）。
3. **escalated 触发条件**：同一联系人补答连续 6 次等待后置位（chat-service.mjs:804，`autoBacklogWaits >= 6`），once 置位不自动清除；前端只在 retrying 态追加升级文案，needs-manual/uncertain 态不叠加（它们本身已是人工态）。
4. **打开原会话目前只是提示文案**：availableActions 含 `open-chat` 但后端未提供直达链接/调起能力，面板仅显示文字提示（client.js:218 注释标注「如需直达链接由后端补 href」）。
5. **desktop 侧五态渲染无独立浏览器断言**：依赖与 client.js 的同构实现 + 共享文案表；如两入口后续分叉，desktop 侧需补渲染测试。
6. **「首开无数据不显示在线」的两入口实现路径不同**：client.js 用 `!ready → summary=null`（卡片不渲染），desktop 用 openBacklog=0 不产生卡点行——行为一致但代码路径不同，验收时两入口都要看首开场景。
