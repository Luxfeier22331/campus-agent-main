---
doc_type: index
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Workstream: Official Web Service Info Denominator Realism

This workstream continues `official-web-service-info-target-expansion` after its closeout exposed a
denominator problem: the initial contact/service machine gate treated every useful downstream field
as release-blocking, even when the real source page does not publish that field.

## Current Status

- status: `completed`
- current phase: `Phase 3`
- current slice: closeout
- active implementation: none
- owner: Codex session

## Target Shape

The desired path is:

`target-first source -> required evidence gate -> optional source-backed fields ->
source_not_provided for absent optional fields -> ingestion-owned selected-write task -> current
structured projection -> app-api/panel operator-safe projection`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- denominator contract: `./DENOMINATOR-REALISM.md`
- closeout: `./CLOSEOUT.md`

## Boundary Notes

- This workstream does not reopen broad official-web crawl.
- This workstream does not create a human approval queue.
- This workstream does not move selected-write mutation into app-api.
- This workstream does not treat missing optional fields as fabricated facts.
- This workstream does not promote the information-disclosure form page as a standalone service
  guide unless release-blocking process evidence is source-backed.
