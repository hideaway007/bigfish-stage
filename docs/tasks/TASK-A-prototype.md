# 任务 A：假数据交互原型（Scripted Prototype）

> 先读 [README.md](README.md)（总览与协作规则），再读本文件。
> 预计工作量：0.5～1 天。分支：`task-a-prototype`。

## 1. 背景（你需要知道的全部）

我们在做一个**给 coding agent（Codex / Claude Code 等）用的聊天客户端**，卖点是：**它长得像日式 RPG / 视觉小说的游戏界面，而不是 IDE**。现在市面上所有 Agent 界面都是「左边会话列表 + 右边滚动消息流」，我们要彻底摆脱这个形态。

本任务**不接任何后端、不调任何模型**。用一段写死的剧本（`StageEvent[]`）驱动界面，目的只有一个：**验证这个界面用起来爽不爽、和 Codex 那类界面拉开差距了没有**。

## 2. 技术约束

- 在仓库根目录开发：Vite + React + TypeScript（`package.json` 已有 `vite` 脚本，补齐依赖即可）。
- 代码放 `src/`，事件类型**必须**从 [`src/shared/stage-events.ts`](../../src/shared/stage-events.ts) 引入，不要自己另定义一套。
- 角色设定和口癖可以读 [`src/characters/roster.ts`](../../src/characters/roster.ts)，**不要修改它**。
- 不引入 Live2D、Three.js。角色用**静态图片按表情切换**即可。
- 不需要状态管理库；`useReducer` 足够。动画用 CSS 或 Framer Motion 二选一。

## 3. 视觉方向

- 风格关键词：**红 / 黑 / 白三色、斜切几何、粗描边、半调网点（halftone）、漫画式切入（cut-in）、大号倾斜标题字**。参考了 P5 一类游戏的美学，但必须是**原创实现**。
- **禁止**使用：任何游戏截图、游戏 Logo、游戏官方字体、`docs/` 里的 PDF 图片、`docs/p5-layout-reference.webp` 的像素素材。参考图只看布局。
- 字体用免费可商用字体（如 Google Fonts 的 Anton / Bebas Neue + Noto Sans SC Black）。
- 角色立绘：用**占位图**。每个表情一张，路径约定为 `public/characters/<characterId>/<emotion>.png`（emotion 见 `Emotion` 类型）。占位图可以是带表情文字的剪影 SVG/PNG，之后由美术替换，**替换时不应需要改代码**。

## 4. 界面结构（暂定布局，可以调整，但四层必须都有）

参考布局：**左侧角色立绘，上方角色对话框，右下角玩家输入框**。

| 层 | 内容 | 表现要求 |
|---|---|---|
| **台词层**（主舞台） | `character_line` 事件 | 对话框**一次只显示当前这句**，打字机效果；角色立绘随 `emotion` 切换，切换时有小幅弹动或抖动 |
| **行动层** | `tool_start` / `tool_end` | **不进入消息流**。显示为「技能发动」卡片，例如「大肥鱼 发动 EDIT ▶ `src/app.ts` +12 −3」；进行中有动效，结束后标记成功或失败，几秒后收进侧边的「行动记录」条 |
| **档案层**（按需） | `tool_end.diff` / `output` | 点击技能卡或行动记录才展开，显示完整 diff（带红绿高亮）或终端输出；`Esc` 关闭 |
| **HUD** | 会话状态 | 角色卡上显示：模型名、当前状态（待机 / 思考 / 行动中）、本轮耗时；样式像游戏里的状态条 |

另外必须实现：

1. **权限选择肢**：收到 `permission_request` 时，屏幕中央弹出大号二选一（「允许」/「拒绝」），同时**原样显示** `detail`（命令全文）。键盘 `←/→` + `Enter` 可选。两个分支都要能走通（见第 5 节剧本）。
2. **Backlog（回看）**：主界面不显示历史消息流。按 `L` 或点按钮打开回看面板，按时间顺序列出全部 `user_message` / `character_line` / 技能卡 / `worker_text`。
3. **快进 / 跳过演出**：按住 `Ctrl` 快进（打字机和动画加速）；点击对话框或按 `Space` 立即显示整句。
4. **工程视图开关**：按 `` ` ``（反引号）切换到朴素的「工程视图」，按时间线平铺所有事件（包括 `worker_text` 原文）。这是给赶时间的用户留的后门，**必须有**。
5. **插话**：剧本运行中，用户在输入框发消息 → 立即生成 `steer_queued`，界面显示「已传达，待接收」；剧本中稍后的 `steer_acked` 到达时改为「已接收」。

## 5. 剧本（写在 `src/demo/script.ts`）

用 `StageEvent[]` + 每个事件的延迟（ms）实现一个播放器（`src/demo/player.ts`）。用户在输入框发出**第一条消息**时开始播放。剧本至少包含：

```
user_message        "帮我把登录页的按钮颜色改成主题色，然后跑一下测试"
character_line      thinking   （角色说一句开工台词）
thinking
tool_start/end      read   src/pages/Login.tsx
tool_start/end      edit   src/pages/Login.tsx  （带一段真实感的 diff）
character_line      working
permission_request  bash   "npm test -- Login"
  ├─ 允许 → tool_start/end bash（输出：测试 1 个失败）
  │        → character_line worried
  │        → tool_start/end edit（修复）→ tool_start/end bash（全部通过）
  │        → character_line happy → turn_done ok
  └─ 拒绝 → permission_resolved false → character_line worried（角色表示理解并说明没跑测试）
           → turn_done ok
```

剧本里的台词请结合 `roster.ts` 里的口癖，写得有角色感。首发角色是 **大肥鱼**（DeepSeek 娘，`roster.ts` 中 `id: 'deepseek-v4-pro'`）：深蓝卷发、呆毛、鲸鳍耳、大鲸尾、小鲸鱼围裙女仆装，招牌梗是举着 `max / low` 两块牌子一脸懵的「傻敷敷」。角色 ID 要可配置（换成别的角色只需改一个常量）。HUD 上的模型名显示 `DeepSeek V4 Pro`。

## 6. 留给产品负责人的设计点（不要写死在组件里）

建一个 `src/stage/reactions.ts`，用一张表集中定义「事件 → 表情 + 默认台词」的映射，例如：

```ts
// 产品负责人会亲自重写这张表：每个角色在各种事件下的表情和台词
export const reactions: Record<string, Partial<Record<StageEventType, { emotion: Emotion; lines: string[] }>>> = { ... }
```

先填一版能跑的示例，文件顶部加注释：`// TODO(owner): 由产品负责人重写台词与表情映射`。

## 7. 验收标准（全部满足才算完成）

- [ ] `npm install && npm run dev` 一次跑通，浏览器控制台**零报错**。
- [ ] `npm run build` 通过（把 `package.json` 里占位的 build 脚本改成真正的 `vite build`）。
- [ ] 剧本两个分支（允许 / 拒绝）都能从头走到 `turn_done`。
- [ ] 第 4 节的四层 + 5 个必做功能全部可用，快捷键生效。
- [ ] 1440×900 和 1280×720 下不溢出、不遮挡输入框。
- [ ] 替换 `public/characters/` 下的图片后无需改代码即可生效。
- [ ] 没有使用第 3 节禁止的任何素材。
- [ ] 在 `docs/tasks/reports/TASK-A-report.md` 写报告：做了什么、截图（至少 4 张：台词 + 技能卡、档案层、选择肢、工程视图）、已知问题、你认为最该改进的 3 点。

## 8. 不要做

- 不要接 Codex 或任何 coding agent，不要调任何 LLM API。
- 不要做多角色同屏、语音、Live2D、移动端适配。
- 不要改 `src/shared/stage-events.ts`；确实需要改，先在报告里说明理由。
