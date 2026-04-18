---
doc_type: requirements
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Requirements: Shared File Asset Loader Contract

## Goal

在不改写 source unit、不破坏 data-plane chain 的前提下，统一 repo 内 file-like asset 的 package-level handling contract：`typing -> normalization -> extraction -> terminal outcome -> provenance`。

## In Scope

- `packages/ingestion-core` 内的 shared file asset contract
- legacy Office normalization contract
- modern Office / PDF / image family extraction contract
- shared provenance / diagnostics / object-store artifact refs
- `authenticated_notice` attachment path 迁移到 shared substrate
- bounded backend benchmark 与 verification matrix

## Non-goals

- 改写 `official_web` page-level source-truth contract
- 改写 `authenticated_notice_portal` notice-level source-truth contract
- 打开 query-serving、embedding、release 或 alias publish
- 把 OCR lane、manual review lane 或 source-specific projection 退化成单一黑盒 parser
- 一次性重写 repo 内所有 ingestion scope

## Success Criteria

1. repo 有清晰的 shared file asset loader contract，owner 固定在 `packages/ingestion-core`。
2. legacy Office、modern Office、PDF、image 的 handling boundary 清晰，不再散落在 source-specific code path 中。
3. shared normalization / extraction 结果能显式表达 `manual_review_required`、`reference_only`、`ocr_required`、`unsupported_binary` 等 terminal semantics。
4. provenance 与 diagnostics 成为 canonical artifact refs，而不是 app-local 临时输出。
5. `authenticated_notice` 成为首个迁移到 shared substrate 的 source channel，但这次迁移不改写其 source-truth unit 或 regulation downstream boundary。

## Canonical Entry

- `docs/plans/shared-file-asset-loader-contract.md`
