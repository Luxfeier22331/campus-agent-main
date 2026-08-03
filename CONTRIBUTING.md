# 贡献指南

## 开始前

先阅读：

- [README.md](./README.md)
- [文档索引](./docs/README.md)
- [产品边界](./docs/architecture/product.md)
- [当前架构](./docs/architecture/current.md)

处理具体模块时，再阅读最近的 README、架构、合同、数据文档和相关 ADR。

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
- Pull Request 聚焦一个可独立审查的目标，不混入无关格式化或其他工作区改动；
- 标题和正文说明具体工程动作、原因和影响范围；
- 合同、schema、数据所有权或架构边界变化时，同步更新所属文档；
- 合入前确认仓库要求的聚合检查成功。

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
