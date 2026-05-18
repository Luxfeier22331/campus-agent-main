---
doc_type: phase_plan
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Scope And Denominator Freeze

## Objective

冻结本 workstream 的边界与 denominator，确保后续 phases 补的是 retrieval quality / ops，而不是
重复 release-hardening 或扩大 serving surface。

## Tasks

1. Read current truth:
   - `.planning/workstreams/canonical-retrieval-release-hardening/STATE.md`
   - `docs/architecture/system/retrieval-serving-architecture.md`
   - `docs/runbooks/index-release-runbook.md`
   - runtime profile / query-serving scope config。
2. Inventory current qrels / release acceptance / chunk quality / runtime observation assets。
3. List query-enabled, retrieval-ready default-off, and offline-preparation scopes。
4. Define qrels scenario denominator:
   - exact title / entity
   - alias / abbreviation
   - long semantic
   - hard negative
   - no-hit
   - authz filtered
   - current-only
   - historical / as_of / compare
   - citation / source back-link
   - freshness-sensitive
5. Freeze privacy posture for runtime observations.
6. Produce Phase 0 summary and evidence file.

## Verification

- Targeted docs lint for new planning files.
- Manual cross-check that no active source collector / notice / service-tool scope is pulled into this line.

## Exit Criteria

- Denominator taxonomy is recorded.
- Phase 1-6 verification matrix is known.
- No implementation files outside planning are touched in Phase 0 unless a direct inventory helper is needed.
