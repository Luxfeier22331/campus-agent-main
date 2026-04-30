---
created: 2026-04-30T00:00:00+08:00
title: 清理 workstream / phase planning truth 漂移
area: planning
owner: repo-planning
priority: backlog-after-canonical-retrieval-phase0
files:
  - .planning/WORKSTREAMS.md
  - .planning/workstreams/document-site-and-canonical-reader/STATE.md
  - .planning/workstreams/document-site-and-canonical-reader/ROADMAP.md
  - .planning/workstreams/official-web-collection-restart-closeout/STATE.md
  - .planning/workstreams/official-web-collection-restart-closeout/ROADMAP.md
  - .planning/workstreams/authenticated-notice-fetch-admission-operator-wiring/ROADMAP.md
  - .planning/workstreams/shared-file-asset-loader-contract/
  - .planning/workstreams/product-path-safety-prompt-grounding-governance/
  - .planning/workstreams/official-web-university-level-collection-dev-closeout/
---

## Problem

Repo-wide workstream review on 2026-04-30 found planning hygiene drift that should not be
mixed into `canonical-retrieval-release-hardening` execution:

- `document-site-and-canonical-reader` remains in `Active` registry even though local Phase 1-7
  implementation is complete.
- `official-web-collection-restart-closeout` has pending roadmap phases but no native phase
  directories.
- `authenticated-notice-fetch-admission-operator-wiring` Phase 2 has evidence / summary but no
  standalone `PLAN.md`; the plan is currently embedded in `ROADMAP.md`.
- Several completed historical workstreams use nonstandard phase artifact shapes, so generic
  `gsd-sdk workstream.progress` reports incomplete progress even when the registry treats them as
  completed.

These issues pollute global planning progress and can mislead future session routing, but they do
not block canonical retrieval release hardening.

## Solution

Handle this as a separate planning hygiene pass:

1. Move `document-site-and-canonical-reader` to Completed or explicitly document why it remains
   Active.
2. Add native phase directories or a roadmap-only status note for
   `official-web-collection-restart-closeout`.
3. Add a Phase 2 `PLAN.md` for `authenticated-notice-fetch-admission-operator-wiring`, or document
   ROADMAP-only planning as intentional.
4. For completed historical workstreams, either backfill summaries or add status-semantics notes
   explaining why generic GSD progress is not authoritative.
5. Keep this cleanup separate from runtime/data-plane workstreams.
