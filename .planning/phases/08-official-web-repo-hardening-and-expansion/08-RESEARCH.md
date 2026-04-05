# Phase 8 Research: Official Web Repo Hardening And Expansion

**Date:** 2026-04-02
**Status:** Complete for planning

## What Exists Now

### Collector layer
- `apps/official-web-collector` already owns:
  - crawl planning
  - host-bounded crawl execution
  - canonical page/source-truth extraction
  - source-truth validator
  - QC report aggregation
- Current source-truth artifacts are already stable enough to support:
  - `capture/`
  - `provider/`
  - `source-truth/`
  - batch-level `source-truth-bundle.json`

### Shared contract layer
- `packages/official-web-core` already freezes:
  - page families
  - page signal summary
  - URL admission and identity derivation
  - batch artifact/report schemas

### Replay/import layer
- `apps/ingestion-worker` already replays official-web source truth into declared projections and validates replay output before import persistence.
- This replay boundary is explicitly downstream of source-truth QC. It is not an extractor fallback layer.

### Config and host scope
- `configs/sources/official_web/muc_public/site.json` already allowlists more hosts than the stable 5-host regression gate.
- The worktree has already validated `law.muc.edu.cn` and `history.muc.edu.cn` through a low-budget Batch A process.

## What Is Stable

- `history` aggregate-card listing quality has already been improved in this worktree.
- `history.muc.edu.cn/` and `history.muc.edu.cn/xwz2025/sy.htm` now replay correctly as `listing_page` after the mixed-card fix.
- `validate`, `qc-report`, projection replay, and projection validator all pass on the current `law/history` batch.

## What Is Still Unstable

### 1. Thin roster family truth

The biggest remaining inconsistency is:

- live `law.muc.edu.cn/szdw1.htm` currently replayed as `listing_page`
- repo reference doc still describes it as `directory_page`
- local direct-roster fixture coverage is not yet enough to freeze the intended distinction between:
  - direct person roster pages
  - category-hub pages that only route to sub-rosters

This is the best first execution target because it sits exactly at the boundary of:

- extractor truth
- source-truth family classification
- repo reference documentation
- future expansion confidence

### 2. Expansion workflow truth

The repo currently has the pieces for expansion, but not one explicit, documented workflow split between:

- stable regression gate
- low-budget host-expansion validation batch

That gap makes it too easy to conflate:

- "host is allowlisted"
- "host passed one Batch A validation"
- "host is stable enough for higher-frequency scheduling"

## Recommended Phase Breakdown

### Plan 08-01
Resolve thin roster family truth.

Expected outputs:
- extractor/test fix if needed
- live-batch evidence refreshed
- audit/reference docs corrected

### Plan 08-02
Freeze expansion workflow.

Expected outputs:
- runbook wording that distinguishes stable gate vs expansion batch
- explicit replay/import checklist for new host batches
- one reusable reference pattern for future Batch A host validation notes

## Risks To Avoid

- Solving roster-family issues by replay-layer compensation instead of collector truth
- Promoting more hosts or faster scheduler lanes before the regression gate is explicit
- Treating root-worktree planning progress as current worktree merged truth
- Reopening retrieval or app topology while trying to solve source-truth quality
