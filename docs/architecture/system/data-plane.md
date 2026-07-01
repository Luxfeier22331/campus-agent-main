---
doc_type: architecture
truth_scope: data
owner_boundary: ingestion-core
status: active
created: 2026-04-02
updated: 2026-06-30
---
# Data Plane Architecture

## 文档边界

本文冻结 repo 级 data plane / source-truth supporting architecture。

它回答的是：

- canonical upstream chain 是什么
- raw、source truth、projection、document truth、chunk/index 分别属于谁
- 哪些规则是 repo 级 shared contract，哪些属于 collection-specific strategy

补充约束：

- 当前 merged truth 的开放 surface 与产品执行状态不在本文维护，统一看
  `docs/architecture/current.md` 与 `.planning/`
- 本文中的 “scope” 指 canonical data-plane support 范围，不等于 query-enabled 或 rollout 已完成
- full agentic retrieval 的长期 target truth 另见
  `docs/architecture/system/agentic-retrieval.md`

## Canonical Chain

repo 级 canonical data-plane chain 固定为：

`raw asset -> provider output -> source truth -> declared projections ->
canonical document artifacts -> document-units -> chunks -> index`

这条链路适用于：

- institutional document OCR ingestion
- `official_web` source channel
- 其他后续 source-shared collection / corpus

source-channel collector 到 canonical data-plane 的 clean runtime chain 固定为：

```text
source-channel collector
-> S3-compatible source bucket artifact pack + run ledger
   + source-channel task input refs
-> app-api product/operator admission when a product control plane is required
-> ingestion-control-api task admission with object-store input refs
-> ingestion-control-executor claim / lease / registry-aware execute / closeout
-> source truth / projection / document / release artifacts
-> app-api / execution-control / operator-safe projection consumers
```

collector 只能把外部 source 转换成可审计 artifact pack、run ledger 与
source-channel input refs。需要 capture-release handoff object 的来源必须把它建模成
typed object-store task input；不需要 handoff object 的来源（例如
`official_web_source_truth_bundle.v1`）不得额外引入 terminal handoff wrapper。collector
不拥有 source-truth mutation、document registry、chunk/index release 或 Qdrant alias
publish。`apps/app-api` 可以拥有 product/operator control-plane seam，但不因此成为
ingestion executor。

`ingestion-control-api` 与 `ingestion-control-executor` 是自部署
`apps/ingestion-control` 的两个 runtime role。前者是 HTTP control-plane service；
后者是后台 executor worker process。这里的 worker 不表示 Cloudflare Worker，也不得
把 ingestion lifecycle 藏进 `apps/app-api` 或 collector 进程。

学校或来源差异必须停在 source adapter 层。repo 当前目标是 fork-friendly source adapter
boundary，而不是 plugin 平台：自部署 fork 可以替换自己的 collector adapter，但应保持
source bucket artifact pack、source-channel typed task input object、
ingestion-control task envelope 与 canonical source-truth contract 不变。

## Qdrant Private Data-Plane Posture

Qdrant 是 data-plane index substrate，不是 product/API surface。当前 staging /
production posture 固定为 `self-hosted authenticated private data-plane`：

- `QDRANT_API_KEY` / `QDRANT_READ_ONLY_API_KEY` 必须保留为 private data-plane
  secrets；本地部署不等于无认证部署
- online execution runtime 只接收 read-only `QDRANT_QUERY_API_KEY`，ingestion /
  backup / restore 才使用 admin `QDRANT_API_KEY`
- execution-control personal memory 不再接入 Qdrant write path；个人记忆写入由 Hindsight
  runtime 承担
- `QDRANT_URL` 指向 Docker data-plane / private network endpoint，不作为 browser、
  panel、docs、chat 或 public smoke endpoint
- 同一 self-host substrate / compose network 内的 `QDRANT_URL` 默认使用
  `http://qdrant:6333`。跨 substrate、公网入口或 machine ingress 必须使用 HTTPS，并配置
  `QDRANT_TLS_CA_CERT_PATH`；外部 `api_key + http://` warning 代表不合格 data-plane
  transport。
- Qdrant collection / alias lifecycle 继续由 ingestion release 管理；online retrieval
  只消费已发布 alias / runtime profile，不直接把 Qdrant physical collection 名提升为
  product truth

## Personal Memory Data Plane

Personal memory 不再使用 self-hosted Qdrant collection。个人记忆 data plane 是 Hindsight
self-host runtime；Qdrant 只承载 institutional RAG / retrieval data plane。

固定边界：

- personal memory graph、retain / recall / reflect、async operation status 与
  institutional RAG collection 隔离
- online recall 使用 `PERSONAL_MEMORY_BASE_URL` / `PERSONAL_MEMORY_API_SECRET`
- explicit profile memory upsert / disable / owner disable / RTBF 通过
  execution-control internal Hindsight command 完成
- staging / production 必须使用 HTTPS Hindsight endpoint；local dev 可使用 compose 内网
  `http://hindsight-api:8888`
- Hindsight API、Hindsight worker、Postgres / pgvector、operation records 与 provider
  配置是 Hindsight runtime 内部组件，不是
  `campus-agent` data-plane contract
- payload contract 由 `docs/architecture/system/memory-plane.md` 维护，不由
  institutional RAG release manifest 维护

personal memory projection 只允许保存 compact text、routing metadata 和 internal
`episode_uuid` ref；不得保存 raw transcript、raw profile DB row、raw provider response、
auth material 或 unrestricted private notes。

## Relation To Agentic Retrieval Target

长期如果推进 planner-first / live-assisted retrieval，repo 的 canonical data-plane chain
仍不改变。

固定解释：

- planner / executor / query activity 属于 online retrieval architecture，不重写
  canonical chain
- canonical document truth 仍沿 `source truth -> document artifacts ->
  document-units -> chunks -> index`
- live-assisted retrieval 如果被 admission，也只是这条 canonical chain 外围的一条 bounded
  query-time adjunct

因此：

- agentic retrieval 不等于“把 online plan state 写回 source truth”
- planner 不能因为需要 live/fresh branch，就跳过 canonical document/source-truth boundary

## Source-Truth Rules

source truth 的长期硬约束：

- source truth 是 provider-agnostic shared upstream
- 一份 raw source asset 只生成一份 canonical source truth
- 一份 source truth 可以 fan-out 到多份 projection / collection / corpus
- source truth 不提前携带 document / chunk / retrieval 语义
- 后续 replay / rebuild 从 source truth 继续，而不是返回 raw 重消费

不同 `source_channel` 可以拥有各自的 source-specific contract 与 canonical source
unit，只要不破坏这条 shared chain。

当前已接受的 source-specific contract 包括：

- `official_web` page-level source truth，详见
  `docs/data/official-web.md`
- `authenticated_notice_portal` notice-level source truth，详见
  `docs/data/authenticated-notice.md`

这不表示它们都已进入当前 merged truth；当前已落地范围仍以下文 `Accepted Data-Plane Scope` 为准。

## Target Runtime Ownership And Language Boundaries

长期 ingestion/data-plane runtime 采用控制面、执行壳、deterministic kernel 与 provider /
domain adapter 分层，而不是把当前 Python ingestion scripts 扩成目标 runtime。

目标任务生命周期固定为：

```text
admit
-> register
-> claim / lease
-> execute
-> materialize
-> validate
-> publish
-> closeout or dead-letter
```

固定 owner：

- `apps/app-api` 只拥有 product/operator ingress、operator-safe projection read model
  与 release gate command；不拥有 ingestion task admission、executor state mutation、
  executor callback、source truth write、document/index materialization 或 Qdrant alias
  publish。
- ingestion control plane 以自部署服务运行，不是 Cloudflare Worker。它可以由同一
  package / image 提供 `ingestion-control-api` 与 `ingestion-control-executor` 两个
  runtime role，但 API surface 与后台 executor worker process 必须作为不同进程部署和扩缩。
- `ingestion-control-api` 拥有 task admission、task registry validation、
  idempotency、operator-safe projection read model 与 ready / metrics surface。
- `ingestion-control-executor` 拥有 claim / lease、retry / dead-letter、
  registry-aware executor dispatch、run shard batch state、telemetry closeout 与
  redacted operator projection snapshot。
- `apps/ingestion-control` 的 executor role 是 durable dispatch shell；它消费
  已 admission 的 task，按 registry 中的 `ts_control` / `rust_kernel` executor kind
  调用 TS handlers 或 deterministic kernels，并把 terminal outcome 暴露为可诊断
  closeout。缺失 handler / kernel 必须 fail closed。
- `ts_control` handler 是默认 materialization owner；source-specific artifact resolver、
  source-truth materialization、canonical document materialization、structured projection
  publish、operator projection snapshot 与 alias publish 只有在真实 handler 已存在时才进入
  registry。未实现的生命周期步骤留在设计文档或 backlog；默认 closeout skeleton 不代表
  collection migration complete。
- `apps/ingestion-worker` 只保留 Python adapter island；它不拥有 collection lifecycle、
  release / alias publish、Qdrant ops 或 source-channel queue consumer。
- `packages/ingestion-core` 继续拥有 canonical source-truth、materialization strategy、
  shared file asset loader 与 collection strategy；task lifecycle 不再由 Python collection
  CLI 或 worker facade 定义。
- Rust 只承接 profiling 已证明值得下沉的 deterministic batch kernels，例如 JSONL
  streaming、document-units validation、chunk packing、hash / dedup / diff、release
  manifest validation 与 embedding batch input preparation；Rust kernel 不拥有
  source-channel semantics、operator workflow 或 provider adapter contract。
- Python 只承接 MinerU / OCR / ML / domain extraction adapters、offline eval 与
  historical tooling；Python adapter 产物必须回到 canonical source truth /
  document artifact / projection contract 后才能被下游消费。
- Python 不拥有默认 Postgres connection runtime。Python data-plane code 只能保留连接
  URL validation / normalization、SQL shape test 与显式隔离 adapter；registry /
  projection 的实际数据库 mutation owner 必须回到 TS/Go runtime 或重新 admission 的
  adapter boundary。
- Python 不拥有默认 tokenizer / LlamaIndex runtime。Qwen3 chunk budgeting 使用本地
  `tokenizer.json` + Hugging Face `tokenizers`，不得回退到 Python `transformers`
  runtime 或联网下载；embedding / chunk node seam 使用 repo-owned protocol / DTO。
- Python Qdrant client、S3-compatible object-store client 与 index / audit mutation
  仍是待迁移残留，只能维持已有 ingestion data-plane 测试覆盖的 legacy 路径；新工作不得继续把
  collection lifecycle、alias publish、object-store runtime client creation 或 audit
  closeout 扩建在 Python 默认路径上。
- 学校特定 collector adapter 可以使用 TS、Python 或其他 repo-approved runtime
  实现采集，但它的唯一 data-plane handoff 是 source bucket artifact pack 和
  capture-release object；不能因语言或部署便利绕过 ingestion-control。

`provider_response_replay` 只能作为 historical bootstrap、local rebuild、audit 或
diagnostic input。长期 rebuild / replay 的主路径必须从 canonical source truth、
canonical document artifacts 或 `document-units` 继续，不得把 provider response
或 raw asset replay 提升为 canonical rebuild owner。

## Staged Clean Path

repo 级 ingestion 清理采用 staged clean path，而不是 conservative wrapper path。

阶段顺序固定为：

1. **Freeze contracts**：先冻结 source unit、source bucket layout、input/output
   contracts、operator projection boundary 与 forbidden shapes。task registry 只声明
   default runtime 已能执行的 handler / kernel。
2. **Build real execution entries**：每个迁移 collection 至少落地一个真实
   `ts_control` handler 或 Rust kernel bridge，读取 object-store input，产出 contract
   artifact，并由 ingestion-control 完成 claim / lease / closeout。
3. **Prove Rust kernels**：只把 output equivalence 与 profiling 都证明成立的
   deterministic file-level work 下沉到 Rust。
4. **Shrink Python to adapters**：Python 仅作为 MinerU / OCR / ML / legacy Office /
   domain extraction adapter；adapter 输出必须回到 source-truth、document artifact 或
   projection contract。
5. **Delete old lifecycle**：TS/Rust handler 覆盖当前生产能力后，删除旧 Python import /
   closeout / replay / repair / smoke CLI 与 runbook executable path。

阶段门槛：

- collection task registry 必须对应 default runtime 已实现的 handler / kernel bridge；
  registry 存在本身不能证明 collection migration complete。
- 旧 Python CLI 不迁入 registry/executor seam；仍需要的 tool 必须按 TS/Rust target
  runtime 或 Python adapter 重新建模。
- `input_ref.kind=inline` 不得作为 source-channel collector run 或 source-truth
  materialization 的主输入；mainline handoff 必须是 source bucket `object_store` refs。
- 双路径只允许在有明确外部迁移约束时短期存在；默认不新增 fallback、兼容 shim 或
  silent replay path。

## Shared File-Asset Loader Boundary

对 file-like asset，repo 级 data plane 固定允许插入一条 shared subchain：

`source-truth relation or file descriptor -> optional normalization ->
extraction/provider artifacts -> terminal outcome or canonical child document
artifacts`

固定规则：

- 这条 subchain 不改变 repo 的 canonical chain，只是把 file-like asset handling 从
  source-specific path 收口成 shared contract
- source unit 继续由 source channel 定义；`official_web` 仍是 page-level
  source-truth，`authenticated_notice_portal` 仍是 notice-level source-truth
- shared file asset loader 的 canonical owner 固定为 `packages/ingestion-core`
- legacy binary Office、modern OOXML、PDF、image 的 admitted family 与 deployment
  posture 固定看 `docs/architecture/system/file-asset-loader.md`
- remote API 与 self-hosted service 都只是 shared contract 下的 deployment mode，不构成新的
  data-plane layer

## Live-Assisted Evidence Boundary

对已经 admission 的 source channel，repo 级 data plane 长期允许存在一条 bounded query-time
adjunct：

`source channel live fetch or remote observation -> bounded normalization ->
live evidence record -> query-time candidate`

固定规则：

- 这条 adjunct 不替代 canonical chain
- 它默认不直接写入 canonical source truth、document registry、release manifest 或 serving
  alias
- 只有被 repo admission 的 source channel 才允许产出 live evidence
- live evidence 是否能成为 answer-bearing evidence，仍取决于 freshness gate、source-trust
  gate 与 tool policy
- 若后续要把 live evidence 升格为 canonical content，必须重新回到 source-truth /
  document-materialization 路径，而不是把 query-time record 原地改写成 canonical truth

## Regulation Canonical Cleaning Boundary

对 authenticated-notice 派生的 regulation target，清洗固定属于 ingestion data plane 的
canonical materialization 阶段，而不是 document site publish、chunk preparation 或 RAG
release 阶段。

固定规则：

- source truth / owner text 保留原始可追溯语义；清洗后的正式消费产物是 target
  canonical markdown 与 document-units
- materialization 必须在写入 registry 前完成 wrapper removal、page artifact removal、
  OCR soft-wrap repair 与中文可读性标点归一，并产出 normalization quality/provenance
- document-units metadata 必须携带 `normalizer_version`、`cleaning_policy_version`、
  `document_units_schema_version` 与 `normalization_quality`
- 非 `passed` 的 normalization quality 不得写入 selected source materialization；需要回到
  manual review / owner recovery / cleaner hardening
- 下游 reader publish 与 RAG release 只能消费 registry 指向的 canonical artifacts /
  document-units，不允许在下游重新修正文

历史 regulation notice 的修复同样必须回到 canonical materialization：已采集但早于当前
cleaner 的 Phase 9 / Phase 11 selected cohort 不能由 chunk/RAG/document-site 层临时清洗；
应通过 selected canonical backfill 从 admission/source owner text 重新生成 canonical
markdown 与 document-units，再进入 reader publish 或 RAG release。backfill 本身只更新
canonical artifacts / registry truth，不打开 query serving、RAG release alias 或 public
citation。

历史 regulation denominator 扩面时，校级/院级边界必须在 data plane 中显式保留：
`regulations/institutional_rules` 是唯一可在后续显式 gate 中进入 document-site/RAG
consumption 的 regulation target；`regulations/scoped_rules` 只允许生成
canonical/document-units/chunk-only audit evidence，不进入 document-site read-model、RAG
release candidate、embedding/index 或 serving alias。

## Offline Release Task Boundary

对于 `official_web` 这类需要从 preview / candidate 推进到 current read model 的 source channel，
release task state machine 固定属于 ingestion data plane。

固定规则：

- `apps/ingestion-control` 定义并执行 release task lifecycle：claim / lease /
  retry / dead-letter / publish 状态语义，以及 operator-safe projection snapshot closeout
- registry-aware executor 读取对象存储 source-truth bundle，产出 canonical projection 或
  document/index release，并在状态变化后上报 redacted projection snapshot
- `apps/app-api` 不拥有 release task admission、executor read、executor callback
  或 selected-write task 状态；它只暴露已经入库的 operator projections、
  collector command ingress，以及 stable-reference operator approve/reject command
  ledger；它可以接收 ingestion-control 的 operator-safe release task projection
  snapshot，用于 panel 只读展示
- Panel 只能消费 app-api/operator projection 或未来 ingestion 投影，不直接调用
  release task mutation route

`calendar/academic_calendar` 当前是 ingestion-owned offline data asset /
preparation scope：官方网页 one-time source-pack 可以提供校历网页/图片 source
evidence，但当前不开放 `academic_calendar_lookup` runtime tool，也不打开 RAG
query-serving alias。该 projection 的 read-model record 必须显式区分
`teaching_week`、`named_event`、`term_window` 与 `class_day_override`；
命名事件区间内部使用 start-inclusive / end-exclusive，同时保留面向用户的
display start/end 日期与 source title/url。

## Derived Collection Rebuild

当某个 collection 的上游已经不是 raw/source-truth，而是另一条 canonical document scope 的
`document-units` 时，固定规则为：

- materialization / rebuild 从 canonical `document-units` 开始，不返回 raw source
  bucket 或 provider replay
- 派生 collection 仍要把自己的 canonical document artifacts、registry rows 与 release
  manifest 独立落盘
- 派生 collection 的 indexing / alias publish 继续走 release-managed registry scope 流程

当前已接受实例：

- `curriculum/curriculum_plan -> curriculum/program_semester_facts`

## Published Reader Assets

对已 admission 的 canonical docs site，repo 级 data plane 允许从 canonical document
artifacts 派生一条 product-delivery 子链：

`canonical document artifacts -> reader projection -> published reader assets`

固定规则：

- published reader assets 属于 derived artifact，不改变 canonical chain
- 长期真相继续落在对象存储，而不是 repo tracked `assets/` 目录
- public docs deploy 只把公开子集同步到 Worker static assets
- gated reader asset 如果未来另行接受，不得因为采用同一 payload format 就自动进入匿名 public bundle

reader asset package / object key / deploy sync 细节统一看
`docs/contracts/document-reader-publish.md`。

## RAG Release Candidate Lane

对已 admission 的 retrieval-backed canonical scope，repo 级 data plane 允许从 canonical
document artifacts 派生一条独立 RAG release 子链：

`canonical document artifacts -> document-units -> chunks -> embedding/index ->
retrieval acceptance -> serving alias publish`

固定规则：

- RAG release lane 属于 chunk/index/retrieval serving truth，不改变 source-truth 或
  document registry truth
- canonical document materialization 只能产生 `rag_release_candidate`；candidate 不是
  query-serving alias，也不表示 runtime 已可检索
- `rag_release_candidate` 持久 store 是 ingestion data-plane owned operator store；
  production materialization 只有在显式注入 store 或配置 candidate store Postgres URL 时
  才入队，避免无 operator store 的本地/fixture replay 被隐式升级为发布流程
- reader publish lane 与 RAG release lane 可以共享 canonical document provenance，但必须保留
  独立 status、artifact、manifest 与 verification truth
- periodic worker 可以批量处理 pending candidates；worker 只能读取 canonical document
  artifacts / document-units 与 release profile，不回扫 raw/source bucket
- 对 regulation scope，worker 必须校验 canonical cleaning provenance；缺失当前
  `normalizer_version`、runtime `cleaning_policy_version` 或 `normalization_quality=passed`
  时 fail closed，不进入 index / alias publish
- incremental update 必须基于 document identity、version/hash、source/version
  carrier 与 runtime profile identity 判定 unchanged / changed / withdrawn / deleted
- changed candidate 生成新 release 或新 point set；withdrawn / deleted candidate 必须产生
  cleanup tombstone 或 explicit delete plan，不允许让 stale chunks 继续被 current alias 命中
- no-longer-current historical / search-only candidate 如果不是 withdrawn / deleted，不得
  伪装成 current alias delete；它必须进入 non-serving terminal status，例如
  `held_search_only`
- serving alias publish 必须在 deterministic retrieval acceptance 后执行；acceptance
  失败只能留下 failed candidate / repair backlog，不能切换 current pointer
- 对 regulation-family query-enabled target alias，release proof只说明“发布产物满足 target
  lane 约束”；runtime 仍必须继续阻止 legacy old-index primary fallback 进入 target serving path。
  old-index compatibility 若仍需保留，只能作为单独命名的 compatibility lane 存在，不得与 target
  alias 混用 completion truth

这条 lane 的目标是让“文档站已发布”和“RAG 已可检索”保持可观测分离。

## Layer Ownership

### Raw Layer

- source asset
- provider output
- provenance / audit / replay input

### Source-Truth Layer

- provider-agnostic layout / page / block truth
- projection upstream

### Document Layer

- canonical document identity
- revision / version truth
- document metadata
- document-units

### Chunk / Index Layer

- chunk metadata
- vector / sparse index
- serving-side evidence carrier

### Live Evidence Adjunct

- admitted live source observations
- bounded normalized live evidence records
- query-time candidate input

补充约束：

- 它不是 canonical source-truth layer
- 它也不是 document/index release truth
- 它只为 query-time freshness-sensitive / live-assisted branch 服务

## Registry And Release Model

- raw asset registry 持有原始来源身份、版本与存储定位
- document registry 持有逻辑文档版本、hash、status 与 serving关联
- RAG release candidate 记录 document identity/version/hash、target collection、
  runtime profile、candidate reason 与 required cleanup disposition
- serving alias 指向当前 query-serving physical collection
- index release 通过 versioned physical collection + release manifest 追溯
- query-enabled alias publish 必须先通过 deterministic retrieval acceptance；release
  manifest / point payload 继续承载 embedding、dense/sparse/hybrid、
  chunker/tokenizer 与 cleaning provenance
- embedding cache 只能作为 rebuild cost-control adjunct；cache key 必须包含文本 hash、
  provider/model/dimensions 与 runtime profile identity，不得替代 release manifest truth

对部分 `offline_preparation` collection，index release 之前允许插入一个 preparation gate。

固定规则：

- collection-specific `chunk preparation` 属于 data-plane 内的独立阶段，不等于 index release
- preparation 只负责 split / cleanup / chunk / validation，不负责 embedding / indexing
- preparation truth 固定落在 operations prefix，而不是 release prefix
- 当某个 collection 启用 hard gate 时，release 必须显式引用 verified preparation truth 才能继续

## Object Storage Semantics

对象存储在架构语义上始终视为：

- `S3-compatible object storage`

当前即使本机部署或通过 MinIO 落地，也不改变这条语义。

## Registry Database Connectivity

registry / control-plane database 与对象存储长期分层。

固定规则：

- Postgres 只承载 registry、run/progress truth 与其他关系型 metadata
- 对 structured projection，Postgres 还承载 release catalog、current pointer
  与 typed read model；这属于关系型 metadata / query projection，不等于把对象 bytes
  迁入 Postgres
- 对象 bytes 不迁入 Postgres，也不改变 `S3-compatible object storage` 的长期语义
- 对象存储继续保存 immutable release artifact、manifest、validation summary 与 replay
  所需 payload
- Redis 只允许作为 cache / invalidation adjunct，不拥有 source truth、release catalog、
  current pointer 或 typed read model
- 当共享 Postgres 由 Supabase 承载且 repo-owned runtime 采用 IPv4-only 姿态时，运行时连接规则以
  `docs/decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md` 为准

## Collection-Specific Rules

以下内容不在本文内展开：

- handbook-specific chunking / validation 细节
- curriculum-specific chunking / serving nuances
- official web page-level source-truth schema 细节
- authenticated notice notice-level source-truth schema 细节
- campus services transport schedule projection schema 细节
- shared file asset family matrix、normalization / extraction / terminal outcome
  细节

这些分别以：

- `docs/policies/student-handbook-chunking-and-validation-policy.md`
- `configs/ingestion/*`
- `docs/data/official-web.md`
- `docs/data/authenticated-notice.md`
- `docs/domains/transport.md`
- `docs/architecture/system/file-asset-loader.md`
- `docs/reference/internal-notice-pdf-chunks.md`

为准。

## Accepted Data-Plane Scope

当前 data plane 已支撑以下 canonical scope：

- `regulations/student_rules`
- `regulations/institutional_rules`
- `regulations/scoped_rules`
- `curriculum/curriculum_plan`
- `curriculum/course_facts`
- `curriculum/program_family_facts`
- `curriculum/program_semester_facts`
- `campus_services/transport_schedule`
- `official_web` source channel 的 control-plane / source-truth path

这表示 repo 已为这些 scope 建立了 canonical data-plane 语义，并不表示它们都已开放 query-serving 或已完成当前
rollout。

## Authenticated Notice Async Staged Closeout

Phase 12.2 的 staged closeout 不改变 data-plane canonical chain，只改变 historical
closeout 的执行模型；ADR-0026 进一步把 executor 升级为 batch-leased pipeline。

固定规则：

- run metadata、workers、milestones、batch manifests、batch input slices 与 staged
  document objects 落在
  `campus_notices/operations/authenticated-notice-closeout/{run_id}/`
- `packages/ingestion-core` 通过 `ingestion_closeout.closeout_*` 表记录 run / shard /
  batch / worker / notice / raw asset / document / promotion staging truth
- planner 只负责冻结输入与计划，不得在 planning 阶段执行整份 bundle 的 source-truth prepare
- worker 只围绕 claimed batch 准备 source-truth 与 staged document artifacts；吞吐由
  worker 数量扩展，而不是由单进程全局 bundle prepare 扩展
- notice/raw/document staging rows 与 run/shard/batch/worker counters 必须作为 batch
  级单事务提交
- batch 围绕 canonical source-truth 与 declared document artifacts 工作，但 canonical
  final document scope 只允许 promoter 单写
- promoter 在 verification 通过后，才把 staged document artifacts 复制到
  `campus_notices/documents/internal_notice/...` 并执行 `replace_scope`
- 若 collection 额外启用了 registry-scope chunk preparation，则 preparation artifacts
  固定落在
  `campus_notices/operations/registry-scope-chunk-preparation/{run_id}/...`，它们属于
  operations truth，不属于 release truth

因此被并行化的是 staging，而不是 canonical document scope mutation。

## Forbidden Shapes

- 不把 raw local path 语义提升成长期 truth source
- 不让新增下游 collection 在 source truth 已存在时返回 raw 重新消费
- 不把 source-truth contract 污染成 document truth 或 retrieval truth
- 不把 online query logic 混回 data-plane layer
- 不把 query-time live evidence 误写成 canonical current-version document truth
- 不让 planner/executor 直接修改 canonical document scope 或 release truth

## 相关稳定文档

- `docs/architecture/current.md`
- `docs/architecture/system/agentic-retrieval.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/decisions/adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- `docs/decisions/adr-0052-self-hosted-single-node-qdrant-and-native-backups.md`
- `docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `docs/decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput
  .md`
- `docs/decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md`
- `docs/data/authenticated-notice.md`
- `docs/architecture/system/file-asset-loader.md`
- `docs/reference/internal-notice-pdf-chunks.md`
