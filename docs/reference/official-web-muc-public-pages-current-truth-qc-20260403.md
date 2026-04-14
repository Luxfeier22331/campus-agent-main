---
doc_type: reference
status: historical
created: 2026-04-03
updated: 2026-04-12
---

# Official Web `muc_public_pages` Current-Truth QC Snapshot (Historical)

## 文档边界

本文只保留 `2026-04-03` 到 `2026-04-05` 这轮 `official_web/muc_public_pages` mixed-bridge QC / candidate gate 的历史快照。

本文回答的是：

- 当时 mixed bridge 的 current truth 规模和 candidate collection 是什么
- 当时 fixed-scope clean/chunking、retrieval qrels 和 deterministic answer gate 收口到了什么程度
- 为什么这些结果后来被拆分并迁移到 active baseline

本文不负责：

- 充当当前 `official_web` 活动基线
- 充当当前 query-serving readiness 判定
- 继续维护当时的 `.tmp` artifact 清单

当前应优先阅读：

- `official-web-stable-reference-eval-baseline-20260405.md`
- `official-web-fresh-news-surface-handoff.md`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`

## Historical Snapshot

当时 mixed bridge 的关键事实固定为：

- registry current truth：`21` 条逻辑文档
- candidate physical collection：`muc_public_pages__r20260404_184508`
- candidate release id：`r20260404_184508`
- runtime posture：`offline_preparation`
- retrieval enabled：`false`
- query enabled by default：`false`

## Historical Gates Closed

这轮 historical QC 实际关闭了三类问题：

1. fixed-scope clean/chunking
   - `release_gate_required` 子集的 header drift、slash identity、notice-fact false positive 等问题已经关闭
   - repaired replay 最终收口到 `28 emitted_documents / 118 units / 138 chunks / 0 issues`
2. import / release candidate
   - final replay 已滚入 candidate release
   - candidate release 收口为 `21` 条文档、`109` 个 points、`validation_status=passed`
3. retrieval / answer gate
   - retrieval qrels：`9` 个 case 全通过
   - deterministic live gate：`13` 个 case 全通过

## Historical Interpretation

这轮历史结果证明的不是“mixed `muc_public_pages` 已经应该默认开放”，而是：

- mixed bridge 已经足够支撑一轮受控的 local retrieval / answer validation
- stable-reference-like 子集和 low-signal fail-close 当时已经具备 repo-tracked gate
- remaining decision 已不再是“数据能不能形成 candidate”，而是“是否继续 publish / query-enable”

后续演进中，这批历史结论被重新拆分成更稳定的 active 文档：

- stable explanation / stable reference 基线，迁移到 `official-web-stable-reference-eval-baseline-20260405.md`
- news 页 handoff 边界，迁移到 `official-web-fresh-news-surface-handoff.md`
- mixed bridge 的 page triage，不再单独作为 active QC 主入口维护

## 历史结论

- `muc_public_pages` 曾经完成过一轮完整 mixed-bridge QC / candidate gate 闭环
- 这份 historical snapshot 说明的是“当时如何从 mixed bridge 走向 split scope”，而不是今天的 active truth
- 当前 repo 的默认口径已经不再以 mixed `muc_public_pages` 为主入口
