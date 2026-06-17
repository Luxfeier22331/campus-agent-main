---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0054
status: accepted
created: 2026-06-11
updated: 2026-06-15
supersedes: []
---
# ADR-0054 Ingestion Control Plane And Kernel Boundary

## 状态

Accepted on 2026-06-11.

## 背景

ingestion 当前存在大量 Python CLI、collection strategy 与 historical replay 入口。
这些入口可以继续作为迁移来源，但不能继续定义长期 data-plane runtime。

目标架构已经冻结：

- app-api 不拥有 ingestion execution
- ingestion task lifecycle 由独立 control plane 拥有
- Python 只作为 adapter / offline tooling
- Rust 只作为 proof-gated deterministic kernel
- rebuild / replay 从 canonical source truth、document artifacts 或
  document-units 继续

## 决策

接受 ingestion control plane + contracts + adapter/kernel split 作为后续 ingestion
迁移方向，并采用 staged clean path 落地。这里的 staged 只表示先冻结 contract /
artifact / handler boundary，再逐 collection 替换实现；不表示保留旧 Python CLI
作为长期兼容层。

- `packages/ingestion-contracts` 是 ingestion task envelope、task registry 与 closeout
  DTO 的 source of truth。
- `apps/ingestion-control` 是 internal Docker-first task control plane；它拥有 admission、
  idempotency、claim / lease、retry、dead-letter 与 closeout lifecycle。
- `apps/ingestion-control` 通过 registry-aware executor claim task、dispatch
  `ts_control` handler 或 `rust_kernel`、report terminal closeout。既有 Python
  collection CLI 不迁入 executor seam；它们按 delete-first clean-target triage
  处理，只有当前生产生命周期仍需要的能力才以 TS / Rust target runtime 或 Python
  adapter 重新建模。
- `ts_control` handler 是 source-channel / collection materialization 的默认 owner：
  artifact resolver、source-truth materialization、canonical document materialization、
  structured projection publish、operator projection snapshot 与 alias publish 均先以
  TypeScript control-plane handler 表达，只有 deterministic batch hotspot 才下沉 Rust。
- `apps/ingestion-worker` 只保留 Python extraction adapter island；它不拥有 task
  claim / lease / retry / closeout，不作为 registry fallback executor。
- `packages/ingestion-kernels-rs` 只承接 file-level deterministic kernels；不得连接
  Postgres、Qdrant、S3 或 provider，不得拥有 source-channel 语义。
- `configs/ingestion/<corpus>/<collection>/task-registry.v1.json` 是 collection task
  topology 的 repo-owned declaration。
- source-channel collector 到 ingestion-control 的 clean handoff 必须是 object-native：
  task envelope 输入引用 canonical source bucket artifact refs，默认使用
  `input_ref.kind=object_store` 与 `s3://...` URI。`inline` input 只允许表达小型
  control metadata 或测试 fixture，不得作为 collector run / source-truth materialization
  主输入。
- 旧 Python CLI 不是长期 ingestion runtime source of truth。逐条处置规则见
  `docs/reference/ingestion-python-cli-clean-target-triage.md`。

第一批 accepted registry targets：

- `curriculum/curriculum_plan`
- `regulations/student_rules`

第一批 source-channel proof point：

- `authenticated_notice_portal` / `campus_notices/internal_notice`

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
   unit、source bucket object layout、task registry、input/output contract 与 operator
   projection boundary。
2. 打通最小真实 handler：每个被迁移 collection 至少先落地一个非空
   `ts_control` handler，真实读取 object-store input、产出 contract artifact，并通过
   ingestion-control lifecycle closeout。
3. 下沉 deterministic kernel：只有在 output equivalence、profiling 与 file-level
   contract 都成立后，才把 validation、chunking、hash/dedup/diff 或 release manifest
   checks 移入 Rust。
4. 收窄 Python adapter：MinerU、OCR、ML、legacy Office 等 Python-only 能力只能作为
   显式 adapter 被 TS handler 调用，adapter 输出必须回到 source-truth / document
   artifact / projection contract。
5. 删除旧 lifecycle：当对应 TS/Rust handler 覆盖当前生产能力后，删除旧 Python
   import / closeout / replay / repair / smoke CLI 与 runbook 引用；不得保留双路径。

阶段门槛：

- registry declaration 不等于 handler 已实现。
- 默认 closeout skeleton 不等于 collection migration complete。
- 任何 collection 如果缺 handler / kernel / object-store input contract，必须 fail closed。
- 旧 Python replay/import 只有在具名数据恢复 SLA 下才能临时保留；否则只归档证据，不保留
  executable path。

## 相关文档

- `docs/architecture/target-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/system/file-asset-loader-architecture.md`
- `apps/ingestion-control/README.md`
- `packages/ingestion-contracts/README.md`
