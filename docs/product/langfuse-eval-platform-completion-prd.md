---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-19
updated: 2026-06-19
---

# Langfuse Eval Platform Completion PRD

## 1. 背景

当前 Langfuse 已作为 LLM observability / eval sink 接入校园问答在线路径。
已有事实包括：

- runtime trace 采用 `app-api -> execution-control -> OTel Collector ->
  Langfuse`。
- eval score publish 采用 `packages/evals -> Langfuse score API`。
- `packages/evals` 仍拥有 case schema、fixture、deterministic scorer、
  sanitized report 与 release verdict。
- Langfuse 不拥有 Temporal history、product projection、operator query backend、
  repo DTO 或 contract truth。

当前缺口是：Langfuse 接入已经具备 trace 和窄版 score publish 骨架，但尚未形成完整的
eval 管理面。尤其是 RAG retrieval 参数、answer quality、runtime capacity 等新增
eval 还缺少统一 score report、dataset / experiment 管理、release closeout 和
operator-safe 回链。

本 PRD 按当前代码实现补全平台化缺口。当前实现已经证明 Langfuse 可以作为 sink
接入，但尚未把 repo-owned eval truth 统一投影为 Langfuse datasets、experiments、
score configs 与 release evidence。

## 2. 目标

- 让 Langfuse 成为 eval 展示、对比、review、annotation 和 trace drill-down 平台。
- 保持 repo-owned eval truth：case schema、deterministic scorer、threshold、
  release verdict 继续由 `packages/evals` 拥有。
- 支持在线 trace score、离线 deterministic eval、RAG 参数 sweep、answer quality
  eval 与 runtime capacity eval 的统一发布。
- release lane 能证明真实 staging trace、observation 与 score 已进入 Langfuse，
  且能回链到 repo run / request / workflow identity。
- 所有 Langfuse-bound payload 必须遵守 repo 脱敏边界。

## 3. 非目标

- 不用 Langfuse 替代 Temporal workflow history。
- 不用 Langfuse 替代 app-api / operator projection。
- 不让线上回答路径依赖 Langfuse 可用性。
- 不把 Langfuse SDK、API 类型或 score schema 泄漏进 `packages/contracts`。
- 不把 raw prompt、raw answer、transcript、retrieved snippet、source body 或
  provider raw response 发到 Langfuse。

## 4. 用户与场景

- 工程：按 trace 查看一次在线回答中的 workflow、activity、RAG 和 finalization
  observation。
- Eval / QA：比较模型、prompt、retrieval 参数、release candidate 和 badcase 修复效果。
- Operator：查看低分 case、review queue、annotation 结果和 release evidence。
- 产品 / 架构：查看长期质量趋势、回归、能力成熟度和 release risk。

## 5. 当前状态

| 模块 | 当前状态 | 缺口 |
| --- | --- | --- |
| Runtime trace | OTel-first 链路已实现，本地检查通过 | 缺真实 staging trace evidence |
| Score publish | 支持 `online-answer-path` boolean score | 不支持通用 score report |
| Release closeout | 脚本和校验器已具备 | 需要真实 durable chat artifact 验证 |
| Eval truth | `packages/evals` 仍是 truth owner | Langfuse 仍主要是 sink |
| Datasets | repo 有 qrels / golden fixtures | 未同步为 versioned Langfuse datasets |
| Experiments | repo 有 runners / scorers | 未接 Langfuse dataset run comparison |
| RAG 参数 eval | 需求已明确 | 缺 runner、report 和 Langfuse score publish |

当前代码事实：

- `app-api` 使用 product `traceId` 派生 Langfuse-compatible trace id，并把
  `traceparent` 传给 execution-control。
- `execution-control` 通过 OTel emitter 发出 `langfuse.trace.name`、
  `langfuse.session.id`、`langfuse.user.id`、`langfuse.release`、
  `langfuse.trace.tags` 以及 run / workflow / step attributes。
- staging Collector 模板把 traces fan-out 到 Langfuse `/api/public/otel`，使用
  Basic Auth 与 `x-langfuse-ingestion-version=4`。
- `packages/evals` 支持 `publish-langfuse-profile` 兼容入口，并支持
  `publish-langfuse-score-report` 发布 repo-owned sanitized score report。
- `verify-langfuse-trace` 已能校验 trace core、observation、identity drift、
  observation contract 与 forbidden payload fields。
- `langfuse-release-evidence.json` builder / checker / closeout runner 已存在，
  但 release closeout 仍绑定 `online-answer-path` profile report。
- RAG eval 已有 qrels、retrieval benchmark、retrieval tuning 与 deterministic
  rerank branch evaluator；retrieval tuning report 已可产出 Langfuse score report，
  但尚未形成 Langfuse dataset sync 或 experiment runner。

本 PRD 补全范围：

- score naming registry / score config sync
- Langfuse dataset sync
- Langfuse experiment runner
- dataset run / experiment result 回写 repo artifact
- RAG first-stage candidate runner、parameter sweep 与 score report
- annotation queue 自动入队 / review 回流
- operator-safe Langfuse backlink projection

实现 closeout 要求：

- 新增能力必须继续以 `packages/evals` 为 eval truth owner。
- Langfuse-bound 操作必须通过 sanitized REST adapter 或 Collector fan-out。
- operator surface 只能读取 app-api sanitized projection，不直接查询 Langfuse。
- RAG first-stage candidate runner 必须由 Go execution-control runtime 产出真实
  dense / sparse prefetch 与 final candidate evidence。

## 6. 功能需求

### 6.0 Langfuse API Dependency Boundary

本仓库直接依赖 Langfuse project-level public API 与 OTLP endpoint，不把 Langfuse SDK
或 API 类型提升为 repo contract。

允许依赖：

- OTLP trace ingestion：`/api/public/otel`，trace-specific endpoint 可为
  `/api/public/otel/v1/traces`。
- Basic Auth：public key 作为 username，secret key 作为 password。
- Langfuse ingestion header：`x-langfuse-ingestion-version=4`。
- Score API：`POST /api/public/scores`，用于 repo-computed scores。
- Dataset API：`/api/public/v2/datasets` 与 dataset item API，用于 repo fixture
  副本同步。
- Dataset run item API：`/api/public/dataset-run-items`，用于 experiment run
  result 回链。
- Score config API：`/api/public/score-configs`，用于标准化 score name / type。
- Annotation queue API：仅用于 review queue 自动化，不用于 deterministic verdict。

约束：

- self-hosted Langfuse 版本必须在 staging closeout 前验证上述 API 可用。
- repo 实现优先使用薄 REST adapter；只有 experiment runner 明确需要 SDK
  高层能力时，才允许在 `packages/evals` 内隔离使用 SDK。
- Observations API v2 / Metrics API v2 不能作为 P0 依赖，因为官方文档标注其存在
  Cloud-only 能力边界。

### 6.1 Real Trace Closeout

必须支持用真实 staging chat run 生成 Langfuse release evidence。

要求：

- 读取 durable chat artifact 中的 `langfuseCloseout` identity。
- 校验真实 Langfuse trace 存在。
- 校验 `session_id`、`user_id`、`release`、`request_id`、`run_id`、
  `workflow_id` 与 artifact 一致。
- 校验 trace 至少包含一个 repo-owned workflow / activity observation。
- 所有 observation 都必须通过 forbidden payload field 检查；任何出现的
  request / run / workflow identity attribute 都不得与 artifact drift。
- 只有 repo-owned workflow / activity observation 进入 runtime contract 校验分母。
  repo-owned observation 以 `telemetry.allowed_attributes_version` 或 repo step marker
  识别，例如 `step_id`、`step_kind`、`activity_type`。
- 每个 repo-owned observation 都必须带有 runtime contract 要求的 step / activity /
  timing / projection attributes，不能只校验任意一个 observation。
- SDK / infrastructure observation 可以存在，但不能计入 contract checked
  observation denominator。
- 缺 trace、缺 observation、identity drift 或 contract drift 必须 fail closed。
- release closeout 必须校验 score publish denominator 完整性：
  `published == expected_publish_denominator` 且 `failed == 0`。
- closeout verifier 输出必须包含 `observation_count`、
  `repo_owned_observation_count`、`contract_checked_observation_count` 和
  `non_repo_observation_count`。

### 6.2 Generic Score Report

新增 repo-owned sanitized score report schema。该 schema 由 `packages/evals`
拥有，用于所有 Langfuse score publish，包括由旧 `profile-report` 迁移而来的
score。

最小字段：

```text
schema_version
eval_kind
eval_run_id
profile_id
surface_key
variant_id
environment
release
source_git_head
source_artifact_path
source_result_denominator
expected_publish_denominator
score_items[]
omitted_items[]
```

`score_items[]` 最小字段：

```text
idempotency_key
name
data_type: BOOLEAN | NUMERIC | CATEGORICAL | TEXT
value
case_id
trace_id | null
observation_id | null
session_id | null
dataset_run_id | null
dataset_item_id | null
metadata
comment | null
```

`omitted_items[]` 最小字段：

```text
case_id
source_result_id
reason
source_artifact_ref
metadata
```

要求：

- 支持 Langfuse 官方 score types：`BOOLEAN`、`NUMERIC`、`CATEGORICAL`、`TEXT`。
- report 必须非空。
- `source_result_denominator` 必须等于 source artifact 中参与本轮转换的结果数量。
- `score_items[]` 只包含已具备 Langfuse target identity、准备真实发布的 score。
- `expected_publish_denominator` 必须等于 `score_items[]` 数量。
- `omitted_items[]` 记录 source result 无法转成 Langfuse score 的原因；report
  generator 不得静默丢弃 source result。
- `source_result_denominator` 必须等于 `score_items[]` 与 `omitted_items[]` 数量之和。
- 缺少 required identity、非法 data type、非法 value 类型必须 fail closed。
- `BOOLEAN` value 必须为 `0` 或 `1`，不能使用 JSON boolean。
- `NUMERIC` value 必须为 number。
- `CATEGORICAL` value 必须为 registry / score config 中声明过的 string category。
- `TEXT` value 必须为 1-500 字符；TEXT 不得用于 release gate aggregate。
- trace / observation score 必须携带 `trace_id`；observation score 同时必须携带
  `observation_id`。
- session score 只能携带 `session_id`，不能伪造 trace correlation。
- dataset run score 必须携带 `dataset_run_id` 或可从 dataset run item evidence
  反查到 run identity。
- offline eval 不得伪造 trace id；无法绑定 `dataset_run_id`、`dataset_item_id`、
  `session_id` 或真实 trace identity 的 offline result 必须进入 `omitted_items[]`。
- 所有 metadata 必须通过 allowlist。
- `idempotency_key` 必须稳定，避免同一 eval run 重复 publish 产生重复 scores。
- 对要求完整 trace correlation 的 release profile，`omitted_items[]` 必须为空。
- validator、golden fixture 与 malformed fixture 必须随 schema 同步落盘。

### 6.3 Generic Score Publish CLI

新增命令：

```bash
uv run --all-packages python -m scripts.eval_gate \
  publish-langfuse-score-report \
  --score-report <path> \
  --json
```

要求：

- 复用现有 Langfuse Basic Auth 配置。
- 发布 Langfuse score API 支持的 score payload。
- 发布失败必须返回非 0，不得降级为 warning。
- 支持 `--dry-run`、`--validate-only` 和真实 publish 三种模式；CI 默认只跑
  validation / dry-run，release closeout 显式真实 publish。
- generic publisher 不在发布时自行判断 skip；不可发布 result 必须已经由
  score report generator 写入 `omitted_items[]`。
- 输出 published / failed 统计，并回显 report 中的 omitted count。
- 输出必须包含 `source_result_denominator`、`expected_publish_denominator`、
  `published`、`failed`、`omitted`、`score_report_path`、`eval_run_id` 和
  `release`。
- 当 `published + failed != expected_publish_denominator` 时 fail closed。
- 当真实 publish 模式出现 `failed > 0` 时 fail closed。

迁移要求：

- 保留现有 `publish-langfuse-profile` 作为兼容入口。
- `publish-langfuse-profile` 内部必须先把 `profile-report.json` 转换为
  `langfuse_score_report.v1`，再调用 generic publisher。
- `eval-release-gate.yml` 的 Langfuse publish step 在迁移期可继续调用旧入口；
  Phase 2 完成后切到 `publish-langfuse-score-report`。
- release evidence artifact 从 `publish_langfuse_profile` 字段迁移到
  `publish_langfuse_score_report` 字段；迁移期 checker 可显式支持旧字段，但新
  closeout 只能写新字段。

### 6.4 RAG First-stage Parameter Eval

新增 `rag_first_stage_parameter_sweep` eval，用于评估当前 RAG 第一阶段 retrieval
参数。

覆盖 surface：

- `regulations/student_rules`
- `regulations/institutional_rules`
- `curriculum/curriculum_plan`
- `official_web/stable_reference`

第一批参数：

- `top_k = 1 / 3 / 5 / 8`
- `dense_prefetch_limit = 10 / 20 / 40`
- `sparse_prefetch_limit = 10 / 20 / 40`
- 暂不启用 rerank

指标：

- `retrieval.doc_hit_at_1`
- `retrieval.doc_hit_at_3`
- `retrieval.doc_recall_at_k`
- `retrieval.forbidden_hit_rate`
- `retrieval.no_hit_false_positive_rate`
- `retrieval.wrong_version_hit_rate`
- `retrieval.p95_latency_ms`
- `retrieval.pass`

输出 artifact：

- `rag-first-stage-parameter-sweep.json`
- `langfuse-score-report.json`
- per-surface candidate result files

per-surface candidate result file 必须使用 repo-owned schema：

```text
schema_version: rag_first_stage_candidate_result.v1
surface_key
variant_id
retrieval_top_k
dense_prefetch_limit
sparse_prefetch_limit
rrf_k
rrf_dense_weight
rrf_sparse_weight
reranker_enabled
cases[]
```

`cases[]` 最小字段：

```text
case_id
status
latency_ms
prefetch_sources[]
final_sources[]
```

`prefetch_sources[]` 与 `final_sources[]` 的 source 最小字段：

```text
rank
stage: dense_prefetch | sparse_prefetch | rrf_final | rerank_final
doc_id
version_id | null
chunk_id | null
score | null
```

每个 candidate 必须包含：

- `surface_key`
- `variant_id`
- `retrieval_top_k`
- `dense_prefetch_limit`
- `sparse_prefetch_limit`
- `rrf_k`
- `rrf_dense_weight`
- `rrf_sparse_weight`
- `reranker_enabled`
- `case_count`
- aggregate metrics
- failed case ids
- recommended / rejected reason

指标定义：

- `retrieval.doc_hit_at_1`：qrels positive case 中 `final_sources[:1]`
  命中任一 expected `doc_id` 的比例。
- `retrieval.doc_hit_at_3`：qrels positive case 中 `final_sources[:3]`
  命中任一 expected `doc_id` 的比例。
- `retrieval.doc_recall_at_k`：qrels positive case 中
  `final_sources[:retrieval_top_k]` 覆盖 expected `doc_id` 的平均比例。
- `retrieval.forbidden_hit_rate`：所有 case 中 `final_sources` 命中 forbidden
  source 的比例。
- `retrieval.no_hit_false_positive_rate`：no-hit qrels case 中 `final_sources`
  非空的比例。
- `retrieval.wrong_version_hit_rate`：version-locked positive case 中，topK 命中相同
  `doc_id` 但未命中 expected `version_id` 的比例。
- `retrieval.p95_latency_ms`：runner 包住真实 retrieval call 测得的 per-case
  `latency_ms` P95；缺失 latency 的 candidate 必须 invalid。
- `retrieval.pass`：candidate 同时满足 registry / manifest 声明的 release gate
  threshold 时为 `1`，否则为 `0`。

决策规则：

- 默认选择稳定通过 qrels / release gate 的最小 K。
- 如果目标 evidence 在 `prefetch_sources` 候选中但未进入 `final_sources` topK，才考虑
  增大 K 或引入 rerank。
- 如果 prefetch 候选中没有目标 evidence，不能靠增大 topK 解决；应回到 query
  framing、chunking、embedding、BM25 analyzer 或 collection profile。
- `official_web/stable_reference` 当前 qrels 数量偏小；P0 可先覆盖
  `student_rules` 与 `curriculum_plan`，P1 再覆盖四个 surface。
- rerank 只能在 sweep 证明 prefetch candidate 足够但 topK 排序不足时进入下一阶段。

### 6.5 Score Naming Registry

新增稳定 score naming registry，避免 Langfuse 中出现同义不同名。

要求：

- registry 由 `packages/evals` 拥有，建议文件为
  `packages/evals/fixtures/ops/langfuse_score_registry.v1.json`。
- 每个 score name 必须有 owner、data type、value range / categories、适用
  eval kind、release gate usage 和解释。
- 新 score name 必须先进入 registry，再允许 publish。
- 禁止临时拼接、case-specific 或 provider-specific score name。
- publisher 必须拒绝 registry 中不存在的 score name。
- 如启用 Langfuse score config sync，registry 是 source of truth；Langfuse
  score config 只是平台侧校验副本。

首批 score families：

- `retrieval.*`
- `quality.*`
- `capacity.*`
- `runtime.*`
- `release.*`

首批 registry item 至少覆盖：

- `retrieval.doc_hit_at_1`
- `retrieval.doc_hit_at_3`
- `retrieval.doc_recall_at_k`
- `retrieval.forbidden_hit_rate`
- `retrieval.no_hit_false_positive_rate`
- `retrieval.wrong_version_hit_rate`
- `retrieval.p95_latency_ms`
- `retrieval.pass`
- `release.pass`
- `runtime.trace_contract_pass`

### 6.6 Dataset Sync

将 repo-owned fixtures 同步到 Langfuse datasets。

首批 dataset：

- RAG qrels
- release acceptance cases
- answer quality cases
- online answer path product cases
- known-gap / badcase review seeds

要求：

- repo fixture 仍为 source of truth。
- Langfuse dataset item 必须带 source fixture path、case id、source git head 和
  fixture hash。
- 支持 dataset version pinning。
- 删除或修改 dataset item 必须能追溯回 repo fixture change。
- 不把 raw sensitive payload 同步进 dataset。
- 新增 CLI：

```bash
uv run --all-packages python -m scripts.eval_gate \
  sync-langfuse-datasets \
  --dataset-manifest <path> \
  --dry-run \
  --json
```

dataset identity：

- dataset name 必须稳定，允许使用 folder-like name，例如
  `campus/rag/student_rules/qrels`。
- dataset item `id` 必须由 repo 生成，且在 Langfuse project 内全局唯一。
- dataset item `id` 必须在 fixture 内容变化时保持稳定；不得包含
  `fixture_hash` 或 `fixture_hash_prefix`。
- dataset item `id` 推荐格式：
  `campus:<dataset_slug_hash>:<case_id_slug>`。
- item metadata 必须包含 `dataset_slug`、`case_id`、`source_fixture_path`、
  `source_git_head`、`fixture_hash`、`surface_key`、`schema_version`。
- fixture 内容变化必须用同一个 item id upsert，让 Langfuse dataset version 记录变化。
- `case_id` 变化视为 identity 变化：旧 item 必须进入 tombstone / archive 计划，新
  item 必须 create。
- fixture 删除不得静默删除 Langfuse item；必须输出 tombstone / archive 计划。
- 默认不得调用 irreversible delete；除非 release owner 显式批准，否则只允许 archive。
- sync 输出 artifact 必须记录 created / updated / archived / unchanged / failed
  数量、old / new fixture hash 和 Langfuse dataset version timestamp。

### 6.7 Experiment Runner

新增 repo-owned Langfuse experiment runner。

要求：

- 支持从 Langfuse dataset 或 local repo fixture 运行。
- task function 调用 repo runtime / eval runner。
- evaluator 使用 repo-owned deterministic scorer。
- 支持 item-level score 和 run-level aggregate score。
- 支持并发上限、超时、失败隔离和完整性校验。
- experiment 结果必须落回 repo artifact，再发布到 Langfuse。

新增 CLI：

```bash
uv run --all-packages python -m scripts.eval_gate \
  run-langfuse-experiment \
  --experiment-manifest <path> \
  --json
```

experiment artifact 最小字段：

```text
schema_version
experiment_run_id
experiment_kind
dataset_name
dataset_version
variant_id
baseline_id | null
surface_key
environment
release
source_git_head
item_results[]
aggregate_scores[]
verdict
```

`item_results[]` 最小字段：

```text
dataset_item_id
case_id
status
trace_id | null
observation_id | null
scores[]
failure_class | null
```

要求：

- Langfuse-hosted dataset run 必须写 dataset run item evidence。
- local fixture experiment 可以发布 trace / score，但不能声称存在 Langfuse dataset run。
- experiment runner 可以使用 Langfuse SDK 高层 runner，但必须封装在
  `packages/evals` 内部，不能泄漏 SDK 类型。
- CI gate 只信 repo artifact 的 deterministic verdict，不直接信 Langfuse UI 状态。

### 6.8 CI / Release Gate Integration

CI 和 release lane 必须能判断 Langfuse eval publish 是否完整。

要求：

- eval runner 成功但 publish 失败时，release/eval lane fail closed。
- publish 成功但 score 数量少于 `expected_publish_denominator` 时 fail closed。
- 缺 eval kind 所需的 dataset version、trace correlation 或 release identity 时
  fail closed。
- Langfuse 不可用不能影响线上回答路径，但会阻断对应 release evidence closeout。
- `pnpm ci:langfuse` 必须覆盖：
  - trace id vector compatibility
  - Langfuse adapter score publish validation
  - score report schema validation
  - score registry audit
  - Collector fan-out contract
  - release evidence checker
  - dataset sync dry-run
  - experiment artifact validator
- `eval-release-gate.yml` 必须支持 generic score report artifact upload。
- staging closeout 必须生成真实 `langfuse-release-evidence.json`，并校验真实
  Langfuse trace 与真实 score publish evidence。

### 6.9 Annotation And Review Workflow

Langfuse annotation workflow 用于 review，不拥有 deterministic verdict。

要求：

- low-score / failed / known-gap case 可进入 review queue。
- reviewer 标注结果必须能导出或回流为 repo backlog / fixture candidate。
- 人工 review 不能直接覆盖 deterministic release verdict。
- operator projection 只展示 sanitized backlink 和 summary，不直接查询 Langfuse。
- annotation queue 必须引用 score config，避免 reviewer score 名称漂移。
- prefill annotation score 时 source 必须使用 Langfuse API 支持的 source，不得冒充
  internal evaluator output。
- review export artifact 必须包含 queue id、score config id、case id、reviewer
  score summary、review comment hash、repo backlog candidate id。

### 6.10 Operator-safe Backlink

Operator Console 不直接查询 Langfuse。

要求：

- app-api 只暴露 sanitized backlink summary。
- backlink summary 允许包含 `trace_id`、`eval_run_id`、`score_name`、
  `score_value`、`release`、`environment`、`langfuse_url`。
- backlink summary 禁止包含 raw prompt、raw answer、snippet、source body、
  provider response 或 secret。
- backlink 不得成为 product projection truth；缺 backlink 不能影响线上回答。

## 7. 数据边界

允许进入 Langfuse：

- `trace_id`、`request_id`、`run_id`、`workflow_id`、`case_id`
- `surface_key`、`profile_id`、`eval_kind`、`variant_id`
- `release`、`environment`、`source_git_head`
- counts、latency、pass/fail、categorical reason、threshold summary

禁止进入 Langfuse：

- raw prompt
- raw answer
- raw transcript
- retrieved snippet
- source body text
- provider raw response
- JWT、cookie、authorization header
- API key、provider secret、database URL、object-store secret

特殊边界：

- `traceparent` 可以用于 trace correlation，但不能把 provider request headers
  透传进 Langfuse metadata。
- query text 只能以 hash 或 sanitized case id 进入 Langfuse；除非对应 fixture 已经
  明确标注为公开 eval input。
- dataset input / expected output 必须使用 repo fixture 的 sanitized projection。
- comments 可包含简短 reviewer 说明，但不得包含原始答案、原始 prompt 或原文片段。

## 8. 验收标准

P0 完成标准：

- `pnpm ci:langfuse` 继续通过。
- staging 真实 chat run 生成并校验 `langfuse-release-evidence.json`。
- `langfuse_score_report.v1` schema、validator、golden fixture 和 malformed
  fixture 已落盘。
- `langfuse_score_report.v1` 明确定义 `source_result_denominator`、
  `expected_publish_denominator`、`score_items[]` 与 `omitted_items[]`，并拒绝
  denominator 不一致的 report。
- `publish-langfuse-score-report` 支持 `BOOLEAN` 和 `NUMERIC`，且旧
  `publish-langfuse-profile` 已迁移为内部调用 generic publisher。
- score naming registry 能阻止未知 score name publish。
- `rag_first_stage_parameter_sweep` 对至少 `student_rules` 和
  `curriculum_plan` 产出 sanitized report、candidate result artifact 与
  `langfuse-score-report.json`。
- trace closeout 能区分 repo-owned observation 与 SDK / infrastructure observation，
  并输出 contract checked observation denominator。
- Langfuse 中能按 `eval_kind`、`surface_key`、`release`、`variant_id`
  查询 score。
- 任一缺 trace、缺 score、payload 含禁用字段、结果不完整都 fail closed。

P1 完成标准：

- RAG 参数 sweep 覆盖四个当前 query-serving surface。
- Langfuse dataset sync 支持 qrels 和 answer quality fixtures。
- experiment runner 支持至少一个 Langfuse-hosted dataset run。
- CI 能校验 score publish denominator 与 omitted item 完整性。
- release evidence v2 支持 generic score report closeout。
- dataset sync dry-run 在 `pnpm ci:langfuse` 中被覆盖。

P2 完成标准：

- annotation queue 接入 badcase review。
- operator projection 展示 sanitized Langfuse backlink。
- 支持 historical experiment comparison 和 accepted baseline comparison。

## 9. 分期

### Phase 1: Runtime Closeout

- 跑通真实 staging trace evidence。
- 跑通 release closeout artifact。
- 固化 closeout runbook 和失败诊断。
- 将 release evidence checker 从 profile-only 升级为 generic score report aware。

### Phase 2: Generic Score Publish

- 定义 score report schema。
- 实现 score report validator、golden fixture 和 malformed fixture。
- 实现 `publish-langfuse-score-report`。
- 将 `publish-langfuse-profile` 迁移为 profile -> score report adapter。
- 定义 score naming registry。
- 接入 RAG first-stage parameter sweep。

### Phase 3: Datasets And Experiments

- 同步 repo fixtures 到 Langfuse datasets。
- 固化 dataset item id、dataset version pinning 和 sync artifact。
- 接入 Langfuse experiment runner。
- 固化 experiment artifact、dataset run item evidence 和 aggregate score publish。
- 支持 dataset version 和 baseline comparison。

### Phase 4: Review And Operator Backlink

- 接入 annotation / review queue。
- 回流 review 结果到 repo backlog 或 fixture candidate。
- app-api operator projection 暴露 sanitized backlink。

## 10. 风险

- 把 Langfuse 误做成 eval truth owner。
- offline eval 没有 trace，却强行伪造 trace score。
- payload 泄漏 raw query、snippet 或 provider response。
- score name 不稳定，导致长期趋势不可比。
- CI 只检查 publish 成功，不检查 publish denominator 与 omitted item 完整性。
- 运行时直接依赖 Langfuse SDK，绕过 Collector redaction 和 fan-out 策略。
- dataset item id 不稳定，或把 content hash 放入 item id，导致 Langfuse 里同一
  case 产生多份不可比较样本。
- experiment runner 只在 Langfuse UI 生成结果，但没有 repo artifact，导致 release
  verdict 无法复现。
- TEXT score 被误用于 release gate，导致不可聚合的 reviewer note 混入自动 verdict。

## 11. 相关文档

- [ADR-0059 Langfuse Observability And Eval Platform](../decisions/adr-0059-langfuse-observability-and-eval-platform.md)
- [Langfuse Observability And Eval Architecture](../architecture/system/langfuse-observability-and-eval-architecture.md)
- [Langfuse Runtime Observability Contract](../contracts/langfuse-runtime-observability-contract.md)
- [Runtime OTel Collector Pipeline](../runbooks/runtime-otel-collector-pipeline.md)
- [Eval Release Gate Automation](../runbooks/eval-release-gate-automation.md)
- [Langfuse Scores Overview](https://langfuse.com/docs/evaluation/scores/overview)
- [Langfuse Scores Via SDK / API](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk)
- [Langfuse Datasets Overview](https://langfuse.com/docs/datasets/overview)
- [Langfuse Experiments Via SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk)
- [Langfuse OpenTelemetry Guide](https://langfuse.com/docs/opentelemetry/get-started)
