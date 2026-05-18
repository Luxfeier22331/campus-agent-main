---
doc_type: phase_artifact
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Release Adoption Proof

## Required Proof Chain

For each mandatory scope, serving adoption requires this chain:

1. canonical document-units exist and are current
1. chunk preparation uses v3 profile/contract
1. release admission manifest is written
1. registry scope release or regulation candidate processor runs with that admission manifest
1. retrieval acceptance passes
1. serving alias is published or explicitly adopted
1. post-publish audit passes
1. component semantic oracle passes against the serving alias

## Mandatory Scopes

- `regulations/student_rules`
- `regulations/institutional_rules`

## Required Manifest Fields

The release/admission evidence must record:

- `schema_version`
- `policy_version`
- `admission_run_id`
- `corpus`
- `collection`
- `admission_status`
- `cleaning_policy_version`
- `chunk_profile_version`
- `runtime_profile_identity`
- `document_count`
- `documents`
- `chunk_quality_status`
- `answer_ready_contract_version`
- `answer_ready_contract_status`
- `qrels_coverage_status`
- `reader_publish_status`
- `authz_denial_check_status`
- `semantic_oracle_status`
- `fallback_budget_status`

If the current implementation does not yet emit `answer_ready_contract_version`,
`semantic_oracle_status` or `fallback_budget_status`, Phase 5/8 must add them before Phase 9/10 can
claim completion.

## Alias Evidence

Acceptable alias proof:

- release command output has `published_at` and `published=true`, or
- `scope_alias` output proves the serving alias points to the intended physical collection, or
- explicit alias adoption report proves the current alias already points to the target v3 physical
  collection and post-publish audit passed

Unacceptable alias proof:

- physical collection exists but alias not checked
- document site or reader publish succeeded
- local dry-run output without alias/current-pointer proof
- old-index compatibility report

## Post-Publish Audit

Post-publish audit must include:

- release drift guard status
- payload/index audit status
- required filter index status
- sampled point payload contract version
- fallback primary-signal count
- semantic oracle result count

## Phase 9/10 Report Contract

Phase summaries must paste or link the command outputs for:

- admission manifest creation
- release processing or registry scope release, with the chosen path named
- alias publish/adoption from either release `--publish-alias` output or explicit `scope_alias`
  output
- post-publish audit
- component oracle eval
