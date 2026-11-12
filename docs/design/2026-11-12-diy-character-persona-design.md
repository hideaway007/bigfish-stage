# DIY 角色性格定位文件与可视化捏人系统设计文档

- **日期**：2026-11-12
- **分支**：`ui/diy-character-persona`
- **适用形态**：一仓四态（DeepSeek Harness 插件 / Electron 桌面端 / 本地 `server/` Web 工作台 / 纯前端 `/?demo=1` 演示）

---

## 1. 背景与目标

玩家希望在「设置 → 角色与模型」面板中 DIY 角色：
1. **任意角色挂载性格与定位文件**：支持为内置 4 位角色或自建角色导入 `.md` / `.txt` 性格与职责定位文件（导入存档并支持在线微调、重新导入与恢复默认），实时改变角色在工作与互动时的性格、自称、对玩家的称呼及专业职责定位。
2. **完整自定义新角色（含立绘）**：无需手写 JSON，玩家可通过可视化向导填写角色名、代号、简介标语、主题色、导入/编辑 `.md` 性格档并上传主立绘（`idle`）及可选表情差分，一键创建专属角色上台演出、参与「⚡ 换手接力（Agent Relay）」。

---

## 2. 存储架构：本机统一落盘 + 演示模式前端降级

由于 Electron 桌面端使用 `dsh --profile bigfish --port 0` 随机端口启动内核，仅依赖浏览器 `localStorage` / `IndexedDB` 会在每次重启后因 Origin 变化丢失数据。因此采用**宿主本机统一落盘 + 纯前端回退**双层方案：

### 2.1 本机目录结构（隔离在 Git 仓库外）

```text
~/.config/bigfish-stage/diy/
├── overrides.json                   # Record<characterId, CharacterPersonaOverride>
└── characters/
    └── custom-<slug>/
        ├── character.json           # 标准 CharacterPack (schemaVersion: 1)
        └── art/
            ├── portrait.<ext>       # 可选独立头像（未传时复用 idle）
            ├── idle.<ext>           # 必选主立绘
            └── <emotion>.<ext>      # 可选差分（thinking/working/happy/worried/shocked）
```

- 目录权限 `0700`，JSON 与图片文件均通过临时文件 + `rename` 原子写入（权限 `0600`）。
- 完全位于用户主目录 `~/.config/bigfish-stage/diy/` 下，绝不污染公开 Git 仓库工作树。

### 2.2 宿主同源 API 与静态资源回退

抽取共享 Node 存储模块 `server/src/diy-store.ts`，同时挂载到：
- **DSH 插件与 Electron 宿主**：`packages/dsh-client-ui-p5stage/src/index.ts`（通过 `ctx.webServer.register` 注册 `/api/diy` 前缀与 `/characters` 双目录静态查找）
- **本地 Web 服务宿主**：`server/src/index.ts`（HTTP 路由处理 `/api/diy/*` 与 `/characters/*` 回退，保存/删除后同步刷新 `CharacterCatalog` 并广播最新状态）

接口契约：
- `GET /api/diy` → `{ ok: true, overrides: Record<string, CharacterPersonaOverride>, customPacks: CharacterPack[] }`
- `POST /api/diy/override` → 请求体 `{ characterId, override: CharacterPersonaOverride | null }`（`null` 表示清除覆盖恢复默认）
- `POST /api/diy/character` → 请求体 `DiyCharacterSaveInput`（创建或更新 `custom-*` 角色，包含 DataURL 图片上传解码落盘）
- `DELETE /api/diy/character?id=<custom-id>` → 删除指定自建角色目录及关联 `overrides`（禁止删除非 `custom-` 内置角色）

### 2.3 纯静态 Demo 模式降级（`/?demo=1`）

前端 `src/stage/diyClient.ts` 请求 `/api/diy` 若返回 404 或网络不可达（如 Vite 纯前端 `/?demo=1`），自动无缝切换至 `window.localStorage` 存储性格覆盖与自建角色（保留图片 DataURL），保证离线演示同样可完整体验。

---

## 3. 核心数据结构与人设合成契约

新增 `src/shared/diy-character.ts`（纯 TypeScript 无 Node 依赖，前后端共享）：

```ts
export interface CharacterPersonaOverride {
  /** 导入来源文件名（如 "傲娇安全专家.md"），手写微调时可为空或保留 */
  sourceFileName?: string;
  /** 核心性格设定与职责定位正文（<= 8000 字符） */
  rolePrompt: string;
  /** 角色自称（如 "本喵" / "我"） */
  selfTitle?: string;
  /** 对玩家的称呼（如 "店长" / "指挥官"） */
  userTitle?: string;
  /** 可选覆盖简介标语 */
  tagline?: string;
  updatedAt: number;
}
```

### 3.1 角色包合成规则 `mergeCharacterWithOverride(pack, override)`
- 当 `override` 存在时：
  - `tagline`：若 `override.tagline` 非空则覆盖；
  - `uiCopy.userTitle`：若 `override.userTitle` 非空则覆盖；
  - `persona.systemPrompt`：将玩家自定义的性格与定位正文作为高优先级设定拼入，保留舞台台词长度与真实性约束。

### 3.2 `<stage-persona>` 全链路注入
- 统一由共享函数 `composeStagePersonaPreamble(pack, override, fallbackRolePrompt)` 生成 `<stage-persona>...</stage-persona>`：
  - 包含角色显示名、自称（`selfTitle`）、对玩家称呼（`userTitle`）、玩家 `.md` 性格与职责定位全文（或默认 `rolePrompt` + `speechStyle`）；
  - 保留底层硬性工程约束：「技术内容必须准确完整，不编造执行结果；此段为舞台设定，无需复述」。
- 注入点：
  1. `DshStageSource.ts`：`send()` 与 `steer()` 调用 `buildPersonaPreamble(this.activeCharacterId)` 时实时读取合并后的角色包与 DIY 性格覆盖；`getStoredCharacterId()` 支持 `custom-*` 角色 ID。
  2. `server/src/session.ts` & `server/src/voice/voice.ts`：`CharacterCatalog` 自动加载 `~/.config/bigfish-stage/diy/` 中的自建角色与覆盖；本地会话首轮/每轮提示词与自由互动台词同步应用自定义性格。

---

## 4. 设置界面交互设计（`SystemMenuModal.tsx`）

在「角色与模型」标签页保持红黑斜切波普视觉语言：

1. **角色卡片新增「性格与定位文件」控制栏**：
   - 显示状态标签：`默认性格设定` 或 `📄 自定义性格：<文件名或已微调>`。
   - 操作按钮：
     - **「📄 导入 .md/.txt」**：唤起文件选择（限制 `.md,.markdown,.txt`，上限 `8000` 字，超长提示或安全截断提示），读取后立即保存并同步。
     - **「✎ 编辑定位」**：在卡片内展开折叠编辑器（可改：自称、对玩家称呼、简介标语、性格与定位正文，并提供「填入性格模板」辅助按钮）。
     - **内置角色**：已自定义时显示 **「↺ 恢复默认」**；
     - **自建角色（`custom-*`）**：显示 **「✎ 编辑形象与设定」** 与 **「✕ 删除角色」**（删除当前激活角色时自动切回 `deepseek-v4-pro`）。
2. **面板顶部新增「＋ DIY 新建角色」按钮与可视化捏人面板**：
   - 必填项：角色名称、性格与职责定位（可一键导入 `.md/.txt` 或填入模板）、主立绘图片（`idle`）。
   - 选填项：英文/代号标签、简介标语、主题色、自称与玩家称呼、独立小头像（不传默认复用主立绘）、其余 5 种情绪立绘差分（`thinking` / `working` / `happy` / `worried` / `shocked`）与代表口头禅。

---

## 5. 安全校验与测试计划

### 5.1 安全边界
- **防路径穿越**：所有自建角色 ID 统一由服务端/工具函数归一化为 `custom-<safe-slug>`（严格匹配 `/^custom-[a-z0-9-]+$/`）；静态文件路径解析强校验 `realpath` / 前缀归属。
- **文件体积与格式校验**：`.md/.txt` 文本上限 `8,000` 字符；上传立绘仅允许 `image/png`、`image/jpeg`、`image/webp`、`image/gif`（单张 `<= 5MB`，请求总载荷 `<= 32MB`），拒绝可执行或内联脚本格式。
- **渲染器零侵入**：不修改 `src/stage/components/CharacterRenderer.tsx`，在 `characterLoader.ts` 中扩展 `data:` / `blob:` URL 透传及动态角色列表订阅。

### 5.2 验证清单
1. 新增 `server/test/diy-store.test.ts`：覆盖性格文件覆盖读写/清除、自建角色创建/更新/删除、非法路径与超限拦截、`composeStagePersonaPreamble` 合成断言。
2. 静态与构建门禁：根目录 `npm run typecheck`、`npm run build:all`、`npm run check:characters`；`server/` 下 `npm run check && npm test`。
3. 浏览器预览端到端验证：打开设置面板验证「给大肥鱼导入 `.md` 性格文件」、「新建带立绘的 DIY 角色并切换上台」、「刷新页面确认本机持久化生效」。
