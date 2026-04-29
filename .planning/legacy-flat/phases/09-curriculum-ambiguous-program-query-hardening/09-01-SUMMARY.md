# 09-01 Summary

## Outcome

- `curriculum/program_family_facts` 已作为新的 internal serving surface 落地。
- `民族班有哪些` 与 `基地班有哪些` 现在可通过 canonical program-family path 直接回答，而不是继续依赖 `curriculum_plan` 泛检索。
- `实验班有哪些` 与 `创新班有哪些` 的当前 accepted truth 已在后续 follow-up 中收口为 family-aware completed；09-01 当时的 clarification-first 已不再是 repo-head 行为。
- C 端 program-family 回答不再表述成“官方统一 family 分类”，但可以明确这是按当前已采集培养方案得到的集合回答。

## Main Changes

- `configs/ingestion/curriculum/program_family_facts/`
  - 新增 runtime/chunk/canonical profile
  - 新增 `family-governance.json`，冻结 direct-answer family 与 clarify-first family
- `packages/ingestion-core/src/campus_ingestion_core/curriculum_program_family_facts_projection.py`
  - 新增 program-family projection builder
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
- `packages/ingestion-core/src/campus_ingestion_core/process.py`
  - curriculum rebuild/import 现在可同时刷新 `program_family_facts`
  - Qdrant payload index 增加 `canonical_program_family_id`
- `packages/retrieval-core/src/campus_retrieval_core/models.py`
- `packages/retrieval-core/src/campus_retrieval_core/service.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
  - retrieval request / filter path 新增 `canonical_program_family_ids`
- `packages/contracts/src/campus_contracts/models.py`
  - diagnostics 新增 `resolved_program_family_id` / `resolved_program_family_title`
- `packages/rag-specialist/src/campus_rag_specialist/curriculum_query_planning.py`
- `packages/rag-specialist/src/campus_rag_specialist/query_planning.py`
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
  - 新增 `program_family` query-planning lane
  - direct-answer family 走 `program_family_facts`
  - clarify-first family 在 retrieval 前直接返回澄清
- `tests/ingestion/test_corpus_runtime_profile.py`
- `tests/ingestion/test_rebuild_local_data.py`
- `tests/ingestion/test_curriculum_program_family_facts_projection.py`
- `tests/retrieval/test_service.py`
- `tests/retrieval/test_backend_qdrant.py`
- `tests/contracts/test_models.py`
- `tests/specialist/test_rag_specialist.py`
  - 补齐 `民族班 / 基地班 / 实验班 / 创新班` 的目标行为回归测试

## Verification

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.contracts.test_models tests.retrieval.test_service tests.retrieval.test_backend_qdrant tests.ingestion.test_corpus_runtime_profile tests.ingestion.test_rebuild_local_data tests.ingestion.test_curriculum_program_family_facts_projection tests.specialist.test_rag_specialist`
  - pass
  - `Ran 166 tests in 1.754s`
  - `OK`

## Deferred

- `名称里带“实验班”/“创新班”` 的 name-pattern query 已在后续 follow-up 中形成正式 completed lane。
- family -> single program -> semester 的多轮澄清承接还未补齐。
- eval/golden case 还可以继续把 program-family query authoring 提升到 release-gate truth。
