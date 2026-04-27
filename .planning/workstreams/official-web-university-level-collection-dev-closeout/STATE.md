---
doc_type: state
status: active
created: 2026-04-28
updated: 2026-04-28
---

# State: Official Web University-Level Collection Dev Closeout

## Current Status

- status: `active`
- current phase: `Phase 0`
- owner: unassigned
- active implementation: planning only
- latest slice: workstream created and phases planned

## Current Baseline

- Upstream workstream `official-web-collection-restart-closeout` has fresh
  `university-core` evidence from 2026-04-27.
- Latest accepted fixed projection path:
  `apps/official-web-collector/.tmp/official-web-rollout/20260427T223542Z/university-core-projection-fixed`
- Latest accepted university-core fixed projection validation:
  `60` documents, `0` errors, `0` warnings.
- Latest accepted university-core chunk audit:
  `passed = true`, `issue_counts = {}`, `total_units = 431`, `total_chunks = 472`.
- Current registry import/promote state for this workstream: not executed.
- Current serving surface change for this workstream: none.

## Active Lanes

- `university-core-hot`
  - hosts: `www.muc.edu.cn`, `news.muc.edu.cn`, `xxgk.muc.edu.cn`
  - current scheduler policy: enabled
  - intended local role: small high-frequency dev lane
- `university-core-baseline`
  - hosts: `www.muc.edu.cn`, `news.muc.edu.cn`, `xxgk.muc.edu.cn`, `lib.muc.edu.cn`,
    `xiaoyou.muc.edu.cn`
  - current scheduler policy: enabled
  - intended local role: main baseline evidence lane before college rollout

## Pending Evidence

- dev runner command evidence: pending
- preflight evidence: pending
- fresh `university-core-baseline` evidence: pending
- repeated-run comparison evidence: pending
- retention dry-run evidence: pending
- alert summary evidence: pending
- import/promote handoff dry-run evidence: pending

## Blockers / Risks

- Do not promote artifact-only projection as registry truth.
- Do not enable college recurring crawl as part of this workstream.
- Do not open `fresh_news` / `news_archive` query-serving as a side effect.
- Output directories must be run-id isolated to avoid confusing old evidence
  with fresh evidence.

## Continuity Notes

- Start execution from Phase 0.
- Prefer implementing durable dev runner / preflight contracts before running
  more live crawls.
- If Phase 4 finds new projection or chunk audit issues, fix projection/audit
  before Phase 5.
