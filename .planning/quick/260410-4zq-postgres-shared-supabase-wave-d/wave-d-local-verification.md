# Wave D Local Verification

## Scope

本次 local verification 只证明：

- local Postgres + local MinIO 上的 authenticated-notice current scope 可被本地 operator 命令消费
- bounded closeout + chunk preparation 可以不依赖 shared Supabase management DSN 完成

它不证明：

- full historical closeout 已在本地重跑
- release / embedding / Qdrant / alias publish 已通过
- `241275` 这个远端 bounded sample 已被复制进本地 accepted union

## Key Facts

- `supabase_fast_fail_absent=true`
- `current_scope_notice_count=20`
- `requested_241275_available_in_local_union=false`
- `bounded_notice_id=355119`
- `closeout_run_id=local-postgres-wave-d-355119`
- `preparation_run_id=prep-local-postgres-wave-d-355119`

选择 `355119` 的原因：

- 它在当前本地 accepted union 中真实存在
- inventory 标记为 `body_with_text_attachments`
- `expected_attachment_document_count = 1`
- `expected_ocr_candidate_count = 0`
- 能证明 parent/child replay 与 preparation，不把本次 local DB 验证拖回外部 OCR provider 噪声

## Current Scope Validation

执行：

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.validate_internal_notice_chunking \
  --sample-dir .planning/quick/260410-4zq-postgres-shared-supabase-wave-d/current-scope-samples
```

结果：

- `passed = true`
- `selection_mode = current_scope`
- `registry_record_count = 20`
- `selected_record_count = 20`
- `validated_document_count = 20`
- `total_chunks = 210`
- `lane_document_counts.notice_body = 20`
- `chunk_failures = []`
- `read_failures = []`

## Bounded Closeout Plan

执行：

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.plan_authenticated_notice_source_truth_replay \
  --run-id local-postgres-wave-d-355119 \
  --corpus campus_notices \
  --collection internal_notice \
  --notice-id 355119 \
  --shard-size 8 \
  --batch-size 4 \
  --max-concurrency 1 \
  --notice-concurrency 2 \
  --object-store-concurrency 8 \
  --lease-seconds 300
```

计划结果：

- `state = planned`
- `expected_notice_count = 1`
- `expected_document_count = 2`
- `expected_attachment_document_count = 1`
- `expected_ocr_candidate_count = 0`

## Bounded Closeout Worker

执行：

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.run_authenticated_notice_closeout_worker \
  --run-id local-postgres-wave-d-355119 \
  --worker-id local-postgres-01
```

结果：

- `state = verified`
- `completed_shard_count = 1`
- `completed_batch_count = 1`
- `staged_notice_count = 1`
- `staged_raw_asset_count = 1`
- `staged_document_count = 2`
- `verification.ok = true`
- `verification.missing_document_id_count = 0`
- `verification.missing_raw_asset_id_count = 0`
- `verification.expected_attachment_document_count = 1`
- `verification.no_extractable_text_attachment_count = 0`

`show` 复核：

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.show_authenticated_notice_closeout \
  --run-id local-postgres-wave-d-355119
```

结果与 worker summary 一致，run 保持 `verified`。

## Closeout Validation

执行：

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.validate_internal_notice_chunking \
  --closeout-run-id local-postgres-wave-d-355119 \
  --sample-dir .planning/quick/260410-4zq-postgres-shared-supabase-wave-d/closeout-samples-355119
```

结果：

- `passed = true`
- `selection_mode = verified_closeout_run`
- `registry_record_count = 2`
- `validated_document_count = 2`
- `lane_document_counts.notice_body = 1`
- `lane_document_counts.attachment_text_extractable = 1`
- `lane_chunk_counts.notice_body = 10`
- `lane_chunk_counts.attachment_text_extractable = 3`
- `chunk_failures = []`
- `read_failures = []`

## Preparation Validation

执行：

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.prepare_registry_scope_chunks \
  --corpus campus_notices \
  --collection internal_notice \
  --closeout-run-id local-postgres-wave-d-355119 \
  --preparation-run-id prep-local-postgres-wave-d-355119
```

prepare 结果：

- `validation_status = passed`
- `document_count = 2`
- `chunk_count = 13`

再次验证：

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.validate_internal_notice_chunking \
  --preparation-run-id prep-local-postgres-wave-d-355119 \
  --sample-dir .planning/quick/260410-4zq-postgres-shared-supabase-wave-d/prep-samples-355119
```

结果：

- `passed = true`
- `selection_mode = preparation_manifest`
- `closeout_run_id = local-postgres-wave-d-355119`
- `registry_record_count = 2`
- `validated_document_count = 2`
- `lane_document_counts.notice_body = 1`
- `lane_document_counts.attachment_text_extractable = 1`
- `chunk_failures = []`
- `read_failures = []`

## Verdict

- `local_postgres_bootstrap_ok=true`
- `app_api_bootstrap_ok=true`
- `accepted_union_import_ok=true`
- `current_scope_validation_ok=true`
- `bounded_closeout_ok=true`
- `bounded_preparation_ok=true`
- `bounded_release_not_attempted=true`
