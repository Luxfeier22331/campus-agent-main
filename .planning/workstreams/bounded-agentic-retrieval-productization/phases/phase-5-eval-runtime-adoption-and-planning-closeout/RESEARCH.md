---
doc_type: research
status: active
created: 2026-04-22
updated: 2026-04-22
---

# Phase 5 Research

## Official Guidance

### 1. Roll out agent systems with evals, not intuition

OpenAI 对 agent/product rollout 的建议很明确：把复杂系统拆成可重复的 eval 与 acceptance loop，再决定是否可发布，而不是只凭局部成功案例。

参考：

- https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- https://platform.openai.com/docs/guides/evals

对本仓库的直接含义：

- `Phase 5` 必须给出 bounded retrieval 的稳定 eval matrix
- “已经能跑”不等于“这条 workstream 可以 close”

### 2. Current information should use explicit external systems

OpenAI 的 agent/tool guidance 持续把“需要当前信息、需要外部系统 truth”的查询交给显式 tool/runtime，而不是让静态 retrieval 自行扮演当前事实 owner。

参考：

- https://developers.openai.com/tracks/building-agents

对本 phase 的直接含义：

- official-web 的“今天/最新/最近”仍应保持在 tool/runtime owner
- `Phase 5` 的 closeout 要显式记录哪些 gap 已被判定为外部 owner，而不是继续算作 retrieval 未完成

### 3. Acceptance should compare stable task slices, not only one aggregate score

Evals guidance 的核心不是单一总分，而是围绕明确任务切片做稳定回归。

参考：

- https://platform.openai.com/docs/guides/evals

对本 phase 的直接含义：

- retrieval closeout 至少应按：
  - `current`
  - `historical`
  - `as_of`
  - `compare`
  - `freshness fail-close`
  - `admitted live seam`
  做切片验收

## Local Repo Audit

### 已存在的 acceptance building blocks

- `packages/evals/src/campus_evals/retrieval_live_benchmark.py`
  - retrieval live validation CLI
- `packages/evals/README.md`
  - benchmark / formal acceptance artifact contract
- `packages/evals/src/campus_evals/official_web_live_benchmark.py`
  - official-web 本地 deterministic validation runner
- `packages/evals/src/campus_evals/ragas_adapter.py`
  - supplemental adapter 已存在，但不替代 deterministic gate

### 当前可直接冻结的 acceptance matrix

#### 1. Deterministic retrieval / specialist gate

- `tests.specialist.test_rag_retrieval_plan`
  - 覆盖 `current / compare / freshness_sensitive / live_assisted` 的 plan emission
- `tests.retrieval.test_service`
  - 覆盖 compare dual-step merge、historical version filters、freshness gate、live lookup unavailable fail-close
- `tests.specialist.test_rag_specialist`
  - 覆盖 `historical_grounded_answer`
  - 覆盖 `as_of_grounded_answer`
  - 覆盖 `compare_grounded_answer`
  - 覆盖 `compare_support_incomplete`
  - 覆盖 `freshness_fail_close`

#### 2. Deterministic eval / artifact gate

- `tests.evals.test_retrieval_benchmark`
  - 固定 qrels fixture、manifest preflight、benchmark CLI 与 aggregate metrics
- `tests.evals.test_golden_cases`
  - 固定 semantic outcome、typed `version_query` 与 failure-mode expectations

#### 3. Supplemental and trace-projection gate

- `tests.evals.test_supplemental_adapters`
  - 固定 supporting evidence / retrieved trace 投影
  - 固定 supplemental adapter 只作为 report-only carrier，不改写 deterministic verdict

#### 4. Runtime acceptance carrier

- `packages/evals/README.md`
  - 已冻结 benchmark artifact contract
- `app-api` internal eval ingress
  - 已能为 current-mode acceptance artifact 提供 canonical `request_id / trace_id`
- `.planning/PROJECT.md` 当前已记录：
  - `student_handbook` latest accepted live artifact
  - `curriculum_plan` latest accepted live artifact

固定结论：

- 这条 workstream 的 closeout 可以基于 deterministic regression + repo-tracked live acceptance artifact 完成
- 不需要等待新的 retrieval feature

### 不纳入本线 closeout blocker 的剩余项

- official-web “今天 / 最新 / 最近” current-information owner
  - 继续是 tool/runtime owner，不属于 `rag-agent`
- generic `live_source_lookup` 的具体产品 consumer admission
  - 只有 future workstream 明确 owner 后才重开
- `app-api` live benchmark 对 non-current `version_query` 的 route-level acceptance
  - 当前 `versioned-history-query-foundation` 已完成 deterministic coverage
  - live ingress 的 non-current 支持属于 runtime-specific follow-up，不阻塞本线 closeout
- 新的 query-enabled collection / new retrieval consumer opening
  - 不属于本线 scope

### 仍需 Phase 5 收口的缺口

- 还没有把 bounded retrieval 的最终 acceptance matrix 写成 workstream closeout truth
- 还没有把“generic live seam 已完成”和“具体 product runtime owner 尚未接入”做正式分流
- 还没有形成这条 workstream的 residual gap routing 清单

## Conclusion

`Phase 5` 的本质是 closeout，而不是再写一轮 retrieval feature。

当前 repo facts 已足以支持以下 closeout 方向：

- 用 deterministic regression + existing acceptance artifacts 冻结 bounded retrieval 的最终 acceptance gate
- 明确 official-web current-information owner、generic live consumer admission、non-current live ingress 这些问题都不再算作 retrieval 未完成
- 让这条 workstream 在 `Phase 5` 结束后只保留 reopen rule，而不是继续无限扩 scope
