---
doc_type: outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Outline: No-Promotion Preview Batch

## Goal

Run target-level no-promotion previews for accepted candidates and prove staging without current
truth writes.

## Planned Deliverables

- Batch preview command or script for explicit inventory entries.
- Per-target preview evidence with target lineage, app-api target attempt, source-truth artifacts,
  ingestion staging status and promotion decision.
- Evidence records include app-api run id, target job id, target attempt id, object keys, raw asset
  id and raw version id when available.
- Failure report for blocked or unreachable targets.

## Planned Checks

- Preview does not dispatch broad host crawl.
- Preview writes staged evidence only.
- Current read-model import remains null unless a later release phase explicitly admits it.
- A target with incomplete lineage becomes `blocked_lineage`, not `ready_for_selected_write`.
