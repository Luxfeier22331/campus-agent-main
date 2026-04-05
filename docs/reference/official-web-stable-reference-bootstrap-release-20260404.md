---
doc_type: reference
status: active
created: 2026-04-05
updated: 2026-04-05
---

# official_web stable_reference Bootstrap Release Evidence (2026-04-04 UTC)

## Scope

This note records the first real routed replay -> validation -> chunk-audit ->
scope-specific import -> registry-backed release execution for
`official_web/stable_reference`.

It is evidence for:

- the first executable `official_web` corpus-split path beyond the mixed bridge
- `stable_reference` physical collection bootstrap under release management
- routed source-truth replay and single-scope import truth

It is not evidence for:

- the later 2026-04-05 alias publish step itself
- merged-truth acceptance of `official_web/stable_reference` as a default query-serving surface
- fresh-news readiness or news/archive split closure

## Runtime Truth At Execution Time

- runtime profile: `configs/ingestion/official_web/stable_reference/runtime-profile.json`
- serving stage: `offline_preparation`
- serving surface: `stable_reference`
- retrieval enabled: `false`
- query enabled by default: `false`
- serving alias: `official_web_stable_reference`
- local env loaded from: `/home/reptilian/code/campus-agent/.worktrees/official-web-crawler/.env`

## Replay And Validation

Input batch:

- source-truth QC subset: `/tmp/official-web-qc-20260401-batch-d-clean-subset`

Executed:

```bash
uv run --all-packages python -m campus_ingestion_worker.project_official_web_source_truth \
  --output-dir /tmp/official-web-qc-20260401-batch-d-clean-subset \
  --projection-output-dir /tmp/official-web-qc-20260401-batch-d-clean-subset-projection-stable-reference-v1

uv run --all-packages python -m campus_ingestion_worker.validate_official_web_projection \
  --projection-output-dir /tmp/official-web-qc-20260401-batch-d-clean-subset-projection-stable-reference-v1

uv run --all-packages campus-ingestion-audit-official-web-projection-chunking \
  --projection-output-dir /tmp/official-web-qc-20260401-batch-d-clean-subset-projection-stable-reference-v1
```

Replay result:

- `pages_seen=29`
- `emitted_documents=28`
- `manual_review_pages=1`

Validator result:

- `valid=true`
- `documents=28`
- `errors=0`
- `warnings=0`

Chunk audit result:

- `passed=true`
- `document_count=28`
- `total_units=118`
- `total_chunks=138`
- `issue_counts={}`

## Routed stable_reference Subset

Observed routed `target_collection=stable_reference` documents in the replay output:

- `学校概况`
- `学校简介`
- `现任领导`
- `学术名流`
- `本科培养`
- `研究生培养`
- `博士后`
- `基金会简介`
- `校友会简介`

Observed documents that intentionally remained on the mixed bridge:

- `访问学者`
- sampled news / notice pages
- low-value public notices such as recruitment / procurement disclosures

## Scope-Specific Import

Executed:

```bash
uv run --all-packages python -m campus_ingestion_worker.official_web_projection_import \
  --projection-output-dir /tmp/official-web-qc-20260401-batch-d-clean-subset-projection-stable-reference-v1 \
  --replay-input-dir /tmp/official-web-qc-20260401-batch-d-clean-subset \
  --work-dir /tmp/official-web-qc-20260401-batch-d-clean-subset-import-stable-reference-v1 \
  --corpus official_web \
  --collection stable_reference \
  --require-promotable
```

Result:

- `success_count=9`
- `failed_count=0`
- `skipped_count=0`
- routed import only created `stable_reference` documents

Imported document ids:

- `official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85`
- `official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487`
- `official_web:muc_public:article_detail:43fdab9acbf0e68e67fddba209463e97d0b2fe4e`
- `official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2`
- `official_web:muc_public:article_detail:dfd33d034080e7df93a707edef7f555a95d78b13`
- `official_web:muc_public:article_detail:d043e2b8d29c0023c945a9c5909cb09b1f68d0ca`
- `official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916`
- `official_web:muc_public:article_detail:3342689d05d43819a48bbcf7564f013f217ffe46`
- `official_web:muc_public:article_detail:3f735e1c08be05c5426948f7ea737d3d422c6e02`

## Registry-Backed Release

Executed:

```bash
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope \
  --corpus official_web \
  --collection stable_reference \
  --no-publish-alias
```

Result:

- release id: `r20260404_204033`
- serving alias: `official_web_stable_reference`
- physical collection: `official_web_stable_reference__r20260404_204033`
- previous alias target: `null`
- validation status: `passed`
- document count: `9`
- point count: `70`
- published at: `null`

Artifacts:

- `official_web/releases/stable_reference/r20260404_204033/index-release.json`
- `official_web/releases/stable_reference/r20260404_204033/validation-summary.json`

## Conclusion

Current truth after this execution:

- `official_web/stable_reference` now has one real routed replay/import/release path
- the first physical collection exists and is registry-backed
- alias publish was still deferred at bootstrap time; a later 2026-04-05
  `campus_ingestion_worker.scope_alias` step published
  `official_web_stable_reference ->
  official_web_stable_reference__r20260404_204033`
- the next work item after bootstrap was serving-side cleanup so retrieval,
  specialist, and eval code stop assuming that stable-reference behavior can
  only live on `muc_public_pages`
