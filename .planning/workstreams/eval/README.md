---
doc_type: index
status: active
created: 2026-04-22
updated: 2026-05-08
---

# Workstream: Eval

这是 `eval` 的 native workstream 入口。
它正式拥有 shared eval substrate、golden dataset governance、artifact contract、publish/backflow seam 与 CI / release-gate automation。

## Current Status

- status: `active`
- current phase: `Phase 5B` partial
- current focus: `Phase 1-5A` 已完成 shared runtime / artifact / publish / automation 与 case
  governance scaffold 收口；`Phase 6` 已完成 workflow trace runtime gate 与 artifact adoption。
  `Phase 7` 已完成 observed regression review / dedupe / accepted fixture admission workflow。
  `Phase 8-13` 已完成 public chat product-path、campus-services / notice tool denominator、
  multimodal/OCR document quality、restricted/authz/privacy、agentic retrieval plan/freshness
  与 eval operations governance deterministic eval seams；本轮已将这些 observation-backed
  profiles 接入 `scripts.eval_gate`，补齐统一 profile artifact、artifact-derived operations
  observation、值级 redaction 与 scaffold denominator 扩展；随后补齐 runtime collection
  统一 client、profile runtime metrics、`publish-profile` backflow、workflow trace tool-call
  grading 扩展、report-only `quality-calibration` profile，并将 `multi-agent-runtime-contract`
  作为正式 deterministic runtime contract profile；本轮继续补齐 profile registry / audit、
  tool routing、public chat entry E2E 与 answer-quality contract profiles。当前 RAG-only
  eval denominator 已收口为 `student_rules`、`institutional_rules`、`curriculum_plan` 与
  `official_web/stable_reference`；`official_web/fresh_news` 明确不属于当前 RAG 消费面。
  `institutional_rules` 已以 `institutional-rules-release-baseline` composite gate 接入
  RAG eval coverage，coverage evidence 位于 `./evidence/rag-eval-coverage/rag-eval-coverage.json`。
  当前 RAG minimum gate 与 maturity gate 均通过；`student_rules` 已达到 45 条 qrels、
  39 个 unique expected docs、25 条 release acceptance，`curriculum_plan` 已达到
  60 条 qrels、49 个 unique expected docs、30 条 release acceptance，四个当前 RAG
  消费面 maturity status 均为 `baseline_ready`。人工扩编 backlog 记录在
  `packages/evals/fixtures/rag_eval_maturity_backlog.v1.json`。当前另有 core RAG
  split-metric RAGAS diagnostic 作为非阻塞质量诊断，证据位于
  `./evidence/retrieval-quality/ragas-diagnostic/ragas-diagnostic.combined.json`；其范围仅覆盖
  `student_rules`、`institutional_rules` 与 `curriculum_plan`，不纳入 `official_web/fresh_news`。
  `Phase 5B` 现在拆成 current-corpus 与 authenticated-gap 两层：当前已入库语料的
  answer-quality contract 与 known-gap contract 可继续补齐并进入 audit；认证态缺失 canonical
  文档仍保持 blocked，不得用相近文档或 notice 引用冒充 accepted truth。
  当前没有独立编号的 Phase 14；`Total Phases = 14` 是因为 Phase 5 被拆为 5A/5B。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- current plan: `./phases/phase-5b-golden-dataset-expansion-and-domain-case-governance/PLAN.md`
- umbrella plan: `./PHASE-5-UMBRELLA.md`

## Archived Snapshot

- superseded plan snapshot: `../../../docs/plans/archive/superseded/eval.md`
- supporting reference snapshot: `../../../docs/plans/archive/superseded/golden-dataset-execution-plan.md`
