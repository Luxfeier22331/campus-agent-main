---
doc_type: plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---
# Phase 4 Plan: Docs And RAG Consumption Contract

<!-- markdownlint-disable MD013 -->

## Goal

Align document site, docs read-model, and RAG chunk-prep consumption with the regulation
promotion gate.

## Tasks

1. Ensure docs read-model import only sees target canonical documents.
2. Add negative docs import checks for partial amendment notices.
3. Preserve source title/url cards for held notices through notice/Web card consumption.
4. Verify RAG/chunk-prep does not index held regulation-like notice as a full regulation.

## Acceptance Criteria

- Held notices can be searched as notices with title/url.
- Held notices cannot appear as full regulation documents.
- Source provenance is visible for accepted docs.
