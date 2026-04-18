---
doc_type: plan
status: deferred
created: 2026-03-29
updated: 2026-04-12
---

# Golden Dataset Execution Plan

**Goal:** 在不改动 ADR-0003 / ADR-0004 长期治理边界的前提下，把 `campus-agent` 当前 golden dataset 从“已有 schema 和局部基线”推进到“可持续扩样、可重复 benchmark、可明确发现缺口”的执行状态。

**Architecture:** 本文只负责当前执行顺序、交付物和验收标准；golden truth 的长期语义仍以 `docs/decisions/adr-0003-golden-dataset-governance.md` 与 `docs/decisions/adr-0004-evaluation-metrics.md` 为准。

**Tech Stack:** `packages/evals` dataclass protocol, retrieval qrels fixtures, deterministic benchmark runner, optional supplemental adapters

---

## Summary

本轮执行只收口三类资产：

- retrieval qrels
- workflow / status golden cases
- answer truth 的 deterministic surface

本轮不做以下事情：

- 不重写 ADR 或重新定义 golden schema
- 不大规模冻结 `chunk_id`
- 不把 supplemental judge / ragas 评分升级为 canonical gate
- 不提前冻结 `K`、target score、warning threshold 或 merge gate threshold

## Current Repo Position

当前仓库已经具备以下前提：

- golden dataset 治理与指标分层已在 ADR 中冻结
- `packages/evals` 已具备 `GoldenCase`、`ExpectedSourceRef`、`TraceExpectation` 与 deterministic runner
- handbook / curriculum 已分别存在 retrieval qrels fixture
- handbook / curriculum 已分别存在 release-gate workflow cases 与 deterministic error-gate cases
- retrieval benchmark CLI 已能稳定输出 `Hit@1`、`Hit@3`、`Recall@5`、`Precision@5`、`MRR@5` 与 `forbidden_hit_rate`

当前仍待补的不是 schema，而是执行面：

- 统一的 corpus coverage matrix 已落盘，但仍需要随着 case 集演进持续更新
- retrieval qrels 的高风险缺口尚未系统列清
- 选定的 `regression_locked` qrels 已开始锁到 `doc_id + version_id`，但 version-sensitive lane 仍需继续按价值扩样
- handbook / curriculum 的 `smoke` 与 `regression_locked` workflow 固定 case 已成形，但后续仍需继续补高风险 lane
- answer truth 仍需按“适用 case 才计分”的原则继续扩充 `required_facts`、`forbidden_claims` 与 citation 约束
- synthetic expansion 的晋升路径还未和现有固定 case 体系形成明确分层

## 当前生命周期状态

- 本文仍代表 golden dataset 的 accepted follow-up 执行方向，但当前没有独立 active execution wave 按本文持续推进
- 当前 repo 的默认 active lane 已切到 Phase 15 grounded-generation hardening；golden dataset 后续工作应在项目级 planning 中显式重开，而不是继续把本文列作默认 active 入口
- `.planning/phases/07-verification-and-release-gate/` 中对本文的引用只代表历史 phase 上下文，不代表当前 worktree 正在执行本文

## Current Post-Closeout Follow-Up Priorities

在 2026-03-31 repo 主链路 phase 全部完成之后，eval 侧后续工作不再以“补 phase 7 缺口”为目标，而应按当前实际信号强弱排序推进。

当前建议优先顺序固定为：

1. curriculum supplemental `warn` 诊断与 truth 收口
2. handbook table / structured evidence canonical case 补齐
3. synthetic candidate intake 与 canonical 晋升规则收口

排序理由：

- curriculum 当前存在已落盘、可复现的 live supplemental `warn`，且问题集中在 `context_precision` / `context_recall`，ROI 最高
- handbook 的 structured evidence 仍在 coverage matrix 中标记为 `partial`，是 retrieval canonical truth 的明确缺口
- synthetic candidate 治理虽然重要，但更适合建立在前两项已经进一步收紧 canonical truth 之后

### Priority 1: Curriculum supplemental warn diagnosis

目标：

- 先解释并收口 curriculum live gate 当前 `context_precision` / `context_recall` 的 `warn`

执行边界：

- 优先排查 case truth、`reference_context_ids`、retrieved context ID 映射与 denominator 适用性
- 不先通过放宽阈值解决问题
- 只有在 truth 与 runtime projection 都确认正确后，才继续下钻 retrieval/path 行为

预期交付物：

- per-case 诊断记录
- 修订后的 curriculum case truth / context truth / metric applicability
- fresh acceptance artifact 与更新后的 `docs/reference/curriculum-plan-eval-metrics.md`

### Priority 2: Handbook table / structured evidence case

目标：

- 把 handbook 的 `table / structured evidence` lane 从当前 `partial` 推进到 `covered`

执行边界：

- 先确认 handbook manifest 中存在真实、稳定、可长期维护的 structured source truth
- 优先补 retrieval qrels，不把这项工作一开始就扩成新的 release-gate workflow 面
- 仅当 evidence truth 稳定时，才把 case 提升为 `regression_locked`

预期交付物：

- handbook retrieval qrels 新增 structured/table case
- 对应 annotation template / fixture test / coverage matrix 更新
- fresh handbook retrieval evidence 与 reference 文档同步

### Priority 3: Synthetic candidate intake governance

目标：

- 把 `synthetic_expansion` / `exploratory` 从协议能力推进到 repo-tracked intake 流程

执行边界：

- candidate 与 canonical case 必须物理分离维护
- synthetic case 默认先进 `exploratory`
- 只有经人工或规则审核收口后，才允许晋升到 `smoke` / `regression_locked`
- incident backfill 优先级高于继续扩大纯 synthetic 占比

预期交付物：

- candidate fixture / reviewer checklist / validator tests
- 明确的 promotion / rejection rules
- canonical case 与 synthetic candidate 的 repo-tracked ownership 边界

## Execution Principles

### 1. Truth layering first

每个 case 继续按以下层次维护，不回退为“单题单答案文本”：

- retrieval truth
- workflow / status truth
- answer truth
- trace truth

### 2. Doc-level truth first

本轮 retrieval truth 默认粒度保持：

- `smoke` 先锁 `doc_id`
- `regression_locked` 默认锁 `doc_id + version_id`
- 只有选定高风险 case 才升到 `doc_id + version_id + chunk_id`

### 3. Release gate is a slice, not the intake lane

`release_gate` 继续只承担稳定关键样本的门禁职责，不承担新 case 的主要收入口。新 case 的默认进入路径应为：

- `exploratory`
- 经审核晋升到 `smoke`
- 风险明确后晋升到 `regression_locked`
- 仅从稳定子集导出 `release_gate`

### 4. Deterministic gate stays primary

当前正式 gate 仍以 deterministic checks 为主：

- status accuracy
- expected source hit
- forbidden source miss
- required facts
- forbidden claims
- citation completeness
- trace / fail-closed correctness

supplemental judge 只做补充观察，不反向定义 canonical truth。

## Workstreams

## Workstream 1: Freeze the coverage matrix

目标：

- 先把 handbook / curriculum 的“已覆盖 lane”和“明确缺口”写成 repo-tracked reference

交付物：

- `docs/reference/golden-dataset-case-matrix.md`

要求：

- 按 corpus 分开写
- 至少覆盖 retrieval、workflow、answer 三层
- 每条 lane 明确标记 `covered`、`partial` 或 `missing`
- 只写当前 repo 能证明的事实，不伪造尚未实现的覆盖

## Workstream 2: Harden handbook retrieval qrels

目标：

- 在现有 handbook qrels 基础上，系统补齐高信号 lane，而不是继续随机加题

优先 lane：

- forbidden-source disambiguation
- title / article-number exact-match 的高风险回归
- dense semantic paraphrase
- no-hit fail-close
- 版本敏感 case
- 如 handbook 后续存在稳定结构化证据，再评估 table / list lane

要求：

- case 必须写 `rationale`
- 高风险 case 才晋升 `regression_locked`
- 没有稳定版本语义前，不强行写死 `version_id`
- 已确认稳定的高风险 case 应收口到 `doc_id + version_id`

## Workstream 3: Harden curriculum retrieval qrels

目标：

- 保持 curriculum 的结构化 retrieval 优势，同时补足当前偏单文档命中的缺口

优先 lane：

- 同专业不同方案的 disambiguation
- short-fact section
- table retrieval
- forbidden-source expansion
- no-hit fail-close
- 版本敏感 case

要求：

- 继续保持 `doc-level truth first`
- 对同标题近似、路径近似或括号变体 case，优先写 `forbidden_sources`
- 已确认稳定的高风险 case 应收口到 `doc_id + version_id`

## Workstream 4: Materialize stable workflow sets

目标：

- 将当前“主要是 release-gate fixed cases”的状态，推进为更清晰的 workflow 常设分层

执行方式：

- 保留现有 `release_gate` 和 `error_gate` case
- 从稳定固定 case 中显式抽出小型 `smoke` workflow 集
- 将高风险、历史回归价值高的 workflow case 固化进 `regression_locked`
- 保持 `error` 终态通过 deterministic fault injection 单独覆盖

最低覆盖：

- `completed`
- `needs_clarification`
- `no_answer`
- `error`

附加要求：

- `needs_clarification` case 不应错误进入 retrieval
- `no_answer` case 必须带 fail-close expectation
- `error` case 不依赖 live infra 偶发故障

## Workstream 5: Expand deterministic answer truth

目标：

- 扩充 `required_facts`、`forbidden_claims`、citation completeness，而不是追求唯一 reference answer

执行原则：

- 只对 answer truth 稳定的 case 计分
- `needs_clarification` / `no_answer` 不错误计入 answer completeness denominator
- 表格类 case 优先写“必须覆盖的结构化事实点”，不写冗长自由文本标准答案

## Workstream 6: Baseline reruns and evidence capture

目标：

- 每完成一个 corpus 的 case 补齐后，都能重跑 deterministic benchmark 并形成 fresh evidence

结果要求：

- handbook 继续沿用 `docs/reference/student-handbook-eval-metrics.md` 的证据口径
- curriculum 继续沿用 `docs/reference/curriculum-plan-eval-metrics.md` 的证据口径
- live rerun artifact 仍按对应 runbook 落盘，不与 canonical qrels 混写

## Workstream 7: Synthetic expansion as candidate intake

目标：

- 允许继续用 synthetic 手段扩 query 覆盖，但不让其直接成为 canonical truth

治理要求：

- synthetic 先进入 `exploratory`
- 审核后再晋升 `smoke` / `regression_locked`
- incident backfill 与真实日志样本优先级高于继续扩大纯 synthetic 占比

## Suggested Order

建议按以下顺序执行：

1. coverage matrix 落盘
2. handbook qrels 补齐
3. curriculum qrels 补齐
4. workflow / status 分层成形
5. answer truth 补齐
6. benchmark rerun 与 evidence 落盘
7. synthetic candidate lane 接入

## Acceptance Criteria

本文完成时，应同时满足：

- repo 内有一份统一的 golden dataset case matrix，可明确看出 handbook / curriculum 的 covered / partial / missing lane
- handbook 与 curriculum 的 qrels 不再只是“已有样本集合”，而是能对照 matrix 持续补齐
- workflow fixed cases 不再只以 `release_gate` 语义存在，而有显式的 `smoke` / `regression_locked` 规划与收口方向
- answer truth 的 deterministic surface 明确限定在 `required_facts`、`forbidden_claims`、citation completeness 等稳定维度
- 每次 fresh rerun 的 live artifact 与 canonical qrels / workflow truth 继续分离维护

## Deferred

- 大规模 `chunk_id`-level truth
- 统一历史日志采样与 incident 自动回灌流水线
- LLM grader 成为正式 hard gate
- CI 中最终阈值数值冻结
