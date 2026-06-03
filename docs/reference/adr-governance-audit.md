---
doc_type: reference
status: active
created: 2026-06-04
updated: 2026-06-04
---

# ADR Governance Audit

## Scope

本审计覆盖 `docs/decisions/adr-*.md` 的全量 ADR corpus。

审计目标：

- 确认 ADR 是否与当前 repo truth 漂移。
- 确认 ADR 之间、ADR 与 architecture / reference / runbook 文档之间是否存在职责重叠。
- 确认 ADR 文件体系是否符合 `ADR-0038` / `ADR-0039` 定义的信息架构分层。

本审计不重新裁决每条技术决策是否正确；它只判断 ADR 作为决策文档的治理状态。

## Governing Rules

适用规则：

- `docs/decisions/adr-0038-documentation-information-architecture-and-lifecycle.md`
  - ADR 记录长期决策、状态和替代关系。
  - architecture 解释系统边界。
  - reference 记录稳定事实、指标、清单和验收口径。
  - runbook 记录可重复执行步骤。
- `docs/decisions/adr-0039-reference-and-runbook-historical-lifecycle.md`
  - historical reference / runbook 退出默认阅读路径，但不等于删除。
- `docs/decisions/README.md`
  - ADR 不写临时执行记录。
  - 旧 ADR 不删除；失效时必须 `superseded` 或 `deprecated`。
  - replacement 必须显式回链。

## Mechanical Audit

审计时间：2026-06-04。

机械检查结论：

- ADR 文件数：`43`
- 编号范围：`ADR-0002` 到 `ADR-0046`
- 缺号：`ADR-0008`、`ADR-0009`
  - 这只是历史编号空洞，不是当前治理缺陷。
- `docs/decisions/README.md` 索引覆盖：全部 ADR 均已列出。
- `decision_id` 与文件名：全部匹配。
- status vocabulary：全部在 `accepted` / `superseded` 等允许集合内。
- supersession：
  - `ADR-0045` supersedes `ADR-0020`。
  - `ADR-0020` 已标记 `superseded`，并回链 `ADR-0045`。

本轮已修复的机械问题：

- `ADR-0011`、`ADR-0015`、`ADR-0018`、`ADR-0030` 中重复相关文档链接。
- `ADR-0015`、`ADR-0022` 中被换行打断的 ADR 路径。
- `ADR-0022` 中被换行打断的外部 URL。
- `ADR-0046` 中复制 runbook 命令块的问题。

## Drift Findings

### D0: No confirmed active decision drift

没有发现当前 accepted ADR 与 `docs/architecture/current-architecture.md`、
`docs/architecture/system/*` 的核心 truth 发生直接反向冲突。

当前仍一致的关键边界：

- `apps/app-api = Cloudflare Worker`，见 `ADR-0013` 与
  `docs/architecture/system/product-runtime-architecture.md`。
- `apps/supervisor-api = Docker-first internal execution service`，见
  `ADR-0043` 与 `docs/architecture/current-architecture.md`。
- product surface 收口到 `hub-web` / `public-chat-web` / `public-docs` /
  `protected-panel-web` + shared `app-api`，见 `ADR-0012`、`ADR-0013`、
  `ADR-0043` 与 current architecture。
- Qdrant backup 默认主路径已从 Cloud / object-store bundle 切到 self-hosted
  native snapshot，见 `ADR-0045`；`ADR-0020` 已 superseded。
- authorization truth 由 `app-api` 拥有，retrieval 只消费 filter projection，
  见 `ADR-0022`、`ADR-0034` 与 identity architecture。
- `Sentry` / `Axiom` 是 observability sinks，不是 panel canonical read model，
  见 `ADR-0010`、`ADR-0023` 与 operator observability architecture。

### D1: Historical naming remains but is explicitly bounded

`ADR-0007` 仍保留 `phase1` 历史命名，但正文已经明确当前 truth 以
`retrieval-serving-architecture.md` 为准。该项不构成漂移。

### D2: Superseded Qdrant Cloud decision is correctly retired

`ADR-0020` 当前是 historical replacement target，不再代表 active decision。
它仍引用 self-hosted native snapshot replacement。该项不构成漂移。

## Overlap Findings

### O1: ADR-0046 duplicated runbook command surface

问题：

- `ADR-0046` 自身声明 runbook 记录具体操作命令，但正文原本包含 `gsd-sdk` /
  `codex` / verification 命令块。
- 这与 `docs/runbooks/workstream-gsd-sdk-workflow.md` 职责重叠。

本轮处理：

- `ADR-0046` 已改为只冻结 owner boundary。
- 具体命令、参数和 closeout 步骤继续由
  `docs/runbooks/workstream-gsd-sdk-workflow.md` 维护。

状态：closed。

### O2: ADR-0002 carries both object-store convention and historical backup schema

现状：

- `ADR-0002` 的主职责是本地 MinIO / S3-compatible object-store convention。
- 它也保留了 historical Qdrant backup bundle object key schema。
- `ADR-0045` 已把当前 backup 主路径切到 qdrant-native filesystem snapshots。

判断：

- 这不是当前漂移，因为 `ADR-0002` 明确标注 historical backup bundle 只用于清理旧
  object-store snapshot bundle。
- 但它是可读性 watch item：object-store convention 与 backup migration history
  挤在同一 ADR 中，后续如果 backup schema 继续增长，应迁移到 reference / runbook，
  ADR 只保留 boundary decision。

状态：watch。

### O3: ADR-0023 is large but mostly decision-oriented

现状：

- `ADR-0023` 与 `docs/architecture/system/operator-observability-architecture.md`
  都覆盖 operator observability。

判断：

- 当前分层可以接受：ADR 冻结 sink participation 和 panel ownership decision；
  architecture 展开 supporting architecture 与 runtime shape。
- 该 ADR 体量较大，后续新增细节应优先进入 architecture / reference / runbook，
  不继续扩大 ADR 正文。

状态：watch。

### O4: Eval ADRs and eval references are correctly layered

现状：

- `ADR-0003` / `ADR-0004` 冻结 golden dataset 与 metrics 的治理原则。
- `docs/reference/eval-gold-truth-model.md`、`testing-and-verification-lanes.md`、
  `golden-dataset-case-matrix.md` 承接具体 truth model、lane 和矩阵。

判断：

- 没有发现职责重叠导致的漂移。

状态：healthy。

## Layering Findings

### L1: ADR corpus is structurally indexed and lifecycle-aware

`docs/decisions/README.md` 已按主题分组列出全部 ADR，并明确 lifecycle。
`ADR-0038` / `ADR-0039` 已为 docs architecture 提供基础分层规则。

状态：healthy。

### L2: Some ADRs contain implementation consequence text, but not operational procedure

`ADR-0019`、`ADR-0025`、`ADR-0026`、`ADR-0033`、`ADR-0043` 等包含
“runbook 必须...”或 implementation consequence。这类文字当前是在定义决策后果，
不是逐步操作手册，因此不需要迁移。

判定标准：

- 如果内容描述 owner、boundary、invariant、forbidden shape，留在 ADR。
- 如果内容描述命令、参数、执行顺序、smoke 步骤，迁到 runbook。

状态：healthy with rule clarified。

### L3: Placeholder paths are not broken links

机械本地路径检查会把 `.planning/workstreams/<slug>/README.md`、`apps/*`、
`packages/*` 等模板路径当成不存在。它们是 schema / pattern 表达，不是实际文件链接。

状态：not an issue。

### L4: Missing ADR numbers are historical gaps

`ADR-0008` 与 `ADR-0009` 不存在。当前没有索引断裂，也没有引用指向这两个编号。
不需要补空号 ADR。

状态：not an issue。

## Per-ADR Classification

### Watch Items

- `ADR-0002`
  - layer: data-plane decision
  - drift: no active drift
  - note: historical backup schema remains for cleanup context
- `ADR-0023`
  - layer: operator observability
  - drift: no active drift
  - note: large ADR; keep future detail in architecture / reference

### Fixed In This Audit

- `ADR-0011`
  - layer: panel runtime
  - fix: duplicate related document links removed
- `ADR-0015`
  - layer: identity / memory boundary
  - fix: duplicate links and broken ADR path repaired
- `ADR-0018`
  - layer: official-web control plane
  - fix: duplicate related document links removed
- `ADR-0022`
  - layer: authz boundary
  - fix: broken ADR paths and external URLs repaired
- `ADR-0030`
  - layer: product scope boundary
  - fix: duplicate related document link removed
- `ADR-0046`
  - layer: workflow substrate decision
  - fix: command blocks moved back to runbook ownership

### Healthy By Group

- Evaluation / quality:
  - `ADR-0003`
  - `ADR-0004`
  - `ADR-0010`
- Core runtime / orchestration:
  - `ADR-0006`
  - `ADR-0012`
  - `ADR-0013`
  - `ADR-0016`
  - `ADR-0017`
  - `ADR-0042`
  - `ADR-0043`
- Retrieval / data plane / infrastructure:
  - `ADR-0007`
  - `ADR-0014`
  - `ADR-0019`
  - `ADR-0020`
  - `ADR-0029`
  - `ADR-0044`
  - `ADR-0045`
- Identity / authorization:
  - `ADR-0034`
- Official web / authenticated notice / internal notice:
  - `ADR-0018`
  - `ADR-0024`
  - `ADR-0025`
  - `ADR-0026`
  - `ADR-0031`
  - `ADR-0032`
  - `ADR-0033`
  - `ADR-0035`
  - `ADR-0036`
  - `ADR-0037`
  - `ADR-0040`
  - `ADR-0041`
- Navigation and institution semantics:
  - `ADR-0005`
  - `ADR-0021`
  - `ADR-0027`
  - `ADR-0028`
  - `ADR-0030`
- Documentation lifecycle:
  - `ADR-0038`
  - `ADR-0039`

## Remediation Policy

Future ADR edits should follow these rules:

1. ADRs may state a command category, owner, boundary, required evidence class or
   forbidden shape.
2. ADRs must not carry daily command lists, smoke command blocks, CLI flags or
   operator step sequences when an active runbook owns that procedure.
3. Supporting architecture owns expanded runtime shape and data flow diagrams.
4. Reference docs own schemas, metrics, terminology, matrices and stable
   inventories.
5. Runbooks own operation order, shell commands, staging smoke steps and evidence
   templates.
6. When a decision changes, add or update a replacement ADR and mark the old ADR
   `superseded` or `deprecated`; do not silently rewrite history.

## Follow-Up Work

Recommended non-blocking follow-ups:

1. Split historical Qdrant object-store backup key details out of `ADR-0002` if
   backup cleanup history grows again.
2. Keep future operator observability implementation details out of `ADR-0023`;
   use `operator-observability-architecture.md`, telemetry taxonomy reference,
   runbooks or panel contracts.
3. Re-run this audit after major product-runtime, identity/authz, or data-plane
   decisions land.
