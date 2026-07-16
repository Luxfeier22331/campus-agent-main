---
doc_type: data
owner_boundary: sources/internal-portal
status: active
---

# 内部门户来源数据

## 通知采集

输入合同为 `internal_portal_notice_capture_request.v1`，支持：

- `collection_mode`：`incremental`、`backfill` 或 `selected`；
- 可选的正整数 `max_notices`；
- `selected` 模式下指定 notice id/type。

collector 将 provider/export bundle、capture release、content block、attachment ref 和已采集
attachment object 写入 source bucket。生成 `authenticated_notice_source_manifest.v1` 前，必须
验证同桶 ref 与 SHA-256。

## 文件发布采集

输入合同为 `internal_portal_file_release_capture_request.v1`，支持 page size、可选 page/item
上限和可选的精确 file-release id。

结果只能包含已经验证且有对象支撑的 source artifact；`reference_only` 不得转换为成功的
source object。

## 统一任务结果

两类任务都返回 `ingestion_task_result.v1`，其中包含：

- task/run/registry 标识；
- registry 声明的 output contract；
- 一个由 digest 固定的 source result manifest；
- notice、file、page、attachment 或 upload 等有界数量。

详细 failure 与 source row 留在对象存储，不复制到 PostgreSQL 或 Temporal signal。

## 关系数据

app-api 和 collector 都没有认证通知专用表。唯一关系状态是共享的
`ingestion_control.tasks` 投影，其中只保存 source family/channel、终态、是否存在 result、
有界 summary 和有界 error 字段。

## 下游边界

source manifest 不是正式 notice read model、regulation row、chunk、vector、alias 或在线查询
数据。只有完整下游实现已经存在时，才能声明对应的可执行 task 与 output contract。

## 相关文档

- `docs/architecture/system/data-plane.md`
- `docs/contracts/file-release-export.md`
- `docs/runbooks/portal-auth.md`
