---
doc_type: opening_review
workstream: notice-agent-card-first-tool-boundary
status: reviewed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 MD060 -->

# Opening Review: Notice Agent Card-First Tool Boundary

## Decisions

| Surface | Decision | Evidence |
|---|---|---|
| Notice discovery cards | `gate-closed` | `campus_notice_discover` remains agent-facing and provider-schema eligible, but product notice serving remains separately gated. |
| Selected notice source-card resolution | `gate-closed` | `campus_notice_get` is active only as `agent_internal`, with empty `allowed_tools` and closed provider/SDK posture. |
| Public full-body notice reading | `deferred` | Full `normalized_body`, OCR owner text, inline image text and attachment body are blocked from public answer/workflow trace/provider/SDK surfaces. |
| Summary / fact extraction | `deferred` | Contracts carry `body_excerpt`, `bounded_summary` and `extracted_facts`; downstream admission still needs target-specific materialization evidence. |
| Downstream materialization | `deferred` | Workflow projection now passes bounded summary/source refs; schedule/status/service-guide/regulation materialization remains owned by separate data-plane workstreams. |
| Restricted notice authz | `gate-closed` | Restricted context continues to require authorization projection and fail-close semantics. |
| Provider tool loop / Agents SDK notice-get | `gate-closed` | Provider schemas exclude `campus_notice_get`; runtime policies reject stale notice-get provider/SDK config. |

## Open Conditions

Card-first notice serving can only be opened after product/runtime admission verifies:

- public or protected entrypoint capability policy explicitly opens the notice surface,
- source card URLs are stable for the selected source family,
- restricted notice entitlement projection is present where needed,
- eval denominator proves no full-body leak in answer, workflow trace, panel or eval artifacts,
- downstream materialization has target-specific evidence for any schedule/status/regulation/service-guide facts.
