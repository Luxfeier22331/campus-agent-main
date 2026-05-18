---
doc_type: plan
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Target Contract

## Goal

Freeze the target-first official-web contract before runtime changes.

## Deliverables

- `target-source-map` v2-compatible declaration semantics while preserving the existing repo-tracked snake_case JSON style.
- Runtime target declaration model loaded as camelCase TypeScript.
- Target job vocabulary:
  `contact_directory_candidate`、`service_guide_candidate`、`stable_reference_candidate`、`notice_news_candidate`.
- Source capability registry semantics for hosts/seeds.
- Consumer-denominator downgrade policy: retained/review gate, not frontier owner.
- Contract fixtures for valid and invalid target declarations.

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

## Implementation Tasks

1. Extend `official-web-core` target-source-map parsing/modeling with canonical hint and policy fields while maintaining backward-compatible config migration only for tracked v1 input when values are losslessly derivable.
2. Add validation for unknown owner surface, selected-write mismatch, unsupported source host, inventory-only selected-write mismatch, and unsupported materialization/retention combinations.
3. Update repo-tracked `target-source-map.json` to the frozen target-first shape.
4. Add focused contract fixture tests proving snake_case config input loads to camelCase runtime model.
5. Document source capability registry vs target declaration ownership in official-web architecture/data docs.

## Non-Goals

- No DB migration until schema is frozen.
- No fresh-news runtime opening.
- No selected-write implementation.
- No collector executor rewrite beyond contract loading/validation.

## Acceptance

- Target declaration can explain why a URL is eligible before fetch.
- Declaration validation rejects unknown owner surface, unknown selected-write target, unsupported host, and inventory-only target with selected-write.
- Existing `contact_directory` / `service_guide` / `stable_reference` targets are expressible.
- Existing `notice_news_candidate` inventory-only target is expressible without creating a new family alias.
- Fixture tests prove snake_case config input loads to camelCase runtime model and emitted artifact keys remain camelCase.

## Verification

```bash
pnpm --dir packages/official-web-core test
pnpm --dir packages/official-web-core typecheck
pnpm --dir apps/official-web-collector test -- consumer-denominator
pnpm docs:lint
```
