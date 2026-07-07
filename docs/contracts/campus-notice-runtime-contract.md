---
doc_type: contract
truth_scope: execution
owner_boundary: apps/execution-control
status: active
created: 2026-04-23
updated: 2026-07-04
---
# Campus Notice Runtime Contract

## Boundary

This contract freezes the query-time notice runtime boundary.

It covers:

- `packages/contracts` notice payload/result dataclasses
- Go `apps/execution-control` ToolSpec, planner, typed tool runtime and internal
  query service
- `execution-control -> typed notice tool activity / internal query service`
  active execution seam
- eval/provider/SDK guardrails that prevent raw notice body regressions

It does not cover collector, ingestion, OCR, object storage, source-truth
retention or downstream materialization ownership.

## Final Posture

Notice user-facing output is card-first and source-link-first.

- `campus_notice_discover` is the only model-visible notice tool.
- `campus_notice_get` is not a model-facing/provider/SDK tool.
- `campus_notice_get` remains only as an internal selected notice
  resolve/context function.
- Provider function schema generation must not emit `campus_notice_get`.
- Agents SDK and provider-loop notice-get pilots are closed.
- Agents SDK may only expose repo-owned ToolSpec-admitted read-only tools.
  `campus_notice_get` remains closed; current notice-family SDK exposure is
  limited to `campus_notice_discover`.
- `campus_notice_period_summary` and `campus_notice_change_set_lookup` are
  closed ToolSpec / workflow-artifact contract residues, not model-visible
  runtime tools.
- Closed notice tools are not roadmap promises. Reopening either tool requires
  a concrete product need, an opened ToolSpec entry, runtime config exposure,
  read-model ownership, eval denominators and a documented failure policy.
- Transport notice-derived operational facts belong in
  `transport_schedule_lookup` output (`related_notice_refs` /
  `operational_notices`), not a standalone notice change-set tool.
- Public answers, workflow traces, panel assets and eval canonical artifacts
  must not carry full `normalized_body`, OCR owner text, inline image text or
  attachment body.

Raw notice body and media-derived text still belong in source-truth, bounded
context extraction, fact extraction and downstream materialization. They are not
default public answer material.

Current serving dependency is the notice read model. `campus_notice_discover`
and the internal selected-notice resolve path consume notice cards, references,
excerpts and bounded summaries from the read model; they do not require notice
body object-store credentials for readiness. Opening a body-backed
serving path requires a separate delivery contract and must not be implied by
the current model-visible `campus_notice_discover` tool.

## Tool And Function Boundary

Agent-facing tools:

```text
CampusNoticeDiscoverPayload
- query_text
- temporal_query
- source_families[]
- target_surfaces[]
- max_results

CampusNoticeDiscoverResult
- outcome
- notice_cards[]
- queried_time_anchor
- historical_downgrade_reason
- fail_close_reason

```

Internal query function:

```text
CampusNoticeGetPayload
- notice_id
- source_family

CampusNoticeGetResult
- notice_id
- outcome
- title
- source_family
- source_url
- canonical_url
- reference_only
- display_policy
- body_excerpt
- bounded_summary
- extracted_facts[]
- target_surface
- published_at
- effective_at
- attachment_refs[]
- provenance_refs[]
- historical_downgrade_reason
- fail_close_reason
```

`normalized_body` may remain on the internal DTO for source-truth-backed
materialization, but it is not required for resolved results and must not be
used for default answer rendering.

Removed notice tools and packets are not compatibility surfaces. If product
needs a period summary or change-set capability later, it must enter as a new
design with ToolSpec, runtime config `open_tools` exposure, read-model ownership, eval
denominators and failure policy defined together.

## Display Policy

All public notice projections must carry or imply:

```text
NoticeDisplayPolicy
- public_surface:
  - card_only
  - link_only
  - bounded_summary
  - fact_extraction_only
- full_body_forbidden: true
- body_access:
  - none
  - internal_context_only
  - downstream_materialization_only
```

`full_body_forbidden=false` is invalid for public notice display policy.

## Runtime Ownership

Go `apps/execution-control` owns:

- ToolSpec posture and `allowed_tools`
- selected notice planning
- internal notice query endpoints
- structured read-model-backed notice discovery
- structured direct answer rendering
- finalizer/workflow projection leak guards
- runtime observability labels

Python owns no query-time notice capability runtime. The retired
`packages/notice-capability` implementation must not be reintroduced as a
serving shortcut, SDK adapter or provider-loop tool path.

## Internal Query HTTP Packet

Repo-owned runtime code calls Go through private internal routes:

- `POST /internal/query/notices/discover`
- `POST /internal/query/notices/get`

Required header:

- `x-execution-query-auth: <EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET>`

Request body:

```json
{
  "payload": {
    "query_text": "家具采购",
    "source_families": ["internal_notice_restricted"],
    "target_surfaces": ["notice_level_query"],
    "max_results": 5
  },
  "access_context": {
    "actor": {"user_id": "student-001"},
    "authorization": {
      "principal_id": "principal-001",
      "entitlement_groups": ["students"],
      "retrieval_filter": {
        "entitlement_groups": ["students"],
        "visibility_level": "restricted"
      }
    }
  }
}
```

Query-time notice runtime must not rescan raw notice/source bundles.

## Workflow Context Projection

Workflow/runtime steps may pass notice context only as bounded projections:

```text
NoticeContextProjection / StepOutputProjection
- projection_id
- source_step_id
- projection_kind=notice_context
- content_hash
- safety summary
- payload only inside private handoff context
  - title
  - body_excerpt
  - bounded_summary / extracted facts when available
  - source_url
```

Current notice workflow context uses only `notice_context` projections.

Operator/eval-visible workflow trace summaries expose projection id, source
step, kind, content hash and safety metadata only. They must not expose the
payload.

Cross-agent prompt context labels bounded excerpt/summary as summary, not full
body.

## Observability

Notice observability may include:

- selected tool for `campus_notice_discover`
- empty selected tool for internal selected notice resolve
- business outcome
- fail-close reason
- historical downgrade reason
- source ref count
- display policy / projection posture in safe details

It must not include raw provider responses, raw SDK trace state, full notice
body or restricted raw payload.
