---
workstream: official-web-target-inventory
created: 2026-05-01
---

# Project State

## Current Position
**Status:** Complete
**Current Phase:** Closeout complete
**Last Activity:** 2026-05-01
**Last Activity Description:** Phases 1-8 implemented; target inventory manifest, validation,
no-promotion inventory seam, app-api operator projection and protected panel surface completed

## Progress
**Phases Complete:** 9
**Current Plan:** CLOSEOUT.md

## Session Continuity
**Stopped At:** Workstream closeout complete
**Resume File:** None

## Scope Summary

This workstream owns target inventory planning after the official-web target-first collection
refactor. It freezes which public official-web pages should be collected for current downstream
surfaces and how each target moves through preview, review and selected-write readiness.

Allowed initial downstream surfaces:

- `service_guide_lookup`
- `contact_directory_lookup`
- `official_web/stable_reference`

Explicitly excluded:

- broad crawl as collection target
- `fresh_news` / `news_archive` runtime opening
- direct current-truth write
- authenticated notice collection

## Next Action

Future work should start a selected-write/release workstream after a target has replayable
no-promotion preview evidence and complete required fields.
