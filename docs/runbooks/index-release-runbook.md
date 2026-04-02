---
doc_type: runbook
status: active
created: 2026-03-28
updated: 2026-04-01
---

# Index Release Runbook

## 文档边界

这份 runbook 只回答 release-managed collection 共用的 index release 操作面：

- 怎么做一次 `chunking -> embedding -> indexing -> alias publish`
- 怎么检查 release manifest
- 怎么做发布后抽样
- 怎么做 alias rollback

它不重复：

- 长期架构边界：`docs/architecture/target-architecture.md`
- 数据平面分层：`docs/architecture/data-plane-architecture.md`
- 术语定义：`docs/reference/runtime-serving-and-index-terms.md`
- 旧 physical collection retention 决策：`docs/decisions/adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- Qdrant Cloud 备份 / 恢复策略：`docs/decisions/adr-0020-qdrant-cloud-backup-restore-and-object-store-transition.md`
- Qdrant Cloud 备份 / 恢复操作：`docs/runbooks/qdrant-cloud-backup-and-restore-runbook.md`
- 当前优先级和执行状态：`.planning/PROJECT.md`、`.planning/STATE.md`

## 前置检查

执行前必须确认：

- `.env` 已配置 cloud Qdrant、object store、document registry、embedding provider
- 对应 collection 的 `runtime-profile.json` 已确认：
  - `qdrant_alias_name`
  - `qdrant_collection_prefix`
  - `serving_stage`
  - `retrieval_enabled`
  - vector binding
- source truth 和 per-document `document-units.jsonl` 已存在
- chunk / cleaning policy 已固定

建议先检查：

```bash
uv run --all-packages python -m unittest tests.ingestion.test_corpus_runtime_profile tests.ingestion.test_rebuild_local_data tests.ingestion.test_provider_result_replay_rebuild tests.retrieval.test_backend_qdrant
```

## 标准入口

统一入口：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus <corpus> \
  --collection <collection> \
  --raw-version-id <raw_version_id> \
  --source-pdf <source_pdf> \
  --publish-alias
```

可选参数：

- `--raw-asset-id`
- `--reset-index`
- `--no-publish-alias`

当前这个入口底层走的是：

- `provider_response_replay`
- `rebuild_local_data(...)`
- release-managed Qdrant physical collection

补充说明：

- `student_handbook` 的一次 replay release 会同时 fan out 并索引 repo-tracked source projections，例如 `campus_services/contact_directory` 与 `campus_services/service_catalog`
- `offline_preparation` collection 只要已经纳入这条 release-managed lifecycle，也应使用稳定 alias；不要等“正式开放 query-serving”后再补做 alias 迁移

## 标准流程

### 1. 预演重建

先做一次不切 alias 的 rebuild/index：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus curriculum \
  --collection curriculum_plan \
  --raw-version-id <raw_version_id> \
  --source-pdf curriculum-plan.pdf \
  --no-publish-alias
```

目标：

- 能完成 source-truth replay
- 能为每个目标 scope 生成新 physical collection
- 能写出 release manifest
- validation summary 状态为 `passed`

### 2. 发布 alias

validation 通过后，执行正式发布：

```bash
uv run --all-packages python -m campus_ingestion_worker.release_index \
  --corpus curriculum \
  --collection curriculum_plan \
  --raw-version-id <raw_version_id> \
  --source-pdf curriculum-plan.pdf \
  --publish-alias
```

目标：

- 每个目标 scope 的 serving alias 都指向新 release
- `index-release.json` 记录 `previous_physical_collection_name`
- payload 中写入 release 元数据

## 发布后检查

### Qdrant

检查点：

- serving alias 存在
- alias 指向新的 physical collection
- points count 大于 0
- payload 含：
  - `index_release_id`
  - `index_release_manifest_key`
  - `index_release_alias`
  - `index_physical_collection_name`
  - `chunk_policy_version`
  - `cleaning_policy_version`

### Object Storage

检查点：

- `{corpus}/releases/{collection}/{release_id}/index-release.json`
- `{corpus}/releases/{collection}/{release_id}/validation-summary.json`

说明：

- 这里只应存在小型 manifest
- 不应出现 chunk dump

### Retrieval 抽样

至少做：

- 结构抽样
- 术语命中抽样
- 无关问题 no-hit 抽样
- source traceability 抽样

## 回滚

如果新 release 发布后发现问题：

1. 从 `index-release.json` 读取：
   - `serving_alias`
   - `previous_physical_collection_name`
2. 将 alias 切回上一个 physical collection
3. 重新做 retrieval 抽样
4. 记录 rollback 原因

回滚后仍保留：

- 失败 release 的 manifest
- validation summary

## 旧 Physical Collection 过期与清理

当前 retention policy 不是“超过 N 天直接删”，而是先判断角色：

- `current`
  - alias 当前目标
  - 永不自动删除
- `previous`
  - 最新 manifest 的 `previous_physical_collection_name`
  - 至少保留 `7` 天，且要等更新 release 的 post-publish validation / acceptance 关闭
- `migration_baseline`
  - 当 release 涉及 embedding model / dimensions、vector schema、chunk profile、cleaning policy、retrieval shape 迁移时，额外保留一版迁移前基线
  - 至少保留 `30` 天
- `archive_candidate`
  - 不再承担回滚或迁移保护角色的旧 collection

### 推荐 Backup 基线

在 Qdrant Cloud 上清理旧 collection 前，建议先确保备份窗口覆盖最长删除门禁：

- `Standard` 环境：daily `14` 天、weekly `8` 周、monthly `6` 个月
- 当前 `Free` tier：先补 `snapshot bundle -> object storage` 过渡方案，再评估删除

具体操作以 `docs/runbooks/qdrant-cloud-backup-and-restore-runbook.md` 为准。

### 清理前检查

删除前必须同时确认：

1. 目标 collection 不是任何 alias 的 `current`
2. 目标 collection 不是最新 manifest 的 `previous`
3. 目标 collection 不是仍在保护窗口内的 `migration_baseline`
4. 对应 release 的 `index-release.json` 与 `validation-summary.json` 已在对象存储落盘
5. 当前没有 active incident、回归调查或人工验收仍依赖该 release
6. Qdrant Cloud backup 或显式 snapshot/export 已覆盖这次 release 的恢复窗口

### 清理步骤

1. 从最新 `index-release.json` 读取：
   - `serving_alias`
   - `physical_collection_name`
   - `previous_physical_collection_name`
2. 列出同一 `collection_prefix` 下的 physical collections。
3. 标出：
   - `current`
   - `previous`
   - `migration_baseline`
   - `archive_candidate`
4. 只删除通过全部门禁的 `archive_candidate`。
5. 记录本次清理：
   - alias
   - 删除的 physical collection 名称
   - 对应 release id
   - backup / snapshot 依据
   - 操作人和时间

### 额外说明

- 删除旧 physical collection 不等于删除历史文档版本；历史版本保留语义仍由 registry / object-store truth 承担
- `offline_preparation` collection 和 `query_serving` collection 使用同一套 retention 规则
- `--reset-index` 只用于显式硬重置，不用于日常 retention cleanup

## 禁止事项

- 不要把 object storage 当在线 chunk truth
- 不要把 physical collection 名写死进运行配置
- 不要跳过 validation 直接 publish alias
- 不要把 chunk dump 回写到对象存储
- 不要把 `--reset-index` 当作 routine expiration/cleanup 入口
