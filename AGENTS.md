# AGENTS.md

## 入口

- 仓库概览与常用命令：`README.md`
- 文档入口与所有权：`docs/README.md`
- 本文件只保留每次任务都需要的规则；修改结构或接口前，只读取直接相关的最近 README、架构、合同、
  数据文档或 ADR。

最近所有者文档和可执行实现共同描述当前行为。功能分支中的文档应与同一分支实现一致，描述该
PR 合并后的行为；基线文档只提供起点，不能替代用户任务或用来否定分支明确目标。

## 仓库规则

- `main` 是稳定主干；功能 worktree 在 PR 合并前不是已合并事实。不得把目标架构、本地测试或部署步骤
  描述成当前运行事实，production 状态由 release tag 和 GitHub Environment 选择。
- 遵守文档所有权；跨所有者接口变化时先更新可执行合同或 schema。没有明确需求时不增加 fallback、
  兼容包装、尽力恢复、静默成功或迁移状态。
- 仓库自有的长期人类可读文档使用简体中文，不用英文黑话代替清晰中文；GitHub Issue/PR
  模板保持既有英文格式。代码、路径、命令、字段名、状态值和产品正式名称保持原值。
- 修改前确认当前 worktree 和分支；用户指定 worktree 时，先运行 `git worktree list --porcelain`
  定位，再在目标路径运行 `git status --short --branch`。未经要求不得撤销其他改动，改动只覆盖用户
  要求的所有者。
- 新建 linked worktree 只放在主 checkout 根目录的 `.worktrees/<name>`；不得在 linked worktree 内
  嵌套创建，也不得新建仓库外的 sibling worktree。现有 worktree 不因此自动迁移。
- 搜索使用 `rg` / `rg --files`；Node/Worker 工作使用 `pnpm`；不得添加或维护 `package-lock.json`。

## 验证与提交

- 根据改动可能破坏的边界，按 `docs/reference/verification.md` 运行最小充分的本地、合同、集成、E2E
  或制品检查；准备 PR 时只补齐适用的受影响门禁。
- deploy、staging、release 和 runtime 证据仅在任务明确包含对应环境操作或验收时作为完成条件；
  不属于目标的下游状态无需主动列为缺失项，也不是阻塞项。
- 最终报告只列实际执行结果，以及与本次风险相关但未执行的检查；不列无关的下游 lane。
- 使用聚焦的中文 Conventional Commit，类型为 `feat:`、`fix:`、`docs:`、`refactor:`、`test:` 或
  `chore:`；不使用 `update`、`misc`、`fix stuff` 等空泛标题。
