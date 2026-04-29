# 1000-04 Summary: retrieved/supporting trace split 与 curriculum live accept closeout

## Outcome

`1000-04` 已完成。repo 现在不再把 raw retrieval candidates、final supporting evidence、clarification/no-retrieval trace 混写成一套 observability；eval、supervisor、app-api runtime storage 与 operator detail 都已经按同一契约显式拆开。

这一步完成了四件事：

- `retrieved_sources` 现在稳定表示 raw retrieval truth，不再镜像 final support，也不再在 clarification / unsupported 分支伪造 retrieval trace
- `supporting_sources` 现在稳定表示最终答案 grounding truth，并保留 canonical curriculum identity 与 physical projection-unit hit 的分离语义
- `program_semester_facts` 在定向 rematerialization 后完成了 fresh publish，`大学英语(四)` 类 follow-up case 已重新命中最新 release
- curriculum live accept 重新执行 3 轮后得到 fresh artifact，19 个 case 在三轮 deterministic gate 中全部通过，supplemental gate 也整体通过

## Key Changes

- `packages/supervisor-core/src/campus_supervisor_core/response.py`
  - supervisor observability 改为优先消费 `diagnostics.retrieved_sources`
  - clarification / fail-close 分支不再 mirror supporting sources 伪装 retrieval
  - citation count 改为只基于 final supporting evidence
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
  - curriculum path 现在保留 raw retrieved trace，即使 `raw == support` 也不会丢失 retrieval truth
  - `课程地图` unsupported / fail-close 分支保持 `retrieval_called=false` 语义，不再漂移成伪 retrieval
- `packages/evals/src/campus_evals/app_api_chat_runtime.py`
  - live trace projection 现已区分 `observability.retrieved_sources` 与 final support
  - canonical doc identity / source-unit metadata 可以从 observed trace 正常回放
- `apps/app-api/src/modules/integration/supervisor.ts`
  - 直接消费 supervisor 的 raw `retrieved_sources`
- `apps/app-api/src/modules/request-observability.ts`
  - runtime/request observability 改为分别落库 retrieved/supporting source lists
  - retrieval attempted but empty trace 时 `retrievedSourceCount=0`，operator 可稳定识别 empty recall
- `apps/app-api/src/modules/operator-query/store.ts`
  - operator detail 返回 `sourceTrace.retrieved` 与 `sourceTrace.supporting` 两套 trace，而不是旧的 mirrored trace
- `tests/supervisor/test_supervisor_core.py`
  - 固化 raw retrieved vs supporting split、clarification no-mirror、course-map fail-close no-retrieval
- `tests/evals/test_curriculum_live_benchmark.py`
  - 固化 canonical-vs-physical source identity 与 no-mirror clarification trace
- `tests/specialist/test_rag_specialist.py`
  - 固化 curriculum program-family / semester follow-up 下 raw retrieval trace 不丢失
- `apps/app-api/test/request-observability.test.ts`
  - 固化 runtime observability split
- `apps/app-api/test/operator-query.route.test.ts`
  - 固化 operator-facing retrieved/supporting trace contract

## Release Actions

Selective rematerialization:

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_curriculum_program_semester_facts \
  --source-document-id "curriculum:法学（民族实验班）本科人才培养方案" \
  --source-document-id "curriculum:历史学（强基计划）本科人才培养方案"
```

Result:

- `source_document_count=2`
- `materialized_document_count=16`
- 法学 / 历史学受影响 semester docs 已按最新 projection 重新生成

Program-semester-facts release refresh:

- preview release: `r20260413_042111`
- published release: `r20260413_042533`
- published physical collection: `program_semester_facts__r20260413_042533`
- published point count: `396`

## Verification

Automated:

```bash
uv run --all-packages python -m unittest tests.specialist.test_rag_specialist tests.evals.test_curriculum_live_benchmark
uv run --all-packages python -m unittest \
  tests.supervisor.test_supervisor_core.SupervisorCoreTest.test_build_supervisor_observability_keeps_raw_retrieved_sources_separate_from_supporting_sources \
  tests.supervisor.test_supervisor_core.SupervisorCoreTest.test_build_supervisor_observability_does_not_mirror_supporting_sources_for_clarification \
  tests.supervisor.test_supervisor_core.SupervisorCoreTest.test_build_supervisor_observability_marks_course_map_fail_close_as_no_retrieval \
  tests.evals.test_runtime_observability \
  tests.evals.test_curriculum_live_benchmark
pnpm --dir apps/app-api exec vitest run test/request-observability.test.ts test/operator-query.route.test.ts test/operator-query.service.test.ts
uv run --all-packages python -m unittest \
  tests.contracts.test_models \
  tests.ingestion.test_curriculum_program_semester_facts_projection \
  tests.ingestion.test_curriculum_program_semester_facts_materialization \
  tests.ingestion.test_materialize_curriculum_program_semester_facts_worker \
  tests.ingestion.test_rebuild_local_data \
  tests.retrieval.test_curriculum_query_resolution \
  tests.retrieval.test_backend_qdrant \
  tests.specialist.test_rag_specialist \
  tests.evals.test_golden_cases \
  tests.evals.test_runtime_observability \
  tests.evals.test_curriculum_live_benchmark
set -a && source .env >/dev/null 2>&1 && set +a && \
env UV_CACHE_DIR=/tmp/uv-cache \
uv run --all-packages python -m campus_evals.curriculum_live_benchmark accept \
  --reruns 3 --verbose \
  --log-jsonl .tmp/evals/curriculum-runtime-events-phase1000.jsonl \
  --output-dir .tmp/evals/curriculum-plan-live-gate-accept-phase1000
```

Result:

- `run-01`: `19/19` passed
- `run-02`: `19/19` passed
- `run-03`: `19/19` passed
- `final-summary.json`: `deterministic_verdict=pass`、`supplemental_verdict=pass`、`final_overall_verdict=pass`
- `repair.selected_target_count=0`

Fresh artifact:

- `.tmp/evals/curriculum-plan-live-gate-accept-phase1000/final-summary.json`
- `.tmp/evals/curriculum-plan-live-gate-accept-phase1000/run/run-01-summary.json`
- `.tmp/evals/curriculum-plan-live-gate-accept-phase1000/run/run-02-summary.json`
- `.tmp/evals/curriculum-plan-live-gate-accept-phase1000/run/run-03-summary.json`

## Remaining Gap

- Phase 1000 已关闭；后续独立 follow-up 只剩旧 curriculum historical artifact pointer 的替换与归档整理，不再是 `1000-04` 的 blocker

## Next

- 回到 roadmap 中仍未关闭的其他 lane；就 curriculum 这条修复线而言，当前已经具备可引用的 fresh pass artifact 与 operator-visible trace contract
