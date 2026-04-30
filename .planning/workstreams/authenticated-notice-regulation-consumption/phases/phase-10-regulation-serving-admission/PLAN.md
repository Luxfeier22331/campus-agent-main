---
doc_type: plan
status: completed
created: 2026-04-30
updated: 2026-04-30
---

# Phase 10 Plan: Regulation Serving Admission

## Goal

Move the Phase 9 first-batch regulation targets from materialized/offline-ready
state into controlled serving admission without opening public-chat citation.

## Scope

- Harden registry provenance for the selected first-batch regulation target records.
- Admit `regulations/institutional_rules` into default query-serving.
- Keep `regulations/scoped_rules` retrieval-ready but outside the default
  query-serving allowlist.
- Require verified chunk-preparation evidence before release.
- Build and publish Qdrant aliases for both regulation target collections.
- Publish gated reader assets only; keep public entries closed.
- Add drift guards for profile/allowlist, chunk-budget, provenance idempotency
  and reader revision-track selection.

## Non-Goals

- Do not open public-chat citation for restricted regulation documents.
- Do not promote the remaining `needs_multimodal` or `manual_review` regulation
  candidates.
- Do not change the semantic boundary between `institutional_rules` and
  `scoped_rules`.

## Acceptance

- Provenance hardening execute report shows selected records updated and a
  follow-up dry-run reports zero updates.
- `institutional_rules` profile is `query_serving` and default query-enabled.
- `scoped_rules` profile is `query_serving` / retrieval-enabled, but default
  query-disabled.
- Go request admission accepts `institutional_rules` requested scope and rejects
  `scoped_rules` by default.
- Chunk-preparation reports pass for both scopes.
- Qdrant release reports pass and publish aliases for both scopes.
- Reader asset report shows gated entries only and `public_entry_count=0`.
- Retrieval smoke proves campus-member access works and public filter returns
  no restricted evidence.
