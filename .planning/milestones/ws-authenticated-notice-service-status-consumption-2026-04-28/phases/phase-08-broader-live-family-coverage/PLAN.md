---
doc_type: plan
status: active
created: 2026-04-28
updated: 2026-04-28
phase: Phase 8
workstream: authenticated-notice-service-status-consumption
---
# Phase 8 Plan: Broader Live Family Coverage

<!-- markdownlint-disable MD013 -->

## Goal

把 Phase 7 的单条 facility live loop 扩展到真实 authenticated notice export
里的 service-status 家族覆盖，优先验证：

- IT platform status
- library status
- service-counter / hospital / logistics window status
- additional facility status

This phase must not absorb regulation, schedule, service guide, contact-directory
or generic notice-query work.

## Tasks

1. Build a source-bundle candidate audit.
   - Use the latest authenticated notice export bundle already present locally.
   - Select real candidate ids by title/body evidence, not by synthetic fixture.
   - Record whether each candidate is already in `notice_consumption_projection`.
1. Build selected bundle and consumer admission manifest.
   - Keep selected scope explicit.
   - Use `upsert_selected`, not replace-scope.
   - Preserve transport/schedule boundary samples as rejected or adjacent, not
     service-status success.
1. Rebuild notice consumption projection for the selected service-status ids.
   - Record route/family/status output.
   - Identify candidates missing from projection and classify cause.
1. Run service-status typed materialization in preview mode first.
   - Do not promote a non-current or incomplete family release as current truth.
   - Record accepted records and rejected-source rows per notice.
1. Close materializer gaps only when supported by clear source text.
   - Prefer deterministic text rules with tests.
   - Do not add broad fuzzy rules that absorb service guides, events or notices.
1. Prove downstream lookup where a materialized record is suitable.
   - Use `as_of` lookup for historical windows.
   - Use current lookup only for open-ended or currently effective service
     status.
   - Keep public visible payload free of raw notice locators and release ids.

## Expected Artifacts

- `evidence/phase-08-broader-live-family-coverage/source-candidate-audit.json`
- `evidence/phase-08-broader-live-family-coverage/selected-bundle.json`
- `evidence/phase-08-broader-live-family-coverage/consumer-admission-manifest.json`
- `evidence/phase-08-broader-live-family-coverage/notice-consumption-projection-rebuild.json`
- `evidence/phase-08-broader-live-family-coverage/service-status-candidate-list.json`
- `evidence/phase-08-broader-live-family-coverage/service-status-preview/`
- targeted runtime/app-api evidence for materialized records when applicable
- updated `STATE.md`, `ROADMAP.md`, `.planning/WORKSTREAMS.md`

## Acceptance Criteria

- At least one non-`355650` real service-status candidate is either materialized
  or recorded with a precise deterministic blocker.
- IT platform, library and service-counter families each have a live/export
  disposition: materialized, source missing, admission missing, materializer
  unsupported, or runtime unsupported.
- No schedule/regulation/service-guide/contact notices are counted as
  service-status success.
- Preview evidence is captured before any stage/promote operation.
- Workstream remains active unless the user explicitly asks to archive.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_notice_derived_service_status_materialization \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_list_internal_notice_service_status_candidates_worker
```

```bash
go test ./internal/structuredquery ./internal/structuredplanning
```

Run Go verification from `apps/supervisor-api`.
