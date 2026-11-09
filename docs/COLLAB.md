# 两人分工：A 界面与功能 · B 底层与角色形象

> 项目现状：Phase 1 已完成（`npm start` → http://127.0.0.1:5300 ，真实 Codex 可用）。从现在起不再按「阶段」推进，而是两人各自负责一块，沿着下面的清单并行开发。
> 本文件是分工的唯一依据。哪一块归谁有争议时，以这里为准；需要调整就改这个文件。

## 一句话分工

| | **A：界面与功能**（项目发起人） | **B：底层与角色形象**（合作者） |
|---|---|---|
| 关心的问题 | 用户看到什么、怎么操作、爽不爽 | 能不能稳定干活、角色长什么样、怎么动 |
| 主要技术 | React、CSS 动画、交互设计、文案 | Node 服务、Agent 适配器、生图流程、Live2D |
| 产出形态 | 页面、组件、角色台词和反应表 | 服务端能力、新的执行 Agent、立绘资源、Live2D 渲染 |

## 目录归属

改别人的目录前先打招呼；改**共享区**必须两个人都同意。

| 目录 / 文件 | 归属 | 说明 |
|---|---|---|
| `src/stage/`（`components/CharacterRenderer.tsx` 除外）、`src/demo/` | **A** | 界面、交互、数据源 |
| `index.html`、`vite.config.ts` | **A** | |
| `public/characters/<id>/character.json` 中的 `persona`、`reactions`、`name`、`tagline` | **A** | 角色的「灵魂」：人设和台词 |
| `server/`、`bridge/` | **B** | 服务、适配器、台词模块 |
| `src/stage/components/CharacterRenderer.tsx` 及以后新建的 `src/render/` | **B** | 立绘与 Live2D 的渲染实现。A 只决定它放在界面的哪里、多大 |
| `public/characters/<id>/art/` 和 `character.json` 中的 `art` 字段 | **B** | 角色的「身体」：立绘、头像、Live2D 模型 |
| `scripts/` | 谁写的归谁 | `check-characters.mjs` 归 B（它校验美术资源） |
| **共享区**：`src/shared/*`（契约）、根目录 `package.json`、`docs/COLLAB.md` | **A + B** | 改动必须在 PR 里说明，另一人批准后才能合并 |

新增一个角色时，A 写 `character.json` 里的人设和台词，B 做 `art/`。两人都完成后，跑 `npm run check:characters` 通过，这个角色才算上线。

## 两人之间的接口（契约）

两边只通过这 4 个文件对话，见 [`src/shared/`](../src/shared/)：

| 文件 | 内容 | 谁最常要改 |
|---|---|---|
| `stage-events.ts` | 执行过程中发生的事件 | B（新 Agent 可能带来新事件）|
| `wire.ts` | 网页 ⇄ 服务的 WebSocket 命令和消息 | A（新功能常常需要新命令）|
| `character-pack.ts` | 角色包格式 | 两人都会改 |
| `settings.ts` | 设置项 | 两人都会改 |

**改契约的流程**：先开一个只改 `src/shared/` 的小 PR，把新字段写清楚，**新字段一律设为可选**，保证旧代码不报错。对方批准后合并，然后两人各自去实现自己那一侧。这样谁都不会被对方卡住。

## A 的清单：界面与功能

按建议的优先级排序。

| # | 内容 | 需要 B 配合吗 |
|---|---|---|
| A1 | **去掉写死的大肥鱼文案**：左上角表情标签（「蒸汽机车」等）、输入框标题「投喂大肥鱼」都改成从当前角色包读取。可能需要在 `character-pack.ts` 里加 `emotionLabels`、`uiCopy` 等可选字段 | 改契约，要 B 批准 |
| A2 | **首次使用引导**：没选项目文件夹时，主界面直接引导去选，而不是等到报错 | 否 |
| A3 | **会话列表**：查看并切换历史会话、继续之前的会话 | 要 B 提供「会话列表」命令（契约 + 服务端） |
| A4 | **4 个角色的台词打磨**：每个角色的 `reactions` 和 `persona.systemPrompt` 按 PDF 的梗重写，这块最需要你本人来写 | 否 |
| A5 | **档案层 / 回看 / 工程视图的体验**：diff 查看器加行号和折叠、搜索回看、快捷键帮助面板 | 否 |
| A6 | **演出打磨**：切换角色的过场、技能卡动画、审批选择肢的音效（音效文件放 `public/sfx/`） | 否 |
| A7 | **设置页体验**：模型列表搜索、连接测试结果的友好提示、角色页的「推荐模型」一键套用 | 否 |
| A8 | **多角色同屏 / 角色之间的对话**（大功能，先做设计稿再说） | 需要，届时再拆 |

## B 的清单：底层与角色形象

### 角色形象

| # | 内容 | 需要 A 配合吗 |
|---|---|---|
| B1 | **正式立绘**：用生图模型（本机 magpie 网关的 GPT Image 2，透明背景）按 PDF 设定为 4 个角色各生成 6 个表情和 1 张头像，保证同一角色在不同表情下长得一致。替换 `art/` 里的代码占位图 | 否，格式不变 |
| B2 | **Live2D 渲染器**：在 `CharacterRenderer` 里实现 `renderer: 'live2d'`（`pixi-live2d-display` + Cubism Core），支持表情 / 动作映射、视线跟随、说话时嘴巴开合。注意 Cubism SDK 的授权条款 | 需要 A 留出画布尺寸和点击区域 |
| B3 | **Live2D 模型制作流程**：单张立绘 → 拆图层（参考 See-through 等工具）→ Cubism 绑骨。先拿一个角色走通 | 否 |
| B4 | **授权**：PDF 里的角色是 ZipZipPipe 的设计，公开发布前联系原作者取得授权；仓库里的 PDF 和 P5X 截图要不要从 Git 历史里清除，两人商量后决定 | 两人一起 |

### 底层

| # | 内容 | 需要 A 配合吗 |
|---|---|---|
| B5 | **会话持久化**：服务重启后，界面上的历史事件不丢；提供会话列表命令 | 配合 A3 |
| B6 | **第二个执行 Agent 适配器**：Claude Code（Agent SDK 流式模式）或 Gemini CLI。新增 `server/src/adapters/<name>.ts`，不改 `session.ts` | 否，设置页的下拉框会自动出现 |
| B7 | **diff 准确性**：每轮开始前记一次快照，结束后对比，不再把项目里原有的未提交改动算进本轮 | 否 |
| B8 | **台词模块打磨**：降低首字延迟（目前约 8 秒），调整提示词防止编造进度，测几个更快的台词模型 | 否 |
| B9 | **工程化**：GitHub Actions 自动跑测试和类型检查；以后用 Tauri 打包成桌面应用 | 否 |

## 协作流程

1. **分支命名**：A 用 `ui/<功能>`，B 用 `core/<功能>` 或 `art/<功能>`。改契约用 `contract/<内容>`。
2. **一律开 PR 合进 `main`，不直接推 `main`。** 只改自己目录的 PR 可以自己合并；动了共享区的 PR 必须对方批准。
3. **合并前自检**：根目录 `npm run typecheck && npm run build && npm run check:characters`，`server/` 下 `npm run check && npm test`。
4. **派给 AI Agent 干活时**：让它先读这个文件和 `docs/tasks/PHASE1.md`（环境事实、magpie 网关、安全约束都在那里），并告诉它你是 A 还是 B、只能改哪些目录。
5. **仓库是公开的**：不提交 key、邮箱、本机绝对路径，不提交第三方素材。

## 本地启动

```bash
npm install && (cd server && npm install)
npm start              # 构建网页并启动服务 → http://127.0.0.1:5300
```

开发时开两个终端：一个跑 `npm run dev:server`，一个跑 `npm run dev`（网页热更新，WebSocket 自动代理到服务端）。只看界面、不想连真 Agent 时，访问 `/?demo=1`，或者先跑 `npm run mock:server`。
