# TASK-B 报告

- **执行者**：GPT-6.1-Sol 子代理；本报告与 `bridge/FINDINGS.md` 由主代理根据它的最终回复整理（子代理所在环境不允许它写总结类文档）。
- **分支 / 提交**：`task-b-bridge` @ `534aba9`，只在本地，未推送。
- **用量**：18 轮 Codex 任务 + 1 次网关直连，在 20 轮上限内。

## 做了什么

- `bridge/src/exec-spike.ts`、`appserver-spike.ts`：两种接入方式的可交互演示（`/steer`、`/stop`、终端 y/n 审批），用法见 `bridge/README.md`。
- `bridge/src/codex-to-stage.ts`：把 Codex 原始事件翻译成 `StageEvent`，Codex 专有逻辑只放在这一个文件里。附带 9 个单元测试，`npm test` 全部通过（主代理已复跑）。
- `bridge/src/frontstage-spike.ts`：Q8 前台模型延迟测试。
- `bridge/samples/`：29 份 JSONL，共 1267 条记录，已做脱敏审计。其中 `app-full.stage.jsonl` 是完整一轮（读文件 → 改文件 → 审批跑测试 → 完成），可供任务 A 回放。

## 结论摘要

推荐用 **`codex app-server`**：插话、打断、审批、续接全部实测可用。`exec` 的审批在运行时被覆盖成 `never`，不适合我们的场景。逐题结论和三大风险见 [`bridge/FINDINGS.md`](../../../bridge/FINDINGS.md)。

## 遇到的坑

- 生成的类型里有 `untrusted` 审批模式，运行时却拒绝，只能改用 `on-request`。
- `exec` 通过管道传 stdin 时必须主动关闭输入，否则会一直卡在「Reading additional input from stdin」。
- `workspace-write` 沙箱默认允许写 `/tmp`，模型曾在沙箱外写过一个标记文件（无害，已清理）。
- 用户的全局 Codex 配置是 `approval_policy = "never"`，每次调用都要显式覆盖，并以服务端回显为准。

## 验收

- [x] 两个 spike 脚本可运行
- [x] 完整一轮的 StageEvent 回放样本
- [x] Q1～Q8 逐条结论，并标明「已实测 / 仅类型」
- [x] 推荐方案和三大风险
- [x] 本报告

## 待确认

- 正式版的执行 Agent 默认用哪个模型？GPT 系列有结构化 diff，体验最完整；换成 Gemini 需要补文件差异采集。
