---
doc_type: index
truth_scope: repository
owner_boundary: docs/decisions
status: active
created: 2026-04-12
updated: 2026-07-13
---
# Decisions

`decisions/` 保存 ADR。
它回答“为什么接受这条边界”和“如果后来变了，替代它的是什么”。

ADR 默认遵循 MADR / Nygard 风格：记录 context、decision、alternatives 和
consequences。仓库只在此基础上增加 `decision_id`、frontmatter lifecycle 和
owner-boundary 映射。

## 生命周期

- `proposed`
  - 已成文，但尚未正式接受
- `accepted`
  - 当前生效的长期决策
- `superseded`
  - 已被新的 ADR 替代，必须显式指向 replacement
- `deprecated`
  - 仍可理解历史背景，但不再建议继续沿用

当前仓库的文档治理 ADR：

- `adr-0038-documentation-information-architecture-and-lifecycle.md`
- `adr-0039-reference-and-runbook-historical-lifecycle.md`

## 查找入口

本 README 不维护完整 ADR catalogue，也不复制每条 ADR 的结论。查找 ADR 时优先：

- 按文件名中的 `adr-XXXX-<topic>.md` 搜索 topic
- 按 frontmatter `decision_id` 搜索 decision id
- 从当前 owner 文档的 `Related Documents` 回链进入相关 ADR
- 对历史链路，先看 ADR frontmatter 的 `status`、`supersedes`、`superseded_by`
  或正文里的 replacement 说明

常用入口：

- 文档治理：`adr-0038-documentation-information-architecture-and-lifecycle.md`、
  `adr-0039-reference-and-runbook-historical-lifecycle.md`
- Temporal execution substrate：`adr-0048-temporal.md`
- Temporal Worker Controller and versioning：`adr-0078-worker-versioning.md`
- Source / environment repository boundary：
  `adr-0074-source-and-environment-repository-boundary.md`
- Agents SDK knowledge handoff：
  `adr-0075-target-based-knowledge-search.md`
- Operator Console long-term surface：`adr-0055-unified-operator-console-surface.md`
- Self-hosted runtime diagnosis：`adr-0072-self-hosted-ops-web.md`
- Eval runtime and Ragas / Langfuse：`adr-0061-eval-runtime.md`、
  `adr-0062-ragas-langfuse.md`、`adr-0076-langfuse-trace-data.md`
- Temporal ingestion：`adr-0077-ingestion.md`

## 维护规则

- ADR 写 architecturally significant decision，不写临时执行记录
- ADR 不复制 runbook 的命令清单、CLI 参数、smoke 步骤或 operator 执行顺序；这些内容由
  `docs/runbooks/` 承接
- ADR 不承接 reference 的矩阵、schema、指标明细、inventory 或 evidence 明细；这些内容由
  `docs/reference/`、`docs/contracts/` 或 `docs/data/` 承接
- 旧 ADR 不删除；若失效，标成 `superseded` 或 `deprecated`
- replacement 必须写进 front matter 或正文显式回链
