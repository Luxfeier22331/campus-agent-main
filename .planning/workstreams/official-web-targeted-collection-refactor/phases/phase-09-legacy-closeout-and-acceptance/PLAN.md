---
doc_type: plan
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Plan: Legacy Closeout And Acceptance

## Goal

Close the official-web target-first refactor by freezing the legacy broad path as explicit debug/operator-only and recording final acceptance evidence.

## Deliverables

- Legacy broad crawl remains opt-in only through explicit `--legacy-broad-crawl` plus reason.
- Host filters and configured source hosts cannot create collection scope without app-api target workset admission.
- Legacy broad runs remain excluded from app-api projection handoff and selected-write through `legacy_contract_excluded`.
- Runbook and workstream docs point operators to the target-first no-promotion seam instead of the old host-first smoke.
- Workstream summary and registry state reflect completion.

## Non-Goals

- No physical deletion of legacy source-truth artifacts.
- No fresh-news or news-archive runtime opening.
- No current read-model promotion.
- No scheduler rollout.

## Acceptance

- Tests prove default collector input and host filters do not create broad collection admission.
- Tests prove legacy broad crawl requires explicit debug/operator reason.
- Tests prove app-api projection drain skips `legacy_contract_excluded` terminal events instead of dispatching handoff.
- Phase 8 live evidence proves target-first no-promotion seam.

## Verification

```bash
pnpm --dir apps/official-web-collector test -- crawl-cli crawl-core
pnpm --dir apps/app-api test -- official-web-projection official-web-run-admission
pnpm docs:lint
```
