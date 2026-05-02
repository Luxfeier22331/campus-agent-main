---
doc_type: index
status: active
created: 2026-05-02
updated: 2026-05-02
---
# Workstream: Historical Regulation Denominator Expansion

这是 `historical-regulation-denominator-expansion` 的 native workstream 入口。

这条线只处理已采集的历史 regulation-like notices 中，尚未进入上一轮
`historical-regulation-canonical-chunk-backfill` 完成 cohort 的增量 denominator。
目标是把可用的 notice body owner text 在 ingestion 层归一化为 source-truth refs，
再进入 current canonical、document-units 和 chunk-only 质量验证。

## Current Status

- status: `active`
- current phase: `Phase 01-04 canonical/document-units/chunk-only backfill`
- current focus: run14 denominator audit 已识别 9 个 ready candidates 与 7 个
  recovery/block candidates；当前执行 9 个 ready candidates 的 body-text
  admission、canonical materialization 与 chunk-only preparation

## Boundary

本 workstream 的链路：

```text
run14 already-collected normalized notice bundle
-> denominator audit
-> body-text owner admission into source-truth refs
-> current canonical materialization
-> document-units
-> chunk preparation and quality evidence
```

明确不做：

- 不处理新 notice 的即时入队 / 动态更新流程
- 不写 `rag_release_candidate`
- 不调用 candidate enqueue / processor
- 不生成 embedding
- 不写 Qdrant index
- 不生成 release admission
- 不切 serving alias
- 不发布 public citation 或默认 query serving

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Current Evidence

- denominator audit:
  `./evidence/phase-00-denominator-audit/`
- body-text admission / canonical / chunk evidence:
  `./evidence/phase-01-04-canonical-chunk-backfill/`
