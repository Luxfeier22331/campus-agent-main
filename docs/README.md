---
doc_type: index
status: active
created: 2026-03-22
updated: 2026-03-28
---

# Docs

`docs/` 只保留稳定文档标识，不把创建日期放进文件名。

## 分类

- `architecture/`: 长期边界、职责划分、系统形态
- `contracts/`: 稳定 HTTP seam、生命周期、错误模型
- `data/`: 稳定逻辑 schema、存储 ownership、读写边界
- `decisions/`: 已接受的决策记录，使用稳定 ADR 编号
- `plans/`: 可执行实施文档
- `verification/`: live gate、运行验收和检查清单

## Docs 与 .planning 的分工

- `docs/architecture/`
  长期边界、职责、系统形态、编排模式与跨边界不变量的 canonical truth
- `docs/contracts/`
  runtime / app boundary 的稳定 HTTP contract、生命周期与错误语义
- `docs/data/`
  逻辑 schema、表 ownership、projection/read-model 真相源划分
- `docs/decisions/`
  已接受的长期或阶段决策、specialist 准入、runtime 取舍与评测规则的 canonical truth
- `docs/plans/`
  被接受的实施基线、交付形状和门禁，不直接承担当前 phase 执行状态的唯一真相源
- `docs/verification/`
  live rebuild、运行门禁、验收项和证据模板
- `.planning/`
  当前 GSD 执行状态、phase 顺序、pending work、最新讨论结论，以及当前轮 plan/context/validation 产物的真相源

因此：

- 判断长期架构边界时，优先看 `docs/architecture/` 和 `docs/decisions/`
- 判断“现在做到哪一步、接下来做什么、当前 phase 结论是什么”时，优先看 `.planning/`
- 判断编排模式、specialist 准入与安全边界时，优先看 architecture 文档和对应 ADR，而不是某一轮 plan
- 判断 HTTP contract、状态流转、错误码与 schema ownership 时，优先看 `docs/contracts/` 与 `docs/data/`
- 如果 `docs/plans/` 中的早期实施叙事与 `.planning/` 的当前执行现实冲突，应更新 `docs/plans/` 的边界说明，而不是把旧叙事继续当作当前硬约束

## 标识规则

- `architecture` 和 `plans` 使用语义 slug，例如 `long-term-architecture.md`
- `contracts` 与 `data` 同样使用语义 slug，例如 `app-api-http.md`
- `decisions` 使用 `adr-NNNN-<slug>.md`
- 日期进入 YAML front matter，不作为文件名主标识

## Metadata

所有 canonical 文档在顶部使用 YAML front matter。

- `doc_type`: `index`、`architecture`、`contract`、`data`、`decision`、`plan`
- `status`: `active`、`accepted`、`archived`、`superseded`
- `created`: 文档首次建立日期
- `updated`: 最近一次实质内容更新时间
- `decision_id`: 仅 decision 文档必填

## Canonical Docs

- `architecture/long-term-architecture.md`
- `architecture/phase1-ingestion-and-storage-architecture.md`
- `architecture/cloudflare-public-entry-boundary.md`
- `architecture/cloudflare-runtime-topology.md`
- `architecture/cloudflare-public-entry-integration-contract.md`
- `architecture/cloudflare-worker-consumer-entry-access-policy.md`
- `architecture/shared-app-api-and-worker-web-surfaces.md`
- `architecture/app-api-architecture.md`
- `contracts/app-api-http.md`
- `contracts/app-api-supervisor-execution.md`
- `contracts/app-api-request-lifecycle.md`
- `contracts/app-api-error-model.md`
- `data/app-api-schema.md`
- `architecture/public-consumer-chat-auth-and-data-boundary.md`
- `architecture/public-consumer-chat-surface.md`
- `architecture/protected-panel-boundary.md`
- `architecture/protected-panel-operator-access.md`
- `architecture/request-projection-and-runtime-read-model.md`
- `architecture/protected-panel-runtime-shell.md`
- `architecture/source-truth-normalization-contract.md`
- `architecture/supervisor-architecture.md`
- `architecture/student-handbook-chunking-and-validation-policy.md`
- `architecture/student-handbook-ocr-normalization-strategy.md`
- `decisions/adr-0001-phase1-architecture.md`
- `decisions/adr-0002-local-minio-conventions.md`
- `decisions/adr-0003-golden-dataset-governance.md`
- `decisions/adr-0004-evaluation-metrics.md`
- `decisions/adr-0005-campus-services-taxonomy.md`
- `decisions/adr-0006-agent-orchestration-and-safety.md`
- `decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `decisions/adr-0008-public-consumer-auth-and-storage.md`
- `decisions/adr-0009-public-consumer-frontend-host.md`
- `decisions/adr-0010-observability-and-telemetry-stack.md`
- `decisions/adr-0011-protected-panel-worker-runtime.md`
- `decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `decisions/adr-0013-app-api-worker-runtime.md`
- `decisions/adr-0014-app-api-request-projection-and-panel-query-ownership.md`
- `decisions/adr-0015-supervisor-internal-execution-admission.md`
- `plans/app-api-worker-foundation.md`
- `plans/app-api-initial-execution-plan.md`
- `plans/agentic-rag-foundation.md`
- `plans/agent-orchestration-architecture-refresh.md`
- `plans/golden-dataset-document-delivery.md`
- `plans/golden-dataset-schema-and-bootstrap.md`
- `plans/source-truth-normalization-refactor.md`
- `plans/student-handbook-retrieval-eval-bootstrap.md`
- `plans/supervisor-current-design-implementation.md`
- `verification/phase1-ingestion-retrieval-implementation-truth.md`
- `verification/student-handbook-eval-metrics.md`
- `verification/student-handbook-hybrid-rebuild-checklist.md`
