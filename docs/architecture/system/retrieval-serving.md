---
doc_type: architecture
truth_scope: execution
owner_boundary: retrieval-runtime-seam
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
  `docs/architecture/current.md` 为准
- 顶层 tool routing 与 surface tool policy 不在本文维护；统一看
  `docs/architecture/system/tool-routing.md`
- 本文负责解释 retrieval / serving 模型、internal surface 类别与长期版本查询边界，不维护 phase 顺序或
  rollout closeout
- durable typed-tool retrieval graph 的 target truth 另见
  `docs/architecture/system/agentic-retrieval.md`

## Knowledge Query Position

本文只描述 tool routing 已进入 `knowledge_query` path 之后的 retrieval / serving
truth。

固定规则：

- 顶层产品入口不先判 retrieval `scope`
- 只有当 Execution Agent Layer 已把请求路由到 `knowledge_query` path 后，`requested_scope`、version
  mode、retrieval planning 才开始成立
- `transport_schedule_lookup`、`campus_notice_discover`、internal selected notice
  resolve (`payload_kind=campus_notice_get`) 与 `place_lookup` 这类结构化 tool
  不应再被误读成 retrieval scope 的旁支；它们默认是 typed domain tools /
  projection-backed internal query service，只有需要语义 specialist 时才进入
  agent-as-tool

## Accepted Retrieval Model

当前 serving surface 由 serving config 显式控制。

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
- `app-api` knowledge request 显式开放 `current` / `historical` / `as_of` /
  `compare`，并支持经 query-serving scope policy admitted 的
  `freshness_sensitive` / `live_assisted`。fresh/live 不是普通查询默认路径，
  必须由显式 query mode / freshness intent / serving scope admission 打开。
- online RAG query embedding provider/model/API key/dimensions come from active
  app-api provider-config role `rag_query_embedding`; root `EMBEDDING_*` env is
  local/ingestion/eval seed, not online serving truth
- embedding model or dimension changes must pass release/vector compatibility
  before activation; query-time retrieval must fail closed on mismatch

这里的 `agent` 默认指 `knowledge_query` specialist，而不是顶层 tool router。

## Current Baseline Vs Target Agentic Retrieval

当前 merged truth 仍是：

- planner-first retrieval baseline
- typed retrieval plan + bounded replan execution
- query framing 后进入 admitted collection / version selection，再进入多步 retrieval
  execution
- retrieval trace 与 final supporting evidence 分层

当前代码路径同时包含：

- 本文描述当前已经合入的 planner-first knowledge retrieval truth
- `docs/architecture/system/agentic-retrieval.md` 继续描述 retrieval plan /
  step vocabulary 与 agentic retrieval 约束
- 不得把 `live_assisted` 等显式 admission branch 冒充成普通查询默认 product
  opening，也不得把它扩展成 general web browse

## Current Retrieval Pipeline

knowledge tool 内部的 retrieval path 固定拆成：

`query framing -> scope / version admission -> retrieval planning -> multi-step
execution -> rerank / merge / dedupe -> evidence shaping`

owner 分层固定为：

- `apps/execution-control` knowledge / RAG runtime：query framing、ambiguity handling、
  surface / entity / version planning、step execution、fusion、merge / dedupe 与
  evidence shaping
- registry / serving config：version / visibility / serving scope truth

## Target Relation To Agentic Retrieval

target pipeline 固定升级为：

`durable RunStep(planning) -> typed retrieval/domain tools -> retrieval runtime
execution -> rerank / merge / dedupe -> evidence coverage verify -> supporting
evidence selection -> synthesis -> grounding`

补充约束：

- planner-first target 不改变 serving truth owner
- retrieval runtime 仍不拥有产品级 tool admission
- live branch 只允许进入 admitted source channel
- synthesis 不得补齐 missing retrieval/tool result；evidence verifier 决定 replan /
  clarification / fail-close

## Serving Policy

serving truth 不写死在 Execution Agent Layer、API shell 或 env 默认值里。

它由以下信息共同决定：

- collection serving config
- serving alias / release manifest
- current query-enabled scope
- source / version / serving-config projection

visibility / scope policy 同样属于 serving config 与 admission projection：

- serving config 必须显式声明 `serving_visibility_levels`；如果包含
  `restricted`，还必须声明 `serving_visibility_scopes`
- online plan 必须携带来自 product admission 的 sanitized
  `retrieval_access` projection，包括 `policy_projection_version`、
  `visibility_level`，以及 restricted 查询所需的 `visibility_scope` /
  `entitlement_groups`
- Qdrant 查询层只计算 serving config policy 与 request access projection
  的交集；缺失 projection、缺失 serving config policy 或交集为空时 fail closed
- visibility / scope serving policy 不改变 chunking、embedding 或 vector payload
  identity；已有 alias 的 point payload 已携带正确 visibility 字段时，不得为这类
  filter policy 调整触发重新 embedding
- offline RAG eval 不绕过该 contract；qrels 可以通过 `request_overrides`
  表达 restricted/campus case 的同等 access projection

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
  `chunk_profile_version`、serving config identity 与 reader current version id。
  缺失或不匹配时，candidate 必须进入 `release_admission_blocked`，不得调用 chunk
  preparation、embedding、index release 或 alias publish。
- `release_admission_blocked` 是 fail-closed terminal status，用来表示 canonical
  已变更但 release 证据不完整；它不是 preparation failure，也不能被 worker 自动降级为
  search-only。
- release executor 的成功结果必须携带 admission manifest validation artifact；candidate processor
  在写入 `serving_published` 前必须再次确认 validation artifact，避免自定义 executor 或直接 CLI
  绕过 admission gate。
- 对早于当前 cleaner 的 historical regulation artifacts，RAG release 不做就地修补；
  这些 document 必须先经过 ingestion canonical backfill，产出当前 provenance 后才能被
  release lane 继续处理
- periodic worker 处理 pending candidates，可以小批量运行；nightly reconciliation 负责发现
  missed changed / withdrawn / deleted documents
- selected worker 入口可以按 `candidate_id` 处理人工挑选的 pending candidates；scheduled
  入口默认扫描 pending candidates，但仍必须遵守 serving config 的 retrieval/query enablement
  gate
- `regulations/scoped_rules` 这类院级/专项 regulation holding collection 当前必须停在
  canonical/chunk-only non-serving；不得进入 RAG release candidate、不得调用 index release
  executor，也不得作为 document-site read-model scope 发布
- incremental decision 必须使用 document identity、document version/hash、chunk
  profile identity、embedding provider identity、serving config identity 与 source/version carrier；
  serving config 变化必须让旧 candidate / cache 失效
- unchanged document 可以跳过 re-embedding，但 release manifest 必须仍能解释 skip reason
  与被复用的 prior release / point provenance
- changed document 使用 upsert/new release plan；withdrawn/deleted document 使用 explicit
  delete/tombstone plan；no-longer-current historical / search-only document 如果不是
  withdrawn/deleted，必须进入 `held_search_only` 等 non-serving terminal status，不得误触
  current alias cleanup
- release acceptance 通过前，只能写 candidate/run status；不得切换 serving alias 或扩大
  serving config allowlist
- 发现已切换 alias 但缺少 matching release admission manifest 的 query-enabled
  regulation release 时，必须执行 containment：仅当 alias 当前仍指向指定 suspect
  physical collection 时才允许 unpublish/rollback，防止误伤后续已修复 release。
- alias publish 后必须执行 drift guard 与 payload/index audit；失败时进入 repair queue，
  并保留可回滚 current pointer

operator-facing status 必须拆开表达：

- `documentSiteStatus`
- `ragPreparationStatus`
- `ragIndexStatus`
- `ragServingStatus`
- `ragVerificationStatus`

这些状态可以从 ingestion/app-api projection 聚合展示，但 retrieval serving truth 仍由 release
manifest、current pointer 与 serving config 决定。

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
  denominator，缺 qrels asset、缺 required class 或缺 required scenario 都 fail closed
- release manifest / point payload 中的 dense、sparse、hybrid、chunk、cleaning、
  query instruction provenance、serving config identity hash、显式 reranker opt-in provenance，以及
  quality gate / chunk quality / qrels coverage / release metadata consistency status
- runtime 查询 alias 前的 release drift guard；serving config / release metadata 不一致或 sampled
  point payload 混入不同 release / serving config metadata 时 fail closed；guard cache key 必须包含
  collection 与 serving config identity，serving config 变更不得复用旧 guard 结果
- 发布后 audit 必须检查 query-time filter 字段的 Qdrant payload indexes；缺
  `document_id` / `version_id` / source / current-version 等必要 index
  或 schema 不匹配时，post-publish audit fail closed
- payload indexes 必须在 collection 创建后、points upsert 前建立；filterable HNSW
  不应等到 points 写入后才补建
- repo-owned eval truth 持有的 per-collection qrels scenario denominator、retrieval
  tuning report、deterministic rerank branch report 与 sanitized runtime observation
  diagnostic intake；旧 `packages/evals` package 已退役，Langfuse-bound qrels 位于
  `packages/eval-langfuse/assets/qrels/rag`

固定规则：

- qrels / tuning runner 只生成 deterministic evidence 与 `recommended_serving_config_patch`
- tuning 不自动修改 `serving-config.json`
- tuning 不扩大 query-enabled scope
- reranker 不作为全局默认；只有 collection serving config 显式 opt-in，且 deterministic
  adoption gate 同时满足 quality、latency、cost 与 regression 约束后，才能进入生产候选
- reranker runtime 失败、超时或 executor 缺失时必须 fail closed，并写入
  `failure_kind=reranker_failed` 的 observation；不得返回 baseline hybrid/RRF
  candidate order 伪装成功
- supplemental judge / Ragas scores 只能作为 supplemental eval / diagnostic signal，不作为
  alias publish 或 serving config patch 的唯一通过依据
- runtime retrieval 可以把 request/step outcome 发给显式注入的 observation sink；observation
  只作为 eval/diagnostic intake，不反向改变 release manifest、serving config 或 serving alias
- observation sink 是显式配置的 runtime intake；sink 写入失败表示观测链路配置或存储不满足
  contract，retrieval answer path 必须 fail closed 并暴露该诊断
- sanitized runtime observation 默认不写入原始 query text，只写 `query_sha256`；只有显式
  operator 调试开关打开时，才允许把 query text 写入 JSONL observation
- indexed lookup backend fail-closed exception 必须在重新抛出前写入 sanitized failed
  observation；release metadata drift 必须保留可分类的 failure kind，供 monitoring diagnostics
  归入 release repair 而不是普通 no-hit
- 对 query-enabled regulation target alias，retrieval runtime 还必须显式区分两条内部路径：
  - `target_v3_only`：默认 target serving 路径；如果命中的 answer-bearing source 缺少
    `answer_ready_evidence.v3` 必需 contract 字段，runtime 必须 fail closed，不得继续当作成功
    grounding
  - `legacy_old_index_compatibility`：仅供 old-index historical diagnostic / controlled
    test 使用；
    可以继续报告 `missing_contract` diagnostics，但这些结果不得计入 target release
    completion、component-eval target pass 或 serving adoption truth
- production observation 集成边界固定在 runtime adapter，不进入 deleted Python
  retrieval package；retrieval runtime seam 只暴露 `RetrievalObservationSink` /
  `build_retrieval_observation_event_sink()` 这种注入 seam；online path 由 Go
  `activity-worker-knowledge` / `execution-control` runtime adapter 负责把
  `retrieval.runtime_observation` 转成 OTel-compatible log/event、derived metrics 或
  backend-specific export。Python handoff 只允许保留 offline / eval / historical sink。
- OTel bridge 的默认映射是 log/event first：event name
  `retrieval.runtime_observation`，attributes 至少包含 `request_id`、`plan_id`、`step_id`、
  `scope.corpus`、`scope.collection`、`query_mode`、`retrieval_mode`、`terminal_state`、
  `failure_kind`、`candidate_count`、`reference_count`、`latency_ms`、`query_sha256`；有
  trace context 时附带 trace/span correlation，没有 trace context 时仍以 `request_id`
  做跨组件关联
- metrics 从 observation 派生，不要求 retrieval runtime 直接发 metrics：request count、
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
- source / version / serving-config filter
- collection / entity / family filter

`major`、`cohort`、`program`、recent goal 等 personalization signal 只允许影响
applicability / preference / clarification，不得静默改写 source truth 或 tool
opening truth。

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

Merged truth 固定包含：

- 默认只服务当前有效版本；`current` 仍通过 query-time `is_current=true` 与 serving
  config filter 执行，不把整条 collection 误收敛为单个 current version id
- explicit `current` / `historical` / `as_of` / `compare` query mode；Go
  Temporal RAG 在 `rag.plan` 阶段解析 version query，`retrieval.indexed_lookup`
  只消费 resolved version projection，缺失或歧义时 fail closed
- `historical` / `as_of` / `compare` 的 indexed lookup 会在 Qdrant filter 层使用 resolved
  version id；`compare` 必须同时覆盖两侧版本证据，`as_of` 必须覆盖解析出的版本证据
- 多来源等价内容归并
- planner-first agentic retrieval
- supporting evidence selection 只允许 answer-bearing canonical reference 进入 synthesis；
  缺 `document_id`、`version_id`、`anchor`、root unit、`source_ref` 或不满足
  `source_trust_policy.minimum_tier` 时 fail closed
- `grounding.verify` 的 evidence-integrity verdict 是 RAG finalization 硬门禁；
  `finalization.write` 不接受未投影、ref 漂移或非 `supported` 的 grounding result
- `freshness_sensitive` / `live_assisted` 只在 query-serving scope policy 允许时
  admitted；`official_web/fresh_news` 需要显式 freshness intent
- fresh/live plan 生成 `freshness_gate` / `live_source_lookup` /
  `evidence_coverage_verify` / `supporting_evidence_select`，并由
  `retrieval.live_source_lookup` 执行 bounded official-web live lookup
- live lookup 复用 repo-owned `public_web_search` transport 与 sanitization，
  provider 层固定 domain filter 为 institution-owned official domains，不允许
  general web fallback
- live evidence 必须标注 `retrieval_mode=live_assisted`、`as_of`、
  `canonical_index_truth=false`、`source_policy_verdict` 与 source trust tier
- Go reranker executor；当前 serving config 开启 reranker 时仍 fail closed，不允许静默退化成未声明排序

这些能力不改变默认 serving surface：普通 current / historical / as_of / compare
仍走 indexed lookup；fresh/live 只有在显式 admission 后进入 live branch。

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

## Tool Read Model Internal Surfaces

部分 runtime tool 长期不走 generic retrieval surface，而走 projection-backed
tool read model seam。

当前已冻结方向包括：

- campus services family
  - `transport_schedule_lookup`
  - generic service status、service guide、contact directory、service process 与
    academic calendar 不属于当前 campus-services model-visible runtime surface
  - 这些 tool read model seam 的领域边界、projection owner 与 fail-close 规则统一看
    `docs/architecture/domains/campus-services/architecture.md`
- notice family
  - `campus_notice_discover`
  - internal selected notice resolve with `payload_kind=campus_notice_get`
  - 继续区分 public `official_web` notice family 与 authenticated-source `internal_notice`
    notice family

固定约束：

- 这些 internal query surfaces 可以是 runtime-admitted structured seam，但不因此自动成为默认公开
  query-enabled collection
- admitted internal query service 只读 projection / normalized truth，不读
  query-disabled retrieval alias
- tool read model surface 与 `fresh_news` 一类 retrieval surface 可以并存，但不能互相冒充
- structured campus-services runtime 不回退成 `service_catalog` reopening、generic
  retrieval alias 或 raw source scan
- 在长期 multi-tool / agent-as-tool workflow 中，tool read model surface
  可以向 `knowledge` 提供 bounded context projection，例如 notice context、
  service facts、schedule baseline 或 place context；这些 projection 只能辅助
  retrieval framing / grounding validation，
  不改变 query-serving collection allowlist，也不绕过 freshness / source-trust gate

## Forbidden Shapes

- 不把 serving surface 写死在 Execution Agent Layer 或 entry shell
- 不让 retrieval backend 自行猜测用户是不是要查历史版本
- 不把历史版本先全量检索再由回答层事后丢弃
- 不把 alias / family resolution 静默下沉成 retrieval backend 的黑盒字符串替换
- 不把 recent/latest 一类问法继续压成普通 current retrieval
- 不把 general web fallback 混入 campus retrieval 主路径

## 相关稳定文档

- `docs/architecture/current.md`
- `docs/architecture/system/tool-routing.md`
- `docs/architecture/system/agentic-retrieval.md`
- `docs/architecture/domains/campus-services/architecture.md`
- `docs/architecture/target.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `docs/decisions/adr-0021-institution-scoped-entity-alias-governance.md`
- `docs/reference/runtime-serving-and-index-terms.md`
