---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Summary: Legacy Closeout And Acceptance

## Completed

- Kept collector default admission fail-closed: app-api target workset admission or explicit legacy debug/operator admission is required.
- Confirmed `--host` cannot create target scope by itself.
- Kept legacy broad crawl as explicit `--legacy-broad-crawl` plus non-empty reason only.
- Confirmed app-api projection drain skips terminal events with `legacy_contract_excluded`, so those runs do not dispatch official-web ingestion handoffs.
- Updated `docs/runbooks/official-web-collector-smoke-and-audit.md` to point live operators at the target-first no-promotion seam instead of host-first smoke.
- Recorded Phase 8 live evidence as the final no-promotion acceptance proof.

## Verification

```bash
pnpm --dir apps/official-web-collector test -- crawl-cli crawl-core
pnpm --dir apps/app-api test -- official-web-projection official-web-run-admission
pnpm docs:lint
```

All commands passed on 2026-05-01.
