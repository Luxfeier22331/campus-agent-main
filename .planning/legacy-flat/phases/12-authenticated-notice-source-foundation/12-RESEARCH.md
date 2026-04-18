# Phase 12 Research: Authenticated Notice Source Foundation

## Locked Boundaries

- `authenticated_notice_portal` is a dedicated `source_channel`; this phase must not fold it into `official_web`.
- The canonical source unit is `notice`; stable identity is derived from `site_id + notice_id`.
- Bootstrap export bundles and collector SQLite state are transition seams only; canonical repo truth must still become `capture/ -> provider/ -> source-truth/`.
- The collector remains a runtime shell under `apps/authenticated-notice-collector`; it must not write document registry, chunks, or index releases directly.
- The first downstream collection remains `campus_notices/internal_notice`, `restricted`, and `offline_preparation`.
- Live portal access is currently unavailable, so historical export consumption is not an optional convenience path; it is the current execution substrate.

## Already-Landed Implementation Slices

### Docs and architecture freeze

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/decisions/adr-0024-authenticated-notice-source-channel.md`
- `docs/plans/authenticated-notice-source-foundation.md`
- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md`

### Repo-native importer and worker seams

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py`
  - imports typed export bundles
  - reconstructs `capture/*`, `provider/*`, and `source-truth/*`
  - applies restricted defaults during document import
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth.py`
  - derives `raw_asset_id` / `raw_version_id`
  - builds notice manifest, content blocks, attachment refs, canonical markdown, and document units
- `apps/ingestion-worker/src/campus_ingestion_worker/import_authenticated_notice_export.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/smoke_authenticated_notice_bootstrap.py`

### Collector runtime scaffold

- `apps/authenticated-notice-collector`
  - storage-state based auth bootstrap and validation
  - list/detail fetch client
  - notice-type config loading
  - bootstrap export command
- default notice-type config is intentionally narrowed to `办公通知`

### Existing restricted collection config

- `configs/ingestion/campus_notices/internal_notice/`
  - runtime profile already keeps this collection `offline_preparation`
  - retrieval is disabled
  - default query serving is disabled
  - canonical profile already says the primary source unit is `notice`

### Current verification truth

- collector `test`, `typecheck`, and `build` pass
- collection-config and runtime-profile tests already cover `internal_notice` repo-tracked paths plus `retrieval_enabled=false` / `query_enabled_by_default=false`
- authenticated-notice importer tests already cover source-truth reconstruction and restricted metadata defaults
- worker-focused authenticated-notice unittest coverage passes
- a real historical one-record smoke import passes against current object-store / registry env
- once the same real notice already exists, smoke still passes via `raw_reused_count=1` and document skip semantics

## Gaps And Risks

### Phase formalization gap

- Phase 12 was only just added to `.planning/ROADMAP.md`
- there was no phase-local `CONTEXT`, `RESEARCH`, or `PLAN` structure before this turn
- the already-landed bootstrap slices need to be reflected explicitly rather than rediscovered ad hoc

### Historical replay gap

- real historical data has only been proven on a single-record sample
- larger staged replay (`1 -> 50 -> 240 -> 6694`) is not yet closed
- previous attempts at larger imports appeared operationally slow, so batch sizing and evidence capture matter

### Collector convergence gap

- the collector is repo-local now, but it still primarily outputs bootstrap-oriented bundle artifacts
- attachment/object upload ownership exists architecturally, but the convergence from temporary filesystem/export habits to fully repo-native artifact expectations is not yet complete

### Product-boundary risk

- it is easy to accidentally slide into `official_web` reuse, panel/operator control plane, or premature query-serving discussion
- those are forward concerns, not foundation-phase deliverables

## Recommended Phase Breakdown

### 12-01: Formalize the already-landed bootstrap foundation

- treat the current importer, worker smoke CLI, collector scaffold, collection config, runbook, and sample historical import as the first completed slice
- create phase-local docs that explain what is already landed and how it was verified
- update roadmap/state so this work is discoverable in `.planning`

### 12-02: Stage real historical replay beyond the one-record sample

- use historical bundles as the first-class execution substrate
- validate import behavior in controlled batches rather than attempting an immediate full import
- capture registry/object-store/document outcome evidence and note any operational limits

### 12-03: Converge the collector output toward repo-native long-term shape

- keep the collector as the source-specific runtime shell
- tighten export shape, attachment/object references, and notice-type governance around the repo’s accepted contracts
- reduce dependence on temporary bundle-only conventions without pretending the bootstrap seam never existed

### 12-04: Close the phase and freeze deferred boundaries

- record what is now verified in `.planning` and docs
- keep `internal_notice` explicitly offline and non-query-serving
- freeze what remains deferred to future live-run or control-plane work

## Suggested Verification Sequence

1. `pnpm --dir apps/authenticated-notice-collector test`
2. `pnpm --dir apps/authenticated-notice-collector typecheck`
3. `pnpm --dir apps/authenticated-notice-collector build`
4. `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker`
5. real historical smoke:
   - 1-record sample from `notices-bundle-20260403-run-2.json`
6. next staged replays:
   - 50-record slice
   - 240-record `run-2`
   - only then consider `run-14` / `full`
7. `git diff --check` on planning/docs/runtime files touched by the phase

## Planning Implication

The main planning mistake to avoid is treating this phase as if it starts from zero. It does not. The right structure is:

- Phase-local docs first record the bootstrap foundation that is already in the current worktree.
- The next active execution slice is historical replay hardening, not live portal collection.
- Collector convergence remains runtime-specific and must stay separate from query-serving or control-plane design.
