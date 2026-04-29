---
doc_type: contract
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Notice Multimodal Consumption Contract

## Scope

`notice_multimodal_consumption` is the notice-side contract for visual or
attachment-backed content that is already captured but not yet searchable as text.
It covers candidate selection, lifecycle state, attempts, provider output refs,
normalized text/layout artifacts, searchable merge input, and downstream
readiness evidence.

It does not own provider execution, prompt design, typed target extraction, or
query serving. Those remain in the existing OCR/multimodal processors and
downstream target consumers.

## Candidate

Each media object or blocked source-body recovery item becomes one candidate.
The identity is deterministic and includes source surface, site, notice id,
media ref, media object key, processing family, priority, and provenance back to
the Phase 4 searchable unit.

Candidate states:

- `pending`: processable media exists and no normalized output is available yet.
- `completed`: a terminal attempt produced searchable normalized output.
- `skipped`: policy intentionally excludes the media, with skip reason.
- `failed`: processing cannot proceed without source repair or unsupported media
  handling.

High-value `transport_schedule`, `service_status`, and `regulation` media must
not be skipped by low-value poster policy.

## Attempt Mapping

Existing attempt tables map into the unified lifecycle:

- `ingestion_projection.internal_notice_schedule_image_ocr_attempt`
  maps schedule image OCR attempts.
- `ingestion_projection.internal_notice_multimodal_attempt`
  maps internal notice image/PDF/Office multimodal attempts.
- `ingestion_projection.wechat_public_notice_multimodal_attempt`
  maps WeChat public notice inline image attempts.

Attempt rows must record provider, model, attempt number, status, source object
identity, admission batch id, and normalized output refs when present.

## Normalized Outputs

A completed attempt must expose separate refs for:

- raw provider response
- plain extracted text
- layout/table elements
- searchable merge input

Searchable merge input must preserve provenance: candidate id, source notice id,
media ref id, source object ref, provider/model, and attempt id.

## Dry-Run Boundary

Phase 5 readiness is read-only. It does not call providers, write object storage,
or write Postgres tables. It only produces manifests proving which candidates
would be processed and where normalized output would be attached later.
