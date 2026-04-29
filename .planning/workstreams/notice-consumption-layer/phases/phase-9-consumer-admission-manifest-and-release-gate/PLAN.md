---
doc_type: plan
status: completed
created: 2026-04-27
updated: 2026-04-27
phase: Phase 9
workstream: notice-consumption-layer
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Plan: Consumer Admission Manifest And Release Gate

## Objective

Implement a fail-close consumer admission layer for authenticated notices.

After this phase, future `admit_and_materialize` / projection / read-model / typed
materializer flows must be bounded by an explicit, auditable consumer admission manifest.
The manifest is the selected-scope authority; source-truth inventory scans must not
silently expand the downstream consumer set.

## Target Architecture

The new flow is:

`import dry-run / source-truth inventory -> routing taxonomy -> consumer admission manifest
-> release gate -> bounded projection rebuild -> bounded read-model / typed candidate writes`

Fixed boundaries:

- Collector admission decides collection safety only.
- Import admission decides source-truth / registry materialization safety only.
- Consumer admission decides downstream consumption target and write eligibility.
- Read model consumes only admitted `notice_level_query / retained_for_notice_query`.
- Typed materializers consume only their own admitted target surfaces.
- Multimodal drain consumes only admitted pending projection units.

## Planning Constraints

- Do not run portal collection, historical backfill, hosted model calls, PG writes, or
  object-store writes while implementing this phase.
- Do not make source-truth inventory, historical bundles, or routing audit output act as
  downstream write authorization.
- Do not add a second notice taxonomy implementation. Builder logic must reuse existing routing
  taxonomy outputs and only map them to admission decisions.
- Keep manifest/gate logic runtime-neutral. It belongs in `packages/ingestion-core`; Worker CLI
  modules only parse arguments, call core functions, and emit JSON.
- If an existing code path is still valid for narrow selected-notice development fixtures, keep
  that fixture explicit rather than introducing broad fallback behavior.

## Deliverables

1. Core manifest model and validation
   - New repo-owned schema constants for consumer admission manifest v1.
   - Dataclasses or typed dicts for manifest, decision records, and gate report.
   - JSON load/write helpers with strict validation.
   - Stable `selection_sha256` computation for bundle/inventory selection files.

2. Manifest builder
   - Build manifest from authenticated notice bundle dry-run output.
   - Build manifest from existing source-truth inventory for selected notice ids.
   - Resolve routing taxonomy sample for each notice.
   - Emit decision records with:
     - notice identity and raw version identity
     - `notice_family`
     - `suggested_consumption_route`
     - `target_surface`
     - `consumption_status`
     - `admission_decision`
     - reason codes
     - body quality
     - attachment/ref/owner/multimodal counts
   - Produce `decision_counts`.

3. Decision policy
   - Map `notice_level_query` to `retained_for_notice_query`.
   - Map procurement notices to `procurement_notice_history`.
   - Map service status / special service / stable contact routes to campus-services
     typed candidate surfaces.
   - Map high-value machine processing gaps to `multimodal_processing_candidate`.
   - Map empty body, unsupported route, unrecovered owner gap, and low-value deferred rows to
     `unsupported / no_adoption`.
   - Preserve reason codes for every blocked or no-adoption decision.

4. Release gate
   - Validate manifest schema and policy version.
   - Validate selected notice ids match the intended bundle/inventory set.
   - Reject implicit full-scope / replace-scope writes without manifest authorization.
   - Enforce thresholds for empty body, owner gap, reference-only attachments,
     unsupported binary, and pending multimodal counts.
   - Enforce target-surface write bounds:
     - read model accepts only `notice_level_query / retained_for_notice_query`
     - campus-services materializers accept only their own candidate surfaces
     - multimodal drain accepts only `multimodal_processing_candidate /
       pending_multimodal_processing`
   - Emit allow/block verdict with reason codes and summary counts.

5. Import integration
   - Add optional `consumer_admission_manifest_path` to the import request / CLI.
   - For `plan`, include whether a manifest path was supplied but do not write.
   - For `admit_and_materialize`, run the gate before projection/read-model rebuild.
   - Restrict projection/read-model rebuild to manifest admitted notice ids.
   - Do not make source-truth archival writes imply query/read-model eligibility.

6. Worker CLIs
   - Add a manifest builder CLI for bundle and selected inventory modes.
   - Add a release gate CLI that can run standalone in CI/operator workflows.
   - Existing import CLI gets manifest path support.
   - CLI outputs are JSON and deterministic enough for test fixtures.

7. Tests and fixtures
   - Unit tests for manifest load/write/validation.
   - Unit tests for decision policy mapping.
   - Gate tests for missing manifest, id mismatch, implicit replace scope,
     threshold breach, and target-surface violation.
   - Import integration tests proving:
     - default plan writes nothing
     - materialize with projection/read-model and no manifest fails closed where required
     - manifest bounds projection ids
     - unsupported / campus-services candidate rows do not enter notice read model
   - CLI tests for manifest builder, gate, and import manifest args.

8. Documentation and runbooks
   - Add or update runbook section for:
     - dry-run
     - manifest generation
     - gate
     - bounded materialization
   - Keep source architecture docs aligned if implementation details require naming changes.

## Work Breakdown

### Batch A: Manifest Contract

Purpose: create the offline artifact shape without touching import or write paths.

Primary files:

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_consumer_admission_manifest.py`
- `tests/ingestion/test_internal_notice_consumer_admission_manifest.py`

Tasks:

1. Define manifest schema version, policy version, allowed target surfaces, allowed
   consumption statuses, admission decisions, and reason-code constants.
2. Implement manifest / decision record load, dump, validation, and deterministic canonical
   JSON serialization.
3. Implement `selection_sha256` over a stable selected-id payload.
4. Add tests for missing required fields, unknown enum values, duplicate notice ids,
   malformed hashes, and stable serialization.

Exit criteria:

- A fixture manifest round-trips without data loss.
- Invalid manifests fail before any downstream gate or import function can use them.

### Batch B: Decision Builder

Purpose: turn already-collected evidence into explicit per-notice consumer decisions.

Primary files:

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_consumer_admission_builder.py`
- `tests/ingestion/test_internal_notice_consumer_admission_builder.py`

Inputs:

- bundle dry-run report
- selected source-truth inventory rows
- existing routing taxonomy sampler output

Tasks:

1. Build manifest decisions from a bundle/dry-run selection.
2. Build manifest decisions from selected source-truth inventory rows.
3. Map routing outputs into first-version target surfaces:
   - `notice_level_query`
   - `procurement_notice_history`
   - `campus_services/service_status_candidate`
   - `campus_services/special_service_candidate`
   - `campus_services/stable_contact_candidate`
   - `multimodal_processing_candidate`
   - `unsupported`
4. Add reason codes for blocked/no-adoption cases instead of widening fallback writes.
5. Emit `decision_counts` and quality counters used by the gate.

Exit criteria:

- Builder output is deterministic for the same selected input.
- Unsupported or incomplete rows are represented as explicit decisions, not dropped silently.

### Batch C: Release Gate

Purpose: make materialization fail closed unless the manifest authorizes the requested write.

Primary files:

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_consumer_admission_gate.py`
- `tests/ingestion/test_internal_notice_consumer_admission_gate.py`

Tasks:

1. Validate manifest schema, policy version, selected ids, selected source hash, and scope write
   mode.
2. Validate operation intent:
   - plan-only
   - selected projection rebuild
   - read-model rebuild
   - typed candidate materialization
   - pending multimodal drain
3. Block:
   - missing manifest for historical/full-scope materialization
   - id mismatch
   - implicit replace scope
   - unsupported target-surface write
   - threshold breach for empty body, owner gap, reference-only attachments, unsupported binary,
     or pending multimodal counts
4. Emit machine-readable gate report with `verdict`, `reason_codes`, target counts, and
   selected ids.

Exit criteria:

- Gate has no dependency on PG, object storage, or portal access.
- Every block case returns a stable reason code suitable for CI/operator output.

### Batch D: Import And Worker Integration

Purpose: connect manifest/gate to existing operator paths without changing default plan safety.

Primary files:

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/import_authenticated_notice_export.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/build_internal_notice_consumer_admission_manifest.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/check_internal_notice_consumer_admission_gate.py`
- `tests/ingestion/test_authenticated_notice_import.py`
- `tests/ingestion/test_import_authenticated_notice_export_worker.py`

Tasks:

1. Add `consumer_admission_manifest_path` to the import request and CLI.
2. Keep `plan` mode read-only and report-only.
3. Gate `admit_and_materialize` before projection/read-model rebuild when the operation is
   historical/full-scope or writes consumer targets.
4. Restrict projection/read-model rebuild input ids to manifest-admitted ids.
5. Add worker CLIs for manifest build and standalone gate check.
6. Ensure CLI JSON output is deterministic and contains enough evidence for operator review.

Exit criteria:

- Missing manifest blocks unsafe materialization but does not block plan-only dry-runs.
- Valid manifest allows only the selected target-surface writes it names.

### Batch E: Downstream Bypass Guards

Purpose: prevent adjacent downstream paths from reintroducing inventory-scan expansion.

Primary files:

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_consumption_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_consumption_admission.py`
- selected worker modules that rebuild read-model, typed candidates, or pending multimodal units

Tasks:

1. Confirm persistent projection rebuild still rejects implicit full-scope rebuild.
2. Add gate/provenance checks where persistent read-model rebuild or repair can write rows.
3. Ensure pending multimodal drain reads admitted projection units only.
4. Ensure typed candidate materializers require target-surface filters and do not scan
   source-truth inventory directly.

Exit criteria:

- Tests prove source-truth inventory scans cannot expand selected downstream scope after gate.
- Existing selected-notice development fixtures remain explicit and bounded.

### Batch F: Docs And Closeout

Purpose: make the operator procedure and future handoff clear.

Primary files:

- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-9-consumer-admission-manifest-and-release-gate/SUMMARY.md`

Tasks:

1. Add runbook commands for dry-run, manifest build, gate check, and bounded materialization.
2. Record exact non-goals: no live backfill, no query-serving opening, no typed runtime opening.
3. Add summary after implementation with changed files, verification, and remaining deferred
   work.

Exit criteria:

- Docs distinguish collection/import admission from downstream consumer admission.
- Future operators can reproduce the safe path without guessing flags.

## Implementation Sequence

### Step 1: Contract Tests

Write failing tests for:

- manifest schema validation
- decision record serialization
- selection hash stability
- invalid manifest rejection

Expected initial failure: missing module / loader.

### Step 2: Manifest Core

Implement the minimal manifest module in `packages/ingestion-core`, keeping it independent of
Postgres and object-store writers.

Likely files:

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_consumer_admission_manifest.py`
- `tests/ingestion/test_internal_notice_consumer_admission_manifest.py`

### Step 3: Decision Builder

Write failing tests for bundle and inventory decision generation.

Implementation should reuse:

- authenticated notice bundle preparation
- source-truth inventory entries
- routing taxonomy sampler
- existing notice consumption projection constants

Avoid copying taxonomy rules into the new module.

### Step 4: Release Gate

Write failing tests for allow/block behavior, then implement:

- gate request
- gate report
- threshold defaults
- target-surface validators

The gate must be usable without PG or object storage for fixture tests.

### Step 5: Import Integration

Write failing tests around `import_authenticated_notice_export`:

- `admit_and_materialize` with projection/read-model store but no required manifest fails
  closed for full-scope / historical materialization.
- valid manifest allows only admitted notice ids.
- read-model rebuild ignores non-queryable target surfaces.

Then add request and CLI fields:

- `consumer_admission_manifest_path`
- `--consumer-admission-manifest-path`

### Step 6: Worker CLI

Add worker entrypoints:

- `build_internal_notice_consumer_admission_manifest`
- `check_internal_notice_consumer_admission_gate`

The first CLI creates the manifest. The second CLI validates it and emits a gate report.

### Step 7: Runtime Guard Integration

Ensure existing downstream workers do not bypass the manifest:

- read-model rebuild / repair should require completed admission provenance for persistent writes
  where applicable
- pending multimodal drain must only scan projection pending units, not inventory
- typed materializer code paths must fail closed when target-surface filters are missing

This step should use focused tests around existing workers, not a real PG smoke.

### Step 8: Verification

Run targeted gates:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_internal_notice_consumer_admission_manifest \
  tests.ingestion.test_internal_notice_consumer_admission_gate \
  tests.ingestion.test_authenticated_notice_import \
  tests.ingestion.test_import_authenticated_notice_export_worker \
  tests.ingestion.test_authenticated_notice_source_projections
```

Run formatting/lint:

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core \
  apps/ingestion-worker/src/campus_ingestion_worker \
  tests/ingestion

uv run --all-packages ruff format \
  packages/ingestion-core/src/campus_ingestion_core \
  apps/ingestion-worker/src/campus_ingestion_worker \
  tests/ingestion \
  --check

pnpm docs:lint
```

If integration touches Worker/TS contracts, add affected web checks separately. The expected
implementation should be Python ingestion only.

## Acceptance Matrix

- Manifest is the selected-scope authority:
  manifest validation tests and import integration tests.
- Source-truth inventory scan cannot expand scope:
  gate tests and downstream bypass guard tests.
- Read model only accepts queryable notices:
  import/read-model tests with mixed target surfaces.
- Typed candidates stay offline-only:
  builder/gate tests proving candidate surfaces do not enter read model.
- Multimodal drain consumes projection pending units only:
  focused drain/projection tests.
- Operator workflow is reproducible:
  worker CLI tests plus runbook commands.
- No real data write is required for verification:
  all required tests run against fixtures/in-memory stores.

## Acceptance Criteria

- No default code path writes downstream consumer projection/read model from authenticated
  notice source without explicit admission.
- Manifest generation is deterministic and test-covered.
- Gate blocks unsafe writes with machine-readable reason codes.
- Import materialization can be bounded by manifest-selected notice ids.
- Non-queryable candidate surfaces do not leak into notice read model.
- Existing selected-notice projection / multimodal / read-model tests remain passing.
- No real PG, MinIO, portal, or hosted model call is required for test verification.

## Risks

- Existing import currently couples source-truth write, projection rebuild, read-model rebuild,
  and attachment status recording. The integration must not make source archival impossible; it
  should only gate downstream consumer writes.
- Historical tests may implicitly assume default write behavior. Convert those tests to explicit
  materialization mode only when they are genuinely testing writes.
- Routing taxonomy output may not cleanly map to all target surfaces. Add explicit reason codes
  rather than inventing broad fallback writes.
- Gate thresholds should start conservative and configurable; avoid hard-coding production policy
  into scattered call sites.
- Existing tests may use `admit_and_materialize` as a convenient fixture path. Update only the
  tests that are genuinely exercising downstream consumer writes; source-truth import tests should
  stay focused on import behavior.

## Rollback And Safety

- The implementation should be additive until import integration is wired.
- Default import mode remains `plan`; if gate integration regresses, operators can still produce
  dry-run evidence without writes.
- No migration or cleanup command should be introduced in this phase.
- Any test fixture that needs a manifest must create it locally inside the test temp directory.
- Historical backfill and current PG/object-store cleanup remain out of scope unless a separate
  workstream explicitly admits them.

## Out Of Scope Until After This Phase

- Running historical backfill.
- Persisting a new large canonical notice scope.
- Opening chatbot / panel notice query-serving.
- Building service guide / contact / transport materializers from notice candidates.
- Changing authenticated portal collector behavior.
