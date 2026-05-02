---
doc_type: outline
status: planned
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Outline: Selected-Write Release Handoff

## Goal

Prepare ingestion-owned selected-write release task handoff for ready candidates.

## Planned Deliverables

- Release task payload examples for contact directory and service guide candidates.
- Handoff evidence tying target inventory row, preview run, source objects and field verdicts.
- Ingestion-worker selected-write execution checklist.
- App-api operator projection expectations after ingestion reports task state.

## Planned Checks

- App-api does not mutate selected-write current truth.
- Release task cannot include candidates without preview lineage and field verdicts.
- Retry/dead-letter semantics stay in ingestion-worker release task state machine.
