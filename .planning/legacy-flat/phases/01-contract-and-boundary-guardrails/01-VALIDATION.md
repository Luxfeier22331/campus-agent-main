---
phase: 1
slug: contract-and-boundary-guardrails
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-23
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest + unittest |
| **Config file** | `pyproject.toml` |
| **Quick run command** | `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_routing.py tests/supervisor/test_supervisor_policy.py tests/specialist/test_rag_specialist.py -q` |
| **Full suite command** | `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_routing.py tests/supervisor/test_supervisor_policy.py tests/specialist/test_rag_specialist.py tests/api/test_supervisor_api.py -q && uv run --all-packages python -m unittest discover -s tests -t .` |
| **Estimated runtime** | ~30 seconds |

## Sampling Rate

- **After every task commit:** Run the quick supervisor loop or quick API loop that matches the touched files.
- **After every plan wave:** Run the full suite command.
- **Before `$gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 30 seconds

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | ORCH-02 | unit | `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_routing.py tests/supervisor/test_supervisor_policy.py tests/specialist/test_rag_specialist.py -q` | ✅ | ⬜ pending |
| 1-01-02 | 01 | 1 | GOV-03 | unit | `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_routing.py -q` | ✅ | ⬜ pending |
| 1-02-01 | 02 | 2 | ORCH-03 | unit | `uv run --all-packages python -m pytest tests/api/test_supervisor_api.py -q` | ✅ | ⬜ pending |
| 1-02-02 | 02 | 2 | ORCH-03 | integration | `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_routing.py tests/supervisor/test_supervisor_policy.py tests/specialist/test_rag_specialist.py tests/api/test_supervisor_api.py -q` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- Existing infrastructure covers all phase requirements.

## Manual-Only Verifications

- All phase behaviors have automated verification.

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
