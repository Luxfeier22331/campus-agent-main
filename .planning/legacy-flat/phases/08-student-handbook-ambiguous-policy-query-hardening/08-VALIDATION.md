---
phase: 08
slug: student-handbook-ambiguous-policy-query-hardening
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-02
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | mixed `uv run --all-packages python -m pytest` / `python -m unittest` plus repo-root `pnpm` workspace tests |
| **Config file** | `pyproject.toml`, `package.json`, `turbo.json`, `pnpm-workspace.yaml` |
| **Quick run command** | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/retrieval/test_backend_qdrant.py tests/specialist/test_rag_specialist.py tests/evals/test_golden_cases.py tests/evals/test_handbook_live_benchmark.py tests/evals/test_retrieval_benchmark.py -q` |
| **Full suite command** | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest discover -s tests -t . && pnpm web:typecheck && pnpm web:test && UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.handbook_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/handbook-runtime-events.jsonl` |
| **Estimated runtime** | ~300 seconds |

---

## Sampling Rate

- **After every task commit:** Run the task-local `<automated>` command from the owning `PLAN.md`
- **After every plan wave:** Run the phase quick run command if the wave is Python-only; run `pnpm web:typecheck && pnpm web:test` after wave 4 TS changes
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | N/A | unit | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/retrieval/test_backend_qdrant.py -q` | ✅ | ⬜ pending |
| 08-01-02 | 01 | 1 | N/A | unit | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/retrieval/test_backend_qdrant.py -q` | ✅ | ⬜ pending |
| 08-02-01 | 02 | 2 | N/A | unit | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/specialist/test_rag_specialist.py -q` | ✅ | ⬜ pending |
| 08-02-02 | 02 | 2 | N/A | unit | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/specialist/test_rag_specialist.py -q` | ✅ | ⬜ pending |
| 08-03-01 | 03 | 3 | N/A | eval-unit | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/evals/test_golden_cases.py tests/evals/test_handbook_live_benchmark.py -q` | ✅ | ⬜ pending |
| 08-03-02 | 03 | 3 | N/A | retrieval-eval | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/evals/test_retrieval_benchmark.py -q` | ✅ | ⬜ pending |
| 08-04-01 | 04 | 4 | N/A | ts-runtime | `pnpm web:test` | ✅ | ⬜ pending |
| 08-04-02 | 04 | 4 | N/A | ts-panel | `pnpm web:test` | ✅ | ⬜ pending |
| 08-04-03 | 04 | 4 | N/A | phase-full | `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest discover -s tests -t . && pnpm web:typecheck && pnpm web:test && UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m campus_evals.handbook_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/handbook-runtime-events.jsonl` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

No new validation framework is required. Phase 8 should extend existing handbook Python suites and existing web/runtime workspace tests rather than creating parallel test infrastructure.

- [x] `tests/retrieval/test_backend_qdrant.py` exists for retrieval-core filter coverage
- [x] `tests/specialist/test_rag_specialist.py` exists for specialist behavior coverage
- [x] `tests/evals/test_golden_cases.py` exists for deterministic handbook-case coverage
- [x] `tests/evals/test_handbook_live_benchmark.py` exists for live executor trace coverage
- [x] `tests/evals/test_retrieval_benchmark.py` exists for retrieval fixture/qrels coverage
- [x] `tests/app_api/test_projection.py` exists for runtime projection coverage
- [x] `tests/api/test_protected_panel_web.py` exists for protected panel request-surface coverage

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| handbook acceptance artifact quality after live provider run | N/A | live benchmark uses real provider/runtime behavior and may need artifact inspection beyond pass/fail | inspect `.tmp/evals/student-handbook-formal-benchmark-accept-*/final-summary.json`, `run/summary.json`, and case-level outputs for the new ambiguous-policy cases |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or existing test coverage
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 has no missing file prerequisites
- [x] No watch-mode flags
- [x] Feedback latency < 300s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned 2026-04-02
