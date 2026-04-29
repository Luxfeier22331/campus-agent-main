---
doc_type: phase_plan
status: completed
created: 2026-04-28
updated: 2026-04-28
workstream: notice-derived-regulation-consumption-quality-gate
phase: 07
---
# Phase 07: Docs-Only Gated Reader Opening Closeout

<!-- markdownlint-disable MD013 -->

## Goal

Open one accepted regulation notice into the document reader/docs read-model path only, proving the
selected `internal_notice -> regulations/scoped_rules -> gated reader -> public-docs build`
chain works without opening RAG, query-serving, or public-chat citations.

## Selected Notice

- notice id: `354006`
- title:
  `中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则`
- target scope: `regulations/scoped_rules`
- delivery mode: `gated_asset`

## Tasks

- [x] Add public-docs collection fallback for gated collection landing routes.
- [x] Make app-api docs navigation fail closed when a collection has no readable current docs.
- [x] Extend staging gated docs smoke to check collection navigation as well as gated reader assets.
- [x] Re-run selected dry-run for `354006`.
- [x] Run formal selected import for `354006` with docs read-model import.
- [x] Export public-docs sync manifest and build published reader assets locally.
- [x] Record live staging smoke blocker separately from local closeout evidence.
- [x] Update workstream planning truth and close Phase 07.

## Non-Goals

- Do not open RAG release or query-serving aliases.
- Do not add public-chat citations for regulation notices.
- Do not promote wrapper/amendment-summary notices such as `187233`.
- Do not expose source object keys or raw object locators in browser navigation payloads.

## Evidence

- Closeout evidence summary:
  `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/evidence/phase-07-docs-only-gated-reader-opening-closeout/closeout-evidence.json`
- Dry-run report:
  `.tmp/regulation-docs-opening-354006/document-site-dry-run-closeout/dry-run-report.json`
- Formal import report:
  `.tmp/regulation-docs-opening-354006/document-site-publish-closeout/publish-report.json`
- Public-docs sync manifest:
  `.tmp/regulation-docs-opening-354006/public-docs-sync-closeout.json`

## Verification

- app-api docs tests and typecheck.
- public-docs worker/fallback/sync tests, typecheck, and build.
- selected ingestion dry-run/formal import.
- public-docs published reader asset build.
- targeted ingestion unittest and Python lint/format.
- docs lint and whitespace diff check.
