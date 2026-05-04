---
doc_type: summary
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Summary

## Delivered

- Published the Phase 7 selected-write service-guide tasks into an isolated local target
  environment.
- Seeded the isolated current projection from the Phase 7 full-impact preview bundle before running
  task-scope selected-write publish.
- Verified selected-write publish parity against the Phase 7 preview:
  - task-scope count
  - full-impact count
  - task-scope display names
  - full-impact display names
- Verified runtime reads the published typed service-guide current truth through supervisor-api.

## Local Target Declaration

- isolated PostgreSQL database:
  `campus_agent_official_web_service_guide_proof_b21acc1b8a`
- source bucket:
  `campus-rag-source`
- isolated derived bucket:
  `campus-rag-derived-proof-campus-agent-official-web-service-guid`
- retained local artifact directory:
  `var/official-web-service-guide-isolated-publish-proof/owrun_source_pack_replay_partial_20260503T033001Z`

## Proof Artifacts

- isolated publish proof:
  `var/official-web-service-guide-isolated-publish-proof/owrun_source_pack_replay_partial_20260503T033001Z/official-web-service-guide-isolated-publish-proof.json`
- runtime smoke report:
  `var/official-web-service-guide-isolated-publish-proof/owrun_source_pack_replay_partial_20260503T033001Z/runtime-smoke/service-guide-selected-write-runtime-smoke.json`
- supervisor runtime log:
  `var/official-web-service-guide-isolated-publish-proof/owrun_source_pack_replay_partial_20260503T033001Z/runtime-smoke/supervisor-api.log`

## Key Facts

- proof result: `passed=true`
- preview publish comparison: `passed=true`
- published task count: `2`
- runtime smoke: `passed=true`
- trusted time anchor: `2026-05-04T00:00:01Z`
- published selected-write ids:
  - `owrelease_selected_write_42545656f873dfb4f28c1f99`
  - `owrelease_selected_write_743e6423838f957dad603f46`

## Cleanup / Retention

- isolated PostgreSQL proof database was cleaned after the run:
  `campus_agent_official_web_service_guide_proof_b21acc1b8a` no longer exists.
- isolated derived bucket was intentionally retained for audit:
  `campus-rag-derived-proof-campus-agent-official-web-service-guid`
- local proof artifacts were retained under `var/official-web-service-guide-isolated-publish-proof/`.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.test_service_guide_selected_write_runtime_smoke \
  tests.ingestion.test_official_web_service_guide_isolated_publish_proof \
  tests.evals.service_guide_lookup_release_gate_suite -q

uv run --all-packages python scripts/official_web_service_guide_isolated_publish_proof.py \
  --seam-report var/official-web-source-pack-live-seam/owrun_source_pack_replay_partial_20260503T033001Z/seam-report.json \
  --preview-report var/official-web-service-guide-no-promotion-proof/owrun_source_pack_replay_partial_20260503T033001Z/selected-write-preview/official-web-selected-write-preview-report.json \
  --output-dir var/official-web-service-guide-isolated-publish-proof/owrun_source_pack_replay_partial_20260503T033001Z \
  --source-bucket campus-rag-source
```
