# Quick Task 260410-5yl Summary

## Outcome

- `run14-policy-regulation-expanded-v1` 已从宽泛 `16` 条 sample 冻结为可执行的 `A/B/C = 11 / 4 / 1` cohort truth：
  - Cohort A = `354006, 353963, 351907, 196411, 191705, 191177, 191176, 187233, 187004, 186977, 186957`
  - Cohort B = `355282, 351704, 351699, 351119`
  - Cohort C = `177880`
- Cohort A local-only quality pilot 已在 `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/` 上完成，并得出 `ready_for_chunk_prep`
- 当前 Cohort A validator 结果：
  - `validated_document_count = 11`
  - `missing_title_chunk_count = 0`
  - `missing_contextualization_count = 0`
  - `notice_body_fragmentation_count = 0`
  - `markup_leak_chunk_count = 0`
  - `total_units = 362`
  - `total_chunks = 127`
- `191176 / 191177` 被明确记录为 duplicate-source observation：
  - `same_content_hash = false`
  - `same_canonical_markdown = true`
  - `chunk_counts = {'191176': 5, '191177': 5}`
- Cohort B/C 已冻结为 wrapper follow-up boundary，不再污染当前 body-text baseline

## Task Commits

- `229b636` `feat: 冻结 policy regulation cohort 与 wrapper 边界（260410-5yl）`
- `1ffb757` `feat: 完成 Cohort A 本地质量 pilot（260410-5yl）`
- `b1b5150` `docs: 冻结 Cohort A 验收与 wrapper 跟进边界（260410-5yl）`

## Verification

- `uv run --all-packages python - <<'PY' ...` for `run14-policy-regulation-cohorts.json` and `wrapper-follow-up-manifest.json`
- `uv run --all-packages python .planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/cohort_a_local_quality_pilot.py --cohort-manifest .planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/run14-policy-regulation-cohorts.json --local-smoke-root .tmp/historical-intake/run14-policy-regulation-expanded/local-smoke --output-dir .planning/quick/260410-5yl-internal-notice-policy-regulation-cohort`
- `uv run --all-packages python - <<'PY' ...` for `cohort-a-validation-summary.json` and `cohort-a-samples/samples.json`
- `test -f .planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/quality-pilot-acceptance.md && rg -n "Cohort A|ready_for_chunk_prep|needs_fix|local-only|no Postgres|no Qdrant|355282|351704|351699|351119|177880|wrapper/canonical-body follow-up" .planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/quality-pilot-acceptance.md`

## Local-Only Boundary

- 本 quick task 只读取 repo-local cohort manifest 与 `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/`
- 没有 Postgres 写入、没有 Qdrant、没有 embeddings、没有 chunk-preparation manifest、没有 release manifest、没有 alias publish

## Deviations

- None

## Artifacts

- `run14-policy-regulation-cohorts.json`
- `wrapper-follow-up-manifest.json`
- `cohort_a_local_quality_pilot.py`
- `cohort-a-validation-summary.json`
- `cohort-a-quality-summary.md`
- `cohort-a-samples/`
- `quality-pilot-acceptance.md`

## Self-Check

- PASSED
- Verified artifact files exist under `.planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/`
- Verified task commits exist: `229b636`, `1ffb757`, `b1b5150`
