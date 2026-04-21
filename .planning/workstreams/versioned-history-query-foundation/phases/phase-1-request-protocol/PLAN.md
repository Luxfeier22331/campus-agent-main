---
doc_type: phase_plan
phase: "1"
phase_name: "Request Protocol"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 1 Plan

## Objective

冻结 `versioned history query` 的第一层 request protocol truth，让后续 phase 不再重复争论
“历史查询是不是显式 mode”“旧请求默认 current 还是报错”“`freshness_sensitive` 要不要一起并进来”，
并为 `Phase 2` 的 registry version resolution 留出清晰 handoff。

## Why This Phase Exists

当前 repo 已经有：

- 历史版本保留
- 默认 current-serving
- ADR-0014 对显式历史查询的长期约束
- retrieval/agentic docs 对 query mode 与 pre-filter 的长期方向

当前 repo 还没有：

- query path 的正式 version mode protocol
- 默认 `current` 与显式历史模式的共存规则
- 这条线与 `freshness_sensitive / live_assisted` 的 phase boundary

如果不先做这一步，后续 phase 会持续摇摆：

- 历史意图是否继续由 prompt 猜测
- registry resolution 应该消费什么输入
- retrieval filter 过滤什么范围
- `compare` 究竟是一种 mode 还是普通 current query 的特殊文案

## Locked Inputs

- 普通 query-serving 默认继续只服务当前有效版本。
- 版本选择必须发生在 retrieval 之前。
- 本 workstream 当前只承接 `current / historical / as_of / compare`。
- `freshness_sensitive / live_assisted` 继续是并列 temporal/live branch，不在本 phase 收口。
- `Phase 1` 只冻结 protocol，不直接改 retrieval/filter/answer code。

## Decisions To Freeze

1. versioned history query 的 request protocol 必须显式表达 `query_mode`，不允许隐藏在 prompt 或 retrieval backend 猜测中。
2. `Phase 1` 的 mode 闭集固定为：
   - `current`
   - `historical`
   - `as_of`
   - `compare`
3. 没有显式 `query_mode` 的现有请求，继续默认解释为 `current`。
4. `historical` 表示“显式要查非当前版本”，但具体如何定位版本，留给 `Phase 2`。
5. `as_of` 表示“显式按时间点解析版本”，selector resolution owner 固定留给 registry。
6. `compare` 表示“双侧版本选择 + 变化点回答语义”的显式模式，不允许退化成单侧 lookup。
7. `freshness_sensitive / live_assisted` 不进入本 phase 的 protocol 闭集，避免把历史查询线扩成完整 temporal/live retrieval 总线。
8. 本 phase 冻结的是 protocol truth，不是产品 UI 文案，也不是最终 HTTP 细节。

## Execution Slices

### Slice 1: Freeze Mode Closed Set

- 把 `current / historical / as_of / compare` 写成这条 workstream 的唯一 admitted mode。
- 明确这四个 mode 的边界差异。
- 明确 `freshness_sensitive / live_assisted` 不属于本 phase。

### Slice 2: Freeze Default Current Compatibility

- 明确没有显式 mode 的旧请求继续默认 `current`。
- 明确引入显式历史模式不等于改写当前默认 serving posture。
- 明确 backward-compatible caller behavior 是硬约束。

### Slice 3: Freeze Request-Side Explicitness

- 明确 mode 必须存在于 typed query path / shared seam，而不是 user_goal 的自由文本。
- 明确 mode 不是 operator display label，也不是 retrieval backend 的隐式布尔分支。
- 为后续 contract placement 预留明确边界。

### Slice 4: Freeze Phase Boundary With Registry

- 明确 `Phase 1` 只决定 mode truth，不决定具体 version selector resolution。
- 明确 `Phase 2` 才负责：
  - 版本定位输入
  - resolution output shape
  - selector normalization

### Slice 5: Freeze Phase Boundary With Retrieval And Answer

- 明确 `Phase 3` 才负责 retrieval candidate pre-filter。
- 明确 `Phase 4` 才负责 answer semantics。
- 明确 `compare` 虽然在本 phase 成为显式 mode，但双侧 evidence 规则留给后续 phase。

## Proposed Write Set

- `docs/plans/archive/completed/versioned-history-query-foundation.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/versioned-history-query-foundation/REQUIREMENTS.md`
- `.planning/workstreams/versioned-history-query-foundation/ROADMAP.md`
- `.planning/workstreams/versioned-history-query-foundation/STATE.md`
- `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/CONTEXT.md`
- `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/RESEARCH.md`
- `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/PLAN.md`
- `docs/plans/README.md`

## Verification Matrix

- workstream activation verification
  - 原生 `.planning/workstreams/versioned-history-query-foundation/` 已存在
  - `WORKSTREAMS.md` 已把它列为 active workstream
  - `docs/plans/README.md` 已把它列为 active entry plan
- phase verification
  - `Phase 1` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向本 phase plan
- boundary verification
  - planning truth 明确只冻结四个 mode
  - planning truth 明确保留默认 `current`
  - planning truth 明确 `freshness_sensitive / live_assisted` 不在本 phase 内
- defer verification
  - registry resolution 留给 `Phase 2`
  - retrieval pre-filter 留给 `Phase 3`
  - answer semantics 留给 `Phase 4`

## Exit Rule

Phase 1 完成后，repo 应达到：

- `current / historical / as_of / compare` 已成为这条 workstream 的正式 request-protocol 闭集
- 默认 `current` 兼容语义已明确
- 历史查询不再允许被表述成 prompt/LLM 隐式猜测
- `Phase 2` 可以直接围绕 registry version resolution 开始工作
