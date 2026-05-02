---
doc_type: requirements
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Requirements: Official Web Service Info Target Expansion

## Goal

Expand official-web target inventory into a source-backed, low/no-human service information lane for
`campus_services/contact_directory` and `campus_services/service_guide`.

## Problem

The current target inventory gives official-web collection a controlled target-first shape, but it
does not yet answer which additional university pages should be collected to fill service
information gaps. Expanding by host, school site, or news page would recreate the old broad-crawl
problem.

This workstream therefore starts from downstream fields and only admits source targets that can
materially improve current campus-service consumption.

## In Scope

- Freeze the downstream field denominator for:
  - contact directory entries
  - service guide entries
- Compare current `target-inventory.json`, source-truth evidence and runtime read models against
  those fields.
- Add explicit target candidates only when a page is expected to provide one or more required
  downstream fields.
- Run no-promotion preview evidence for accepted candidates before any current-truth write.
- Define deterministic extraction and validation requirements for contact directory and service
  guide candidates.
- Classify candidates as ready, blocked, inventory-only or excluded using machine-checkable field
  coverage and source lineage.
- Hand ready candidates to ingestion-owned selected-write release tasks.
- Verify current read model and runtime consumption after selected-write release.

## Out Of Scope

- Broad official-web crawl.
- News/recent-updates product surfaces.
- `official_web/fresh_news` or `official_web/news_archive` runtime opening.
- Stable-reference document release unless it directly blocks the two service-info surfaces.
- Authenticated notice, WeChat, handbook PDF or public-docs source-channel work.
- App-api owned selected-write mutation.
- Panel-side source parsing or aggregation.
- Human approval as a normal release requirement.

## Downstream Field Denominator

The canonical denominator is `./FIELD-DENOMINATOR.md`. This section summarizes it.

`campus_services/contact_directory` candidates inherit the current family-level required evidence
from `target-source-map.json` and `consumer-denominator.json`:

- phone
- email
- location
- office hours

They must also carry structured projection fields:

- organization or department name
- source URL
- source observation/version identity
- responsibility or service scope when source text provides it

`campus_services/service_guide` candidates inherit the current family-level required evidence from
`target-source-map.json` and `consumer-denominator.json`:

- service process
- service entry
- service material
- phone
- location
- office hours

They must also carry structured projection fields:

- service name
- responsible unit
- service scope or audience
- source URL
- source observation/version identity

Target-specific `required_fields` in `target-inventory.json` must be present before selected-write
readiness. Family-level required evidence must also be present unless this workstream explicitly
changes the tracked denominator config in the same phase. Missing source lineage, ambiguous
ownership or no extractable downstream field always fails closed.

## Machine Review Contract

`selected_write_requires_review` means ingestion-owned machine field review for this workstream, not
a default human approval queue.

The review path is:

- ingestion-worker derives target field status from `target-inventory.json`
- ingestion-worker checks family-level required evidence from denominator configs
- ingestion-worker sends `targetFieldReviews` to app-api through the existing internal callback
- app-api stores sanitized review summaries in
  `official_web.target_artifact_verification_summaries`
- target inventory projection may classify rows as `ready_for_selected_write` only when lineage and
  field review are complete

## Success Criteria

- The accepted target list is field-gap-driven, not host-driven.
- Every accepted target has a target inventory row, source URL or deterministic URL hint, owner
  surface, selected-write target and required-field contract.
- Field denominator and machine review semantics are synchronized with `target-source-map.json`,
  `consumer-denominator.json`, `target-inventory.json` and the selected-write handoff.
- Every accepted target has no-promotion preview evidence before selected-write release.
- Every ready target has source object keys, raw asset id, raw version id, staged ingestion status
  and field coverage verdicts.
- Blocked targets explain the exact missing source facts or extraction blockers.
- Selected-write work is handed to ingestion-worker release tasks, not app-api or panel code.
- Runtime verification proves the resulting structured projections are consumable by the intended
  lookup surface.

## Non-Negotiable Boundaries

- `configs/sources/official_web/muc_public/target-source-map.json` remains family-level admission
  truth.
- `configs/sources/official_web/muc_public/target-inventory.json` is the page/target-level
  inventory truth.
- Source-truth artifacts remain source-owned and do not carry downstream current-truth state.
- `apps/app-api` remains official-web control-plane and operator projection owner.
- `apps/ingestion-worker` owns selected-write release execution and current structured projection
  mutation.
- Protected panel only reads app-api operator-safe projections.
- Failed extraction does not become a human approval queue by default; it becomes a blocked target
  with deterministic evidence and a future data/source remediation note.
- Candidate fields cannot be silently relaxed by prose. If this workstream decides a field is no
  longer required, it must update the tracked denominator config and explain the serving impact.
