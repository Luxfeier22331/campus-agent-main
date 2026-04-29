---
doc_type: plan
status: active
created: 2026-04-21
updated: 2026-04-23
---

# Phase 1 Plan

## Objective

在任何 donor shell、reader UI 或 API 实现开始前，先把文档站 architecture、published reader assets posture、docs control-plane seam 与 canonical reader model 正式冻结成 repo truth。

## Tasks

1. 新增 `document-site-architecture.md`
   - 冻结 `public-docs` 的 surface ownership
   - 冻结 docs-first / static-reader-assets / canonical-reader / source-card jump posture
   - 明确 docs search、reader、chat 三者的分层

2. 新增 `app-api-document-reader-http.md`
   - 冻结 docs navigation、resolve、version list、docs search seams
   - 冻结 source-card shared payload
   - 明确哪些字段禁止进入 browser-facing control-plane contract

3. 新增 `document-reader-publish-contract.md`
   - 冻结 reader asset package 的 object storage key layout
   - 冻结 deploy sync manifest 与 local staging directory contract
   - 冻结 public / gated / withheld 三种 delivery mode

4. 新增 `canonical-document-reader-model.md`
   - 冻结 `anchor + rootUnitId` 用户态定位语义
   - 冻结 reader projection、published reader assets 与 canonical document truth 的关系
   - 明确 reader/search/chat 的共享字段

5. 新增原生 GSD workstream entry
   - 新建 `.planning/workstreams/document-site-and-canonical-reader/`
   - 把 workstream 注册到 repo-level `WORKSTREAMS.md`
   - 不再把 root `docs/plans/*.md` 当 active entry

6. 更新索引文档
   - `docs/architecture/README.md`
   - `docs/contracts/README.md`
   - `docs/data/README.md`
   - `docs/plans/README.md`

## Constraints

- 不改写 `current-architecture.md` 的 merged truth
- 不把 docs site 描述成已经上线
- 不把 retrieval chunk / source-truth artifact 暴露成用户 contract
- 不把 `/api/docs/*` 重新长成“整篇正文 API”
- 不为了“先跑通”省掉 version / visibility / source-card jump 这三个前向边界

## Verification

- 文档之间无相互冲突：
  - docs architecture
  - docs contract
  - docs data model
  - workstream roadmap / requirements / state
- 新索引文件能把新增文档导到正确入口
- `git diff --check` 通过

## Exit Criteria

- repo 中存在正式的文档站 architecture truth
- repo 中存在正式的 docs control-plane seam truth
- repo 中存在正式的 reader asset publish contract
- repo 中存在正式的 reader projection model truth
- repo 中存在正式的 static reader assets posture truth
- 新 workstream 可继续推进 `Phase 2`
