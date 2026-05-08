---
doc_type: contract
status: backlog
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 MD060 -->

# Notice Change Set Contract

## Purpose

`notice_change_set` is the bounded artifact that lets the runtime answer:

- stable baseline says X, but a recent official notice temporarily changes Y
- a notice has expired and should not override current baseline
- multiple notices conflict, so the system should clarify or fail closed
- the user asks which notice supports a transport answer

It is not a raw notice bundle, raw OCR result, RAG result or operator review queue.

## Proposed Runtime Names

- artifact kind: `notice_change_set`
- display name: `NoticeChangeSet`
- producer binding: `notice.notice_change_set.transport_override_lookup`
- producer tool name: `campus_notice_change_set_lookup`
- source truth owner: `notice_consumption_projection` plus the transport change read model produced
  from admitted notice consumption
- allowed consumers:
  - `campus-services-agent`
  - `rag-agent`
  - `supervisor-api-finalizer`

The exact file/module names are implementation details, but these public contract names should not
drift without updating artifact registry, generated contracts, eval fixtures and docs together.

## Schema Shape

The artifact payload must be represented as a bounded projection, not a raw source record.

Required top-level fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `schema_version` | string | yes | Must start at `notice-change-set-v1`. |
| `change_set_id` | string | yes | Stable hash over source notice ids, target scope and effective window. |
| `target_family` | enum | yes | Initial value: `transport_schedule`. Future `service_status` needs separate admission. |
| `query_scope` | object | yes | Campus, service kind, route labels, direction, stop labels and query date/time when known. |
| `effective_window` | object | yes | Start/end/date-set with timezone and `current_at_query_time`. |
| `change_kind` | enum | yes | See allowed values below. |
| `answer_eligible` | boolean | yes | False for searchable-only, stale, incomplete or conflicting records. |
| `admission_state` | enum | yes | `answer_eligible`, `searchable_only`, `stale`, `missing_baseline`, `missing_evidence`, `conflict`, `ambiguous_scope`, `unsupported`. |
| `facts` | array | yes | Bounded normalized change facts. Empty only when fail-close state explains why. |
| `source_refs` | array | yes | Notice title/source URL/date refs; no raw body. |
| `conflicts` | array | yes | Deterministic conflict summaries, empty when none. |
| `safety_summary` | object | yes | Redaction and raw-payload absence summary for trace/operator view. |
| `content_hash` | string | yes | Hash over bounded payload, not raw source. |

Allowed `change_kind` values:

- `baseline_delta`
- `temporary_overlay`
- `temporary_exception`
- `service_suspension`
- `service_restoration`
- `stop_or_boarding_point_change`
- `route_or_direction_change`
- `historical_search_only`
- `no_current_change`

Required fact fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `fact_id` | string | yes | Stable within `change_set_id`. |
| `fact_kind` | enum | yes | Examples: `departure_time_added`, `window_changed`, `stop_changed`, `service_suspended`. |
| `route_label` | string | when known | Human label such as shuttle route or campus pair. |
| `direction_label` | string | when known | Direction must be explicit for direction-sensitive schedules. |
| `service_window` | object | when relevant | Date/time window, weekday rule or special-date rule. |
| `change_text` | string | yes | Clean bounded summary, not raw OCR dump. |
| `source_notice_id` | string | yes | Stable notice id. |
| `source_ref_id` | string | yes | Matches an entry in `source_refs`. |
| `confidence` | enum | yes | `deterministic`, `model_reviewed`, `low_confidence_fail_closed`. |

Required source ref fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `source_ref_id` | string | yes | Stable source ref id. |
| `notice_id` | string | yes | Notice id from source truth. |
| `title` | string | yes | Non-empty. |
| `source_url` | string | yes | Non-empty official URL. |
| `published_at` | string | yes | Source publication date/time when available. |
| `excerpt` | string | optional | Bounded clean excerpt; no raw HTML/OCR dump. |

## Admission Gates

A notice may enter `answer_eligible` change-set output only when all gates pass:

1. Source notice exists in source-truth inventory and consumption projection.
2. Notice routing target is transport schedule or transport service status.
3. Notice is not generic searchable-only card content.
4. Title and official source URL are non-empty.
5. Effective window is parseable or source explicitly defines a durable baseline delta.
6. Required body/attachment/image-derived facts are already processed offline.
7. Official transport baseline exists when the question requires baseline comparison.
8. Route/direction/stop scope is specific enough or the output requests clarification.
9. Conflicts are deterministically resolved or represented as `conflict` fail-close.
10. Payload contains no raw HTML, OCR dump, object locator, SQL rows, cookies, provider trace or
    SDK-native trace.

If any gate fails, the producer must return a typed fail-close change set instead of attempting
query-time source recovery.

## Fail-Close Reasons

Stable reason codes:

- `transport_baseline_missing`
- `notice_change_not_found`
- `notice_searchable_only`
- `notice_effective_window_expired`
- `notice_effective_window_unparseable`
- `notice_media_evidence_incomplete`
- `notice_source_ref_missing`
- `transport_scope_ambiguous`
- `transport_notice_conflict`
- `transport_change_unsupported`
- `raw_payload_forbidden`

These reasons are eval and operator-facing. They must remain stable unless a migration updates tests
and docs together.

## Grounding Rule

For simple deterministic changes, finalizer may answer from `schedule_baseline` +
`notice_change_set` if source refs and facts are complete.

If the answer explains a relationship between notice text and baseline, compares conflicting sources
or answers "依据哪条通知", the workflow must include `evidence_bundle` / `grounding_verdict` and
trace must show the final answer used those artifacts.
