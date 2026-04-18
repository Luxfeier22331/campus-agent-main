# Phase 1000 Plan Summary

> 2026-04-13 update: `1000-02` 的有效范围已收紧为 `课程设置` / `修读建议` structured lookup；`课程地图` 不再作为可答 surface，改为 fail-close。

Phase `1000-curriculum-semester-facts` is split into 4 executable plans across 3 waves.

## Waves

- Wave 1: `1000-01-PLAN.md`, `1000-03-PLAN.md`
- Wave 2: `1000-02-PLAN.md`
- Wave 3: `1000-04-PLAN.md`

## Plan Objectives

- `1000-01`: Freeze canonical curriculum source identity, physical projection-unit metadata, and raw-vs-supporting runtime/eval contract.
- `1000-02`: Keep `课程设置` / `修读建议` on a structured curriculum path, and fail-close `课程地图` topology queries instead of synthesizing answers from neighboring chunks.
- `1000-03`: Repair `program_semester_facts` projection for merged/sparse tables and add targeted rematerialization for only the affected curriculum documents.
- `1000-04`: Split eval/app-api trace observability, rerun deterministic gates, and produce a fresh curriculum live accept artifact.

## Required Reruns

- Selective rematerialization before closeout:

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_curriculum_program_semester_facts \
  --source-document-id "curriculum:法学（民族实验班）本科人才培养方案" \
  --source-document-id "curriculum:历史学（强基计划）本科人才培养方案"
```

- Final live accept artifact:

```bash
set -a && source .env && set +a && env UV_CACHE_DIR=/tmp/uv-cache \
  uv run --all-packages python -m campus_evals.curriculum_live_benchmark accept \
  --reruns 3 --verbose \
  --log-jsonl .tmp/evals/curriculum-runtime-events-phase1000.jsonl \
  --output-dir .tmp/evals/curriculum-plan-live-gate-accept-phase1000
```
