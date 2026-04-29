# Quick Task 260411-vk3 Verification

## Fresh Commands

### 1. New TDD lane

Command:

- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_materialize_internal_notice_regulation_worker`

Observed:

- `2` tests
- `OK`

This verifies:

- target materialization module exists
- worker CLI exists
- request filters wire through correctly

### 2. Adjacent regression lane

Command:

- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_build_internal_notice_regulation_promotion_manifest_worker tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_materialize_internal_notice_regulation_worker`

Observed:

- `13` tests
- `OK`

This verifies:

- existing promotion manifest behavior still passes
- new target materialization path coexists with the current source-side manifest builder

### 3. Wider ingestion/config/workspace lane

Command:

- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_build_internal_notice_regulation_promotion_manifest_worker tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_materialize_internal_notice_regulation_worker tests.ingestion.test_corpus_runtime_profile tests.ingestion.test_collection_config tests.test_workspace_layout`

Observed:

- `34` tests
- `OK`

This verifies:

- config/runtime-profile truth remains coherent
- new files do not break workspace/package layout expectations

## Final Verdict

- Wave D post-release target materialization is now implemented and verified
- Remaining authenticated-notice repo-local gap is downstream target chunk prep / validation and later release posture, not promotion materialization itself
