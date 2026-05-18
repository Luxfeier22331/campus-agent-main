---
doc_type: plan
phase: phase-01-current-tool-surface-inventory
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Current Tool Surface Inventory

## Goal

Produce the source-of-truth inventory for current tool surfaces and identify drift
between Go runtime policy, structured planner, contracts, Python adapters and evals.

## Tasks

1. Search current code and docs for all known tool names.
2. Map each tool to owner agent, payload kind, result type, query service and eval coverage.
3. Identify duplicate or implicit truth in Go, Python, contracts and fixtures.
4. Classify each gap as registry, schema, lifecycle, eval or docs drift.
5. Write inventory and drift gap report under this phase directory.

## Write Scope

- `.planning/workstreams/execution-tool-calling-governance/phases/phase-01-current-tool-surface-inventory/`

## Verification

```bash
rg -n "transport_schedule_lookup|service_status_lookup|service_guide_lookup|contact_directory_lookup|campus_notice_discover|campus_notice_get|retrieval.query" apps packages configs docs tests
pnpm docs:lint
git diff --check
```
