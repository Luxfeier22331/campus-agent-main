# Quick Task 260412-jre Verification

**Completed:** 2026-04-12  
**Status:** pass

## Verified Commands

```bash
uv run --all-packages python .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py \
  --output-dir .planning/quick/260412-jre-institutional-regulations-target-collect/rerun-output
```

Result:

- exited with code `0`
- produced fresh local-only acceptance artifacts under `rerun-output/`

```bash
jq '{promotion_candidate_count, promotion_manual_review_count, promotion_action_counts, prepared_candidate_count, quality_posture, short_body_chunk_count}' \
  .planning/quick/260412-jre-institutional-regulations-target-collect/rerun-output/cohort-a-target-chunk-acceptance-summary.json
```

Result:

- `promotion_candidate_count = 10`
- `promotion_manual_review_count = 0`
- `prepared_candidate_count = 10`
- `quality_posture = ready_for_target_materialization`
- `short_body_chunk_count = 0`

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_internal_notice_regulation_candidate_chunk_prep \
  tests.ingestion.test_prepare_internal_notice_regulation_candidate_chunks_worker
```

Result:

- `Ran 4 tests`
- `OK`

## Verified Outcomes

- Cohort A target-side chunk acceptance on current repo-head is materially ahead of the stale historical snapshot.
- The rerun confirms `10` promotable regulation candidates already pass local-only target chunk-prep hard gates.
- `191176 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定` now passes promotion and target chunk prep.
- `191177` is no longer a residual manual-review case; it is held as a duplicate of `191176`.
- `institutional_regulations` remains `offline_preparation`; this quick task did not open query-serving or release work.
