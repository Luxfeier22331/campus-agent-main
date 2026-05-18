---
doc_type: phase_outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Outline: Target Contract

## Goal

Freeze the target-first official-web contract before runtime changes.

## Deliverables

- `target-source-map` v2 or equivalent target declaration schema.
- Target job vocabulary:
  `contact_directory_candidate`、`service_guide_candidate`、`stable_reference_candidate`、`notice_news_candidate`.
- Source capability registry semantics for hosts/seeds.
- Consumer-denominator downgrade policy: retained/review gate, not frontier owner.
- Contract fixtures for valid and invalid target declarations.

## Canonical Naming Rules

- Keep `notice_news_candidate` as the official-web collector consumer family.
- Keep `official_web_public_notice` as the notice consumption source family.
- Do not introduce `public_notice_inventory` as a new family enum. If the UI needs this wording, treat it as display copy or target id only.
- Inventory-only behavior belongs to `materialization_policy=inventory_only` and `selected_write_target=""`.

## Wire Naming Rules

- Repo-tracked config remains snake_case input JSON, matching the existing `target-source-map.json` and `consumer-denominator.json` style.
- Loaded TypeScript models and emitted artifacts remain camelCase, matching `official-web-core` current source-truth models.
- New target lineage fields in emitted runtime artifacts must use camelCase wire keys.

## Required Fields

Each target declaration must include:

- `target_id`
- `owner_surface`
- `selected_write_target`
- `consumer_family`
- `source_hosts`
- `url_hints`
- `title_hints`
- `required_evidence`
- `retention_policy`
- `review_policy`
- `materialization_policy`
- `inventory_only` when applicable

The emitted target job/workset/source-truth lineage projection must define the corresponding camelCase wire keys before Phase 2 starts.

## Non-Goals

- No DB migration until schema is frozen.
- No fresh-news runtime opening.
- No selected-write implementation.

## Acceptance

- Target declaration can explain why a URL is eligible before fetch.
- Declaration validation rejects unknown owner surface, unknown selected-write target, unsupported host, and inventory-only target with selected-write.
- Existing `contact_directory` / `service_guide` / `stable_reference` targets are expressible.
- Existing `notice_news_candidate` inventory-only target is expressible without creating a new family alias.
- Fixture tests prove snake_case config input loads to camelCase runtime model and emitted artifact keys remain camelCase.

## Verification

```bash
pnpm --dir apps/official-web-collector test -- consumer-denominator
pnpm --dir apps/official-web-collector test -- target-source-map
pnpm docs:lint
```
