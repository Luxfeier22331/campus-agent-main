---
doc_type: planning_review
status: completed
created: 2026-05-10
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# Planning Review: Rag-Agent Answer Contract Hardening

## Review Result

The workstream is valid. Phase 0 is complete and read-only. The remaining phases are still
well-formed, but they need to stay narrow or they will recreate the same synthesis over-expansion
problem this workstream was created to fix.

## Findings

| Finding | Status | Severity | Resolution |
|---|---|---|---|
| Phase 0 lacked an explicit frozen contract matrix | closed | medium | Frozen in `phases/phase-0-contract-inventory-and-boundary-freeze/SUMMARY.md` |
| Phase 0 lacked explicit answer budgets | closed | medium | Frozen in the same phase summary |
| The low score cases are synthesis-heavy, not retrieval-heavy | closed | high | Confirmed by the current ragas diagnostic report |
| General summary previously aggregated too many fragments | closed | high | Phase 3 replaced the broad generic answer wording with bounded `general_summary`; normal presentation routes no longer carry generic failure attribution |
| `TITLE_LOOKUP` still routes through a broad composer path | closed | high | Phase 2 routed title and identity shapes into dedicated presentation-aware composers |
| `curriculum_identity` is still mixed with summary behavior risk | closed | medium | Phase 2 keeps curriculum identity to a bounded brief-reference sentence |

## Phase 1 Review

Phase 1 should be accepted if it keeps the schema internal to `packages/rag-agent`.

- Good: the repo already has `TypedAnswerDraft` and validation helpers.
- Good: phase 1 can formalize existing answer kinds without broadening public contracts.
- Risk: if phase 1 promotes the schema into `packages/contracts`, it will leak a private synthesis
  concern into the shared contract layer.

## Phase 2 Review

Phase 2 is the real corrective phase.

- Route title and identity answers away from generic summary composition.
- Keep official-web brief answers to one or two facts.
- Keep curriculum identity answers to a fact sentence rather than a plan summary.
- Tighten selection budgets before the composer sees too many fragments.

## Phase 3 Review

Phase 3 hardened general summary and locked eval evidence.

- Collapse general summary to one short sentence.
- Add diagnostics for presentation kind while keeping failure attribution explicit and separate from
  normal presentation routes.
- Rerun the frozen ragas smoke cases.
- Do not reopen retrieval, ingestion, or supervisor routing.

## Completion Condition

The workstream is complete. Reopen only if the short-answer contract or failure attribution
regresses.
