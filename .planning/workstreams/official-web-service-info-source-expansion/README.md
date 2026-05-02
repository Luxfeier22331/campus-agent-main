---
doc_type: index
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Workstream: Official Web Service Info Source Expansion

This workstream continues the denominator-realism closeout by admitting the next source-backed
official-web service-info targets.

It is not a broad crawl restart. Expansion is target-first:

`downstream field gap -> explicit public source URL -> target-source-map admission -> target
inventory row -> no-promotion preview / machine field review -> ingestion-owned selected-write
release task`

## Current Status

- status: `completed`
- current phase: `Phase 2`
- current slice: closeout
- active implementation: none
- owner: Codex session

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- source expansion record: `./SOURCE-EXPANSION.md`
- closeout: `./CLOSEOUT.md`

## Boundary Notes

- This workstream does not reopen host-wide broad crawl.
- This workstream does not create a human approval queue.
- This workstream does not move selected-write mutation into `apps/app-api`.
- This workstream does not promote `official_web/fresh_news` or `official_web/news_archive`.
- This workstream only admits pages that have an explicit downstream owner surface and selected
  write target.
