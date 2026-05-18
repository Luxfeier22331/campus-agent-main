---
doc_type: plan
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Contact Directory Preview

## Goal

Prove contact-directory candidates remain no-promotion until machine field review passes.

## Tasks

1. Keep homepage contact as a retained candidate.
2. Add full contact denominator to inventory and report projection.
3. Verify missing `email` / `office_hours` blocks selected-write.
4. Verify a complete synthetic contact candidate can become dry-run ready without human approval.

## Verification

```bash
pnpm --filter official-web-core test -- target-inventory.test.ts
uv run --all-packages python -m unittest tests.ingestion.official_web_handoff_consumer_staging_suite
```
