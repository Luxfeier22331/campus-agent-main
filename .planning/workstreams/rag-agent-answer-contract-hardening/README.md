---
doc_type: index
status: completed
created: 2026-05-10
updated: 2026-05-11
---

<!-- markdownlint-disable MD013 -->

# Workstream: Rag-Agent Answer Contract Hardening

This is the native entry for `rag-agent-answer-contract-hardening`.
It hardens answer-shape contracts and synthesis behavior for `packages/rag-agent` so title
lookups, brief references, curriculum identity answers, and general summaries stay short, typed,
and bounded.

## Current Status

- status: `completed`
- current phase: `complete`
- active implementation:
  - `packages/rag-agent` now routes title/document identity, curriculum identity, official-web
    brief reference, and general summary through explicit presentation-aware composers.
  - `packages/evals` and runtime diagnostics now surface `presentation_kind`; failure attribution
    stays explicit and is not modeled as a normal answer route.
- current slice: Phase 0-3 closeout complete; short-answer answer-contract hardening is now part of
  the worktree truth for `packages/rag-agent`
- next slices: none; reopen only on regression
- owner boundary: `packages/rag-agent` + `packages/evals`

## Why This Exists

Recent RAG diagnostic runs showed a repeated pattern:

- retrieval reaches the correct document
- synthesis expands title and brief queries into long summaries
- generic summary composition concatenates too many fragments
- `answer_relevancy` falls below the existing gate even when grounding is correct

This workstream exists to harden the answer contract, not to reopen retrieval baseline, reranker
choice, ingestion extraction, or supervisor routing.

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- planning review: `./PLANNING-REVIEW.md`
- gap ledger: `./GAP-LEDGER.md`
- phases: `./phases/*/PLAN.md`

## Boundary Notes

- Does not reopen `agentic-rag-runtime-rearchitecture`.
- Does not reopen `answer-ready-evidence-contract-closeout`.
- Does not add new query-enabled surface.
- Does not move retrieval ownership away from `packages/retrieval-core`.
- Does not turn general summary composition into an unrestricted summary engine for every surface.
- Does not change supervisor, app-api, or ingestion ownership.

## Reopen Rule

Reopen this workstream only if one of these regresses:

- title or document-identity answers become long summaries again
- official-web brief answers expand beyond a bounded fact set
- general summary regains answer authority over specialized short-answer shapes
- stage diagnostics can no longer distinguish selection from synthesis failures
- answer diagnostics stop exposing `presentation_kind` or start marking normal presentation routes
  as generic failure routes
- answer relevancy drops again on the target regression cases for title / brief lookup behavior
