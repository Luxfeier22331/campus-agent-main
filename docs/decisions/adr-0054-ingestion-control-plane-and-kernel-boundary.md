---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0054
status: accepted
created: 2026-06-11
updated: 2026-06-11
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
迁移方向：

- `packages/ingestion-contracts` 是 ingestion task envelope、task registry 与 closeout
  DTO 的 source of truth。
- `apps/ingestion-control` 是 internal Docker-first task control plane；它拥有 admission、
  idempotency、claim / lease、retry、dead-letter 与 closeout lifecycle。
- `apps/ingestion-worker` 通过 task executor seam claim task、dispatch adapter、
  report terminal closeout。既有 Python collection CLI 不默认迁入该 seam；它们按
  delete-first clean-target triage 处理，只有当前生产生命周期仍需要的能力才以 TS /
  Rust target runtime 或 Python adapter 重新建模。
- `packages/ingestion-kernels-rs` 只承接 file-level deterministic kernels；不得连接
  Postgres、Qdrant、S3 或 provider，不得拥有 source-channel 语义。
- `configs/ingestion/<corpus>/<collection>/task-registry.v1.json` 是 collection task
  topology 的 repo-owned declaration。
- 旧 Python CLI 不是长期 ingestion runtime source of truth。逐条处置规则见
  `docs/reference/ingestion-python-cli-clean-target-triage.md`。

第一批 accepted registry targets：

- `curriculum/curriculum_plan`
- `regulations/student_rules`

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

## 相关文档

- `docs/architecture/target-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/system/file-asset-loader-architecture.md`
- `apps/ingestion-control/README.md`
- `packages/ingestion-contracts/README.md`
