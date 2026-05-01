---
doc_type: closeout
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Closeout: Official Web Targeted Collection Refactor

## Result

`official_web` collection is now target-first by default.

Default execution shape:

```text
downstream target declaration
-> app-api target job/candidate admission
-> collector target workset fetch
-> source-truth artifacts
-> app-api run/page/target-attempt ledger
-> ingestion-worker no-promotion staging/review/release gate
```

## Completed Scope

- `target-source-map.json` is the target declaration truth.
- `hosts.json` / `seeds.json` are source capability registries, not collection targets.
- app-api owns target jobs, candidates, page attempts, planner output, run ledger, operator projection and handoff dispatch.
- collector requires app-api target workset admission by default and carries target lineage into emitted source-truth artifacts and page observations.
- ingestion-worker consumes target lineage, reports target-family/materialization counts, and rejects missing target lineage.
- protected panel reads official-web target jobs and target details only through protected Worker BFF -> app-api operator routes.
- no-promotion live seam passed with staged ingestion and no current-truth import.
- legacy broad crawl remains explicit debug/operator-only and is excluded by `legacy_contract_excluded`.

## Acceptance Evidence

Live seam:

```text
var/official-web-live-seam/owrun_consumer_live_20260501T081629Z/seam-report.json
```

Key result:

- target job: `owtarget_muc_public_campus_services_service_guide`
- target URL: `https://xxgk.muc.edu.cn/info/1007/1113.htm`
- retained source-truth pages: `1`
- app-api target attempts: `1`
- ingestion status: `staged`
- promotion decision: `staged`
- import: `null`
- error: `null`
- target lineage issues: `[]`

## Verification

```bash
pnpm --dir apps/app-api test -- official-web-command official-web-target-jobs
pnpm --dir apps/official-web-collector test -- crawl-workset-executor
pnpm --dir apps/app-api typecheck
pnpm --dir apps/official-web-collector typecheck
pnpm --dir apps/app-api test:worker -- official-web
uv run --all-packages python -m unittest tests.ingestion.test_official_web_live_seam_no_promotion_script
uv run --all-packages python scripts/official_web_live_seam_no_promotion.py --site-id muc_public --host xxgk.muc.edu.cn --target-id campus-services-service-guide --target-url https://xxgk.muc.edu.cn/info/1007/1113.htm --max-pages-per-host 1 --max-total-pages 1
pnpm --dir apps/official-web-collector test -- crawl-cli crawl-core
pnpm --dir apps/app-api test -- official-web-projection official-web-run-admission
pnpm docs:lint
```

## Reopen Rule

Reopen this workstream only if default official-web collection can again run from host/seeds without app-api target workset admission, target lineage stops reaching source-truth/app-api/ingestion reports, protected panel starts reading non-app-api official-web truth, legacy broad crawl can dispatch/promote without `legacy_contract_excluded`, or a new official-web downstream surface is admitted without a target-source-map entry and no-promotion evidence.
