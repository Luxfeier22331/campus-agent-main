---
doc_type: reference
status: active
created: 2026-04-06
updated: 2026-04-09
---

# Retrieval Tail-Latency Diagnosis (2026-04-06)

## Scope

本文记录 Wave B staging closure 期间暴露出来的 retrieval tail-latency 根因，以及对应的 retrieval-only 修复策略。

本文不构成 `public-chat-web` chat shell closeout 证据。
当前 `public-chat-web` donor-visible path 的真相，继续以 strict parity 文档为准。

问题表征：

- staging 上部分 curriculum prompt 返回 `Supervisor execution exceeded 15000ms timeout.`
- handbook prompt 已可成功，但也存在高尾延迟

不属于本文的范围：

- `public-chat-web` UI / seam 问题
- `app-api -> supervisor-api` transport contract 变更
- curriculum deterministic eval gate 重新打开

## Root Cause

定位结论：

- 根因在 `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- 慢点不在 `public-chat-web`
- 慢点不在 `app-api` 的 timeout 截断逻辑本身
- 慢点也不是当前 prompt-model 生成，因为当前 runtime 没有启用 prompt model

当前热路径：

1. 首轮 hybrid `query_points`
2. `_expand_named_document_support(...)` 触发第二次 `query_points`
3. curriculum 学期课表问句进一步触发 `_supplement_curriculum_same_doc_semester_sources(...)` 的 same-document `scroll`

分段计时结论：

- `build_evidence_sources()` 与 registry shaping 只占毫秒级，不是主因
- handbook 稳态慢点主要来自第二次 support `query_points`
- curriculum 稳态慢点来自第二次 support `query_points` 叠加 same-document `scroll`
- 对已解析到唯一 `target_document_ids` 的问句，这条 follow-up support path 属于不必要的在线放大器

## Wave 1 Decision

Wave 1 不做新的 serving surface，也不调整产品拓扑。

Wave 1 只做在线 retrieval 形状修复：

- 为 runtime profile 增加 `document_support_strategy`
- 对已解析到唯一 `target_document_ids` 的 handbook / curriculum 问句，采用 `targeted_overfetch`
- `targeted_overfetch` 的语义是：
  - 首轮 Qdrant `query_points` 直接把 `limit` 提升到 `max(top_k, document_support_limit)`
  - 保持现有 metadata filter / ACL / revision track / current-only 约束
  - 跳过 follow-up support query
- 这样可以把“已知目标文档”的在线路径收敛为一次 Qdrant 读，而不是二次 `query_points` 甚至额外 `scroll`

## Why This Is The Right Wave 1

它符合当前 repo 约束：

- 不改变 `public-chat-web -> app-api -> supervisor-api` 拓扑
- 不把 retrieval backend 细节泄漏进 `packages/contracts`
- 不改变公开 serving surface
- 直接利用 specialist 已经下发的 `target_document_ids`，不需要重新发明 planner

它也符合当前官方建议方向：

- 过滤字段继续依赖 Qdrant payload index，而不是在线枚举文档
- 避免把 `scroll` 作为热路径补证手段
- 对已知目标文档，优先用单次 filtered vector query，而不是串联额外网络轮次

## Deferred After Wave 1

Wave 1 之后再继续：

- 如果仍有非 `target_document_ids` 场景的 title-targeting tail latency，再评估 `query_points_groups`
- 如果 curriculum 学期课表类问句仍是高频主路径，则进入长期重构：新增 internal structured surface，避免继续依赖 raw `curriculum_plan` table chunks
- 若需要更强观测，再把 retrieval 子阶段耗时落到 `RagResultDiagnostics`

## Wave 2 Decision

Wave 2 选择进入 curriculum internal structured surface，而不是先做 `query_points_groups`。

原因：

- Wave 1 已经消除了“已解析单文档问句”的 follow-up support query 与 same-document `scroll`
- 当前剩余的高频慢路径集中在 `法学民族班培养方案里大二下有什么课` 这类 semester `course_list` 问句
- 这类问句的真实问题不是“还缺一次更快的向量检索技巧”，而是在线 path 仍在消费 raw `curriculum_plan` table chunks
- 对这种高频、强结构化、已解析到唯一培养方案与唯一学期的场景，最佳下一步是把 answer shape 前移到 ingestion/data plane，而不是继续在 retrieval 热路径上堆 patch

Wave 2 约束：

- 新增内部 surface：`curriculum/program_semester_facts`
- 只在 `curriculum_plan` resolved single-doc + `course_list` + single-semester label 命中时路由过去
- `program_semester_facts` 不是新的公开 query-serving surface；它是 specialist 内部可选检索面
- `curriculum_plan` 仍是用户可见 scope 与 resolved policy document 的 truth anchor

## Execution Status

截至 2026-04-06 当前 worktree，Wave 1 已完成 repo-tracked retrieval 修复：

- `CollectionRuntimeProfile` 已增加 `document_support_strategy`
- `student_handbook` 与 `curriculum_plan` runtime profile 已切到 `targeted_overfetch`
- `backend_qdrant.retrieve()` 首轮查询在已解析到唯一 `target_document_ids` 时改为 `max(top_k, document_support_limit)`
- 同类请求会跳过 follow-up support `query_points`，因此也不会进入 curriculum same-document `scroll`
- 定向验证已通过：
  - `uv run --all-packages python -m pytest tests/ingestion/test_corpus_runtime_profile.py tests/retrieval/test_backend_qdrant.py -q`

截至 2026-04-06 当前 worktree，Wave 2 也已完成 repo-tracked structured-surface correction：

- `ingestion-core` 新增 `curriculum_program_semester_facts_projection.py`
- raw ingestion / local rebuild 会同时生成并重置 `program_semester_facts`
- `rag-specialist` 对 resolved single-doc + semester `course_list` 问句改为路由到 `program_semester_facts`
- `confidence` / `evals` 已把 `program_semester_facts` 记为 curriculum internal collection
- 定向验证已通过：
  - `uv run --all-packages python -m pytest tests/ingestion/test_curriculum_program_semester_facts_projection.py tests/specialist/test_rag_specialist.py -k 'curriculum_program_semester_facts_projection or curriculum_semester_course_query_uses_program_semester_facts_collection or curriculum_follow_up_program_fragment_uses_recent_goal_to_resolve_family_then_semester or curriculum_follow_up_semester_fragment_uses_recent_goal_to_continue_same_program or curriculum_follow_up_program_fragment_prefers_typed_session_slots_over_stale_recent_goal or curriculum_follow_up_semester_fragment_prefers_typed_program_slot_over_stale_recent_goal or curriculum_deictic_query_with_verified_major_prefers_major_scoped_candidate' -q`
  - `uv run --all-packages python -m pytest tests/ingestion/test_corpus_runtime_profile.py tests/ingestion/test_rebuild_local_data.py::RebuildLocalDataTest::test_rebuild_provider_response_replay_resets_curriculum_target_qdrant_collection_only -q`

补充说明：

- 这些修复只关闭 retrieval hot path 问题，不代表 `public-chat-web` donor shell 已完成 strict parity 收口。
- 当前 chat frontend 的 active truth 继续看 `docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md` 与配套 strict parity reference 文档。

## References

- Qdrant payload indexing: <https://qdrant.tech/documentation/concepts/indexing/>
- Qdrant scroll points API: <https://api.qdrant.tech/api-reference/points/scroll-points>
- Qdrant grouped query API: <https://api.qdrant.tech/api-reference/search/query-points-groups>
- Qdrant low-latency search guide: <https://qdrant.tech/documentation/guides/low-latency-search/>
