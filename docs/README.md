---
doc_type: index
status: active
created: 2026-03-22
updated: 2026-03-28
---

# Docs

`docs/` 只保留当前有效、可直接消费的稳定文档，不保留纯历史追溯材料或一次性交付记录。

## 分类

- `architecture/`: 长期边界、职责划分、系统形态
- `decisions/`: 已接受的决策记录，使用稳定 ADR 编号
- `plans/`: 可执行实施文档
- `runbooks/`: 可重复操作步骤、发布/回滚/重建手册
- `reference/`: 术语、当前实现真相、指标快照与固定说明
- `policies/`: 阈值、门禁、治理规则与 collection-specific 约束

## Docs 与 .planning 的分工

- `docs/architecture/`
  长期边界、职责、系统形态、编排模式与跨边界不变量的 canonical truth
- `docs/decisions/`
  已接受的长期或阶段决策、specialist 准入、runtime 取舍与评测规则的 canonical truth
- `docs/plans/`
  仍承担 accepted implementation baseline 的实施基线、交付形状和门禁，不直接承担当前 phase 执行状态的唯一真相源
- `docs/runbooks/`
  面向操作面的步骤说明，例如 rebuild、release、rollback、验收 checklist
- `docs/reference/`
  面向查阅的术语、实现真相快照、指标快照和固定输入输出说明
- `docs/policies/`
  面向规则约束的阈值、policy、quality gate 与 collection-specific 运行约束
- `.planning/`
  当前 GSD 执行状态、phase 顺序、pending work、最新讨论结论，以及当前轮 plan/context/validation 产物的真相源

因此：

- 判断长期架构边界时，优先看 `docs/architecture/` 和 `docs/decisions/`
- 判断“现在做到哪一步、接下来做什么、当前 phase 结论是什么”时，优先看 `.planning/`
- 判断编排模式、specialist 准入、identity/memory/ACL 边界与安全控制时，优先看 architecture 文档和对应 ADR，而不是某一轮 plan
- 如果 `docs/plans/` 中的早期实施叙事与 `.planning/` 的当前执行现实冲突，应更新 `docs/plans/` 的边界说明，而不是把旧叙事继续当作当前硬约束
- 如果 `.planning/ROADMAP.md` 或 `.planning/phases/*` 的历史 phase 叙事与当前运行面冲突，以 `.planning/PROJECT.md`、`.planning/REQUIREMENTS.md`、`.planning/STATE.md` 和对应 architecture/decision 文档为准
- 历史执行过程、handoff、一次性交付记录与被替代草案应退出 `docs/`，留在 `.planning/` 或 git history

## 标识规则

- `architecture` 和新增 `plans` 使用语义 slug，例如 `long-term-architecture.md`
- `decisions` 使用 `adr-NNNN-<slug>.md`
- `runbooks`、`reference`、`policies` 也使用稳定语义 slug
- 日期进入 YAML front matter，不作为文件名主标识

## Metadata

所有 canonical 文档在顶部使用 YAML front matter。

- `doc_type`: `index`、`architecture`、`decision`、`plan`、`runbook`、`reference`、`policy`
- `status`: `active`、`accepted`、`completed`
- `created`: 文档首次建立日期
- `updated`: 最近一次实质内容更新时间
- `decision_id`: 仅 decision 文档必填

## Canonical Docs

Canonical Docs 只收录当前 active / accepted 文档，以及少数虽然 `completed` 但仍承担 accepted implementation baseline 的 plan。一次性交付型文档、历史手稿和被替代草案不在这里维护。

- `architecture/long-term-architecture.md`
- `architecture/phase1-ingestion-and-storage-architecture.md`
- `architecture/cloudflare-public-entry-boundary.md`
- `architecture/cloudflare-runtime-topology.md`
- `architecture/cloudflare-public-entry-integration-contract.md`
- `architecture/cloudflare-worker-consumer-entry-access-policy.md`
- `architecture/app-api-architecture.md`
- `architecture/protected-internal-panel-boundary.md`
- `architecture/protected-panel-runtime-shell.md`
- `architecture/shared-app-api-and-worker-web-surfaces.md`
- `architecture/source-truth-normalization-contract.md`
- `architecture/official-web-source-channel.md`
- `architecture/official-web-crawl-policy.md`
- `architecture/official-web-source-truth-contract.md`
- `architecture/retrieval-query-strategy.md`
- `architecture/rag-specialist-architecture.md`
- `architecture/versioned-document-serving-and-history-query.md`
- `architecture/supervisor-architecture.md`
- `architecture/student-handbook-ocr-normalization-strategy.md`
- `decisions/adr-0002-local-minio-conventions.md`
- `decisions/adr-0003-golden-dataset-governance.md`
- `decisions/adr-0004-evaluation-metrics.md`
- `decisions/adr-0005-campus-services-taxonomy.md`
- `decisions/adr-0006-agent-orchestration-and-safety.md`
- `decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `decisions/adr-0010-observability-and-telemetry-stack.md`
- `decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `decisions/adr-0013-app-api-worker-runtime.md`
- `decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `plans/agentic-rag-foundation.md`
- `plans/app-api-worker-foundation.md`
- `plans/golden-dataset-schema-and-bootstrap.md`
- `plans/intent-memory-acl-foundation.md`
- `plans/source-truth-normalization-refactor.md`
- `plans/student-handbook-retrieval-eval-bootstrap.md`
- `plans/supervisor-current-design-implementation.md`
- `plans/versioned-history-query-foundation.md`
- `runbooks/index-release-runbook.md`
- `runbooks/student-handbook-hybrid-rebuild-checklist.md`
- `reference/runtime-serving-and-index-terms.md`
- `reference/phase1-ingestion-retrieval-implementation-truth.md`
- `reference/student-handbook-eval-metrics.md`
- `policies/student-handbook-chunking-and-validation-policy.md`
- `policies/student-handbook-judge-gate-policy.md`
