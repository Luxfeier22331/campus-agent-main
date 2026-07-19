---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 门户认证接口

## `GET /api/ops/internal-portal-auth`

返回固定 Secret 元数据、固定 Temporal Schedule 摘要和观测生命周期，不返回 Secret data、
TGC 或 Service Ticket：

```json
{
  "configured": true,
  "updatedAt": "2026-07-15T12:00:00.000Z",
  "updatedBy": "operator@example.com",
  "maintenance": {
    "scheduleState": "ACTIVE",
    "nextRunAt": "2026-07-15T13:00:00.000Z",
    "lastAttemptAt": "2026-07-15T12:30:00.000Z",
    "lastOutcome": "SUCCESS",
    "lastSuccessAt": "2026-07-15T12:30:03.000Z",
    "serviceTicketIssued": true,
    "portalSessionEstablished": true,
    "noticeProbeSucceeded": true,
    "errorCode": null
  },
  "observedLifetime": {
    "lowerBoundSeconds": 1803,
    "upperBoundSeconds": null
  }
}
```

Secret 不存在时返回 `configured=false`；Kubernetes API 不可用时返回 `503`，但不影响其他接口
或 `/readyz`。Temporal 查询不可用时 `maintenance.scheduleState` 为 `UNAVAILABLE`，仍返回
Secret 元数据。

## `PUT /api/ops/internal-portal-auth`

请求必须同源、正文不超过 8 KiB，并包含：

```json
{ "credential": "raw SSO_TGC or Cookie header" }
```

服务端接受原始 TGC 或包含且只包含一个 `SSO_TGC` 的 Cookie 字符串。校验后只更新服务端固定
的凭据资源，并记录更新时间和更新人。成功响应与 GET 相同，不回显凭据。接口不选择或创建
Secret、不在线验证门户登录、不保存旧值，也不提供回滚。

凭据更新成功后服务端幂等恢复固定维护 Schedule；恢复失败不会撤销凭据更新，响应以
`UNAVAILABLE` 显示维护状态。

## `POST /api/ops/internal-portal-auth/maintenance/resume`

人员操作者可以同源调用该接口，重试恢复固定认证维护 Schedule。接口不接受 Schedule ID、
Workflow ID 或凭据，不立即触发运行；成功响应与 GET 相同。

`lowerBoundSeconds` 是当前凭据更新时间到最近一次成功 Service Ticket 签发的时间；首次确认
过期后才产生 `upperBoundSeconds`。这是约 30 分钟精度的观测区间，不是 CAS 配置声明。

通用鉴权、错误和禁止行为见 [README.md](./README.md)。
