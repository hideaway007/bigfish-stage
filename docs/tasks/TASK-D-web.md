# 任务 D：网页接真实数据 + 设置 + 多角色

> 先读 [PHASE1.md](PHASE1.md)、`src/shared/*.ts` 四个契约文件，再读本文件。现有原型代码在 `src/stage/`、`src/demo/`，界面风格（红黑白斜切、单句台词、甩尾卡片、MAX/LOW 选择肢、水花记录）保持不变。

## 1. 数据源抽象

- 把现有剧本播放器抽象成「数据源」接口，两个实现：
  - **ScriptSource**：现有剧本（演示模式，保留，URL 加 `?demo=1` 进入）。
  - **LiveSource**：连 `ws://<当前页面 host>/ws`，实现 `wire.ts` 协议。默认模式。
- `vite.config.ts` 开发时把 `/ws`（WebSocket）代理到 `127.0.0.1:5300`。
- 断线：顶部显示「鱼塘断线，重连中…」，指数退避重连；重连后用 `welcome.history` 恢复界面。服务端没起来时给出清楚的提示（含启动命令 `npm run dev:server`）。
- 真实场景处理：
  - `worker_text` 只进回看和工程视图，不进台词框（台词框只放 `character_line`）。
  - `character_line` 带 `replacesLineId` 时，**原地替换**那句台词（正在打字就重新打，已显示就淡入替换），不新增条目。
  - 本轮超过 15 秒没有新事件时，HUD 显示等待计时，角色保持 thinking/working 的呼吸动画，不要让界面像卡死。
  - 「已传达，待接收」→「已接收」：可能相隔 20 秒以上，要一直能看到状态。
  - 未知工具种类（`tool: 'other'`）用通用卡片；`error` 事件用醒目但不吓人的样式。
  - 选择肢必须等用户选，不能自动消失；选完发 `permission_decision`。

## 2. 角色包（把现有角色迁移过去）

- 为 `src/characters/roster.ts` 里的 4 个角色（`deepseek-v4-pro`、`gemini-4-argon`、`claude-opus-5-5`、`codex-dragon`）生成 `public/characters/<id>/character.json`，格式见 `character-pack.ts`。人设、口癖来自 roster.ts；`reactions` 来自 `src/stage/reactions.ts`（大肥鱼已有的那份保留原台词），其余角色按各自口癖补齐。`persona.systemPrompt` 用中文写清性格和说话方式。
- 把现有占位立绘移到 `public/characters/<id>/art/`，manifest 用 `renderer: 'sprites'`，并为每个角色生成一张小头像 `art/portrait.svg`（代码画即可）。
- UI 只从角色包读数据，**删除对 roster.ts / reactions.ts 的运行时依赖**（文件可保留作历史参考，加注释说明已废弃）。剧本模式也改成读角色包。
- 写一个 `npm run check:characters`：校验所有角色包符合类型、引用的图片文件都存在。

## 3. 立绘渲染器

- `CharacterRenderer` 组件按 `art.renderer` 分派：`sprites` 完整实现（缺失表情回退 idle，切换带现有的弹动效果）；`live2d` 先渲染一个「Live2D 未启用」的占位卡片，接口参数按 manifest 留好。**不要引入 Live2D SDK。**

## 4. 角色切换

- 左侧 HUD 下方加一排**队伍头像**（来自 `welcome.characters`）。点击 → `switch_character`。切换时立绘、主题色、代号、台词框角色名随之变化，有一个短促的切换演出（≤400ms）。本轮任务不中断。

## 5. 设置界面（SYSTEM 菜单）

顶栏加「SYSTEM」按钮，快捷键 `Esc`（没有其他弹层时）。游戏风格的全屏菜单，左侧分页，右侧内容：

| 分页 | 内容 |
|---|---|
| **角色** | 卡片网格：头像、代号、说话风格、推荐模型；点选设为当前角色 |
| **执行 Agent** | 适配器下拉（来自 `workerAdapters`，不可用的置灰并显示原因）；模型（可输入，也可从 `list_models` 结果中选）；沙箱；「测试连接」按钮显示结果和延迟；提示「新设置在下次开新会话时生效」 |
| **台词模型** | 开关；Base URL；模型（同上可选可填）；API Key（只写不读：显示「已设置」或「未设置」，可清除）；每分钟句数；测试连接 |
| **鱼塘（项目）** | 项目文件夹路径输入框 + 最近项目列表；「用这个文件夹开新会话」按钮（发 `update_settings` 再 `new_session`） |
| **演出** | 打字速度 |

所有修改通过 `update_settings` 发出，以服务端回传的 `settings` 为准刷新界面。

## 6. 顺手修

- 回合结束后中间区域空出一大块：用本轮小结卡片（统计：甩尾 N 次、改动文件、耗时）填满，或调整布局让台词区占满。
- `docs/tasks/reports/TASK-A-report.md` 里的本机绝对路径改成相对路径。

## 7. 验收

- [ ] `npm run typecheck`、`npm run build`、`npm run check:characters` 全部通过。
- [ ] 不依赖服务端也能验证：写一个 **mock WebSocket 服务**（`scripts/mock-server.mjs`，读 `bridge/samples/app-full.stage.jsonl` 按时间回放，并会对 `permission_decision` / `switch_character` / `update_settings` 作出合理回应），用 headless 浏览器（如 Playwright）在 LiveSource 模式下跑通：发消息 → 看到台词与甩尾卡片 → 选择肢 → 选 MAX → 回合结束；切换角色；打开设置改模型并看到回传；断开 mock 服务再启动，界面能重连恢复。
- [ ] `?demo=1` 剧本模式仍可完整跑通。
- [ ] 1440×900 和 1280×720 不溢出；控制台零报错。
- [ ] 截图（至少：真实模式台词 + 卡片、设置的执行 Agent 页、角色页、队伍切换后、断线提示），存 `docs/tasks/reports/phase1-web/`。
- [ ] 本地提交到分支 `task-d-web`。最终回复按 PHASE1.md 的要求汇报。

## 不要做

- 不要碰 `server/`、`bridge/`、`src/shared/`。不要接入任何 LLM API 或生图 API。不要引入 Live2D SDK。不要使用游戏截图、Logo、官方字体。
