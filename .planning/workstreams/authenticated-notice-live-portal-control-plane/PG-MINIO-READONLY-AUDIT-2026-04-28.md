---
doc_type: audit
status: frozen
created: 2026-04-28
updated: 2026-04-28
---

# PG / MinIO Readonly Audit - 2026-04-28

## Scope

本次只读审计覆盖当前本机 `.env` 指向的 shared Postgres、MinIO 与本地
authenticated notice export bundles：

- Postgres: `127.0.0.1:5432/campus_agent`
- Source bucket: `campus-rag-source`
- Derived bucket: `campus-rag-derived`
- Local bundle path: `apps/authenticated-notice-collector/runtime/exports/`

本次未执行任何 PG 写入、对象删除、对象复制、rebuild、import、release、
embedding、Qdrant、admission、recovery 或 live collector 操作。

## Quantity Ledger

本地 `notices-bundle-*.json` 当前数量台账：

| Metric | Count |
| --- | ---: |
| Local notice bundle files | 24 |
| Total record rows across local bundles | 10139 |
| Distinct notice ids across all local bundles | 9665 |
| Distinct notice ids in 2026-04-27 backfill bundles | 9664 |
| Distinct notice ids outside 2026-04-27 backfill bundles | 1 |

按 bundle 日期拆分：

| Bundle date | Record rows | Distinct notice ids |
| --- | ---: | ---: |
| `20260425` | 433 | 293 |
| `20260426` | 42 | 37 |
| `20260427` | 9664 | 9664 |

`9664` 与 `9665` 的关系：

- `9664` 是 2026-04-27 七个 backfill bundle 内的 distinct notice ids。
- `9665` 是当前所有本地 `notices-bundle-*.json` 合并去重后的 distinct
  notice ids。
- 差异来自 1 条不在 2026-04-27 backfill 中的旧 bundle notice id:
  `355782`。

2026-04-27 七个 backfill bundle 明细：

| Bundle | Mode | Notice type | Records | Distinct ids |
| --- | --- | --- | ---: | ---: |
| `notices-bundle-20260427T011703.542Z.json` | backfill | `9982` | 22 | 22 |
| `notices-bundle-20260427T011800.046Z.json` | backfill | `9980` | 750 | 750 |
| `notices-bundle-20260427T012722.741Z.json` | backfill | `11` | 2063 | 2063 |
| `notices-bundle-20260427T014415.264Z.json` | backfill | `8` | 877 | 877 |
| `notices-bundle-20260427T020248.597Z.json` | backfill | `6` | 2429 | 2429 |
| `notices-bundle-20260427T032022.388Z.json` | backfill | `32` | 1347 | 1347 |
| `notices-bundle-20260427T040803.251Z.json` | backfill | `5` | 2176 | 2176 |

结论：

- 当前 `9664` / `9665` 只能定义为本地 bundle candidate input 数量。
- 它们不是 PG source-truth inventory 数量。
- 它们不是 canonical notice 数量。
- 它们不是 queryable / serving 数量。

## Relationship To The Previous Six-Thousand Figure

本次只在 `.planning/` 与 `docs/` 的 Markdown 文档中搜索到 282 baseline 与
9664/9665 相关记录，没有找到“六千多条”或 `6000` 作为 authenticated notice
历史恢复数量的 durable 记录。

当前可核实事实如下：

- 已落盘 workstream 文档记录的 previous source-truth baseline 是
  `source_truth_inventory_entries=282`。
- PG collector run ledger 中，2026-04-25 的 widened incremental run 也是
  `notices_collected=282`。
- PG collector run ledger 中，2026-04-27 后续七个 backfill runs 合计
  `notices_collected=9664`。
- 如果只累加 2026-04-27 的前五个 backfill bundle
  (`9982 + 9980 + 11 + 8 + 6`)，中间值是 `6141`；这可以解释一次
  “六千多条”的过程性记忆，但当前 repo 文档与 PG ledger 没有把它冻结为
  source-truth 或 processed truth。

因此，本报告对“六千多条”的处理结论是：

- 它不是当前 PG 事实。
- 它不是当前 source-truth inventory 事实。
- 它最多只能作为未冻结的过程性/中间态描述。
- 后续任何 admission 或分流设计都必须以当前明确可审计的 `9664` /
  `9665` candidate ledger 为输入，而不是以“六千多条”作为事实口径。

## Current PG State

`ingestion_projection` 当前 authenticated notice 相关表状态：

| Table | Count |
| --- | ---: |
| `authenticated_notice_collector_run` | 17 |
| `authenticated_notice_source_truth_inventory` | 0 |
| `authenticated_notice_attachment_fetch_status` | 0 |
| `authenticated_notice_file_release_inventory` | 56 |
| `notice_consumption_projection` | 1 |
| `internal_notice_read_model` | 1 |
| `internal_notice_consumption_admission` | 18 |
| `internal_notice_consumption_admission_event` | 36 |

Projection / read model 当前只剩 `wechat_public_notice`：

- `notice_consumption_projection`: `campus_notices/wechat_public_notice=1`
- `internal_notice_read_model`: `campus_notices/wechat_public_notice=1`

Admission history 当前仍有 historical control-plane rows：

| Source corpus | Source collection | Status | Count |
| --- | --- | --- | ---: |
| `campus_notices` | `internal_notice` | `completed` | 10 |
| `campus_notices` | `wechat_public_notice` | `completed` | 8 |

Registry 状态：

- `ingestion_registry.document_registry_records`: total `573`;
  `campus_notices/internal_notice=0`
- `ingestion_registry.raw_asset_registry_records`: total `63`;
  `file_release_capture=56`; `internal_notice=0`

结论：

- 当前 PG 里没有 `campus_notices/internal_notice` source-truth inventory。
- 当前 PG 里没有 authenticated notice attachment fetch-status coverage。
- 当前 projection / read model 未保留 `internal_notice` queryable rows。
- Admission rows 是历史 control-plane 记录，不等于 source-truth、canonical
  document 或 serving readiness。

## Collector Run Ledger

PG collector run ledger 当前有 17 条 rows。

已核实的关键 runs：

| Run timestamp | Mode | Notice types | Notices | Attachment refs |
| --- | --- | --- | ---: | ---: |
| `20260425T160740792Z` | incremental | `5,6,8,11,32,9980,9982` | 282 | 311 |
| `20260427T011703542Z` | backfill | `9982` | 22 | 22 |
| `20260427T011800046Z` | backfill | `9980` | 750 | 375 |
| `20260427T012722741Z` | backfill | `11` | 2063 | 702 |
| `20260427T014415264Z` | backfill | `8` | 877 | 566 |
| `20260427T020248597Z` | backfill | `6` | 2429 | 4040 |
| `20260427T032022388Z` | backfill | `32` | 1347 | 2710 |
| `20260427T040803251Z` | backfill | `5` | 2176 | 2405 |

结论：

- `282` 是此前 widened incremental source-truth baseline 的文档与 ledger
  共同记录。
- `9664` 是 2026-04-27 七个 backfill collector runs 的 local candidate
  bundle 总量。
- 当前 PG 中没有与 `9664` 对应的 source-truth inventory rows。

## Source Bucket State

MinIO source bucket 当前状态：

| Prefix | Count |
| --- | ---: |
| `authenticated_notice_portal/` | 10176 |
| `authenticated_notice_portal/runs/` | 32 |
| `authenticated_notice_portal/file-release-` | 0 |
| `authenticated_notice_portal/file_release` | 0 |

2026-04-27 backfill bundle attachment object check：

| Metric | Count |
| --- | ---: |
| Expected attachment object key occurrences | 10723 |
| Unique expected attachment object keys | 10077 |
| Missing expected attachment object keys | 6 |

Missing notice attachment object keys are all under
`authenticated_notice_portal/external-visual/mmbiz.qpic.cn/...`.

结论：

- Source bucket 仍保留大量 authenticated notice portal source objects。
- 这些对象不是 source-truth inventory；它们只能作为后续分流/admission 的证据输入。
- 当前缺 6 个 expected external visual objects。

## File Release State

PG file release inventory:

- rows: `56`
- `released_file_storage_provider=object_store`: `56`
- `released_file_ingest_status=uploaded`: `56`
- rows with object key: `56`

Current MinIO state:

- objects under `authenticated_notice_portal/file-release-`: `0`
- objects under `authenticated_notice_portal/file_release*`: `0`
- missing file release object keys from local file-release bundles: `56 / 56`

结论：

- PG file release inventory still claims uploaded object-store files.
- Current source bucket does not contain those file release object keys.
- 这不是 quality acceptance 问题，而是 source object availability gap。

## Derived Bucket State

Current derived bucket checks:

| Prefix | Count |
| --- | ---: |
| `campus_notices/documents/internal_notice/` | 0 |
| `documents/internal_notice/` | 0 |
| `campus_notices/internal_notice/` | 0 |
| `campus_notices/releases/internal_notice/` | 2 |

Only observed derived release files:

- `campus_notices/releases/internal_notice/r20260411_090101/index-release.json`
- `campus_notices/releases/internal_notice/r20260411_090101/validation-summary.json`

结论：

- 当前没有 internal notice canonical document body artifacts。
- 当前没有 evidence 表明 2026-04-27 authenticated notice backfill 被推进到
  derived canonical document path。
- 当前不应进入 chunk / embedding / Qdrant / alias publish。

## Frozen State

本报告冻结以下当前事实：

1. Current PG source-truth inventory count is `0`.
2. Current PG attachment fetch-status count is `0`.
3. Current internal notice projection/read-model serving count is `0`.
4. Current local authenticated notice candidate bundle ledger is `9664` for
   2026-04-27 backfill and `9665` across all local notice bundles.
5. Current source bucket has object evidence, but object evidence is not yet
   admitted source-truth.
6. Current derived bucket has no internal notice canonical document bodies.

## Decision

当前不能直接进入 `verified chunk preparation`、quality acceptance、query serving
或 alias publish。

原因：

- PG source-truth inventory is empty.
- PG fetch-status ledger is empty.
- Local bundle rows have not passed the future分流/admission contract.
- Source objects and local bundles are candidate inputs, not processed truth.
- File release inventory has stale object-store claims: 56 rows point to missing
  source bucket objects.

## Hold Before Further Work

在下一份明确的分流/admission 设计落盘前，不应执行：

1. restore source-truth inventory;
2. rebuild attachment fetch-status;
3. admit all 9664/9665 candidates;
4. generate canonical internal notice documents;
5. write projection/read-model rows;
6. publish chunks, embeddings, Qdrant aliases, or serving surfaces.

后续工作应先定义：

- 哪些 notice type / organization / time range 允许进入 source-truth；
- 哪些 notice 只作为 archive evidence 保留；
- 哪些 attachment/file-release 缺失允许 terminalize；
- admission manifest 如何记录输入 bundle、筛选规则、质量结果与人工复核边界。
