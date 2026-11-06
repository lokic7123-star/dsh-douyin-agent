# 研究报告：视频证据引用模块（dsh_douyin_tools / video-understanding-lab）

> 吞噬进化·候选研究报告（能力发现任务）：只研究、不吸收、不写运行代码、不装依赖、不登记能力。
> 产出日期：2026-11-06。研究对象为外部仓库，全部结论标注证据（文件+行号或 SHA）。素材全部合成/结构性描述，无真实账号数据。

---

## 1. 来源固定与来源关系核查

### 1.1 来源提交

- 仓库：`github.com/kdcadmin/dsh_douyin_tools`，clone 至系统临时目录（未进项目目录），**用完即删**。
- HEAD SHA：`aaf9f9a862afafd45a15acf32789da97688de695`（2026-10-31T00:25:11+08:00，提交说明「docs: 恢复 README 封面图 + 修正截图引用（02/05/06/07 文件名对不上）」）。
- 研究对象：`video-understanding-lab/` 子目录（7 个 Python 文件：`evidence.py` 2847B、`media.py` 8111B、`lab.py` 4429B、`asr.py` 3234B、`capture.py` 9422B、`replay.py` 1687B、`run.py` 839B）。

### 1.2 LICENSE 覆盖范围（逐目录核对）

- 全仓库**仅根目录一个 `LICENSE`**（1085B，MIT，Copyright (c) 2026 TiAmoSS）；`video-understanding-lab/` 子目录**无独立 LICENSE/NOTICE/COPYING**。
- 结论：根 MIT 在无子目录例外声明时按惯例覆盖全仓（含 lab 子目录），但**子目录无 NOTICE 且 `package.json` 的 `files` 白名单把 lab 文件随插件一起发布**（`package.json` files 数组含 `video-understanding-lab/*.py`）——若后续局部复用其代码，须整包携带该 MIT 声明并保留作者署名，不能只拷文件。

### 1.3 来源关系核查（审核警告项，全部属实）

| 核查项 | 结果 | 证据 |
|---|---|---|
| README 引用 `PUBLISH.md`（line 13） | **不存在** | 仓库文件清单无此文件 |
| README 引用 `docs/REPAIR_REPORT_2026-10-27.md`（line 43「修复报告」） | **不存在** | `docs/` 下仅 AGENT_ONBOARDING.md 与 screenshots/ |
| README 引用 `docs/BUG_AUDIT_2026-10-26.md`（line 43「审查记录」） | **不存在** | 同上 |
| `package.json` repository 字段 | 指向 **另一仓库** `git+https://github.com/kdcadmin/jev-decision-kit.git`（`directory: plugins/dsh-douyin-life`），homepage/bugs 同指向 jev-decision-kit——本仓库 `package.json` name 却是 `dsh-douyin-life`、版本 0.2.9 | package.json repository/homepage/bugs 字段 |
| README 0.2.1 修复说明（line 354-366） | 声称「重启后自检通过」「验收边界：只读/离线已验；点赞/评论/私信/发布未做真实账号验收」——后半句诚实，但引用的验证报告本身不可达 | README line 354-366 |

**来源关系结论**：README 引用的三份文档全部缺失、package.json 指向另一仓库——来源关系确实可疑，与审核警告一致。但 lab 子目录代码本身是**自包含、可静态审读**的（仅依赖标准库 + ffmpeg/ffprobe 外部进程 + 可选 faster-whisper/PIL），代码与可疑的营销性 README 可分离评估。本研究只基于源码本身。

### 1.4 evidence.py 完整依赖清单

- 直接 import：`pathlib`、`json`、`math`（标准库）+ `from media import save_json, file_hash`（同目录 `media.py`）。
- `media.py` 的传递依赖：`hashlib`、`os`、`subprocess`、`wave`（标准库）+ **外部进程 `ffprobe`/`ffmpeg`**（probe/extract_frame/prepare 均经 subprocess 调用，media.py:16-22、53-55、80-82）；contact_sheets 内**延迟 import PIL**（media.py:73）。
- `asr.py`（转写，evidence.py 的可选输入）：`faster_whisper`、`numpy`（延迟 import，asr.py:36-37）+ `wave`/`math`。
- 运行面依赖（vendor/douyin-mcp/requirements.txt）：`mcp>=1.9,<2`、`playwright>=1.45`、`numpy>=1.26`、`faster-whisper>=1.1,<2`、`httpx>=0.27,<1`、`pillow>=10,<13`——**evidence.py 校验路径本身不依赖这些**（纯标准库 + ffmpeg 产物），只有 capture/asr 采集路径依赖。

---

## 2. evidence.py 完整深读

### 2.1 模块结构（lab 整体）

`video-understanding-lab` 是一个独立的「证据准备—模型审阅—回放」管线，与插件主链路完全解耦：

```
capture.py   只读采集：CDP 浏览器取公开视频与媒体流（域名白名单、本地 CDP 限制）
media.py     证据准备：ffprobe 探测 → 全时长定步采样帧 → 接触印张（contact sheet）→ 音轨提取 → packet.json
asr.py       可选转写：faster-whisper 全 PCM 转写 → transcript.json（带时间戳分段）
replay.py    局部回放：对已有 case 的指定时间段生成更密的证据，帧带 parentTime/rootTime 双时间戳
evidence.py  审阅校验：校验模型 review 的证据引用 → review.json
lab.py       CLI 编排：doctor/capture/prepare/asr/clip/record 六个子命令
```

### 2.2 evidence.py 对外接口（两个函数）

- `validate_review(packet, review, transcript=None)`：纯校验，返回带标注的 review 副本。
- `record_review(case, review)`：读 packet.json → 校验源视频 SHA 未变 → 校验证据图像文件在位 → 校验 review → 落盘 review.json 并把 packet 的 reviewStatus 置 `model-reviewed`。

### 2.3 证据引用的数据模型（核心思路，逐条列）

**（a）引用必须挂真实存在的证据 ID**（evidence.py:15-17）
每条观察/答案需 `frameIds`（画面帧）或 `audioIds`（转写分段）至少一项；ID 必须是 packet 中真实存在的 `F0001...`/`A0001...`——未知引用直接拒绝（"Unknown frame reference"）。**断言不允许无证据存在**。

**（b）类型绑定是文档性约束，不是校验行为**（evidence.py:14-17 与 media.py prepare 内 limitations，两层分开看）
- **机器校验层（evidence.py:15-17）只做引用归属**：`validate_review` 核对帧 ID 在帧集合、转写 ID 在转写集合——**不检查断言文本是视觉类还是音频类**；「音乐很好听」只挂 frameIds 同样能通过校验。
- **文档声明层（packet.json limitations，media.py prepare 内）才有类型绑定语义**："A transcript does not establish understanding of music, intonation or sound effects"——这是写进证据包的约束声明，由阅读方（模型与下游）遵守，校验器不强制。

**（c）时间断言有界**（evidence.py:18-23）
带 start/end 的断言必须是有限数、`0 ≤ start ≤ end ≤ packet.duration`——断言时间不能超出视频时长（"Claim time outside video"）。

**（d）完备性自白字段**（evidence.py:24-27）
review 必须显式携带 `rawAudioListened`（bool，是否真听过原始音频）与 `uncertainties`（列表，不确定点）——**不确定性是必填字段而非可选附录**，缺失即校验失败。

**（e）引用有效 ≠ 理解正确——两处硬编码**（evidence.py:28、66-67）
- 校验通过也只返回 `evidenceReferencesValid: true, completeUnderstandingGuaranteed: false`——**引用全部有效也绝不宣称理解完整**；
- `record_review` 落盘时 `packet["understandingVerified"] = False`，注释原文：*A self-report is not a human ground-truth acceptance test*（自我报告不是人工基准验收）。
这是用户点名的核心思路：**「我引用的每一帧都真实存在」与「我理解了这个视频」是两个独立命题，前者可机器校验，后者机器无权签发**。

**（f）证据不可变性**（evidence.py:36-39；replay.py:24-26）
`record_review` 校验 `file_hash(packet.source) == packet.sourceSha256`（源视频变过即拒绝）；逐帧校验图像文件在位。replay.py 的 clip 产物带 `parentSourceSha256`/`rootOffsetSeconds`，帧带 `parentTime`/`rootTime`——证据链可溯源到原始时间轴。

**（g）覆盖范围显式声明**（media.py prepare 的 coverage 字段）
`{visual: 'sampled-across-full-duration', audio: 'full-duration'|'absent', samplingStepSeconds, everyFrameAnalyzed: false, truncated, ...}`——采样了什么、没采样什么、是否截断，全部机器可读； limitations 列表内嵌三条「帧是采样的、转写不建立音乐/音效理解、帧时间是请求 seek 值可能差一帧」。

**（h）拒绝静默截断**（media.py prepare：`no silent truncation`）
limit 截断时允许只看前 N 秒但 `partial=true` 显式标记；无 limit 且超时长预算直接报错，不偷偷看一半。

### 2.4 边界观察（局限）

- `validate_review` 只校验**引用有效性**（ID 存在、时间在界、完备性字段在），不校验**断言内容与画面的一致性**——帧真实存在不等于模型对帧的描述正确；它自己也只在字段名上承认这一点（`completeUnderstandingGuaranteed: false`），没有内容级核对。
- `uncertainties` 是自由列表，无结构约束——模型可以填空列表"看起来严谨"（见 §4 风险）。
- 审阅模式是 "current-conversation-review"（当前会话的模型自审），没有独立评分器——`model-reviewed` 状态只表示「走完了引用校验流程」。

---

## 3. 与现有实现差异（逐项对照）

对照对象：`video-storyboard.mjs`（分镜采样与 zoom）、`persona-memory.mjs` 的 evidenceId 机制、`autonomous-watch.mjs`/`core.mjs` 的观察-行为链、`chat-agent.mjs` 的 mediaReplySummary、`group-video-inbox.mjs` 的累计笔记。

### 3.1 我们有而它没有

| 能力 | 我们的实现 | 它的状态 |
|---|---|---|
| **行为证据与提案分离** | `douyin_interest_record` 的 topic/signal 仅是提案，最终喜好由真实观看时长/停留/跳过/分享计算（tool-definitions.mjs:77；persona-memory.mjs:422 的 `proposalSignal` 与 `signal` 分离存储） | 完全没有——它不涉及兴趣/行为学习 |
| **证据 ID 与行为回执绑定** | evidenceId 贯穿观察→观看→行为→分享/评论（autonomous-watch.mjs:305-309 观看回执与作品观察一致性校验；share/comments 服务强制 evidenceId 引用真实观察，autonomous-share.mjs:115-117） | 无交互行为，不适用 |
| **证据时效（TTL）** | StoryboardFrameStore 的 60s TTL + zoom 时校验作品未变（video-storyboard.mjs:102-106） | packet 无 TTL，只有 SHA 不变校验——静态文件可无限期引用 |
| **隐私分级** | 证据与兴趣记录带 visibility/privacy（persona-memory.mjs:422） | 无——packet 是本地明文 |
| **图片私聊观察的语义注入** | mediaReplySummary 把画面/语音的 understandingScope 与「未读取正文/未打开链接」的边界注入回复提示（chat-agent.mjs:75-93） | 无私聊场景 |
| **多源证据聚合** | daily-report 把 viewing/behavior/interest 按证据引用聚合出日报（daily-report.mjs:56-76） | 无 |

### 3.2 它有而我们没有

| 能力 | 它的实现 | 我们的状态 |
|---|---|---|
| **帧级 ID 引用校验** | 模型每条断言必须挂真实存在的帧/转写分段 ID，未知引用拒绝（evidence.py:15-17） | **没有**——我们的分镜 summary 是自然语言（「第3格对应2.500秒」），模型回复**不被要求**引用格编号；note/reflection 是自由文本，无引用核对 |
| **时间断言有界校验** | start/end 必须有限且在视频时长内（evidence.py:18-23） | 部分——`recordViewing` 校验 from/to 时间在播放时长内（persona-memory.mjs:173），但**回复文本**里的时间断言无校验 |
| **不确定性必填** | `uncertainties` 列表缺失即校验失败（evidence.py:26-27） | 没有——我们的限制条款在 summary/limitations 里单向注入，不要求模型**回填**不确定点 |
| **覆盖范围机器可读字段** | coverage 对象（采样步长/everyFrameAnalyzed=false/truncated）+ 内嵌 limitations（media.py prepare） | 部分——manifest 有 cells/采样信息（video-storyboard.mjs:81），但累计笔记（group-video-inbox 的 previousNote/summary）没有 coverage 结构 |
| **「自我报告非验收」硬编码** | `understandingVerified=False` 永不翻转（evidence.py:67） | 语义等价物存在（分镜 summary 明说「不证明看完整条」），但没有**状态字段**——笔记/兴趣记录上没有「理解未验证」的机器可读标记 |
| **截断显式化** | partial/truncated 字段 + 无 limit 超预算直接报错（media.py） | 部分——watchSeconds 截断有 partial 语义（README 声称，未核源码），分镜 original 路径有 reason（'single-or-too-many'） |

### 3.3 双方语义冲突点

1. **证据生命周期**：它的证据是持久文件（SHA 锁定，可无限期引用）；我们的分镜证据是 60s TTL 内存态。若借鉴帧级引用，须决定引用的是持久 packet 还是短命 sample——两者不可混用（对 TTL 态做持久引用会悬挂）。
2. **校验对象**：它校验的是**离线审阅产物**（review.json 文件）；我们的等价场景是**在线回复/笔记**（流式生成后的结构化字段）。把「引用校验」搬进在线链路意味着回复 schema 要加 evidenceRefs 字段并同步校验——改变回复协议。
3. **失败语义**：它校验失败抛异常、整个 review 拒收；我们的链路里校验失败应降级（笔记降级「待核对」）而非拒收——拒收会丢回复。
4. **「理解正确」的边界**：它用 `completeUnderstandingGuaranteed:false` 永久字段表达；我们用自然语言注入。若引入字段，须防止 UI/下游把它读成「已验证=false → 内容不可信」的过度推断——字段名与文档要写清它只否定「完整理解已保证」，不否定单条观察。

---

## 4. 收益与成本评估

### 4.1 潜在收益（按改造点）

| 改造点 | 思路借鉴方式 | 预期收益 |
|---|---|---|
| **douyin_interest_record 的 reflection** | 兴趣提案的 reflection 附 `evidenceRefs`（evidenceId + 分镜格编号/采样时间），宿主校验格编号真实存在于该次观察的 manifest.cells | 消除「模型凭一帧自称喜欢」之外的另一半问题：凭**不存在的画面**写反思；reflection 里引用的画面时间可机器核对在采样范围内 |
| **视频观察笔记（group-video-inbox 累计笔记 / previousNote）** | 每批笔记附 coverage 摘要（本批采样帧数/播放进度/是否到结尾）+ uncertainties 必填（可为空列表但字段必须在） | 多批续看的笔记继承可核对的范围声明；「看了 6 帧写了 30 秒内容」的过头描述可被 coverage 对照 |
| **看图说过头问题（chat mediaReplySummary）** | 私聊图片回复的审查强化：对「图片中有…」类断言要求挂 messageId + understandingScope 已有——缺的是**回复后**的引用核对；低成本版是 summary 模板已要求的「不默认写图片中有」继续，加一条：回复含具体画面断言时宿主记录 assertionScope 字段供事后核查 | 证据可追溯（E-4 memoryEvidence 的同型思路扩展到视觉断言），不阻塞回复 |
| **观看决策 note（watch note）** | note 中的时间/进度断言与 playbackProgressSeconds 对照 | 防「笔记声称看到结尾但 frames/进度不符」 |

### 4.2 工作量估计（借鉴思路、非复用代码）

- **低成本（0.5-1 天）**：manifest.cells 已有格编号/时间——在 interest reflection 的校验里加可选 evidenceRefs 字段（格编号存在性 + 时间在采样集内），persona-memory.updateAgentInterests 存储时带上；group-video-inbox 笔记加 coverage/uncertainties 字段（schemaVersion+1，旧记录兼容读取）。
- **中成本（2-3 天）**：回复协议加 evidenceRefs + 在线校验降级路径（校验失败→笔记降级「待核对」而非拒收）；chat 视觉断言的 assertionScope 记录。
- **不建议**：引入 packet.json 持久证据包体系——与我们的 TTL 内存态、隐私分级、在线链路冲突大，且其采集路径（CDP 全量下载媒体流）与我们的「不下载视频」红线冲突。

### 4.3 风险：证据引用被滥用为「看起来严谨」的装饰

该模块自己就暴露了这个洞：`uncertainties` 是自由列表，模型填空列表即可通过校验；`evidenceReferencesValid:true` 不校验断言内容与画面一致。若我们照搬字段而不设**实质性校验**，会出现：

1. **引用堆积**：模型给每条断言挂满帧 ID（反正校验只查存在性），看起来严谨实则无信息增量。防法：evidenceRefs 数量上限（如 ≤3 条/断言）+ 断言与引用类型绑定（音频断言不得挂帧；原模块此项为文档性约束，借鉴时必须做成机器校验）。
2. **空 uncertainties 形式合规**：必填字段被填成 `[]`。防法：覆盖范围对照——coverage 声称 sampled 6 帧而笔记断言覆盖 30 秒内容时，强制 uncertainties 非空或降级「待核对」。
3. **正确性幻觉**：`evidenceReferencesValid:true` 被下游读成「内容已核实」。防法：字段命名学它——`evidenceRefsValid` 之外必须有成对的 `understandingVerified:false` 类字段，且 UI/文档明确两者独立（§3.3 冲突点 4）。
4. **类型绑定只有文档没有校验**：原模块的「音频断言不挂帧」写在 limitations 里，validate_review 不强制——这是它自己的缺口。借鉴该思路若在插件侧实现，类型绑定必须做成机器校验（断言 kind 与引用集合类型不符即拒绝），不能只写成文档约束；否则与「引用堆积」同样退化为装饰。
5. **隐私面扩大**：持久引用会把采样画面/时间轴变成可追溯档案——与我们隐私分级冲突，引用须限定在单次观察的生命周期内（TTL 内或随记录落盘的最小摘要）。

---

## 5. 合成验证案例设计（后续若做思路借鉴，可先用合成数据验证）

1. **笔记断言必须挂 evidenceId**：合成观察（manifest.cells 3 格，时间 1.0/2.0/3.0s）→ 代理产出兴趣提案 reflection 引用「第 2 格（2.0s）」→ 校验通过并落盘 evidenceRefs；再产出引用「第 5 格」的提案 → 校验拒绝（格不存在），提案降级为无引用 reflection 并记 `evidenceRefsValidated:false` 事件。
2. **理解置信度低时笔记降级「待核对」**：合成多批续看（第一批 3 帧/进度 3s，第二批 6 帧/进度 11s）→ 第二批笔记断言覆盖「整个视频」但 coverage 显示 frames=6/未到结尾 → 笔记降级为「待核对」状态（不丢弃），后续批次补充后自动恢复。
3. **时间断言有界**：合成播放时长 10s 的观察 → 回复文本断言「8-12 秒处」→ 时间上限校验（12 > 10）拒绝该断言进日报，回复本身照发（降级不拒收）。
4. **音频断言不挂帧**：合成观察含转写分段（A0001）与帧（F0001-F0003）→ 笔记声称「背景音乐很欢快」但引用了 F0002 → 校验拒绝（音频语义断言挂画面帧），提示改挂 A 段或转 uncertain。
5. **自我报告非验收**：合成完整审阅（全部引用有效）→ 最终记录仍带 `understandingVerified:false` 类字段 → 日报/UI 读到该字段时显示「引用已核对·理解未验证」双标签，验证下游不会把前者读成后者。

---

## 6. 结论：**借鉴思路，不局部复用代码**

理由：

1. **思路价值高且正好补我们的短板**：「引用有效 ≠ 理解正确」的硬编码分离、断言必须挂真实证据 ID、不确定性必填、覆盖范围机器可读——这四点是我们现有证据链（evidenceId 贯穿行为学习）没有覆盖的**表达层**：我们的证据绑定的是「行为」（看没看、停没停），它绑定的是「陈述」（说的是不是引用了真实画面）。两者正交，结合才是完整链路。
2. **代码不可复用**：Python/ffmpeg 离线管线 vs 我们的 Node/在线链路；持久证据包 vs TTL 内存态；全量媒体下载 vs 不下载红线。三方冲突（§3.3），复用成本远超重写。
3. **改造点是已有结构的自然延伸**：manifest.cells 已有格编号/时间（video-storyboard.mjs:80-81），evidenceId 已贯穿观察-行为（persona-memory.mjs:339-422）——借鉴只需在**表达层**（reflection/笔记/回复）加引用字段与校验，不需要新基础设施。
4. **风险可控但有前提**：必须同时引入「装饰防法」（§4.3 的数量上限/类型绑定/覆盖对照/双字段命名），否则证据引用会退化成严谨感的装饰——这比没有更糟。
5. **来源关系可疑但代码可分离评估**：README 引用三份不存在的文档、package.json 指向另一仓库——不吸收其**工程实践**（发布声明、验收表述）；其源码层面的诚实性设计（limitations/coverage/自我报告非验收）反而值得借鉴。若未来局部复用任何代码，须整包携带根 MIT（Copyright TiAmoSS）并保留署名（§1.2）。

**建议落地顺序（若批准）**：先做 §4.2 低成本两项（interest reflection 的 evidenceRefs + 累计笔记 coverage/uncertainties），用 §5 案例 1/2/5 合成验证后再评估中成本项。
