---
doc_type: plan
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Runtime Consumption Verification

## Goal

Verify app-api and panel consume the expanded target inventory projection, and verify selected-write
release code still publishes supported structured projections when a ready task exists.

## Tasks

1. Add `requiredEvidence` to app-api target-inventory records.
2. Add required evidence display to panel target-inventory list.
3. Typecheck app-api and protected panel.
4. Keep runtime current-truth consumption as no-op for real targets because no ready selected-write
   candidate exists.

## Verification

```bash
pnpm --filter app-api typecheck && pnpm --filter protected-panel-web typecheck
uv run --all-packages python -m unittest tests.ingestion.test_release_official_web_selected_write
```
