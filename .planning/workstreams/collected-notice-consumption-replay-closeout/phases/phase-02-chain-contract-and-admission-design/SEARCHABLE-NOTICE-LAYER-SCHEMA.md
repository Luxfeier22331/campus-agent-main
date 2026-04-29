---
doc_type: contract
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Searchable Notice Layer Schema

## Schema Version

`collected_notice_searchable_unit.v1`

## Purpose

The searchable notice layer is the universal destination for valid captured notices.

It is not a typed downstream target. It provides discovery, text search, source provenance, and handoff evidence for future consumers.

## Required Fields

- `unit_id`: stable searchable unit id.
- `source_channel`: original source channel.
- `source_surface`: original source surface.
- `source_corpus`: source corpus.
- `source_collection`: source collection.
- `site_id`: source site id.
- `source_notice_id`: source notice id.
- `title`: source title.
- `published_at`: source publish/release time when available.
- `source_url`: browser/canonical source URL or fallback.
- `source_home_url`: portal/source home URL when available.
- `source_object_refs`: source object refs used to build this row.
- `run_provenance`: collector run id and import/replay batch ids.
- `body_text`: normalized source body text or excerpt.
- `attachment_refs`: attachment/media refs.
- `multimodal_status`: `not_required`, `pending`, `completed`, `failed`, or `skipped`.
- `search_text`: bounded searchable text.
- `visibility_level`: e.g. `internal`, `restricted`, `public`.
- `entitlement_groups`: authorization projection groups when applicable.
- `admission_batch_id`: consumer admission batch that allowed searchable creation.
- `created_at`
- `updated_at`

## Optional Fields

- `body_excerpt`
- `normalized_markdown_object_key`
- `ocr_text_refs`
- `layout_refs`
- `table_refs`
- `target_hints`
- `defer_reason_codes`
- `invalid_reason_codes`

## Searchable Text Composition

`search_text` should be built from:

1. title
2. organization / department
3. source body text
4. attachment extracted text
5. OCR / multimodal normalized text
6. important source URL metadata

It must not include raw HTML boilerplate, unbounded provider response JSON, or unrelated operator notes.

## Provenance Rules

- Every searchable row must trace to source object refs.
- OCR text must trace to a media ref and attempt id.
- Attachment text must trace to attachment ref and source object key.
- Downstream target rows must be able to trace back to searchable unit id.

## Non-Goals

- This layer does not replace `regulation`, `transport_schedule`, or `service_status`.
- This layer does not open public serving by itself.
- This layer does not infer target truth without consumer admission.

