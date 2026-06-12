---
doc_type: reference
status: active
created: 2026-06-12
updated: 2026-06-12
---
<!-- markdownlint-disable MD013 -->

# Ingestion Python CLI Clean-Target Triage

## Scope

This document reviews the public Python CLI surface exposed by
`apps/ingestion-worker` and classifies each entrypoint against the clean-target
ingestion architecture.

Reviewed surface:

- `apps/ingestion-worker/pyproject.toml` `[project.scripts]`
- 110 public `campus-ingestion-*` entrypoints
- current target boundary from ADR-0050 and the data-plane architecture
- current on-demand runner, wrapper scripts, systemd examples, runbooks and
  operator command references

Out of scope:

- deleting modules in this pass
- proving every private helper module is dead code
- preserving historical CLI compatibility

## Decision Rule

The default decision for an old Python CLI is `delete`.

A CLI may survive only as evidence for one of these capabilities:

- current production ingestion lifecycle
- current release gate or publish lifecycle
- current operator-safe projection/read model
- explicit data recovery or backup SLA
- Python-only adapter work, such as MinerU, OCR, ML or legacy document
  extraction

If a capability is still needed, it should be rebuilt into the target runtime
instead of preserving the old CLI:

| Target lane | Owner | Allowed work |
| --- | --- | --- |
| `rebuild-ts` | ingestion-control / TS packages | admission, registry, lease, retry, dead-letter, closeout, operator projection, source-channel orchestration |
| `rebuild-rust` | `packages/ingestion-kernels-rs` | deterministic file-level kernels: validation, chunk packing, hash, dedup, diff, manifest checks |
| `python-adapter-only` | worker adapter process | MinerU, OCR, ML, legacy Office/document extraction, domain extraction that truly needs Python ecosystem |
| `ops-rehome` | infra/ops lane, preferably TS or shell with strict guards | backup, restore, seed, object-store hygiene, Qdrant GC |
| `archive` | docs/reference/archive or runbook archive | historical evidence and one-off recovery notes |
| `delete` | no target owner | smoke, preview, backfill, reset, repair, replay, obsolete migration residue |

## High-Level Findings

- The public Python surface is too large for the target architecture: 110 public
  CLI entrypoints and 238 top-level Python modules under
  `apps/ingestion-worker/src/campus_ingestion_worker`.
- The on-demand batch runner is a transitional Python orchestrator. It still
  owns child-process sequencing, reports and batch kinds for official web,
  authenticated notice, internal notice and WeChat lanes. The clean target is
  ingestion-control-owned task lifecycle, not a larger Python batch runner.
- Only two collections currently have task registries:
  `regulations/student_rules` and `curriculum/curriculum_plan`. Those registries
  still use Python adapters for several lifecycle steps and Rust kernels only
  for deterministic document-unit/chunk checks. Treat this as a migration
  sketch, not proof that Python should remain the default implementation lane.
- `official_web/stable_reference` and authenticated notice still have active
  runbook/script/systemd references into old Python CLIs. Those are real
  migration blockers, but not reasons to preserve the old shape.
- Qdrant backup/GC and serving seed commands are operational capabilities
  misplaced inside `apps/ingestion-worker`; they should be rehomed or rebuilt,
  not treated as ingestion collection logic.

## Capability-Level Decisions

| Capability area | Current Python surface | Clean-target decision |
| --- | --- | --- |
| Student rules | registry exists, old release/materialization CLIs still nearby | rebuild as TS task family plus Rust deterministic kernels; Python only for extraction adapter |
| Curriculum plan | registry exists, program-semester materialization CLI remains | rebuild source/projection lifecycle in TS; move deterministic validation/chunking to Rust; Python only if MinerU/OCR is required |
| Official web stable reference | handoff, release gate and release task CLIs are still active in runbooks | rebuild into ingestion-control tasks; remove Python handoff/release task lifecycle |
| Authenticated notice | queue, closeout, multimodal, import and cleanup CLIs remain broad | split: TS lifecycle and projection, Python adapter for OCR/multimodal/legacy Office, archive historical replay/backfill |
| WeChat public notices | projection, multimodal drain, smoke, purge/reset CLIs | rebuild admitted source projection in TS; Python only for multimodal adapter; delete smoke/purge/reset |
| Campus services structured projections | service guide/status/transport CLIs | rebuild as TS projection tasks sourced from declared source truth |
| Qdrant/seed/backup | backup, GC, seed export/restore CLIs | rehome to ops lane; prefer TS/shell/Rust checks, not ingestion-worker Python |
| Historical regulation recovery | historical audit/backfill/chunk replay CLIs | archive evidence, delete executable surface |

## Entrypoint Triage

| # | CLI | Current capability | Decision | Target / next action |
| --- | --- | --- | --- | --- |
| 1 | `campus-ingestion-preflight` | Python worker deployment checks | `rebuild-ts` | Replace with ingestion-control/executor health checks; keep only during transition. |
| 2 | `campus-ingestion-audit-official-web-projection-chunking` | Official-web chunk quality audit | `archive` | Rebuild only as TS release validation plus Rust chunk validator if still required. |
| 3 | `campus-ingestion-compare-online-ocr` | OCR comparison diagnostic | `archive` | Move useful cases into evals; no public CLI. |
| 4 | `campus-ingestion-consume-official-web-handoffs` | Official-web handoff consumer | `rebuild-ts` | Rebuild as ingestion-control task admission/consumer. |
| 5 | `campus-ingestion-run-on-demand-batch` | Python batch orchestrator | `delete` | Retire after task registry/executor covers remaining active lanes. |
| 6 | `campus-ingestion-prune-reports` | On-demand report retention | `delete` | Replace with control-plane telemetry retention. |
| 7 | `campus-ingestion-backfill-official-web-history` | Historical official-web backfill | `archive` | Keep evidence only; do not preserve executable path. |
| 8 | `campus-ingestion-backfill-authenticated-notice-browser-urls` | Historical authenticated-notice URL backfill | `delete` | Remove unless a current recovery SLA names it. |
| 9 | `campus-ingestion-audit-authenticated-notice-browser-url-bundles` | Historical URL bundle audit | `archive` | Archive evidence; no target task. |
| 10 | `campus-ingestion-audit-collection-runtime-state` | Runtime/profile audit | `rebuild-ts` | Convert into config lint or ingestion-control validation. |
| 11 | `campus-ingestion-select-authenticated-notice-bundle` | Manual bundle selection | `archive` | Replace with explicit task admission input if still needed. |
| 12 | `campus-ingestion-build-service-guide-projection` | Structured service guide projection | `rebuild-ts` | Rebuild as declared projection task. |
| 13 | `campus-ingestion-build-service-status-projection` | Structured service status projection | `rebuild-ts` | Rebuild as declared projection task. |
| 14 | `campus-ingestion-build-transport-schedule-projection` | Structured transport projection | `rebuild-ts` | Rebuild task lifecycle in TS; keep OCR only as adapter. |
| 15 | `campus-ingestion-manage-structured-projection-release` | Structured projection release | `rebuild-ts` | Move release state and publish to ingestion-control. |
| 16 | `campus-ingestion-smoke-structured-projection-postgres` | Postgres smoke | `delete` | Replace with tests/integration lane. |
| 17 | `campus-ingestion-collection-rename-registry-backfill` | One-off rename backfill | `delete` | Remove executable path after archive check. |
| 18 | `campus-ingestion-normalize-authenticated-notice-legacy-office-attachment` | Legacy Office normalization | `python-adapter-only` | Keep only as internal document extraction adapter. |
| 19 | `campus-ingestion-check-authenticated-notice-attachment-fetch-status` | Attachment fetch status check | `rebuild-ts` | Replace with operator projection/read model. |
| 20 | `campus-ingestion-check-authenticated-notice-reference-only-attachments` | Attachment classification check | `delete` | Fold any still-valid rule into TS validation. |
| 21 | `campus-ingestion-build-authenticated-notice-attachment-fetch-request-manifest` | Attachment fetch manifest builder | `rebuild-ts` | Rebuild as task planner/admission. |
| 22 | `campus-ingestion-import-authenticated-common-download-export` | Authenticated source export import | `rebuild-ts` | Rebuild source-channel import in TS. |
| 23 | `campus-ingestion-import-authenticated-notice-export` | Authenticated notice export import | `rebuild-ts` | Rebuild source-channel import in TS. |
| 24 | `campus-ingestion-import-authenticated-notice-file-release-export` | File-release export import | `rebuild-ts` | Rebuild source-channel import in TS. |
| 25 | `campus-ingestion-enqueue-authenticated-notice-collector-run` | Collector run enqueue | `rebuild-ts` | Move admission/idempotency to ingestion-control. |
| 26 | `campus-ingestion-create-authenticated-notice-smoke-replay-run` | Smoke replay setup | `delete` | Replace with test fixture if still useful. |
| 27 | `campus-ingestion-enqueue-verified-authenticated-notice-runs` | Verified run enqueue | `rebuild-ts` | Move to control-plane admission. |
| 28 | `campus-ingestion-consume-authenticated-notice-ingest-queue` | Authenticated notice queue consumer | `rebuild-ts` | Rebuild as ingestion-control task executor lane. |
| 29 | `campus-ingestion-consume-source-handoff-executions` | Source handoff execution consumer | `rebuild-ts` | Rebuild generic source-handoff lifecycle in TS. |
| 30 | `campus-ingestion-smoke-authenticated-notice-ingest-queue-e2e` | Queue E2E smoke | `delete` | Move coverage to repeatable integration tests. |
| 31 | `campus-ingestion-show-source-handoff-executions` | Source handoff status display | `rebuild-ts` | Replace with operator-safe projection route/query. |
| 32 | `campus-ingestion-show-authenticated-document-holding-status` | Document holding status display | `rebuild-ts` | Replace with operator-safe projection route/query. |
| 33 | `campus-ingestion-audit-authenticated-notice-object-locators` | Object locator audit | `ops-rehome` | Rebuild as object-store validation with strict inventory input. |
| 34 | `campus-ingestion-reset-authenticated-common-download-downstream-state` | Destructive downstream reset | `delete` | Do not preserve reset CLI; model repair as explicit migration if needed. |
| 35 | `campus-ingestion-record-authenticated-notice-attachment-fetch-status` | Attachment fetch status write | `rebuild-ts` | Replace with typed task event/admission API. |
| 36 | `campus-ingestion-show-authenticated-notice-attachment-fetch-status` | Attachment fetch status display | `rebuild-ts` | Replace with operator-safe projection. |
| 37 | `campus-ingestion-audit-authenticated-notice-source-attachment-keys` | Source bucket attachment audit | `ops-rehome` | Rebuild outside ingestion-worker; no collection CLI. |
| 38 | `campus-ingestion-cleanup-authenticated-notice-source-attachment-keys` | Source bucket attachment cleanup | `ops-rehome` | Rebuild with inventory-only destructive guard. |
| 39 | `campus-ingestion-cleanup-derived-bucket-unexpected-keys` | Derived bucket cleanup | `ops-rehome` | Rebuild as ops cleanup, not ingestion CLI. |
| 40 | `campus-ingestion-audit-authenticated-notice-closeout-operations-retention` | Closeout operation retention audit | `ops-rehome` | Move to retention policy tooling. |
| 41 | `campus-ingestion-cleanup-authenticated-notice-closeout-operations` | Closeout operation cleanup | `ops-rehome` | Move to retention policy tooling. |
| 42 | `campus-ingestion-audit-authenticated-notice-source-run-retention` | Source run retention audit | `ops-rehome` | Move to retention policy tooling. |
| 43 | `campus-ingestion-cleanup-authenticated-notice-source-runs` | Source run cleanup | `ops-rehome` | Move to retention policy tooling. |
| 44 | `campus-ingestion-official-web-handoff-dev` | Official-web dev handoff receiver | `delete` | Dev-only CLI; replace with source-channel fixture or task admission smoke. |
| 45 | `campus-ingestion-import-official-web-projection` | Official-web projection import | `rebuild-ts` | Rebuild source-truth/projection import in TS. |
| 46 | `campus-ingestion-admit-official-web-release-gate` | Official-web release gate admission | `rebuild-ts` | Move to ingestion-control admission. |
| 47 | `campus-ingestion-release-official-web-target` | Official-web target release | `rebuild-ts` | Rebuild release task lifecycle in TS; deterministic checks can move to Rust. |
| 48 | `campus-ingestion-release-official-web-selected-write` | Official-web selected-write publish | `rebuild-ts` | Rebuild as task family, not Python release CLI. |
| 49 | `campus-ingestion-run-official-web-release-task` | Official-web release task executor | `rebuild-ts` | Move task execution shell to TS; use Rust kernels where useful. |
| 50 | `campus-ingestion-run-official-web-university-collection` | Official-web collection runner | `rebuild-ts` | Rebuild source-channel collection/admission in TS. |
| 51 | `campus-ingestion-materialize-curriculum-program-semester-facts` | Curriculum structured facts | `rebuild-ts` | Rebuild projection materialization in TS; deterministic normalization can move to Rust. |
| 52 | `campus-ingestion-publish-document-reader-assets` | Document reader asset publish | `rebuild-ts` | Move publish lifecycle to docs/app-api/ingestion-control boundary. |
| 53 | `campus-ingestion-export-serving-seed` | Serving seed export | `ops-rehome` | Rebuild as ops handoff tooling outside ingestion-worker. |
| 54 | `campus-ingestion-verify-serving-seed` | Serving seed verification | `ops-rehome` | Rebuild with checksum/manifest validation; Rust is acceptable for file checks. |
| 55 | `campus-ingestion-restore-serving-seed` | Serving seed restore | `ops-rehome` | Rebuild as explicit recovery workflow outside collection CLI. |
| 56 | `campus-ingestion-qdrant-filesystem-backup-create` | Qdrant filesystem backup | `ops-rehome` | Move to infra/ops lane; not ingestion-worker Python. |
| 57 | `campus-ingestion-qdrant-backup-cleanup` | Qdrant backup cleanup | `ops-rehome` | Move to infra/ops lane. |
| 58 | `campus-ingestion-audit-qdrant-backup-retention` | Qdrant backup retention audit | `ops-rehome` | Move to infra/ops lane. |
| 59 | `campus-ingestion-qdrant-gc-check` | Qdrant collection GC check | `ops-rehome` | Rebuild as release/ops safety gate. |
| 60 | `campus-ingestion-qdrant-gc-delete` | Qdrant collection GC delete | `ops-rehome` | Rebuild with strict release-manifest/backup gate. |
| 61 | `campus-ingestion-release-registry-scope` | Registry scope release | `rebuild-ts` | Rebuild release lifecycle in TS; Rust for manifest/chunk validation. |
| 62 | `campus-ingestion-scope-alias` | Scope alias governance | `rebuild-ts` | Convert to config/registry validation. |
| 63 | `campus-ingestion-admit-regulation-rag-release` | Regulation RAG release admission | `rebuild-ts` | Move admission to ingestion-control. |
| 64 | `campus-ingestion-enqueue-regulation-rag-release-candidates` | Regulation release candidate enqueue | `rebuild-ts` | Move to task registry/admission. |
| 65 | `campus-ingestion-process-regulation-rag-release-candidates` | Regulation release candidate processing | `rebuild-ts` | Rebuild task executor in TS; Rust for deterministic file work. |
| 66 | `campus-ingestion-probe-regulation-rag-release-runtime` | Runtime probe | `delete` | Replace with release/eval tests, not CLI. |
| 67 | `campus-ingestion-re-audit-regulation-rag-release` | Regulation release re-audit | `rebuild-ts` | Keep only as release validation if current gate requires it. |
| 68 | `campus-ingestion-repair-rag-release-metadata` | Metadata repair | `delete` | Do not preserve repair CLI; model as explicit migration if recurring. |
| 69 | `campus-ingestion-reconstruct-rag-release-manifests` | Manifest reconstruction/recovery | `ops-rehome` | Rebuild as recovery workflow with TS orchestration and Rust file checks. |
| 70 | `campus-ingestion-generate-regulation-rag-release-selected-replay` | Selected replay generation | `archive` | Archive evidence; no target task. |
| 71 | `campus-ingestion-backfill-collected-notice-regulation-canonical` | Historical regulation canonical backfill | `delete` | Remove executable path after evidence archive check. |
| 72 | `campus-ingestion-backfill-missing-canonical-markdown` | Missing markdown backfill | `delete` | Remove executable path after data recovery review. |
| 73 | `campus-ingestion-audit-historical-regulation-denominator-expansion` | Historical denominator audit | `archive` | Archive evidence only. |
| 74 | `campus-ingestion-audit-historical-regulation-school-level-inventory` | Historical school-level inventory audit | `archive` | Archive evidence only. |
| 75 | `campus-ingestion-audit-historical-regulation-school-level-owner-recovery` | Historical owner recovery audit | `archive` | Archive evidence only. |
| 76 | `campus-ingestion-backfill-historical-regulation-denominator-expansion` | Historical denominator backfill | `delete` | Remove executable path. |
| 77 | `campus-ingestion-plan-historical-regulation-chunk-backfill` | Historical chunk backfill plan | `delete` | Remove executable path. |
| 78 | `campus-ingestion-prepare-historical-regulation-chunk-backfill` | Historical chunk backfill prepare | `delete` | Remove executable path. |
| 79 | `campus-ingestion-promote-collected-notice-regulation-manual-review-batch` | Manual regulation promotion | `rebuild-ts` | Rebuild as explicit admitted promotion task if still needed. |
| 80 | `campus-ingestion-rebuild-internal-notice-consumption-projection` | Internal notice projection rebuild | `rebuild-ts` | Move projection rebuild to TS task family. |
| 81 | `campus-ingestion-show-internal-notice-consumption-projection-status` | Internal notice projection status | `rebuild-ts` | Replace with operator-safe projection route/query. |
| 82 | `campus-ingestion-list-internal-notice-consumption-admissions` | Internal notice admission list | `rebuild-ts` | Replace with operator-safe projection route/query. |
| 83 | `campus-ingestion-list-internal-notice-service-status-candidates` | Service-status candidate listing | `rebuild-ts` | Replace with structured projection/operator query. |
| 84 | `campus-ingestion-audit-internal-notice-regulation-selected-cohort` | Selected cohort audit | `archive` | Keep evidence only unless release gate requires rebuild. |
| 85 | `campus-ingestion-build-internal-notice-regulation-owner-recovery` | Regulation owner recovery | `python-adapter-only` | Python allowed only for extraction; TS owns task lifecycle. |
| 86 | `campus-ingestion-rebuild-internal-notice-read-model` | Internal notice read model rebuild | `rebuild-ts` | Move read-model rebuild to TS task family. |
| 87 | `campus-ingestion-project-wechat-public-notices` | WeChat source projection | `rebuild-ts` | Rebuild admitted source projection in TS. |
| 88 | `campus-ingestion-project-wechat-public-notices-from-capture-run` | WeChat source projection alias | `delete` | Remove duplicate CLI alias; use target task admission. |
| 89 | `campus-ingestion-drain-wechat-public-notice-pending-multimodal` | WeChat multimodal drain | `python-adapter-only` | TS lifecycle with Python multimodal adapter only. |
| 90 | `campus-ingestion-smoke-wechat-public-notice-phase5` | WeChat phase smoke | `delete` | Move coverage to tests if needed. |
| 91 | `campus-ingestion-smoke-wechat-public-notice-runtime` | WeChat runtime smoke | `delete` | Move coverage to tests/integration lane. |
| 92 | `campus-ingestion-audit-wechat-public-notice-state` | WeChat state audit | `rebuild-ts` | Replace with operator projection validation if needed. |
| 93 | `campus-ingestion-purge-wechat-public-notices` | WeChat purge | `delete` | Do not preserve purge CLI; model destructive admin flow explicitly if needed. |
| 94 | `campus-ingestion-reset-wechat-public-notice-downstream-state` | WeChat downstream reset | `delete` | Remove reset CLI; use explicit migration if recurring. |
| 95 | `campus-ingestion-check-internal-notice-read-model-consistency` | Read-model consistency check | `rebuild-ts` | Replace with TS validation/read-model check. |
| 96 | `campus-ingestion-repair-internal-notice-read-model-consistency` | Read-model repair | `delete` | Do not preserve repair CLI; model as migration if recurring. |
| 97 | `campus-ingestion-check-internal-notice-processing-gaps` | Processing gap check | `rebuild-ts` | Replace with operator projection validation. |
| 98 | `campus-ingestion-process-internal-notice-multimodal` | Internal notice multimodal processing | `python-adapter-only` | TS lifecycle with Python multimodal adapter only. |
| 99 | `campus-ingestion-drain-internal-notice-pending-multimodal` | Internal notice multimodal drain | `python-adapter-only` | Replace drain lifecycle with ingestion-control; keep adapter only. |
| 100 | `campus-ingestion-preview-collected-notice-media-extraction-closeout` | Media extraction preview | `delete` | Remove preview CLI. |
| 101 | `campus-ingestion-schedule-router-dry-run` | Schedule routing dry run | `archive` | Move examples to evals if still useful. |
| 102 | `campus-ingestion-schedule-image-ocr-dry-run` | Schedule OCR dry run | `python-adapter-only` | Keep OCR logic only as adapter/eval fixture. |
| 103 | `campus-ingestion-admit-schedule-image-ocr-results` | Schedule OCR result admission | `rebuild-ts` | Move admission to ingestion-control. |
| 104 | `campus-ingestion-admit-reviewed-attachment-ocr-results` | Reviewed OCR result admission | `rebuild-ts` | Move admission to ingestion-control. |
| 105 | `campus-ingestion-schedule-batch-preview-gate` | Schedule batch preview gate | `delete` | Rebuild only if product release gate requires it. |
| 106 | `campus-ingestion-schedule-transport-preview-gate` | Transport preview gate | `delete` | Rebuild only if product release gate requires it. |
| 107 | `campus-ingestion-smoke-internal-notice-consumption-runtime` | Internal notice runtime smoke | `delete` | Move coverage to tests/integration lane. |
| 108 | `campus-ingestion-evaluate-internal-notice-multimodal-decisions` | Multimodal decision eval | `archive` | Move active evals to `packages/evals` or tests. |
| 109 | `campus-ingestion-validate-internal-notice-chunking` | Internal notice chunk validation | `rebuild-rust` | Rebuild deterministic chunk validation as Rust kernel with TS task wrapper. |
| 110 | `campus-ingestion-run-control-task-once` | Current Python executor seam smoke | `rebuild-ts` | Treat as temporary proof shell; target executor should be TS with Python adapter subprocess only when required. |

## First Removal Candidates

These entrypoints have the clearest delete/archive signal and should be removed
from public CLI exposure first, after any referenced runbook sections are
archived:

- all `smoke-*` CLIs
- all `preview-*` CLIs
- all `backfill-historical-*` and `audit-historical-*` CLIs
- `campus-ingestion-create-authenticated-notice-smoke-replay-run`
- `campus-ingestion-collection-rename-registry-backfill`
- `campus-ingestion-generate-regulation-rag-release-selected-replay`
- `campus-ingestion-project-wechat-public-notices-from-capture-run`
- destructive reset/repair/purge CLIs unless a current recovery SLA names them

## Migration Blockers

The following are blockers to simply deleting the Python command surface:

- `scripts/run-ingestion-worker-batch.sh` and wrapper scripts still invoke the
  old on-demand batch runner.
- local systemd examples still run Python wrapper scripts for official web,
  internal notice, authenticated notice and WeChat.
- active runbooks still reference official-web handoff/release, authenticated
  notice closeout, Qdrant backup/GC and source bucket cleanup CLIs.
- `apps/ingestion-worker/README.md` still documents many old commands as normal
  operation surface.

These blockers should be resolved by replacing the capability with TS/Rust
target runtime or moving historical instructions into archive, not by wrapping
the old CLIs in the new executor seam.

## Clean-Target Execution Order

1. Update docs and runbooks so old Python CLIs are marked transitional or
   archived, never target truth.
2. Remove public CLI exposure for delete/archive categories while leaving
   private modules temporarily in place for dead-code analysis.
3. Rebuild the active official-web and authenticated-notice lifecycle as
   ingestion-control task families in TS.
4. Rebuild student-rules and curriculum materialization/projection paths as TS
   tasks with Rust deterministic kernels.
5. Convert OCR/MinerU/multimodal/legacy Office logic into private Python
   adapters invoked by target executor tasks.
6. Rehome backup, restore, seed and Qdrant GC operations to ops tooling.
7. Delete remaining unreferenced Python modules and tests after import/dead-code
   checks are green.
