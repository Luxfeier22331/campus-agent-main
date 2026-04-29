---
doc_type: requirements
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Requirements: Versioned History Query Foundation

## Goal

把“保留历史版本”推进为可执行的显式历史查询能力：
为 `current / historical / as_of / compare` 建立正式 request protocol、registry version resolution、
retrieval pre-filter、specialist answer semantics 与 eval coverage，使版本化查询不再停留在 ADR 和 target architecture。

## In Scope

- 显式 version query mode 的 request protocol
- query path / handoff seam 中的 version-selection contract
- registry version resolution 的 owner 和输出边界
- retrieval candidate 阶段的 version-range pre-filter
- `rag-agent` 的 `current / historical / as_of / compare` answer semantics
- 最小 eval coverage 与澄清样本

## Non-goals

- 改写当前默认 serving posture
- 直接实现 UI / 产品交互设计
- 提前冻结 archive index / retention 策略
- 把 `freshness_sensitive` / `live_assisted` 一并纳入这条 workstream
- 让 retrieval backend 或 prompt 自行猜版本意图

## Success Criteria

1. repo planning truth 中存在独立 active workstream，明确 owner 版本化查询而不是继续停留在 deferred reference。
2. `current / historical / as_of / compare` 成为 query path 的显式 mode，而不是模型从自然语言自由猜测。
3. 版本解析职责从 retrieval/answer 层剥离，registry 在 retrieval 前输出明确版本范围。
4. retrieval 在 candidate 阶段就执行 version filter，不靠 answer 层事后裁剪。
5. `rag-agent` 对历史、按时间点、版本对比的回答语义被正式冻结，并有最小 eval 覆盖。

## Canonical Entry

- `docs/plans/archive/completed/versioned-history-query-foundation.md`
