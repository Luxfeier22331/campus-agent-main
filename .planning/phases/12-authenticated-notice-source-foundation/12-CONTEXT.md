# Phase 12: Authenticated Notice Source Foundation - Context

**Gathered:** 2026-04-04
**Status:** Current worktree closeout ready; bootstrap importer, collector convergence, and bounded replay evidence through `240` notices already exist
**Source:** Distilled from `ADR-0024`, authenticated-notice architecture docs, the active handoff plan, current ingestion-core / ingestion-worker implementation, and the repo-local collector scaffold plus historical export smoke evidence

<domain>
## Phase Boundary

Phase 12 exists to close the gap between the accepted authenticated-notice source-channel direction and the fact that this channel is still only partially landed as repo-local worktree progress.

This phase does not reopen:

- `official_web` source-channel ownership or control-plane boundaries
- current query-enabled surface truth for `student_handbook` and `curriculum_plan`
- shared `app-api` / Worker web product topology
- restricted-document authorization architecture already frozen in Phase 11

Its job is narrower:

- formalize `authenticated_notice_portal` as a tracked repo phase rather than only a docs-level handoff
- absorb the temporary external collector shape into repo-native runtime and data-plane boundaries
- keep bootstrap import as a transition seam while rebuilding canonical `capture/ -> provider/ -> source-truth/`
- consume historical exports first, without depending on current live portal access

</domain>

<decisions>
## Locked Architecture Posture

- `authenticated_notice_portal` is a first-class `source_channel`, not an `official_web` subtype.
- The canonical source unit is `notice`, not page URL, local file path, or collector SQLite row.
- `apps/authenticated-notice-collector` owns authenticated runtime concerns such as storage-state reuse, list/detail fetch, notice normalization, and bootstrap export generation.
- `packages/ingestion-core` plus `apps/ingestion-worker` own bootstrap import, source-truth reconstruction, document import inputs, and downstream registry/object-store writes.
- Object storage semantics remain `S3-compatible object storage` even when local files or MinIO are used operationally.
- The first downstream collection remains `campus_notices/internal_notice` with `restricted` posture and `serving_stage=offline_preparation`.

## Current Implementation Truth

- repo docs already freeze the source-channel direction:
  - `docs/architecture/authenticated-notice-source-architecture.md`
  - `docs/architecture/authenticated-notice-source-truth-contract.md`
  - `docs/decisions/adr-0024-authenticated-notice-source-channel.md`
  - `docs/plans/authenticated-notice-source-foundation.md`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py` already imports typed export bundles into:
  - `capture/*`
  - `provider/*`
  - `source-truth/*`
  - document import inputs with restricted visibility defaults
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth.py` already freezes `raw_asset_id`, `raw_version_id`, block rows, attachment refs, canonical markdown, and document-units derivation around `site_id + notice_id`.
- `apps/ingestion-worker/src/campus_ingestion_worker/smoke_authenticated_notice_bootstrap.py` already provides a focused smoke CLI for bootstrap imports.
- `apps/authenticated-notice-collector` already exists as a repo-local Node runtime shell with:
  - `auth:save`
  - `auth:check`
  - `bootstrap:export`
  - typed config, portal bootstrap, list/detail API client, notice-type config validation, and reference-only link / attachment export artifacts
- `configs/ingestion/campus_notices/internal_notice/` already exists and already freezes:
  - `source_channel=authenticated_notice_portal`
  - `primary_source_unit=notice`
  - `serving_stage=offline_preparation`
  - `retrieval_enabled=false`
  - `query_enabled_by_default=false`
  - restricted collection notes for future rollout
- collector default notice-type config is intentionally narrowed to internal office notices (`type=5`) rather than blindly importing every upstream category.
- repo-local smoke evidence already proves one real historical notice can be imported end to end from the external export bundle into current object-store / registry infrastructure.

## Current Gaps

- Phase 12 had not been formalized inside `.planning/ROADMAP.md` / `.planning/phases/` before this turn.
- the already-landed `configs/ingestion/campus_notices/internal_notice/` profile set has not yet been tied into a formal Phase 12 execution/verification record.
- historical export consumption is now proven through bounded `2 -> 10 -> 50 -> 240` replay evidence; larger `6694` backfill remains explicitly deferred rather than implied complete.
- the collector now emits typed reference-only bootstrap artifacts, but attachment download / object upload ownership still remains deferred.
- dedicated authenticated-notice control-plane ownership remains intentionally deferred; no `app-api` operator/runtime domain should be invented in this phase.

## Explicitly Rejected Directions

- do not treat authenticated internal notices as `official_web`
- do not promote external SQLite / export JSON shape into repo-wide canonical truth
- do not let `local_path` become the object-storage truth model
- do not let the collector write document registry, chunks, or index releases directly
- do not open query-serving or panel/operator control plane for this source during foundation work

</decisions>

<canonical_refs>
## Canonical References

### Architecture and decisions

- `AGENTS.md`
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `docs/decisions/adr-0024-authenticated-notice-source-channel.md`
- `docs/plans/authenticated-notice-source-foundation.md`
- `docs/plans/restricted-document-rollout-and-verification.md`
- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md`

### Current code truth

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth.py`
- `packages/ingestion-core/src/campus_ingestion_core/object_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/registry.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/import_authenticated_notice_export.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/smoke_authenticated_notice_bootstrap.py`
- `apps/authenticated-notice-collector/src/config.ts`
- `apps/authenticated-notice-collector/src/portal.ts`
- `apps/authenticated-notice-collector/src/api.ts`
- `apps/authenticated-notice-collector/src/auth-save.ts`
- `apps/authenticated-notice-collector/src/auth-check.ts`
- `apps/authenticated-notice-collector/src/notice-types.ts`
- `apps/authenticated-notice-collector/src/bootstrap-export.ts`

### Existing tests worth extending

- `tests/ingestion/test_collection_config.py`
- `tests/ingestion/test_corpus_runtime_profile.py`
- `tests/ingestion/test_authenticated_notice_import.py`
- `tests/ingestion/test_import_authenticated_notice_export_worker.py`
- `tests/ingestion/test_smoke_authenticated_notice_bootstrap_worker.py`
- `apps/authenticated-notice-collector/test/config.test.ts`
- `apps/authenticated-notice-collector/test/api.test.ts`
- `apps/authenticated-notice-collector/test/auth-check.test.ts`
- `apps/authenticated-notice-collector/test/auth-save.test.ts`
- `apps/authenticated-notice-collector/test/notice-types.test.ts`
- `apps/authenticated-notice-collector/test/bootstrap-export.test.ts`

</canonical_refs>

<workstreams>
## Proposed Workstreams

### Workstream 1: Phase formalization and collection config freeze

- freeze the Phase 12 roadmap goal, success criteria, and plan breakdown
- add canonical ingestion config for `campus_notices/internal_notice`
- make restricted rollout posture explicit without claiming query-serving expansion

### Workstream 2: Bootstrap import hardening and staged historical replay

- treat current importer/source-truth builder as the first landed slice
- verify real historical exports in controlled batches instead of jumping straight to full corpus import
- capture reusable smoke/runbook evidence for import correctness, object-store writes, and registry outcomes

### Workstream 3: Collector runtime convergence

- keep `apps/authenticated-notice-collector` as the runtime shell owner
- tighten notice-type governance, auth bootstrap, and export shape around repo-native contracts
- close the gap between temporary bootstrap bundle output and the long-term source-truth artifact direction

### Workstream 4: Restricted collection gate and phase closeout

- keep `internal_notice` explicitly outside default query scopes and public retrieval paths
- use collection-config and runtime-profile verification as a source-specific gate, not just a generic restricted-doc assumption
- document how future attachment/object upload, control-plane admission, and operator views remain deferred after this phase

</workstreams>

<verification>
## Verification Targets

- `pnpm --dir apps/authenticated-notice-collector test`
- `pnpm --dir apps/authenticated-notice-collector typecheck`
- `pnpm --dir apps/authenticated-notice-collector build`
- `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker`
- real historical export smoke using `apps/ingestion-worker/src/campus_ingestion_worker/smoke_authenticated_notice_bootstrap.py`
- `git diff --check -- .planning/ROADMAP.md .planning/STATE.md .planning/phases/12-authenticated-notice-source-foundation docs/plans/authenticated-notice-source-foundation.md docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md apps/authenticated-notice-collector apps/ingestion-worker/src/campus_ingestion_worker/smoke_authenticated_notice_bootstrap.py tests/ingestion/test_smoke_authenticated_notice_bootstrap_worker.py`

Success means:

- Phase 12 has a clear repo-native execution breakdown
- historical export consumption is proven without treating bootstrap artifacts as canonical truth
- collector/runtime ownership and data-plane ownership stay separated
- restricted rollout can continue later without reopening source-channel semantics

</verification>

<deferred>
## Deferred Ideas

- live portal re-access and scheduled authenticated collection runs
- dedicated authenticated-notice control plane on `app-api`
- query-serving promotion for `campus_notices/internal_notice`
- generic attachment extraction or parser generalization beyond this source channel

</deferred>

---

*Phase: 12-authenticated-notice-source-foundation*
*Context gathered: 2026-04-04 from accepted architecture docs, current importer/collector implementation, and historical export bootstrap evidence*
