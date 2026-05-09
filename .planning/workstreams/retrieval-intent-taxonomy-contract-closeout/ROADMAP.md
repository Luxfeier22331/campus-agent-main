---
doc_type: roadmap
status: active
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Retrieval Intent Taxonomy Contract Closeout

## Phase Status

- [x] **Phase 0: Current Truth And Contract Freeze** — audit current classifiers, freeze exact
  `RetrievalIntent` fields, map current query/answer/retrieval types to target intent taxonomy, and
  document non-goals.
- [x] **Phase 1: RetrievalIntent Contract** — add the versioned internal contract, serialization,
  validation and drift tests.
- [x] **Phase 2: Query Planning Single Source** — make regulation/curriculum/official-web planning
  emit `RetrievalIntent`; stop downstream layers from inventing primary intent.
- [x] **Phase 3: Answer Shape And Typed Answer Convergence** — derive answer shape and typed answer
  kind from `RetrievalIntent`; remove independent answer-shape query parsing.
- [x] **Phase 4: Intent-Driven Retrieval Planning** — map intent to retrieval steps, selectors,
  budgets, need ids and expected outputs.
- [x] **Phase 5: Intent-Aware Selection And Replan** — make selection and semantic replan consume
  expected evidence roles, coverage policy, critical terms and typed condition subjects.
- [x] **Phase 6: Runtime-Profile Reranker With Intent Eligibility** — keep reranker adoption
  runtime-profile owned while using intent-derived eligibility to avoid global opening, with eval
  evidence id and degraded telemetry.
- [x] **Phase 7: Typed Answer Object Internal Primary** — make typed answer object the internal
  primary artifact for supported regulation answer kinds and ensure grounding uses it.
- [x] **Phase 8: Stage Diagnostics Eval Panel** — add a single-sample diagnostics runner for intent
  -> plan -> retrieval -> rerank -> selection -> typed answer -> synthesis -> grounding.
- [x] **Phase 9: Residual Deletion And Guardrails** — delete old independent classifiers, add rg/unit
  guards, update docs/state and close the workstream.

## Execution Rules

- Execute phases in order unless a phase plan explicitly allows read-only parallel audit.
- Do not start Phase 2 before Phase 1 contract tests are green.
- Do not start Phase 4 before Phase 3 resolves answer shape / typed draft ownership.
- Do not make `retrieval-core` import `RetrievalIntent`; it receives only intent-derived typed plan
  fields.
- Do not enable or widen reranker behavior in Phase 6 without eval evidence id and explicit runtime
  profile patch; `RetrievalIntent` can narrow eligibility but cannot override profile ownership.
- Do not change public API response shape unless a later product workstream explicitly asks for it.
- Do not reopen ingestion answer-ready v3 extraction in this workstream.

## Completion Gate

The workstream closes only after Phase 9 records:

- `RetrievalIntent` contract tests
- query planning mapping tests
- answer shape / typed answer convergence tests
- retrieval plan and replan tests
- runtime-profile-owned reranker policy tests or explicit non-opening evidence
- stage diagnostics eval tests
- guard tests preventing classifier drift
- docs/state updates
