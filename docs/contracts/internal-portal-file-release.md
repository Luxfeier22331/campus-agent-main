---
doc_type: contract
owner_boundary: sources/internal-portal
status: active
---

# 内部门户文件发布采集

## 边界

该接口按已知文件发布 ID 保存一份门户来源快照。它不扫描范围、不生成 ingestion task、不执行
正文抽取或物化，也不发布在线文档或查询目标。

## 提交

获准的内部调用使用 `POST /internal/ingestion/operations/internal-portal/file-releases`，提供请求 ID
和最多 50 个不重复的正整数文件发布 ID。当前 Ops Web 不提供该入口。ingestion-control 为每个 ID
创建独立 workflow：

```text
ingestion/internal-portal-file-release/<request-id>/<file-release-id>
```

同一请求 ID 与文件 ID 重复提交时直接返回已有 workflow；操作者信息不改变采集身份。调用方保存
响应中的 workflow ID，并通过
`POST /internal/ingestion/operations/internal-portal/file-releases/status` 查询 Temporal 状态。

## 采集

workflow 调用 source-collector 的 `captureInternalPortalFileRelease` Activity。Activity 校验详情 ID，
取得同站点下载地址，流式写入原文件，再写入
`internal_portal_file_release_source.v1`。固定对象路径和字段以数据文档与 JSON Schema 为准。

Activity 返回 `internal_portal_file_release_capture_result.v1`，只包含文件发布 ID 与带 SHA-256、
字节数的 `source.json` 对象引用。返回值不落成额外 manifest。

已有合法 `source.json` 时 Activity 直接返回同一引用，不重新访问门户。门户请求、下载、对象写入
或 schema 校验任一失败都会使 workflow 失败；workflow 不把失败转换为空结果或部分成功。

## 不负责

- 通知采集与通知附件下载；
- OCR、正文抽取、规范文档转换或规章提升；
- derived bucket、离线发布、索引或 alias；
- 在线文件读取或模型查询。

## 所有者

- HTTP 与 workflow：`apps/ingestion-control`；
- 来源 Activity 与门户适配器：`apps/source-collector`；
- 跨运行时对象：`packages/ingestion-contracts`。

## 相关文档

- `docs/data/internal-portal.md`
- `docs/runbooks/ingestion.md`
- `docs/runbooks/portal-auth.md`
