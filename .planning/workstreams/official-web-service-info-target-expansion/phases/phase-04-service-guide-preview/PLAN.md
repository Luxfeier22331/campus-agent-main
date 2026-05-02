---
doc_type: plan
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Service Guide Preview

## Goal

Prove service-guide candidates remain no-promotion until the full service denominator is present.

## Tasks

1. Keep the information-disclosure workflow page as a retained service candidate.
2. Add the application form download page as a source-backed material candidate.
3. Require service process, entry, material, phone, location and office hours.
4. Verify missing service fields block selected-write.

## Verification

```bash
pnpm --filter official-web-core test -- target-inventory.test.ts policy.test.ts config.test.ts
uv run --all-packages python -m unittest tests.ingestion.official_web_handoff_consumer_staging_suite
```
