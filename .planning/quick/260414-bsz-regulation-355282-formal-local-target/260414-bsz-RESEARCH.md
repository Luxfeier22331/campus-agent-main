# Quick Task 260414-bsz Research

**Description:** 修复 `355282` 的 source projection 缺口并将其正式并入 local regulation target  
**Mode:** quick-full

## Repo Facts

- 当前 local source scope 中，`notice:muc_internal_portal:355282` 曾存在，但它的 `source-truth/attachment-refs.jsonl` 为空。
- 因此此前的 formal local materialization 无法为 `355282` 生成 `notice_attachment:*` owner child。
- repo 内已有可复用的冻结输入：
  - `.planning/quick/260414-regulation-owner-recovery-pilot/run-output-fixed/filtered-notices-bundle.json`
  - 对应 frozen local object-store source bytes
- regulation lane 当前不允许：
  - embedding
  - Qdrant write
  - release / alias

## Decision

当前最小且正确的修复不是重跑整个 `internal_notice` scope，而是：

- 仅修复 `355282` 的 source-truth artifacts
- 仅对 `355282` 执行 non-destructive source projection rebuild
- 仅对白名单 accepted notice set + `355282` 执行 filtered promotion/materialization

这样可以把 `355282` 从 isolated proof 提升为 formal local current target，同时不污染未验收 source scope。
