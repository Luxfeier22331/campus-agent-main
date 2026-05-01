---
doc_type: outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Outline: Inventory Contract And Validation

## Goal

Define the target inventory contract and fail-closed validation before the inventory grows.

## Planned Deliverables

- New canonical `target-inventory.json` manifest shape that references `target-source-map.json`
  admission targets.
- Validation for owner surface, source URL or deterministic hints, selected-write target, required
  fields, evidence requirements, review policy and materialization policy.
- Drift check between inventory entries, `target-source-map.json` and `consumer-denominator.json`.
- Test coverage for valid targets, missing owner, missing admission target, missing selected-write
  target and inventory-only exceptions.

## Planned Checks

- Non-inventory target cannot have empty `selected_write_target`.
- Inventory-only target cannot be treated as selected-write ready.
- Target family names remain canonical across app-api, collector and ingestion.
- Extra page-level fields must not be added to `target-source-map.json` without a schema upgrade.
