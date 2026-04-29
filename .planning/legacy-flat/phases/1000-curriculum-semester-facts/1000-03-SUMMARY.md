# 1000-03 Summary: Position-preserving semester facts projection 与 selective rematerialization

## Outcome

`1000-03` 已完成。repo 现在不再让 `program_semester_facts` projection 依赖 projection-local 的弱化表格解析；semester facts 物化已经改为复用共享 table normalization helper，并保留空前导单元格、稀疏行与 merged-cell 的列占位语义。

这一步完成了三件事：

- `curriculum_program_semester_facts_projection` 现在优先消费 `table_cells` / HTML table 的 position-preserving grid，而不是把空单元格过滤掉
- `大学英语(四)` 这类依赖空前导列占位的课程行现在可以稳定落入 `program_semester_facts`
- worker / local-rebuild 已具备按 `--source-document-id` 做局部 rematerialization 的执行路径，不再默认走全量 canonical scope refresh

## Key Changes

- `packages/ingestion-core/src/campus_ingestion_core/source_truth_common.py`
  - 新增共享 position-preserving table normalization helper
  - 支持从 `table_cells` / HTML table / pipe-delimited fallback 三种输入重建 width-stable grid
- `packages/ingestion-core/src/campus_ingestion_core/curriculum_program_semester_facts_projection.py`
  - projection 现在复用共享 helper
  - 支持直接从 structured row 的 `table_cells` 重建 semester table
  - canonical scope materialization 现在支持 `source_document_ids` 过滤
  - selective rematerialization 时不再对整个 `program_semester_facts` scope 做 full replace
- `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
  - 新增 targeted `program_semester_facts` rematerialization wrapper
- `apps/ingestion-worker/src/campus_ingestion_worker/materialize_curriculum_program_semester_facts.py`
  - CLI 现在接受可重复的 `--source-document-id`
  - worker 改为走 local-rebuild wrapper，而不是无参全量 canonical scope materialization
- `tests/ingestion/test_curriculum_program_semester_facts_projection.py`
  - 固化空前导 HTML cell 与 `table_cells` sparse grid 回归
- `tests/ingestion/test_curriculum_program_semester_facts_materialization.py`
  - 固化 canonical scope materialization 的 source-document filter 回归
- `tests/ingestion/test_materialize_curriculum_program_semester_facts_worker.py`
  - 固化 worker CLI repeated `--source-document-id` contract
- `tests/ingestion/test_rebuild_local_data.py`
  - 固化 local-rebuild targeted rematerialization pass-through contract

## Verification

Automated:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_curriculum_program_semester_facts_projection \
  tests.ingestion.test_curriculum_program_semester_facts_materialization \
  tests.ingestion.test_materialize_curriculum_program_semester_facts_worker \
  tests.ingestion.test_rebuild_local_data
```

Result:

- `Ran 39 tests`
- `OK`

Not run:

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_curriculum_program_semester_facts \
  --source-document-id "curriculum:法学（民族实验班）本科人才培养方案" \
  --source-document-id "curriculum:历史学（强基计划）本科人才培养方案"
```

Reason:

- 这是会改写本地 object store / registry 的 side-effectful rematerialization 命令；本步只实现并验证执行路径，不在当前 turn 自动改写本地派生数据。

## Remaining Gap

- `1000-03` 已修完 projection data-loss root cause 和 selective rematerialization path；raw retrieval candidates 与 final supporting evidence 的 observability split、deterministic rerun 与 fresh accept artifact 仍待 `1000-04`

## Next

- 执行 `1000-04`

