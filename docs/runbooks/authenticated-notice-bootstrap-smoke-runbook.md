---
doc_type: runbook
status: active
created: 2026-04-04
updated: 2026-04-04
---

# Authenticated Notice Bootstrap Smoke Runbook

## 文档边界

这份 runbook 只记录 `authenticated_notice_portal` 当前 bootstrap import seam 的最小 smoke 闭环：

- 一份 collector export bundle 如何导入 repo
- smoke 至少检查哪些结果
- smoke 通过后说明了什么
- smoke 还没有说明什么

它不替代：

- 长期边界：`docs/architecture/authenticated-notice-source-architecture.md`
- source-truth contract：`docs/architecture/authenticated-notice-source-truth-contract.md`
- release-managed rebuild / alias publish：`docs/runbooks/index-release-runbook.md`
- 当前项目执行真相：`.planning/PROJECT.md`

## 当前 smoke 形态

当前 canonical smoke 入口是：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap \
  --bundle-path <notices_bundle_json> \
  --manifest-path <export_manifest_json> \
  --site-id <site_id> \
  --source-home-url <source_home_url> \
  --expect-notice-count <count> \
  --summary-output-path .tmp/authenticated-notice-smoke/<timestamp>/summary.json
```

说明：

- 这不是 dry-run；它会按当前 `.env` 指向的 object store、raw asset registry 和 document registry 执行真实导入
- 因此默认只应对 repo-local dev 或受控 smoke 环境执行
- 若同一 bundle 重跑，允许出现 `updated` 或 `skipped`，不要求每次都新建 document
- authenticated notice 的 `attachment-observations.jsonl` / `attachment-refs.jsonl` 允许为空；当前 worker 已把 zero-byte object 写入隔离到一次性 S3 client，避免本地 MinIO 在空对象写入后把后续复用连接拖成长时间 stall
- zero-byte / object-store 排障不得把 scratch object 长期留在 `campus-rag-source/debug/**`；source bucket 根前缀只允许正式 `source_channel`，临时排障证据应落本地 `.tmp/`，若必须写入 bucket 则排障完成后立即清理

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
  tests.ingestion.test_import_authenticated_notice_export_worker \
  tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker
```

## 标准命令

以 `muc_internal_portal` 为例：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap \
  --bundle-path /path/to/notices-bundle-20260403-run-14.json \
  --manifest-path /path/to/export-manifest-20260403-run-14.json \
  --site-id muc_internal_portal \
  --source-home-url https://portal.example.edu/home \
  --expect-notice-count 6454 \
  --summary-output-path .tmp/authenticated-notice-smoke/20260404T120000/full/summary.json
```

如需显式覆盖 restricted baseline：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap \
  --bundle-path <bundle> \
  --manifest-path <manifest> \
  --site-id muc_internal_portal \
  --source-home-url https://portal.example.edu/home \
  --entitlement-group campus_members \
  --visibility-scope campus \
  --summary-output-path .tmp/authenticated-notice-smoke/<timestamp>/summary.json
```

## 推荐 staged replay 顺序

当前 live portal 不可用时，推荐把真实 historical export 回放固定为以下顺序：

1. `1`
2. `50`
3. `240`
4. `6694`

建议做法：

- 对 `run-2` 或其他已知稳定 bundle 先切 `1` 条和 `50` 条样本
- 中间批次通过后，再跑完整 `240` 条
- 只有在 `240` 的 object store / registry / summary 结果稳定时，才考虑 `6694`

当前 worktree 已验证的真实 slice：

- `2` 条：`.tmp/authenticated-notice-smoke/20260404T131900-2-timed/summary.json`
- `10` 条：`.tmp/authenticated-notice-smoke/20260404T131350-10/summary.json`
- `50` 条：`.tmp/authenticated-notice-smoke/20260404T131544-50/summary.json`
- `240` 条：`.tmp/authenticated-notice-smoke/20260404T152745-240/summary.json`

这些证据已经足够说明 bounded replay lane 可用；`6694` 及更大 backfill 仍应作为单独执行决策，而不是被误读为本 phase 已经完成。

以 `run-2` 为例，可以先切片：

```bash
mkdir -p .tmp/authenticated-notice-smoke/20260404T120000
jq '.[0:50]' \
  /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-2.json \
  > .tmp/authenticated-notice-smoke/20260404T120000/notices-bundle-run-2-slice-50.json
```

然后执行：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap \
  --bundle-path .tmp/authenticated-notice-smoke/20260404T120000/notices-bundle-run-2-slice-50.json \
  --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-2.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --expect-notice-count 50 \
  --summary-output-path .tmp/authenticated-notice-smoke/20260404T120000/slice-50-summary.json
```

## 通过标准

smoke 输出 JSON summary，至少要求以下 checks 都为 `passed`：

- `non_empty_notice_count`
- `no_import_errors`
- `document_outcomes_match_notice_count`
- `raw_asset_outcomes_match_notice_count`

如果传了 `--expect-notice-count`，还要求：

- `expected_notice_count`

如果传了 `--summary-output-path`，summary 会同时持久化到指定路径；即使 smoke 失败，也应保留失败 summary 作为排障证据。

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
2. `notice_count`
   - 若为 `0`，优先检查 bundle 内容和 manifest 是否对应同一导出范围
3. `document_outcomes_match_notice_count`
   - 若失败，优先检查 registry 写入统计是否异常中断
4. `raw_asset_outcomes_match_notice_count`
   - 若失败，优先检查 raw asset dedupe / upsert 是否与 bundle 实际 notice 数不一致
5. 长时间卡在 object store 写入
   - authenticated notice 的空 `attachment-observations.jsonl` / `attachment-refs.jsonl` 是合法产物
   - 若某个分支重新出现“空对象写完后下一次 `put_object` 长时间无响应”，优先检查 `packages/ingestion-core/src/campus_ingestion_core/campusrag_ingestion_support.py` 的 `S3ObjectStoreWriter` 是否仍保留 zero-byte one-shot client 保护
   - 若为了复现实验临时写过 bucket-level scratch object，收尾前必须确认 `campus-rag-source` 的 top-level prefix 仍只剩正式 source channel，而不是遗留 `debug/**`

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

## 后续动作

- smoke 通过后，如果目标是继续做 preview rebuild / chunk / index，下一步转到 `docs/runbooks/index-release-runbook.md`
- 如果目标是重开 collector repo migration 或 authenticated control plane，先在 `.planning/PROJECT.md` / `.planning/STATE.md` 里显式创建新的执行面，再以 `docs/architecture/authenticated-notice-source-architecture.md` 作为边界约束
