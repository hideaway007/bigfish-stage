# 开发任务书总览（Phase 0：验证阶段）

本目录是交给开发 Agent（Codex / Gemini / 其他模型）的任务书。每个任务都写成可以独立执行的形式，**不需要读之前的聊天记录**。

## 产品一句话

一个给 coding agent（Codex / Claude Code 等）用的**游戏风格聊天客户端**：角色在台前说话和表演，真正的活由执行 Agent（本阶段用 Codex CLI）在后台原样完成。本地运行（本地 Node 服务 + 浏览器页面），不是线上网站。

## 本阶段的两个任务（并行，互不依赖）

| 任务 | 回答的问题 | 目录 | 分支 | 任务书 |
|---|---|---|---|---|
| **A 假数据交互原型** | 界面爽不爽，有没有和 Codex 那类界面拉开差距 | 根目录 `src/`、`public/` | `task-a-prototype` | [TASK-A-prototype.md](TASK-A-prototype.md) |
| **B 桥接技术验证** | 和 Codex 保持会话、插话、打断、权限审批能不能跑通 | `bridge/` | `task-b-bridge` | [TASK-B-bridge-spike.md](TASK-B-bridge-spike.md) |

两个任务都通过后，进入 Phase 1：把 B 的真实事件流接到 A 的界面上，并加入前台人设模型。

## 唯一的共享契约

[`src/shared/stage-events.ts`](../../src/shared/stage-events.ts) 定义了 `StageEvent` 事件协议：

- A 用它写剧本驱动界面；
- B 把 Codex 的真实输出翻译成它。

**这是 A、B 之间唯一的接口。** 任何一方都不要擅自修改；确实需要改，在自己的任务报告里写明「改了什么、为什么」，由产品负责人确认。

## 模型从哪来（不要问用户）

本机所有模型都走 **本地兼容网关** `http://127.0.0.1:8080`（本机免 key）：OpenAI 格式 `/v1/chat/completions`，Anthropic 格式 `/v1/messages`，模型列表 `GET /v1/models`。GPT、Claude、Gemini 都在里面，可用模型列表通过 `GET /v1/models` 查看。Codex CLI 也走这个网关，`codex -m <模型>` 可以跑其中任何一个。**不要另配 API key，不要改本地兼容网关或 Codex 的配置。**

## 协作规则（所有 Agent 必须遵守）

1. **只改自己目录下的文件**。A 不碰 `bridge/`，B 不碰 `src/`（只读 import 除外）。两边都不要改 `docs/DESIGN.md`、`src/characters/roster.ts`。
2. 从 `main` 切出自己的分支开发，完成后推送分支并开 PR，**不要直接推 `main`**，不要 force push。A、B 同时进行时**各用独立的工作目录**（`git worktree add .worktrees/task-a -b task-a-prototype`，统一放在仓库内的 `.worktrees/` 下，禁止用 `../` 建到桌面），不要两个 Agent 共用一个目录来回切分支。
3. 仓库是**公开**的：不提交任何密钥、token、账号信息、个人路径以外的隐私数据；不提交第三方游戏素材或他人美术作品。
4. 完成后在 `docs/tasks/reports/` 下写报告（各任务书里有格式要求）。报告要如实：没做完、没验证、有疑问的地方直接写出来。
5. 不确定的产品问题不要自己拍板，记进报告的「待确认」一节。

## 给派发任务的人

把下面这段连同对应任务书一起发给 Agent：

> 你在仓库 `p5-agent-stage` 里工作。先读 `docs/tasks/README.md`，再读 `docs/tasks/TASK-X-....md`，严格按任务书执行，完成所有验收项后推送分支、开 PR，并写好报告。
