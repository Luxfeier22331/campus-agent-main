---
doc_type: readiness_matrix
status: completed
created: 2026-05-07
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 MD060 -->

# Readiness Matrix

## Purpose

This matrix defines what must be true before transport baseline + notice override can move from
backlog to implementation and then to product opening.

## External Dependency Rows

| Dependency | Required Capability | Owner | Evidence To Refresh | Current Verdict | Admission Impact |
|------------|---------------------|-------|---------------------|-----------------|------------------|
| `transport_schedule_lookup` | Current stable schedule baseline, source-backed route/direction/window facts and no raw SQL/object leakage. | `campus-services-runtime-tool-gap-closeout` / campus-services runtime | Go structuredquery tests, tool denominator, current PG smoke when available. | ready baseline, refresh before Phase 7 opening | Composite workflow cannot answer baseline comparison if stale or missing. |
| transport official baseline source | Official baseline schedule file/read model exists and has current release pointer. | campus-services ingestion/read model | Baseline release artifact and PG current pointer evidence. | smoke-seeded baseline passed; real freshness delegated | Missing baseline yields `transport_baseline_missing`. |
| authenticated notice consumption projection | Transport notices are classified and retained as projection/read-model truth, not raw source inventory. | notice consumption layer | Projection/read-model query, routing taxonomy tests, source title/url audit. | smoke-seeded read model passed; real freshness delegated | No `notice_change_set` producer admission without it. |
| media/OCR/multimodal processing | Image/table schedule notices have clean derived facts before admission. | ingestion data plane | OCR/MinerU/multimodal extraction evidence for admitted transport notices. | fail-closed outside admitted smoke sample | Incomplete media yields `notice_media_evidence_incomplete`. |
| workflow artifact registry | `notice_change_set` is no longer a placeholder and has producer/consumer binding. | supervisor runtime policy / artifact registry | Registry drift tests and generated contract checks. | ready | Opening still blocked on smoke evidence, not registry promotion. |
| RAG grounding | Can consume bounded artifacts and emit `evidence_bundle` / `grounding_verdict` without raw context leakage. | `rag-agent` | grounding suites and workflow trace gate. | ready and smoke-verified | Explanatory/conflict/source-original answers cannot open without it. |
| public product entry | Public/chat entry can call the admitted workflow with config gate explicit. | public chat acceptance line | Focused E2E smoke after Phases 1-6. | delegated | Product opening remains owned by `public-chat-campus-services-e2e-acceptance`. |

## Internal Gate Rows

| Gate | Owner Phase | Required Evidence | Blocks |
|------|-------------|-------------------|--------|
| owner matrix freeze | Phase 0 | `OWNER-RUNTIME-MATRIX.md` accepted and markdown clean. | complete |
| `notice_change_set` schema/admission | Phase 1 | schema validator tests, source-truth admission tests. | complete |
| producer/read-model implementation | Phase 2 | baseline/missing/stale/conflict tests. | complete |
| shared projection contract | Phase 3 | OpenAPI/codegen/check, Go/Python/TS fixture tests. | complete |
| resolver workflow admission | Phase 4 | planner emits capability intent; resolver compiles artifact graph. | complete |
| finalizer artifact usage | Phase 5 | workflow trace shows answer artifact ids/kinds. | complete |
| denominator/trace gate | Phase 6 | eval cases cover all denominator classes below. | complete |
| opening smoke | Phase 7 | local/staging smoke with explicit config gate. | complete for supervisor workflow; public product exposure delegated |

## Required Denominator Classes

| Class | Expected Runtime Behavior |
|-------|---------------------------|
| baseline-only | Answer from `schedule_baseline`; no notice override claimed. |
| current temporary overlay | Answer uses `schedule_baseline` plus current `notice_change_set`. |
| durable baseline delta | Answer explains durable notice-derived change and cites source notice. |
| expired historical notice | Does not override current baseline; may return source card if user asks historical source. |
| missing official baseline | Typed fail-close `transport_baseline_missing`. |
| missing evidence | Typed fail-close `notice_media_evidence_incomplete` or `notice_source_ref_missing`. |
| conflicting notices | Typed conflict response unless deterministic precedence exists. |
| ambiguous route/direction | Clarification, not guessed route/direction. |
| source-original question | Uses notice source refs and optional grounding artifacts. |
| no-answer | Typed no-answer without raw search fallback. |

## Trace Expectations

Every positive override case must assert:

- workflow mode is admitted multi-step or the future explicit composite mode
- steps produce `schedule_baseline` and `notice_change_set`
- grounding-required cases also produce `evidence_bundle` / `grounding_verdict`
- `workflow_trace_summary.answer_artifact_kinds` includes the artifacts used by finalizer
- projection summaries include producer, source step, content hash and safety summary
- trace contains no raw source/HTML/OCR/object/provider keys

Every negative case must assert:

- typed fail-close reason is stable
- no later step tries raw notice/RAG recovery
- final answer does not claim a current override
