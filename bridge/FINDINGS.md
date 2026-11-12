# Task B 结论：Codex 桥接技术验证

> 执行：GPT-6.1-Sol 子代理（2026-11-09），codex-cli 0.167.0，模型经本机本地兼容网关。
> 本文件由主代理根据子代理的最终回复整理，并抽查了 `exec-policy`、`app-full` 样本与 `npm test`（9/9 通过）。
> 标注：**已实测** = 有 `samples/` 日志为证；**仅类型** = 只来自 `codex app-server generate-ts` 生成的类型或文档。

## 推荐方案：`codex app-server`

`app-server` 支持在同一会话里插话、打断，并且能把审批真实地交给客户端决定。`exec` 的审批策略在运行时被覆盖成 `never`，只适合逐轮批处理。

## 逐题结论

| # | 结论 | 证据 |
|---|---|---|
| **Q1 事件** | **已实测**。`exec` 有 `thread.started`、`turn.started/completed`、`item.started/completed`；命令带输出和退出码，文件改动带路径但**没有 diff**；文字只在完整 `agent_message` 时给出。`app-server` 有文字增量、命令开始/结束、**结构化文件 diff**、审批回调和本轮终态。「thinking」有时只是本轮启动时的状态提示。`turn.failed` **仅类型** + 合成测试覆盖，未触发真实的失败轮次。 | `samples/exec-full.raw.jsonl`、`samples/app-full.raw.jsonl`、`samples/gemini-full.raw.jsonl` |
| **Q2 运行中插话** | **已实测**（app-server）。长命令执行中调用 `turn/steer`，约 **6ms** 后回显同一 `clientId` 的 `userMessage`，可映射为 `steer_acked`。**当前命令不会被打断**，约 20 秒后命令结束，模型才按插话内容回答。回显只代表服务端已接收，不代表模型已经处理。`exec` 只能在 stdin EOF 后读取输入，**仅类型**层面也没找到对应 `turn/steer` 的接口。 | `samples/app-steer.raw.jsonl`、`samples/app-steer.stage.jsonl` |
| **Q3 打断** | **已实测**。app-server 命令开始约 500ms 后发 interrupt，返回 `interrupted`；超过命令原定完成时间后，没有出现测试用的落盘标记。同进程继续和新进程 resume 都保留了上下文（暗号 `BLUE_BADGER_73`）。`exec` 收到 SIGINT 后直接退出，**没有结构化的结束事件**，之后 resume 仍能续上。只证明本次测试命令被终止，**不保证**所有后代进程都会被杀掉。 | `samples/app-interrupt.raw.jsonl`、`samples/exec-interrupt.raw.jsonl`、`samples/exec-resume.stage.jsonl` |
| **Q4 权限审批** | **已实测**。app-server 会发出 `item/commandExecution/requestApproval`：客户端 `accept` 后 `npm test` 跑通；`decline` 后命令被拒绝，且模型没有重试。注意，这次审批是提示词明确要求提权（`require_escalated`）才触发的，**`on-request` 不等于每条命令都会询问**。`exec` 即使传了 `-c approval_policy="on-request"`，会话记录里实际生效的仍是 `"never"`，也没有审批回调。生成的类型里有 `untrusted`，但运行时直接拒绝。 | `samples/app-full.stage.jsonl`、`samples/app-deny.raw.jsonl`、`samples/exec-policy.raw.jsonl`、`samples/untrusted-rejected.raw.jsonl` |
| **Q5 会话续接** | **已实测**。两种方式都能凭 id 跨进程恢复，且记得之前的内容：app-server 用 `thread/resume`，exec 用 `exec resume`。 | `samples/app-steer.raw.jsonl`、`samples/exec-resume.raw.jsonl` |
| **Q6 换模型** | **已实测**。同一脚本分别用 `gpt-6-luna` 和 `gemini-flash-preview` 跑：命令事件和审批协议一致，两者在批准后测试都通过。**但不完全等价**：GPT 用结构化改文件工具，带 diff；Gemini 通过 shell 调用 `apply_patch`，只有命令事件、没有结构化 diff，而且额外跑了好几条探查命令。 | `samples/app-full.raw.jsonl`、`samples/gemini-full.raw.jsonl` |
| **Q7 延迟** | **已实测**。三次首事件分别是 10 / 10 / 9 ms，但这只是本地状态事件，不是模型首字；首段文字分别是 8885 / 3381 / 5458 ms，平均约 **5.9 秒**。测量时本机有其他并发流量，仅供粗略参考。 | `samples/latency.raw.jsonl` |
| **Q8 前台模型直连** | **已实测**。一个 19 行的脚本直接调用 `http://127.0.0.1:8080/v1/chat/completions`，传入 StageEvent，让模型用大肥鱼的口吻播报：首个非空文字 **8341 ms**，总耗时 8897 ms。 | `src/frontstage-spike.ts`、`samples/frontstage.measurement.jsonl` |

## 做正式桥接层的三大风险

1. **实际生效的权限策略可能和启动参数不一致。** 已经观察到两例：exec 被覆盖为 `never`，`untrusted` 在类型里有、运行时却不认。另外 `workspace-write` 默认**允许写 `/tmp`**：早期实验中模型自作主张写了 `/tmp/EXEC_OTTER_17.marker`（主代理已确认并清理，内容无害）。最终代码已开启 `exclude_slash_tmp` 和 `exclude_tmpdir_env_var`，并检查服务端回显。正式版必须以「服务端回显的实际策略」为准，不能只信启动参数。`workspace-write` 不能被当作容器级隔离，也不提供读取隔离。
2. **插话、打断、收尾的语义要由桥接层补齐。** `steer_acked` 只代表服务端已接收，插话不会取消当前命令；打断后可能收不到工具的 completed 事件，进程退出时也可能没有本轮终态。桥接层要自己补发派生的失败或收尾事件，UI 才不会卡在「进行中」。
3. **模型选择会影响事件是否完整。** Gemini 用 shell 改文件，就没有结构化 diff，单靠协议翻译抓不全文件变化。正式版需要额外采集文件差异（例如每轮前后跑 `git diff`），并持续对日志做隐私清理。

## 给 UI（任务 A / Phase 1）的提示

- `app-full.stage.jsonl` 的 114 条事件里有 102 条是 `worker_text` 增量，UI 或桥接层需要把它们合并成句，再交给台词层或回看。
- 「已传达，待接收」和「已接收」之间可能隔着 20 秒以上（要等当前命令结束），界面必须能表达这个等待过程。
- 前台播报约 8 秒才出首字，比 Worker 还慢。所以前台角色不能每个事件都现想台词，应该先用预置台词和动画即时反馈，模型生成的台词随后补上。
