---
doc_type: phase_plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---

# Phase 0 Plan: Boundary And Baseline

## Goal

固定本 workstream 的校级采集边界、上游 evidence、当前 repo truth 和 non-goals。

## Inputs

- `.planning/workstreams/official-web-collection-restart-closeout/STATE.md`
- `configs/sources/official_web/muc_public/hosts.json`
- `configs/sources/official_web/muc_public/scheduler-policy.json`
- `docs/architecture/domains/official-web/architecture.md`
- `docs/policies/official-web-crawl-policy.md`

## Primary Write Set

- this workstream `STATE.md`
- this workstream `ROADMAP.md`
- this workstream `REQUIREMENTS.md`

## Steps

1. Re-read upstream official-web restart closeout state.
2. Capture latest accepted university-core evidence.
3. Confirm this workstream only covers校级 `university-core-*` lanes.
4. Record that院级 remains single-host validation and is out of scope.
5. Record that import/promote is dry-run only until explicitly executed later.
6. Record all open evidence slots in `STATE.md`.

## Verification

```bash
pnpm docs:lint
```

## Exit Criteria

- Scope and non-goals are explicit.
- Latest upstream evidence paths and counts are recorded.
- No serving surface, routing gate, or product opening change is claimed.
