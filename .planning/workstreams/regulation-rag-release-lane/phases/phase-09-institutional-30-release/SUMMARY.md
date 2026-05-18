---
doc_type: phase_summary
status: completed
workstream: regulation-rag-release-lane
phase: phase-09-institutional-30-release
created: 2026-05-03
updated: 2026-05-03
---
# Phase 9 Summary: Institutional 30 Release

## Outcome

The current校级 `regulations/institutional_rules` scope is published through the
regulation RAG release lane. The serving alias `institutional_rules` now points
to `institutional_rules__r20260503_040442_379305_7ac37b80`.

Final selected candidate state:

- documents: 30
- chunks / points: 1402
- candidate status: 30 `serving_published`
- preparation status: 30 `completed`
- index status: 30 `indexed`
- serving status: 30 `serving_published`
- verification status: 30 `passed`

## Notes

- The first processor run failed closed before alias publish because two
  release-gate cases still locked `expected_version_ids` to pre-cleaning hashes.
- The hit document ids were already correct; only the version locks were stale.
- `institutional_rules_release_acceptance.v1.json` and
  `institutional_rules_retrieval_qrels.json` were updated to the current operator
  registry versions for `中央民族大学毕业生就业奖励办法` and
  `中央民族大学学生社团管理办法`.
-院级 `scoped_rules` remains out of default RAG query-serving.

## Evidence

- Reader publish:
  `../../evidence/phase-09-institutional-30-release/institutional-reader-publish-report.json`
- Chunk preparation:
  `../../evidence/phase-09-institutional-30-release/chunk-preparation.report.json`
- Release admission:
  `../../evidence/phase-09-institutional-30-release/release-admission.report.json`
- First enqueue:
  `../../evidence/phase-09-institutional-30-release/institutional-force-reenqueue-report.json`
- First processor fail-closed report:
  `../../evidence/phase-09-institutional-30-release/institutional-process-release-report.json`
- Replay enqueue after acceptance refresh:
  `../../evidence/phase-09-institutional-30-release/institutional-force-reenqueue-after-acceptance-refresh-report.json`
- Successful processor report:
  `../../evidence/phase-09-institutional-30-release/institutional-process-release-after-acceptance-refresh-report.json`
- Final candidate and alias state:
  `../../evidence/phase-09-institutional-30-release/institutional-final-candidate-alias-state.json`

## Verification

```bash
jq empty \
  packages/evals/fixtures/institutional_rules_release_acceptance.v1.json \
  packages/evals/fixtures/institutional_rules_retrieval_qrels.json \
  .planning/workstreams/regulation-rag-release-lane/evidence/phase-09-institutional-30-release/*.json

uv run --all-packages python -m unittest \
  tests.ingestion.test_admit_regulation_rag_release_worker \
  tests.ingestion.test_process_regulation_rag_release_candidates_worker \
  tests.ingestion.test_index_release_acceptance \
  tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite \
  -v
```
