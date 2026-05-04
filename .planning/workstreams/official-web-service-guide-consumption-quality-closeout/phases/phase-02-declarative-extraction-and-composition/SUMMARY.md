---
doc_type: summary
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 2 Summary

## Landed

- `packages/ingestion-core/src/campus_ingestion_core/official_web_projection_engine.py`
  now models non-VPN service-guide composition with declarative group specs instead of duplicating
  per-group primary/suppressed-page branches.
- `information_disclosure` now enforces:
  - exactly one `procedure_source` primary page
  - allowed composition roles limited to
    `policy_source` / `procedure_source` / `material_source` / `contact_source`
  - any `service_guide_candidate` page with missing or unknown role fails closed
- `email_service` now enforces:
  - exactly one `policy_source` primary page
  - allowed composition roles limited to
    `policy_source` / `entry_source` / `material_source` / `contact_source`
  - any `service_guide_candidate` page with missing or unknown role fails closed
- suppressed pages now stay suppressed through a shared helper instead of per-group ad hoc maps

## Added Replay Coverage

- duplicate `information_disclosure.procedure_source` suppresses `service_guide_candidate`
- missing `email_service.policy_source` suppresses `service_guide_candidate`
- duplicate `email_service.policy_source` suppresses `service_guide_candidate`
- unknown `information_disclosure` service role such as `faq_source` suppresses
  `service_guide_candidate`
- valid information-disclosure and email-service compositions still emit the expected
  `service_guide_candidate`

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.official_web_projection_core_replay_suite -q
uv run --all-packages python -m unittest tests.ingestion.test_release_official_web_selected_write -q
```
