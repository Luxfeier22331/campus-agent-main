---
doc_type: reference
status: active
created: 2026-04-14
updated: 2026-04-22
---

# Authenticated Notice File-Release Owner-Recovery Readiness Contract

## 文档边界

本文冻结 `regulations/institutional_regulations` 当前对 `authenticated_notice_portal/file_release` 的下游 readiness contract。

它回答的是：

- downstream 如何读取 `file-releases-bundle-*.json` / `file-releases-manifest-*.json`，或本地 PG `campus_notices/file_release_capture` ledger
- `owner_title_hint` 应如何与 `file_release` 记录做 bounded matching
- matching 结果如何分成 `ready / missing_capture / missing_source_bytes / ambiguous_match`

它不负责：

- live portal 认证与采集
- `file_release` 正文 OCR / 解析 / chunk / index
- 直接改写 `internal_notice -> institutional_regulations` 当前 promotion/materialization 行为

对应文档：

- collector export contract：`docs/reference/authenticated-notice-file-release-export-contract.md`
- auth-window runbook：`docs/runbooks/authenticated-notice-file-release-auth-window-runbook.md`
- regulation acceptance：`docs/reference/institutional-regulations-promotion-quality-acceptance.md`

## 当前定位

repo 当前已经具备一条 bounded downstream consumer：

- `load_authenticated_notice_file_release_export`
- `resolve_file_release_owner_recovery_readiness`
- `resolve_file_release_owner_recovery_readiness_from_inventory_entries`
- `resolve_file_release_owner_recovery_readiness_from_inventory_store`

它的职责只有两步：

1. 读取 `file_release` export bundle / manifest
2. 回答某个 `owner_title_hint` 当前是否已经具备可恢复正文的 source locator

当前它还不会：

- 恢复 regulation owner body
- 调用 OCR/provider
- 把 recovered owner body 自动推进到 promotion/materialization

## 当前落地形态

当前 repo 已把 `authenticated_notice_portal/file_release` 的 repo-tracked export materialize 成一条 capture-only local PG ledger：

- `corpus/collection = campus_notices/file_release_capture`
- `ingestion_projection.authenticated_notice_file_release_inventory`
- 同 scope 的 `ingestion_registry.raw_asset_registry_records`

固定限制：

- 不写 `document_registry_records`
- 不做 OCR / parse / chunk / index / release
- 这条 local PG materialization 已作为一次性 closeout 完成，不再保留独立 recurring backfill 需求

## 分层规则

固定规则：

- `notice`、`file_release`、`regulation` 仍是三层不同资源
- `file_release` 可以作为 regulation owner body 的来源层，但不能伪装成 `notice`
- readiness 只证明“这份 owner body 现在有没有可恢复 source”，不等于“这份 regulation 已可导入”

repo 当前仍严格保持：

- `source_notice_document_id` 代表 wrapper notice 来源
- `semantic_owner_document_id` 未来代表真正的 owner body 文档
- `file_release` 只能补 owner body，不得覆盖 `internal_notice` 的 source-truth

## 输入契约

下游输入固定允许两种等价形态：

1. 两份 collector artifact：
   - `file-releases-bundle-<timestamp>.json`
   - `file-releases-manifest-<timestamp>.json`
2. 本地 PG `campus_notices/file_release_capture` inventory rows
   - 从 `ingestion_projection.authenticated_notice_file_release_inventory` 读取
   - 如需 recoverable source locator，则同 scope raw-asset truth 仍以 `ingestion_registry.raw_asset_registry_records` 为准

当前代码入口：

- `campus_ingestion_core.authenticated_notice_file_release_owner_recovery.load_authenticated_notice_file_release_export`
- `campus_ingestion_core.authenticated_notice_file_release_owner_recovery.resolve_file_release_owner_recovery_readiness`
- `campus_ingestion_core.authenticated_notice_file_release_owner_recovery.resolve_file_release_owner_recovery_readiness_from_inventory_entries`
- `campus_ingestion_core.authenticated_notice_file_release_owner_recovery.resolve_file_release_owner_recovery_readiness_from_inventory_store`
- `campus_ingestion_worker.check_authenticated_notice_file_release_readiness`

## Matching Contract

当前 matching 只允许消费以下 title 信号：

- `owner_title_hint`
- `file_release.filename`
- `file_release.upfilename`
- `released_file.original_filename`

当前 normalize 规则固定为：

- `NFKC`
- 去掉文件扩展名
- 去掉空白与常见中英文标点
- 小写化后再比较

当前优先级固定为：

1. `exact_normalized_title`
2. `owner_hint_contained_in_candidate`
3. `candidate_contained_in_owner_hint`

固定 fail-close 规则：

- 只接受单条最高分 match
- 多条最高分并列时，一律返回 `ambiguous_match`
- 不因为“看起来像同一份制度”而静默二选一

## Readiness Outcomes

### `ready`

表示：

- 已找到唯一最高分 `file_release` match
- 且这条记录已经携带可恢复 source locator

当前允许的 locator：

- `released_file.storage_provider=object_store` 且 `bucket/object_key/sha256` 完整
- 或 `released_file.storage_provider=local` 且 `local_path` 完整

### `missing_capture`

表示：

- 本地 export bundle 里没有任何可接受 match

固定解释：

- 当前 blocker 在 capture 层，不在 PG ledger 层
- 正确动作是重新打开 capture/admission，而不是再次把问题解释成 `file_release` PG 补齐

### `missing_source_bytes`

表示：

- 已找到唯一 match
- 但这条 `file_release` 仍只有引用，没有可恢复 source bytes / locator

典型情况：

- `storage_provider=reference_only`
- `bucket/object_key/sha256` 缺失

### `ambiguous_match`

表示：

- 有多条 `file_release` 记录并列命中最高分

固定解释：

- 当前不能自动选择 owner
- 必须继续停在 manual review 或补更强的 owner identity signal

## 当前非目标

- 不把 `missing_capture` 自动降级成 wrapper notice promote
- 不把 `missing_source_bytes` 误判成“已有正文，只差 OCR”
- 不把 `ambiguous_match` 静默折叠成第一条记录
- 不在这条 contract 上提前绑定 OCR provider、chunk policy、embedding 或 release

## Reference Anchors

当前分层设计参考以下官方术语：

- DCMI `source`：<https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/source/>
- DCMI `hasPart`：<https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasPart/>
- DCMI `isPartOf`：<https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/isPartOf/>
- DataCite Versioning：<https://support.datacite.org/docs/versioning>

repo 对这些术语的当前解释是：

- wrapper notice 与 file release 是 provenance 邻接层，不是彼此替身
- regulation owner body 的恢复需要显式来源回链，不能靠 notice 正文冒充
