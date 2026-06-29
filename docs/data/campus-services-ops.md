---
doc_type: data
truth_scope: data
owner_boundary: domains/campus-services
status: active
created: 2026-06-11
updated: 2026-06-28
---

# Campus Services Ops Data

## Boundary

This document owns the app-api ops-store data shape for the current campus
services capability: shuttle transport overrides and published release
snapshots.

Current scope:

- operator-safe source attestations
- bounded transport overrides
- published current-effective release snapshots
- operator-safe audit events

Out of scope:

- generic service status lookup
- service catalog, service guide, process guide or contact directory content
- raw notice/chat/screenshot/file retention
- execution-control transport tool request/result schema
- browser status projection schema

Human transport capability truth lives in `../domains/transport.md`.

## Flow

```text
operator-safe attestation
-> bounded transport override draft
-> app-api preview
-> app-api publish release snapshot
-> execution-control transport read model consumption
```

The ops store records curated overlay facts. It does not rebuild the baseline
timetable and must not become a generic campus services content database.

## Logical Schema

App-api Drizzle-owned schema: `campus_services_ops`.

### `source_attestations`

Purpose: operator-safe summary of a verified source.

Minimum fields:

- `attestation_id`
- `source_type`
- `summary`
- `operator_notes`
- `confirmed_at`
- `status`
- `created_at`
- `created_by_json`

Rules:

- `summary` is a fact summary, not raw evidence.
- `operator_notes` must not store raw chat, screenshots, OCR payloads,
  attachment bytes or object-store locators.
- Long-term evidence retention belongs to the owning source channel, not this
  ops store.

### `transport_overrides`

Purpose: temporary shuttle/transport service overlay.

Minimum fields:

- `override_id`
- `route_id`
- `display_name`
- `service_status`
- `message`
- `effective_from`
- `effective_until`
- `source_attestation_ids_json`
- `review_state`
- `created_at`
- `created_by_json`
- `updated_at`
- `updated_by_json`

Rules:

- Every override must have a bounded effective window.
- `effective_until` must be later than `effective_from`.
- `route_id` must point to a route identity known by the structured transport
  runtime.
- `service_status` is the per-route transport override state. It is not a
  generic campus services status lookup surface.
- Only `ready_for_publish` overrides inside the current effective window enter
  release preview/publish.

### `releases`

Purpose: published current-effective transport overlay snapshot.

Minimum fields:

- `release_id`
- `status`
- `notes`
- `item_count`
- `current_effective_json`
- `created_at`
- `created_by_json`
- `published_at`
- `published_by_json`

Rules:

- publish writes release and audit event atomically.
- no published release means overlay currentness is unverifiable; it does not
  mean "no override".
- runtime consumption reads published release/projection/read model, not raw
  attestations or notice/chat content.

### `audit_events`

Purpose: operator-safe change audit.

Minimum fields:

- `audit_event_id`
- `action`
- `object_type`
- `object_id`
- `summary`
- `before_json`
- `after_json`
- `actor_json`
- `occurred_at`

Rules:

- `before_json` and `after_json` store sanitized summaries only.
- audit rows must not contain raw chat, screenshots, attachment bytes, object
  keys, OCR payloads, provider payloads or sink raw events.

## Runtime Boundary

Execution-control may consume the latest published release as part of the
transport schedule read model. It must fail closed when currentness, source
truth, route identity or effective window cannot be proven.

The ops store is not a generic RAG collection and is not an app-api loopback
query seam for model-visible tools.
