---
doc_type: index
status: completed
created: 2026-05-02
updated: 2026-05-03
---
# Workstream: Historical Regulation Denominator Expansion

这是 `historical-regulation-denominator-expansion` 的 native workstream 入口。

这条线只处理已采集的历史 regulation-like notices 中，尚未进入上一轮
`historical-regulation-canonical-chunk-backfill` 完成 cohort 的增量 denominator。
目标是把可用的 notice body owner text 在 ingestion 层归一化为 source-truth refs，
再进入 current canonical、document-units 和 chunk-only 质量验证。

## Current Status

- status: `completed`
- completed phase: `Phase 07 closeout`
- closeout: run14 已采集 regulation-like notices 已完成扩大面收口。9 条进入
  canonical/document-units/chunk 质量口径，其中仅 `191705` 是校级
  `institutional_rules`，可作为后续显式 document-site / RAG release gate
  候选；8 条院级/专项规则保留为 `scoped_rules` chunk-only non-serving
  evidence。`355282`、`187233`、`177880` 因无 captured owner source / 完整
  owner text 继续 blocked，不进入 canonical/chunk。

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

下游消费基调：

- `regulations/institutional_rules` 是校级 regulation；完成质量验证后，只有它可以在后续显式
  release gate 中进入文档站或 RAG consumption
- `regulations/scoped_rules` 是院级/专项 regulation holding collection；本 workstream
  只允许生成 canonical/document-units/chunk-only 质量证据，不进入文档站、RAG
  release candidate、embedding/index 或 serving alias

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
- school-level inventory:
  `./evidence/phase-05-school-level-inventory/`
- school-level owner-text recovery audit:
  `./evidence/phase-06-school-level-owner-text-recovery/`
- closeout:
  `./evidence/phase-07-closeout/`
