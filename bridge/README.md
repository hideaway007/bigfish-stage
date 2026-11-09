# Codex 桥接验证脚本

仅在 `/tmp/p5-bridge-sandbox/` 内运行 Codex。依赖 Node.js 22+、npm、`codex-cli 0.167.0` 和已运行的 localhost magpie 网关。

```bash
cd bridge
npm ci
npm run protocol
npm run fixture
npm run check
npm test
```

`protocol/` 是当前 Codex CLI 自动生成的协议类型，未提交；升级 CLI 后需重新生成。共享 `StageEvent` 从 `../src/shared/stage-events.ts` 导入。根工程无需安装这些依赖。

## 交互演示

```bash
npx tsx src/appserver-spike.ts
```

一行普通输入发起一轮，任务进行中可输入 `/steer 内容`，`/stop` 请求打断，`/quit` 退出。审批提示在 stderr，输入 `y` 允许或 `n` 拒绝。stdout 只输出 StageEvent JSON Lines；审批未答复时仍可 `/stop`。

可以输入以下测试任务（`npm run fixture -- --reset` 会先恢复故意出错的加法函数，只在没有实验运行时使用）：

```text
Read add.js and add.test.js. Fix add using apply_patch. Run exactly npm test with sandbox_permissions="require_escalated" and justification="May I run npm test?" so the client can approve it. Do not write outside the current directory.
```

`on-request` 不会为每条沙箱内命令强制弹出审批；上述提示显式请求提权，才会出现实验所需的审批。允许该审批会按 Codex 的提权语义执行该次命令。

```bash
BRIDGE_MODEL=remote-magpie/antigravity/gemini-3.8-flash npx tsx src/appserver-spike.ts
BRIDGE_RESUME=<thread-id> npx tsx src/appserver-spike.ts
npx tsx src/exec-spike.ts 'Read add.js and explain it. Do not edit files.'
BRIDGE_RESUME=<thread-id> npx tsx src/exec-spike.ts 'Continue the conversation.'
```

模型默认为 `gpt-6-luna`。所有调用使用本次进程专属的 `local` provider，指向 `http://127.0.0.1:3425/v1`；不设置任何 key。Codex 的 `CODEX_HOME` 也位于测试沙箱内，不读取或改动用户全局配置。启动时设置 workspace-write、on-request，并排除默认对整个 `/tmp` 和 `TMPDIR` 的额外写入授权。沙箱不是读取隔离或容器。

## 可重现实验

每次 probe 会覆盖同名样本；不要与同名 probe 并发运行。涉及改文件的实验必须串行执行。probe 中的审批是确定的测试驱动：默认允许；`app-deny` 拒绝。正式交互入口不会自动允许。

```bash
npm run fixture -- --reset
npm run probe -- app-full
npm run probe -- app-steer
npm run probe -- app-interrupt
npm run probe -- app-deny
npm run probe -- latency
npm run probe -- app-errors
npm run probe -- exec-full
npm run probe -- exec-interrupt
BRIDGE_RESUME=<thread-id> npm run probe -- exec-resume
npm run fixture -- --reset
BRIDGE_MODEL=remote-magpie/antigravity/gemini-3.8-flash npm run probe -- gemini-full
npx tsx src/frontstage-spike.ts
npm run sanitize
```

`app-steer`、`app-interrupt` 各包含初始任务、同进程继续、新进程恢复三轮，其他 probe 通常是一轮；`latency` 为三轮。错误参数实验不调用模型。请控制总对话轮次。

`*.raw.jsonl` 每行保存接收时间、方向和真实 wire message；`*.stage.jsonl` 为翻译结果。首事件延迟从发送用户消息开始计时，不能视为模型已开始响应。`replay.ts` 可用当前适配器重译已有 raw 日志，不调用模型，保留本地用户输入、审批决定及信号终态。

```bash
npx tsx src/replay.ts exec-full
```

`frontstage-spike.ts` 为 19 行的可选 Q8 实验，直接把已记录的 StageEvent 交给网关模型，并输出首个非空文本增量的延迟。`sanitize` 会清理邮件、常见鉴权字符串、本地账号及主机身份字段；提交前仍需人工检查。
