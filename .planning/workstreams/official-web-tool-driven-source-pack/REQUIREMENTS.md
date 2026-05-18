---
doc_type: requirements
status: active
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Requirements: Official Web Tool-Driven Source Pack

## Goal

Build the downstream demand and content-family basis for the first official-web source pack by
starting from product demand, not from host-wide collection.

The workstream must produce the demand-side contract that allows a later execution workstream to
build a deterministic path from user intent to source page to source truth to tool / RAG
consumption:

`user intent -> owner tool or serving surface -> required facts -> source pack URL -> source truth
artifact -> projection or document release -> eval gate`

## Problem Statement

Recent information-disclosure examples exposed a broader issue: the first source pack cannot be
planned around one topic. The current target inventory can capture service-flow pages and
form-download pages, but it does not yet express the full official-web content shape:

- service procedure pages belong to `service_guide_lookup`
- contact pages belong to `contact_directory_lookup`
- policy / implementation-rule pages belong to RAG or regulation-style stable reference serving
- material / form pages can be service guide components even when they are not standalone guides
- one user topic can require multiple pages composed offline before runtime
- university core references, IT service guides, library references, fee tables and formal policy
  pages have different owners even when they all come from official web

Opening or maintaining a complex collector before this scope is frozen would make collection volume
grow faster than the downstream consumption contract.

## In Scope

- Define the first downstream demand matrix for official-web sourced answers.
- Include only answer-bearing, source-backed, stable pages needed by current or near-current
  product surfaces.
- Classify each source page by:
  - owner surface
  - expected facts
  - composition group
  - release target
  - refresh posture
  - eval questions
- Define offline composition requirements for multi-page topics such as information disclosure.
- Route official-web facts into one of:
  - `campus_services/service_guide`
  - `campus_services/contact_directory`
  - `official_web/stable_reference`
  - `regulations/*` if the page is a formal rule or implementation detail with regulation semantics
- Define eval expectations for tool selection, source citation, fail-close and field completeness.
- Hand off manifest implementation, one-time capture, ingestion replay and release/eval gate
  implementation to `official-web-source-pack-collection-execution`.

## Non-Goals

- No broad crawl.
- No host-wide frontier expansion.
- No default scheduler or incremental refresh implementation in the first pass.
- No `fresh_news` or `news_archive` runtime opening.
- No query-time source scan, browser scrape, or runtime composition.
- No transaction execution for service guides.
- No protected panel direct access to object storage or ingestion-local evidence.
- No app-api selected-write mutation ownership.
- No source-pack manifest implementation in this workstream.
- No collector execution, source-truth replay or release task implementation in this workstream.

## First-Slice Product Demand

The first slice must cover a balanced official-web foundation. Information disclosure is only one
composition group in that foundation.

- university core stable references
- high-frequency information-technology service guides
- source-explicit official contacts
- selected institution-level policy references
- selected public fee references
- information disclosure as one multi-page composition group

## Success Criteria

- Every first-slice source page has a downstream owner and at least one expected user intent.
- Every first-slice source page has a proposed release target or explicit inventory-only exclusion.
- Multi-page service topics have an offline composition contract before runtime consumption.
- `service_guide_lookup` remains a read-only structured facts tool.
- `contact_directory_lookup` remains a read-only contact facts tool.
- `rag-agent` / retrieval consumes stable reference or regulation documents through release lanes,
  not query-time web fetch.
- Demand handoff is complete enough for `official-web-source-pack-collection-execution` to implement
  manifest validation, one-time source truth capture and replay.
- Eval expectations are explicit enough for the execution workstream to implement gates.

## Reopen / Escalation Rules

Escalate to official-web architecture documents if this workstream needs to:

- change the source-channel topology
- open `fresh_news` or `news_archive`
- add a new query-serving surface
- move selected-write ownership from ingestion to app-api
- make collector output directly visible to runtime tools
