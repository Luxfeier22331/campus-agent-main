---
doc_type: phase_artifact
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Institutional Denominator

## Purpose

`institutional_rules` is mandatory for this workstream. It must not wait until Phase 10 to discover
contract incompatibility. Early phases must include institutional fixtures.

## Required Early Coverage

Phase 1-4 tests must include institutional examples for:

- category overview
- procedure step
- deadline/time constraint
- material requirement
- parent-child article context
- release-gate validation

## Sample Selection Rule

Phase 0 does not freeze exact document ids from memory. Phase 1 must select concrete current admitted
institutional documents from registry/runtime profile and write them into its summary before changing
extraction behavior. Selection must prefer documents with:

- student-facing procedure or appeal process
- deadline/time constraint
- required materials
- category/listable policy relationship

## Initial Oracle Rows

Semantic shape is frozen in `SEMANTIC-ORACLE.md`:

- `institutional_appeal_procedure`
- `institutional_appeal_deadline`
- `institutional_material_requirement`
- `institutional_category_discovery`

Phase 1 may bind these rows to exact document ids after registry inspection; it may not remove the
rows.

## Fixture Owners

| Fixture Type | Owner Phase |
|--------------|-------------|
| schema validation | Phase 1 |
| taxonomy mapping | Phase 2 |
| parent-child chunk unit | Phase 3 |
| typed extraction | Phase 4 |
| release gate | Phase 5 |
| retrieval/ranking | Phase 6 |
| component eval | Phase 8 |
| release/adoption | Phase 10 |

## Non-Serving Boundary

This denominator does not open `regulations/scoped_rules`. Institutional fixtures must come from
`regulations/institutional_rules`.
