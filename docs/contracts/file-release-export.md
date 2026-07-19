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

`internal_portal_file_release_capture_request.v2` 只接受一个精确正整数
`file_release_id`。范围扫描、模糊选择和隐式页数参数不属于该合同。Ops Web 一次可以提交最多
50 个不重复 ID；ingestion-control 为每个 ID 创建独立的来源级父工作流。

请求以 SHA-256 固定后写入对象存储，再由
`internal_portal.file_release.capture` 对应的 `ingestion_task_envelope.v3` 引用。

## 采集产物

collector 为每条门户记录保留：

- file-release 标识与 metadata；
- source/detail/download URL 和采集时间；
- 文件名、media type、byte size 与 provenance；
- capture disposition；
- 成功采集 bytes 时的 source-bucket object key 与 SHA-256。

collector 写入 bundle、export manifest 和原文件。只有对象实际存在且 bytes/digest 一致的
记录才能进入 TypeScript 物化；`reference_only`、缺失或不匹配的 bytes 均失败关闭。

稳定 source object key 由 file-release identity、年份和 content digest 派生。本地 export
路径只用于诊断，不得越过 task 边界。

## 结果

采集阶段返回 `internal_portal_file_release_capture_result.v1`，其中明确标记 source bundle 和
export manifest。物化阶段返回 `internal_portal_file_release_materialization_result.v1`，并在
`items` 中记录文件发布条目的版本与产物引用。每个阶段再由
`ingestion_task_result.v1.result_ref` 固定对应结果。

父工作流把条目合并到 `ingestion_offline_release.v1` 完整清单，并在 PostgreSQL 事务中更新
文件发布流的当前指针。该发布止于离线层，不自动生成 chunk、索引、在线查询目标或产品页面。

## 不负责

- 修改通知来源正文；
- 按标题模糊选择；
- OCR 或正文抽取；
- 提升为 regulation；
- 发布 chunk、index 或 alias；
- 提供在线查询。

## 所有者

- 采集实现：`apps/source-collector/adapters/internal-portal/src/file-release-export-core.ts`；
- runtime activity：`apps/source-collector/src/activities.ts`；
- 来源物化：`packages/ingest-core` 与 `apps/ingestion-control` TypeScript kernel；
- 父工作流、离线发布与任务投影：`apps/ingestion-control`。

## 相关文档

- `docs/architecture/system/data-plane.md`
- `docs/data/internal-portal.md`
- `docs/runbooks/portal-auth.md`
