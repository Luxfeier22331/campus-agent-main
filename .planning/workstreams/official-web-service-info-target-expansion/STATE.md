---
workstream: official-web-service-info-target-expansion
created: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Phase 7 - Closeout
**Last Activity:** 2026-05-03
**Last Activity Description:** Real selected-write promotion completed for five queued service-info tasks; operator read model and release gates reconfirmed

## Progress

**Phases Complete:** 8
**Current Plan:** `.planning/workstreams/official-web-service-info-target-expansion/phases/phase-07-closeout/PLAN.md`

## Current Slice

Closed. Five source-backed official-web service-info targets are now in current structured
projections through ingestion-owned selected-write release tasks:

- `campus_services/contact_directory`
  - `中央民族大学`
  - `中央民族大学信息公开联系方式`
  - `中央民族大学信息化服务联系方式`
- `campus_services/service_guide`
  - `学生校园卡服务`
  - `中央民族大学信息公开依申请公开工作流程`
  - `中央民族大学校园网认证及使用说明`
  - `中央民族大学校园电子邮件服务`
  - `中央民族大学 VPN 使用说明`

On 2026-05-03 the remaining five queued selected-write tasks were actually promoted through the
canonical ingestion runner with app-api callback enabled, and the operator read model exposed all
published tasks through `/api/operator/official-web/release-tasks`. Remaining retained candidates
stay fail-closed until preview evidence and required fields are present.

## Blockers

- None.

## Risks

- Source pages may not contain office hours, handling channels or material lists. Optional gaps must
  remain source-not-provided fields; required gaps must remain blocked candidates, not broader crawl.
- Denominator config is the enforcement source of truth. Prose cannot relax configured
  `required_fields` or `required_evidence`.
- Existing official-web registry state is dirty in the current worktree. This workstream should not
  revert unrelated registry or implementation changes.
- `service_guide` release-task operator projection currently publishes `recordCount` but does not yet
  expose `fullRecordCount` / `taskScopeDisplayNames` / `fullImpactDisplayNames` in app-api output
  summary. Contact-directory already exposes the richer selected-write summary shape.

## Session Continuity

**Stopped At:** Workstream closeout
**Resume File:** `.planning/workstreams/official-web-service-info-target-expansion/CLOSEOUT.md`

## Future Starting Point

If service-info expansion reopens, start from the
`muc-information-disclosure-application-process` + `muc-information-disclosure-application-form-download`
composition group for `campus_services/service_guide`. Do not reopen broad official-web collection
for this; continue the same target-first selected-write lane.
