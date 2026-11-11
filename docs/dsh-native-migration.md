# P5 Stage × DSH 原生集成方案

> 目标：P5 舞台作为 DSH 的客户端皮肤运行（"坐在 DSH 上"），取代现有的"独立 Stage 服务器 + 桥接 DSH 子进程"架构。
>
> 依据：`@deepseek-ai/dsh@0.2.2-rc.1` 本机安装（`~/.local/lib/node-v24.21.0-darwin-arm64/`）。

## 1. DSH 的真实架构（已核实）

DSH 是 Cordis（koishi 系插件框架）应用，一切能力都是插件行（loader row）：

```
dsh --profile web
 └─ $DSH_HOME/profiles/web/
     ├─ package.json          → dsh.profile.bundles = [dsh-base, dsh-web-app]
     └─ cordis.patch.yml      → 用户层 patch（覆盖/禁用/insert 行）

dsh-web-app/cordis.patch.yml 组合出浏览器表层：
 ├─ webserver            HTTP 服务（dsh-host-webserver）
 ├─ web-runtime          dist 服务 + URL 行 + 开浏览器（dsh-web-app）
 ├─ connection           /api 网关 + 浏览器信任（dsh-client-connection）
 ├─ modules              扫 dsh.client 行 → /plugins/<id>/client.js（dsh-client-modules）
 ├─ session-controller   Typert Remote: session/prompt/follow/projections…
 └─ 60+ 个 ui-* 行       每行一个客户端插件包（可替换！）
```

**核心事实：**

- **官方前端不是硬编码**——`dsh-web-frontend/dist` 只是被 `dsh-host-frontend-static` 服务的静态产物，`distIndex` 指向哪个 `index.html` 都行。
- **UI 插件是可换的槽位**——`cordis.patch.yml` 里 `id: ui-chat / name: '@deepseek-ai/dsh-client-ui-chat'` 换成自己的包就完成替换；`disabled: true` 即关闭。
- **客户端插件契约很小**——包的 `package.json` 声明 `dsh.client = { platform: 'web', inject: [...] }`，导出 `./client` bundle；bundle 是 `window.__ModuleLoader__.load({ id, factory(require){…} })` 格式，`factory` 返回 `{ inject: [...service名], apply(ctx){…} }`，在 `apply` 里注册 slot/Factory/effect。React、react-dom、ui-primitives 等在外壳共享模块表里，插件标 external 即可。
- **数据面是 Typert Remote + SessionEventStream**——`sessionController` Remote 暴露 `session/prompt`、`session/follow`（事件流：append/prepend/replace/settle-assistant）、`session/projections`（token 用量、轮次大纲、压缩等投影）。这比我们自定的 StageEvent 强得多：压缩、trajectory、审批、模型选择、队列、steering 全部官方支持。

## 2. 目标架构

```
┌─ Electron（可选外层，后期）─────────────────────────┐
│  BrowserWindow → http://127.0.0.1:<port>           │
└──────────────────────────┬─────────────────────────┘
                           │ HTTP + /api (Typert Remote)
┌─ dsh --profile bigfish ──┴─────────────────────────┐
│  dsh-base（session/compaction/tools/persistence）   │
│  dsh-web-app（webserver/connection/modules/…）      │
│  bigfish-web-app（我们的 bundle）                   │
│   ├─ frontend-static → dist = 我们的 P5 dist        │
│   ├─ ui-bigfish-stage   ← 我们的客户端插件          │
│   │   （P5 舞台 + 角色立绘 + 台词系统）              │
│   ├─ 保留官方：ui-trajectory / ui-approval /        │
│   │   ui-settings / ui-sidebar-right / modules…     │
│   └─ 禁用官方：ui-chat / ui-conversation /          │
│       ui-brand-official / ui-sidebar(左栏) 等       │
└─────────────────────────────────────────────────────┘
```

**废弃**：`server/` 整个目录（ws 服务器、SessionController、DshAdapter、settings-store、voice）、`src/stage/sources/`（LiveSource/NativeAppSource/ScriptSource）、electron/engine 打包层。
**保留**：`public/characters/` 角色包、`src/characters/` roster、`stage.css` 视觉资产、`BacklogModal` 等纯展示组件（改造后复用）。

## 3. 改造步骤

### 第 0 步：跑通官方 web profile（0.5 天）

`dsh --profile web --port 3080 --no-open`，配 `~/.dsh/profiles/bigfish/` 复制 web 模板，把我们已有的 magpie 网关写进 `llm-pi-ai` provider。目的：拿到官方前端的"什么能用"基线。

### 第 1 步：最小客户端插件 hello-world（1 天）

做一个包 `@bigfish/dsh-client-ui-p5stage`：

```jsonc
// package.json
{
  "name": "@bigfish/dsh-client-ui-p5stage",
  "exports": { "./client": "./lib/client.js", "./assets/*": "./lib/assets/*" },
  "dsh": { "client": { "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-connection",
               "@deepseek-ai/dsh-api-session-controller",
               "@deepseek-ai/dsh-client-ui-renderer",
               "@deepseek-ai/dsh-client-ui-session"] } }
}
```

`lib/client.js` 用手写的 `__ModuleLoader__.load` 包装格式（不需要抄他们的 tsdown 工具链，esbuild 出 ESM 再包一层 wrapper 即可——格式很简单，见 ui-brand-official/lib/client.js，约 30 行样板）。`apply(ctx)` 里先只做一件事：`ctx.slots.inject(...)` 或直接往 session view 塞一个 "P5 STAGE ONLINE" 块。

接入方式：profile 的 `package.json` 的 `dsh.profile.bundles` 加我们 bundle 的 npm 包，或先用 `cordis.patch.yml` 的 `insert` + `--patch` 开发期接入。

**验收**：`dsh --profile bigfish` 起 web 服务，打开页面看到我们的占位块替换掉官方聊天区。

### 第 2 步：数据面接线（2 天）

把现在的 `StageEvent` 数据源整体换成 DSH Remote：

| 现在（要废弃） | 换成 |
|---|---|
| `LiveSource`/`NativeAppSource` ws | `ctx.connection` + `session.follow` RemoteJournalStream |
| `send` 命令 | `session.prompt` Remote 调用 |
| `worker_text` 事件 | `assistant/live-chunk` + `assistant/message` 持久条目 |
| `tool_start`/`tool_end` | `tool/call` + `tool/result` 事件（会话日志原生类型） |
| `thinking` | `turn/start`、`step/start` |
| `permission_request` | `approval/request`（SDK 层已是官方协议） |
| `context_compacted`/`context_usage` | `session/projections`（压缩/token 计量官方投影） |
| `character_line` | 本地保留（我们的特色，不走 DSH） |
| `turn_done` | `turn/end` |

关键点：**不再需要 DshEventMapper**——DSH 事件本身就是结构化的，直接映射到 UI 状态。

### 第 3 步：P5 舞台 UI 移植（3 天）

把现有舞台改造成 DSH conversation view：

- **角色立绘区**：`conversation.hero.brand.mark` + 自定义 layout slot，或直接在我们的 view target 里渲染（立绘来自 `public/characters`，打成插件 assets，走 `/plugins/<pkg>/assets/` 路由）。
- **台词系统**：`character_line` 保留为纯前端逻辑——监听 session 事件流，用现有 `src/characters` + voice 台词生成逻辑改造成客户端 effect。voice 模型调用改为浏览器直接 fetch endpoint（或挂一个小 Remote）。
- **对话框/输入**：复用官方 `ctx.uiSession` 的 `useInput`/`inputActions`（已发送回显、队列、steering 都是现成的），把 P5 输入框皮肤套上去。
- **Backlog**：`events.map → BacklogEntry` 逻辑直接喂 `session.follow` 的事件条目，映射规则比现在还简单（事件类型一一对应）。
- **保留官方页签**：trajectory（轨迹）、approval（审批）、settings（模型/接口管理）、session list 这些直接留着用——这是我们白拿的能力。

### 第 4 步：桌面打包（1 天）

Electron 壳保留，但不再打包 `electron/engine`——主进程只做两件事：spawn `dsh --profile bigfish --port 0`（或 `--no-open` + 固定内部端口），把 BrowserWindow 指向它打印的 URL（带 token）。WebSocket 断线问题天然消失（同源 loopback + DSH 自带重连恢复）。

### 第 5 步：清理（0.5 天）

删 `server/`、`src/stage/sources/*Source.ts`、`electron/engine` 构建、相关测试；`package.json` 减依赖（ws、tsx 等）。保留 `scripts/dev:bigfish` = `dsh --profile bigfish --patch ./bigfish-dev.patch.yml`。

## 4. 工作量与风险

| 部分 | 估时 | 风险 |
|---|---|---|
| profile + 占位插件 | 1.5 天 | 低：机制已核实，有官方 60+ 例可参考 |
| 数据面重写 | 2 天 | 中：`session.follow` 的 replace/settle 语义要读懂（README 已有详细描述） |
| 舞台 UI 移植 | 3 天 | 中：slot/Factory 体系要学；但可"先丑后美"——先整个 view 自定义，再渐进拆 slot |
| 打包 + 清理 | 1.5 天 | 低 |

**总计约 8 天**，大头在第 3 步。风险主要不是"能不能做"（机制是官方支持的），而是 client 插件 API 细节要边做边查（各 `ctx.*` 服务的完整 surface 在源码 d.ts 里，README 只覆盖了概念）。

**降级路径**：如果不想一步到位重写 UI，可以先只做第 0/1 步——把**现有 vite dist 整个塞进 `frontend-static`**，让 P5 前端作为一个"自定义 shell"直接消费 `connection` 的 fetch API（不注册为模块插件，纯页面替换）。这样 2 天就能"坐在 DSH 上"，之后再渐进把 UI 拆成正式插件。

## 5. 建议的推进顺序

1. 先做降级路径：bigfish profile + 替换 dist（现有前端连 `connection` API）→ 最快看到"DSH 上的 P5"
2. 再按第 2/3 步把 UI 拆成真正的 `dsh.client` 插件
3. Electron 壳最后包
