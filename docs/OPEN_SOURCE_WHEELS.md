# GitHub 现成开源轮子调研与“不造轮子”拼装方案

> 核心原则：**能直接复用的绝不手搓**。我们将整个产品拆解为 **① Live2D 互动舞台与口癖驱动**、**② P5 风格 UI 与弹性对话框**、**③ 本地 CLI 会话（Claude Code / Codex / Gemini）桥接**、**④ 单张 AI 娘立绘自动拆件转 Live2D** 四个模块，在 GitHub 上筛选出了星标最高、最契合的现成开源项目。

---

## 一、 Live2D 角色舞台 + 表情动作状态机 + 触摸互动（核心底盘）

| 项目名称 | Star 数 | 技术栈 / 协议 | 已经帮我们造好的轮子（可直接复用部分） |
| :--- | :--- | :--- | :--- |
| **[Open-LLM-VTuber/Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)** | **14,653 ⭐** | Web / Electron + FastAPI + WebSocket (MIT) | **最推荐直接拿来做底盘！**<br>1. 现成 Web 端 Live2D 渲染画布，内置**鼠标视线追踪**、**分部位点击反馈 (`tapMotions`)**、**实时口型同步 (LipSync)**。<br>2. **独门绝技 `model_dict.json`**：支持在回复流里解析 `[joy]`、`[smug]`、`[shocked]` 等情绪标签，实时自动切换 Live2D 的 `.exp3.json` 表情和 `.motion3.json` 动作。<br>3. 现成 `characters/*.yaml` 角色人设卡机制，且原生支持 `mcp_servers.json` 与 Claude / Gemini / OpenAI。 |
| **[moeru-ai/airi](https://github.com/moeru-ai/airi)** | **51,233 ⭐** | Vue 3 + TypeScript + PixiJS Monorepo (MIT) | GitHub 目前最大的开源 AI 娘赛博伴侣项目。其 `packages/` 下已拆好独立模块：<br>- `@proj-airi/stage-ui-live2d`（现成 Vue3 Live2D 舞台组件，恰好与下面 Vue3 版的 `p5-ui` 同构！）<br>- `@proj-airi/model-driver-lipsync`（口型驱动器）<br>- `@proj-airi/core-character`（角色灵魂状态机） |
| **[Project-N-E-K-O/N.E.K.O](https://github.com/Project-N-E-K-O/N.E.K.O)** | **3,204 ⭐** | Python + Web Live2D | 开源猫娘伙伴 Agent 社区，内置 Live2D 交互、长短期记忆、实时语音视觉与插件市场。 |
| **[guansss/pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)** | **1,517 ⭐** | TypeScript + PixiJS (MIT) | 几乎所有 Web Live2D 项目的底层核心渲染库。直接封装了 Cubism 2/3/4 的模型加载、`hitTest(x,y)` 碰撞检测、物理引擎与动作队列。 |

---

## 二、 《女神异闻录 5》(P5) 风格 UI 与对话框组件

| 项目名称 | Star 数 | 技术栈 | 已经帮我们造好的轮子（可直接复用部分） |
| :--- | :--- | :--- | :--- |
| **[q-mona/p5-ui](https://github.com/q-mona/p5-ui)** | **281 ⭐** | Vue 3 + Vite | **现成的 P5 风格前端组件库！** `src/components/` 下已经写好了：<br>- `message` & `notification`：P5 标志性黑白锯齿漫画对话框与气泡<br>- `canvas`：P5 红黑几何动态背景画布<br>- `title` / `text` / `button` / `divider`：高反差斜切标题与按钮<br>- `backTop`：甚至连参考图右下角那个旋转的 `Top` 徽标都有现成组件！ |
| **[LzxHahaha/persona5](https://github.com/LzxHahaha/persona5)** | **75 ⭐** | HTML5 Canvas / JS | P5 预告信风格黑底红白锯齿高反差字体生成算法（可直接拷它的 `canvas` 文字抖动与斜切旋转绘制函数）。 |
| **[skyventuree/p5cc](https://github.com/skyventuree/p5cc)** | **99 ⭐** | Web | P5 Calling Card（预告信）红黑波普背景纹路与矢量斜切遮罩代码。 |

---

## 三、 本地正在跑的 Agent 会话桥接（Claude Code / Codex / OpenCode）

| 项目名称 | Star 数 | 技术栈 | 已经帮我们造好的轮子（可直接复用部分） |
| :--- | :--- | :--- | :--- |
| **[siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)** (CloudCLI) | **14,515 ⭐** | Node.js + TypeScript + WebSocket | **本地 CLI 桥接层的完美现成轮子！**<br>原生支持 **Claude Code、Codex、OpenCode、Cursor CLI**。它的 `server/` 模块已经完整实现了：<br>1. 自动扫描本地正在运行的会话与项目目录（`~/.claude/projects` 等）<br>2. 通过 WebSocket 将本地会话的 Thinking / Tool Call / 流式输出实时推送到网页端<br>3. 从网页端直接往本地正在跑的会话发送新消息或中断指令。 |
| **[matt1398/claude-devtools](https://github.com/matt1398/claude-devtools)** | **4,027 ⭐** | TypeScript / Electron / Web | 专门实时监听并解析本地 Claude Code 会话日志、子 Agent 状态、Tool 执行耗时的可视化解析器。 |
| **[iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi)** | **34,143 ⭐** | TypeScript | 支持 Claude Code、Codex、OpenCode 等 20+ CLI Agent 的统一适配层，可参考其多 CLI 进程通信协议。 |

---

## 四、 把 PDF 里的 AI 娘单张立绘快速转成 Live2D 模型的工具

你们手头的《AI娘人设整理_配图版.pdf》里是单张静态立绘（哈基米、Claude 娘、大肥鱼、Codex 娘），如果要自己做 Live2D 模型，可以用下面这个开源 AI 轮子省掉 80% 的 PS 拆件时间：

| 项目名称 | Star 数 | 用途与工作流 |
| :--- | :--- | :--- |
| **[jtydhr88/ComfyUI-See-through](https://github.com/jtydhr88/ComfyUI-See-through)**（基于 `shitagaki-lab/see-through`） | **918 ⭐** | **单张二次元立绘 → 自动拆分成 2.5D Live2D 标准 PSD 图层！**<br>输入一张 AI 娘立绘（如 Gemini 4 Argon 哈基米或大肥鱼），AI 自动将前发、后发、猫耳/鲸耳、五官、眼珠、躯干、四肢、裙摆分离成独立透明图层，并自动补全被遮挡部位的背景，直接导出 PSD 进 Live2D Cubism 绑骨即可。 |
| **[Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model)** | **3,508 ⭐** | 现成开源可测试的大量 `.model3.json` / `.moc3` 模型仓库——在你们自己的 AI 娘 Live2D 模型绑好骨之前，可以先拿里面的现成模型把舞台交互和口型同步全跑通！ |

---

## 五、 最省力的“三轮子合一”落地路线（零造轮子方案）

不用从零写底层，直接用 **Vue 3（或 React）** 把下面三个现成轮子拼起来：

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. 界面皮肤层：直接引入 q-mona/p5-ui + LzxHahaha/persona5 字体渲染      │
│    → 拿现成的 P5 锯齿对话框 (p5-message)、红黑动态背景画布 (p5-canvas)  │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. Live2D 舞台层：直接复用 @proj-airi/stage-ui-live2d 或 Open-LLM-VTuber│
│    → 现成的 .model3.json 加载、鼠标视线跟随、HitArea 触摸反馈、LipSync  │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. 本地会话桥接层：直接扒 siteboon/claudecodeui 的 server/ WebSocket 桥 │
│    → 实时读取本地 Claude Code / Codex / Gemini 会话流，映射成 Live2D    │
│      的动作切换（Thinking 望天 / Coding 氩弧焊 / Error 震惊）与气泡台词 │
└─────────────────────────────────────────────────────────────────────────┘
```
