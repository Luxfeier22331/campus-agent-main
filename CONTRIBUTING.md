# 贡献指南

## 开始前

先阅读：

- [README.md](./README.md)
- [文档索引](./docs/README.md)
- [产品边界](./docs/architecture/product.md)
- [架构入口](./docs/architecture/README.md)

处理具体模块时，再阅读最近的 README、架构、合同、数据文档和相关 ADR。

## Issue 与分诊

需要排期、讨论、跨人交接或长期跟踪的产品变化、缺陷、文档和工程工作使用 Issue。范围明确且可以
立即实现和评审的改动可以直接提交 Pull Request；不得为了满足流程创建空 Issue。

Issue 重点记录当前问题和期望结果。实现选择、实际验证和交付影响写在 Pull Request。Issue 使用组织原生
`Feature`、`Bug`、`Task` 类型；Project 中的 `Status` 和 `Priority` 用于实际排期，`area:*` 标签由
维护者在需要路由所有者时设置。

### 选择 Issue 模板

| 模板 | Issue Type / 标签 | 适用场景 | 建档边界 |
| --- | --- | --- | --- |
| Bug report | `Bug` | 已观察到的错误行为 | 写明问题、影响和期望行为；复现与环境按需要补充 |
| Feature request | `Feature` | 新增或改变产品、接口或系统行为 | 写明问题或目标，以及期望结果 |
| Engineering task | `Task` | 维护、重构、测试、文档、基础设施或开发体验工作 | 写明当前问题和目标工程状态 |
| Blank issue | 分诊时确定 | 模板不适合的简单记录或协调事项 | 直接写明问题或目标，不补齐无消费者的固定章节 |

### 拆分与关联

只有结果需要独立排期、评审、发布或回滚时才拆分 Issue；不按目录、代码所有者、文件或提交数量机械
拆分。一个 Pull Request 可以解决多个相关 Issue，一个 Issue 也可以由多笔 Pull Request 完成。

只有存在真实依赖时才使用 GitHub 的关联或 `blocked-by`；不要求填写 `None`。跨仓库事项使用完整的
`owner/repository#number` 引用，目标仓库拥有自己的状态和关闭权。

### 状态与优先级

Project 的状态按以下流程使用：

| Status | 含义 | 进入条件与下一步 |
| --- | --- | --- |
| `Inbox` | 新建或尚未完成分诊 | 问题和目标足够清楚后进入 `Ready` |
| `Ready` | 已具备开始条件 | 开始实施后进入 `In progress` |
| `In progress` | 已开始实施或存在活动 worktree | 完成实现并创建可评审 PR 后进入 `Review` |
| `Review` | PR 已进入评审 | 核心结果完成后进入 `Done`；仍需实现时回到 `In progress` |
| `Done` | Issue 陈述的结果已经解决 | 可以关闭 GitHub Issue |

源码 Issue 不默认等待 staging 或部署。只有 Issue 明确以环境交付或运行结果为目标时，对应环境事实才属于
其完成边界。

Priority 在实际排期需要时设置，只表达影响，不表达提交者偏好：

| Priority | 可执行语义 | 至少提供的依据 |
| --- | --- | --- |
| `P0` | 生产中断、安全事件、数据丢失或损坏，或关键用户路径完全不可用 | 事件、受影响范围或可复核的严重复现 |
| `P1` | 重大用户或系统影响、关键合同或交付被阻断，但仍存在有限 workaround | 影响范围、合同阻断、复现或明确的近期影响 |
| `P2` | 正常排期的功能、局部缺陷、文档、维护和改进，没有当前 P0/P1 影响 | 已知问题或目标 |

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

- 新的独立工作使用短生命周期分支和 linked worktree；同一目标下连续承接的实现、修复和验证留在
  当前分支与 worktree，只有结果需要独立评审、发布或回滚时才拆分；
- 分支使用 `<type>/<slug>`；关联 Issue 编号可以在有助于识别时加入，但不是必需项；
- Pull Request 聚焦一个连贯、可审查的结果，可以关联多个相关 Issue，不混入无关格式化或其他工作区
  改动；
- 标题和正文说明具体工程动作、原因和影响范围；
- 合同、schema、数据所有权或架构边界变化时，同步更新所属文档；
- 合入前确认仓库要求的聚合检查成功。

存在关联 Issue 时，开始实现后将其移到 `In progress`，Pull Request 进入评审时移到 `Review`。
合并即可解决 Issue 陈述的结果时使用 `Fixes #<issue-number>`；部分实现或仅提供上下文时使用
`Refs #<issue-number>`。没有关联 Issue 时在模板中写 `N/A`。跨仓库事项使用完整引用，例如
`Refs MUC-WIKI/campus-agent-gitops#<issue-number>`。

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

按[测试与验证](./docs/reference/verification.md)为改动选择所属检查，不在贡献指南复制检查矩阵。

Pull Request 只列出实际执行的命令及结果，以及与本次风险相关但未执行的检查和仍需其他所有者
完成的操作。未执行的检查不得描述为已经通过。

## 文档

文档分区、事实所有权、语言、生命周期和删除规则见[文档治理决策](./docs/decisions/adr-0038-documentation.md)；
具体事实由所属文档和可执行来源维护。

## 数据与安全

- 测试内容使用合成、自有或明确允许再分发的数据；
- 不提交 Secret、私有地址、数据库连接、受限正文、采集 HTML 或内部日志；
- 不把生产读取指针、数据库投影或运行时产物写入 Git；
- 安全问题按 [SECURITY.md](./SECURITY.md) 私下报告。

公开来源和数据规则见 [公开来源数据策略](./docs/policies/public-source-data.md)。

## 许可证

提交贡献即表示同意该贡献按 Apache License 2.0 授权，除非明确标记为 “Not a Contribution”。
来源和许可证不明的代码、数据、媒体或生成产物不得提交。
