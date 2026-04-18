# 09-02 Summary

## Outcome

- 中央民族大学当前高频 curriculum alias 已先落成 phase 文档和 repo-tracked inventory。
- `course_facts` 现在有独立的 alias governance config；课程 / 课程 family alias 不再继续硬编码在 planner 里。
- curriculum golden gate 现在正式接受 `curriculum_plan -> course_facts/program_family_facts` 的内部切换。
- qrels preflight 现在会对 program-family membership alias 的单 doc canonical truth fast-fail。
- curriculum smoke / release / regression case 已把高频 alias 问句纳入固定 gate。

## Main Changes

- `.planning/phases/09-curriculum-ambiguous-program-query-hardening/09-02-PLAN.md`
  - 新增 phase 09-02 执行计划
- `.planning/phases/09-curriculum-ambiguous-program-query-hardening/09-02-ALIAS-INVENTORY.md`
  - 冻结当前 MUC 高频 alias inventory 与默认动作
- `configs/ingestion/curriculum/course_facts/alias-governance.json`
  - 新增课程 / 课程 family alias 配置
- `packages/rag-specialist/src/campus_rag_specialist/curriculum_query_planning.py`
  - 课程 alias 现在从 repo config 读取，不再写死在 `_course_entities()` / `_course_family_entities()` 中
- `packages/evals/src/campus_evals/expectations.py`
  - curriculum golden gate 现在允许 `course_facts` / `program_family_facts` 作为 `curriculum_plan` 请求下的内部 evidence surface
- `packages/evals/src/campus_evals/benchmark.py`
  - qrels preflight 现在从 config 读取 course-family alias，并新增对 program-family membership alias 的 fast-fail
- `packages/evals/src/campus_evals/scenarios.py`
  - smoke / release / regression 新增 program-family 与 `思修课` alias case
- `packages/evals/README.md`
  - 补充 internal facts surface 与 qrels fast-fail 约束
- `tests/evals/test_golden_cases.py`
- `tests/evals/test_retrieval_benchmark.py`
  - 新增 alias gate / qrels guard 回归测试

## Added Gate Coverage

- release gate:
  - `思修课包括哪些课`
  - `民族班有哪些`
  - `实验班有哪些`
- smoke:
  - `民族班有哪些`
  - `实验班有哪些`
- regression locked:
  - `思修课包括哪些课`
  - `基地班有哪些`
  - `实验班有哪些`
  - `创新班有哪些`

## Verification

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_retrieval_benchmark tests.specialist.test_rag_specialist tests.evals.test_curriculum_live_benchmark`
  - pass
  - `Ran 125 tests in 0.076s`
  - `OK`

## Deferred

- 这轮 inventory 仍然只覆盖当前高频、已讨论过的 alias，不是中央民族大学全量术语库。
- `创新实验班`、`民族实验班`、`强基计划`、`第二学士学位` 与 `名称里带“实验班/创新班”` 的 completed lane 已在后续 follow-up 中建立。
- 如果后续要把更多 alias 提升到 release gate，下一步应继续扩 inventory，再决定是 `hard_canonical`、`resolved_family`、`clarify_first` 还是 `soft_hint_only`。
