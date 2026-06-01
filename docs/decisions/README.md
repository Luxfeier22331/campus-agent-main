---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-26
---

# Decisions

`decisions/` 保存 ADR。
它回答“为什么接受这条边界”和“如果后来变了，替代它的是什么”。

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

## Evaluation / Quality / Observability

- `adr-0003-golden-dataset-governance.md`
- `adr-0004-evaluation-metrics.md`
- `adr-0010-observability-and-telemetry-stack.md`

## 核心架构与 runtime

- `adr-0006-agent-orchestration-and-safety.md`
- `adr-0011-protected-panel-worker-runtime.md`
- `adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `adr-0013-app-api-worker-runtime.md`
- `adr-0017-supervisor-internal-execution-admission.md`
- `adr-0043-supervisor-api-docker-first-runtime.md`
- `adr-0030-institution-scoped-product-path-and-explicit-open-domain-admission.md`
- `adr-0042-capability-neutral-supervisor-routing-and-surface-capability-policy.md`

## Identity、authz 与 operator control plane

- `adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `adr-0022-campus-identity-and-restricted-document-authorization.md`
- `adr-0023-operator-observability-control-plane-and-sink-participation.md`
- `adr-0034-authorization-model-and-retrieval-filter-projection.md`

## Retrieval、data plane 与基础设施

- `adr-0002-local-minio-conventions.md`
- `adr-0007-phase1-retrieval-baseline-update.md`
- `adr-0014-versioned-document-serving-and-history-query.md`
- `adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- `adr-0045-self-hosted-single-node-qdrant-and-native-backups.md`
- `adr-0029-ipv4-session-pooler-postgres-connectivity.md`
- `adr-0044-structured-projection-release-catalog-and-read-model.md`

历史替代关系：

- `adr-0020-qdrant-cloud-backup-restore-and-object-store-transition.md` 已被
  `adr-0045-self-hosted-single-node-qdrant-and-native-backups.md` supersede。

## Navigation 与 institution semantics

- `adr-0005-campus-services-taxonomy.md`
- `adr-0021-institution-scoped-entity-alias-governance.md`
- `adr-0027-navigation-agent-and-spatial-truth.md`
- `adr-0028-campus-navigation-basemap-and-provider-strategy.md`

## Official Web 决策

- `adr-0018-app-api-official-web-control-plane-ownership.md`

## Authenticated Notice / Source Channel 决策

- `adr-0024-authenticated-notice-source-channel.md`
- `adr-0025-authenticated-notice-async-staged-closeout.md`
- `adr-0026-authenticated-notice-batch-leased-closeout-throughput.md`

## Internal Notice / Promotion 决策

- `adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `adr-0032-internal-notice-notice-family-stratified-admission.md`
- `adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `adr-0035-notice-derived-regulation-promotion-boundary.md`
- `adr-0036-notice-derived-non-regulation-rule-boundary.md`
- `adr-0037-unified-scoped-rules-holding-collection.md`
- `adr-0040-regulation-work-title-and-edition-separation.md`
- `adr-0041-authenticated-document-center-and-regulation-layer-split.md`

## 维护规则

- ADR 写 architecturally significant decision，不写临时执行记录
- 旧 ADR 不删除；若失效，标成 `superseded` 或 `deprecated`
- replacement 必须写进 front matter 或正文显式回链
