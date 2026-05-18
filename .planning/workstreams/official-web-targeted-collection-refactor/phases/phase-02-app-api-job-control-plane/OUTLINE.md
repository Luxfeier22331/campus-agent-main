---
doc_type: phase_outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Outline: App-API Job Control Plane

## Goal

Move target job truth into `app-api`, while keeping existing crawl run lifecycle intact.

## Deliverables

- DB schema for target jobs, candidate URLs, page attempts and target-scoped artifact verification projection.
- Service layer for creating/resolving target jobs from repo-tracked target declarations.
- Operator-safe query projection for target job state.
- Compatibility mapping from existing crawl run to target job execution.
- Explicit adoption of shared source-handoff state machine as canonical artifact verification truth.

## Proposed Tables

- `official_web.target_jobs`
- `official_web.target_job_candidates`
- `official_web.target_page_attempts`
- `official_web.target_artifact_verification_summaries` or equivalent projection only
- operator projection tables or JSON summary fields as needed

## Source-Handoff Integration

Phase 2 must not create a second canonical artifact verification ledger.

- Canonical verification remains `SourceHandoff` / `SourceObjectRef` / `ObjectVerification`.
- Target job records may store only lineage, admission decision and operator-safe summary.
- Any `target_artifact_*` table must reference canonical handoff/object verification ids or store a deterministic projection derived from them.
- If the shared source-handoff tables are not yet physically available in app-api, Phase 2 must record the compatibility decision explicitly and keep target verification rows projection-only.

## Non-Goals

- Do not replace `official_web.crawl_runs`.
- Do not make app-api parse page body or source-truth blocks.
- Do not expose write APIs to panel.
- Do not duplicate object identity/hash verification semantics already owned by source-handoff.

## Acceptance

- Each target job has idempotency key and deterministic declaration version.
- Candidate URL rows carry target lineage and pre-fetch eligibility reason.
- Existing run lifecycle remains backward compatible.
- Operator query can list target jobs without object-store access.
- Artifact verification summaries cannot be marked canonical unless backed by shared `ObjectVerification`.
- Worker and shared DB integration tests cover the new app-api routes/schema when implemented.

## Verification

```bash
pnpm --dir apps/app-api test -- official-web
pnpm --dir apps/app-api test:worker -- official-web
pnpm --dir apps/app-api test:shared-db-integration -- official-web
pnpm --dir apps/app-api typecheck
```
