# 吞噬进化·深读笔记：kdcadmin/dsh_douyin_tools

> 2026-11-07。按 loki-capability-discovery 情形 A（用户指定参考项目）执行完整深读。
> 目标项目：dsh-douyin-agent（本仓库）。边界：只吞能力，敏感项不复用，发布/登录类不采纳。
> 证据：client.js（106KB 全读）、index.js（结构）、此前会话已深读 video-understanding-lab/evidence.py、lib/dm-messages.mjs、lib/state.mjs。

## 一、参考项目功能面全清单（client.js 证据）

| # | 功能 | 源码证据 | 我们现状 |
| --- | --- | --- | --- |
| 1 | **观看足迹页**：按日期分组的已看视频卡片墙，本地截图缓存→远端封面→占位块三级回退，点击跳原作品 | `function DouyinWatchedTab`（client.js @61k），`/watched?days=14`、`/thumb?id=`、`/cover?u=` | **无界面**：persona-memory 有观看记录，但没有任何浏览 UI；本地帧缓存已有（storyboard），未做封面缓存 |
| 2 | **记忆管理页**：角色卡结构化编辑（CharEditor：identity/preferences/constraints/habits）、时间线（Timelines：可搜索、kind 着色）、清理（Cleanup：按工作区列条目、单条删、整区清空，走 memory.forget）、原始记录 | `MemoryPage` @90k、`CharEditor` @78k、`Timelines` @83k、`Cleanup` @85k，走 `conn.rpc.call('/api', 'memory.*')` | **无**：我们只有 persona 正文编辑（textarea），记忆条目完全不可见不可管 |
| 3 | **人设自动补写**：persona.md 能看能改，每天按记忆自动补一段 | `PersonaBox` @75k + 后端 | 有 persona 编辑；无自动补写 |
| 4 | **前端错误上报**：window.onerror → POST /api/douyin-duty/log | @102k `window.__dyErrHooked` | 无（前端崩了只能看控制台） |
| 5 | **日志尾**：logTail 状态 + 环境自检 | Panel state `logTail`/`checks` | 有 diagnostics；无日志尾 |
| 6 | 峰谷时段/关键词/每日条数等观看策略 | Panel draft `peakValley/noon/night/perDay/keywords` | 有（时段 windows/主题/额度），形态不同 |
| 7 | 自动回复参数群（replyPerRun/replyIntervalMin/replyOncePerUser/skipLive/replyRandom…） | Panel draft | 模式不同：他们轮询式，我们事件驱动+许可名单；多数不适用 |
| 8 | 连续互动（streakNick/streakSticker/streakPerDay） | Panel draft | 无对应场景 |
| 9 | 自动点赞 autoLike | Panel draft | 无；风险区（平台风控），不吞 |
| 10 | 自动发布/投稿（autoPublish/publishDraft/publishTitle/Tags、ComfyUI comfyList） | Panel draft | **明确不采纳**（README 既有边界：无自动投稿） |
| 11 | SMS/QR 登录流（smsPhone/smsCode/qr） | Panel state | **不采纳**：我们走专用 Edge 人工登录，更安全 |
| 12 | 证据诚实性（帧级引用校验、uncertainties 必填） | video-understanding-lab/evidence.py（前轮已深读） | 已吸收思想进 persona-memory（`understandingVerified:false`、frameIndex 校验，提交 eb7f377） |

## 二、吸收裁决（A 借架构 / B 借思路 / C 局部复用 / 不采纳）

| 裁决 | 项 | 理由 |
| --- | --- | --- |
| **B 级·吞** | 观看足迹页（#1） | 思路自研：后端新增封面缓存（复用既有 storyboard 帧缓存）+ watched 查询接口；前端新 tab 按日分组卡片墙。不复制其代码。 |
| **A 级·吞** | 记忆管理页（#2） | 架构同构：同样走宿主 `connection.rpc` 调 memory.*（我们插件已 inject connection）；角色卡/时间线/清理/原始记录四区结构照搬其信息架构，实现自研。 |
| **B 级·吞** | 前端错误上报（#4）+ 日志尾（#5） | 思路自研，挂进既有 diagnostics 通道。 |
| **B 级·吞** | 人设按记忆自动补写（#3） | 后端定时任务，可选开关，默认关。 |
| **不采纳** | #7 参数群、#8 连续互动、#9 点赞、#10 发布、#11 SMS | 模式不同或既有红线（无自动投稿、人工登录、风控）。 |

## 三、边界声明

- 参考项目 client.js 为 MIT，但我们按「取优去杂」**零源码复制**，全部自研实现。
- 不动：许可名单/发送安全链路、观看预算、音频凭据、QQ 同步。
- 研究成果归 dsh-douyin-agent，不登记为吞噬进化运行能力。
