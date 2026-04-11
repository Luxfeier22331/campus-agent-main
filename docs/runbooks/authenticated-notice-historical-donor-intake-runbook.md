---
doc_type: runbook
status: historical
created: 2026-04-09
updated: 2026-04-12
---

# Authenticated Notice Historical Donor Intake Runbook

## 文档边界

这份 runbook 只描述 `rag-data` historical donor export 进入 repo-owned `authenticated_notice_portal` bootstrap seam 的受控 intake 流程：

- donor bundle 如何先做 family analysis 与 selection freeze
- legacy export 如何规范化成 repo 可消费的 normalized manifest / bundle
- 如何在完全本地的 object-store / registry 替身上做 import smoke
- 哪些结果算“这批 donor intake 可接受”

它不替代：

- `docs/architecture/authenticated-notice-source-architecture.md` 的长期边界
- `docs/architecture/authenticated-notice-source-truth-contract.md` 的 source-truth schema
- `docs/reference/internal-notice-offline-preparation-strategy.md` 的 lane strategy
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的 source-truth replay / preparation operator workflow
- live collector、closeout、chunk、embedding、Qdrant、alias publish 的任何 runbook

## 当前执行原则

historical donor intake 当前固定按以下顺序推进：

1. 先用 repo-tracked notice-family config 对 donor bundle 做只读分析
2. 再冻结一份小批量 selection file
3. 再把 legacy export 规范化成 repo-owned normalized bundle / manifest
4. 再用本地文件系统 object store 和 in-memory registries 做 bootstrap smoke
5. smoke 通过后，只能写成“donor intake seam accepted”，不能跳写成 replay、chunk、release 已通过

固定禁止：

- 直接把 donor bundle 当成 current source truth
- 不经 selection freeze 就整包推进
- 在 donor intake 阶段写 Postgres、Qdrant、embedding provider
- 把 donor intake smoke 当成 current scope replay 或 query-serving 证据

## 适用输入

当前 canonical donor intake 输入固定包括：

- donor bundle：`/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-*.json`
- donor manifest：`/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-*.json`
- legacy notice-type config：`/home/reptilian/code/rag-data/muc-notice-collector/config/notice-types.json`
- repo-tracked selection file：`configs/ingestion/campus_notices/internal_notice/historical-batches/*.json`

selection file 当前最小契约：

- `schema_version`
- `batch_id`
- `selection_basis`
- `selected_notice_ids`
- `notices`

## Step 1: Read-Only Family Analysis

当 donor bundle 或 notice-family 规则有更新时，先重跑只读 family analysis：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.analyze_authenticated_notice_notice_families \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json \
  --output-path .tmp/reports/run14-notice-family-report-tightened.json
```

这一步只回答：

- donor bundle 里各 family 的分布
- 当前 `priority_now` 候选有哪些
- 规则命中了哪些标题 / 正文模式

它不写 registry、object store、Qdrant 或任何 current truth。

## Step 2: Freeze One Selected Batch

从 `priority_now` 候选里冻结一份 repo-tracked selection file。

当前第一批固定使用：

- `configs/ingestion/campus_notices/internal_notice/historical-batches/run14-policy-regulation-core.v1.json`

这批的定位固定是：

- donor source：`run-14`
- notice family：`policy_regulation`
- strategy：`manual_curated_subset_for_first_historical_intake`
- size：`9`

当前第二批固定使用：

- `configs/ingestion/campus_notices/internal_notice/historical-batches/run14-attachment-routing-probe.v1.json`

这批的定位固定是：

- donor source：`run-14`
- notice families：`operational_procedure` + `other`
- strategy：`manual_curated_attachment_routing_probe_for_second_historical_intake`
- size：`4`
- target coverage：`text_extractable` / `manual_review_required` / `reference_only`

当前第三批固定使用：

- `configs/ingestion/campus_notices/internal_notice/historical-batches/run14-policy-regulation-expanded.v1.json`

这批的定位固定是：

- donor source：`run-14`
- notice family：`policy_regulation`
- strategy：`manual_curated_expanded_policy_regulation_sample_with_body_shape_stratification`
- size：`16`
- target coverage：更大范围的规章制度 notice，并显式区分 `body_is_policy_text` / `body_contains_substantial_policy_text` / wrapper notice

在 selection file 没有更新之前，不要擅自扩到剩余候选。

## Step 3: Normalize Legacy Export

把 donor export 先转成 repo-owned normalized manifest / bundle：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.normalize_authenticated_notice_legacy_export \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json \
  --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json \
  --notice-types-path /home/reptilian/code/rag-data/muc-notice-collector/config/notice-types.json \
  --selection-path configs/ingestion/campus_notices/internal_notice/historical-batches/run14-policy-regulation-core.v1.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --output-dir .tmp/historical-intake/run14-policy-regulation-core/normalized \
  --export-scope run14-policy-regulation-core
```

预期输出：

- `.tmp/historical-intake/run14-policy-regulation-core/normalized/notices-bundle.normalized.json`
- `.tmp/historical-intake/run14-policy-regulation-core/normalized/export-manifest.normalized.json`
- `.tmp/historical-intake/run14-policy-regulation-core/normalized/normalization-summary.json`

这一步是本地 JSON 规范化，不写 object store、registry、embedding 或 Qdrant。

当前第二批 attachment-routing probe 的 canonical 参数固定为：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.normalize_authenticated_notice_legacy_export \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json \
  --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json \
  --notice-types-path /home/reptilian/code/rag-data/muc-notice-collector/config/notice-types.json \
  --selection-path configs/ingestion/campus_notices/internal_notice/historical-batches/run14-attachment-routing-probe.v1.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --output-dir .tmp/historical-intake/run14-attachment-routing-probe/normalized \
  --export-scope run14-attachment-routing-probe
```

当前第三批 expanded policy batch 的 canonical 参数固定为：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.normalize_authenticated_notice_legacy_export \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json \
  --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json \
  --notice-types-path /home/reptilian/code/rag-data/muc-notice-collector/config/notice-types.json \
  --selection-path configs/ingestion/campus_notices/internal_notice/historical-batches/run14-policy-regulation-expanded.v1.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --output-dir .tmp/historical-intake/run14-policy-regulation-expanded/normalized \
  --export-scope run14-policy-regulation-expanded
```

## Step 4: Run Local-Only Bootstrap Smoke

对 normalized bundle 做本地 smoke import：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap_local \
  --bundle-path .tmp/historical-intake/run14-policy-regulation-core/normalized/notices-bundle.normalized.json \
  --manifest-path .tmp/historical-intake/run14-policy-regulation-core/normalized/export-manifest.normalized.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --local-output-dir .tmp/historical-intake/run14-policy-regulation-core/local-smoke \
  --summary-output-path .tmp/historical-intake/run14-policy-regulation-core/local-smoke-summary.json \
  --expect-notice-count 9
```

说明：

- 这条命令会读取当前 worktree `.env`，但真正执行时固定注入 local filesystem object store 和 in-memory registries
- 输出只落在 `.tmp/historical-intake/run14-policy-regulation-core/local-smoke/`
- 不写真实 object store
- 不写 Postgres
- 不触发 chunk、embedding、Qdrant 或 alias publish

预期输出：

- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke-summary.json`
- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke/registry/documents.json`
- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke/registry/raw-assets.json`
- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke/registry/source-truth-inventory.json`
- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke/object-store/uploads.json`
- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke/object-store/campus-rag-source/...`
- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke/object-store/campus-rag-derived/...`

当前第二批 attachment-routing probe 的 canonical 参数固定为：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap_local \
  --bundle-path .tmp/historical-intake/run14-attachment-routing-probe/normalized/notices-bundle.normalized.json \
  --manifest-path .tmp/historical-intake/run14-attachment-routing-probe/normalized/export-manifest.normalized.json \
  --attachment-blob-root /home/reptilian/code/rag-data/muc-notice-collector/runtime/blob-store \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --local-output-dir .tmp/historical-intake/run14-attachment-routing-probe/local-smoke \
  --summary-output-path .tmp/historical-intake/run14-attachment-routing-probe/local-smoke-summary.json \
  --expect-notice-count 4
```

当前第三批 expanded policy batch 的 canonical 参数固定为：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap_local \
  --bundle-path .tmp/historical-intake/run14-policy-regulation-expanded/normalized/notices-bundle.normalized.json \
  --manifest-path .tmp/historical-intake/run14-policy-regulation-expanded/normalized/export-manifest.normalized.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --local-output-dir .tmp/historical-intake/run14-policy-regulation-expanded/local-smoke \
  --summary-output-path .tmp/historical-intake/run14-policy-regulation-expanded/local-smoke-summary.json \
  --expect-notice-count 16
```

补充约束：

- 当 normalized manifest 标记 `attachment_storage_mode = blob_store_reference` 且 batch 内存在 object-backed attachment 时，local smoke/import 必须显式传入 `--attachment-blob-root`
- 不允许再依赖“attachment bytes 缺失时先跑通 importer，routing truth 另看 donor 分析”的旧例外
- 2026-04-11 起 repo import seam 已把这条前置条件收成代码真相：缺少 `attachment_blob_root` 会在 import preflight 直接报错，不再允许进入产物落盘阶段

## Acceptance Gate

一次 donor intake 通过，至少要求：

- `normalization-summary.json`
  - `normalized_notice_count` 与 selection file 一致
  - `missing_notice_ids = []`
- `local-smoke-summary.json`
  - `ok = true`
  - `non_empty_notice_count = passed`
  - `no_import_errors = passed`
  - `document_outcomes_match_notice_count = passed`
  - `raw_asset_outcomes_match_notice_count = passed`
  - `expected_notice_count = passed`
- `source-truth-inventory.json`
  - notice ids 与 selection file 一致
  - `document_id`、`raw_asset_id`、`raw_version_id` 都可闭合
  - attachment 计数与这批样本预期一致

对当前第一批 `run14-policy-regulation-core-v1`，额外预期固定为：

- `notice_count = 9`
- `notice_risk_label = body_only` 对 `9/9` 成立
- `attachment_ref_total = 0`
- `attachment_document_total = 0`

对当前第二批 `run14-attachment-routing-probe-v1`，额外预期固定为：

- `notice_count = 4`
- `attachment_ref_total = 7`
- donor byte-aware routing analysis 与 local smoke inventory：
  - `attachment_document_total = 1`
  - `text_extractable_count = 1`
  - `ocr_required_count = 0`
  - `reference_only_count = 1`
  - `manual_review_required_count = 5`
  - `body_with_text_attachments = 1`
  - `body_with_reference_only_attachments = 1`
  - `body_with_spatial_attachments = 2`
  - local smoke command 必须显式带 `--attachment-blob-root /home/reptilian/code/rag-data/muc-notice-collector/runtime/blob-store`
  - `.tmp/historical-intake/run14-attachment-routing-probe/local-smoke/registry/source-truth-inventory.json` 现在就是 repo 当前 attachment routing truth

对当前第三批 `run14-policy-regulation-expanded-v1`，额外预期固定为：

- `notice_count = 16`
- `attachment_ref_total = 0`
- `attachment_document_total = 0`
- `notice_risk_label.body_only = 16`
- `body_is_policy_text = 3`
- `body_contains_substantial_policy_text = 8`
- `wrapper_notice_likely_external_canonical_text = 4`
- `wrapper_or_summary_notice = 1`

## 结果解释

这条 donor intake 通过，说明：

- legacy donor export 已能被稳定吸收到 repo-owned normalized import seam
- `authenticated_notice_portal` 的 source-truth metadata 语义已对齐 repo 当前 contract
- 这批 notice 在不接入真实 infra 的情况下，可以稳定产出 source-truth artifacts、raw asset records 和 restricted parent documents

它不说明：

- live collector 已恢复
- attachment typed routing 已经被这批样本验证
- OCR lane、chunk quality、release gate 已通过
- `campus_notices/internal_notice` 已可开放 query-serving

补充解释：

- 第一批 `run14-policy-regulation-core-v1` 只证明 parent-only notice 的 donor normalization/import seam 稳定
- 第三批 `run14-policy-regulation-expanded-v1` 把 `policy_regulation` 扩到更大范围，但 source shape 仍然混合，不能把全部 notice 直接视为“正文即 canonical 制度文本”
- 第二批 `run14-attachment-routing-probe-v1` 现在证明 donor intake seam 在显式补齐 attachment blob 后，local smoke inventory 已能稳定覆盖 `text_extractable` / `manual_review_required` / `reference_only`
- 第二批 donor byte-aware routing analysis 仍保留为交叉校验，但不再高于 local smoke inventory truth
- 第二批如果省略 `--attachment-blob-root`，现在应视为 execution error，而不是 historical tolerated mode
- 第三批如需优先做“制度正文处理”，应先从 `body_is_policy_text` 和 `body_contains_substantial_policy_text` 子集进入下一步
- 第二批与第三批仍不代表 OCR 执行、child document materialization、chunk preparation 或 release gate 已通过

## 建议留存的证据

每次 donor intake 至少保留：

- selection file path
- normalization summary
- local smoke summary
- source-truth inventory
- document registry snapshot
- raw asset registry snapshot
- 一份 repo-tracked acceptance note

当前第一批 repo-tracked 证据固定见：

- `docs/reference/authenticated-notice-historical-donor-intake-evidence.md`
