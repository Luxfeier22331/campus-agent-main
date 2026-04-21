---
doc_type: requirements
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Requirements: Bounded Agentic Retrieval Productization

## Goal

在不扩写产品边界的前提下，把 `campus-agent` 的 retrieval 主链路从当前 single-shot baseline 推进到 bounded、planner-first、typed、multi-step 的 agentic retrieval。

## In Scope

- `rag-agent` 的 typed retrieval planning
- `retrieval-core` 的 multi-step execution / bounded replan
- `RetrievalPlan / RetrievalStep / StepResult` contract
- `freshness_sensitive / live_assisted` runtime branch
- source-trust / budget / fail-close gate
- query activity、supporting evidence selection 与 compact observability
- eval / runtime adoption / closeout

## Non-goals

- general web fallback 或开放域 browse
- 把 structured runtime tool family 混成 retrieval step
- 打开新的 query-enabled surface
- 重开 identity / authz / runtime-profile owner
- 绑定单一 retrieval vendor 或 SDK

## Success Criteria

1. repo 中存在独立 workstream，明确把 typed plan、multi-step executor、live branch、observability 与 eval 收口到同一条线。
2. `RetrievalPlan / RetrievalStep` 被正式定义为 code-owned typed artifact，而不是 prompt 内隐式状态。
3. `rag-agent` 与 `retrieval-core` 的 planner/executor 边界明确，且 multi-step execution 不会扩大 serving scope。
4. `freshness_sensitive / live_assisted` 与 source-trust gate 进入正式 runtime contract，而不是继续只停在 target architecture。
5. query activity、candidate set 与 supporting evidence 的分层继续保持，不把 raw trace 直接暴露成用户态 answer truth。
6. workstream closeout 后，repo 能明确区分：当前 merged truth 已完成的 agentic retrieval 能力，和仍然 deferred 的更远期 follow-up。

## Canonical Entry

- `docs/plans/archive/completed/bounded-agentic-retrieval-productization.md`
