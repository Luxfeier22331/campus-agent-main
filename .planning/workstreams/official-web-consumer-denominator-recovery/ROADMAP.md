---
doc_type: roadmap
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Official Web Consumer Denominator Recovery

## Overview

This workstream converts official-web recovery from broad crawl evidence into consumer-denominator
collection. It starts with config and gate design, then proves a no-promotion live seam, then only
allows selected write for reviewed candidate records.

## Phases

- [x] **Phase 0: Boundary And Denominator Freeze** — Freeze the workstream boundary, consumer
  families, non-goals and relationship to existing official-web restart closeout.
- [x] **Phase 1: Consumer Denominator Manifest** — Add and validate the repo-tracked denominator
  manifest under `configs/sources/official_web/muc_public/`.
- [x] **Phase 2: Scheduler And Host Scope Recut** — Recut default lanes away from broad news crawl
  and toward consumer-candidate collection.
- [x] **Phase 3: Collector Candidate Gate** — Add candidate classification, retained artifact
  gating and run counters.
- [x] **Phase 4: Consumer-First Projection Routing** — Route candidates into contact/service/stable
  candidate projections and inventory-only notice/news records.
- [x] **Phase 5: No-Promotion Live Seam** — Prove collector/app-api/object-store/handoff/ingestion
  staging without registry promotion.
- [x] **Phase 6: Quality Review And Rule Tuning** — Review first-batch candidate precision and tune
  denominator rules without widening broad crawl.
- [x] **Phase 7: Selected Write And Read-Model Admission** — Publish only reviewed contact/service
  or stable-reference records through selected write gates.
- [x] **Phase 8: Closeout And Handoff** — Update docs, record evidence, and define reopen rules for
  future news/runtime opening.

## Closeout Rule

Close this workstream only after:

- consumer denominator config and validation exist
- default scheduler no longer relies on broad news recovery
- no-promotion live seam is proven
- at least one contact/service/stable candidate batch has quality evidence
- selected write either succeeds for reviewed records or is explicitly deferred with evidence
- `fresh_news` and `news_archive` remain unopened unless a separate workstream admits them
