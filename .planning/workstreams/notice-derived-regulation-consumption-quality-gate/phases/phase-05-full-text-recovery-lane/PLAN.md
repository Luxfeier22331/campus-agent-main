---
doc_type: plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---
# Phase 5 Plan: Full-Text Recovery Lane

<!-- markdownlint-disable MD013 -->

## Goal

Recover complete regulation text when a notice names a regulation but does not contain the owner
body itself.

## Tasks

1. Define owner lookup order:
   - captured attachment;
   - authenticated file-release document;
   - official web source;
   - existing regulation registry.
2. Store recovery candidates with source evidence and failure reasons.
3. Fail closed when no complete owner document is found.
4. Keep notice-level card consumption for unresolved cases.

## Acceptance Criteria

- Missing owner recovery never invents text.
- Recovered full text creates a new source-backed candidate.
- Unresolved cases remain visible as notice cards, not regulation docs.
