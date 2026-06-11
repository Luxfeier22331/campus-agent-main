---
doc_type: contract
status: active
created: 2026-06-11
updated: 2026-06-11
---
# App API Campus Services Ops HTTP Contract

## 文档边界

本文冻结 `apps/app-api` 暴露给 operator-facing ops surface 的
`campus_services` 人工校对与发布基底 HTTP contract。

它回答：

- operator 如何录入人工来源 attestation
- operator 如何维护服务状态与班车临时 override
- preview / publish release 的行为边界
- audit event 返回哪些安全字段

它不覆盖：

- ops 前端 UI 设计
- 自动 notice 消费、候选审阅成熟度或证据抽取 workflow
- execution-control typed tool 的 runtime lookup request/result shape
- 直接编辑 serving read model、对象存储 artifact 或 raw notice/chat content

## Core Contract

所有 endpoint 位于 `apps/app-api`，caller class 为 `operator-via-panel` 或 future
operator app same-site/internal bridge。Admission 固定为 admitted operator principal。
非 operator principal 返回统一错误 envelope：

```json
{
  "error": {
    "code": "forbidden",
    "message": "Operator access is not available for this principal.",
    "retryable": false,
    "traceId": null,
    "requestId": null,
    "details": null
  }
}
```

错误模型继续遵守 `docs/contracts/app-api-error-model.md`。

## Endpoints

- `GET /api/operator/campus-services/candidates`
- `POST /api/operator/campus-services/attestations`
- `GET /api/operator/campus-services/status-overrides`
- `POST /api/operator/campus-services/status-overrides`
- `PATCH /api/operator/campus-services/status-overrides/:overrideId`
- `GET /api/operator/campus-services/transport-overrides`
- `POST /api/operator/campus-services/transport-overrides`
- `PATCH /api/operator/campus-services/transport-overrides/:overrideId`
- `GET /api/operator/campus-services/releases`
- `POST /api/operator/campus-services/releases/preview`
- `POST /api/operator/campus-services/releases`
- `GET /api/operator/campus-services/audit-events`

## Source Attestation

`POST /api/operator/campus-services/attestations`

Request:

```json
{
  "sourceType": "counselor_notice",
  "summary": "导员确认今日医保窗口下午暂停办理。",
  "operatorNotes": "已人工校对，不包含聊天截图原文。",
  "confirmedAt": "2026-06-11T07:50:00.000Z"
}
```

`sourceType` 第一版允许：

- `counselor_notice`
- `group_message`
- `phone_confirmation`
- `onsite_confirmation`
- `operator_curated`
- `official_web_candidate`
- `authenticated_notice_candidate`

固定规则：

- `summary` 是 operator-safe 摘要，不保存 raw chat、截图、附件字节或对象存储 locator。
- `operatorNotes` 只保存校对说明，不保存未经脱敏原文。
- `confirmedAt` 必须是可解析 ISO timestamp。

Response:

```json
{
  "attestation": {
    "attestationId": "services_attestation_01",
    "sourceType": "counselor_notice",
    "summary": "导员确认今日医保窗口下午暂停办理。",
    "operatorNotes": "已人工校对，不包含聊天截图原文。",
    "confirmedAt": "2026-06-11T07:50:00.000Z",
    "status": "active",
    "createdAt": "2026-06-11T08:00:00.000Z",
    "createdBy": {
      "principalId": "ops@example.com",
      "displayName": "Ops Team"
    }
  }
}
```

## Status Override

`POST /api/operator/campus-services/status-overrides`

Request:

```json
{
  "serviceId": "medical_insurance_counter",
  "displayName": "医保窗口",
  "status": "closed",
  "message": "下午恢复办理前暂停服务。",
  "effectiveFrom": "2026-06-11T07:00:00.000Z",
  "effectiveUntil": "2026-06-11T10:00:00.000Z",
  "sourceAttestationIds": ["services_attestation_01"]
}
```

`status` 第一版允许：

- `open`
- `limited`
- `closed`
- `temporarily_unavailable`

固定规则：

- `effectiveFrom` 与 `effectiveUntil` 必填。
- `effectiveUntil <= effectiveFrom` 返回 `422 validation_failed`。
- `sourceAttestationIds` 如传入，必须引用已存在 attestation。
- 创建后的 `reviewState` 默认是 `ready_for_publish`。

`PATCH` 支持同一字段子集外加 `reviewState`，用于人工撤回或重新标记：

- `draft`
- `ready_for_publish`
- `published`
- `archived`

## Transport Override

`POST /api/operator/campus-services/transport-overrides`

Request:

```json
{
  "routeId": "nanhu_jiangjunlu_evening",
  "displayName": "两校区晚间接驳",
  "serviceStatus": "extra_service",
  "message": "南湖至将军路 18:30 增开。",
  "effectiveFrom": "2026-06-11T07:30:00.000Z",
  "effectiveUntil": "2026-06-11T09:30:00.000Z",
  "sourceAttestationIds": ["services_attestation_01"]
}
```

`serviceStatus` 第一版允许：

- `normal`
- `delayed`
- `extra_service`
- `rerouted`
- `suspended`
- `temporarily_unavailable`

时间窗、attestation 与 `reviewState` 规则同 status override。

## Preview And Publish

`POST /api/operator/campus-services/releases/preview`

Request:

```json
{
  "notes": "发布今日人工校对服务调整。"
}
```

Response:

```json
{
  "preview": {
    "generatedAt": "2026-06-11T08:00:00.000Z",
    "notes": "发布今日人工校对服务调整。",
    "itemCount": 2,
    "warnings": [],
    "diff": {
      "added": ["status:services_status_override_01"],
      "removed": [],
      "unchanged": []
    },
    "currentEffective": {
      "generatedAt": "2026-06-11T08:00:00.000Z",
      "statusOverrides": [],
      "transportOverrides": []
    }
  }
}
```

`preview` 不创建 release，不写 publish audit event。

`POST /api/operator/campus-services/releases` 创建 release。Publish 在 store
transaction 内写入 release 与 audit event；失败时不得产生 best-effort 部分发布。
当前 release snapshot 是 app-api ops store 的 current-effective summary，后续由
execution-control / structured read model consumption lane 显式接入，不允许 query-time
扫描 raw source。

## Audit

`GET /api/operator/campus-services/audit-events`

返回 operator-safe audit events：

```json
{
  "auditEvents": [
    {
      "auditEventId": "services_audit_01",
      "action": "release.published",
      "objectType": "campus_services_release",
      "objectId": "services_release_01",
      "summary": "Campus services current-effective release published.",
      "before": null,
      "after": {
        "releaseId": "services_release_01",
        "itemCount": 2
      },
      "actor": {
        "principalId": "ops@example.com",
        "displayName": "Ops Team"
      },
      "occurredAt": "2026-06-11T08:00:00.000Z"
    }
  ]
}
```

Audit 不返回 raw chat、raw screenshots、OCR payload、attachment bytes、bucket、
object key、provider payload 或 sink raw event。
