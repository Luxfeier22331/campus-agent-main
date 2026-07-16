# AGENTS.md

## 用途

本文件是编码代理进入仓库时使用的简明指南。架构、合同、工作流和命令清单应放在
`docs/` 或所属模块的 README 中，不在这里重复维护。

## 按需阅读

- 仓库概览和常用命令：`README.md`
- 文档所有权：`docs/README.md`、`docs/documentation-architecture.md`
- 当前、产品和目标边界：`docs/architecture/current.md`、
  `docs/architecture/product.md`、`docs/architecture/target.md`
- 代码所有权：`docs/architecture/system/code-organization.md`
- 验证方式：`docs/reference/verification.md`

处理领域任务时，应先阅读最近的所属 README、架构文档、合同、数据文档或 ADR，再修改
结构和接口。

## 仓库规则

- `main` 是稳定主干。功能 worktree 在 PR 合并前不是已合并事实；production 状态由
  release tag 和 GitHub Environment 选择。
- 不得把目标架构、本地测试路径或部署步骤描述成当前运行事实。
- 遵守文档中的所有权边界。跨所有者接口变化时，先更新可执行合同或 schema，再更新
  依赖实现。
- `packages/contracts` 不得依赖供应商、存储或框架类型。在线查询与离线采集、发布必须
  保持分离。
- schema、配置或 `ToolSpec` 的存在不代表能力已对模型开放或已具备产品可用性。
- 没有明确的外部迁移要求时，不得恢复已退役运行时、兼容包装或 fallback 路径。
- 通用 UI、框架和基础设施工作优先使用成熟库和仓库已有组件。
- 仓库自有的长期人类可读文档使用简体中文，不用英文黑话代替清晰中文；GitHub Issue/PR
  模板保持仓库既有英文格式。代码、路径、命令、字段名、状态值和产品正式名称保持原值。详细规则见
  `docs/documentation-architecture.md`。

## Worktree 与改动范围

- 除非用户要求切换，否则只在当前功能 worktree 和分支工作。存在并行 worktree 时先运行
  `git status --short --branch` 确认位置。
- 未经明确要求，不得撤销用户或其他 worktree 的改动。相关改动应协同处理，无关改动应
  忽略。
- 改动只覆盖用户要求的所有者。没有明确需求时，不增加 fallback、尽力恢复、静默成功或
  迁移状态。
- 搜索使用 `rg` / `rg --files`；Node/Worker 工作使用 `pnpm`；不得添加或维护
  `package-lock.json`。

## 验证

- 根据所属模块和影响范围选择检查；实现期间优先使用可重复、成本可控的验证。
- 提交 PR 前运行受影响的 lint、typecheck、test 和 build，并说明已执行及未执行的检查。
- 只有 release、staging 类工作或用户明确要求时才运行完整 E2E、staging 或 release
  流程。具体命令见验证指南。

## 外部事实

- 回答当前能力、版本和最佳实践前，查阅相关官方文档。
- 区分有来源的外部事实与仓库推断，并提供来源链接。

## 提交

- 使用聚焦的中文 Conventional Commit，类型为 `feat:`、`fix:`、`docs:`、
  `refactor:`、`test:` 或 `chore:`。
- 不使用 `update`、`misc`、`fix stuff` 等无法说明改动内容的标题。
