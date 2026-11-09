# Phase 1：能真正干活的版本（总览）

> Phase 0（原型 + 桥接验证）已完成，结论见 `bridge/FINDINGS.md`。本阶段两条线并行：**C 本地服务**、**D 网页**。

## 完成标准

`npm start` → 浏览器打开页面 → 在设置里选项目文件夹、执行 Agent 和模型 → 投喂一句真实任务 → 角色驱动执行 Agent 真的改代码、跑命令；需要审批时弹出选择肢；插话、喊停都生效；台词先用角色包里的预置台词即时出现，再被台词模型生成的台词替换；能切换角色、换模型，不中断正在跑的任务。

## 三个可插拔层（核心原则）

| 层 | 是什么 | 怎么换 |
|---|---|---|
| **角色包** | 人设、口癖、反应表、立绘 | `public/characters/<id>/character.json`，新增角色 = 新增文件夹 |
| **台词模型（嘴）** | 任意 OpenAI 兼容地址 + 模型 + key | 设置里填 |
| **执行 Agent（手）** | 适配器 + 用户自选模型 | 设置里选；新增 Agent = 新写一个适配器 |

三者**互不绑定**。角色包里的 `recommendedModels` 只是提示。

## 契约（唯一的接口，两条线都必须遵守，不得擅自修改）

- [`src/shared/stage-events.ts`](../../src/shared/stage-events.ts)：事件协议（`character_line` 新增了 `lineId` / `source` / `replacesLineId`）
- [`src/shared/wire.ts`](../../src/shared/wire.ts)：WebSocket 协议，端口 5300，路径 `/ws`
- [`src/shared/character-pack.ts`](../../src/shared/character-pack.ts)：角色包格式
- [`src/shared/settings.ts`](../../src/shared/settings.ts)：设置格式和默认值

确实需要改契约时，在最终回复里写明改了什么、为什么。

## 分工与目录所有权

| 线 | 负责 | 只能改 |
|---|---|---|
| **C 本地服务** | [TASK-C-server.md](TASK-C-server.md) | `server/`（新建） |
| **D 网页** | [TASK-D-web.md](TASK-D-web.md) | `src/`（`src/shared/` 除外）、`public/`、`index.html`、`vite.config.ts`、根目录 `package.json` 的依赖 |

`bridge/` 是 Phase 0 的验证代码，只读参考，可以复制其中代码到 `server/`。

## 环境事实（不要问用户）

- 所有模型走本机 **magpie 网关** `http://127.0.0.1:3425`（免 key）：`/v1/chat/completions`、`GET /v1/models`。CLI：`/Applications/magpie.app/Contents/MacOS/magpie models`。
- 执行 Agent：本机 `codex-cli 0.167.0`，用 `codex app-server`。用户全局 `~/.codex/config.toml` 是 `approval_policy="never"` + 完全放开的沙箱，**必须在每次启动时显式覆盖**，并以服务端回显的实际策略为准（见 `bridge/FINDINGS.md`）。
- 不要修改 `~/.codex/config.toml`，不要运行会改 magpie 配置的命令。

## 协作规则

1. 在自己的 worktree 和分支上工作，**只在本地提交**，不 push、不开 PR、不碰 `main`。
2. 仓库是公开的：不提交密钥、token、邮箱、本机用户名路径；不提交第三方素材。
3. 完成时在最终回复里给出：做了什么、怎么运行、验收项逐条通过 / 未通过、已知问题、提交哈希。如果你的环境不允许写报告类 `.md` 文件，就全部写进最终回复。
