---
doc_type: index
status: completed
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Workstream: Official Web Tool-Driven Source Pack

This native workstream owns the downstream demand and content-family selection for the first
official-web one-time source pack.

It answers a narrower question than the collector restart work:

- which official-web pages should be considered because current or near-current product tools can
  consume them
- which user intents each page supports
- which owner surface and release family each content type should target
- which first-slice pages are excluded, deferred or demand-backed enough to hand off to collection
  execution

## Current Status

- status: `completed`
- current phase: `Phase 2 - Execution handoff complete`
- current slice: accepted downstream demand and content cases frozen for source-pack execution
- active implementation: no
- owner: Codex session

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- source content assessment: `./SOURCE-CONTENT-ASSESSMENT.md`
- source collection cases: `./SOURCE-COLLECTION-CASES.md`
- downstream demand matrix: `./DOWNSTREAM-DEMAND-MATRIX.md`
- execution handoff: `./EXECUTION-HANDOFF.md`
- downstream execution handoff: `../official-web-source-pack-collection-execution/README.md`

## Boundary Notes

- This workstream does not reopen broad crawl.
- This workstream does not open `official_web/fresh_news` or `official_web/news_archive`.
- This workstream does not make the collector decide what to collect.
- This workstream does not write current structured projections directly from collector output.
- This workstream does not put query-time browser scraping or query-time page composition into
  runtime tools.
- This workstream does not implement the repo-tracked source-pack manifest, capture runner,
  ingestion replay, release gate or eval denominator.
- The authoritative output of this workstream is the accepted downstream demand matrix and content
  collection cases. Manifest and execution work continues in
  `official-web-source-pack-collection-execution`.

## Relationship To Existing Workstreams

- `official-web-targeted-collection-refactor` completed the target-first collection pipeline.
- `official-web-target-inventory` completed target inventory and selected-write handoff.
- `official-web-service-info-denominator-realism` fixed optional denominator semantics such as
  `source_not_provided`.
- This workstream narrowed first production-quality source ingestion to a one-time,
  content-assessed, tool-demand-driven pack and then froze the accepted handoff inputs.
- `official-web-source-pack-collection-execution` owns manifest validation, one-time capture,
  source-truth replay, release preview and eval gates after this workstream's demand handoff.
