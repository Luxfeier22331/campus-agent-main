---
doc_type: plan
status: planned
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: First-Slice Manifest Population

## Goal

Populate the initial source-pack manifest from accepted downstream demand rows and source collection
cases.

## Tasks

- Convert accepted IT service guide pages into manifest rows.
- Convert information disclosure policy, process, form and contact pages into composition rows.
- Convert fee reference page into stable-reference row with table-alignment gate.
- Add source-explicit contact rows only when source page provides contact facts.
- Mark excluded/deferred examples explicitly outside the release-ready section.
- Verify every answer-bearing row has demand IDs, owner surfaces and eval questions.

## Acceptance Criteria

- Manifest contains only URLs tied to current first-slice demand.
- Information disclosure rows share a `composition_group`.
- Excluded content remains excluded or deferred and cannot be captured as release-ready by default.
- No row admits broad college-site, news, recruitment, procurement or dynamic-shell collection.

## Verification

```bash
pnpm --dir apps/official-web-collector test
```
