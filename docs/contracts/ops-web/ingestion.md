---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 采集运行接口

## 查询

- `GET /api/ops/ingestion/status` 返回认证维护、通知计划以及通知和文件发布流的有界状态。
- `GET /api/ops/ingestion/tasks` 按固定字段和游标查询有界任务投影，单页最多 200 条。
- `GET /api/ops/ingestion/tasks/:taskId` 返回单个任务投影，不返回正文或对象存储产物。

浏览器不能提供任意 SQL、Temporal query、对象存储路径或字段投影。上游不可用返回
`503 OPS_INGESTION_UNAVAILABLE`，不能转换为空列表。

## 任务重试

`POST /api/ops/ingestion/tasks/:taskId/retry` 只接受失败或已取消的独立任务。运行中、成功、
合同已经变化或属于父工作流的任务返回冲突；接口不提供运行中取消。

## 通知计划

- `POST /api/ops/ingestion/notice/pause`
- `POST /api/ops/ingestion/notice/resume`
- `POST /api/ops/ingestion/notice/reconcile`

暂停和恢复只能操作固定通知计划。完整核对必须提供调用方生成的 `requestId`，不能指定任意
Schedule、Workflow ID、来源范围或最大通知数。

## 文件发布

`POST /api/ops/ingestion/file-releases` 接受调用方生成的 `requestId` 和 1 至 50 个不重复的正整数
文件 ID。每个 ID 建立独立父工作流；接口不支持来源范围扫描。

所有写接口必须通过 Cloudflare Access 人员准入和同源校验。Ops Web 使用服务端固定的
`OPS_WEB_INTERNAL_TOKEN` 调用 ingestion-control，浏览器不能获得该凭据。

通用鉴权、错误和禁止行为见 [README.md](./README.md)。
