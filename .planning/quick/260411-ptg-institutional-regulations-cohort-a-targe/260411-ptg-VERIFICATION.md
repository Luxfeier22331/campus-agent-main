# Quick Task 260411-ptg Verification

## Executed Checks

Command:

- `uv run --all-packages python .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py`

Observed artifacts:

- [cohort-a-rebuilt-source-truth-inventory.json](/home/reptilian/code/campus-agent/.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-rebuilt-source-truth-inventory.json)
- [cohort-a-candidate-export-rebuilt/promotion-candidate-manifest.json](/home/reptilian/code/campus-agent/.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-candidate-export-rebuilt/promotion-candidate-manifest.json)
- [cohort-a-candidate-export-rebuilt/candidate-documents.jsonl](/home/reptilian/code/campus-agent/.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-candidate-export-rebuilt/candidate-documents.jsonl)
- [cohort-a-chunk-prep-rebuilt/chunk-prep-manifest.json](/home/reptilian/code/campus-agent/.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-chunk-prep-rebuilt/chunk-prep-manifest.json)
- [cohort-a-chunk-prep-rebuilt/validation-summary.json](/home/reptilian/code/campus-agent/.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-chunk-prep-rebuilt/validation-summary.json)
- [cohort-a-chunk-prep-rebuilt/document-reports.jsonl](/home/reptilian/code/campus-agent/.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-chunk-prep-rebuilt/document-reports.jsonl)
- [cohort-a-target-chunk-acceptance-summary.json](/home/reptilian/code/campus-agent/.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-target-chunk-acceptance-summary.json)

Machine-readable result:

- `cohort_notice_count = 11`
- `rebuilt_inventory_notice_count = 11`
- `promotion_candidate_count = 1`
- `promotion_manual_review_count = 10`
- `candidate_exported_count = 1`
- `prepared_candidate_count = 1`
- `quality_posture = needs_short_fragment_tuning_review`
- `short_body_chunk_count = 7`
- `failed_candidate_ids = []`

## Promotion Distribution Check

Command:

- `uv run --all-packages python - <<'PY' ...` to inspect `build_internal_notice_regulation_promotion_manifest(...)` with rebuilt inventory for Cohort A

Observed facts:

- `action_counts = {"manual_review_required": 10, "promote_candidate": 1}`
- only `notice_id = 187233` currently reaches `promote_candidate`
- the remaining `10` Cohort A notices are all `manual_promotion_review`

## Final Verdict

- Cohort A target-side batch acceptance: completed
- current primary follow-up: promotion admission/routing review for the 10 manual-review notices
- current secondary follow-up: short-fragment tuning review for `187233`
