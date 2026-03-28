---
doc_type: runbook
status: active
created: 2026-03-28
updated: 2026-03-28
---

# Index Release Runbook

## 文档边界

这份 runbook 只回答 release-managed collection 共用的 index release 操作面：

- 怎么做一次 `chunking -> embedding -> indexing -> alias publish`
- 怎么检查 release manifest
- 怎么做发布后抽样
- 怎么做 alias rollback

它不重复：

- 长期架构边界：`docs/architecture/long-term-architecture.md`
- 数据平面分层：`docs/architecture/phase1-ingestion-and-storage-architecture.md`
- 术语定义：`docs/reference/runtime-serving-and-index-terms.md`
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

## 禁止事项

- 不要把 object storage 当在线 chunk truth
- 不要把 physical collection 名写死进运行配置
- 不要跳过 validation 直接 publish alias
- 不要把 chunk dump 回写到对象存储
