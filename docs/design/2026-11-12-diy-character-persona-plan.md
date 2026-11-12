# DIY 角色性格定位文件与可视化捏人实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「设置 → 角色与模型」面板支持为任意角色导入/在线微调 `.md`/`.txt` 性格与职责定位文件，并支持零 JSON 门槛的可视化 DIY 新建/编辑/删除带自定义立绘的角色。

**Architecture:** 通过前后端共享的 `src/shared/diy-character.ts` 统一定义性格覆盖与 `<stage-persona>` 提示词合成纯函数；抽取 `server/src/diy-store.ts` 同时服务于 DSH 插件宿主（`packages/dsh-client-ui-p5stage/src/index.ts`）与本地 `server/`，将 DIY 数据与立绘持久化至仓库外的 `~/.config/bigfish-stage/diy/`，纯静态 `/?demo=1` 模式自动降级至 `localStorage`。UI 层将捏人向导与性格档编辑器拆分为独立组件 `src/stage/components/settings/DiyCharacterPanel.tsx`，保持 `SystemMenuModal.tsx` 清晰可维护。

**Tech Stack:** TypeScript 5, React 18, Node.js 22 (`node:fs/promises`, `node:test`), esbuild, Vite 6.

---

### Task 1: 共享人设合成契约与本机 DIY 存储核心（TDD）

**Files:**
- Create: `src/shared/diy-character.ts`
- Create: `server/src/diy-store.ts`
- Modify: `server/src/settings-store.ts`（将 `rolePrompt` 长度上限放宽至 `8000`）
- Test: `server/test/diy-store.test.ts`

- [ ] **Step 1: 编写失败测试 `server/test/diy-store.test.ts`** — 覆盖 `mergeCharacterWithOverride`、`composeStagePersonaPreamble`、`DiyStore` 的性格覆盖保存/清除、自建角色（含 PNG DataURL 立绘落盘）创建/更新/删除、非法 ID 与超限文件拦截。
- [ ] **Step 2: 运行测试验证红灯** — `npm --prefix server test`
- [ ] **Step 3: 实现 `src/shared/diy-character.ts` 与 `server/src/diy-store.ts`** — 完成纯函数合成器、DataURL 安全解码、原子写盘及 HTTP/Request 通用处理器。
- [ ] **Step 4: 运行测试验证绿灯** — `npm --prefix server test`

---

### Task 2: 双宿主挂载（DSH 插件 + 本地 `server/`）与服务端人设同步

**Files:**
- Modify: `packages/dsh-client-ui-p5stage/src/index.ts`
- Modify: `server/src/characters.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/session.ts`
- Modify: `server/src/voice/voice.ts`

- [ ] **Step 1: 扩展 `CharacterCatalog`** — 支持传入额外目录（`~/.config/bigfish-stage/diy/characters`）与 `overrides` 叠加。
- [ ] **Step 2: 挂载 HTTP `/api/diy` 与 `/characters` 回退路由** — 在 `packages/dsh-client-ui-p5stage/src/index.ts` 与 `server/src/index.ts` 复用 `diy-store.ts` 路由处理器；`server/src/index.ts` 在更新后自动重载目录并向活跃客户端推送最新角色列表。
- [ ] **Step 3: 本地服务会话与台词人设对齐** — 在 `server/src/session.ts` 发送给 Worker 的提示词中应用 `<stage-persona>`（并在历史记录里清洗隐藏标签），`Voice` 自动读取合并后的 `persona.systemPrompt`。
- [ ] **Step 4: 运行 `server` 类型检查与单测** — `npm --prefix server run check && npm --prefix server test`

---

### Task 3: 前端动态角色加载器与 `DshStageSource` 联动

**Files:**
- Create: `src/stage/diyClient.ts`
- Modify: `src/stage/characterLoader.ts`
- Modify: `src/stage/StageApp.tsx`
- Modify: `packages/dsh-client-ui-p5stage/src/client/DshStageSource.ts`

- [ ] **Step 1: 实现 `src/stage/diyClient.ts`** — 封装 `/api/diy` 读写接口，并在 404 / 离线 Demo 下自动回退到 `localStorage`。
- [ ] **Step 2: 升级 `src/stage/characterLoader.ts`** — 支持 `data:` / `blob:` 立绘路径、动态角色 ID 列表 `getAllCharacterIds()`、角色包 + `override` 实时合并以及 `getAllCharacterSummaries()`。
- [ ] **Step 3: 升级 `DshStageSource.ts` 与 `StageApp.tsx`** — `buildPersonaPreamble` 改用 `composeStagePersonaPreamble` 读取实时 DIY 设定；`getStoredCharacterId` 允许记住 `custom-*` 自建角色；`StageApp` 组合展示内置与自建角色列表。

---

### Task 4: 设置面板 UI（「性格文件导入/微调」+「DIY 新建角色向导」）

**Files:**
- Create: `src/stage/components/settings/DiyCharacterPanel.tsx`
- Modify: `src/stage/components/SystemMenuModal.tsx`
- Modify: `src/stage/components/settings/settings.css`

- [ ] **Step 1: 实现独立组件 `DiyCharacterPanel.tsx`** — 包含角色卡内的「导入 `.md/.txt` / 在线编辑 / 恢复默认 / 编辑或删除自建角色」控件，以及顶部的「＋ DIY 新建角色」可视化抽屉（支持主立绘必传、5 种可选情绪差分、主题色、自称/称呼与模板一键填入）。
- [ ] **Step 2: 集成到 `SystemMenuModal.tsx` 与 `settings.css`** — 在 `activeTab === 'characters'` 接入组件与红黑波普斜切样式，删除当前激活自建角色时自动切回 `deepseek-v4-pro`。

---

### Task 5: 全链路构建与浏览器预览实机验证

**Files:**
- Rebuild: `dsh-bundle/*`, `packages/dsh-client-ui-p5stage/lib/*`, `electron/engine/*`, `dist/*`

- [ ] **Step 1: 运行全量静态检查、测试与打包** — `npm run typecheck && npm run build:all && npm run check:characters && npm --prefix server run check && npm --prefix server test`
- [ ] **Step 2: 浏览器预览实机验证** — 通过 `preview_start` 启动舞台，实测内置角色导入 `.md` 性格文件、新建带立绘的 DIY 角色并切换上台，截图存证。
