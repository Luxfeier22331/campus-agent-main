---
doc_type: roadmap
status: completed
created: 2026-04-21
updated: 2026-04-22
---

# Roadmap: Bounded Agentic Retrieval Productization

## Overview

这条 workstream 已恢复为 active。
这条 workstream 当前已 completed。

- [x] **Phase 1: Typed Retrieval Plan Contract** — 已冻结 `RetrievalPlan / RetrievalStep / StepResult`、allowed step types、budget truth 与 fail-close semantics，并落成正式 contract / data model 文档。
- [x] **Phase 2: Planner Executor Multi-step Kernel** — 已让 `rag-agent` 生成 ordered plan，让 `retrieval-core` 执行 multi-step retrieval，并把 compare dual-step execution 与 bounded replan fail-close 正式落成代码与测试。
- [x] **Phase 3: Freshness Live-assisted And Source-trust Gate** — 已把 `freshness_sensitive / live_assisted`、source-trust tier 与 admitted live source lookup 收成 generic runtime seam，并显式撤回 `official_web/fresh_news -> rag-agent` 误入路径，恢复 tool/runtime owner 边界。
- [x] **Phase 4: Query Activity Evidence Selection And Observability** — 已把 `retrieval_plan_summary`、compact `step_activities`、raw retrieved trace / supporting evidence 分层与 operator-safe observability carrier 正式收口到 `rag-agent -> app-api` 链路。
- [x] **Phase 5: Eval Runtime Adoption And Planning Closeout** — 已冻结 acceptance matrix、runtime acceptance artifact 与 residual gap routing，并把非 retrieval owner 的剩余问题显式路由出本线。
