---
doc_type: plan
status: planned
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Ingestion Replay And Projection Fan-Out

## Goal

Replay captured source truth into typed downstream candidates or blocked/deferred outcomes.

## Tasks

- Feed source-truth bundle into official-web projection replay.
- Ensure service-guide rows become service guide candidates only when source-backed process exists.
- Ensure contact rows become contact candidates only when source-backed contact fields exist.
- Ensure policy/reference rows enter stable-reference or regulation-style release lanes.
- Preserve manifest entry ID and source refs in every output.
- Produce no-promotion replay report with output counts by class.

## Acceptance Criteria

- Replay reads source-truth artifacts, not live official-web pages.
- Every manifest row has exactly one page-level replay status and zero or more projection outcomes.
- Multi-owner rows can fan out to multiple source-backed projection candidates.
- Optional missing facts are represented as source-not-provided, not invented blockers.
- Ready candidates include source refs and target release class.
- Blocked/deferred rows include deterministic reasons.

## Verification

```bash
uv run --all-packages python -m unittest discover -s tests/ingestion -t .
```
