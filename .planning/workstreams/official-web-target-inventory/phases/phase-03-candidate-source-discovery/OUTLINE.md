---
doc_type: outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Outline: Candidate Source Discovery

## Goal

Build the first explicit target candidate inventory from existing evidence and targeted public pages.

## Planned Deliverables

- Candidate list grouped by downstream surface.
- Source URL, host, title, reason and owner for each candidate.
- Rejection list for pages that look relevant but have no current downstream consumer.
- Source locator references for discovery and replayable evidence requirements for acceptance.

## Planned Checks

- No broad crawl is used as a collection target.
- Discovery candidates are source-backed.
- Live public URLs may seed discovery, but accepted candidates require replayable app-api /
  source-truth evidence after preview.
- Listing pages are discovery-only unless they independently satisfy target evidence rules.
