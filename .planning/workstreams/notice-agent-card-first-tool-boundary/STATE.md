---
doc_type: state
workstream: notice-agent-card-first-tool-boundary
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Notice Agent Card-First Tool Boundary

## Current Position

**Status:** Active
**Current Phase:** Phase 0 ready
**Last Activity:** 2026-05-01
**Last Activity Description:** Expanded Phase 0-6 into executable design. Target architecture now freezes card-first notice surface, separates agent-facing discover tool from internal selected notice query functions, and treats `campus_notice_get` body serving as a migration target rather than accepted truth.

## Current Blockers

- Phase 0 must inventory all existing `normalized_body` public-output paths before implementation.
- Phase 0 must record the final `campus_notice_get` migration choice: hardcut, demote, or replace.
- Phase 1 must land before Go/Python behavior changes so both runtimes consume the same contract.

## Next Slice

Execute Phase 0: boundary freeze and body-serving path inventory.

## Initial Verification Targets

```bash
pnpm docs:lint
pnpm exec markdownlint-cli2 ".planning/workstreams/notice-agent-card-first-tool-boundary/**/*.md"
git diff --check
```
