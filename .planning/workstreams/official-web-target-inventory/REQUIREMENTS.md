---
doc_type: requirements
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Official Web Target Inventory

## Goal

Create a canonical, reviewable official-web target inventory so collection resumes only for pages
with an explicit downstream owner, required field contract, source URL, preview evidence and release
decision path.

## Problem

The collector is now target-first, but the current target map is still family-level:

- `campus-services-contact-directory`
- `campus-services-service-guide`
- `official-web-stable-reference`
- `official-web-notice-news-inventory`

These targets are useful as admission families, but they are too broad for content-level operation.
They do not answer which exact pages should be collected, what fields are expected from each page, or
why a candidate can or cannot move to selected write.

## In Scope

- Define target inventory semantics in a dedicated inventory manifest that references
  `target-source-map.json` admission targets.
- Decide which current downstream surfaces can consume official-web targets.
- Build a first inventory of explicit target candidates from existing repo config, source-truth
  evidence and public official-web pages.
- Define per-target required fields and release blockers.
- Add or update validation that rejects inventory entries without owner surface, source URL,
  materialization policy, review policy and evidence requirements.
- Produce no-promotion preview evidence for accepted inventory entries before any selected write.
- Define operator-facing review states and handoff to later selected-write release work.

## Out Of Scope

- Broad host crawl recovery.
- Opening `fresh_news` or `news_archive` as query-serving surfaces.
- Direct current-truth write to service catalog or stable reference registry.
- New public chat runtime behavior.
- Authenticated notice portal collection.
- PDF or file-asset extraction beyond source refs needed by official-web target inventory.

## Downstream Surfaces

The initial inventory may only admit targets for:

- `service_guide_lookup`
- `contact_directory_lookup`
- `official_web/stable_reference`

`notice_news_candidate` remains inventory-only unless a separate workstream opens a news or notice
runtime surface.

## Success Criteria

- Every admitted target has a stable `inventory_id`, referenced admission target, source host,
  source URL or deterministic URL hint, owner surface, selected-write target, materialization policy
  and review policy.
- Every admitted target declares required fields and evidence expectations.
- Every accepted inventory entry has a no-promotion preview path that proves staging without
  current-truth promotion.
- Every previewed target records app-api run id, target job or attempt id, source object keys and
  source asset/version identity. Live public URLs may seed discovery, but they are not sufficient as
  replayable release evidence.
- Inventory validation fails closed for missing owner, missing lineage, empty selected-write target
  on non-inventory targets, or serving-surface drift.
- Operator review can see why a target is ready, blocked, inventory-only, or excluded.
- The workstream closes with a handoff record for selected-write/release implementation.

## Non-Negotiable Boundaries

- `hosts.json` and `seeds.json` remain source capability registries, not collection targets.
- `target-source-map.json` remains the target declaration truth.
- Page-level target inventory belongs to a separate manifest and must reference an existing
  `target-source-map.json` admission target instead of extending target-source-map ad hoc.
- Source-truth artifacts remain source-owned and must not embed downstream current-truth state.
- `apps/app-api` remains the official-web control-plane owner.
- `apps/ingestion-worker` remains the offline executor.
- Protected panel reads official-web operator state only through protected Worker BFF and app-api.
- `official-web-collection-restart-closeout` cannot expand scheduler lanes, import current truth or
  promote handoff output for official-web target content until this workstream records accepted
  inventory and preview evidence.
