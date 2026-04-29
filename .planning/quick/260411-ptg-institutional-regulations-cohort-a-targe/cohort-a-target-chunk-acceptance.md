# Cohort A Target Chunk Acceptance

## Verdict

- quality posture: `ready_for_target_materialization`
- cohort notice count: `11`
- rebuilt inventory notice count: `11`
- promotion candidate count: `9`
- promotion manual review count: `2`
- exported candidate count: `9`
- prepared candidate count: `9`
- short body chunk count: `0`
- failed candidate ids: `[]`

## Targeted Observations

- `186957` short_body_chunk_count = `0`
- `186977` short_body_chunk_count = `0`
- `187004` short_body_chunk_count = `0`
- `187233` short_body_chunk_count = `0`
- `191705` short_body_chunk_count = `0`
- `196411` short_body_chunk_count = `0`
- `351907` short_body_chunk_count = `0`
- `353963` short_body_chunk_count = `0`
- `354006` short_body_chunk_count = `0`

## Manual Review Notices

- `191176` -> `manual_promotion_review` | missing=`issuing_org,revision_signal` | reasons=`wrapper_semantics_still_present,time_bound_operational_rule_detected,missing_quality_gate:wrapper_semantics_removed`
- `191177` -> `manual_promotion_review` | missing=`issuing_org,revision_signal` | reasons=`wrapper_semantics_still_present,time_bound_operational_rule_detected,missing_quality_gate:wrapper_semantics_removed`

## Boundary

- local-only rebuilt inventory + candidate export + target chunk prep
- no Postgres writes
- no Qdrant access
- no embeddings
- no release manifest
- no alias publish

## Artifacts

- `.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-rebuilt-source-truth-inventory.json`
- `.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-candidate-export-rebuilt/promotion-candidate-manifest.json`
- `.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-candidate-export-rebuilt/candidate-documents.jsonl`
- `.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-chunk-prep-rebuilt/chunk-prep-manifest.json`
- `.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-chunk-prep-rebuilt/validation-summary.json`
- `.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-chunk-prep-rebuilt/document-reports.jsonl`
