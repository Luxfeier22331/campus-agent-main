---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-03-28
updated: 2026-06-01
---
# Index Release Runbook

## 文档边界

这份 runbook 只回答 release-managed collection 共用的 index release 操作面：

- 怎么做一次 `chunking -> embedding -> indexing -> alias publish`
- 怎么检查 release manifest
- 怎么做发布后抽样
- 怎么做 alias rollback

它不重复：

- 长期架构边界：`docs/architecture/target-architecture.md`
- 数据平面分层：`docs/architecture/system/data-plane-architecture.md`
- 术语定义：`docs/reference/runtime-serving-and-index-terms.md`
- 旧 physical collection retention 决策：`docs/decisions/adr-0019-qdrant-physical-co
  llection-retention-and-expiration.md`
- 当前 self-hosted Qdrant native backup 策略：
  `docs/decisions/adr-0045-self-hosted-single-node-qdrant-and-native-backups.md`
- 当前 self-hosted Qdrant native backup 操作：
  `docs/runbooks/self-hosted-qdrant-native-backup-runbook.md`
- 当前优先级和执行状态：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与对应 workstream
  `STATE.md`

## 前置检查

执行前必须确认：

- `.env` / deployment secret 已配置 Qdrant REST endpoint、object store、
  document registry、embedding provider
- 对应 collection 的 `runtime-profile.json` 已确认：
  - `qdrant_alias_name`
  - `qdrant_collection_prefix`
  - `serving_stage`
  - `retrieval_enabled`
  - vector binding
- source truth 和 per-document `document-units.jsonl` 已存在
- chunk / cleaning policy 已固定

## Qdrant Backup Retention Audit

对象存储中的 `{corpus}/backups/{collection}/.../backup-manifest.json` 不能按时间或体积直接删除。
先生成 bucket-wide retention inventory：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.audit_qdrant_backup_retention \
  --corpus regulations \
  --collection student_rules \
  --output-dir var/qdrant-backup-retention/regulations-student-rules
```

如需保护迁移基线：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.audit_qdrant_backup_retention \
  --corpus curriculum \
  --collection curriculum_plan \
  --protected-physical-collection-name <physical_collection_name> \
  --output-dir var/qdrant-backup-retention/curriculum-plan
```

输出：

- `summary.json`
- `backup-retention-inventory.jsonl`

inventory role：

- `current`：当前 serving alias 指向的 release。
- `previous`：最新 release manifest 的 previous physical collection。
- `migration_baseline`：operator 显式保护的迁移基线。
- `archive_candidate`：可进入 GC eligibility 判断的历史 release。
- `orphan_backup_manifest`：有 backup manifest 但找不到 release manifest；不得直接删除，需要先确认是否为迁移/恢复证据。

删除 physical collection 仍必须走 `campus_ingestion_worker.qdrant_gc_check` /
`campus_ingestion_worker.qdrant_gc_delete`，并显式传入当前 qdrant-native backup root，例如
`--backup-root /srv/backups/campus-agent/qdrant-snapshots`。不能直接根据本 audit 删除对象存储
backup。

建议先检查：

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_corpus_runtime_profile \
  tests.ingestion.test_rebuild_local_data \
  tests.ingestion.test_provider_result_replay_rebuild \
  tests.ingestion.test_registry_scope_release \
  tests.retrieval.test_backend_qdrant
```

## Qdrant Proxy Rule

operator shell 对远端 Qdrant endpoint 有一个已验证的固定约束：

- 如果进程继承了宿主机代理值，`curl
  "$QDRANT_URL/collections"`、`QdrantClient.get_collections()` 和 `get_aliases()`
  都可能直接超时
- 对 `release_registry_scope`、Qdrant 健康检查和 alias 检查，不能只做 `env -u HTTP_PROXY ...`
- 原因是 repo bootstrap 会从 `.env` 回填缺失 env；仅仅 unset 变量，坏代理值仍可能被重新注入当前进程

当前推荐前缀是显式清空大小写代理变量：

```bash
HTTP_PROXY='' HTTPS_PROXY='' ALL_PROXY='' NO_PROXY='*' \
http_proxy='' https_proxy='' all_proxy='' no_proxy='*'
```

例如：

```bash
HTTP_PROXY='' HTTPS_PROXY='' ALL_PROXY='' NO_PROXY='*' \
http_proxy='' https_proxy='' all_proxy='' no_proxy='*' \
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus <corpus> \
  --collection <collection> \
  --preparation-run-id <prep_id> \
  --no-publish-alias
```

如果 operator shell 需要临时绕过 `.env` 里的失效代理，固定规则是：

- 不要只用 `env -u HTTP_PROXY ...`
- 需要显式把大小写代理变量都置空，例如：

```bash
HTTP_PROXY='' HTTPS_PROXY='' ALL_PROXY='' NO_PROXY='*' \
http_proxy='' https_proxy='' all_proxy='' no_proxy='*' \
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.release_registry_scope ...
```

原因：

- `apps/ingestion-worker` 启动时会调用 `load_repo_env()`
- 这个 bootstrap 只补缺失键，不覆盖已存在环境变量
- 因此如果只是 `unset`，`.env` 里的旧代理值会被重新注回 release 进程

## 标准入口

统一入口：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus <corpus> \
  --collection <collection> \
  --raw-version-id <raw_version_id> \
  --source-pdf <source_pdf> \
  --publish-alias
```

可选参数：

- `--raw-asset-id`
- `--reset-index`
- `--no-publish-alias`

当前这个入口底层走的是：

- `provider_response_replay`
- `rebuild_local_data(...)`
- release-managed Qdrant physical collection

对于已经完成 import、只需要从 registry current truth 发布 release 的 scope，统一入口改为：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus official_web \
  --collection muc_public_pages \
  --no-publish-alias
```

可选参数：

- `--reset-index`
- `--publish-alias`
- `--no-publish-alias`
- `--acceptance-case-path <retrieval-acceptance-cases.json>`

这个入口底层走的是：

- `DocumentRegistry.list_by_scope(...)`
- runtime-profile-governed serving/current selection
- `document_units_object_key -> chunking -> embedding -> indexing -> optional
  alias publish`

固定规则：

- 默认 query-enabled scope 发布 alias 时必须显式传入 retrieval acceptance cases；缺失或失败时
  publish fail closed
- no-alias preview 可以不传 acceptance cases，但不能因此视为 serving alias 可发布
- provider-response replay 不发布 serving alias；query-serving alias publish 只走
  registry-scope release path
- release acceptance cases 是 alias publish 的硬门槛，只承载 doc-level smoke、关键
  wrong-document guard 和 backlink/traceability 这类必须在发布前关闭的问题；不要把 full
  formal benchmark、no-hit 阈值调优或 stale version-id 回归样本直接塞进 publish gate
- 默认 query-enabled scope 发布 alias 时还必须通过 qrels coverage gate；缺少 declared
  scenario denominator、required coverage class 或 required scenario 时 fail closed
- chunk quality gate 使用当前 collection/profile 的 token budget，而不是全局固定阈值；超过
  budget、缺 traceability metadata、出现 attachment-ref chunk 或 regulation heading-only
  chunk 都不得发布 query-serving alias
- Qdrant payload index 必须在 physical collection 创建后、points upsert 前建立；release
  path 不得等到写入 points 后才补建 filter index
- `regulations/student_rules` 的 alias publish gate 使用：
  `packages/evals/fixtures/student_rules_release_acceptance.v1.json`
- `regulations/student_rules` 的 formal qrels 与调参仍使用：
  `packages/evals/fixtures/student_handbook_retrieval_qrels.json`

对上游已经是 canonical `document-units` 的派生 collection，先执行 collection-specific
materialization，再走同一个 release shell。当前实例是 `curriculum/program_semester_facts`：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.materialize_curriculum_program_semester_facts

uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus curriculum \
  --collection program_semester_facts \
  --no-publish-alias
```

通过后再执行：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus curriculum \
  --collection program_semester_facts \
  --publish-alias
```

补充说明：

- `student_rules` 的一次 replay release 会同时 fan out 并索引 repo-tracked source
  projections，例如 `campus_services/contact_directory` 与
  `campus_services/service_catalog`
- `offline_preparation` collection 只要已经纳入这条 release-managed lifecycle，也应使用稳定
  alias；不要等“正式开放 query-serving”后再补做 alias 迁移

## 标准流程

### 1. 预演重建

先做一次不切 alias 的 rebuild/index：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus curriculum \
  --collection curriculum_plan \
  --raw-version-id <raw_version_id> \
  --source-pdf curriculum-plan.pdf \
  --no-publish-alias
```

目标：

- 能完成 source-truth replay
- 能为每个目标 scope 生成新 physical collection
- 能写出 release manifest
- validation summary 状态为 `passed`

### 2. 发布 alias

validation 通过后，执行正式发布：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus curriculum \
  --collection curriculum_plan \
  --raw-version-id <raw_version_id> \
  --source-pdf curriculum-plan.pdf \
  --publish-alias
```

目标：

- 每个目标 scope 的 serving alias 都指向新 release
- `index-release.json` 记录 `previous_physical_collection_name`
- payload 中写入 release 元数据

### 3. 已导入 registry scope 的发布

当 source-truth replay/import 已经完成，并且 registry 中已有当前 scope truth 时，不需要再走
`provider_response_replay`。例如当前 `official_web/muc_public_pages`：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus official_web \
  --collection muc_public_pages \
  --no-publish-alias
```

通过后再执行：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus <corpus> \
  --collection <collection> \
  --acceptance-case-path <release-acceptance-cases.json> \
  --publish-alias
```

固定规则：

- release 输入来自 registry + derived bucket，不回到 raw/crawl 输出
- collection selection 仍由 `runtime-profile.json` 控制
- `offline_preparation` scope 也应使用稳定 alias + versioned physical collection
- 如果某个派生 collection 的输入来自另一条 canonical document scope，先做 materialization，再做
  `release_registry_scope`

## 发布后检查

### Qdrant

检查点：

- serving alias 存在
- alias 指向新的 physical collection
- points count 大于 0
- query-time filter 字段已建 payload index；post-publish audit 会检查
  `document_id`、`revision_track`、`version_id`、`corpus`、`collection`、entity id、
  authz / visibility、`status`、`source_channel`、`is_current` 等字段，缺失或 schema 不一致
  都视为失败
- payload 含：
  - `index_release_id`
  - `index_validation_status`
  - `index_release_manifest_key`
  - `index_release_alias`
  - `index_physical_collection_name`
  - `chunk_policy_version`
  - `cleaning_policy_version`
  - `embedding_provider`
  - `embedding_model`
  - `embedding_dimensions`
  - `sparse_provider`
  - `sparse_model`
  - `sparse_tokenizer`
  - `sparse_language`
  - `dense_vector_name`
  - `sparse_vector_name`
  - `dense_prefetch_limit`
  - `sparse_prefetch_limit`
  - `rrf_k`
  - `rrf_dense_weight`
  - `rrf_sparse_weight`
  - `embedding_query_instruction_hash`
  - `hybrid_query_profile_hash`
  - `profile_identity_hash`
  - `quality_gate_status`
  - `chunk_quality_status`
  - `qrels_coverage_status`
  - `release_metadata_consistency_status`

这些字段必须与当前 `runtime-profile.json`、retrieval env 和 release manifest 一致。
runtime drift guard 会在查询 alias 前抽样 collection metadata / point payload；缺字段、profile
identity 不一致、quality gate 非 `passed`、或 sampled payload 混入不同 release/profile 时
query path fail closed。旧 release 如果缺 `profile_identity_hash` 或质量状态字段，需要重新
走 registry-scope release 后再作为 query-serving alias 使用。

### Object Storage

检查点：

- `{corpus}/releases/{collection}/{release_id}/index-release.json`
- `{corpus}/releases/{collection}/{release_id}/validation-summary.json`
- `{corpus}/releases/{collection}/{release_id}/quality-gate-summary.json`
- 若执行 query-serving alias publish，还应有 retrieval acceptance summary artifact

说明：

- 这里只应存在小型 manifest
- 不应出现 chunk dump

### Retrieval 抽样

至少做：

- 结构抽样
- 术语命中抽样
- 无关问题 no-hit 抽样
- source traceability 抽样

对 retrieval profile 调参，使用 qrels + tuning report 产出 evidence-backed patch
recommendation，不直接手改生产 profile：

```bash
uv run --all-packages python -m campus_evals.retrieval_tuning \
  --qrels packages/evals/fixtures/student_handbook_retrieval_qrels.json \
  --candidate <candidate-run-results.json> \
  --candidate <candidate-run-results.json> \
  --runtime-profile \
    configs/ingestion/regulations/student_rules/runtime-profile.json \
  --output <tuning-report.json>
```

固定检查：

- 发布前确认默认 query-enabled qrels fixture 覆盖完整：
  `campus_evals.benchmark.validate_default_query_enabled_qrels_coverage()`
- 发布前需要估算大规模 rebuild / embedding / Qdrant write posture 时，先跑 dry-run
  release benchmark；该报告只记录规模、token、embedding call/cache 与 Qdrant step 的
  `not_executed` timing，不发布 alias：

```bash
uv run --all-packages python -m campus_evals.retrieval_release_benchmark_cli \
  --chunks <chunks.jsonl> \
  --corpus <corpus> \
  --collection <collection> \
  --scale-multiplier <N> \
  --output <retrieval-release-benchmark.json>
```

- 发布前 release path 会自动执行 chunk quality gate 和 qrels coverage gate；operator
  仍可用同一批 chunk / qrels artifact 做离线复核，但离线复核不能替代 registry-scope
  release gate
- 需要离线产出 chunk quality report 时，使用同一套 evaluator：

```bash
uv run --all-packages python -m campus_evals.retrieval_chunk_quality_cli \
  --chunks <chunks.jsonl> \
  --max-tokens <runtime-profile-max-token-budget> \
  --output <chunk-quality-report.json>
```

该 CLI 在 report `status=passed` 时返回 `0`；发现 chunk quality issue 时返回 `2`，可直接作为
operator gate 使用。

- 发布后把 no-hit、low confidence、forbidden hit、authz filtered、version mismatch 与
  release metadata drift observation 汇总成候选 backlog：
  `campus_evals.retrieval_monitoring.build_retrieval_monitoring_backlog()`

## Ingestion Run Telemetry Smoke

release-managed worker shell 可以通过 `INGESTION_RUN_TELEMETRY_JSONL_PATH` 写入
OTel-compatible runtime event JSONL。这个 sink 只记录 run-level summary，不记录
canonical body、chunk body、OCR raw text、source credential、object-store secret 或 database
URL。

本地 dry-run smoke：

```bash
export INGESTION_RUN_TELEMETRY_JSONL_PATH=/tmp/ingestion-runtime-events.jsonl

uv run --all-packages python -m \
  campus_ingestion_worker.prepare_registry_scope_chunks \
  --corpus <corpus> \
  --collection <collection> \
  --preparation-run-id <prep_id>

uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus <corpus> \
  --collection <collection> \
  --preparation-run-id <prep_id> \
  --no-publish-alias
```

验收：

- JSONL records 的 `event_name` 是 `ingestion.run.started`、
  `ingestion.run.completed` 或 `ingestion.run.failed`。
- attributes 只包含 allowlisted summary，例如 `operation`、`stage`、`run_id`、`corpus`、
  `collection`、`document_count`、`chunk_count`、`point_count`、
  `embedding_cache_hit_count`、`embedding_cache_miss_count`、`qdrant_upsert_count`、
  `validation_status`、`retrieval_acceptance_status`、`post_publish_audit_status`、
  `failure_kind`、`duration_ms`。
- `prepare_registry_scope_chunks` 的 event 覆盖 chunking summary。
- `release_registry_scope` 的 event 覆盖 embedding cache、Qdrant upsert、release
  audit 与 alias publish summary。
- `release_index` legacy provider-response replay 只用于 no-alias replay；event 只保留
  import result counts，不发布 serving alias。
- sink/exporter 失败时，worker stdout 的 `telemetry.status` 应为 `failed` 且
  `failure_kind=telemetry_export_failed`；job 必须 fail closed，暴露 telemetry 配置、
  权限或存储问题。

offline / eval runtime 可通过显式注入 JSONL sink 写入 retrieval observation。该 sink
只写 sanitized retrieval observation，用于 eval / backlog intake，不反向改变 release
manifest、runtime profile 或 serving alias；sink 写入失败不得被伪装成 serving
success。

生产观测接入不应继续依赖 JSONL 文件作为主通道。长期接法是：

1. retrieval-core 继续只接受注入的 `RetrievalObservationSink`，不感知 OTel、vendor SDK、
   Collector 地址或 exporter 配置。
2. runtime shell 用 `build_retrieval_observation_event_sink()` 把 observation 包成
   `retrieval.runtime_observation` 事件。
3. Go `activity-worker-knowledge` / `execution-control` runtime adapter 将该事件转成
   OTel-compatible log/event；有当前 request trace context 时附带 trace/span
   correlation，没有 trace context 时至少保留 `request_id`、`plan_id`、`step_id`。
4. 由 OTel Collector 或等价 telemetry pipeline 负责 batching、retry、memory limiting、
   attribute filtering、environment/resource attribute enrichment 和 backend export。
5. metrics 从 event 派生，不由 retrieval-core 直接上报。首批 dashboard/alert 只看：
   retrieval latency、no-hit rate、fail-closed count by `failure_kind`、release metadata
   drift、reranker failed、live-assisted branch count。

生产接入验收至少跑三类样本：

- no-hit：确认只有 `query_sha256`，没有 raw query text。
- release drift：确认 `failure_kind=release_metadata_drift` 可被单独聚合和告警。
- reranker failed：确认 answer path fail closed，同时 event 带
  `failure_kind=reranker_failed`。

这些验收只证明 telemetry pipeline 可用，不允许绕过 release gate、qrels gate 或 runtime
profile gate。

默认 observation 只写 `query_sha256`，不写原始 query text。只有 operator 明确需要把 runtime
no-hit / low-confidence 样本转成 qrels 候选时，才临时打开：

```bash
SUPERVISOR_RETRIEVAL_OBSERVATION_INCLUDE_QUERY_TEXT=true
```

该开关不得作为常驻生产默认值。

indexed lookup backend fail-closed 时，runtime 会在重新抛出错误前写入 failed observation。
其中 release metadata drift 会使用 `failure_kind=release_metadata_drift`，让 monitoring
backlog 进入 release metadata repair，而不是被误归为普通 executor error。

如果 runtime 已注入 retrieval observation sink，可以从 JSONL 生成 backlog：

```bash
uv run --all-packages python -m campus_evals.retrieval_monitoring_cli \
  --observations <retrieval-runtime-observations.jsonl> \
  --output <retrieval-monitoring-backlog.json>
```

二阶段排序或 reranker 必须先进入 deterministic eval branch。使用
`campus_evals.retrieval_rerank_eval.evaluate_deterministic_rerank_branch()` 对同一
qrels/run 输出 before/after 指标，再用
`campus_evals.retrieval_rerank_eval.evaluate_reranker_adoption_gate()`
校验 quality delta、latency p95、cost per query、forbidden hit 与 regression
case。

reranker 不是全局默认开关。只有 collection runtime profile 显式设置以下字段，且对应
deterministic adoption evidence 可追溯时，才允许进入 runtime candidate：

- `reranker_enabled_by_default`
- `reranker_top_n`
- `reranker_profile_version`
- `reranker_adoption_evidence_id`

启用 reranker 的 release payload 必须带同一组 reranker metadata；runtime release drift guard
会对 opt-in profile 缺失或不一致的 release fail closed。runtime reranker provider
不可用、超时或 executor 缺失时，retrieval service 必须 fail closed，并在
observation 中写入 `failure_kind=reranker_failed`。

这些检查只产生 release evidence、tuning recommendation 或 backlog candidate；不得直接改写
runtime profile、canonical qrels 或 serving alias。

## 回滚

如果新 release 发布后发现问题：

1. 从 `index-release.json` 读取：
   - `serving_alias`
   - `previous_physical_collection_name`
1. 将 alias 切回上一个 physical collection
1. 重新做 retrieval 抽样
1. 记录 rollback 原因

回滚后仍保留：

- 失败 release 的 manifest
- validation summary

## 旧 Physical Collection 过期与清理

当前 retention policy 不是“超过 N 天直接删”，而是先判断角色：

- `current`
  - alias 当前目标
  - 永不自动删除
- `previous`
  - 最新 manifest 的 `previous_physical_collection_name`
  - 至少保留 `7` 天，且要等更新 release 的 post-publish validation / acceptance 关闭
- `migration_baseline`
  - 当 release 涉及 embedding model / dimensions、vector schema、chunk
    profile、cleaning policy、retrieval shape 迁移时，额外保留一版迁移前基线
  - 至少保留 `30` 天
- `archive_candidate`
  - 不再承担回滚或迁移保护角色的旧 collection

### 推荐 Backup 基线

清理旧 collection 前，必须先确认 self-hosted Qdrant native snapshot 已覆盖最长删除门禁：

- local daily snapshots: `14` 天
- local weekly snapshots: `8` 周
- off-host daily snapshots: `14` 天
- migration baseline snapshots: 默认 `30` 天

具体操作以 `docs/runbooks/self-hosted-qdrant-native-backup-runbook.md` 为准。

### 清理前检查

删除前必须同时确认：

1. 目标 collection 不是任何 alias 的 `current`
1. 目标 collection 不是最新 manifest 的 `previous`
1. 目标 collection 不是仍在保护窗口内的 `migration_baseline`
1. 对应 release 的 `index-release.json` 与 `validation-summary.json` 已在对象存储落盘
1. 当前没有 active incident、回归调查或人工验收仍依赖该 release
1. qdrant-native snapshot 与 off-host archive 已覆盖这次 release 的恢复窗口

### 清理步骤

1. 从最新 `index-release.json` 读取：
   - `serving_alias`
   - `physical_collection_name`
   - `previous_physical_collection_name`
1. 列出同一 `collection_prefix` 下的 physical collections。
1. 标出：
   - `current`
   - `previous`
   - `migration_baseline`
   - `archive_candidate`
1. 只删除通过全部门禁的 `archive_candidate`。
1. 记录本次清理：
   - alias
   - 删除的 physical collection 名称
   - 对应 release id
   - backup / snapshot 依据
   - 操作人和时间

### 额外说明

- 删除旧 physical collection 不等于删除历史文档版本；历史版本保留语义仍由 registry / object-store truth
  承担
- `offline_preparation` collection 和 `query_serving` collection 使用同一套 retention
  规则
- `--reset-index` 只用于显式硬重置，不用于日常 retention cleanup

## 禁止事项

- 不要把 object storage 当在线 chunk truth
- 不要把 physical collection 名写死进运行配置
- 不要跳过 validation 直接 publish alias
- 不要把 chunk dump 回写到对象存储
- 不要把 `--reset-index` 当作 routine expiration/cleanup 入口

## Exceptional Reconstruction From Native Qdrant Snapshot

The normal index-release source of truth is the ingestion release publication
path. A reconstructed manifest is allowed only for disaster recovery when the
live Qdrant alias and native snapshot sidecar are already consistent but the
derived bucket lost the corresponding `index-release.json`.

Command:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.reconstruct_rag_release_manifests \
  --backup-root /srv/backups/campus-agent/qdrant-snapshots \
  --report-path var/staging-evidence/rag-release-manifest-reconstruction.json
```

Add `--write` only after the dry-run report is reviewed. The command validates
alias target, physical collection, release id, manifest key and point count
against both live Qdrant payloads and `backup-manifest.json`. It writes only
exact `*/releases/*/<release_id>/index-release.json` keys.
