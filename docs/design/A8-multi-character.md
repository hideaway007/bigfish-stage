# A8 设计方案：多角色同台与角色间互动（Multi-Character Stage & Banter）

> **状态**：设计提案 + 可点击原型验证（不修改现有主干应用代码）  
> **归属**：A 侧（界面布局、交互逻辑、角色关系与台词编排） + 涉及 `src/shared/*` 共享契约扩展提案（需 B 侧批准后合入）  
> **配套可交互原型**：`docs/design/a8-prototype/index.html`（单文件自包含，可直接用浏览器通过 `file://` 打开体验）

---

## 一、目标与非目标（Goals & Non-Goals）

### 1.1 设计目标（Goals）
1. **鱼塘小队同台驻场（1 主控 + 最多 2 助阵）**：突破当前「舞台同一时刻只能站 1 名角色」的限制，支持 **单人（1 人）/ 双人（2 人）/ 三人（3 人）** 三种舞台编成模式，让大肥鱼、哈基米、Claude 娘、Codex 娘可以同台搭档演出。
2. **单 Worker 内核下的自然分工接话（Turn-Taking）**：底层执行代码的 Worker Agent 始终保持唯一下潜会话，但在前台表现层，不同的 `StageEvent`（如接单、翻阅文件、焊代码、跑终端、报错救场、场外插话）按角色专长分配给主控（Lead）或助阵（Support）角色发言，让工具调用过程不再是单人独白。
3. **有节制的角色间相声与化学反应（Banter）**：基于四位角色的人设梗（如「哈基米氩弧焊闪瞎大肥鱼」、「大肥鱼抱纸箱跑路被 Claude 娘女仆装拦下」、「大肥鱼聊蒸汽机车催眠 Codex 娘」），在关键事件节点触发双人一唱一和的互动短句，并通过冷却锁防止刷屏吵闹。
4. **双分辨率严丝合缝布局（1440×900 & 1280×720）**：在现有三列红黑斜切舞台骨架内，定义 1～3 人同台时的立绘站位、缩放比、发言聚焦与非发言压暗（Focus / Dim）、对话框动态铭牌及队伍栏编成交互，确保在 `1440×900` 与 `1280×720` 下零横向/纵向溢出。
5. **契约先行、渐进落地**：明确所有需要新增的 `src/shared/*` 可选字段提案及需要 B 侧（台词模型多角色编排、`CharacterRenderer` 多实例、Live2D 同屏性能）配合的接口边界，拆分为 P1 → P2 → P3 三个无痛迭代阶段。

### 1.2 非目标（Non-Goals）
1. **不做多 Worker 并行执行或多 Agent 抢方向盘**：多角色同台纯粹是**舞台表现层与台词解说层**的小队化，底层干活的 Worker Agent（DeepSeek Harness / Codex / Claude Code）永远只有 1 个实例，不在后台并发开启多个改码进程，避免文件写冲突与 Token 成本失控。
2. **不做 4 人及以上无限同屏堆叠**：舞台同屏上限固定为 **3 人（1 名 Lead + 最多 2 名 Support）**。第 4 名及未来扩展角色留在左下角队伍栏的「候场席（Bench）」，随时一键轮换上台。
3. **不打破「单句漫画对话框」原则**：中央台词框（Dialogue Layer）仍然坚持一次只展示一句主台词，不做纵向滚动的群聊气泡流；双人互动（Banter）采用「前句 → 接力下句（带回应角标）」或轻量助阵副签呈现，全部历史对话统一沉淀至 `[L] 回看（Backlog）`。
4. **本阶段不改动 `src/` 业务代码**：本 PR 仅交付设计规范与独立原型，待 A/B 双方评审拍板契约后再进入 P1 开发。

---

## 二、核心模型：1 主控（Lead）+ 最多 2 助阵（Support）

```text
                  ┌─────────────────────────────────────────┐
                  │   底层单一执行内核 (Single Worker Agent)  │
                  │    DeepSeek Harness / Codex / Claude    │
                  └────────────────────┬────────────────────┘
                                       │ StageEvent 事件流
                                       ▼
        ┌──────────────────────────────────────────────────────────────┐
        │             前台舞台发声调度器 (Stage Director)               │
        │  根据 StageEvent 类型 + 角色专长 + 冷却锁 决定由谁接麦克风     │
        └───┬──────────────────────────┬───────────────────────────┬───┘
            │ 主发言 (~65%)             │ 专长助威 (~25%)            │ 双人互动 (~10%)
            ▼                          ▼                           ▼
   ┌─────────────────┐        ┌─────────────────┐         ┌─────────────────┐
   │ ★ 主控位 (LEAD)  │        │ ▲ 助阵 1 (SUP1) │         │ ▲ 助阵 2 (SUP2) │
   │ 接单/改码/拍板   │   ⇄    │ 读文件/架构解说  │    ⇄    │ 终端命令/救场   │
   │ 决定全局主题色   │ Banter │ 场外插话接纸条   │  Banter │ 庆功收尾吐槽    │
   └─────────────────┘        └─────────────────┘         └─────────────────┘
```

### 2.1 三类舞台身份定义

| 舞台身份 | 人数上限 | 核心职责 | 视觉层级与站位特征 |
| :--- | :--- | :--- | :--- |
| **★ 主控角色（Lead）** | 必有且仅有 1 人 | 小队队长与默认发言人。负责回应玩家投喂（`user_message`）、主刀代码修改解说、向店长发起权限决断（`permission_request`）及回合收尾总结（`turn_done`）。舞台全局主题色 `--char-theme-color` 跟随 Lead。 | 站位居前（单人居中、双人左前、三人正中前景），基准缩放 `0.96 ~ 1.0`，拥有主铭牌展示权。 |
| **▲ 助阵角色（Support 1 / 2）** | 0 ～ 2 人 | 站在主控侧后方的同台搭档。平时保持待机伴演（轻微呼吸、跟随战况切换表情）；当触发其专长工具（如读文件、跑终端、报错抢修、接收场外插话）时上前接话，或在动作间隙与 Lead 触发双人相声（Banter）。 | 站在侧翼后景（双人右后、三人左右两翼），基准缩放 `0.78 ~ 0.84`；未发言时自动降亮压暗（Dim），发言时高光抬升。 |
| **○ 候场角色（Bench）** | 其余角色 | 留在左侧底部队伍栏（Party Bar）待命，不占用主舞台立绘画布与 WebGL 渲染预算，可随时被玩家点选「+ 上台」或「★ 设为主控」。 | 仅在队伍栏显示头像、角色名与候场状态标签。 |

---

## 三、谁在何时说话（Turn-Taking 规则、冷却机制与角色互动）

### 3.1 `StageEvent` → 发言角色路由规则表

舞台导演模块（Stage Director）在收到每一条 `StageEvent` 时，按以下优先级表决定本次由哪位在场角色（且未静音）发言：

| StageEvent 事件 | 第一顺位发言人 | 第二顺位 / 专长优先规则 | 发言情绪 (`Emotion`) | 是否允许紧接 Banter（双人接话） |
| :--- | :--- | :--- | :--- | :--- |
| `session_started` | **Lead（主控）** | 仅 Lead 发言；Support 同步切为 `idle` 微笑待命 | `idle` | 否（保持开场清爽） |
| `user_message` | **Lead（主控）** | 必由 Lead 接单回应店长投喂 | `thinking` | 否 |
| `thinking` | **Support（若在场且非冷却）** 或 **Lead** | 若 `claude-opus-5-5`（抬头望天）或 `codex-dragon`（遍历语法树）作为 Support 在场，优先由其播报推理状态；否则由 Lead 举 `max/low` 牌子 | `thinking` | 否 |
| `tool_start:read`<br>`tool_start:search`<br>`tool_start:web` | **Support #1（侦察位）** | 若有未静音的 Support 在场，优先交由 Support 播报翻阅文件（体现「队长主攻、搭档看图纸」）；单人则由 Lead 播报 | `working` | 低概率（15%） |
| `tool_start:edit`<br>`tool_start:write` | **Lead（主控）** 或 **专长焊工** | 第 1 次改文件由 **Lead** 主讲；若 `gemini-4-argon`（哈基米）在场，优先由哈基米拉下护目镜焊代码，或触发与 Lead 的焊接互动 | `working` | **高优先级触发点**（如哈基米焊代码 × 大肥鱼捂眼） |
| `tool_start:bash` | **Support #2（终端位）** 或 **专长执行官** | 若 `codex-dragon`（Codex 娘）在场，优先由其举起 `>_` 便签接管终端命令；否则由 Support / Lead 轮流播报 | `working` | 中概率（如 Codex 娘闭眼跑命令 × 哈基米夸赞） |
| `tool_end` (`ok: true`) | **静默或接力位** | 若距 `tool_start` 不足 `3.5s`，不单独刷普通台词；若命中预设 Banter 条件，则由**另一名在场角色**接下句 | `working` / `happy` | **Banter 下句承载点** |
| `tool_end:fail`<br>`error` | **Lead** → **Support 救场** | **Lead** 先触发受击/慌张台词（如大肥鱼抱纸箱跑路），`1.2s` 后自动由 **Support**（如 Claude 娘换女仆装或哈基米补焊）接一句定心丸台词 | Lead: `worried`<br>Support: `working` | **必触发双人救场接力**（若有未静音 Support） |
| `permission_request` | **Lead（主控）** | 必须由 Lead 弹窗向店长请示拍板；同台 Support 同步切为 `shocked` 表情并在弹窗角落提供一行战术附议 | `shocked` | 弹窗内附议展示，不抢主台词框 |
| `permission_resolved` | **Lead（主控）** | Lead 确认收到店长决断，继续推进 | `working` | 否 |
| `steer_queued`<br>`steer_acked` | **Support #1（场外联络位）** | 优先由当前未占线的 **Support** 举手接过店长递来的场外小纸条（「收到追加便笺，我帮主控记下啦！」）；单人则由 Lead 响应 | `thinking` → `working` | 否 |
| `turn_done` (`ok: true`) | **Lead** → **Support 庆功** | **Lead** 先发表回合大胜利台词（`happy`）；若本轮 Support 参与过助攻，间隔 `1.4s` 后触发一句庆功互动收尾 | `happy` | **高优先级触发点**（回合圆满收官相声） |
| `turn_done:fail`<br>`interrupted` | **Lead（主控）** | Lead 总结停机原因并安抚店长 | `worried` / `idle` | 否 |

---

### 3.2 防吵闹与冷却机制（Cooldowns & Noise Control）

多角色同台最忌讳「三个角色同时抢话、工具一多台词闪得看不清」。为此设计四道硬性节流阀：

1. **全局台词驻留底线（Global Dwell Floor：`2.4s`）**：
   - 任何一条台词上屏后，除 **4 类高优里程碑事件**（`user_message`、`permission_request`、`turn_done`、`error`）可立即打断外，其余常规工具事件若在 `2.4s`（快进模式 `0.7s`）内密集到达，只更新行动层切入卡（Skill Cut-in Card）与角色表情，不覆盖正在打字的台词。
2. **助阵角色个人冷却（Support Cooldown：`8.0s` 或 2 个工具间隔）**：
   - 同一名 Support 角色发表一次独立台词后，进入 `8.0s` 冷却期，期间优先把话筒交还给 Lead 或另一位 Support，确保 Lead 始终保有 **60%～70%** 的主导存在感。
3. **双人互动配额（Banter Quota：每轮最多 `2` 次）**：
   - 每个 Turn（从 `user_message` 到 `turn_done`）内，双人一唱一和的 Banter 最多触发 **2 次**（通常为「核心工具执行或报错救场 1 次」+「`turn_done` 收工庆功 1 次」）。
4. **单句接力展示而非双框刷屏**：
   - 触发 Banter 时，主对话框先显示角色 A 的台词；当 A 打字完成并驻留 `1.2s` 后（或玩家按 `Space` / 点击对话框推进），主对话框平滑切换为角色 B 的回应台词，并在发言人铭牌旁亮起醒目的 **`⇄ 回应 · <角色A短名>`** 联动徽章，同时舞台聚光灯从 A 切向 B。

---

### 3.3 四角色关系矩阵与名场面互动库（Relation Table & Banter Triggers）

全部关系与互动台词严格取材自现有 4 个 `public/characters/*/character.json` 与设定集核心梗：

#### 四角色关系一览表

| 发起角色 \ 目标角色 | **大肥鱼** (`deepseek-v4-pro`) | **哈基米** (`gemini-4-argon`) | **Claude 娘** (`claude-opus-5-5`) | **Codex 娘** (`codex-dragon`) |
| :--- | :--- | :--- | :--- | :--- |
| **大肥鱼**<br>（深海看板娘） | — | **称呼**：哈基米焊工喵<br>**关系**：电弧焊闪眼受害者；羡慕她焊缝甜美但总被紫光晃得捂鲸鳍 | **称呼**：Claude 执事姐姐<br>**关系**：自己报错想抱纸箱跑路时，全靠换好女仆装的 Claude 娘按住救场 | **称呼**：睡衣小龙娘<br>**关系**：收工后总想拉着困倦的 Codex 娘叭叭叭讲一整下午蒸汽机车 |
| **哈基米**<br>（氩弧焊猫娘） | **称呼**：大肥鱼 / 傻敷敷鲸鱼<br>**关系**：焊完完美焊缝总想喊大肥鱼过来看手艺，顺便提醒她戴护目镜 | — | **称呼**：女仆长 / 读书少女<br>**关系**：动手派焊工 vs 优雅派架构师，焊代码时会被提醒别把电弧火星溅到书页和茶杯上 | **称呼**：梦游小龙娘<br>**关系**：佩服她闭着眼睛都能把 `>_` 终端管线对接得严丝合缝 |
| **Claude 娘**<br>（文学/女仆少女） | **称呼**：大肥鱼小姐<br>**关系**：温柔包容的执事姐姐，帮她把 `max / low` 牌子理顺，拦住她跑路的纸箱 | **称呼**：哈基米小姐<br>**关系**：欣赏她的全栈焊接速度，但会在她通电飙紫光时优雅地护住茶杯与卷轴 | — | **称呼**：Codex 妹妹<br>**关系**：一个抬头望天品茶推演架构，一个闭眼穿睡衣后台静默打补丁，堪称最安静默契搭档 |
| **Codex 娘**<br>（困倦睡衣小龙娘） | **称呼**：大肥鱼……<br>**关系**：觉得她挥舞 Harness 娘很有精神，但听她讲蒸汽机车不到三分钟就会睡着 | **称呼**：闪光猫娘……<br>**关系**：嫌她的氩气辉光管太亮晃眼睛，翻个身用 `>_` 便签挡光继续编译 | **称呼**：茶香姐姐……<br>**关系**：喜欢趴在 Claude 娘整理好的干净架构里安心梦游跑测试 | — |

#### 核心预设双人互动剧本（Banter Presets）

| 互动编号 | 同台组合 | 触发条件 (`ReactionKey`) | 第一句（发起方） | 第二句（回应方，`⇄ 回应`） |
| :--- | :--- | :--- | :--- | :--- |
| **B-01**<br>（名场面：氩弧焊闪眼） | **大肥鱼 + 哈基米** | `tool_start:edit` | **哈基米** `[WORKING]`：「护目镜拉下！滋滋滋——正在给 `{file}` 走一道甜美的氩弧焊缝！」 | **大肥鱼** `[SHOCKED]`：「呜哇！哈基米的氩弧焊电弧太亮了捏！（用鲸鳍捂住眼睛）大肥鱼的眼睛要变成四角星了捏！」 |
| **B-02**<br>（焊缝炫技） | **哈基米 + 大肥鱼** | `turn_done` | **哈基米** `[HAPPY]`：「焊接完毕！完美收工～要不要让大肥鱼也过来看看我的手艺？」 | **大肥鱼** `[HAPPY]`：「凑过来瞅瞅捏！哇，泛着淡紫光的焊缝好漂亮！走，作为回礼我给你讲三小时蒸汽机车！」 |
| **B-03**<br>（抱箱跑路 vs 女仆兜底） | **大肥鱼 + Claude 娘** | `tool_end:fail` / `error` | **大肥鱼** `[WORRIED]`：「呜哇，报错了捏……我先抱起纸箱收拾东西跑路了捏！」 | **Claude 娘** `[WORKING]`：「请把纸箱放下吧，大肥鱼。反正我早有准备，已经换好女仆装了——这处报错交给我来打扫。」 |
| **B-04**<br>（蒸汽机车催眠曲） | **大肥鱼 + Codex 娘** | `turn_done` | **大肥鱼** `[HAPPY]`：「搞定啦！走，我再给你叭叭叭介绍一整下午的蒸汽机车！」 | **Codex 娘** `[IDLE]`：「呼啊……测试全绿了，蒸汽机车我就当睡前摇篮曲听了……Zzz……」 |
| **B-05**<br>（火星与下午茶） | **哈基米 + Claude 娘** | `tool_start:edit` | **哈基米** `[WORKING]`：「正在进行氩弧焊的哈基米——这焊缝甜美的很啊～」 | **Claude 娘** `[THINKING]`：「（端着茶杯微微侧身）手艺确实精湛，只是劳驾小心些，别让电弧火星溅到我的卷轴上了。」 |
| **B-06**<br>（静默终端双人组） | **Codex 娘 + 哈基米** | `tool_start:bash` | **Codex 娘** `[WORKING]`：「举起 `>_` 便签跑命令：`{summary}`……呼啊，闭着眼等它跑完……」 | **哈基米** `[HAPPY]`：「喵哈！闭着眼睛梦游都能把终端压力测试焊得死死的，不愧是你喵！」 |

---

## 四、舞台布局规格：1440×900 与 1280×720

### 4.1 整体三列网格适配（零溢出保障）

沿用现有 `p5-main-grid` 的「左列（舞台立绘 + HUD + 队伍栏）/ 中列（台词框 + 行动层 + 输入框）/ 右列（水花记录）」三栏结构，针对多角色同台做如下精确尺寸分配：

| 区域 / 指标 | **1440×900 标准桌面视口** | **1280×720 紧凑宽屏视口** | 说明 |
| :--- | :--- | :--- | :--- |
| **顶栏 (`p5-topbar`)** | 高度 `52px`，左右内边距 `18px` | 高度 `48px`，左右内边距 `14px` | 保持单行不换行 |
| **主网格 (`p5-main-grid`)** | `410px minmax(0, 1fr) 280px`<br>`gap: 16px`, `padding: 14px 18px 16px` | `356px minmax(0, 1fr) 248px`<br>`gap: 12px`, `padding: 10px 14px 12px` | 左列比单人模式微扩 `16~30px`，容纳 2～3 人同框层次 |
| **左侧角色舞台框 (`p5-portrait-stage`)** | 宽 `410px` × 高 `460px`（`flex: 1`） | 宽 `356px` × 高 `332px`（`flex: 1`） | 承载 1～3 个角色的层叠立绘槽位 |
| **左侧 HUD 状态卡 (`p5-hud-card`)** | 高 `156px`，内边距 `10px 14px` | 高 `132px`，内边距 `7px 11px` | 显示 Worker 模型、状态条、耗时与小队人数 |
| **左侧队伍编成栏 (`p5-party-bar`)** | 高 `168px`（4 卡网格 + 快捷操作键） | 高 `146px`（紧凑 4 卡网格 + 快捷操作键） | 支持上台/下台、设为主控、静音切换 |
| **中列台词框 (`p5-dialogue-box`)** | 最小高度 `148px`，字号 `19px` | 最小高度 `124px`，字号 `16.5px` | 顶部铭牌随当前发言角色变色，支持 `⇄ 回应` 标记 |

### 4.2 角色舞台框内部：单人 / 双人 / 三人站位坐标表

在 `.p5-portrait-stage` 容器内，采用绝对定位槽位（Stage Slots）配合 CSS 变量过渡（`transition: transform 320ms cubic-bezier(0.22, 1.25, 0.36, 1), filter 240ms ease, left 320ms ease`），实现人数切换与发言人切换时的丝滑走位：

```text
【单人模式 SOLO】              【双人模式 DUO】               【三人模式 TRIO】
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│                      │     │           ┌────────┐ │     │  ┌──────┐  ┌──────┐  │
│       ┌────────┐     │     │  ┌────────┤ SUP #1 │ │     │  │SUP #1│  │SUP #2│  │
│       │ ★ LEAD │     │     │  │ ★ LEAD │ (0.84x)│ │     │  │(0.78)│  │(0.78)│  │
│       │ (1.00x)│     │     │  │ (0.98x)├────────┘ │     │  └──┬───┴──┴───┬──┘  │
│       │  50%   │     │     │  │  34%   │   68%    │     │     │  ★ LEAD  │     │
│       └────────┘     │     │  └────────┘          │     │     │ (0.95x)  │     │
├──────────────────────┤     ├──────────────────────┤     ├─────┴──────────┴─────┤
│ 主控铭牌              │     │ 主控铭牌 + 助阵小徽章  │     │ 主控铭牌 + 双助阵徽章  │
└──────────────────────┘     └──────────────────────┘     └──────────────────────┘
```

| 编制模式 | 槽位 (`slot`) | 水平中心 (`left`) | 垂直偏移 (`bottom` / `translateY`) | 基准缩放 (`scale`) | 基础层级 (`z-index`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **单人（1 人）** | `lead`（主控） | `50%` | `bottom: 54px` | `1.00` | `3` |
| **双人（2 人）** | `lead`（主控，左前） | `35%` | `bottom: 54px` | `0.96` | `3` |
| | `support-1`（助阵，右后） | `69%` | `bottom: 66px`（微抬显景深） | `0.84` | `2` |
| **三人（3 人）** | `lead`（主控，中前） | `50%` | `bottom: 52px` | `0.94` | `3` |
| | `support-1`（助阵 1，左翼） | `23%` | `bottom: 68px` | `0.78` | `2` |
| | `support-2`（助阵 2，右翼） | `77%` | `bottom: 68px` | `0.78` | `2` |

### 4.3 发言聚焦与非发言压暗（Focus / Dim 视觉状态机）

当同台人数 `>= 2` 时，依靠明确的明暗对比与微位移引导玩家视线，让玩家不用读文字就能感知「现在是谁在说话」：

1. **正在发言态（`is-speaking` / Focus）**：
   - **亮度与光晕**：`filter: brightness(1.06) saturate(1.08) drop-shadow(0 0 16px var(--slot-theme-color))`；
   - **位移与缩放**：在槽位基准缩放上额外乘以 `1.05` 并上浮 `translateY(-8px)`；
   - **层级**：`z-index: 5`（即使 Support 发言，其立绘也会临时浮到最前层，不被 Lead 遮挡）；
   - **头顶气泡角标**：立绘头顶浮现带角色主题色边框的斜切情绪角标（如 `WORKING // 氩弧焊中`）与三道动态发声波纹。
2. **同台伴演态（`is-dimmed` / Non-speaking）**：
   - **压暗滤镜**：`filter: brightness(0.48) saturate(0.68) contrast(0.92)`；
   - **不透明度与缩放**：`opacity: 0.82`，在槽位基准缩放上回退 `0.96x`；
   - **保留生命感**：依然维持低频待机呼吸与当前战况情绪立绘（例如权限请求时同台伙伴也一起露出震惊表情，只是处于暗场伴演）。
3. **同台静音态（`is-muted` / Muted）**：
   - 保持 `brightness(0.42) grayscale(0.35)`，立绘胸前或脚下挂载小号 `MUTE // 观战中` 徽章，全程不抢焦点。

### 4.4 对话框发言人铭牌与舞台底部名条

1. **对话框顶部斜切铭牌（`.p5-dialogue-speaker-tab`）**：
   - 铭牌背景色绑定**当前发言角色**的 `themeColor`（例如大肥鱼发言时为深海蓝 `#2563EB`，哈基米接话时瞬间切为氩光紫 `#A855F7`，Claude 娘接话时切为暖橙 `#EA580C`，Codex 娘接话时切为冰晶蓝 `#38BDF8`）。
   - 铭牌内部结构：
     ```text
     [★ 主控 / ▲ 助阵]  哈基米  GEMINI 4 · ARGON  [WORKING]  [⇄ 回应 大肥鱼]  [PRESET · 预置台词]
     ```
2. **舞台框底部联合名条（`.p5-character-nameplate`）**：
   - 左侧展示当前 **★ 主控（Lead）** 的代号、全名与 Tagline；
   - 右侧在双人/三人模式下并列展示同台 **▲ 助阵（Support）** 的胶囊名牌（含角色主题色圆点、短名、当前情绪及静音状态），点击任意助阵胶囊可直接预览该角色的口头禅或将其提拔为 Lead。

---

## 五、交互设计（Interactions）

### 5.1 布局模式一键切换与自由增减（1 / 2 / 3 人）
- **快捷编成切换**：在队伍栏顶部（及原型控制栏）提供 `单人 (1P)` / `双人 (2P)` / `三人 (3P)` 快捷编成按钮：
  - 切到 `单人`：仅保留当前 Lead 在场；
  - 切到 `双人`：保留 Lead，自动将顺位第 1 的搭档补入 `Support #1`；
  - 切到 `三人`：保留 Lead，自动补齐 `Support #1` 与 `Support #2`。
- **单角色自由上台/下台**：
  - 在左侧底部队伍栏（`PARTY // 队伍编成`）的 4 张角色卡上，每张卡片提供 **「上台 / 下台」** 开关按钮：
    - 候场角色点击「`+ 上台`」：若当前舞台未满 3 人，直接作为 Support 入列；若已满 3 人，自动替换最后一名 Support（`Support #2`）。
    - 在场 Support 角色点击「`− 下台`」：平滑退场回到候场席（Bench）。
    - 在场 Lead 角色不可直接点击下台（舞台至少需有 1 名主控），若想让当前 Lead 下台，只需先将另一名角色设为主控即可。

### 5.2 切换主控（Set Lead —— 交接棒而非踢下台）
- 在多角色模式下，点击任意助阵角色或候场角色的 **「`★ 设为主控`」** 按钮（或直接点击舞台上的助阵立绘）：
  - 若目标角色原本是同台 **Support**：它与原 **Lead** 立即在舞台上**交换站位**（目标角色滑入前景 Lead 位，原 Lead 退居侧后方 Support #1 位，留在台上继续助阵！）。
  - 若目标角色原本在 **Bench（候场）**：它直接空降前景 Lead 位，原 Lead 自动转入 Support #1 位（若原舞台已满 3 人，则原 Support #2 退回候场）。
  - 全局 `--char-theme-color`、顶部副标题、输入框投喂提示同步切换为新 Lead 的专属配色与文案。

### 5.3 角色静音（Mute Character）
- 每位角色卡上均配有 **「`静音 (Mute)`」** 切换按钮（小喇叭图标 / `发声 / 静音` 状态）：
  - 开启静音后，该角色即使站在舞台 Support 位，也不会被 Stage Director 选中发言，也不会发起或接力 Banter；
  - 若玩家将 **Lead** 设为静音，则仅保留 `permission_request` 等必要系统提示，或自动把日常工具解说交由未静音的 Support 代言。

---

## 六、数据与共享契约影响（Data & Contract Impact — 需 B 侧批准提案）

> **重要说明**：遵循 `docs/COLLAB.md` 契约修改铁律，以下所有字段均为 **100% 可选字段（Optional `?`）**，不破坏任何现有单角色逻辑，标记为 **【契约提案 · 待合作者 B 批准】**。

### 6.1 `src/shared/settings.ts` 扩展提案

在 `AppSettings` 与 `VoiceSettings` 中新增可选的小队编成与相声开关：

```ts
export interface VoiceSettings {
  enabled: boolean;
  endpoint: ModelEndpoint;
  maxLinesPerMinute: number;
  /** 【A8 提案】是否开启同台角色之间的互动接话（Banter），缺省为 true */
  banterEnabled?: boolean;
}

export interface AppSettings {
  version: 1;
  /** 当前主控角色（Lead），与 stageParty[0] 保持一致 */
  activeCharacterId: string;
  /**
   * 【A8 提案】当前同台角色 ID 列表（1～3 人），按 [Lead, Support1?, Support2?] 排序。
   * 缺省或长度为 1 时即为传统单人模式：[activeCharacterId]。
   */
  stageParty?: string[];
  /**
   * 【A8 提案】同台但被玩家设为「静音观战」的角色 ID 列表。
   */
  mutedStageCharacterIds?: string[];
  projectDir: string | null;
  recentProjects: string[];
  worker: WorkerSettings;
  voice: VoiceSettings;
  performance: PerformanceSettings;
}
```

### 6.2 `src/shared/stage-events.ts` 扩展提案

现有 `character_line` 事件**已经天然包含 `characterId: string`**，因此无需破坏性改动即可区分发言人。建议仅补充两个可选元数据字段，用于 UI 渲染主从身份与双人接话角标：

```ts
| {
    type: 'character_line';
    characterId: string;
    emotion: Emotion;
    text: string;
    lineId?: string;
    source?: 'preset' | 'model';
    replacesLineId?: string;
    /** 【A8 提案】发言时的舞台身份：主控或助阵 */
    role?: 'lead' | 'support';
    /** 【A8 提案】若本句为双人互动（Banter）的回应句，指向前一句发言角色的 characterId */
    replyToCharacterId?: string;
  }
```

### 6.3 `src/shared/character-pack.ts` 扩展提案

在 `CharacterPack` 末尾新增可选的 `relations`（角色关系描述，供 UI 展示及 B 侧台词模型拼接 Prompt）与 `banter`（预置双人互动台词表）：

```ts
/** 【A8 提案】当前角色对另一位角色的称呼与关系设定 */
export interface CharacterRelation {
  /** 对方角色 ID，如 'gemini-4-argon' */
  targetCharacterId: string;
  /** 对对方的日常称呼，如「哈基米焊工喵」 */
  addressAs: string;
  /** 关系标签，如「护目镜受害者 · 鱼塘搭档」 */
  affinityTag: string;
  /** 给台词模型的简短互动指南 */
  promptHint: string;
}

/** 【A8 提案】单条预置双人互动（Banter）规则 */
export interface CharacterBanterRule {
  id: string;
  /** 搭档角色 ID */
  partnerId: string;
  /** 触发时机，复用现有 ReactionKey（如 'tool_start:edit' | 'turn_done' | 'tool_end:fail'） */
  trigger: ReactionKey;
  /** 连续两句的台词序列（speaker: 'self' 代表本角色包角色，'partner' 代表搭档角色） */
  exchange: [
    { speaker: 'self' | 'partner'; emotion: Emotion; text: string },
    { speaker: 'self' | 'partner'; emotion: Emotion; text: string }
  ];
}

// 在 CharacterPack 接口末尾追加可选字段：
export interface CharacterPack {
  // ...现有字段保持不变
  /** 【A8 提案】与其他角色的关系表（键为对方 characterId） */
  relations?: Record<string, CharacterRelation>;
  /** 【A8 提案】同台时的预置双人相声台词表 */
  banter?: CharacterBanterRule[];
}
```

---

## 七、需要 B 侧配合提供的能力（What B Must Provide）

多角色同台落地时，A 侧负责舞台排布、预置台词调度与队伍栏交互，以下三项底层与渲染能力需由 **B 侧** 配合提供：

### 7.1 台词模型多角色编排（Voice Model Multi-Speaker Prompting）
1. **上下文感知同台名单**：服务端台词生成模块读取 `settings.stageParty` 与 `settings.mutedStageCharacterIds`，获知当前在场且可发声的 `[Lead, Support1?, Support2?]`。
2. **单次请求生成双人互动（One-Shot Pair Generation）**：
   - 当触发支持 Banter 的事件（如 `tool_start:edit` 或 `turn_done`）且配额允许时，不要串行发两次 LLM 请求（会导致第二句延迟高且容易上下文脱节），而是在一次轻量请求中传入双方 `persona.systemPrompt` + `relations[partnerId].promptHint`，要求模型返回 1～2 句 JSON：
     ```json
     [
       { "characterId": "gemini-4-argon", "emotion": "working", "text": "..." },
       { "characterId": "deepseek-v4-pro", "emotion": "shocked", "text": "...", "replyToCharacterId": "gemini-4-argon" }
     ]
     ```
   - 服务端依次下发两条 `character_line`（或带 `replacesLineId` 升级对应的预置互动句）。
3. **共享限流池**：多角色同台共用 `VoiceSettings.maxLinesPerMinute`（默认 6 句/分钟），不会因为有 3 个角色在场就把 API 调用量翻三倍。

### 7.2 `CharacterRenderer` 支持多实例与槽位尺寸（Multi-Instance & Sizing）
`src/stage/components/CharacterRenderer.tsx` 归 B 侧维护。为支持舞台框内同时渲染 1～3 名角色，需向 `CharacterRendererProps` 补充以下可选属性（保持现有调用方式 100% 兼容）：

```ts
export interface CharacterRendererProps {
  characterId: string;
  characterName: string;
  codename: string;
  art: ArtManifest;
  emotion: Emotion;
  emotionSwitchKey: number;
  characterSwitchKey: number;
  breathing?: boolean;
  // ── 【A8 新增可选 Props】 ──
  /** 舞台槽位：默认 'solo' */
  slot?: 'solo' | 'lead' | 'support-1' | 'support-2';
  /** 当前是否为正在发言的聚焦角色 */
  speaking?: boolean;
  /** 当前是否处于同台非发言压暗态 */
  dimmed?: boolean;
  /** 当前是否被玩家静音 */
  muted?: boolean;
  /** 点击立绘本体时的回调（用于点击助阵角色直接聚焦或切换为主控） */
  onSelectSlot?: (characterId: string) => void;
}
```
- 同时，组件内部的 `data-testid="character-portrait"` 建议在多实例时附加槽位或角色后缀（保留主控 `data-testid="character-portrait"` 以兼容既有 E2E 测试，助阵实例使用 `data-testid="character-portrait-support-1"` 等）。

### 7.3 Live2D 多模型同屏性能保障（Live2D Performance）
当 B3（Live2D 渲染器）就绪并与 A8 多角色结合时，需遵守以下性能约束：
1. **单 WebGL Canvas 共享渲染池**：同台 2～3 个 Live2D 模型必须挂载在同一个 PixiJS `Application` 画布的不同 `PIXI.Container` 槽位中，严禁创建多个 `<canvas>` WebGL 上下文。
2. **Focus / Dim 动态帧率分级**：
   - 处于 `speaking: true`（聚焦）的模型：运行 `60fps` 物理演算 + 实时口型同步（`ParamMouthOpenY`）+ 鼠标视线跟随；
   - 处于 `dimmed: true`（伴演压暗）的模型：关闭鼠标视线追踪与口型驱动，物理更新降频至 `24~30fps`（仅维持待机呼吸），大幅降低核显/集显负载。
3. **纹理尺寸与懒卸载**：单角色纹理图集控制在 `2048×2048` 以内；从舞台换下退回候场席（Bench）的角色，延迟 `30s` 销毁 WebGL 纹理缓存，兼顾频繁切换时的顺滑度与显存占用。

---

## 八、分阶段落地路线图（Phased Rollout）

为了降低联调风险、避免一次性改动过大，建议分三期推进：

| 阶段 | 目标范围 | A 侧工作 | B 侧工作 | 契约改动 |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1 (P1)**<br>静态多角色同台与视觉聚焦 | 舞台支持 1/2/3 人站位、队伍栏上台/下台/设为主控、发言高亮与非发言压暗、对话框铭牌随发言人变色 | 实现舞台多槽位 CSS 布局、队伍栏编成交互、Demo 剧本多角色演示 | `CharacterRenderer` 支持多实例 `slot / speaking / dimmed` 可选 Props | 仅 `settings.stageParty?` |
| **Phase 2 (P2)**<br>事件分工接力与预置轮流发言 | 单 Worker 事件流按规则路由给 Lead / Support 轮流播报，实装冷却锁与静音开关 | 前端 `stageReducer` / `ScriptSource` 接入 Turn-Taking 路由表与角色静音控制 | 服务端事件桥接层按 `stageParty` 下发对应角色的预置 `character_line` | `settings.mutedStageCharacterIds?`、`character_line.role?` |
| **Phase 3 (P3)**<br>角色间化学反应与即兴相声 | 双人预置 Banter 台词上线 + 台词模型单次生成双人互动 + Live2D 同屏对视演出 | 在 4 个 `character.json` 补齐 `relations` 与 `banter` 台词库；对话框实装 `⇄ 回应` 动效 | 台词模型接入双人 Prompt 编排；Live2D 实装同屏共享画布与分级帧率 | `character-pack.ts` 新增 `relations?` / `banter?`，`character_line.replyToCharacterId?` |

---

## 九、待决问题与核心决策点（Open Questions）

在进入 P1 编码前，需要项目发起人（用户）与合作者 B 最终拍板以下问题（其中前 3 项为最关键决策）：

1. **【决策 1 · 舞台人数上限与默认编成】**：
   - 默认启动时是保持**单人模式（1P，仅大肥鱼，玩家手动点 `+ 上台` 才变双人/三人）**，还是默认直接以**双人搭档模式（2P，大肥鱼主控 + 哈基米助阵）**开场以第一时间展示多角色魅力？
2. **【决策 2 · 双人互动（Banter）的呈现形态】**：
   - 当两名角色互动拌嘴时，是采用本方案推荐的**「主台词框先后接力显示（带 `⇄ 回应` 标签 + 聚光灯切换）」**，还是在主台词框下方**额外弹出一个斜切小号副气泡（Sub-Bubble）同时并排显示两句话**？
3. **【决策 3 · 工具分工路由是「固定绑定角色人设」还是「按槽位轮换」】**：
   - 例如 `tool_start:edit` 和 `tool_start:bash`，是**按角色专长硬绑定**（只要哈基米在场就必接 `edit`、只要 Codex 娘在场就必接 `bash`），还是**严格按槽位职能分配**（Lead 永远管 `edit`、Support #1 永远管 `read`、Support #2 永远管 `bash`，与具体是谁无关）？（本方案建议：角色专长优先，无专长角色在场时回退到槽位分配）。
4. **【B 侧确认项 · 台词模型配额】**：
   - 双人 Banter 若由台词模型生成，一次请求返回两句话在 `maxLinesPerMinute` 中计为 `1` 次消耗还是 `2` 次消耗？建议按 HTTP 请求次数计为 `1` 次。
