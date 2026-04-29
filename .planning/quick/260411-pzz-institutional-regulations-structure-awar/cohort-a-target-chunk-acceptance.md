# Cohort A Target Chunk Acceptance

## Verdict

- quality posture: `ready_for_target_materialization`
- cohort notice count: `11`
- rebuilt inventory notice count: `11`
- promotion candidate count: `1`
- promotion manual review count: `10`
- exported candidate count: `1`
- prepared candidate count: `1`
- short body chunk count: `0`
- failed candidate ids: `[]`

## Targeted Observations

- `187233` short_body_chunk_count = `0`

## Manual Review Notices

- `186957` -> `manual_promotion_review` | missing=`revision_signal` | reasons=`draft_or_operational_signal_detected`
- `186977` -> `manual_promotion_review` | missing=`revision_signal` | reasons=`draft_or_operational_signal_detected`
- `187004` -> `manual_promotion_review` | missing=`revision_signal` | reasons=`draft_or_operational_signal_detected`
- `191176` -> `manual_promotion_review` | missing=`issuing_org,revision_signal` | reasons=`wrapper_semantics_still_present,time_bound_or_operational_signal_detected`
- `191177` -> `manual_promotion_review` | missing=`issuing_org,revision_signal` | reasons=`wrapper_semantics_still_present,time_bound_or_operational_signal_detected`
- `191705` -> `manual_promotion_review` | missing=`effective_date,revision_signal` | reasons=`time_bound_or_operational_signal_detected`
- `196411` -> `manual_promotion_review` | missing=`effective_date,revision_signal` | reasons=`draft_or_operational_signal_detected`
- `351907` -> `manual_promotion_review` | missing=`effective_date,revision_signal` | reasons=`time_bound_or_operational_signal_detected`
- `353963` -> `manual_promotion_review` | missing=`revision_signal` | reasons=`time_bound_or_operational_signal_detected`
- `354006` -> `manual_promotion_review` | missing=`revision_signal` | reasons=`time_bound_or_operational_signal_detected`

## Boundary

- local-only rebuilt inventory + candidate export + target chunk prep
- no Postgres writes
- no Qdrant access
- no embeddings
- no release manifest
- no alias publish

## Artifacts

- `.planning/quick/260411-pzz-institutional-regulations-structure-awar/cohort-a-rebuilt-source-truth-inventory.json`
- `.planning/quick/260411-pzz-institutional-regulations-structure-awar/cohort-a-candidate-export-rebuilt/promotion-candidate-manifest.json`
- `.planning/quick/260411-pzz-institutional-regulations-structure-awar/cohort-a-candidate-export-rebuilt/candidate-documents.jsonl`
- `.planning/quick/260411-pzz-institutional-regulations-structure-awar/cohort-a-chunk-prep-rebuilt/chunk-prep-manifest.json`
- `.planning/quick/260411-pzz-institutional-regulations-structure-awar/cohort-a-chunk-prep-rebuilt/validation-summary.json`
- `.planning/quick/260411-pzz-institutional-regulations-structure-awar/cohort-a-chunk-prep-rebuilt/document-reports.jsonl`
