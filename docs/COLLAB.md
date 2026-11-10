# 两人分工：A 界面与功能 · B 底层与角色形象

> **最新架构共识（已定稿，详见 [`docs/DSH_ARCHITECTURE.md`](./DSH_ARCHITECTURE.md)）**：
> 1. **底层选型确定为 DeepSeek Harness (DSH)**：不再自己造轮子去后端硬调外部 CLI，而是以 DeepSeek Harness 作为核心 Agent 底座，现有前端保留为 Demo 演示与 P5 风格舞台。
> 2. **当前阶段原则（先备齐外围配置与素材，不乱改主干代码）**：先围绕角色包配置生成所需的全部视觉素材（立绘、头像、Live2D 模型资产、音效）与 DSH 外围配置，避免两人同时改代码撞车。
> 3. **严格零重叠分工**：本文件是两人分工的唯一依据，各自只动自己归属的目录与任务，绝不重复劳动。
> 4. **【给对面 AI 与本侧 AI 的强制分支铁律】**：**任何一方都严禁直接修改或直接 push `main` 分支！** 双方必须各自从 `main` 拉出自己的专属分支开发（**A 侧拉 `agent-a` 或 `ui/<功能>` 分支；B 侧拉 `agent-b` 或 `art/<功能>`、`core/<功能>` 分支**），只在自己的分支上提交并开 PR。

## 一句话分工

| | **A：界面与功能**（项目发起人） | **B：底层与角色形象**（合作者） |
|---|---|---|
| 关心的问题 | P5 舞台交互爽不爽、Demo 与界面功能完不完整、角色台词有没有灵魂 | 角色立绘/Live2D 帅不帅、外围素材齐不齐、DSH 底座配置稳不稳 |
| 主要技术 | React、CSS 动画、P5 界面组件、角色人设文案与台词 | AI 生图与抠图管线、Live2D 拆件与渲染、DSH 外围配置与底座桥接 |
| 当前重心 | 打磨现有 P5 舞台 UI 细节、角色台词文案（`persona` / `reactions`）与界面交互 | **围绕外围配置先生成角色正式立绘（4 角色 × 6 表情 + 头像）、Live2D 素材与 DSH 挂载配置，暂不动现有前端主干代码** |

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

### 第一优先级：围绕外围配置生成素材（当前集中推进，不碰 A 的前端代码）

| # | 内容 | 需要 A 配合吗 |
|---|---|---|
| B1 | **4 角色正式立绘与头像生成（核心素材）**：按《`docs/AI娘人设整理_配图版.pdf`》设定，为 `deepseek-v4-pro`（大肥鱼）、`gemini-4-argon`（哈基米）、`claude-opus-5-5`（Claude 娘）、`codex-dragon`（Codex 龙娘）各生成 6 张透明背景表情立绘（`idle / thinking / working / happy / worried / shocked`）+ 1 张 `portrait` 头像，直接替换 `public/characters/<id>/art/` 下的占位图，并跑通 `npm run check:characters` | **否**（只改 `public/characters/<id>/art/`，文件名与格式保持不变，零代码冲突） |
| B2 | **DSH 外围配置与角色-模型映射清单**：整理 DeepSeek Harness 底座的外围配置文件（Profile Patch 模板、4 角色对应模型路由表、工具视图映射配置），不侵入现有 `src/stage/` 代码 | **否** |
| B3 | **Live2D 模型资产与渲染器准备**：单张正式立绘 → 拆图层 / Live2D 模型资源包准备，并在 `src/stage/components/CharacterRenderer.tsx`（及 `src/render/`）内独立实现 `renderer: 'live2d'`，支持表情/动作映射、视线跟随与口型同步 | 需要 A 留出画布尺寸和点击区域 |
| B4 | **授权**：PDF 里的角色是 ZipZipPipe 的设计，公开发布前联系原作者取得授权；仓库里的 PDF 和 P5X 截图要不要从 Git 历史里清除，两人商量后决定 | 两人一起 |

### 第二优先级：DeepSeek Harness 底座对接与底层打磨（待素材与外围配置就绪后推进）

| # | 内容 | 需要 A 配合吗 |
|---|---|---|
| B5 | **DeepSeek Harness (DSH) 底座接入**：用 DSH 原生会话、工具链与事件流作为底层执行内核，避免重复造 CLI 包装轮子 | 否，复用现有 `StageEvent` 契约 |
| B6 | **会话持久化与历史列表**：依托 DSH 原生 `@deepseek-ai/dsh-session` 提供跨重启历史保留与会话列表能力 | 配合 A3 |
| B7 | **diff 准确性**：每轮开始前记一次快照，结束后对比，不再把项目里原有的未提交改动算进本轮 | 否 |
| B8 | **台词模块打磨**：切换高响应速度的轻量台词模型（1～2 秒首字），调整提示词防止编造进度 | 否 |
| B9 | **工程化**：GitHub Actions 自动跑测试和类型检查；以后用 Tauri 打包成桌面应用 | 否 |

## 协作流程

1. **【强制分支隔离】各自拉独立分支，绝不直接改 `main`**：
   - **A 侧 AI**：从 `main` 切出 `agent-a` 或 `ui/<功能>` 分支工作。
   - **B 侧 AI**：从 `main` 切出 `agent-b` 或 `art/<功能>` / `core/<功能>` 分支工作。
   - 改共享契约单独切 `contract/<内容>` 分支。
2. **一律推送各自独立分支并开 PR，严禁直接 push `main`。** 只改自己目录的 PR 可以自己合并；动了共享区（如 `docs/COLLAB.md`、`src/shared/*`）的 PR 由对方确认后合并。
3. **合并前自检**：根目录 `npm run typecheck && npm run build && npm run check:characters`，`server/` 下 `npm run check && npm test`。
4. **派给 AI Agent 干活时**：让它先读本文件（`docs/COLLAB.md`）与 `docs/DSH_ARCHITECTURE.md`，确认自己是 A 还是 B、先切到自己的专属分支、只改自己归属的目录。
5. **仓库是公开的**：不提交 key、邮箱、本机绝对路径，不提交第三方素材。

## 本地启动

```bash
npm install && (cd server && npm install)
npm start              # 构建网页并启动服务 → http://127.0.0.1:5300
```

开发时开两个终端：一个跑 `npm run dev:server`，一个跑 `npm run dev`（网页热更新，WebSocket 自动代理到服务端）。只看界面、不想连真 Agent 时，访问 `/?demo=1`，或者先跑 `npm run mock:server`。
