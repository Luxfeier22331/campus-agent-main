---
doc_type: contract
owner_boundary: sources/internal-portal
status: active
---
# 文件发布采集合同

## 边界

`internal_portal.file_release.capture` 把校内门户的文件发布栏目采集为认证文档来源。它与正式
通知来源正文分离，也不提供在线文档或规章查询。

## 请求

`internal_portal_file_release_capture_request.v1` 接受：

- 可选的正整数 `max_file_releases`；
- 可选的正整数 `max_pages`；
- 取值 1 至 200、默认 20 的 `page_size`；
- 可选的精确正整数 `target_file_release_id`。

请求以 SHA-256 固定后写入对象存储，再由
`internal_portal.file_release.capture` 对应的 `ingestion_task_envelope.v3` 引用。

## 采集产物

collector 为每条门户记录保留：

- file-release 标识与 metadata；
- source/detail/download URL 和采集时间；
- 文件名、media type、byte size 与 provenance；
- capture disposition；
- 成功采集 bytes 时的 source-bucket object key 与 SHA-256。

collector 写入 bundle 与 export manifest，再生成已验证的 source ref。只有对象实际存在且
bytes/digest 一致的记录才能进入 source materialization；`reference_only`、缺失或不匹配的
bytes 均失败关闭。

稳定 source object key 由 file-release identity、年份和 content digest 派生。本地 export
路径只用于诊断，不得越过 task 边界。

## 结果

activity 写入 `authenticated_file_release_source_manifest.v1`，并返回指向该 manifest 的
`ingestion_task_result.v1`。有界 summary 只包含 file、page 与 upload 数量。合同不包含
PostgreSQL run ledger 或隐式查询。

## 不负责

- 修改通知来源正文；
- 按标题模糊选择；
- OCR 或文档归一化；
- 提升为 regulation；
- 发布 chunk、index 或 alias；
- 提供在线查询。

## 所有者

- 采集实现：`apps/source-collector/adapters/internal-portal/src/file-release-export-core.ts`；
- runtime activity：`apps/source-collector/src/activities.ts`；
- source ref 校验：`packages/ingest-core`；
- workflow 与终态投影：`apps/ingestion-control`。

## 相关文档

- `docs/architecture/system/data-plane.md`
- `docs/data/internal-portal.md`
- `docs/runbooks/portal-auth.md`
