---
doc_type: index
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Authenticated Notice Run-Level Operator View

This workstream implements the `SEED-004` follow-up: a protected-panel visible,
app-api owned view for authenticated notice collector runs, replay batches and
queue-run attempts.

It answers a different operator question from the per-notice processing view:

> For collector run `20260428T181953007Z`, what happened to the run as a whole:
> how many queue jobs were observed, what terminal state did they reach, did it
> import source truth only, and did any downstream materialization occur?

## Current Status

- status: `completed`
- current phase: `Phase 6 selected notice canary completed`
- phases complete: `6 / 6`
- implementation lives in current `develop`
- real sample evidence exists for collector run token `20260428T181953007Z`

## Boundary

- This workstream adds run-level projection only.
- It does not expand the per-notice
  `authenticated_notice_processing_projection`.
- It does not let protected-panel read ingestion queue tables, object storage,
  trace files, operations directories or raw logs.
- It does not add retry/cancel/re-enqueue actions.
- It does not open a new public serving surface.

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- evidence: `./evidence/`
