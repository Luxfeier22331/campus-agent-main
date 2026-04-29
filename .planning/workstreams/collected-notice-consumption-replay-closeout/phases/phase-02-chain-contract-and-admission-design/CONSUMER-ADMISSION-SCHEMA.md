---
doc_type: contract
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Consumer Admission Schema

## Schema Version

`collected_notice_consumer_admission.v1`

## Purpose

Consumer admission manifest is the only authority for deciding whether a captured notice becomes:

- `search_only`
- `downstream_admitted`
- `defer`
- `needs_multimodal`
- `invalid_capture`

It is also the only input Phase 6 downstream replay may use.

## Top-Level Fields

- `schema_version`: fixed string.
- `batch_id`: stable id for this admission batch.
- `generated_at`: ISO timestamp.
- `generated_by`: command or operator identity.
- `source_scope`: object describing corpus, collection, site, source channel, source surface, and selected run ids.
- `baseline`: reset/import baseline; must include `captured_but_not_imported`.
- `dry_run_report_ref`: path/object ref to the dry-run report that produced this manifest.
- `selection_policy`: deterministic policy name and version.
- `entries`: array of admission entries.
- `counts`: count summary by class, target, and status.
- `evidence_refs`: references to Phase 1/Phase 4/Phase 5 evidence artifacts.

## Entry Fields

- `entry_id`: stable id, preferably `notice:<site_id>:<notice_id>`.
- `source_channel`: e.g. `authenticated_notice_portal` or `wechat_official_account`.
- `source_surface`: e.g. `notice`, `file_release`, `wechat_public_notice`.
- `source_corpus`: e.g. `campus_notices`.
- `source_collection`: e.g. `internal_notice`.
- `site_id`: source site id.
- `source_notice_id`: source notice id.
- `source_document_id`: optional source document id after import preview.
- `source_url`: original or canonical source URL.
- `run_id`: collector run id when available.
- `source_object_refs`: array of bucket/key/sha256/byte_size refs.
- `consumption_class`: one of the five classes.
- `target`: required only for `downstream_admitted`.
- `target_surface`: target surface string, if applicable.
- `target_hints`: deterministic hints for downstream materializer.
- `multimodal_policy`: `not_required`, `required`, `pending`, `completed`, `skip`, or `failed`.
- `reason_codes`: deterministic reason codes.
- `preconditions`: required artifacts or checks before execution.
- `operator_notes`: optional notes; not used for deterministic routing.

## Consumption Classes

### `search_only`

The notice is valid and should be searchable, but no structured downstream is opened.

Required:

- `source_object_refs`
- `source_url`
- `reason_codes`

Forbidden:

- `target`

### `downstream_admitted`

The notice is valid, searchable, and accepted into one target.

Required:

- `target`
- `target_surface`
- `target_hints`
- `preconditions`

Allowed targets:

- `regulation`
- `transport_schedule`
- `service_status`

### `defer`

The notice is valid but target semantics are not designed yet.

Required:

- searchable destination.
- `reason_codes` explaining why deferred.

Forbidden:

- typed downstream write.

### `needs_multimodal`

The notice is valid but key facts require OCR / multimodal processing before target readiness.

Required:

- media refs.
- `multimodal_policy=required` or `pending`.
- target hint may be present, but target write is blocked.

### `invalid_capture`

The captured object is not importable.

Required:

- rejection reason.

Forbidden:

- searchable write.
- downstream write.

## Validation Rules

- Every valid captured notice must appear exactly once.
- Every `downstream_admitted` entry must also be searchable.
- `target` is forbidden unless `consumption_class=downstream_admitted`.
- `transport_schedule` requires OCR/table evidence when media carries schedule facts.
- `service_status` requires explicit status/change semantics, not generic service information.
- `regulation` requires rule/document semantics and cannot open query-serving by default.
- Entries with `invalid_capture` must not create searchable rows.
- Entries with `needs_multimodal` cannot be target-ready until Phase 5 output is attached.
