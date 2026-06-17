---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: historical
created: 2026-04-04
updated: 2026-06-12
---
# Authenticated Notice Bootstrap Smoke Runbook

## 文档边界

这份 runbook 只记录 `authenticated_notice_portal` bootstrap import seam 的最小 smoke 闭环：

- 一份 collector export bundle 如何导入 repo
- smoke 至少检查哪些结果
- smoke 通过后说明了什么
- smoke 还没有说明什么

它不替代：

- 长期边界：`docs/architecture/domains/authenticated-notice/architecture.md`
- source-truth
  contract：`docs/data/authenticated-notice-source-truth-schema.md`
- release-managed rebuild / alias
  publish：`docs/runbooks/index-release-runbook.md`
- 当前项目执行真相：`.planning/PROJECT.md`

## Canonical Smoke 入口

旧 `smoke_authenticated_notice_bootstrap*` Python wrapper 已删除。canonical smoke
入口直接使用 authenticated notice importer，并显式选择写入模式：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.import_authenticated_notice_export
  --bundle-path <notices_bundle_json> \
  --allow-local-fixture-import \
  --manifest-path <export_manifest_json> \
  --site-id <site_id> \
  --source-home-url <source_home_url> \
  --mode admit-and-materialize \
  --source-truth-only
```

说明：

- 这不是 dry-run；它会按当前 `.env` 指向的 object store、raw asset registry 和 document
  registry 执行真实导入
- 因此默认只应对 repo-local dev 或受控 smoke 环境执行
- `--allow-local-fixture-import` 是本地 bundle 文件输入的显式 guard；生产/受控 object-store
  输入应改用 `--source-bucket` / `--bundle-object-key` / `--manifest-object-key`
- bootstrap smoke 默认停在 source-truth / holding materialization；继续消费 projection、
  read model、chunk preparation 或 release，应转入 source-truth replay / async staged
  closeout runbook
- 若同一 bundle 重跑，允许出现 `updated` 或 `skipped`，不要求每次都新建 document
- authenticated notice 的 `attachment-observations.jsonl` /
  `attachment-refs.jsonl` 允许为空；当前 worker 已把 zero-byte object 写入隔离到一次性 S3
  client，避免本地 MinIO 在空对象写入后把后续复用连接拖成长时间 stall
- zero-byte / object-store 排障不得把 scratch object 长期留在
  `campus-rag-source/debug/**`；source bucket 根前缀只允许正式
  `source_channel`，临时排障证据应落本地 `.tmp/`，若必须写入 bucket 则排障完成后立即清理
- 若需要做 object-store hygiene 复核，source bucket 只允许正式 `source_channel` 根前缀，derived
  bucket 只允许 `{corpus}/{documents|releases|backups|operations}/...`

## 前置条件

- root `.env` 已配置：
  - object store
  - raw asset registry
  - document registry
- 对应 env 指向的是 repo-local 或受控 smoke 环境，而不是生产环境
- 已具备一份 collector export：
  - `notices-bundle-*.json`
  - `export-manifest-*.json`
- `site_id` 与 `source_home_url` 已确认

建议先跑最小回归：

```bash
uv run --package campus-ingestion-worker python -m unittest \
  tests.ingestion.test_collection_config \
  tests.ingestion.test_corpus_runtime_profile \
  tests.ingestion.test_authenticated_notice_import \
  tests.ingestion.test_import_authenticated_notice_export_worker
```

## 标准命令

以 `muc_internal_portal` 为例：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.import_authenticated_notice_export
  --bundle-path /path/to/notices-bundle-20260403-run-14.json \
  --allow-local-fixture-import \
  --manifest-path /path/to/export-manifest-20260403-run-14.json \
  --site-id muc_internal_portal \
  --source-home-url https://portal.example.edu/home \
  --mode admit-and-materialize \
  --source-truth-only
```

如需显式覆盖 restricted baseline：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.import_authenticated_notice_export
  --bundle-path <bundle> \
  --allow-local-fixture-import \
  --manifest-path <manifest> \
  --site-id muc_internal_portal \
  --source-home-url https://portal.example.edu/home \
  --entitlement-group campus_members \
  --visibility-scope campus \
  --mode admit-and-materialize \
  --source-truth-only
```

## 推荐 staged replay 顺序

当 live portal 不可用、需要回放 historical export 时，推荐把样本按以下顺序逐步放大：

1. `1`
1. `50`
1. `240`
1. `6694`

建议做法：

- 对 `run-2` 或其他已知稳定 bundle 先切 `1` 条和 `50` 条样本
- 中间批次通过后，再跑完整 `240` 条
- 只有在 `240` 的 object store / registry / summary 结果稳定时，才考虑 `6694`

说明：

- active runbook 只保留样本放大顺序与判定规则
- 某一轮 `2/10/50/240` sample 的 summary 路径属于历史 smoke evidence，不再作为默认入口长期维护
- `6694` 及更大 backfill 仍应作为单独执行决策，而不是被误读为 bootstrap smoke 的默认目标

## Historical Browser URL Backfill

旧 authenticated-notice browser URL bundle audit / backfill Python CLI 已删除。
当前 canonical source-truth artifact materialization 会在生成 notice manifest 时派生
`portal_print_url`、`notice_browser_url` 与 `notice_browser_url_source`。

如果后续确实需要重写 historical bundle，应作为 ingestion-control admission 的
一次性 recovery task 重建，并在任务 closeout 中显式记录输入 bundle、派生策略版本、
missing notice type 计数与输出 bundle object refs；不要恢复旧 Python CLI。

需要重新访问 live portal 做完整历史补采时，使用 collector backfill：

```bash
AUTHENTICATED_NOTICE_COLLECTION_MODE=backfill \
AUTHENTICATED_NOTICE_HISTORICAL_BACKFILL_MAX_PAGES_PER_TYPE=500 \
pnpm --dir apps/authenticated-notice-collector bootstrap:export
```

`AUTHENTICATED_NOTICE_HISTORICAL_BACKFILL_MAX_PAGES_PER_TYPE` 是每个 enabled
notice type 的硬上限；collector 会在 portal 返回的最后页提前停止。全量导入前仍应先按
`1 -> 50 -> 240 -> full` 做 smoke 放大。

以 `run-2` 为例，可以先切片：

```bash
EXPORT_BUNDLE=/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-2.json
mkdir -p .tmp/authenticated-notice-smoke/20260404T120000
jq '.[0:50]' \
  "$EXPORT_BUNDLE" \
  > .tmp/authenticated-notice-smoke/20260404T120000/ \
    notices-bundle-run-2-slice-50.json
```

然后执行：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.import_authenticated_notice_export
  --bundle-path \
    .tmp/authenticated-notice-smoke/20260404T120000/notices-bundle-run-2-slice-50.json
  --allow-local-fixture-import \
  --manifest-path \
    /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-2.json
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --mode admit-and-materialize \
  --source-truth-only
```

## Selected Attachment Fetch Admission

notice attachment bytes 默认不再因为 collector 配置了对象存储而自动下载。operator 若要让
selected notice 的某些 attachment 进入 quarantine、source-truth required 或 admitted-owner
byte path，必须先由 ingestion/operator 侧根据 source-truth retention decision 生成 fetch request
manifest，再把该 manifest 交给 collector。

生成 collector fetch request manifest：

```bash
FETCH_MANIFEST_MODULE=\
campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest
uv run --all-packages python -m "$FETCH_MANIFEST_MODULE" \
  --corpus campus_notices \
  --collection internal_notice \
  --notice-id 355867 \
  --output-path \
    .tmp/authenticated-notice-fetch-admission/355867/fetch-request-manifest.json
```

执行 selected collector export：

```bash
AUTHENTICATED_NOTICE_COLLECTION_MODE=selected \
AUTHENTICATED_NOTICE_SELECTED_NOTICES=355867:5 \
AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH=\
.tmp/authenticated-notice-fetch-admission/355867/fetch-request-manifest.json \
pnpm --dir apps/authenticated-notice-collector bootstrap:export
```

固定判定：

- `metadata_only` attachment refs 不进入 fetch request manifest。
- `fetch_to_quarantine` 可以下载并上传 bytes，但不计入 required source object。
- `fetch_required_for_source_truth` 与 `fetch_required_for_admitted_owner` 必须具备可验证
  bytes；collector run ledger 缺失这些 required/admitted owner bytes 时应 fail closed。
- 如果 operator 显式传入 `--notice-id` 但 source-truth inventory 缺少该 notice，manifest
  builder 必须失败，不能静默产出空 admission。

## 通过标准

importer 输出 JSON 至少要求：

- `write_enabled = true`
- `mode = admit_and_materialize`
- `source_truth_only = true`
- `notice_count` 等于本轮输入 bundle 的预期数量
- `errors = []`
- `raw_uploaded_count + raw_reused_count = notice_count`
- `created_document_ids + updated_document_ids + skipped_document_ids` 数量与
  `notice_count` 一致

需要继续验证 consumption projection、read model、chunk preparation 或 replay scope 时，不在
bootstrap smoke wrapper 内追加检查，转入
`docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`。

## 结果解释

这组 smoke 通过，说明：

- bundle shape 仍能被当前 importer 正确消费
- `authenticated_notice_portal` source artifacts 能成功写入 object store
- raw asset registry / document registry 能接收当前 restricted notice projection
- `campus_notices/internal_notice` 当前 config 与 importer 没有明显契约漂移

这组 smoke 不说明：

- repo-native collector app 已完成迁入
- chunk / embedding / index release 已完成
- `internal_notice` 已可开放 query-serving
- restricted leakage guards 已完成全矩阵验证

## 失败时先看什么

1. `errors`
   - importer 解析失败、registry 写入失败或 object store 写入失败会直接反映在这里
1. `notice_count`
   - 若为 `0`，优先检查 bundle 内容和 manifest 是否对应同一导出范围
1. document outcome count
   - 若 `created_document_ids + updated_document_ids + skipped_document_ids` 与
     `notice_count` 不一致，优先检查 registry 写入统计是否异常中断
1. raw asset outcome count
   - 若 `raw_uploaded_count + raw_reused_count` 与 `notice_count` 不一致，优先检查 raw
     asset dedupe / upsert 是否与 bundle 实际 notice 数不一致
1. 长时间卡在 object store 写入
   - authenticated notice 的空 `attachment-observations.jsonl` /
     `attachment-refs.jsonl` 是合法产物
   - 若某个分支重新出现“空对象写完后下一次 `put_object` 长时间无响应”，优先检查 `packages/ingestion-core/src/
     campus_ingestion_core/campusrag_ingestion_support.py` 的
     `S3ObjectStoreWriter` 是否仍保留 zero-byte one-shot client 保护
   - 若为了复现实验临时写过 bucket-level scratch object，收尾前必须确认 `campus-rag-source` 的
     top-level prefix 仍只剩正式 source channel，而不是遗留 `debug/**`
   - 同时确认 `campus-rag-derived` 没有长出 `documents|releases|backups|operations`
     之外的第二层 family

## 建议证据

每轮 smoke 建议至少保留：

- 执行日期
- bundle / manifest 文件名
- `site_id`
- smoke summary JSON
- 如果使用 `--summary-output-path`，直接保留该 `summary.json`
- object store bucket / prefix 摘要
- created / updated / skipped document 数量摘要

建议存放位置：

- `.tmp/authenticated-notice-smoke/<timestamp>/`

说明：

- 每轮只保留本轮 smoke 的 summary 和必要摘录
- 历史 smoke sample 的具体 `.tmp` 路径不回写到 active runbook；如需长期保留，应单独收成 historical
  evidence

## 后续动作

- smoke 通过后，如果目标是继续做 preview rebuild / chunk / index，下一步转到
  `docs/runbooks/index-release-runbook.md`
- 如果目标是重开 collector repo migration 或 authenticated control plane，先在
  `.planning/PROJECT.md` / `.planning/WORKSTREAMS.md` 里显式创建新的执行面，再以
  `docs/architecture/domains/authenticated-notice/architecture.md` 作为边界约束
