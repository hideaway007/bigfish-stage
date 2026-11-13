# 发布就绪度与合规检查清单（Release Readiness）

本文档记录 **BigFish Stage · 大肥鱼工作台** 当前的构建交付方式、运行环境前提、CI 检查覆盖范围，以及正式公开发布或商业化前仍需确认的授权与工程事项。

---

## 1. 四种运行模式的就绪状态与前置条件

| 模式 | 启动入口 | 必需前置步骤 / 外部依赖 | 能力边界 |
| :--- | :--- | :--- | :--- |
| **DSH 插件模式（本地源码）** | `npm run dsh` / `npm run dsh:web` | 1. `npm install`<br/>2. 本机已安装 `dsh` CLI（支持 `DSH_BIN`、`~/.local/bin`、`nvm`、`fnm`、Homebrew 自动查找）<br/>3. `scripts/run-dsh.cjs` 会在全新机器自动初始化 `$DSH_HOME/profiles/bigfish` 与插件软链接，无需先打开 Electron | DSH 会话、工具调用、审批、插话、原生上下文整理、独立角色房间和模型接力；通过 DSH 登录保护接口连接 Git 查看、撤回和提交 |
| **Electron 桌面客户端** | 开发：`npm run app`<br/>打包：`npm run dist:mac` / `npm run dist:dmg` | 1. 目标机器需已安装 `dsh` CLI 及模型凭证（安装包不内置 `dsh` 二进制）<br/>2. 打包配置采用 `asar: false` 输出至 `output/`，保证进程 `cwd` 与插件/静态资源位于真实磁盘目录 | 与 DSH 插件模式一致，增加独立桌面窗口与系统原生文件夹选择框 |
| **内置 `server/` 生产 Web 模式** | `npm start` | 1. `npm install && npm --prefix server install --omit=dev`<br/>2. `npm run build && npm run build:server`（生成 `dist/` 与 `server/dist/index.js`）<br/>3. `npm start`（监听 `127.0.0.1:5300`） | 支持 DSH / Codex / 直连对话适配器与内置 Git 变更查看、单文件撤回、提交；不含 DSH 左侧插件宿主栏 |
| **纯前端离线 Demo** | `npm run dev` 后访问 `/?demo=1`（或托管 `dist/` 访问 `/?demo=1`） | 仅需浏览器，零 CLI、零 API Key | 仅回放内置演示剧本，不执行真实命令、不读写本地磁盘、不请求真实模型 |

---

角色房间与 Git 操作依赖 DSH 的受保护请求接口，已在 `0.2.2-rc.1` 验证；旧版资源兼容不等于新增操作接口可用。

上下文整理按执行器区分：DSH 执行原生命令，直连对话折叠本地 messages（摘录可能丢失细节），Codex CLI 明确不支持手动整理。全部路径保留回看记录；没有实际统计就不显示释放数量。自动测试不等于真实模型长任务验收。

## 2. 桌面端打包与分发注意事项

1. **真实磁盘路径要求（`asar: false`）**
   - 外部 `dsh` 进程通过 `$DSH_HOME/profiles/bigfish/node_modules/@bigfish/dsh-client-ui-p5stage` 符号链接直接读取插件 `lib/index.js`、`lib/client.js` 以及 `public/characters`、`public/sfx` 静态资源，无法解析 Electron 专有的 `.asar` 虚拟归档。
   - `package.json` 的 `build.asar` 已固定为 `false`，且输出目录固定为 `output/`（避免与 Vite 前端产物目录 `dist/` 混用造成递归打包）。
   - `electron/runtime.cjs` 与 `scripts/run-dsh.cjs` 共用同一套 `ensureBigfishProfile` 与 Node/DSH 路径探测逻辑，自动修复应用移动后遗留的失效符号链接。
2. **代码签名与公证（Code Signing & Notarization）**
   - 当前仓库脚本与 CI 仅执行未签名目录打包检查（`--dir --publish never`，配合 `CSC_IDENTITY_AUTO_DISCOVERY=false`），**未配置 Apple Developer ID 证书签名、Hardened Runtime entitlements 或 Apple 公证（Notarization）**。
   - 在未签名状态下，macOS 用户从外部下载 `.dmg` / `.app` 打开时会触发 Gatekeeper 拦截提示；正式对外分发安装包前需补齐签名与公证配置。

---

## 3. 代码许可与第三方素材商业授权待确认清单

> **重要原则**：在完成下述权利核查与书面确认前，**不得擅自为本仓库代码、美术立绘、Live2D 模型或音效资源添加 MIT、Apache-2.0 等开源许可证声明，亦不得用于商业分发**。

| 资产类别 | 涉及路径 | 当前已知协议 / 状态 | 待确认事项 |
| :--- | :--- | :--- | :--- |
| **仓库源代码** | `src/`、`server/`、`electron/`、`packages/`、`scripts/` | `package.json` 为 `private: true`，仓库未包含 `LICENSE` 文件（默认保留权利） | 待项目维护者明确目标许可证后再行补充 `LICENSE` 文件 |
| **角色设定与立绘差分** | `public/characters/*/art/*.{png,svg}`、`docs/characters/` | 角色形象设定源自 B 站 UP 主 **ZipZipPipe（UID: `4168597`）** 二创体系，遵循 **CC BY-NC-SA 4.0（非商业性使用-相同方式共享）** | 原协议明确限制商业用途；任何商业化使用或闭源捆绑分发需另行取得原作者及绘制方书面授权 |
| **Live2D 核心库与渲染依赖** | `public/characters/deepseek-v4-pro/art/live2d/vendor/` | `live2dcubismcore.min.js` 受 **Live2D Proprietary Software License Agreement** 约束；另有 `pixi.min.js`、`cubism4.min.js` 打包产物 | 需核对 Live2D 官方协议对分发形态与商业主体规模的条款要求，并补齐第三方开源组件版权声明（Third-Party Notices） |
| **角色 Live2D 模型资产** | `public/characters/deepseek-v4-pro/art/live2d/*.{moc3,json,png}` | 大肥鱼 Live2D 模型及贴图工程导出物 | 原始拆件/绑骨作者署名要求、再分发范围及商业授权**待确认** |
| **舞台交互音效** | `public/sfx/*.mp3` | 仓库内含 9 个 `.mp3` 音效文件，暂无来源台账与授权凭证 | 音频原始来源、可否随包分发及商业授权状态**待确认**（如需纯自包含合规交付，可清空 `public/sfx/manifest.json` 中的外部文件映射并移除 `.mp3`，前端会自动回退至内置 WebAudio 合成音效） |

---

本机本次已通过 50 项服务端/插件测试、5 项运行路径测试及生产服务启动检查。未签名 macOS 目录打包因 Electron 文件下载超时未完成，不能视作安装包验收通过。

## 4. 本地与 CI 低成本验证命令

以下命令均不调用真实大模型 API，也不会修改本机真实的 `~/.dsh` 配置：

```bash
# 1. 校验角色包配置完整性
npm run check:characters

# 2. 前后端 TypeScript 类型检查
npm run typecheck
npm --prefix server run check

# 3. 运行服务端与桌面/DSH 运行时隔离单元测试
npm --prefix server test
npm run test:runtime

# 4. 构建前端 dist/ 与服务端生产入口 server/dist/index.js
npm run build && npm run build:server

# 5. 未签名本地目录打包检查（需已存在 packages/dsh-client-ui-p5stage/lib 构建产物）
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --publish never
```
