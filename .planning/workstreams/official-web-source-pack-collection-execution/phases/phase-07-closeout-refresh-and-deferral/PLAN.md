---
doc_type: plan
status: planned
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Closeout, Refresh And Deferral

## Goal

Close the one-time source pack and record how future refresh or collector automation can resume
without reopening broad crawl.

## Tasks

- Write closeout with captured rows, ready releases, blocked rows and deferred rows.
- Record manifest refresh posture.
- Record which rows may be re-captured by manifest refresh only.
- Record automation readiness criteria for future collector scheduling.
- Update workstream registry and state.
- Add reopen rules.

## Acceptance Criteria

- Workstream closeout explains current source-pack truth.
- Future automation remains manifest-driven.
- Broad crawl remains excluded by default.
- Blocked/deferred rows have explicit follow-up triggers.
- Runtime opening posture is not overstated beyond released/evaluated outputs.

## Verification

```bash
pnpm docs:lint
```
