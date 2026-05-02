---
doc_type: index
status: active
created: 2026-05-02
updated: 2026-05-02
---
# Workstream: Historical Regulation Canonical Chunk Backfill

这是 `historical-regulation-canonical-chunk-backfill` 的 native workstream 入口。

这条线负责把已采集的历史存量 regulation notices 统一推进到 current canonical、
document-units、chunk preparation 与 chunk quality evidence。它刻意停在
chunk 质量验收 / handoff 之后，不进入 RAG release lane。

## Current Status

- status: `active`
- current phase: `Phase 5 chunk quality review closeout`
- current focus: 对已经生成的 historical target-limited chunk evidence 做统一质量验收；
  在验收前不进入 embedding、index、release admission 或 alias publish

## Boundary

历史存量 regulation 处理链路：

```text
historical notice source truth
-> target admission review
-> canonical cleaning
-> document-units
-> optional gated reader/preview assets
-> chunk preparation
-> chunk quality evidence
-> explicit later-release handoff decision
```

明确不做：

- 不写 `rag_release_candidate`
- 不调用 `campus-ingestion-enqueue-regulation-rag-release-candidates`
- 不调用 `campus-ingestion-process-regulation-rag-release-candidates`
- 不生成 embedding
- 不写 Qdrant index
- 不生成 release admission
- 不切 serving alias
- 不修复或推进既有 candidate store 状态
- 不使用新 notice 的即时动态更新流程

## Why This Workstream Exists

历史存量 regulation backfill 与新 notice 动态更新不是同一类流程。历史存量的风险集中在：

- 旧 canonical/清洗质量可能不满足当前 ingestion 层标准
- chunk 规则还需要在真实样本上统一验收
- 部分 notice 是历史周期性规则、学院局部规则或 search-only scoped rules
- 下游 RAG release 链路成本高，不能在 chunk 质量未统一确认前提前 embedding/index

因此这条 workstream 先建立一个 offline preparation lane。只有在 chunk
质量统一验收完成后，才允许生成显式 handoff；后续是否进入独立 RAG release phase
由另一条 phase 决定。

## Source Truth And Adjacent Workstreams

- upstream canonical backfill:
  `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`
- promotion quality gate:
  `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/README.md`
- downstream release lane:
  `.planning/workstreams/regulation-rag-release-lane/README.md`
- authenticated notice architecture:
  `docs/architecture/domains/authenticated-notice/architecture.md`
- retrieval serving architecture:
  `docs/architecture/system/retrieval-serving-architecture.md`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Phase Plans

- `./phases/phase-00-chunk-only-boundary-and-inventory/PLAN.md`
- `./phases/phase-04-chunk-preparation-batch/PLAN.md`
- `./phases/phase-05-chunk-quality-review-closeout/PLAN.md`
