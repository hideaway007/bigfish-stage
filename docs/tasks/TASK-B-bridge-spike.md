# 任务 B：Codex 桥接技术验证（Bridge Spike）

> 先读 [README.md](README.md)（总览与协作规则），再读本文件。
> 预计工作量：约 0.5 天。分支：`task-b-bridge`。

## 1. 背景（你需要知道的全部）

我们在做一个游戏风格的 coding agent 聊天客户端，架构是**前台 / 后台分离**（参考 Poke 的「交互 Agent + 执行 Agent」模式）：

```text
用户 ⇄ UI ⇄ 前台角色模型（带人设，以后再做）
              │  dispatch / steer / stop
              ▼
          桥接层（本任务，普通代码，不用 LLM）
              │  一个持续的会话
              ▼
          执行 Agent（本阶段用 OpenAI Codex CLI，原样干活，不注入任何人设）
```

**本任务只验证桥接层这一段**：能不能和 Codex 保持一个会话，把它的活动实时翻译成我们的事件协议，以及中途插话、打断、权限审批到底怎么表现。

执行 Agent 以后可能换成别的（Claude Code、Gemini CLI 等），所以桥接层要把「Codex 专有的格式」和「我们的事件协议」隔开。

这是一个**技术验证（spike）**，最重要的产出是**带证据的结论文档**，代码可以粗糙。

## 2. 两条候选接入方式（都要试）

本机已安装 `codex-cli 0.167.0`。Codex 的模型请求经过本机的 **magpie 网关**（`~/.codex/config.toml` 里的 `openai_base_url` 指向 `127.0.0.1:3425`），因此 Codex 可以用 `-m <模型>` 跑网关里的任何模型，不限于 GPT。可用模型以 `/Applications/magpie.app/Contents/MacOS/magpie models` 的输出为准。**测试默认用 `codex/gpt-6-luna` 之类的轻量模型**，省额度。

**方式 1：`codex exec --json`（每轮一个进程）**
```bash
codex exec --json -s workspace-write "任务描述"            # 新会话，stdout 输出 JSONL 事件
codex exec resume <session-id> --json "下一条消息"          # 续接同一会话
```
- 关注：事件种类和格式；每轮都要重新起进程，那么插话和打断只能靠杀进程再 resume 吗？审批在非交互模式下怎么处理？

**方式 2：`codex app-server`（长连接 JSON-RPC，实验性）**
- 这是 Codex 官方 IDE 插件使用的协议：一个常驻进程，通过 stdio 收发 JSON-RPC。
- 先运行 `codex app-server generate-ts --help` / `generate-json-schema` 生成协议类型，**以生成的类型为准**理解协议，不要凭印象猜方法名。
- 关注：如何开会话、发起一轮、在一轮进行中追加输入或打断；服务端如何向客户端**请求审批**（执行命令、改文件），客户端如何回复允许或拒绝。

两种方式的行为细节**以你实测为准**，文档、生成的类型和实测不一致时，写进结论。

## 3. 必须回答的问题（每条都要附实测证据）

| # | 问题 | 证据形式 |
|---|---|---|
| Q1 | 两种方式分别能拿到哪些事件？能否可靠识别：思考中、文字输出、工具或命令开始 / 结束（含命令、文件、结果）、文件改动的 diff、审批请求、本轮完成（成功 / 失败）、错误？ | 原始事件日志样本 |
| Q2 | **任务运行中插话**：Codex 正在连续执行命令或改文件时，能否送进一条新消息？它**何时**生效：立即、当前步骤结束后，还是只能等本轮结束？能否观察到「已读到」的信号？ | 带时间戳的日志 + 你的解读 |
| Q3 | **打断**：打断后正在执行的命令会怎样？会话还能继续接收下一条消息吗？上下文是否保留？ | 日志 |
| Q4 | **权限审批**：在不跳过审批和沙箱的前提下，能否把「要执行 `npm test`，允许吗？」交给我们的 UI 决定，并把结果回传给 Codex？两种方式各自怎么做，哪种做不到？ | 可运行的最小示例 + 日志 |
| Q5 | **续接已有会话**：能否用 session id 恢复之前的会话继续对话？ | 日志 |
| Q6 | **模型可替换性**：同一个桥接脚本，用 `-m` 分别跑一个 GPT 模型和一个非 GPT 模型（如 `remote-magpie/antigravity/gemini-3.8-flash`），事件格式、工具调用、审批流程是否一致？哪些地方会出差异？ | 两份对比日志 |
| Q7 | **延迟**：从发出消息到收到第一个事件、第一段文字分别要多久（粗略即可，测 3 次）？ | 数字 |
| Q8（加分项） | **前台模型直连**：以后的前台人设模型会直接调 magpie 网关（`http://127.0.0.1:3425/v1/chat/completions`，本机免 key，OpenAI 格式）。写一个 20 行以内的小脚本，把 `samples/` 里一段 StageEvent 喂给一个快模型，让它以大肥鱼的口吻说一句进度播报，测一下首字延迟。DeepSeek 模型在远程网关上存在但未开放，**不要自己开放**（会改用户全局配置），用已开放的模型即可。 | 脚本 + 延迟数字 |

## 4. 代码产出

```
bridge/
  package.json            # 独立依赖，不污染根目录
  src/
    exec-spike.ts         # 方式 1
    appserver-spike.ts    # 方式 2
    codex-to-stage.ts     # 把 Codex 原始事件翻译成 StageEvent（Codex 专有逻辑只放这里）
  samples/                # 实测保存的原始日志与翻译后的事件（.jsonl）
  FINDINGS.md             # 结论文档（最重要）
```

- 用 `tsx` 直接运行 TypeScript，不需要打包。
- 翻译出的事件类型必须从 [`../src/shared/stage-events.ts`](../../src/shared/stage-events.ts) 引入（相对路径 import），按 **JSON Lines** 打到 stdout。命令执行映射为 `tool: 'bash'`，文件改动映射为 `'edit'` / `'write'` 并带上 `diff`；`output` 截断到 4000 字符以内。
- 提供一个可交互的演示入口：`npx tsx src/appserver-spike.ts` 启动后，终端里输入一行就作为用户消息发送；输入 `/steer 内容` 发插话，`/stop` 打断；遇到审批请求时在终端问 y/n。

## 5. 安全与成本约束（必须遵守）

- **只在临时测试目录里跑**：新建 `/tmp/p5-bridge-sandbox/`，放一个几十行的小项目（例如一个带 1 个失败测试的小 Node 项目），把 Codex 的工作目录设成它。**不要**指向用户的任何真实项目或家目录。
- **禁止** `--dangerously-bypass-approvals-and-sandbox`。沙箱用 `workspace-write` 或更严格的模式。
- 每次测试的提示词要小（「读一下 a.js，把 add 函数修好再跑测试」这种量级），总共控制在 20 轮对话以内。
- 不要在日志或报告里提交任何 token、API key、账号信息。提交 `samples/` 前检查一遍。

## 6. 验收标准

- [ ] `bridge/FINDINGS.md` 对 Q1～Q7 逐条给出结论（Q8 做了就写），每条附证据（日志片段或 `samples/` 文件路径），并标明「已实测」或「仅文档 / 仅类型定义」。
- [ ] 结尾给出**推荐方案**（exec 还是 app-server）及理由，以及做正式桥接层时的 3 个最大风险。
- [ ] 两个 spike 脚本都能按第 4 节的方式运行。
- [ ] `samples/` 里至少有一份「完整一轮：读文件 → 改文件 → 请求审批跑测试 → 完成」的翻译后 StageEvent 日志。任务 A 的原型之后会直接用它回放。
- [ ] 在 `docs/tasks/reports/TASK-B-report.md` 写简短报告：做了什么、FINDINGS 摘要、遇到的坑。

## 7. 不要做

- 不要写 UI，不要碰 `src/` 下除了 import 以外的任何文件。
- 不要做正式的前台人设模型（Q8 只是延迟测试）；所有模型调用都走本机 magpie 网关，不要另配 API key。
- 不要修改 `~/.codex/config.toml` 或运行会改 magpie 配置的命令（如 `magpie codex <model>`、`magpie provider models ... +<model>`）。
- 不要实现 WebSocket 服务；正式桥接层是下一阶段的事。
