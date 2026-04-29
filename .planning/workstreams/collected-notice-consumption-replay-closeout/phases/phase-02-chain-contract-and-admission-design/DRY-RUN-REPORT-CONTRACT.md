---
doc_type: contract
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Dry-Run Report Contract

## Purpose

Every reset, reimport, searchable projection, multimodal, and downstream replay command in this workstream must produce a deterministic dry-run report before any write mode can run.

Dry-run reports are not advisory logs. They are the input evidence for operator review, backup planning, explicit write manifests, and post-execute consistency checks.

## No-Write Rules

Dry-run mode must not write:

- source bucket objects.
- database source-truth rows.
- document holding rows.
- raw asset registry rows.
- document registry rows.
- searchable read-model rows.
- consumer admission rows.
- OCR or multimodal attempt rows.
- downstream stage, release, current pointer, or read-model rows.
- audit rows that would later be interpreted as runtime truth.

Dry-run mode may write only local workstream evidence files when explicitly invoked from repo planning commands.

## Required Top-Level Fields

- `schema_version`: fixed report schema version.
- `report_id`: stable id for the command run.
- `generated_at`: ISO timestamp.
- `generated_by`: command and operator identity.
- `mode`: must be `dry_run`.
- `phase`: workstream phase id.
- `input_refs`: source manifests, run ids, object refs, and evidence artifacts consumed.
- `selection_policy`: deterministic policy name and version.
- `planned_writes`: rows or objects that would be created.
- `planned_deletes`: rows or objects that would be deleted.
- `planned_updates`: rows or objects that would be updated.
- `planned_skips`: valid inputs intentionally skipped, with reason codes.
- `planned_defers`: valid inputs deferred to future consumers, with reason codes.
- `planned_blocks`: inputs blocked from execution until preconditions are satisfied.
- `counts`: table/object/target/count summary.
- `preconditions`: checks required before write mode.
- `backup_requirements`: tables, objects, and row ids that must be backed up before write mode.
- `write_manifest_candidate`: deterministic manifest payload or manifest ref for write mode.
- `verification_queries`: post-write checks that must match dry-run counts.

## Report Classes

### Reset Dry-Run

Must include table-level and row-level delete/update plans for:

- source-truth / holding / registry import rows.
- projection/read-model/admission rows.
- OCR/multimodal attempts.
- typed downstream rows.
- notice-derived `service_guide` rows selected by source lineage.

### Reimport Dry-Run

Must include:

- captured object inputs.
- importable source-truth candidates.
- holding/document candidates.
- invalid captures.
- searchable unit candidates.
- consumer admission candidates.

### Multimodal Dry-Run

Must include:

- media candidates.
- provider prerequisites.
- attempt candidates.
- normalized output destinations.
- searchable merge candidates.
- downstream readiness blockers.

### Downstream Replay Dry-Run

Must include:

- admission batch id.
- accepted entries.
- blocked entries.
- target-specific materialization candidates.
- stage/release candidates.
- current promotion candidates, if explicitly requested.

Current promotion must never be implied by replay dry-run.

## Execute Coupling

Write mode must consume a dry-run-derived write manifest.

Write mode must reject execution when:

- the dry-run report is missing.
- report `mode` is not `dry_run`.
- report schema version is unsupported.
- report input refs do not match the current execution input refs.
- backup requirements have not been satisfied.
- the operator confirmation does not reference the dry-run report id.

Post-execute reports must include the dry-run report id and compare actual writes/deletes/updates against dry-run counts.
