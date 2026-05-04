---
doc_type: closeout
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Closeout

## Outcome

This workstream is complete.

The official-web service-guide consumption path now closes from target-first official-web source
truth to user-facing `service_guide_lookup` behavior with durable proof:

- grouped procedure shape is the canonical projection/runtime truth
- planner/runtime focus selection is deterministic for entry, procedure, materials, contact,
  office-hours and eligibility asks
- source-faithful fail-close remains enforced when the source truly lacks the requested field
- selected-write preview and isolated publish proofs both pass on real retained source-pack
  evidence

## Phase Summaries

- Phase 6 summary:
  `./phases/phase-06-product-eval-and-release-gate/SUMMARY.md`
- Phase 7 summary:
  `./phases/phase-07-real-source-pack-no-promotion-replay/SUMMARY.md`
- Phase 8 summary:
  `./phases/phase-08-isolated-selected-write-publish-proof/SUMMARY.md`

## Phase 0 Gap Resolution

- `G1 cross-language contract canonicalization`: resolved through canonical grouped-procedure and
  focused-section contract updates across contracts, runtime consumers and regression fixtures.
- `G2 typed read-model migration`: resolved through explicit PG read-model persistence and runtime
  consumption coverage for `procedure_groups`, focused sections and field status.
- `G3 declarative composition`: resolved through role-driven composition gating and fail-close
  replay coverage for ambiguous or missing composition roles.
- `G4 preview/release proof split`: resolved through separate Phase 7 no-promotion proof and
  Phase 8 isolated publish proof artifacts.
- `G5 planner focus as runtime quality`: resolved through planner/runtime gates for focused service
  questions.
- `G6 machine-verifiable eval criteria`: resolved through deterministic preview/runtime verifier
  thresholds and product-question release-gate coverage.
- `G7 resumable file truth`: resolved through roadmap, state, phase summaries and this closeout
  file.

## Changed Layers

- contract/runtime shape:
  - `packages/contracts/src/campus_contracts/models_runtime.py`
  - `apps/supervisor-api/cmd/official-web-preview-runtime-verifier/main.go`
  - `apps/supervisor-api/cmd/official-web-preview-runtime-verifier/main_test.go`
- ingestion release/materialization:
  - `apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py`
  - `packages/ingestion-core/src/campus_ingestion_core/object_store.py`
- runtime/eval/proof harness:
  - `scripts/official_web_service_guide_no_promotion_proof.py`
  - `scripts/official_web_service_guide_isolated_publish_proof.py`
  - `scripts/service_guide_selected_write_runtime_smoke.py`
  - `packages/evals/src/campus_evals/official_web_selected_write_preview_runtime_verifier.py`
- regressions:
  - `tests/ingestion/test_official_web_service_guide_no_promotion_proof.py`
  - `tests/ingestion/test_official_web_service_guide_isolated_publish_proof.py`
  - `tests/test_service_guide_selected_write_runtime_smoke.py`
  - `tests/evals/official_web_selected_write_preview_runtime_verifier_suite.py`
  - `tests/evals/service_guide_lookup_release_gate_suite.py`

## Verification

Fresh verification evidence for closeout:

```bash
uv run --all-packages python -m unittest \
  tests.test_service_guide_selected_write_runtime_smoke \
  tests.ingestion.test_official_web_service_guide_isolated_publish_proof \
  tests.evals.service_guide_lookup_release_gate_suite -q

uv run --all-packages python scripts/official_web_service_guide_no_promotion_proof.py \
  --seam-report var/official-web-source-pack-live-seam/owrun_source_pack_replay_partial_20260503T033001Z/seam-report.json \
  --output-dir var/official-web-service-guide-no-promotion-proof/owrun_source_pack_replay_partial_20260503T033001Z \
  --source-bucket campus-rag-source

uv run --all-packages python scripts/official_web_service_guide_isolated_publish_proof.py \
  --seam-report var/official-web-source-pack-live-seam/owrun_source_pack_replay_partial_20260503T033001Z/seam-report.json \
  --preview-report var/official-web-service-guide-no-promotion-proof/owrun_source_pack_replay_partial_20260503T033001Z/selected-write-preview/official-web-selected-write-preview-report.json \
  --output-dir var/official-web-service-guide-isolated-publish-proof/owrun_source_pack_replay_partial_20260503T033001Z \
  --source-bucket campus-rag-source
```

## Artifacts

- Phase 7 proof:
  `var/official-web-service-guide-no-promotion-proof/owrun_source_pack_replay_partial_20260503T033001Z/service-guide-no-promotion-proof-report.json`
- Phase 8 proof:
  `var/official-web-service-guide-isolated-publish-proof/owrun_source_pack_replay_partial_20260503T033001Z/official-web-service-guide-isolated-publish-proof.json`

## Cleanup / Retention

- isolated PostgreSQL proof database was cleaned after Phase 8
- isolated derived bucket was retained for audit
- no hidden repo-root evidence files were introduced; retained artifacts live under `var/`

## Remaining Deferred Items

None inside this workstream's declared scope.

Future widening of service-guide targets, additional official-web composition families, or new
focused product questions should reopen a separate scoped workstream instead of leaving debt here.

## Reopen Rule

Reopen only if one of these drifts:

- grouped procedure or focused section contract diverges across Python/Go/runtime consumers
- official-web role-driven service-guide composition stops fail-closing ambiguous inputs
- selected-write preview or isolated publish proof stops matching task-scope/full-impact semantics
- runtime current queries stop returning source-faithful focused answers for the admitted
  service-guide denominator
