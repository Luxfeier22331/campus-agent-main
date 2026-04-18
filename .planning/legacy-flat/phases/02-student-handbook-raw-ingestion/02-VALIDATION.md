---
phase: 2
slug: student-handbook-raw-ingestion
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-24
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `unittest` via `uv run --all-packages python -m pytest` / `python -m unittest` |
| **Config file** | `pyproject.toml` workspace + existing ingestion test layout |
| **Quick run command** | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_register_raw_asset.py tests/ingestion/test_process_raw_ingestion_job.py -q` |
| **Full suite command** | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_register_raw_asset.py tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_registry_models.py tests/ingestion/test_handbook_canonical.py tests/ingestion/test_handbook_cleanup.py tests/ingestion/test_processing_pipeline.py tests/ingestion/test_corpus_runtime_profile.py -q && uv run --all-packages python -m unittest discover -s tests -t .` |
| **Estimated runtime** | ~25 seconds quick / ~45 seconds full |

## Sampling Rate

- **After every task commit:** Run `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_register_raw_asset.py tests/ingestion/test_process_raw_ingestion_job.py -q`
- **After every plan wave:** Run the full suite command
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 25 seconds on task loop / 45 seconds on full gate

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | ING-01 | unit | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_register_raw_asset.py -q` | planned in task | ⬜ pending |
| 2-01-02 | 01 | 1 | ING-01 | integration | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py -q` | ✅ | ⬜ pending |
| 2-02-01 | 02 | 2 | ING-01 | unit | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_handbook_canonical.py tests/ingestion/test_process_raw_ingestion_job.py -q` | ✅ | ⬜ pending |
| 2-02-02 | 02 | 2 | ING-01 | integration | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_registry_models.py tests/ingestion/test_handbook_cleanup.py tests/ingestion/test_processing_pipeline.py tests/ingestion/test_corpus_runtime_profile.py -q` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- Existing test infrastructure is sufficient; Phase 2 creates new regression files inside the planned tasks rather than relying on external prereq scaffolding.

## Manual-Only Verifications

- All phase behaviors should have automated verification.

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or file-read verification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 is not required beyond existing workspace test infrastructure
- [x] No watch-mode flags
- [x] Task-level feedback latency <= 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
