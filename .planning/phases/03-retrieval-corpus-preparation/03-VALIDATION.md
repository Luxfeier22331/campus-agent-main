---
phase: 3
slug: retrieval-corpus-preparation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-24
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `unittest` via `uv run --all-packages python -m pytest` / `python -m unittest` |
| **Config file** | `pyproject.toml` workspace + existing ingestion/retrieval test layout |
| **Quick run command** | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_processing_pipeline.py tests/ingestion/test_process_raw_ingestion_job.py tests/retrieval/test_backend_qdrant.py -q` |
| **Full suite command** | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_processing_pipeline.py tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_corpus_runtime_profile.py tests/retrieval/test_backend_qdrant.py -q && uv run --all-packages python -m unittest discover -s tests -t .` |
| **Estimated runtime** | ~30 seconds quick / ~60 seconds full |

## Sampling Rate

- **After every task commit:** Run `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_processing_pipeline.py tests/retrieval/test_backend_qdrant.py -q`
- **After every plan wave:** Run the full suite command
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds on task loop / 60 seconds on full gate

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | ING-02 | integration | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py tests/ingestion/test_processing_pipeline.py -q` | ✅ | ⬜ pending |
| 3-01-02 | 01 | 1 | ING-02 | unit | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_processing_pipeline.py -q` | ✅ | ⬜ pending |
| 3-02-01 | 02 | 2 | ING-02 | integration | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/retrieval/test_backend_qdrant.py tests/ingestion/test_corpus_runtime_profile.py -q` | ✅ | ⬜ pending |
| 3-02-02 | 02 | 2 | ING-02 | integration | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/ingestion/test_processing_pipeline.py tests/retrieval/test_backend_qdrant.py tests/ingestion/test_process_raw_ingestion_job.py -q` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- Existing ingestion/retrieval test infrastructure is sufficient; Phase 3 adds focused assertions within already-established suites rather than requiring new framework setup.

## Manual-Only Verifications

- All phase behaviors should have automated verification.

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or file-read verification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 is not required beyond existing workspace test infrastructure
- [x] No watch-mode flags
- [x] Task-level feedback latency <= 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
