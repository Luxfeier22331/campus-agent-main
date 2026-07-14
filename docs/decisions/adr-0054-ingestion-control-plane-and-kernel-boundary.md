---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0054
status: accepted
created: 2026-06-11
updated: 2026-07-13
supersedes: []
partially_superseded_by:
  - adr-0048-temporal.md
---
# ADR-0054 Ingestion Control Plane And Kernel Boundary

## 状态

Accepted on 2026-06-11.

2026-07-02 update: the self-built claim / lease / retry / dead-letter executor
part of this ADR is superseded by Temporal-owned workflow / activity execution
inside `apps/ingestion-control`. `apps/ingestion-worker` has been removed from
the active workspace; Python extraction may remain only as package library or
private service dependency behind explicit TS handlers.

2026-07-04 update: this ADR keeps its existing decision. The TS ingest core
boundary is clarified as runtime-neutral package space: it may host contracts,
artifact refs, interfaces and pure helpers, but Temporal, Crawlee, concrete
object-store / database clients and provider transports remain in app/job
runtime boundaries.

2026-07-07 update: `packages/ingestion-contracts` now validates through shared
JSON Schema in both TypeScript and Python (`Ajv` / `jsonschema`) and owns
`canonical_document_units.v1`. The canonical unit identity is `doc_id` +
`chunk_id`, not legacy `document_id` + `unit_id`. The ingestion-control
Postgres schema no longer relaxes old self-built lease / retry / attempt
columns; old queued / dead-letter rows fail closed instead of being treated as
an active compatibility path.

2026-07-13 update: the Python mirror package and its copied schemas had no
runtime consumer and have been removed. `packages/ingestion-contracts/schemas`
remains canonical, while its TypeScript/Ajv package is the active validator.
Future Python islands must consume the canonical JSON Schema through an
explicit runtime boundary instead of restoring package-local schema copies.

## 背景

ingestion 当前存在大量 Python CLI、collection strategy 与 historical replay 入口。
这些入口可以继续作为迁移来源，但不能继续定义长期 data-plane runtime。

目标架构已经冻结：

- app-api 不拥有 ingestion execution
- ingestion task lifecycle 由独立 control plane 拥有
- ingestion control plane 是自部署 internal service，不是 Cloudflare Worker
- Python 只作为 adapter / offline tooling
- Rust 只作为 proof-gated deterministic kernel
- rebuild / replay 从 canonical source truth、document artifacts 或
  document-units 继续

## 决策

接受 ingestion control plane + contracts + adapter/kernel split 作为后续 ingestion
迁移方向，并采用 staged clean path 落地。这里的 staged 只表示先冻结 contract /
artifact / handler boundary，再逐 collection 替换实现；不表示保留旧 Python CLI
作为长期兼容层。

- `packages/ingestion-contracts` 是 ingestion task envelope、task registry、
  canonical document units 与 closeout DTO 的 source of truth。validator 必须由
  JSON Schema 驱动；不得在 TS、Python 或 Rust boundary 重新手写字段规则。
- TypeScript ingest core 能力如后续新增，只能作为 runtime-neutral helper / interface
  package 消费 `packages/ingestion-contracts`；它不拥有 Temporal workflow / activity、
  Crawlee queue/storage、S3 / Postgres / Qdrant concrete client lifecycle、provider
  HTTP transport 或 terminal closeout。
- `apps/ingestion-control` 是 self-hosted internal task control-plane package。Docker
  只是 local / transitional substrate，不是长期架构约束。
- `apps/ingestion-control` 的部署角色拆为 `ingestion-control-api` 与
  `ingestion-control-temporal-worker`。两者可以共享 package / image，但必须作为不同
  runtime process 部署和扩缩：API role 拥有 admission、idempotency、registry
  validation、Temporal workflow start 与 operator projection；Temporal worker
  process 拥有 workflow / activity execution、registry-aware execution 与 closeout
  lifecycle。
- `apps/ingestion-control` 通过 registry-aware executor dispatch
  `ts_control` handler 或 `rust_kernel`、report terminal closeout。既有 Python
  collection CLI 不迁入 executor seam；它们按 delete-first clean-target triage
  处理，只有当前生产生命周期仍需要的能力才以 TS / Rust target runtime 或 Python
  adapter 重新建模。
- `app-api`、collector 进程与 Cloudflare Worker surface 都不得承载 Temporal
  workflow / activity execution 或 terminal closeout truth。
- `ts_control` handler 是 source-channel / collection materialization 的默认 owner。
  source-truth materialization、canonical document materialization、structured
  projection publish、operator projection snapshot 与 alias publish 只有在存在真实
  TypeScript handler 后，才能进入 task registry；未实现的生命周期步骤只记录在设计文档 /
  backlog，不作为 registry 占位项。
- `apps/ingestion-worker` 已移除；Python extraction 不拥有 task workflow /
  activity / closeout，不作为 registry fallback executor。
- `packages/ingestion-kernels-rs` 只承接 file-level deterministic kernels；不得连接
  Postgres、Qdrant、S3 或 provider，不得拥有 source-channel 语义。
- `configs/ingestion/<corpus>/<collection>/task-registry.v1.json` 是 collection
  executable task 的 repo-owned declaration；它不是未来任务拓扑或迁移愿望清单。
- source-channel collector 到 ingestion-control 的 clean handoff 必须是 object-native：
  task envelope 输入引用 canonical source bucket artifact refs，默认使用
  `input_ref.kind=object_store` 与 `s3://...` URI。`inline` input 只允许表达小型
  control metadata 或测试 fixture，不得作为 collector run / source-truth materialization
  主输入。
- 旧 Python CLI 不是长期 ingestion runtime source of truth；已删除的旧 CLI
  名称由 clean-target residue tests 固定防回流。

第一批 accepted registry targets：

- `curriculum/curriculum_plan`
- `regulations/student_rules`

第一批 source-channel proof point：

- `internal_portal` / `campus_notices/internal_notice`

它必须证明 verified collector run 能通过 source bucket object refs 进入
`source_truth_materialize` TS handler，并由 ingestion-control 完成
admit / claim / execute / complete / operator projection closeout。该 proof point
通过前，authenticated notice 只能描述为采集与 source-bucket handoff 已具备，不能描述为
data-plane materialization 已迁移完成。

## 结果

- `provider_response_replay` 不再是目标 rebuild owner，只能作为 historical bootstrap、
  local rebuild、audit 或 diagnostic input。
- Rust kernel 必须先通过 output equivalence 与 profiling proof，才允许替换默认 Python
  path。
- 新建或重建 ingestion 能力默认优先 TS control-plane / executor 与 Rust deterministic
  kernel；Python 只允许作为 MinerU / OCR / ML / legacy document extraction 等 adapter。
- app-api 只能消费 redacted operator projection snapshot，不新增 ingestion executor
  callback 或 source mutation route。
- Qdrant alias publish 只能挂在 release manifest / retrieval acceptance 后的
  `alias_publish` task。

## Staged Clean Path

后续 ingestion 清理按以下阶段推进：

1. 冻结 artifact / registry contract：每条 source channel 必须声明 canonical source
   unit、source bucket object layout、input/output contract 与 operator projection
   boundary。task registry 只声明默认 runtime 已能执行的 handler / kernel；未来拓扑写入
   设计文档或 backlog，不保留占位 registry 项。
2. 打通最小真实执行入口：每个被迁移 collection 至少先落地一个非空
   `ts_control` handler 或 Rust kernel bridge，真实读取 object-store input、产出
   contract artifact，并通过 ingestion-control lifecycle closeout。
3. 下沉 deterministic kernel：只有在 output equivalence、profiling 与 file-level
   contract 都成立后，才把 validation、chunking、hash/dedup/diff 或 release manifest
   checks 移入 Rust。
4. 收窄 Python adapter：MinerU、OCR、ML、legacy Office 等 Python-only 能力只能作为
   显式 adapter 被 TS handler 调用，adapter 输出必须回到 source-truth / document
   artifact / projection contract。
5. 删除旧 lifecycle：当对应 TS/Rust handler 覆盖当前生产能力后，删除旧 Python
   import / closeout / replay / repair / smoke CLI 与 runbook 引用；不得保留双路径。

阶段门槛：

- registry entry 必须对应默认 runtime 已实现的 handler / kernel bridge；
  registry 存在本身不等于 collection migration complete。
- 默认 closeout skeleton 不等于 collection migration complete。
- 任何 collection 如果缺 handler / kernel / object-store input contract，必须 fail closed。
- 旧 Python replay/import 只有在具名数据恢复 SLA 下才能临时保留；否则只归档证据，不保留
  executable path。

## 相关文档

- `docs/architecture/target.md`
- `docs/architecture/system/data-plane.md`
- `docs/architecture/system/file-asset-loader.md`
- `apps/ingestion-control/README.md`
- `packages/ingestion-contracts/README.md`
