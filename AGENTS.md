# dsh-douyin-agent 项目宪法

适用于本仓库的一切 Agent 会话。这些条款全部来自真实踩坑与用户裁决，不是风格偏好；违反任意一条都构成返工。

## 1. 设计契约（UI 改动的最高约束）

1. **预览 = 产品**。`docs/mockups/panel-redesign-v2.html` 是唯一基准稿。实装的 `PANEL_CSS` 与预览稿 CSS 逐字一致；改任何 UI 先改预览稿、经用户批准，再同步实装。禁止"先写代码看看效果"。
2. **颜色只用 dsw-alias 令牌**。`--dsw-alias-bg-*`、`--dsw-alias-label-*`、`--dsw-alias-state-*`、`--dsw-alias-border-*`、`--dsw-alias-brand-primary`。产品 CSS 禁止写死十六进制色值做主题适配（`.theme-dark` 只存在于预览稿用于演示）。强调色（选中态、主按钮）跟随壁纸，由 DSH 原生 `Button variant="primary"` 或 `--dsw-alias-brand-primary` 提供，禁止黑色/深灰实心。
3. **紧凑单行**。表单行 = `dy-row`（`dy-label` 右贴定宽控件 + `dy-cap` 说明）。标签在上、控件 flex 拉满的占位布局是违例。textarea 只允许出现在正文编辑（人格卡）；一切短输入（时段、主题、昵称、密钥）都是单行 `dy-input`。
4. **开关贴标题**。布尔开关放在 `dy-card-top` 标题右侧，不单独占行；"默认关闭"等状态说明用 `dy-cap` 跟在开关后。
5. **按钮按语义归位**。操作按钮进 `dy-card-top` 行或与相关控件同行，禁止单独占整行、禁止"在最右边单独一列"。

## 2. 代码契约

1. **dy-\* class 冻结**。`PANEL_CSS` 里的 class 名是公共契约：测试、桌面端同构、文档都引用它们。改名必须先全局搜索引用，禁止出现"CSS 里没有的 class"（曾发生 `dy-panel` 残留导致整块样式丢失）。
2. **括号平衡用工具验证**。`node --check` 的报错行号会误导（报在文件尾）。多层嵌套 JSX 表达式改动后，用逐字符栈扫描（记录每个 `(` 的行号，扫描结束打印未闭合栈）定位真实缺失行；禁止凭肉眼数括号连续修补。
3. **声明的状态必须声明**。引用 `setXxx` 前确认 `useState` 已声明（曾发生"清空错误环"按钮引用未声明的 setter，点击即抛 ReferenceError 且被错误环捕获——清错误的按钮自己制造错误）。
4. **文案承诺 = 实际行为**。按钮/卡片说明"打开原作品"就必须打开该作品 URL，不允许降级为打开首页。新路由的输入必须白名单校验（如 `/browser/navigate` 只收 `douyin.com/video/<id>`）。
5. **语义 role 一致**。开关一律 `role="switch"` + `aria-checked`（dy-switch）；文本一律 `role="textbox"` via `aria-label`。插件端与桌面端、测试断言三方一致。

## 3. 测试契约

1. UI 改动后同步更新 `tests/native-client.test.mjs` 的 role/文案断言，再跑定向套件（backlog-state-api、friend-ui-races、native-client、persona-memory、desktop ui-api tests）。
2. 全量基线：`node --test tests/*.test.mjs`，当前基线 1381 pass / 10 fail（真实 Edge、ffmpeg、`F:\codex` 路径三类环境性失败）。失败数增加且非环境性 = 回归，禁止提交。
3. 测试绿 ≠ 验收。UI 改动必须由用户重启 DSH 后真机确认。

## 4. Git 与交付

1. 只追加原子提交，Conventional Commits；禁止 rebase/squash/amend/强推。
2. worktree 提交后必须在主检出 `merge --ff-only` 并 `push origin`，然后用 live 安装路径（junction）验证新代码字面已就位，才算交付。
3. 临时脚本（括号扫描、bisect）用 `.tmp-*` 命名并在提交前删除；仓库内不留任何临时文件。
4. 用户明确批准的设计不得被后续会话以"顺手优化"名义推翻；有异议先提出来，经用户裁决再动。

## 5. 红线（不可吞、不可加）

SMS/QR 登录、自动发布/投稿、自动点赞、轮询式回复参数群——这些能力方向的裁决记录在 `docs/research/dsh-douyin-tools-devour-notes.md`，未经用户新指令不得触碰。
