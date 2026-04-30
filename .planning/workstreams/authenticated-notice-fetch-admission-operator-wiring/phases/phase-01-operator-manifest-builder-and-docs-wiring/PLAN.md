---
doc_type: phase_plan
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Operator Manifest Builder And Docs Wiring

## Goal

Provide the operator/ingestion-worker side of collector attachment fetch admission so selected notice exports can fetch only explicitly admitted attachment refs.

## Tasks

- Add failing worker tests for source-truth inventory to fetch request manifest generation.
- Implement `campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest`.
- Expose the command via package lazy export and console script.
- Update collector README attachment behavior.
- Update bootstrap smoke runbook with selected attachment fetch admission workflow.
- Register workstream planning docs and Phase 1 status.

## Acceptance

- Metadata-only refs are omitted.
- `fetch_to_quarantine`, `fetch_required_for_source_truth`, and `fetch_required_for_admitted_owner` refs produce collector admission rows.
- Explicit missing selected notice ids fail before object-store access.
- Collector docs no longer imply object-store credentials automatically download notice attachments.
