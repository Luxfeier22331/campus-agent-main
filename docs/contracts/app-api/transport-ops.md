---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# 班车运维接口

## 边界

本文定义 app-api 当前班车运维接口：来源确认、临时变更、发布预览、发布和审计。它不定义通用
service status、办事指南、通讯录、tool payload 或学生状态页 JSON。

所有接口要求 operator principal；其他身份使用 `error.md` 的共享错误 envelope 返回
`forbidden`。

## 接口

- `GET /api/operator/campus-services/candidates`
- `POST /api/operator/campus-services/attestations`
- `GET|POST /api/operator/campus-services/transport-overrides`
- `PATCH /api/operator/campus-services/transport-overrides/:overrideId`
- `GET /api/operator/campus-services/releases`
- `POST /api/operator/campus-services/releases/preview`
- `POST /api/operator/campus-services/releases`
- `GET /api/operator/campus-services/audit-events`

## 来源确认

`POST /api/operator/campus-services/attestations` 接受：

- `sourceType`
- `summary`
- `operatorNotes`
- `confirmedAt`

`sourceType` 允许 `counselor_notice`、`group_message`、`phone_confirmation`、
`onsite_confirmation`、`operator_curated`、`official_web_candidate` 和
`authenticated_notice_candidate`。`summary` 与 `operatorNotes` 必须是运维可用摘要，不得
保存原始证据；`confirmedAt` 必须是 ISO 时间。

## 临时变更

创建请求包含 route/display、`serviceStatus`、message、有效起止时间和可选来源确认 ID。
`serviceStatus` 允许：

- `normal`
- `delayed`
- `extra_service`
- `rerouted`
- `suspended`
- `temporarily_unavailable`

`effectiveUntil` 必须晚于 `effectiveFrom`，否则返回 `422 validation_failed`。来源 ID 必须
真实存在。新变更默认 `ready_for_publish`；PATCH 还可以设置 `draft`、`published` 或
`archived`。

## 预览与发布

- preview 计算当前有效变更，返回差异和警告，不写 release 或 audit；
- publish 在同一事务中写 published release 和 audit event，禁止 best-effort 部分成功；
- runtime 读取 published read model，不在 query-time 扫描原始来源或 attestation。

## 审计

审计接口只返回运维安全摘要，不得包含聊天原文、截图、OCR、附件 bytes、bucket/object key、
provider payload 或观测平台原始事件。
