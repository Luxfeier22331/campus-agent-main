# 贡献指南

## 开始前

先阅读：

- [README.md](./README.md)
- [文档索引](./docs/README.md)
- [产品边界](./docs/architecture/product.md)
- [当前架构](./docs/architecture/current.md)

处理具体模块时，再阅读最近的 README、架构、合同、数据文档和相关 ADR。

## Issue 与分诊

产品变化、缺陷、文档工作和需要排期的工程任务应先创建 Issue。自动依赖更新等不需要排期的
机械改动可以直接提交 Pull Request。

Issue 使用组织原生 `Feature`、`Bug`、`Task` 类型；`area:*` 标签表示主要代码所有者，Project
中的 `Status` 和 `Priority` 表示当前执行状态。进入 `Ready` 前，维护者应确认类型、一个主要
area、优先级、依赖和可验证的验收条件都已明确，且工作当前未被阻塞。`blocked` 标签用于表达
外部依赖，不另建阻塞状态。

`Done` 表示 Issue 的验收条件已经满足。只涉及源码且合并即完成的事项可以随 Pull Request 合并
关闭；涉及部署的事项必须等 `staging/deployment` 成功，并完成所需正式用户路径验收后再关闭。
Project 的 `Done` 状态本身不用于关闭 Issue。这只规定部署类事项的关闭条件，不把环境证据变成
未合并实现或普通 Pull Request 的前置条件；验证证据按[测试与验证](./docs/reference/verification.md)
选择。

### 选择 Issue 模板

| 模板 | Issue Type / 标签 | 适用场景 | 建档边界 |
| --- | --- | --- | --- |
| Feature request | `Feature` | 新增产品行为、接口或合同能力 | 一个可独立验收的用户或系统结果，并指定一个主要 `area:*` |
| Bug report | `Bug` | 可复现的现有错误行为 | 最小复现、预期与实际行为，以及一个主要 `area:*` |
| Engineering task | `Task` | 维护、重构、测试、基础设施或开发体验工作 | 一个可验证的工程结果，以及一个主要 `area:*` |
| Documentation issue | `Task`、`area:docs` | 文档缺失、过时、含糊、链接损坏或渲染错误 | 指定页面或章节、期望状态和验收条件 |
| Tracking issue | `Task`、`tracking` | 协调多个可独立审查的 Issue 或 Pull Request | 只记录整体目标、子项、顺序和完成条件；父 Issue 可不设置 `area:*` |

模板中的 `Primary area` 表示主要所有者，不用于列出所有相关目录。一个 Issue 如果同时涉及多个
所有者，应先按独立结果和验收边界拆分，再分别设置主要 area；不能用增加标签代替拆分。

### 拆分与关联

只有当结果、所有权或验收条件可以独立时才拆分 Issue；不按目录、文件数量或提交数量机械拆分。
Tracking 父 Issue 只协调整体目标、子 Issue、顺序和完成条件，不承载实施代码或重复子项验收。

子 Issue 按自己的验收条件独立流转和关闭。父 Tracking Issue 只有在所有必需子项完成且整体完成条件
满足后，才能移到 `Done` 并关闭；父 Issue 的关闭不替代子 Issue 的验收。

一个具体 Issue 或 Pull Request 阻塞另一个事项时，使用 GitHub 的 `blocked-by` 关系；阻塞项在同一
仓库时应直接关联对应编号。外部且没有对应 Issue 的依赖使用 `blocked` 标签并在正文说明依赖和解除
条件，不增加新的 Project 状态。阻塞时保留原有生命周期状态：尚未开始时保留 `Ready`，已开始时
保留 `In progress`，解除后继续原流程。

跨仓库事项使用完整的 `owner/repository#number` 引用；目标仓库仍拥有该事项的状态、验收和关闭权，
Tracking 父 Issue 只等待其声明的整体完成条件。

### 状态与优先级

Project 的状态按以下流程使用：

| Status | 含义 | 进入条件与下一步 |
| --- | --- | --- |
| `Inbox` | 新建或尚未完成分诊 | 补齐模板信息后进入 `Ready` |
| `Ready` | 已完成分诊并具备开始条件 | 类型、主要 area（Tracking 例外）、Priority、依赖和验收条件齐全；开始实施后进入 `In progress` |
| `In progress` | 已开始实施或存在活动 worktree | 完成实现并创建可评审 PR 后进入 `Review` |
| `Review` | PR 已进入评审 | PR 合并且验收条件满足后进入 `Done`；未合并但继续工作时回到 `In progress` |
| `Done` | 验收条件全部满足 | 是否关闭 GitHub Issue 另按部署和用户路径要求判断 |

进入 `Ready` 时工作应未被阻塞；若之后出现阻塞，按上面的 `blocked` 规则保留当前阶段并记录解除条件。
Project `Done` 与 GitHub Issue 关闭相互独立：源码-only 且合并即满足全部验收时可以关闭，部署类事项
必须等 `staging/deployment` 和所需正式用户路径验收完成后再关闭。

Priority 只表达影响，不表达提交者偏好：

| Priority | 可执行语义 | 至少提供的依据 |
| --- | --- | --- |
| `P0` | 生产中断、安全事件、数据丢失或损坏，或关键用户路径完全不可用 | 事件、受影响范围或可复核的严重复现 |
| `P1` | 重大用户或系统影响、关键合同或交付被阻断，但仍存在有限 workaround | 影响范围、合同阻断、复现或明确的近期影响 |
| `P2` | 正常排期的功能、局部缺陷、文档、维护和改进，没有当前 P0/P1 影响 | 可验证的目标和验收条件 |

事实或影响范围变化时应重新分诊；没有足够证据时不得仅凭紧迫感填写 `P0` 或 `P1`。

## 环境准备

```bash
uv sync --all-packages --dev
pnpm install
pre-commit install
```

`pre-commit` 只执行轻量文件检查和暂存内容的 Secret 扫描，不替代类型检查、测试或构建。

## 分支与 Pull Request

默认协作流程是：

```text
feature worktree -> pull request -> main
```

- 每个改动使用短生命周期分支和独立 worktree；
- 新工作默认遵守一条实施 Issue、一条分支和一个 Pull Request；拆分依据是独立结果、所有权和验收
  边界，而不是目录或提交数量；
- 有对应 Issue 的人工分支使用 `<type>/<issue-number>-<slug>`，其中 type 为 `feat`、`fix`、`docs`
  或 `chore`；
- Pull Request 聚焦一个可独立审查的目标，不混入无关格式化或其他工作区改动；
- 标题和正文说明具体工程动作、原因和影响范围；
- 合同、schema、数据所有权或架构边界变化时，同步更新所属文档；
- 合入前确认仓库要求的聚合检查成功。

开始实现时把 Issue 移到 `In progress`，Pull Request 进入评审时移到 `Review`。Pull Request 默认用
`Refs #<issue-number>` 关联事项；只有合并后即可满足全部验收条件时才使用 `Fixes`。跨仓库事项使用
完整引用，例如 `Refs MUC-WIKI/campus-agent-gitops#<issue-number>`。

如果已有在研 worktree 的实现已经完成，可以在一个 Pull Request 中使用多个 `Refs` 关联后来拆分的
子 Issue，不要求为了补齐 Issue 层级而重写现有分支。新工作仍遵守一条实施 Issue、一条分支和一个
Pull Request 的默认规则。

Pull Request 合并后应立即退役对应 linked worktree 和本地功能分支。删除前必须确认 worktree 干净、
本地 HEAD 与 Pull Request head 完全一致、Pull Request 已合入 `main`，且 merge commit 可从最新
`origin/main` 到达；不满足任一条件时保留现场并重新确认。远端功能分支由仓库的合并后自动删除设置
处理，开放 Pull Request 和仍在工作的 worktree 不属于清理对象。

### Squash 合并

- squash commit 标题直接使用符合 Conventional Commit 的 Pull Request 标题；
- 默认不写 commit 正文；
- 仅在迁移、破坏性变更或必须长期保留的运行影响存在时写正文；
- 正文中的独立变更或影响使用无序列表，不复制 Pull Request 的验证记录、检查清单或评审背景。

```text
<type>(<scope>): <简短变更>

- <长期需要保留的变更或影响>
- <迁移或操作影响>
```

发布、环境选择和紧急修复见 [发布流程](./docs/runbooks/release.md)。

## 验证

先运行能够覆盖改动模块的最小检查，再根据跨模块影响扩大范围。命令、缓存和 CI 语义统一见
[测试与验证](./docs/reference/verification.md)，不要在贡献指南复制动态检查矩阵。

Pull Request 应列出：

- 实际执行的命令及结果；
- 明确没有执行的集成、浏览器或环境检查及原因；
- 仍需由环境维护者完成的操作。

不得把未执行的检查描述为已经通过。

## 文档

长期人类可读文档使用简体中文。代码、字段、路径、命令、状态值和产品正式名称保持原值。
文档分类、所有权、命名和删除规则见 [文档规范](./docs/documentation-architecture.md)。

未合并计划、执行记录和一次性检查结果不进入长期文档。被取代且没有外部迁移要求的文档直接
删除，历史由 Git 保存。

## 数据与安全

- 测试内容使用合成、自有或明确允许再分发的数据；
- 不提交 Secret、私有地址、数据库连接、受限正文、采集 HTML 或内部日志；
- 不把生产读取指针、数据库投影或运行时产物写入 Git；
- 安全问题按 [SECURITY.md](./SECURITY.md) 私下报告。

公开来源和数据规则见 [公开来源数据策略](./docs/policies/public-source-data.md)。

## 许可证

提交贡献即表示同意该贡献按 Apache License 2.0 授权，除非明确标记为 “Not a Contribution”。
来源和许可证不明的代码、数据、媒体或生成产物不得提交。
