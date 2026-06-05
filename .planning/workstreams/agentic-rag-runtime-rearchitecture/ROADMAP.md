---
doc_type: roadmap
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Rag-Agent Agentic Retrieval Rearchitecture

## Phase Status

- [x] **Phase 0: Admission And Codebase Truth Audit** — 已完成 workstream 创建、当前
  `rag-agent` 代码路径盘点、边界冻结与规划文档落盘。
- [x] **Phase 1: Internal Role Split And Contract Alignment** — 已实现内部 stage contract、
  executable seam guardrails、`title_lookup` 降权与 sanitized stage diagnostics foundation。
- [x] **Phase 2: Planner-First Retrieval Runtime Refactor** — 已把 `rag-agent` 主链路改成
  explicit planner -> retrieval -> evidence_selection -> synthesis，并让 planner stage 产出
  executable internal `RetrievalPlan`。
- [x] **Phase 3: Multi-Step Retrieval And Supporting Evidence** — 已把
  `RetrievalExecutionResult.step_results` 的 step 级 provenance 接入 supporting evidence，
  让最终 evidence 可反查 retrieval plan / step / replan count。
- [x] **Phase 4: Observability, Eval, And Performance Diagnostics** — 已补齐 ragas diagnostic
  case-level failure attribution 与 performance breakdown，并保留 stage-level runtime
  diagnostics。
- [x] **Phase 5: Heuristic Cleanup And Closeout** — 已移除旧 `title_lookup` found-copy
  answer authority，保留 title shape 为 evidence-selection hint，补齐 curriculum textual
  support confidence，并完成 closeout / reopen rule。

## Phase 0: Admission And Codebase Truth Audit

**Status:** completed.

**Goal:** 冻结 workstream 边界，并把当前 `rag-agent` 真实代码形态转成规划真相。

**Scope:**

- 盘点 `packages/rag-agent/src/campus_rag_agent/service.py`、`agent.py`、
  `service_answer_synthesis.py`、`agent_answer_shape.py`、`service_retrieval_stage.py` 等
  主要入口。
- 明确当前 service 里哪些逻辑是 planner、retrieval、evidence shaping、synthesis 与
  grounding 的混合点。
- 明确本 workstream 和已完成 `bounded-agentic-retrieval-productization` 的关系：
  后者提供 retrieval baseline，本线负责 rag-agent 的内部重构收口。
- 明确本线和 `eval` workstream 的关系：本线只消费 eval substrate，不夺走 shared eval owner。

**Verification:**

- docs / planning truth review
- current codepath inventory
- `git diff --check`

**Planning Artifacts:**

- `./phases/phase-0-admission-and-codebase-truth-audit/CONTEXT.md`
- `./phases/phase-0-admission-and-codebase-truth-audit/PLAN.md`
- `./phases/phase-0-admission-and-codebase-truth-audit/SUMMARY.md`

## Phase 1: Internal Role Split And Contract Alignment

**Status:** completed.

**Goal:** 把 `rag-agent` 内部的职责边界拆清，先把“谁负责什么”写成代码和文档都能读懂的真相。

**Typed Seam Decision:** `RetrievalPlan / RetrievalStep / StepResult` 首轮固定落在
`packages/rag-agent <-> packages/retrieval-core` internal seam，不进入 `packages/contracts`。

**Scope:**

- 将 scope resolution、query mode resolution、retrieval planning、evidence selection、
  answer synthesis、grounding validation 分成清晰阶段。
- 决定哪些 helper 仍可保留为 compatibility shim，哪些必须变成显式 stage。
- 冻结必要的 package-internal typed artifacts，避免继续把状态藏在隐式 prompt 或
  answer-shape heuristic 里。
- 确保现有 current serving surface 不因内部重构而漂移。

**Exit Criteria:**

- 代码路径能按 stage 识别责任边界：`runtime_stages.py` 冻结 planner /
  retrieval / evidence_selection / synthesis / grounding 的 owner 和 artifacts。
- 旧 heuristics 不再拥有路由级决策权：weak `title_lookup` hit 不再决定
  `completed`。
- phase 1 已明确写出 typed seam placement、owner、compatibility shim 范围与后续
  promotion trigger。

**Planning Artifacts:**

- `./phases/phase-1-internal-role-split-and-contract-alignment/CONTEXT.md`
- `./phases/phase-1-internal-role-split-and-contract-alignment/PLAN.md`
- `./phases/phase-1-internal-role-split-and-contract-alignment/SUMMARY.md`

## Phase 2: Planner-First Retrieval Runtime Refactor

**Status:** completed.

**Goal:** 把主链路从“检索后补形状”改成“先规划、再执行、再证据化、再回答”。

**Boundary Note:** 本 phase 只消费 Phase 1 冻结后的 internal seam，不重新决定 seam
placement，也不把 planner 输出回写成 prompt 黑盒。

**Scope:**

- 显式生成 retrieval plan 或等价 typed planning artifact。
- retrieval executor 只执行 admitted plan，不再偷偷推断全局策略。
- evidence selection 只消费已检索候选，不替 planner 代持 scope / mode truth。
- answer synthesis 只消费最终 evidence bundle，不再把 heuristic title match 误当作答案成功。

**Exit Criteria:**

- 主链路能解释每次回答为什么走这条 plan：planner stage 显式返回
  `RagRetrievalContext` 与 `RetrievalPlan`。
- retrieval failure、no-answer、low-confidence 的语义更细，且 fail-close 保持稳定：
  retrieval、evidence selection、compare completeness、confidence 分流已拆开。
- unit / integration checks 可以证明 planner 输出与 executor 输入之间没有 hidden state
  回流：retrieval stage 只执行 planner stage 已产出的 `RetrievalPlan`。

**Planning Artifacts:**

- `./phases/phase-2-planner-first-retrieval-runtime-refactor/CONTEXT.md`
- `./phases/phase-2-planner-first-retrieval-runtime-refactor/PLAN.md`
- `./phases/phase-2-planner-first-retrieval-runtime-refactor/SUMMARY.md`

## Phase 3: Multi-Step Retrieval And Supporting Evidence

**Status:** completed.

**Goal:** 把 bounded multi-step retrieval 真正接入 rag-agent 内部运行时。

**Boundary Note:** 这一步是对已完成 bounded retrieval baseline 的 rag-agent 适配，不是重新
发明 retrieval-core multi-step owner。它只把 upstream typed projections 和 bounded replan /
supporting evidence 消费接入 rag-agent。

**Scope:**

- bounded replan / follow-up retrieval。
- upstream bounded context consumption。
- candidate refinement 与 supporting evidence selection。
- 与 retrieval-core 的职责边界保持稳定。
  允许消费的 upstream typed projections 以 `CanonicalNoticeContext`、`NoticeChangeSet`、
  `ScheduleBaseline`、`PlaceContext`、`EvidenceBundle` 与 `GroundingVerdict` 为主，不接 raw
  transcript 或 provider trace。

**Exit Criteria:**

- 多步检索只在 admitted case 中发生：本 phase 没有新增 serving surface 或改变
  retrieval-core admission。
- step 级证据链可被 trace / eval 还原：supporting evidence anchor 已标注
  `retrieval_plan_id`、`retrieval_step_ids`、`retrieval_replan_count`。
- 该 phase 的结果可以清楚说明它相对 completed baseline 新增了什么、没有改变什么：
  新增的是 rag-agent runtime adapter provenance；未改写 retrieval-core multi-step owner。

**Planning Artifacts:**

- `./phases/phase-3-multi-step-retrieval-and-supporting-evidence/CONTEXT.md`
- `./phases/phase-3-multi-step-retrieval-and-supporting-evidence/PLAN.md`
- `./phases/phase-3-multi-step-retrieval-and-supporting-evidence/SUMMARY.md`

## Phase 4: Observability, Eval, And Performance Diagnostics

**Status:** completed.

**Goal:** 让 relevancy / faithfulness 问题变得可诊断，而不是只看最终答案分数。

**Observability Contract:** 该 phase 必须产出明确的 stage trace / perf breakdown
contract，而不是只有“多打点”的泛化口号。

**Scope:**

- stage-level trace summary、failure class、candidate counts、latency and failure reasons。
- 评估输入输出中保留足够的 plan / evidence / grounding 信息，但不泄漏 raw provider trace。
- 对 ragas 或其他诊断流做性能分解：区分检索、prompt、adapter、diagnostic scorer、optional
  dependency noise。
- 为 answer relevancy / faithfulness 低分建立可复现的 regression fixture。
  建议的稳定观察字段至少包括：`request_id`、`plan_id`、`query_mode`、`stage_name`、
  `stage_status`、`candidate_count`、`supporting_evidence_count`、`grounding_verdict`、
  `failure_reason`、`latency_ms`、`retrieval_ms`、`prompt_ms`、`adapter_ms` 与
  `diagnostic_ms`。

**Exit Criteria:**

- 能区分“检索不够”“证据不够”“回答编排有问题”“诊断太慢”四类问题：
  runtime diagnostics 提供 stage summary；ragas diagnostic report 提供
  `failure_attribution` 与 `performance_breakdown`。
- 至少一组 regression fixture 能把上述四类问题映射到不同 stage / breakdown 字段：
  `ragas_diagnostic_runner_suite` 覆盖 low context / low answer metric 的不同归因，以及
  retrieval / answer / scorer / diagnostic overhead breakdown。

**Planning Artifacts:**

- `./phases/phase-4-observability-eval-and-performance-diagnostics/CONTEXT.md`
- `./phases/phase-4-observability-eval-and-performance-diagnostics/PLAN.md`
- `./phases/phase-4-observability-eval-and-performance-diagnostics/SUMMARY.md`

## Phase 5: Heuristic Cleanup And Closeout

**Status:** completed.

**Goal:** 收口旧 heuristic shortcuts，并把新的 rag-agent truth 写回 planning / architecture。

**Closeout Rule:** closeout 不是“文档写完就完”，而是要满足前面 phase 的 truth 已经稳定，
且存在明确 reopen rule。

**Scope:**

- 移除或降级 `title_lookup` 等 shape shortcuts。
- 收敛 legacy answer-shape helper 的决策权。
- 更新 workstream state、docs 与 reopen rule。
- 若重构结果已成为 merged truth，再决定是否同步更新相关 architecture 文档。
  reopen rule 的最低触发条件：`title_lookup` 重新决定 answer success、stage-level
  observability 退化为 opaque prompt output、或 multi-step / evidence / grounding 边界再次
  混淆。

**Exit Criteria:**

- 代码路径不再依赖旧式 shape heuristic 维持主语义：`title_lookup` 不再直接生成
  `已找到《title》` copy，也不能独立决定 answer success。
- Workstream 已明确说明 remaining gaps 与后续 reopen trigger。
- Closeout 已写出当前 worktree promoted truth、仍 deferred 的 follow-up 与 reopen 条件。

**Planning Artifacts:**

- `./phases/phase-5-heuristic-cleanup-and-closeout/CONTEXT.md`
- `./phases/phase-5-heuristic-cleanup-and-closeout/PLAN.md`
- `./phases/phase-5-heuristic-cleanup-and-closeout/SUMMARY.md`
