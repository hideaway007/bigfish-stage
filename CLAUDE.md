# P5 Agent Stage 项目指令 (CLAUDE.md)

## 1. 目录与生成文件路径铁律（强制执行）

所有与 P5 项目相关的代码、分支工作树（Git worktree）、生成图片/音频、对比图、截图、测试脚本与临时产物，**必须 100% 保持在本项目文件夹（`/Users/d2/project/P5/` 及 `/Users/d2/project/P5/p5-agent-stage/`）内部**：

- **严禁污染桌面**：严禁在 `/Users/d2/Desktop/` 下创建任何文件夹、Git worktree 或临时文件。
- **Git Worktree 统一路径**：如需创建独立 worktree 并行开发，一律放在仓库内部的 `.worktrees/<名称>` 目录下（已被 `.gitignore` 忽略）：
  ```bash
  git worktree add .worktrees/<worktree-name> -b <branch-name>
  ```
- **生成文件统一落盘位置**：
  - **临时产物 / 预览对比图 / 截图 / 实验音频 / 导出文件**：一律写入仓库内的 `outputs/` 目录（已被 `.gitignore` 忽略）。
  - **角色立绘 / 头像 / Live2D 正式资源**：写入 `public/characters/<id>/art/`。
  - **音效资源**：写入 `public/sfx/`。
  - **设计稿与任务报告**：写入 `docs/design/` 或 `docs/tasks/reports/`。

## 2. 协作与分支规范

- 动手前先阅读 [`docs/COLLAB.md`](docs/COLLAB.md) 与 [`docs/DSH_ARCHITECTURE.md`](docs/DSH_ARCHITECTURE.md)。
- 严禁直接修改或直接 push `main` 分支：A 侧从 `main` 切 `agent-a` 或 `ui/<功能>` 分支；B 侧切 `agent-b` 或 `art/<功能>`、`core/<功能>` 分支；共享契约切 `contract/<内容>` 分支。
- 仓库是公开仓库：不要在 Git 跟踪的文件中提交任何密钥、账号信息或本机隐私数据。
