---
doc_type: reference
status: historical
created: 2026-04-06
updated: 2026-04-12
---

# Retrieval Tail-Latency Snapshot (Historical, 2026-04-06)

## 文档边界

本文只保留 `2026-04-06` retrieval tail-latency 问题的历史诊断快照。

本文回答的是：

- 当时 staging 上的高尾延迟根因是什么
- 当时两波修复分别做了什么
- 为什么这些修复应被理解为 retrieval / data-plane correction，而不是产品拓扑变化

本文不负责：

- 充当当前 `public-chat-web` strict parity 证据
- 充当当前 transport/runtime smoke 文档
- 继续维护逐次测试命令和 worktree-local 执行细节

## Historical Problem Statement

当时暴露出来的历史症状是：

- staging 上部分 curriculum prompt 返回 `Supervisor execution exceeded 15000ms timeout.`
- handbook prompt 虽然可成功，但也存在高尾延迟

历史定位结论固定为：

- 根因在 `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- 主问题不在 `public-chat-web`
- 主问题不在 `app-api` timeout 截断逻辑本身
- 主问题也不在 prompt-model 生成

## Historical Root Cause

当时的热路径放大器有三层：

1. 首轮 hybrid `query_points`
2. `_expand_named_document_support(...)` 触发第二次 `query_points`
3. curriculum semester `course_list` 问句进一步触发 same-document `scroll`

因此历史根因被收口为：

- handbook 稳态慢点主要来自 follow-up support `query_points`
- curriculum 稳态慢点来自 follow-up support `query_points` 叠加 same-document `scroll`
- 对已解析到唯一 `target_document_ids` 的问句，这条 follow-up path 属于不必要的在线放大器

## Historical Wave Decisions

### Wave 1

Wave 1 的历史决策是：

- 不调整产品拓扑
- 不新增公开 serving surface
- 只修在线 retrieval 形状

核心修复是：

- 为 runtime profile 增加 `document_support_strategy`
- 对已解析到唯一 `target_document_ids` 的 handbook / curriculum 问句采用 `targeted_overfetch`
- 让单文档已解析场景收敛为一次 Qdrant 读，而不是二次 `query_points` 甚至额外 `scroll`

### Wave 2

Wave 2 的历史决策是：

- 不继续先堆 `query_points_groups`
- 直接进入 curriculum internal structured surface

核心修复是：

- 新增内部 surface：`curriculum/program_semester_facts`
- 只在 resolved single-doc + single-semester `course_list` 场景路由过去
- `program_semester_facts` 仍是 specialist 内部 surface，不是新的公开 query-serving surface

## Historical Execution Result

当时留下的 repo-tracked 结果是：

- Wave 1 已完成：
  - `CollectionRuntimeProfile` 增加 `document_support_strategy`
  - `student_rules` 与 `curriculum_plan` 已切到 `targeted_overfetch`
  - 已解析单文档请求会跳过 follow-up support `query_points`
- Wave 2 已完成：
  - `ingestion-core` 新增 `curriculum_program_semester_facts_projection.py`
  - `rag-specialist` 对特定 semester `course_list` 问句改路由到 `program_semester_facts`
  - `evals/confidence` 已将其视为 curriculum internal collection

## Historical Significance

这份 snapshot 的历史意义是：

- 首次把高尾延迟定位到 retrieval hot path，而不是 frontend / transport
- 首次明确区分“继续优化向量检索技巧”和“把强结构化问题前移到 data plane”的分界线
- 说明当时 curriculum semester 问句的正确下一步不是继续堆 retrieval patch，而是引入内部 structured surface

## References

- Qdrant payload indexing: <https://qdrant.tech/documentation/concepts/indexing/>
- Qdrant scroll points API: <https://api.qdrant.tech/api-reference/points/scroll-points>
- Qdrant grouped query API: <https://api.qdrant.tech/api-reference/search/query-points-groups>
- Qdrant low-latency search guide: <https://qdrant.tech/documentation/guides/low-latency-search/>
