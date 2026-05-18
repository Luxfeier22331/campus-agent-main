---
doc_type: phase_outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Outline: Source-Truth And Validation

## Goal

Add target lineage to official-web source-truth artifacts and make validators fail closed when lineage is missing or inconsistent.

## Deliverables

- Page manifest target lineage fields.
- Source-truth bundle target summary.
- Validator checks for target job id, candidate id, retention decision and materialization policy.
- QC report counters by target family and retention decision.

## Source-Truth Fields

Runtime artifact fields must use camelCase wire keys:

- `targetJobId`
- `targetCandidateId`
- `targetDeclarationVersion`
- `targetMatches`
- `consumerRetentionDecision`
- `materializationPolicy`
- `selectedWriteTarget`
- `reviewPolicy`

Repo-tracked declaration/config files may keep snake_case input keys, but collector-emitted source-truth and bundle artifacts must stay consistent with existing `schemaVersion` / `normalizedCanonicalUrl` / `pageManifestObjectKey` style.

## Non-Goals

- Do not write current read model.
- Do not put document/chunk/retrieval semantics into source-truth.

## Acceptance

- Every retained source-truth page has target lineage or explicit inventory-only reason.
- Validator rejects retained pages without lineage.
- Rejected/discovery-only pages remain audit counters, not bundle pages.
- Validator rejects snake_case target lineage keys in emitted runtime artifacts unless Phase 1 explicitly changes the whole official-web artifact convention.

## Verification

```bash
pnpm --dir apps/official-web-collector test -- validate
pnpm --dir apps/official-web-collector test -- qc-report
```
