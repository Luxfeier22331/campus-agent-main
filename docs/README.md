---
doc_type: index
status: active
created: 2026-03-22
updated: 2026-04-10
---

# Docs

`docs/` 只保留当前有效、可直接消费的稳定文档。

默认入口固定为：

- `architecture/product-positioning.md`
- `architecture/current-architecture.md`
- `architecture/target-architecture.md`
- 一组 supporting architecture 文档

纯历史基线、被合并的一次性 bootstrap 方案和已经退出默认阅读路径的旧结构，统一移出 active docs path；需要追溯时看 `.planning/` 或 git history。

## 分类

- `architecture/`: 产品定位、当前接受架构快照、长期边界、职责划分、系统形态
- `contracts/`: 稳定 HTTP seam、生命周期、错误模型
- `data/`: 稳定逻辑 schema、存储 ownership、读写边界
- `decisions/`: 已接受的决策记录，使用稳定 ADR 编号
- `environment/`: env ownership、模板索引与配置边界约束
- `plans/`: 仍对前向实施有指导价值的计划文档
- `runbooks/`: 可重复操作步骤、发布/回滚/重建手册
- `reference/`: 术语、当前实现真相、指标快照与固定说明
- `policies/`: 阈值、门禁、治理规则与 collection-specific 约束

## Docs 与 .planning 的分工

- `docs/architecture/`
  当前接受架构快照、长期边界、职责、系统形态、编排模式与跨边界不变量的 canonical truth
- `docs/contracts/`
  runtime / app boundary 的稳定 HTTP contract、生命周期与错误语义
- `docs/data/`
  逻辑 schema、表 ownership、projection/read-model 真相源划分
- `docs/decisions/`
  已接受的长期或阶段决策、specialist 准入、runtime 取舍与评测规则的 canonical truth
- `docs/plans/`
  只承担仍有前向指导价值的实施 handoff；已经完成且只剩历史基线价值的 plan 应退出默认入口，不再充当 repo 级 source of truth
- `docs/environment/`
  env ownership、app-local 模板入口与 command override 约束的 canonical truth
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
- 判断“这个产品是什么、服务谁、边界在哪”时，优先看 `docs/architecture/product-positioning.md`
- 判断“现在做到哪一步、接下来做什么、当前 phase 结论是什么”时，优先看 `.planning/`
- 判断编排模式、specialist 准入、identity/memory/authorization 边界与安全控制时，优先看 architecture 文档和对应 ADR，而不是某一轮 plan
- 判断 HTTP contract、状态流转、错误码与 schema ownership 时，优先看 `docs/contracts/` 与 `docs/data/`
- 如果某份 `docs/plans/` 已不再指导前向实施，应从默认入口中移除，而不是继续作为“历史基线”挂在 active docs path 上
- 如果 `.planning/ROADMAP.md` 或 `.planning/phases/*` 的历史 phase 叙事与当前运行面冲突，以 `.planning/PROJECT.md`、`.planning/REQUIREMENTS.md`、`.planning/STATE.md` 和对应 architecture/decision 文档为准
- 当前 repo 的长期集成分支是 `develop`，稳定分支是 `main`
- 独立 worktree 中尚未合入 `develop` 的实现进度，不能直接写成当前 merged truth；如需记录，必须明确标注为 pending merge 或 worktree-local progress
- 历史上“某变更已合入 `main`”的记录可保留为稳定里程碑事实，但不等于当前工作树一定检出 `main`
- 历史执行过程、handoff、一次性交付记录与被替代草案应退出 `docs/`，留在 `.planning/` 或 git history

## 推荐阅读顺序

- 产品定位：`architecture/product-positioning.md`
- 当前架构：`architecture/current-architecture.md`
- 目标架构：`architecture/target-architecture.md`
- supporting architecture：`architecture/product-runtime-architecture.md`、`architecture/execution-and-specialists-architecture.md`、`architecture/prompt-and-instruction-architecture.md`、`architecture/identity-and-authorization-architecture.md`、`architecture/retrieval-serving-architecture.md`、`architecture/data-plane-architecture.md`、`architecture/navigation-and-wayfinding-architecture.md`、`architecture/official-web-architecture.md`、`architecture/authenticated-notice-source-architecture.md`、`architecture/operator-observability-architecture.md`
- 导航长期边界与底图策略：`architecture/navigation-and-wayfinding-architecture.md`、`decisions/adr-0027-navigation-specialist-and-spatial-truth.md`、`decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`
- institution-scoped 产品路径与开放域能力准入：`architecture/product-positioning.md`、`architecture/target-architecture.md`、`decisions/adr-0030-institution-scoped-product-path-and-explicit-open-domain-admission.md`
- 共享 Postgres 连接与 IPv4 session-pooler 姿态：`data/shared-postgres-ownership.md`、`decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md`
- 当前 phase 状态与 pending work：`.planning/PROJECT.md`、`.planning/STATE.md`
- 稳定 contract / schema：`contracts/`、`data/`
- 当前 runbook / reference / policy：`runbooks/`、`reference/`、`policies/`
- authenticated notice historical donor intake：`runbooks/authenticated-notice-historical-donor-intake-runbook.md`
- authenticated notice historical donor intake 当前证据：`reference/authenticated-notice-historical-donor-intake-evidence.md`
- 已导入 authenticated notice 历史数据消费：`runbooks/authenticated-notice-source-truth-replay-runbook.md`
- authenticated notice 到 regulations 的提升边界：`decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- authenticated notice 规章制度消费与后续 `regulations/*` 提升实施：`plans/internal-notice-policy-regulation-consumption-implementation.md`
- authenticated notice source attachment key 重组：`plans/authenticated-notice-source-attachment-key-reorganization.md`
- authenticated notice source-truth bounded pilot：`runbooks/authenticated-notice-source-truth-replay-pilot-runbook.md`
- 本地 Docker Postgres 恢复入口：`runbooks/local-postgres-dev-recovery-runbook.md`
- internal_notice preparation 质量验收：`reference/internal-notice-offline-preparation-quality-acceptance.md`
- internal_notice preparation 当前证据：`reference/internal-notice-offline-preparation-quality-evidence.md`
- authenticated-notice 历史 closeout 当前证据：`reference/authenticated-notice-historical-closeout-evidence.md`
- 地点寻找一期实施：`plans/campus-place-finding-foundation.md`
- 当前 closeout 之后的执行优先级：`plans/post-closeout-follow-up-execution-plan.md`
- `public-chat-web` 当前 strict donor parity closeout truth：`reference/public-chat-web-donor-diff-whitelist.md`、`reference/public-chat-web-strict-donor-parity-gap-inventory.md`、`reference/public-chat-web-route-state-parity-inventory.md`、`reference/public-chat-web-donor-parity-review-checklist.md`、`reference/public-chat-web-chatbot-donor-baseline.md`
- 首个真实 Worker 部署准备：`runbooks/staging-worker-deploy-runbook.md`
- 当前 `dev-backed supervisor` staging 验收：`runbooks/dev-backed-supervisor-staging-smoke-runbook.md`
- 已完成且退出默认入口的历史 plan/reference 已归档到 `.planning/archive-docs/`

## 标识规则

- `architecture` 和 `plans` 使用语义 slug，例如 `target-architecture.md`
- `contracts` 与 `data` 同样使用语义 slug，例如 `app-api-http.md`
- `decisions` 使用 `adr-NNNN-<slug>.md`
- `runbooks`、`reference`、`policies` 也使用稳定语义 slug
- 日期进入 YAML front matter，不作为文件名主标识

## Metadata

所有 canonical 文档在顶部使用 YAML front matter。

- `doc_type`: `index`、`architecture`、`contract`、`data`、`decision`、`plan`、`runbook`、`reference`、`policy`
- `status`: `active`、`accepted`
- `created`: 文档首次建立日期
- `updated`: 最近一次实质内容更新时间
- `decision_id`: 仅 decision 文档必填

## Canonical Docs

- `architecture/product-positioning.md`
- `architecture/current-architecture.md`
- `architecture/target-architecture.md`
- `architecture/product-runtime-architecture.md`
- `architecture/execution-and-specialists-architecture.md`
- `architecture/prompt-and-instruction-architecture.md`
- `architecture/identity-and-authorization-architecture.md`
- `architecture/retrieval-serving-architecture.md`
- `architecture/data-plane-architecture.md`
- `architecture/navigation-and-wayfinding-architecture.md`
- `architecture/official-web-architecture.md`
- `architecture/official-web-source-truth-contract.md`
- `architecture/authenticated-notice-source-architecture.md`
- `architecture/authenticated-notice-source-truth-contract.md`
- `contracts/app-api-error-model.md`
- `contracts/app-api-http.md`
- `contracts/app-api-operator-observability-http.md`
- `contracts/app-api-official-web-http.md`
- `contracts/app-api-official-web-run-lifecycle.md`
- `contracts/app-api-request-lifecycle.md`
- `contracts/app-api-supervisor-execution.md`
- `data/app-api-official-web-schema.md`
- `data/app-api-schema.md`
- `data/shared-postgres-ownership.md`
- `environment/README.md`
- `decisions/adr-0002-local-minio-conventions.md`
- `decisions/adr-0003-golden-dataset-governance.md`
- `decisions/adr-0004-evaluation-metrics.md`
- `decisions/adr-0005-campus-services-taxonomy.md`
- `decisions/adr-0006-agent-orchestration-and-safety.md`
- `decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `decisions/adr-0010-observability-and-telemetry-stack.md`
- `decisions/adr-0011-protected-panel-worker-runtime.md`
- `decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `decisions/adr-0013-app-api-worker-runtime.md`
- `decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `decisions/adr-0017-supervisor-internal-execution-admission.md`
- `decisions/adr-0018-app-api-official-web-control-plane-ownership.md`
- `decisions/adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- `decisions/adr-0020-qdrant-cloud-backup-restore-and-object-store-transition.md`
- `decisions/adr-0021-institution-scoped-entity-alias-governance.md`
- `decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `decisions/adr-0023-operator-observability-control-plane-and-sink-participation.md`
- `decisions/adr-0024-authenticated-notice-source-channel.md`
- `decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput.md`
- `decisions/adr-0027-navigation-specialist-and-spatial-truth.md`
- `decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`
- `decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md`
- `decisions/adr-0030-institution-scoped-product-path-and-explicit-open-domain-admission.md`
- `decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `decisions/adr-0032-internal-notice-notice-family-stratified-admission.md`
- `decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`
- `decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `plans/authenticated-notice-source-attachment-key-reorganization.md`
- `plans/authenticated-notice-source-foundation.md`
- `plans/internal-notice-policy-regulation-consumption-implementation.md`
- `plans/campus-place-finding-foundation.md`
- `plans/campus-identity-and-restricted-document-foundation.md`
- `plans/golden-dataset-execution-plan.md`
- `plans/intent-memory-acl-foundation.md`
- `plans/legacy-acl-carrier-compatibility-sunset.md`
- `plans/local-live-eval-canonical-registry-recovery.md`
- `plans/operator-observability-control-plane-foundation.md`
- `plans/prompt-grounding-and-hallucination-hardening-plan.md`
- `plans/post-closeout-follow-up-execution-plan.md`
- `plans/restricted-document-rollout-and-verification.md`
- `plans/supervisor-current-design-implementation.md`
- `plans/versioned-history-query-foundation.md`
- `runbooks/curriculum-plan-hybrid-rebuild-checklist.md`
- `runbooks/develop-main-release-runbook.md`
- `runbooks/authenticated-notice-bootstrap-smoke-runbook.md`
- `runbooks/authenticated-notice-historical-donor-intake-runbook.md`
- `runbooks/authenticated-notice-source-truth-replay-pilot-runbook.md`
- `runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `runbooks/authenticated-notice-async-staged-closeout-runbook.md`
- `runbooks/dev-backed-supervisor-staging-smoke-runbook.md`
- `runbooks/forward-worker-surface-smoke-runbook.md`
- `runbooks/index-release-runbook.md`
- `runbooks/local-postgres-dev-recovery-runbook.md`
- `runbooks/public-chat-staging-smoke-artifact-template.md`
- `runbooks/provider-secret-governance.md`
- `runbooks/staging-worker-deploy-runbook.md`
- `runbooks/qdrant-cloud-backup-and-restore-runbook.md`
- `runbooks/student-handbook-hybrid-rebuild-checklist.md`
- `runbooks/worker-observability-smoke-runbook.md`
- `runbooks/worker-observability-smoke-artifact-template.md`
- `reference/curriculum-plan-eval-metrics.md`
- `reference/eval-gold-truth-model.md`
- `reference/golden-dataset-case-matrix.md`
- `reference/authenticated-notice-historical-closeout-evidence.md`
- `reference/authenticated-notice-historical-donor-intake-evidence.md`
- `reference/internal-notice-offline-preparation-quality-evidence.md`
- `reference/internal-notice-offline-preparation-quality-acceptance.md`
- `reference/phase1-ingestion-retrieval-implementation-truth.md`
- `reference/public-chat-web-chatbot-donor-baseline.md`
- `reference/public-chat-web-donor-diff-whitelist.md`
- `reference/public-chat-web-donor-parity-review-checklist.md`
- `reference/public-chat-web-route-state-parity-inventory.md`
- `reference/public-chat-web-strict-donor-parity-gap-inventory.md`
- `reference/runtime-serving-and-index-terms.md`
- `reference/student-handbook-normalization-strategy.md`
- `reference/student-handbook-eval-metrics.md`
- `reference/testing-and-verification-lanes.md`
- `policies/official-web-crawl-policy.md`
- `policies/student-handbook-chunking-and-validation-policy.md`
- `policies/student-handbook-judge-gate-policy.md`
