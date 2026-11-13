# BigFish Stage · 大肥鱼工作台

<p align="center">
  <strong>把硬核 AI 编程引擎，变成高反差红黑波普漫画风的实时角色演出舞台！</strong><br/>
  <sub>原生支持 <b>DeepSeek Harness (DSH) 一键插件换肤</b> · <b>Electron 独立桌面端</b> · <b>本地 Web 工作台</b> · <b>离线剧本演示</b></sub>
</p>

![BigFish Stage · 大肥鱼工作台全站视图](./docs/screenshots/hero-dsh-stage.webp)

---

## 这是什么？

传统的 AI Coding 工具（终端 CLI、普通左右分栏聊天框）生产力强但枯燥冰冷；而市面上的二次元桌面伴侣又大多只是“陪聊花瓶”，无法真正深入本地工程目录读写代码。

**BigFish Stage · 大肥鱼工作台** 将两者合二为一：以工业级的 **DeepSeek Harness (DSH)**（及本地多适配器服务）作为真实执行内核，采用原创的 **高反差红黑斜切波普漫画分镜 HUD（Pop-Art Comic Stage）** 重构了整套人机协作体验——让**读文件、改代码、审 Diff、批权限、多模型换手接力**变成各家大模型看板娘在舞台上的实时演出。

---

## 最快体验：一键装入 DeepSeek Harness（零配置推荐）

如果你电脑上已经安装了 **DeepSeek Harness**，无需克隆代码或配置环境，**10 秒即可全站变身**：

1. 打开 DeepSeek Harness 左侧栏的 **「插件」** 页面，点击右上角 **「＋ 添加插件」**；
2. 在弹窗输入框中直接粘贴本仓库地址：
   ```text
   https://github.com/hideaway007/bigfish-stage
   ```
3. 点击 **「安装」**，整个客户端即刻切换为 **大肥鱼工作台全站红黑皮肤 + 舞台会话档案栏**，自动复用你现有的全部工作区、历史会话与模型凭证！

> **随时无损切回**：左侧舞台会话档案栏内置了 **`MOD 插件`**、**`JOB 自动化任务`** 与底部 **`⚙ 原生设置`** 入口；在插件页关闭开关即可通过 HMR 实时恢复原版界面，无需重启。

---

## 核心亮点与差异化设计

### 1. 真干活的工程交互，全面重构为漫画分镜演出语言
告别滚屏黑白日志，把每一次 Agent 动作都变成可交互的视觉反馈：
- **`ACTION CHECK` 双刃权限决断**：当角色请求执行受控终端命令或高危写操作时，自动唤起角色眼神切入横幅与红黑双刃选择框（**批准放行 / 拦截暂缓**），支持方向键与回车秒批。
- **技能切入卡（Skill Cut-in）与代码变更抽屉**：工具调用实时滑入斜切技能卡，点击顶部 **`🗂 代码变更`** 即可查看结构化 Git Diff、单文件安全撤回与一键提交。
- **运行中随时插话（Steer）与记忆凝炼（Compaction）**：模型执行途中可随时追加补充指令；左下角 **`CONTEXT GAUGE`** 实时监测上下文水位，支持一键触发记忆蒸馏演出。
- **视觉小说级回看 + 硬核工程视图双切**：按 `L` 打开 **Backlog 对话回看**，按 `` ` ``（反引号）一键切回极客纯文本工程时间线，兼顾演出爽感与严肃排障。

![ACTION CHECK 权限决断与实战演出](./docs/screenshots/demo-action-approval.webp)

---

### 2. 四大首发 AI 娘驻场 · 独立大脑与角色换手接力（Agent Relay）
深度对齐 B 站 UP 主 **ZipZipPipe**（UID `4168597`）创作的人气“AI 娘”设定体系，每位角色拥有 **6 种情绪立绘差分**（待机 / 思考 / 干活 / 开心 / 担忧 / 震惊）、**分部位触摸互动反馈**、**定制舞台口癖**以及**各自独立的模型大脑与房间记忆**：

![四大首发角色实机舞台图鉴](./docs/screenshots/characters-showcase.webp)

| 角色代号 | 对应阵营 / 模型定位 | 舞台人设特征与专属称呼 | 标志性台词梗 |
| :--- | :--- | :--- | :--- |
| **大肥鱼** | **DeepSeek V4 Pro**（全栈冲锋） | 蓝白鲸鱼女仆、呆毛与大鲸尾，称呼你为 **「店长」** | *“远看肥鱼大，近看大肥鱼！首先，握住 harness，然后，挥舞吧！”* |
| **哈基米 · Argon** | **Gemini 4 Argon**（视觉焊接 / 前端动效） | 蓝紫粉渐变卷发异色瞳猫娘、护目镜与氩弧焊枪，称呼你为 **「铲屎官」** | *“护目镜擦亮啦！正在进行氩弧焊的哈基米——这焊缝甜美的很啊～”* |
| **Claude 娘** | **Claude Opus 5.5**（架构推演 / 重构） | 橙色超长发、太阳花星芒头饰、文学长裙与抗压女仆装，称呼你为 **「委托人 / 老师」** | *“女仆装熨好了，脑子也是。请讲。”* |
| **白龙娘** | **GPT / Codex**（严苛审查 / 全局洞察） | 银角白翼高洁龙娘，从容冷静洞察全局，称呼你为 **「搭档」** | *“白翼落定。搭档，今天的舞台交给我护航吧。”* |

- **⚡ 换手接力（Agent Relay）**：点击输入框上方的 **「⚡ 换手接力」**，可将当前会话的代码改动与上下文一键交接给下一位角色与对应模型继续推进（例如让哈基米焊完前端 UI，再交接给白龙娘做代码审查）。

---

### 3. 多模型引擎路由 + 全屏 / 半屏分屏自适应舞台
- **多源 AI 引擎配置中心**：内置可视化设置面板，既可直连 DeepSeek Harness 原生模型目录，也可配置 OpenAI、Anthropic 及兼容网关凭证，并为每位角色绑定专属推荐模型与思考强度（`low` / `medium` / `high`）。
- **容器级响应式布局（`@container stage`）**：无论是全屏沉浸使用、普通窗口（自动避让 macOS 左上角红绿灯），还是拉成 **左右半屏分屏（`≤ 920px`）** 边看 IDE 边挂舞台，界面都会自动从双栏平滑变阵为 **「上方横向角色看板 + 下方 100% 全宽工作台」**，绝不遮挡输入框。

![独立大脑设置中心与半屏分屏响应式布局](./docs/screenshots/responsive-and-engine.webp)

---

## 一仓多态：4 种运行与交付方式

同一个仓库同时支持 **DSH 插件、Electron 桌面外壳、内置本地 Web 服务、纯静态剧本演示** 四种模式。不同模式的底层内核与能力边界如下：

| 运行模式 | 执行内核与前置要求 | 支持能力范围 | 模式边界说明 |
| :--- | :--- | :--- | :--- |
| **1. DSH 插件模式**<br/>（`dsh plugin add` / `npm run dsh`） | 本机已安装 `dsh` CLI 及对应模型凭证 | 全站红黑皮肤 + 左侧会话档案栏、角色立绘/Live2D 差分、真实文件读写技能卡、原生权限审批、运行中插话、上下文压缩、角色换手接力、多会话切换 | 通过 DSH 的登录保护接口提供 Git 变更查看、单文件撤回和提交；角色按项目保存各自模型与会话 |
| **2. Electron 桌面端**<br/>（`npm run app` / 安装包） | 本机已安装 `dsh` CLI（自动探测 `~/.local/bin`、`nvm`、`fnm`、Homebrew，或通过 `DSH_BIN` 指定） | 与 **DSH 插件模式** 完全一致，另含独立桌面窗口（macOS 红绿灯避让）与系统原生目录选择框 | 桌面安装包为轻量外壳，**不内置 `dsh` 二进制或模型 API Key** |
| **3. 内置 `server/` Web 模式**<br/>（`npm start` / `npm run dev:server`） | Node.js 22+；完整工程读写需本机已装 `dsh` 或 `codex` CLI（纯对话可用 OpenAI 兼容接口） | 舞台立绘与台词演出、三适配器切换（DSH / Codex / 直连对话）、独立台词模型配置、**内置 Git Diff 查看 / 单文件撤回 / 一键提交抽屉** | 不包含 DSH 原生插件管理与定时任务宿主壳层；直连对话适配器不具备本地文件与终端执行能力 |
| **4. 纯前端离线 Demo**<br/>（`?demo=1`） | 仅需浏览器（开发期需 Node.js 启动静态页），零 CLI / 零 API Key | 预置剧本自动回放、立绘/Live2D 交互、触摸反馈、模拟权限决断、Backlog 回看、工程视图切换 | **纯前端离线演示**，不读写本地文件、不执行真实命令、不调用真实模型 |

角色模型需在设置中选择本机可用的模型。没有配置专属模型时，会优先使用可用的角色推荐模型，否则使用宿主默认模型；角色名称本身不代表已经接入该厂商。任务进行中需先等待完成或喊停，再换角色、模型或项目。

记忆整理不会删除回看记录。DSH 使用原生 `/compact`；独立 Web 的直连对话模式将旧对话摘录折叠为本地摘要；当前 Codex CLI 适配器不支持手动整理，会明确提示。引擎没有返回统计时，界面显示等待统计，不推算释放数量。

本次已在 DSH `0.2.2-rc.1` 验证全新配置启动、受保护接口和静态资源。旧版资源入口仍保留兼容；若提示角色房间或代码变更接口不可用，请升级 DSH 并重新启用插件。

### 方式一：作为 DeepSeek Harness 插件安装（推荐）
直接在 DeepSeek Harness 插件页添加 `https://github.com/hideaway007/bigfish-stage`，或通过命令行安装到指定 Profile：

```bash
dsh plugin --profile web add https://github.com/hideaway007/bigfish-stage
```

### 方式二：作为 Electron 独立桌面客户端运行 / 打包
前提：本机已安装 Node.js（建议 v22+）与 `dsh` CLI（若 `dsh` 安装在非标准位置，可设置环境变量 `DSH_BIN=/path/to/dsh`）。

```bash
npm install
```

```bash
npm run app
```

如需构建 macOS 桌面应用目录或 `.dmg` 安装包（产物输出至 `output/`，采用 `asar: false` 真实磁盘目录以便外部 `dsh` 直接加载插件与静态资源）：

```bash
npm run dist:mac
npm run dist:dmg
```

### 方式三：本地浏览器 Web 工作台模式
- **基于 DSH 内核启动网页舞台**（全新机器首次运行会自动初始化 `~/.dsh/profiles/bigfish` 与本地插件软链接，无需先打开 Electron）：
  ```bash
  npm run dsh
  # 或固定在 62000 端口且不自动弹窗：
  npm run dsh:web
  ```
- **基于内置 `server/` WebSocket 服务生产方式启动（默认端口 `5300`）**：
  1. 安装根项目依赖与 `server` 运行依赖：
     ```bash
     npm install && npm --prefix server install --omit=dev
     ```
  2. 预构建前端静态资源（`dist/`）与服务端生产入口（`server/dist/index.js`）：
     ```bash
     npm run build && npm run build:server
     ```
  3. 启动本地生产服务（浏览器访问 `http://127.0.0.1:5300`）：
     ```bash
     npm start
     ```
  *(开发联调如需热重载，可执行 `npm --prefix server install` 后分别运行 `npm run dev:server` 与 `npm run dev`。)*

### 方式四：零后端纯前端 Demo 剧本体验
无需安装任何 Agent CLI 或配置 API Key，直接体验角色互动、技能卡、模拟权限决断与回看演出：

```bash
npm install
```

```bash
npm run dev
```

浏览器打开 `http://127.0.0.1:5173/?demo=1` 即可交互体验。

---

## 舞台快捷键速查

| 快捷键 | 功能说明 |
| :--- | :--- |
| `Space`（空格） | 立即跳字显示当前整句角色台词 |
| 按住 `Ctrl` | 快进舞台演出节奏 |
| `L` | 打开 / 关闭 **Backlog 对话与工具历史回看** |
| `H` | 打开 / 关闭会话快速切换面板 |
| `` ` ``（反引号） | 一键切换 **大肥鱼工作台视图 ⇄ 极客工程视图** |
| `Esc` / `Cmd+,` | 关闭当前弹层，或打开 **设置中心** |
| `Cmd+B` / `Ctrl+B` | 展开 / 收起左侧 **舞台会话档案栏**（DSH 模式） |
| `?` | 打开舞台快捷键帮助面板 |

---

## 仓库目录结构

```text
bigfish-stage/
├── cordis.patch.yml                 # DSH 组合包 Patch（接管全站红黑波普主题与舞台视图）
├── dsh-bundle/                      # 预构建 DSH 插件产物、图标与中英文多语言元信息
├── packages/
│   └── dsh-client-ui-p5stage/       # DSH 原生客户端插件源码（DshStageSource 桥接 + 会话档案侧边栏）
├── src/
│   ├── stage/                       # 大肥鱼工作台核心 UI（立绘视差、锯齿台词框、权限决断、设置中心）
│   ├── demo/                        # 离线可交互演示剧本播放器
│   └── shared/                      # 前后端与角色包共享 TypeScript 契约
├── public/
│   ├── characters/                  # 4 大角色包配置（character.json + 6 表情立绘与头像）
│   └── sfx/                         # 舞台交互音效资源
├── electron/                        # Electron 独立桌面客户端外壳（自动唤醒本机 DSH 运行时）
├── scripts/                         # 本地角色包校验、DSH Profile 初始化启动与模拟测试脚本
├── server/                          # 独立 Web 模式的本地 WebSocket 服务端与测试套件
└── docs/                            # 架构文档、角色设定参考与高清实机截图
```

*(开发维护提示：若修改了 `src/` 或 `packages/dsh-client-ui-p5stage/` 源码，提交前请运行 `npm run build:stage` 以同步更新 `dsh-bundle/` 预构建插件包。)*

---

## 致谢、版权与素材授权说明

- **仓库代码许可状态**：本仓库当前未附带开源许可证文件（`package.json` 标记为 `private: true`），在项目方正式声明许可证前默认保留相关权利，请勿擅自将其标注为 MIT 或其他开源许可。
- 本项目中的“AI 娘”角色形象设定（大肥鱼、哈基米 · Argon、Claude 娘、白龙娘等）源自 B 站 UP 主 **ZipZipPipe（UID: 4168597）** 的开源二创设定体系，遵循原作者声明的 **[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)**（署名-非商业性使用-相同方式共享）协议，**仅限非商业学习交流与开源二创使用**。
- **第三方运行时与媒体素材商业授权待确认**：
  - `public/characters/deepseek-v4-pro/art/live2d/` 包含 Live2D Cubism Core（受 [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) 约束）、第三方渲染运行时打包文件（`pixi.min.js`、`cubism4.min.js`）及角色 Live2D 模型文件，其对外再分发与商业使用授权**待确认**。
  - `public/sfx/` 下的 `.mp3` 舞台音效文件原始来源与商业分发授权**待确认**（如移除外部音频映射，前端支持自动回退至内置 WebAudio 合成音效）。
- 详细发布前检查项参见 [`docs/release-readiness.md`](./docs/release-readiness.md)。
