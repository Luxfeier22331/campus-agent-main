---
doc_type: index
truth_scope: repository
owner_boundary: docs/decisions
status: active
created: 2026-04-12
updated: 2026-07-05
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

## Evaluation / Quality / Observability

- `adr-0003-golden-dataset-governance.md`
- `adr-0004-evaluation-metrics.md`
- `adr-0010-observability-and-telemetry-stack.md`
- `adr-0067-ops-index-external-sinks.md`
  - Operator Console 在线值班观测收口为 app-api 最小 Ops Index + Sentry /
    Axiom / Langfuse 外部 sink；supersedes `adr-0023` 的 broad
    audit/quality/safety/cost read-model 方向。
- `adr-0061-eval-runtime.md`
  - TS + Langfuse 是长期 eval runtime / platform 默认路径；Python eval gate
    进入 transitional 退役期。
- `adr-0062-ragas-langfuse.md`
  - Ragas 与 Langfuse 按官方协作形态收口：Langfuse traces / datasets 经
    repo-owned safe projection 进入 Ragas，再将 scores 写回 Langfuse。
- `adr-0069-raw-replay-capture.md`
  - 安全投影继续 raw-free；诊断与 eval 所需 raw / near-raw LLM I/O 只能进入
    `raw_capture_policy.v1` 准入的受控 replay / debug 数据面。

## 核心架构与 runtime

- `adr-0006-agent-orchestration-and-safety.md`
- `adr-0011-operator-console-worker-runtime.md`
  - Worker runtime / Access / UI shell 决策继续生效；长期产品概念由
    `adr-0055-unified-operator-console-surface.md` 统一为 Operator Console。
- `adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `adr-0013-app-api-worker-runtime.md`
- `adr-0017-supervisor-internal-execution-admission.md`
- `adr-0048-temporal.md`
- `adr-0056-k8s-keda.md`
- `adr-0064-runtime-config-governance.md`
  - 冻结 runtime config 五分类：repo static config、deploy bootstrap
    config、secret material、app operational config 与 generated runtime
    projection；provider-config 是模型/search provider active profile truth。
- `adr-0065-gitops-argocd-helm-boundary.md`
  - Argo CD 是目标 K8s desired-state reconciler；第三方组件允许 Helm，一方
    workload 默认继续 Kustomize/raw YAML。
- `adr-0066-secret-delivery.md`
  - K8s workload 只依赖稳定 Secret 名称与 key；Sealed Secrets 是自托管 /
    开源 GitOps 推荐默认路径，manual Secret、External Secrets Operator 或 SOPS
    仍可由部署者选择；repo 不提交明文 secret，Cloudflare Worker secrets 继续由
    Worker secret store 管理。
- `adr-0030-institution-scoped-product-path-and-explicit-open-domain-admission.md`
- `adr-0042-tool-routing.md`
- `adr-0060-agent-llm-io-contract.md`
  - Agent LLM I/O 的长期运行时契约：薄 developer instructions、structured tools、
    typed packets、strict structured outputs 与 code-side finalization；不接受用更长总
    system prompt 或 prompt governance 替代 runtime contract。

## Collaboration / Workflow

- `adr-0046-gsd-sdk-and-codex-native-workflow.md`
  - GSD SDK 作为 planning control plane，Codex 原生会话作为 execution runtime；
    旧 repo-owned workstream harness、terminal-result、claim lease、heartbeat 与
    hook 注入不再恢复。

## Identity、authz 与 operator control plane

- `adr-0015-user-identity-memory-and-personalization-boundaries.md`
  - memory ownership / online recall 部分由
    `adr-0058-hindsight-self-hosted-personal-memory-plane.md` supersede；account / session、
    raw state 与 memory boundary 继续生效。
- `adr-0016-app-api-request-projection-and-operator-console-query-ownership.md`
- `adr-0023-operator-observability-control-plane-and-sink-participation.md`
  - superseded by `adr-0067-ops-index-external-sinks.md` for operator
    observability shape; preserved as historical context.
- `adr-0055-unified-operator-console-surface.md`

## Historical / superseded chains

### Restricted Authz Historical Chain

- `adr-0022-campus-identity-and-restricted-document-authorization.md`
  - superseded；restricted documents 与身份差异化 tool 权限不是当前主问答目标。
- `adr-0034-authorization-model-and-retrieval-filter-projection.md`
  - superseded；受限文档 authorization projection 不是当前主问答 retrieval 目标。
- `adr-0041-authenticated-document-center-and-regulation-layer-split.md`
  - superseded；authenticated document center / restricted attachment library
    不是当前产品面，仅保留 semantic collection 与 source/original artifact 分层历史。

### Operator / Ops Historical Chain

- `adr-0049-campus-ops-control-plane.md`
  - partially superseded by `adr-0055-unified-operator-console-surface.md` for the
    separate long-term `operator-console-web` product surface; dining release lifecycle
    and domain boundary clauses continue to apply.

### Authenticated Notice Closeout Historical Chain

- `adr-0025-authenticated-notice-async-staged-closeout.md`
  - superseded；historical authenticated notice closeout runner / operations prefix
    design，不再定义当前 notice ingestion mainline。
- `adr-0026-authenticated-notice-batch-leased-closeout-throughput.md`
  - superseded；historical batch-leased closeout executor design，不再定义当前
    ingestion-control task lifecycle。

### Execution Runtime Historical Chain

- `adr-0043-docker-runtime.md`
  - superseded by `adr-0056-k8s-keda.md` for production execution-control
    deployment substrate; retained only as Docker Compose / local / transitional
    staging history.
- `adr-0047-run-centric-durable-agent-runtime.md`
  - superseded by `adr-0048-temporal.md` for target execution substrate; retained
    for PG-backed run / step / event projection history.

### Memory Substrate Historical Chain

- `adr-0053-qdrant-native-personal-memory-index.md`
  - superseded by `adr-0057-zep-native-personal-memory-plane.md`, then by
    `adr-0058-hindsight-self-hosted-personal-memory-plane.md`。
- `adr-0057-zep-native-personal-memory-plane.md`
  - superseded by `adr-0058-hindsight-self-hosted-personal-memory-plane.md`。

## Retrieval、data plane 与基础设施

- `adr-0002-local-minio-conventions.md`
- `adr-0007-phase1-retrieval-baseline-update.md`
- `adr-0014-versioned-document-serving-and-history-query.md`
- `adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- `adr-0052-self-hosted-single-node-qdrant-and-native-backups.md`
- `adr-0029-ipv4-session-pooler-postgres-connectivity.md`
- `adr-0044-structured-projection-release-catalog-and-read-model.md`

历史替代关系：

- `adr-0020-qdrant-cloud-backup-restore-and-object-store-transition.md` 已被
  `adr-0052-self-hosted-single-node-qdrant-and-native-backups.md` supersede。

## Navigation 与 institution semantics

- `adr-0005-campus-services-taxonomy.md`
- `adr-0021-institution-scoped-entity-alias-governance.md`
- `adr-0027-navigation-tool-and-spatial-truth.md`
- `adr-0028-campus-navigation-basemap-and-provider-strategy.md`

## Official Web 决策

- `adr-0018-app-api-official-web-control-plane-ownership.md` 已被 official-web
  ingestion-control collector control-plane clean target supersede。
- `adr-0068-public-web-search-provider-boundary.md`
  - 公开官网搜索是 `public_web_search` typed tool 内部 provider adapter，不新增
    provider-specific model-visible tool，也不把搜索结果写回 official-web source truth。

## Authenticated Notice / Source Channel 决策

- `adr-0024-authenticated-notice-source-channel.md`
  - 继续保留一级 source channel、稳定 `notice` source unit 与 collector /
    data-plane 分层决策；旧 source channel 名称已由 `adr-0063` 替代。
- `adr-0063-internal-portal-source-channel-name.md`
  - canonical source channel 名称从历史 `authenticated_notice_portal` 改为
    `internal_portal`；旧名只保留在历史 ADR / migration note。

## Ingestion 决策

- `adr-0054-ingestion-control-plane-and-kernel-boundary.md`
  - ingestion control-plane、task registry、TS handler / Rust kernel / Python
    adapter 边界继续生效；自研 claim / lease / retry / dead-letter executor 部分已由
    Temporal workflow / activity execution 替代。

## Internal Notice / Promotion 决策

- `adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `adr-0032-internal-notice-notice-family-stratified-admission.md`
- `adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `adr-0035-notice-derived-regulation-promotion-boundary.md`
- `adr-0036-notice-derived-non-regulation-rule-boundary.md`
- `adr-0037-unified-scoped-rules-holding-collection.md`
- `adr-0040-regulation-work-title-and-edition-separation.md`

## 维护规则

- ADR 写 architecturally significant decision，不写临时执行记录
- ADR 不复制 runbook 的命令清单、CLI 参数、smoke 步骤或 operator 执行顺序；这些内容由
  `docs/runbooks/` 承接
- ADR 不承接 reference 的矩阵、schema、指标明细、inventory 或 evidence 明细；这些内容由
  `docs/reference/`、`docs/contracts/` 或 `docs/data/` 承接
- 旧 ADR 不删除；若失效，标成 `superseded` 或 `deprecated`
- replacement 必须写进 front matter 或正文显式回链
