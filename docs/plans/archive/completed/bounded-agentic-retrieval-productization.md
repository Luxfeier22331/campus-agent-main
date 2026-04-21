---
doc_type: plan
status: completed
created: 2026-04-21
updated: 2026-04-22
---

# Bounded Agentic Retrieval Productization

## Completion Note

这条 workstream 已关闭。

它完成的是当前 admitted retrieval 主路径的 bounded productization：

- typed retrieval plan
- planner / executor multi-step kernel
- `current / historical / as_of / compare` version-aware retrieval support
- generic `freshness_sensitive / live_assisted` 与 source-trust seam
- query activity / supporting evidence / raw retrieved trace 分层
- compact operator-safe observability carrier
- deterministic + supplemental acceptance matrix

## Goal

在不扩写产品边界的前提下，把 `campus-agent` 的 retrieval 主链路从 single-shot baseline
推进到 bounded、planner-first、typed、multi-step 的 agentic retrieval，并把它正式收口。

## What This Plan Closed

- 为 `rag-agent -> retrieval-core` 主链路建立 planner-first、typed、multi-step 的 bounded campus retrieval truth
- 固定 `RetrievalPlan / RetrievalStep`、budget、fail-close、version-aware retrieval 与 source-trust contract
- 固定 `retrieval_plan_summary`、`sourceTrace.retrieved`、`sourceTrace.supporting` 的并列边界
- 固定这条线的 acceptance carrier：
  - deterministic regression
  - repo-tracked live acceptance artifacts
  - `app-api` eval correlation seam
- 明确 official-web current-information owner、generic live consumer admission 与 non-current live ingress follow-up 不再由这条线代偿

## In Scope

- `docs/contracts/rag-agent-retrieval-plan-contract.md`
- `docs/data/retrieval-query-activity-model.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/architecture/agentic-retrieval-architecture.md`
- 把 `rag-agent -> retrieval-core` 从当前 single-shot baseline 推进到 planner-first、typed、multi-step 的 bounded campus retrieval
- `RetrievalPlan / RetrievalStep`、bounded replan、budget、query activity 与 supporting-evidence selection 的正式 contract
- `freshness_sensitive / live_assisted` 与 source-trust gate 的 runtime 化
- 与现有 versioned-history、runtime-profile、authz/filter truth 的衔接顺序

## Out Of Scope

- 打开新的 query-enabled serving surface
- 把 `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_*` 这类 structured runtime query 伪装成 retrieval step
- 引入 general web fallback、开放域 browse 或 provider black-box web tool
- 改写 identity / authorization / runtime-profile owner
- 绑定单一 retrieval vendor、SDK 或 infra provider

## Completion Truth

- 当前 admitted retrieval scope 已具备：
  - typed retrieval plan
  - multi-step executor
  - `current / historical / as_of / compare` version-aware retrieval support
  - generic `freshness_sensitive / live_assisted` 与 source-trust seam
  - query activity / supporting evidence / raw retrieved trace 分层
  - compact operator-safe observability carrier
  - deterministic + supplemental acceptance matrix
- 这份 plan 不再承载默认待做 retrieval 实现任务
- 后续只有命中 reopen rule 时才重新激活

## Canonical Entry

- `.planning/workstreams/bounded-agentic-retrieval-productization/STATE.md`
- `.planning/WORKSTREAMS.md`

## Reopen Rule

只有在以下情况之一发生时，才应恢复这条 workstream：

- repo 重新 admission 新的 retrieval step type 或 planner/executor lifecycle
- 某个具体产品面决定正式消费 generic `live_source_lookup`
- raw retrieved trace / supporting evidence / operator observability contract 被显式改写
- non-current runtime acceptance 被提升为 retrieval owner 范围，而不是 runtime-specific follow-up

## Explicitly Routed Out

- official-web “今天 / 最新 / 最近” current-information owner
- structured runtime tools / notices / services / navigation runtime opening
- generic live seam 的具体 consumer opening
- 新的 query-enabled collection opening
- runtime-specific non-current app-api acceptance follow-up

- 打开新的 query-enabled serving surface
- 把 `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_*` 这类 structured runtime query 伪装成 retrieval step
- 引入 general web fallback、开放域 browse 或 provider black-box web tool
- 改写 identity / authorization / runtime-profile owner
- 绑定单一 retrieval vendor、SDK 或 infra provider

## Lifecycle Contract

- 文档 lifecycle 保持 `active`
- 当前已完成 `Phase 1-4` 的 generic retrieval seam、query activity 与 operator-safe observability closeout，并进入 `Phase 5` planning；这仍不代表 repo 已进入 unrestricted 或 open-ended retrieval product completion
- active execution state 只写在 `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`

## Current Baseline

当前 merged truth 已具备：

- `supervisor -> rag-agent -> retrieval-core` 主链路
- dense + sparse hybrid 的 single-shot retrieval baseline
- query-enabled `student_handbook` / `curriculum_plan`
- typed `current / historical / as_of / compare` version-query foundation
- retrieval trace 与 supporting evidence 分层
- `rag-agent` ordered retrieval plan emission
- `retrieval-core` multi-step indexed-lookup executor
- compare dual-step execution 与 bounded replan fail-close
- generic `freshness_sensitive / live_assisted` runtime branch
- `freshness_gate` / `live_source_lookup` typed step subset
- plan-level source-trust policy 与 live lookup fail-close seam
- `RetrievalStepActivity` / query activity data model
- supporting evidence 作为 retrieved evidence 受控子集的主链路实现
- compact `retrieval_plan_summary` operator carrier
- retrieval / runtime acceptance runners 的基础设施

当前仍缺：

- eval matrix、runtime acceptance evidence 与 residual gap routing 的最终 closeout
- 各具体 product consumer 对 generic live seam 的 owner admission
- route-level non-current live acceptance 若未来需要产品化，仍需 runtime-specific workstream 明确 owner

固定边界补充：

- `official_web/fresh_news` 不属于 `rag-agent` 的 query-serving surface
- “今天 / 最新 / 最近”这类 official-web 时效问题，长期应走 tool/runtime owner path，而不是被这条 workstream 重新塞回 RAG

## Execution Contract

bounded campus agentic retrieval 始终按一条 workstream 推进：

1. typed retrieval plan contract
2. planner / executor multi-step kernel
3. freshness / live-assisted / source-trust admission
4. query activity / evidence selection / observability
5. eval / runtime adoption / planning closeout

固定原因：

- plan contract、executor、live branch、evidence policy 与 observability 共享同一条 `rag-agent + retrieval-core + runtime gate` truth
- 若拆成多条 lane，容易留下半 agentic、半 hidden-prompt 的腐烂状态，或把 general-web fallback 混回 campus retrieval 主路径

## Fixed Rules

- 只做 `bounded campus agentic retrieval`，不扩到开放域问答
- retrieval plan 不能扩大 query-enabled surface，不能绕过 authz / visibility / runtime-profile gate
- structured runtime tools 继续是 domain-agent owned query seam，不进入 generic retrieval planner 的 step taxonomy
- `freshness_sensitive` 在 local freshness 不足时只能进入 repo-admitted live source channel 或 fail-close
- planner / executor 都必须显式携带 budget；预算耗尽时 fail-close
- `retrieval-core` 不拥有 top-level capability、surface 或 product scope 决策

## Forward Phases

### Phase 1: Typed Retrieval Plan Contract

目标：

- 固定 `RetrievalPlan / RetrievalStep / StepResult` 的 shared shape、allowed step types、budget truth 与 fail-close semantics

### Phase 2: Planner Executor Multi-step Kernel

目标：

- 让 `rag-agent` 生成 ordered plan，让 `retrieval-core` 执行 multi-step retrieval，并支持 bounded replan

### Phase 3: Freshness Live-assisted And Source-trust Gate

目标：

- 正式接入 generic `freshness_sensitive / live_assisted` branch、source-trust tier 与 admitted live source lookup，并显式排除把 official-web 时效问题重新并回 `rag-agent`

### Phase 4: Query Activity Evidence Selection And Observability

目标：

- 把 plan / step / replan / candidate set / supporting evidence 的 query activity、compact operator observability 与 debug contract 收口，并把 raw trace 与 browser-facing evidence 的边界固定下来

### Phase 5: Eval Runtime Adoption And Planning Closeout

目标：

- 用 deterministic / semantic eval、runtime acceptance 与 residual gap routing 关闭这条 workstream，并把非 retrieval owner 的剩余问题显式转交给 tool/runtime workstream

当前 active focus：

- 把 `tests.specialist.test_rag_retrieval_plan`、`tests.retrieval.test_service`、`tests.specialist.test_rag_specialist`、`tests.evals.test_retrieval_benchmark`、`tests.evals.test_supplemental_adapters` 冻结成 closeout acceptance matrix
- 以 `packages/evals/README.md`、`app-api` internal eval ingress 与 `.planning/PROJECT.md` 中已记录的 handbook/curriculum accept artifact 作为 runtime acceptance carrier
- 显式把 official-web current-information owner、generic live consumer admission 与 non-current live ingress follow-up 路由出本线

## Exclusions

固定不包含：

- campus service / notice / navigation runtime opening
- new collection ingestion / chunking rebuild
- unrestricted web search
- UI redesign 或 panel-first retrieval playground

## Handoff Rule

后续接手时：

1. 先看 `.planning/WORKSTREAMS.md`
2. 再看对应 workstream `STATE.md`
3. 最后回到本文确认 phase 顺序与 fixed rules
