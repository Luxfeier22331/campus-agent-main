---
doc_type: phase_artifact
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Done Definition: V3 No-Debt Completion

## Completion Definition

This workstream is complete only when `answer_ready_evidence.v3` is implemented, released and audited
for both mandatory query-enabled regulation scopes:

- `regulations/student_rules`
- `regulations/institutional_rules`

Completion requires implementation evidence, semantic oracle evidence, release-lane evidence and
fallback quarantine evidence. Field presence alone is not completion.

## Required Evidence

| Area | Required Evidence |
|------|-------------------|
| Contract | v3 schema, role matrix, required fields, migration classification and tests |
| Taxonomy | controlled vocabularies, alias registry, admission/change policy, unknown/degraded handling |
| Extraction | oracle-backed fixtures proving role/subject/polarity/group/category/procedure/intro semantics |
| Chunking | parent-child clause ids, condition groups and table answer-ready units |
| Release gate | static metadata correctness gate consumed by regulation release admission |
| Retrieval | typed metadata ranking/selection/replan with zero primary text-cue fallback on target v3 releases |
| Answer | typed draft kind and grounding support match oracle |
| Eval | component failures attributed by stage and semantic field |
| Student release | v3 `student_rules` release manifest, acceptance, alias/adoption and post-publish audit |
| Institutional release | v3 `institutional_rules` release manifest, acceptance, alias/adoption and post-publish audit |
| Legacy | old-index fallback isolated and excluded from target completion |

## Negative Completion Criteria

The workstream must remain active or blocked if:

- `institutional_rules` has only compatibility tests and no release/adoption evidence
- release command paths are placeholders
- semantic oracle rows are absent or incomplete
- target v3 release reports any primary text-cue fallback
- static release gates depend on a particular user query
- taxonomy values can be added without admission metadata and version governance
- `regulations/scoped_rules` becomes query-enabled as a side effect
- docs claim merged/serving truth before release evidence exists

## Completion Artifact Requirements

Each completed phase must provide a `SUMMARY.md` with:

- changed files
- command output or artifact paths
- gap ledger updates
- residual risk or explicit no residual gap statement

Phase 9 and Phase 10 summaries must additionally record:

- `manifest_object_key`
- `release_admission_manifest_key`
- `physical_collection_name`
- `serving_alias`
- `document_count`
- `point_count`
- `answer_ready_contract_version`
- `answer_ready_contract_status`
- `retrieval_acceptance_status`
- `post_publish_audit_status`
- `fallback_primary_signal_count`
- `semantic_oracle_pass_count`
- `semantic_oracle_fail_count`

## Phase Mapping

| Requirement | Owner Phase |
|-------------|-------------|
| v3 schema and validation | Phase 1 |
| taxonomy admission and coverage | Phase 2 |
| parent-child clause/condition model | Phase 3 |
| typed extraction | Phase 4 |
| static quality/release gates | Phase 5 |
| retrieval consumption and fallback zero | Phase 6 |
| typed draft and grounding | Phase 7 |
| component eval and oracle attribution | Phase 8 |
| `student_rules` release/adoption | Phase 9 |
| `institutional_rules` release/adoption | Phase 10 |
| legacy quarantine and docs | Phase 11 |
