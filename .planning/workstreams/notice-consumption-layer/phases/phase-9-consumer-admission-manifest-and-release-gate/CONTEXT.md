---
doc_type: context
status: active
created: 2026-04-27
updated: 2026-04-27
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Context: Consumer Admission Manifest And Release Gate

## Trigger

Authenticated notice historical source-truth write was previously allowed to run before a
downstream consumer admission gate. The repo has since been cleaned up and
`import_authenticated_notice_export` now defaults to `plan`, but the next layer is still missing:
an explicit manifest and release gate that decides which notice ids may feed
consumption projection, notice read model, typed campus-services candidates, or no-adoption.

## Current Facts

- `import_authenticated_notice_export` has mode support:
  - default `plan`
  - explicit `admit_and_materialize`
  - dry-run report includes `admission_report` and `write_plan`
- `internal_notice_consumption_admission.py` already stores admission batch lifecycle,
  selection source/path/hash, command args, status, and append-only events.
- `internal_notice_consumption_projection.py` can rebuild projection for selected notice ids
  and refuses persistent full-scope rebuild without explicit ids.
- routing taxonomy and eval fixtures already exist:
  - notice family config
  - routing sampler from bundle / inventory
  - routing taxonomy JSONL gate
- target architecture now requires consumer admission manifest and gate before projection,
  read-model, typed materializer, or multimodal drain expands scope.

## Current Gaps

- There is no repo-owned consumer admission manifest schema yet.
- There is no deterministic builder that converts bundle dry-run / source-truth inventory
  evidence into selected downstream consumer decisions.
- Existing consumer admission batch metadata records selection source/path/hash, but it does
  not yet prove per-notice target-surface authorization.
- `admit_and_materialize` can be made explicit, but downstream projection/read-model rebuild
  still needs a manifest-aware fail-close gate for historical or full-scope materialization.
- Typed campus-services candidates and multimodal drain have target-surface semantics, but
  need an admission boundary that prevents inventory rescans from silently adding scope.

## Goal

Add a repo-owned consumer admission manifest and gate for
`authenticated_notice_portal -> campus_notices/internal_notice`.

The goal is not to run a backfill. The goal is to make future materialization safe,
auditable, and bounded.

## Non-Goals

- No real portal collection.
- No historical full backfill.
- No production PG / object-store writes during implementation.
- No runtime query-serving opening.
- No campus-services typed materializer implementation beyond enforcing target-surface bounds.
- No rework of existing notice family taxonomy unless a test fixture proves a blocking mismatch.

## Planning Assumptions

- Implementation stays in `packages/ingestion-core` plus `apps/ingestion-worker` CLI shells.
- Tests use local fixtures and in-memory stores unless an existing test already owns a
  persistent-store fixture.
- The manifest is an offline release artifact. It can be generated from dry-run evidence or a
  selected inventory file, but it does not itself collect portal data.
- Passing the release gate authorizes only the named offline write targets for the selected ids;
  it does not open chatbot, panel, runtime query-serving, or a typed campus-services tool.

## Source Documents

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `.planning/workstreams/notice-consumption-layer/README.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
