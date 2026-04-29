---
doc_type: context
status: active
created: 2026-04-22
updated: 2026-04-22
---

# Phase 5 Context

## Why This Phase Exists

在 `Phase 4` 把 query activity / supporting evidence / observability carrier 收口之后，这条 workstream
剩下的就不再是 retrieval kernel 本身，而是：

- 用 eval / runtime acceptance 证明 bounded agentic retrieval 已经达到可交付状态
- 把不属于 retrieval owner 的剩余问题显式转交给对应 tool/runtime workstream
- 关闭这条 planning 线，避免它继续吞并其他产品边界

如果没有这一步，会留下两个直接问题：

- repo 会继续处于“能力大多已存在，但 acceptance truth 没收口”的半完成状态
- official-web / notice / service runtime 这类非 retrieval owner 问题，会再次被错误地塞回 `rag-agent`

## Repo Facts

- `packages/evals` 已有：
  - retrieval benchmark
  - handbook/curriculum live benchmark
  - official-web live benchmark
  - supplemental adapters
- `packages/evals/README.md` 已有正式 benchmark / acceptance artifact 约束
- `app-api` internal eval ingress 与 request correlation 已在 repo 中存在
- `Phase 1-4` 会提供 typed plan、multi-step kernel、generic live seam 与 observability carrier

## Phase Boundary

本 phase 只处理：

- retrieval workstream 的 eval coverage matrix
- runtime acceptance evidence
- residual gap routing
- planning closeout

本 phase 不处理：

- 新的 retrieval feature
- official-web tool/runtime opening
- notice/service/navigation tool 实现
- 新的 product surface admission

## Primary Implementation Constraint

`Phase 5` 必须把这条 workstream 关小，而不是再把别的产品面吞进来。

固定约束：

- 只验证 bounded agentic retrieval 已实现的 owner 范围
- official-web 的时效 tool/runtime owner 不在这条 workstream 内补实现
- 对外部 workstream 的依赖只能显式路由，不能继续用 retrieval patch 代偿

## Phase Output

本 phase 必须产出并验证：

- retrieval workstream 的最终 eval / acceptance matrix
- runtime acceptance artifact 路径
- residual gap routing 清单
- 可关闭的 planning closeout 结论
