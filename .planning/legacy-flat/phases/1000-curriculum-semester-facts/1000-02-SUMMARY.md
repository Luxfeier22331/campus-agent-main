# 1000-02 Summary: Structured curriculum lookup 与 coverage-aware same-doc support

> 2026-04-13 update: 真实课程地图 OCR 抽样显示 `Paddle` 与 `MinerU` 都不能稳定提取拓扑图节点/关系，因此 `课程地图` 已从当前可答范围收回。当前有效结论只保留 `课程设置` / `修读建议` 的 structured lookup；`课程地图` runtime 改为 fail-close。

## Outcome

`1000-02` 的当前有效部分已保留。repo 会把 `课程设置` / `修读建议` 这类问题识别为 `curriculum_lookup`，不再因为问句里有“怎么/如何”就退化成 generic `procedure`；`课程地图` 则因 OCR 证据不足改为 unsupported/fail-close。

这一步完成了三件事：

- curriculum query interpretation 与 `CurriculumQueryPlan` 现在显式携带 structured curriculum lookup intent，并把 `课程地图` 单独标成 unsupported
- retrieval support selection 继续对 `课程设置` / `修读建议` 做 section coverage，但 `课程地图` 不再被当作 answer-bearing support
- specialist runtime 现在会对 `课程地图` 直接 fail-close，而不是沿 structured lookup 路径拼接课程设置表格答案

## Key Changes

- `packages/retrieval-core/src/campus_retrieval_core/curriculum_query_resolution.py`
  - `课程设置`、`修读建议` 现在解析为 `curriculum_lookup`
  - `课程地图` 现在仍识别为 structured curriculum signal，但会被标记为 `course_map` unsupported target
- `packages/rag-specialist/src/campus_rag_specialist/curriculum_query_planning.py`
  - `CurriculumQueryPlan` 新增 `intent_kind`
  - plan 输出现在保留 structured curriculum intent，不再只剩 resolved/pass-through 状态
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
  - structured curriculum lookup 现在允许更宽的 supporting evidence budget
- `packages/retrieval-core/src/campus_retrieval_core/evidence_ranking.py`
  - structured curriculum section-coverage support selection 继续用于 `课程设置` / `修读建议`
  - `课程地图` query 现在直接返回空 supporting set，禁止把课程地图页或邻近表格冒充 grounded answer
- `packages/rag-specialist/src/campus_rag_specialist/agent.py`
  - `_query_mode()` 现在会把 structured curriculum lookup 从 `procedure` 中剥离
  - `_select_answer_support_rows()` 会对 structured curriculum lookup 保留更多互补 rows，而不是沿 generic procedure 提前截断
- `tests/retrieval/test_curriculum_query_resolution.py`
  - 固化 `curriculum_lookup` intent 回归
- `tests/retrieval/test_backend_qdrant.py`
  - 固化 same-doc section coverage 回归，阻止 `0023 + 0014 + 0015` 这类重复 section 组合取代 `0013`
- `tests/specialist/test_rag_specialist.py`
  - 固化 `课程地图怎么安排` fail-close 与“不调用 retriever / 不保留 supporting evidence”回归

## Verification

Automated:

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.test_curriculum_query_resolution \
  tests.retrieval.test_backend_qdrant \
  tests.specialist.test_rag_specialist
```

Result:

- `Ran 234 tests`
- `OK`

## Remaining Gap

- `1000-02` 的历史方案曾把 `课程地图` 当作可答 structured lookup；这个假设已因真实 OCR 证据被撤回
- `1000-02` 当前只保留 `课程设置` / `修读建议` structured intent 与 same-doc coverage；`program_semester_facts` projection 的 row/column position loss 仍待 `1000-03`
- raw retrieval candidates 与 final supporting evidence 的 operator-facing trace split 仍待 `1000-04`

## Next

- 执行 `1000-03`
