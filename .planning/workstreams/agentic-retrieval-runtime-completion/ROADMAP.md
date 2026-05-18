---
doc_type: roadmap
status: completed
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Roadmap

- [x] **Phase 1: Workstream Truth Freeze** — native planning truth created; non-goals and
  boundaries frozen.
- [x] **Phase 2: Internal Planner Decision Contract** — `RagPlannerDecision` and planned step
  truth added inside `packages/rag-agent`.
- [x] **Phase 3: Typed Step Graph Execution** — `entity_resolution`,
  `historical_version_lookup` and `compare_pair_lookup` execute through bounded retrieval-core
  requests.
- [x] **Phase 4: Bounded Semantic Replan** — rag-agent wires retrieval-core `replan_callback`
  with scope/selector/budget-preserving follow-up steps.
- [x] **Phase 5: Projection-Aware Planning** — safe projection refs are surfaced as
  `planning_framing`.
- [x] **Phase 6: Claim/Evidence Enforcement Gate** — deterministic completed answers now pass
  claim-level grounding validation before completion.
- [x] **Phase 7: Eval And RAGAS Attribution** — agentic retrieval eval fixture uses typed step
  graph vocabulary and preserves planner/replan/claim graph attribution.
- [x] **Phase 8: Closeout Verification** — focused runtime, retrieval and eval suites pass.

## Fixed Order Rationale

Planner decision truth had to precede typed step execution so retrieval-core did not infer product
scope on its own. Claim/evidence enforcement was last because it consumes selected supporting
evidence and retrieval execution provenance.
