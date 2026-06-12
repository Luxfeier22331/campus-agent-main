---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-06-05
---
# Retrieval Serving Architecture

## 文档边界

本文冻结 retrieval / serving 的 supporting architecture。

它回答的是：

- 当前 serving surface 与 retrieval baseline 是什么
- retrieval pipeline 如何分层
- 当前版本 serving 与未来历史查询如何统一在一套模型下

补充约束：

- 当前 merged truth 的 query-enabled surface 以
  `docs/architecture/current-architecture.md` 为准
- 顶层 capability routing 与 surface capability policy 不在本文维护；统一看
  `docs/architecture/system/capability-routing-and-admission-architecture.md`
- 本文负责解释 retrieval / serving 模型、internal surface 类别与长期版本查询边界，不维护 phase 顺序或
  rollout closeout
- durable typed-tool agentic RAG 的 target truth 另见
  `docs/architecture/system/agentic-retrieval-architecture.md`

## Knowledge-Family Position

本文只描述 capability routing 已进入 knowledge-family path 之后的 retrieval / serving
truth。

固定规则：

- 顶层产品入口不先判 retrieval `scope`
- 只有当 Execution Agent Layer 已把请求路由到 knowledge-family path 后，`requested_scope`、version
  mode、retrieval planning 才开始成立
- `service_status_lookup`、`campus_notice_discover`、internal selected notice resolve
  (`payload_kind=campus_notice_get`) 与 `place_lookup` 这类结构化 capability 不应再被误读成
  retrieval scope 的旁支；它们默认是 typed domain tools / projection-backed internal query
  service，只有需要语义 specialist 时才进入 agent-as-tool

## Accepted Retrieval Model

当前 serving surface 由 runtime profile 显式控制。

当前默认公开 query-enabled surface 仍限于：

- `regulations/student_rules`
- `regulations/institutional_rules`
- `curriculum/curriculum_plan`
- `official_web/stable_reference`

当前还存在若干 internal retrieval surface，但它们不因此自动成为默认公开 query-serving collection：

- `curriculum/course_facts` internal agent retrieval surface
- `curriculum/program_family_facts` internal agent retrieval surface
- `curriculum/program_semester_facts` internal agent retrieval surface
- `regulations/scoped_rules` notice-derived scoped-rule holding collection

当前 accepted retrieval baseline 是：

- planner-first admitted retrieval
- dense + sparse hybrid retrieval step
- registry-backed evidence
- multi-step execution / merge / dedupe
- typed retrieval tool boundary
- 对 resolved specific policy lookup，允许在 admitted document 内执行 broad lookup +
  focused lookup 的文档内多步检索
- evidence bundle 回链
- agent 可以在 `curriculum_plan` 选中 scope 下内部切到
  `course_facts`、`program_family_facts`、`program_semester_facts`；selected scope
  不因此漂移
- `app-api` knowledge request 现在已经显式开放 `current` / `historical` / `as_of` /
  `compare` 这四种 version query mode；`freshness_sensitive` 与 `live_assisted`
  仍未作为产品 route 默认开放

这里的 `agent` 默认指 knowledge-family `knowledge` specialist，而不是顶层 capability router。

## Current Baseline Vs Target Agentic Retrieval

当前 merged truth 仍是：

- planner-first retrieval baseline
- typed retrieval plan + bounded replan execution
- query framing 后进入 admitted collection / version selection，再进入多步 retrieval
  execution
- retrieval trace 与 final supporting evidence 分层

长期 target truth 则是：

- explicit freshness / live branch

因此：

- 本文描述当前已经合入的 planner-first knowledge retrieval truth
- `docs/architecture/system/agentic-retrieval-architecture.md` 继续描述 forward target
  里尚未对产品 surface 打开的 freshness/live branch
- 不得把 `live_assisted` 等 deferred branch 冒充成当前默认 product opening

## Current Retrieval Pipeline

knowledge-family 内部的 retrieval path 固定拆成：

`query framing -> scope / version admission -> retrieval planning -> multi-step
execution -> rerank / merge / dedupe -> evidence shaping`

owner 分层固定为：

- agent：query framing、ambiguity handling、surface / entity / version planning
- retrieval-core：step execution、fusion、merge / dedupe、evidence shaping
- registry / serving profile：version / visibility / serving scope truth

## Target Relation To Agentic Retrieval

target pipeline 固定升级为：

`durable RunStep(planning) -> typed retrieval/domain tools -> retrieval-core
execution -> rerank / merge / dedupe -> evidence coverage verify -> supporting
evidence selection -> synthesis -> grounding`

补充约束：

- planner-first target 不改变 serving truth owner
- retrieval-core 仍不拥有产品级 capability admission
- live branch 只允许进入 admitted source channel
- synthesis 不得补齐 missing retrieval/tool result；evidence verifier 决定 replan /
  clarification / fail-close

## Serving Policy

serving truth 不写死在 Execution Agent Layer、API shell 或 env 默认值里。

它由以下信息共同决定：

- collection runtime profile
- serving alias / release manifest
- current query-enabled scope
- explicit authz projection

## Incremental RAG Release Lane

对 regulation、official web stable reference、curriculum 等 canonical document scope，RAG
更新长期不通过 query-time live fetch 或文档站 publish side effect 完成，而通过独立 release lane
完成。

固定 lifecycle：

- `rag_release_candidate`
- `candidate batch`
- `release admission`
- `chunk/index release`
- `retrieval acceptance`
- `serving alias publish`
- `post-publish audit`

固定规则：

- canonical document materialization、reader asset publish 与 RAG release candidate
  creation 可以在同一上游 admission 后触发，但三者 status 必须分离
- `pending` candidate 只说明 canonical document 发生了可索引变更；它不是 query-serving
  证据，也不能被 runtime retrieval 直接消费
- release lane 不做正文清洗；regulation canonical markdown / document-units 必须已在
  ingestion materialization 阶段完成清洗并带 provenance。缺失当前
  normalizer / cleaning policy / quality passed 证据时，candidate 必须落入 preparation
  failure，不得 index 或 publish alias
- 对 query-enabled regulation scope，chunk/index release 前必须存在
  `regulation_rag_release_admission.v1` scope-level manifest。manifest 必须精确绑定
  `document_id`、`revision_track`、`version_id`、`content_hash`、
  `document_units_object_key`、`document_units_sha256`、`cleaning_policy_version`、
  `chunk_profile_version`、runtime profile identity 与 reader current version id。
  缺失或不匹配时，candidate 必须进入 `release_admission_blocked`，不得调用 chunk
  preparation、embedding、index release 或 alias publish。
- `release_admission_blocked` 是 fail-closed terminal status，用来表示 canonical
  已变更但 release 证据不完整；它不是 preparation failure，也不能被 worker 自动降级为
  search-only。
- release executor 的成功结果必须携带 admission manifest proof；candidate processor
  在写入 `serving_published` 前必须再次确认 proof，避免自定义 executor 或直接 CLI
  绕过 admission gate。
- 对早于当前 cleaner 的 historical regulation artifacts，RAG release 不做就地修补；
  这些 document 必须先经过 ingestion canonical backfill，产出当前 provenance 后才能被
  release lane 继续处理
- periodic worker 处理 pending candidates，可以小批量运行；nightly reconciliation 负责发现
  missed changed / withdrawn / deleted documents
- selected worker 入口可以按 `candidate_id` 处理人工挑选的 pending candidates；scheduled
  入口默认扫描 pending candidates，但仍必须遵守 runtime profile 的 retrieval/query enablement
  gate
- `regulations/scoped_rules` 这类院级/专项 regulation holding collection 当前必须停在
  canonical/chunk-only non-serving；不得进入 RAG release candidate、不得调用 index release
  executor，也不得作为 document-site read-model scope 发布
- incremental decision 必须使用 document identity、document version/hash、chunk
  profile identity、embedding/runtime profile identity 与 visibility/authz carrier；
  profile 变化必须让旧 candidate / cache 失效
- unchanged document 可以跳过 re-embedding，但 release manifest 必须仍能解释 skip reason
  与被复用的 prior release / point provenance
- changed document 使用 upsert/new release plan；withdrawn/deleted document 使用 explicit
  delete/tombstone plan；no-longer-current historical / search-only document 如果不是
  withdrawn/deleted，必须进入 `held_search_only` 等 non-serving terminal status，不得误触
  current alias cleanup
- release acceptance 通过前，只能写 candidate/run status；不得切换 serving alias 或扩大
  runtime profile allowlist
- 发现已切换 alias 但缺少 matching release admission manifest 的 query-enabled
  regulation release 时，必须执行 containment：仅当 alias 当前仍指向指定 suspect
  physical collection 时才允许 unpublish/rollback，防止误伤后续已修复 release。
- alias publish 后必须执行 drift guard 与 payload/index audit；失败时进入 repair backlog，
  并保留可回滚 current pointer

operator-facing status 必须拆开表达：

- `documentSiteStatus`
- `ragPreparationStatus`
- `ragIndexStatus`
- `ragServingStatus`
- `ragVerificationStatus`

这些状态可以从 ingestion/app-api projection 聚合展示，但 retrieval serving truth 仍由 release
manifest、current pointer 与 runtime profile 决定。

## Release Safety And Tuning

query-enabled collection 的 release / serving hardening 固定包含以下层次：

- alias publish 前的 deterministic retrieval acceptance gate
- alias publish 前的 chunk quality gate；缺 traceability metadata、超过当前
  collection/profile chunk token budget、出现不可直接 query-serving 的 attachment-ref chunk
  或 regulation heading-only chunk 时，query-serving publish fail closed
- 对 query-serving regulation-family release，chunk quality gate 同时要求
  answer-ready evidence contract 通过。缺少 `answer_role`、`parent_unit_id`、
  `evidence_contract_version`、judgment evidence 的 `condition_subject`、procedure
  evidence 的 typed step fields、category overview 的 member ids / titles 时，
  release admission 必须 fail closed，并在 release manifest / quality summary 中记录
  `answer_ready_contract_status`
- alias publish 前的 qrels coverage gate；默认 query-enabled scope 必须有 declared scenario
  denominator，缺 fixture、缺 required class 或缺 required scenario 都 fail closed
- release manifest / point payload 中的 dense、sparse、hybrid、chunk、cleaning、
  query instruction provenance、profile identity hash、显式 reranker opt-in provenance，以及
  quality gate / chunk quality / qrels coverage / release metadata consistency status
- runtime 查询 alias 前的 release drift guard；profile / release metadata 不一致或 sampled
  point payload 混入不同 release/profile metadata 时 fail closed；guard cache key 必须包含
  collection 与 profile identity，profile 变更不得复用旧 guard 结果
- 发布后 audit 必须检查 query-time filter 字段的 Qdrant payload indexes；缺
  `document_id` / `version_id` / authz / visibility / current-version 等必要 index
  或 schema 不匹配时，post-publish audit fail closed
- payload indexes 必须在 collection 创建后、points upsert 前建立；filterable HNSW
  不应等到 points 写入后才补建
- `packages/evals` 持有的 per-collection qrels scenario denominator、retrieval tuning
  report、deterministic rerank branch report 与 sanitized runtime observation
  backlog intake

固定规则：

- qrels / tuning runner 只生成 deterministic evidence 与 `recommended_profile_patch`
- tuning 不自动修改 `runtime-profile.json`
- tuning 不扩大 query-enabled scope
- reranker 不作为全局默认；只有 collection runtime profile 显式 opt-in，且 deterministic
  adoption gate 同时满足 quality、latency、cost 与 regression 约束后，才能进入生产候选
- reranker runtime 失败、超时或 executor 缺失时必须 fail closed，并写入
  `failure_kind=reranker_failed` 的 observation；不得返回 baseline hybrid/RRF
  candidate order 伪装成功
- supplemental judge / RAGAS 指标只能做诊断，不作为 alias publish 或 profile patch 的唯一通过依据
- runtime retrieval 可以把 request/step outcome 发给显式注入的 observation sink；observation
  只作为 eval/backlog intake，不反向改变 release manifest、runtime profile 或 serving alias
- observation sink 是显式配置的 runtime intake；sink 写入失败表示观测链路配置或存储不满足
  contract，retrieval answer path 必须 fail closed 并暴露该诊断
- sanitized runtime observation 默认不写入原始 query text，只写 `query_sha256`；只有显式
  operator 调试开关打开时，才允许把 query text 写入 JSONL observation
- indexed lookup backend fail-closed exception 必须在重新抛出前写入 sanitized failed
  observation；release metadata drift 必须保留可分类的 failure kind，供 monitoring backlog
  归入 release repair 而不是普通 no-hit
- 对 query-enabled regulation target alias，retrieval runtime 还必须显式区分两条内部路径：
  - `target_v3_only`：默认 target serving 路径；如果命中的 answer-bearing source 缺少
    `answer_ready_evidence.v3` 必需 contract 字段，runtime 必须 fail closed，不得继续当作成功
    grounding
  - `legacy_old_index_compatibility`：仅供 old-index compatibility/历史诊断/受控测试使用；
    可以继续报告 `missing_contract` diagnostics，但这些结果不得计入 target release
    completion、component-eval target pass 或 serving adoption truth
- production observation 集成边界固定在 runtime adapter，不进入 `packages/retrieval-core`：
  retrieval-core 只暴露 `RetrievalObservationSink` /
  `build_retrieval_observation_event_sink()` 这种注入 seam；online path 由 Go
  `activity-worker-knowledge` / `execution-control` runtime adapter 负责把
  `retrieval.runtime_observation` 转成 OTel-compatible log/event、derived metrics 或
  backend-specific export。Python bridge 只允许保留 offline / eval / historical sink。
- OTel bridge 的默认映射是 log/event first：event name
  `retrieval.runtime_observation`，attributes 至少包含 `request_id`、`plan_id`、`step_id`、
  `scope.corpus`、`scope.collection`、`query_mode`、`retrieval_mode`、`terminal_state`、
  `failure_kind`、`candidate_count`、`reference_count`、`latency_ms`、`query_sha256`；有
  trace context 时附带 trace/span correlation，没有 trace context 时仍以 `request_id`
  做跨组件关联
- metrics 从 observation 派生，不要求 retrieval-core 直接发 metrics：request count、
  latency histogram、no-hit / low-confidence / forbidden-hit count、release metadata
  drift count、reranker failed count、live-assisted count 都应由 runtime adapter 或
  Collector/backend 聚合
- OTel Collector 只作为可替换 telemetry pipeline：接收 OTLP logs/metrics/traces，经
  memory/batch/filter/attribute processors 做限流、批处理、脱敏和资源属性补齐，再 export
  到实际 backend；Collector/exporter 配置不得反向成为 retrieval serving contract
- projection-derived scope 如果没有静态 `split-manifest.v1.json`，可以使用同目录
  `retrieval-eval-manifest.v1.json` 作为 qrels anchoring manifest；它不替代 registry、
  release manifest 或 current pointer truth

## Filter Layers

当前与长期都保留以下过滤层：

- serving-surface filter
- version-selection filter
- authz / visibility filter
- collection / entity / family filter

`major`、`cohort`、`program`、recent goal 等 personalization signal 只允许影响
applicability / preference / clarification，不得静默改写 visibility truth。

长期 target 里，这些 filter 仍然必须：

- 在 planner 阶段决定是否允许生成某类 step
- 在 executor 阶段继续做 step-level enforcement

## Versioned Serving Model

长期查询模型固定拆成：

- `current`
- `historical`
- `as_of`
- `compare`
- `freshness_sensitive`
- `live_assisted`

长期硬约束：

- 版本选择发生在 retrieval 之前
- 普通 query-serving 默认只查当前有效版本
- 历史版本查询必须显式化
- 多来源等价内容归并为一个逻辑 document version

## Merged Truth Vs Target Boundary

当前已经具备：

- 默认只服务当前有效版本
- explicit `current` / `historical` / `as_of` / `compare` query mode
- 多来源等价内容归并
- planner-first agentic retrieval
- service-level `freshness_sensitive` / `live_assisted` admission seam；live
  lookup 必须通过 explicit query mode、source-trust policy、runtime profile 与
  live lookup budget
- live evidence 标注 `retrieval_mode=live_assisted`、`as_of` 与
  `canonical_index_truth=false`，runtime observation 同步记录 query/retrieval mode

当前尚未完成：

- product-facing freshness/live tool opening
- real live source executor 与 production observation storage rollout

这些属于目标架构的一部分，而不是当前默认 surface；当前 active/deferred execution 仍以
`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`、对应 workstream `STATE.md` 与相关
plan 为准。

## Course Facts Internal Surface

`curriculum/course_facts` 的长期定位保持为：

- agent-internal retrieval surface
- 用于课程 / 课程族实体与 alias governance
- 不自动提升成默认公开 query-serving collection

## Program Family Facts Internal Surface

`curriculum/program_family_facts` 的长期定位保持为：

- agent-internal retrieval surface
- 用于培养方案家族 membership / alias resolution
- 不自动提升成默认公开 query-serving collection

## Program Semester Facts Internal Surface

`curriculum/program_semester_facts` 的长期定位保持为：

- agent-internal retrieval surface
- 用于 resolved single-program + single-semester 课程清单问句
- 上游 truth 来自 canonical `curriculum_plan document-units` 的派生物化，而不是 raw/source
  bucket replay
- 不自动提升成默认公开 query-serving collection

## Structured Runtime Internal Surfaces

部分 runtime capability 长期不走 generic retrieval surface，而走 projection-backed
structured query seam。

当前已冻结方向包括：

- campus services family
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - later-wave `contact_directory_lookup`
  - later-wave `service_process_lookup`
  - 这些 structured runtime seam 的领域边界、projection owner 与 fail-close 规则统一看
    `docs/architecture/domains/campus-services/architecture.md`
- notice family
  - `campus_notice_discover`
  - internal selected notice resolve with `payload_kind=campus_notice_get`
  - 继续区分 public `official_web` notice family 与 restricted `internal_notice`
    notice family

固定约束：

- 这些 internal query surfaces 可以是 runtime-admitted structured seam，但不因此自动成为默认公开
  query-enabled collection
- future internal query service 只读 projection / normalized truth，不读
  query-disabled retrieval alias
- structured runtime surface 与 `fresh_news` 一类 retrieval surface 可以并存，但不能互相冒充
- structured campus-services runtime 不回退成 `service_catalog` reopening、generic
  retrieval alias 或 raw source scan
- 在长期 multi-capability / agent-as-tool workflow 中，structured runtime surface
  可以向 `knowledge` 提供 bounded context projection，例如 notice context、
  service facts、schedule baseline 或 place context；这些 projection 只能辅助
  retrieval framing / grounding validation，
  不改变 query-serving collection allowlist，也不绕过 authz / freshness / source-trust gate

## Forbidden Shapes

- 不把 serving surface 写死在 Execution Agent Layer 或 entry shell
- 不让 retrieval backend 自行猜测用户是不是要查历史版本
- 不把历史版本先全量检索再由回答层事后丢弃
- 不把 alias / family resolution 静默下沉成 retrieval backend 的黑盒字符串替换
- 不把 recent/latest 一类问法继续压成普通 current retrieval
- 不把 general web fallback 混入 campus retrieval 主路径

## 相关稳定文档

- `docs/architecture/current-architecture.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/domains/campus-services/architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `docs/decisions/adr-0021-institution-scoped-entity-alias-governance.md`
- `docs/reference/runtime-serving-and-index-terms.md`
