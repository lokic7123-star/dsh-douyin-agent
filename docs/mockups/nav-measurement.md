# 设置页导航换行实测记录（修订版）

任务：实测当前 `client.js` 设置页栏目导航（role=tablist，7 个分类按钮）在窄容器下换行的真实根因，排除或确认四个假设：弹窗宽度 / 滚动条 / 内容撑宽 / 按钮 flex 换行。审核要求实测，不凭感觉归因单条 CSS。

> 修订说明：本版修正上一版对"704px 断点"的误读。704px 是 720 视口下该容器的**可用宽度**（测量环境坐标），不是单行阈值；单行的**内容自然宽度是 559px**（5×69 + 2×83 + 6×8 = 按钮宽度之和 + 间距）。修复方案相应改为「自然溢出滚动」，不硬编码任何断点。

## 测量方法

- 对象：仓库当前 `client.js`（未做任何修改），走真实加载链路——DSH 原语（`@deepseek-ai/dsh-client-ui-primitives`，取自 `desktop/.cache/upstream/fb2c4b…/packages/client`）+ esbuild 打包 + Playwright/Edge 渲染，合成 `/state` 服务复用 `tests/native-client.test.mjs` 的响应形状。
- 测量脚本：`docs/mockups/measure-nav.mjs`（只读 client.js，产物写入 `docs/mockups/measure/`：5 档宽度截图 + 3 档 nowrap 探针截图 + `nav-measure-data.json` 原始数据）。截图为布局取证，未套 DSH 主题皮肤，不影响几何测量。
- 每档宽度记录：tab 行数（按 `getBoundingClientRect().top` 去重）、每 tab 宽度、tablist 的 scrollWidth/clientWidth/`flex-wrap`/`overflow-x`、文档级横向溢出、全树 `scrollWidth > clientWidth` 元素链。
- 探针：运行时对 tablist 注入 `flex-wrap:nowrap; overflow-x:auto`，分"允许压缩（flex-shrink 默认 1）"与"禁止压缩（flex-shrink:0）"两种，量出内容自然宽度。

## 实测数据

| 测量环境视口 | tab 容器可用宽 | tab 行数（现状） | 与内容自然宽度 559px 比较 | 现状文档横向滚动条 | 撑宽元素 |
| ---: | ---: | ---: | --- | --- | --- |
| 1100 | 900 | 1 | 900 ≥ 559，单行放下 | 无 | 无 |
| 900 | 836 | 1 | 836 ≥ 559，单行放下 | 无 | 无 |
| 720 | 656 | 1 | 656 ≥ 559，单行放下 | 无 | 无 |
| 560 | 496 | **2** | **496 < 559，折行** | 无 | 无 |
| 440 | 376 | **2** | **376 < 559，折行** | 无 | 无 |

- 7 个 tab 的宽度恒定：基础设置/视频观看/好友互动/公开评论/观看日报 = 69px，自检与用量/音频与密钥 = 83px（四字栏目更宽）；**内容自然宽度 = 5×69 + 2×83 + 6×8 间距 = 559px**（探针实测 scrollWidth 取整为 560，1px 为取整误差）。
- `flex-wrap` 计算值 = `wrap`，`overflow-x` = `visible`：client.js 的 tablist 复用通用 `row` 样式常量（`display:flex; flex-wrap:wrap`），没有任何针对窄容器的处理。
- **溢出元素链为空**：五档宽度下全树没有任何元素 `scrollWidth > clientWidth`，文档级也从未出现横向滚动条。换行不是被宽内容挤出，也不是溢出防御，是 flex-wrap 的默认折行。
- nowrap 探针：允许压缩时（flex-shrink 默认 1）tab 被压窄塞进一行、文字被裁（截图 `nav-560-nowrap-probe.png` 可见"观看日报"只剩"观看日"）——假单行，不可采用；禁止压缩后内容保持 559px 自然宽度，容器 496/376 < 559 时横向滚动条出现（`nav-560-nowrap-probe.png`、`nav-440-nowrap-probe.png`），tab 完整。

## 结论（逐条对应审核假设）

1. **弹窗宽度**：不是根因，是触发条件。DSH 宿主把插件面板放在可缩宽的栏/弹窗里，容器可用宽一旦窄于 559px 就换行；用户把窗口缩到半屏再扣侧栏即落入该区间，与反馈吻合。
2. **滚动条**：不成立。现状五档宽度下文档与元素级都没有横向滚动条，也无滚动条占宽导致回绕的证据。
3. **内容撑宽**：不成立。溢出元素链为空；换行与任何宽内容无关。
4. **按钮 flex 换行**：**成立，这是根因**。tablist 复用 `flex-wrap: wrap` 的通用行样式；内容自然宽 559px，容器更窄时折行，440px 时第二行继续放不下（"音频与密钥""观看日报"掉行）。

## 修复方向（供样稿采用，非本轮实装）

- **自然溢出滚动**：tab 行与通用 `row` 常量解耦，设 `flex-wrap: nowrap; overflow-x: auto`，tab 设 `flex-shrink: 0`。不引入任何断点：容器宽于 559px 自然单行无滚动，窄于 559px 自然出现横向滚动条，内容永不折行、不裁字。
- 559px 是内容自然宽度而非"断点"：无需媒体查询，也无 704 之类的环境坐标硬编码；宿主把面板放进多窄的栏都只是滚动范围变化。
- 语义与可访问性：横向滚动不影响 role=tablist/aria-selected；tablist 加 `tabindex=0` 并保留原生滚动即可，键盘可达性不劣于现状（现状折行后 Tab 顺序跳跃）。

## 证据文件清单

- `docs/mockups/measure/nav-measure-data.json` —— 全部原始数据（含探针）。
- `docs/mockups/measure/nav-{1100,900,720,560,440}.png` —— 各档宽度现状截图（560/440 可见折行）。
- `docs/mockups/measure/nav-{720,560,440}-nowrap-probe.png` —— nowrap 探针截图（560/440 可见单行横向滚动、tab 完整）。
- 复测：`node docs/mockups/measure-nav.mjs`（依赖与 `pnpm test` 相同的 esbuild/Edge 环境；脚本只读 client.js）。
