---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Summary: No-Promotion Live Seam

## Completed

- Hardened `scripts/official_web_live_seam_no_promotion.py` so it seeds one explicit app-api target workset candidate before collection, instead of relying on stale local DB state or broad host frontier.
- Added seam report evidence for target seed, uploaded object refs, app-api target attempts, target job ids, target-family counts, target materialization-policy counts, and target-lineage issues.
- Extended the app-api local DB query in the seam to prove `official_web.target_page_attempts` and `official_web.target_jobs` agree with the run id.
- Tightened app-api target attempt materialization so incomplete target lineage does not create a `target_page_attempts` row with an empty `target_id`.
- Preserved no-promotion semantics: the live seam requires ingestion `status=staged`, promotion `decision=staged`, `import=null`, and `error=null`.
- Updated the default live seam target to the service-guide page `https://xxgk.muc.edu.cn/info/1007/1113.htm`, which is retained by the target-first consumer denominator.

## Live Evidence

Command run:

```bash
uv run --all-packages python scripts/official_web_live_seam_no_promotion.py --site-id muc_public --host xxgk.muc.edu.cn --target-id campus-services-service-guide --target-url https://xxgk.muc.edu.cn/info/1007/1113.htm --max-pages-per-host 1 --max-total-pages 1
```

Evidence artifact:

```text
var/official-web-live-seam/owrun_consumer_live_20260501T081629Z/seam-report.json
```

Key proof fields:

- `target_seed.targetJobId`: `owtarget_muc_public_campus_services_service_guide`
- `actual_run_id`: `owrun_3f504e53be744c5f8296fb2c164b69c6`
- `collector.retained_source_truth_pages`: `1`
- `collector.source_truth_bundle_record_count`: `1`
- `app_api.target_attempt_count`: `1`
- `consumer.status`: `staged`
- `consumer.promotion_decision`: `staged`
- `consumer.import_is_null`: `true`
- `consumer.error_is_null`: `true`
- `consumer.target_family_counts`: `{ "service_guide_candidate": 1 }`
- `consumer.target_materialization_policy_counts`: `{ "candidate_only": 1 }`
- `consumer.target_lineage_issues`: `[]`

Before the successful run, local app-api Postgres was missing Phase 2 target-job tables. I applied the existing app-api migration with:

```bash
pnpm --dir apps/app-api db:migrate
```

## Verification

```bash
pnpm --dir apps/app-api test -- official-web-command official-web-target-jobs
pnpm --dir apps/official-web-collector test -- crawl-workset-executor
pnpm --dir apps/app-api typecheck
pnpm --dir apps/official-web-collector typecheck
pnpm --dir apps/app-api test:worker -- official-web
uv run --all-packages python -m unittest tests.ingestion.test_official_web_live_seam_no_promotion_script
```

All commands passed on 2026-05-01.

## Follow-Up

- Phase 9 should close the legacy broad-crawl posture and record final acceptance.
