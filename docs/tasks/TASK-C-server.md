# 任务 C：本地服务（server/）

> 先读 [PHASE1.md](PHASE1.md)、`src/shared/*.ts` 四个契约文件、`bridge/FINDINGS.md`，再读本文件。

## 目标

一个本地 Node 服务：对网页说 `wire.ts` 协议，对下驱动执行 Agent，中间由台词模块负责角色「说话」。

## 结构（建议，可调整）

```
server/
  package.json        # 独立依赖；scripts: dev（tsx watch）、start（tsx 运行并托管 ../dist）、test、check
  src/
    index.ts          # HTTP + WebSocket，只绑 127.0.0.1:5300（可用 PORT 覆盖）；托管 ../dist；/characters/* 由 ../public/characters 提供
    session.ts        # 会话编排：命令 → 适配器；适配器事件 → 历史记录 + 广播 + 台词模块
    settings-store.ts # ~/.config/bigfish-stage/settings.json（600），合并 DEFAULT_SETTINGS，下发 PublicSettings
    characters.ts     # 扫描 ../public/characters/*/character.json，校验并生成 CharacterSummary
    adapters/
      types.ts        # WorkerAdapter 接口
      codex.ts        # 基于 codex app-server（复用 bridge/ 中验证过的代码）
      registry.ts     # 适配器注册表 → WorkerAdapterInfo[]
    voice/
      voice.ts        # 台词模块
  test/
```

## 1. 执行 Agent 适配器

`adapters/types.ts` 中定义接口，至少包含：`info()`（可用性检测）、`listModels()`、`testConnection()`、`startSession({cwd, model, sandbox, resumeId?})`，以及会话对象上的 `send` / `steer` / `interrupt` / `decidePermission` / `close`，事件以 `StageEvent` 回调输出。**Codex 专有逻辑只能放在 `codex.ts`**，加新 Agent 不应改动 session.ts。

Codex 适配器要求：
- 用 `codex app-server`，每次启动显式覆盖：沙箱按设置，审批 `on-request`，开启 `exclude_slash_tmp`、`exclude_tmpdir_env_var`；连接后读取服务端回显的实际策略，与预期不符时发 `error` 事件并拒绝开工。
- 模型 = `settings.worker.model`，用 `-m`/对应参数传入。`listModels()` 可读 `~/.codex/magpie-desktop-models.json` 或 magpie 网关 `/v1/models`，失败时返回空列表 + 原因。
- `worker_text` 增量要**合并成句**再发（按句末标点 / 换行，或 400ms 无新增），最终回答 `final: true`。
- 拿不到结构化 diff 的文件改动（例如模型通过 shell 改文件）：每轮结束时在 cwd 跑 `git diff`（非 git 仓库则跳过），补发一个 `tool_end`（`tool: 'edit'`，带 diff）。
- 打断后补齐收尾：未完成的工具补 `tool_end ok:false`，补 `interrupted` 和 `turn_done ok:false`，保证 UI 不会卡在「进行中」。
- `steer` → `steer_queued`；服务端回显同一 clientId 的 userMessage 时 → `steer_acked`。

## 2. 台词模块（角色的嘴）

输入：会话事件流 + 当前角色包 + `settings.voice`。输出：`character_line` 事件。

1. **预置先上**：事件到达后 ≤50ms，按 `reactions` 表（最细键优先，见 `character-pack.ts`）选一句预置台词，替换占位符，发 `source:'preset'`，带 `lineId`。不是每个事件都要说话：`worker_text` 不触发；同类事件 3 秒内只说一次。
2. **模型后补**：对「值得说」的事件（本轮开始、工具失败、审批请求、本轮结束、长时间无事件超过 15 秒）调用台词模型，`stream:false` 即可。提示词 = 角色包 `persona.systemPrompt` + 最近的事件摘要（**由代码生成的简短账本，不要塞原始工具输出**）+ 硬规则：只描述账本里发生过的事；没有完成信号不得说完成；一句话，≤40 字；用角色口吻。结果发 `source:'model'`，`replacesLineId` 指向刚才那句 preset。
3. **限流与闭嘴**：遵守 `maxLinesPerMinute`；模型请求超过 12 秒放弃（保留 preset）；`voice.enabled=false` 时只发 preset。
4. 切换角色立即生效；正在进行的模型请求作废。

## 3. 其他命令

- `update_settings`：深合并、持久化、广播 `settings`。改 worker 设置不影响正在跑的会话，下次 `new_session` 生效。`projectDir` 必须是存在的目录，否则 `command_error`。
- `send` 时若没有会话：用当前设置自动 `new_session`；没选 `projectDir` → `command_error`。
- `list_models` / `test_connection`：worker 交给适配器；voice 调 `baseUrl/models` 和一个 1-token 级别的 chat 请求。
- 断线重连：`welcome.history` 带当前会话全部事件（上限 2000 条）。
- 安全：只监听 127.0.0.1；拒绝 Origin 不是 `http://127.0.0.1:*` / `http://localhost:*` 的 WebSocket 连接；日志里不打印 apiKey。

## 4. 测试与验收

- [ ] `cd server && npm install && npm run check && npm test` 通过。单元测试覆盖：反应表查找顺序、文字合并成句、打断收尾补齐、设置合并与脱敏（PublicSettings 不含 apiKey）、Origin 校验。
- [ ] 在 `/tmp/bigfish-c-sandbox/`（一个带失败测试的小 Node 项目，自己建）用一个**测试用 WebSocket 客户端脚本**跑通真实全流程：new_session → send → 收到工具事件 → permission_request → 发 allow → turn_done ok；再跑一次 steer 和 stop。把客户端收到的消息存成 `server/test/fixtures/e2e-*.jsonl`（脱敏）。
- [ ] 台词模块实测：同一流程中能看到 preset 台词，之后有 `source:'model'` 的替换台词（模型用默认的 gemini-3.8-flash）。
- [ ] 测试角色包：自己在 `server/test/fixtures/characters/` 放一个最小角色包用于测试。真正的角色包由任务 D 产出，合并后会在 `public/characters/` 下。
- [ ] Codex 测试控制在 15 轮以内，用轻量模型（`gpt-6-luna`）。
- [ ] 本地提交到分支 `task-c-server`。最终回复按 PHASE1.md 的要求汇报。

## 不要做

- 不要碰 `src/`、`public/`（契约文件只读）。不要实现 Claude Code 等第二个适配器（接口留好即可）。不要加用户登录、远程访问。
