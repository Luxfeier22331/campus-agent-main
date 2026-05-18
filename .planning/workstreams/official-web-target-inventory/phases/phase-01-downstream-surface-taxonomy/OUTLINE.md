---
doc_type: outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Outline: Downstream Surface Taxonomy

## Goal

Classify the official-web target inventory by downstream owner and serving boundary before adding
page-level targets.

## Planned Deliverables

- Surface taxonomy for `service_guide_lookup`, `contact_directory_lookup` and
  `official_web/stable_reference`.
- Explicit exclusion for `fresh_news`, `news_archive`, generic news notices and promotional pages.
- Mapping from each surface to `consumer_family`, `selected_write_target`, review policy and
  materialization policy.

## Planned Checks

- Target surfaces match `consumer-denominator.json`.
- No target implies runtime opening of news/archive.
- No panel or app-api route bypasses existing official-web control-plane boundary.
- `official-web-collection-restart-closeout` cannot continue scheduler expansion, import or promote
  handoff for target content outside the admitted surface taxonomy.
