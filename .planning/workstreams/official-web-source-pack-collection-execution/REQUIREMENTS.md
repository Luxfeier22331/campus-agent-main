---
doc_type: requirements
status: active
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Requirements: Official Web Source Pack Collection Execution

## Goal

Build the first official-web source-pack collection execution path from a repo-tracked manifest to
source-truth artifacts, ingestion replay, release gates and downstream consumption proof.

The canonical path is:

```text
tool-driven demand -> source-pack manifest -> one-time capture -> source truth -> ingestion replay
-> typed candidate or stable document -> no-promotion preview -> release gate -> runtime/eval proof
```

## Problem Statement

The repo already has target-first official-web collection machinery, source-truth contracts and
ingestion release lanes, but the first tool-driven source pack still needs an execution plan that
prevents three regressions:

- host/seed based broad crawl quietly becomes the default collection shape again
- collector output is treated as downstream truth before ingestion projection and release gates
- runtime tools query-time fetch or stitch source pages instead of consuming released projections

This workstream exists to close that execution gap.

## In Scope

- Define a repo-tracked source-pack manifest contract for approved official-web URLs.
- Validate manifest rows against downstream demand, owner surface and release target.
- Execute one-time capture only for manifest-admitted URLs.
- Persist canonical page artifacts:
  - `capture/response.html`
  - `capture/response-headers.json`
  - `capture/fetch-metadata.json`
  - `provider/<parser_slug>/page-extraction.json`
  - `provider/<parser_slug>/discovered-links.jsonl`
  - `source-truth/page-manifest.json`
  - `source-truth/content-blocks.jsonl`
- Replay source truth through ingestion-owned projection paths.
- Classify outputs into:
  - `campus_services/service_guide`
  - `campus_services/contact_directory`
  - `official_web/stable_reference`
  - `regulations/*` when regulation-style semantics are admitted
  - `blocked`, `deferred` or `inventory_only`
- Define no-promotion preview and selected-write / stable-reference release gates.
- Define eval acceptance for tool routing, answer shape, citation, fail-close and composition.
- Record future refresh posture without implementing scheduler automation in this workstream.

## Non-Goals

- No broad crawl.
- No host-wide frontier expansion.
- No collector-owned URL discovery as source-pack scope.
- No `fresh_news` or `news_archive` runtime opening.
- No query-time web scraping, browser fetch or page composition in runtime tools.
- No direct collector write into current structured projections, document registry, chunk/index or
  serving alias.
- No app-api ownership of selected-write release task admission, mutation, claim, lease, retry or
  publish state.
- No protected-panel direct access to object storage, queue internals or ingestion-local files.
- No human approval as the normal release requirement; failed deterministic gates should produce
  blocked/deferred outcomes.

## Required Inputs

- `official-web-tool-driven-source-pack` demand matrix and collection cases.
- `configs/sources/official_web/muc_public/target-source-map.json`.
- `configs/sources/official_web/muc_public/consumer-denominator.json`.
- `docs/architecture/domains/official-web/architecture.md`.
- `docs/data/official-web-source-truth-schema.md`.
- `docs/decisions/adr-0018-app-api-official-web-control-plane-ownership.md`.
- Existing collector and ingestion commands/runbooks.

## Success Criteria

1. Every source-pack manifest row has a downstream demand ID, owner surface, release target and
   expected source facts.
2. Manifest validation fails closed for URLs lacking downstream owner or admitted release path.
3. One-time collection captures only manifest URLs and records source-truth artifacts with source
   URL, fetch time, content hash and canonical identity.
4. Ingestion replay produces typed candidates or stable documents from source truth, not live page
   fetches.
5. Multi-page topics such as information disclosure are composed offline with per-field source
   references.
6. No-promotion preview can show what would be written before any current-truth mutation.
7. Release gates are ingestion-owned for selected-write and stable-reference release lanes.
8. Eval proves representative campus user questions route to the intended tool/surface and fail
   closed for excluded content.
9. Future refresh remains manifest-driven and gated; scheduler automation is not treated as a
   prerequisite for this first pack.

## Reopen / Escalation Rules

Escalate to official-web architecture docs before implementation if this workstream needs to:

- open a new query-serving surface
- change app-api / ingestion-worker ownership
- change official-web source-truth schema
- add file-asset extraction beyond URL/reference retention
- expand from manifest URLs to host/section crawl
- serve dynamic-shell or freshness-sensitive pages in the first slice
