---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Declarative Extraction And Composition

## Goal

Refactor official-web service-guide candidate extraction so grouped procedures and multi-page
composition are source-faithful and target-role driven.

## Inputs

- Phase 1 `SUMMARY.md`
- `configs/sources/official_web/muc_public/target-source-map.json`
- `configs/sources/official_web/muc_public/consumer-denominator.json`
- `packages/ingestion-core/src/campus_ingestion_core/official_web_projection_engine.py`
- `tests/ingestion/official_web_projection_core_replay_suite.py`
- `.planning/workstreams/official-web-source-pack-collection-execution/INGESTION-REPLAY-AND-RELEASE-GATES.md`

## Tasks

1. Add target/source role metadata contract to target-source-map or source-pack composition config:
   - `procedure_source`
   - `entry_source`
   - `material_source`
   - `contact_source`
   - `policy_source` only when needed for source context, not runtime answer dumping
2. Add config/schema validation:
   - missing required role fails closed
   - duplicate incompatible roles fail closed
   - role source page without source refs fails closed
3. Refactor candidate extraction:
   - preserve heading hierarchy
   - emit grouped procedure candidates for VPN direct/client/mobile-like pages
   - keep compatibility `process_steps` only as a derived fallback
   - normalize host-like entries without duplicating URL variants
   - filter shell/listing material rows without discarding source-provided real material refs
4. Refactor multi-page composition:
   - information disclosure and email service use the same declarative composition helper
   - each field links back to the component page that supplied it
   - no query-time stitching or broad crawl inference
5. Add focused tests with real-like rows for VPN, email material pages and information disclosure.

## Acceptance Criteria

- No page-title or inventory-id special-case branch remains for admitted composition targets.
- VPN-like candidate has separate grouped procedures and no duplicate `vpn.muc.edu.cn` /
  `https://vpn.muc.edu.cn` entries.
- Email service candidate does not treat shell row `申请表格` as a required material unless the
  source row is the actual form/material reference.
- Invalid composition metadata fails closed before selected-write candidate publication.
- Existing information disclosure and email replay tests still pass.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.official_web_projection_core_replay_suite
uv run --all-packages python -m unittest tests.ingestion.test_release_official_web_selected_write
uv run --all-packages ruff check packages/ingestion-core tests/ingestion
```

## Done Summary Template

When complete, write `SUMMARY.md` with:

- role metadata fields and validators
- extracted grouped procedure examples
- composition behavior changes
- blocked invalid metadata examples
- verification evidence
