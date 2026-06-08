---
doc_type: contract
status: active
created: 2026-06-08
updated: 2026-06-08
---
# App API Campus Ops HTTP Contract

## 文档边界

本文冻结 `apps/app-api` 面向 Campus Operations Control Plane 的 browser-facing
operator HTTP contract 横切规则。

它回答：

- `/api/ops/*` 的调用方、authz、错误、pagination 与 audit 规则
- `campus-ops-web` 与 `app-api` 的 proxy 边界
- ops draft / release / published projection 的通用 envelope

它不负责：

- dining 领域对象字段，见 `app-api-dining-ops-http.md`
- operator observability/panel 查询，见 `app-api-operator-observability-http.md`
- student-facing campus projection，见 `app-api-http.md`
- auth/session/OAuth provider 细节

## Caller Model

`/api/ops/*` 的 browser surface owner 是 `apps/campus-ops-web`。

调用形态固定为：

```text
operator browser -> campus-ops-web same-site /api/ops/* -> app-api
```

`campus-ops-web` Worker 只允许显式 proxy 已实现的 `/api/ops/dining/*` route。它不开放
generic `/api/*`，也不 proxy `/api/auth/*` 或 `/api/federation/*`。

## Authz

当前实现使用 `ResolvedAppPrincipal.permissions.operator === true` 作为 ops route admission。

目标权限模型保留以下语义位，但当前代码尚未拥有独立字段：

- `campus_ops_viewer`：读取 ops workspace
- `dining_editor`：编辑 dining draft
- `dining_publisher`：发布 dining snapshot

在细粒度权限落地前，文档不得把这些位写成当前已实现 admission truth。普通 end-user、
service principal、未登录请求和非 operator principal 对 `/api/ops/*` 必须 fail closed。

## Error Envelope

所有错误响应复用 `docs/contracts/app-api-error-model.md`。

常见 code：

- `session_required`
- `forbidden`
- `validation_failed`
- `dining_floor_not_found`
- `dining_window_not_found`
- `dining_assignment_not_found`
- `dining_menu_item_not_found`
- `dining_menu_offering_not_found`
- `dining_release_not_published`

## Release Envelope

Ops release command 返回：

```json
{
  "release": {
    "createdAt": "2026-06-08T00:00:00.000Z",
    "createdBy": "operator_01",
    "notes": "调整一食堂价格",
    "publishedAt": "2026-06-08T00:00:00.000Z",
    "publishedBy": "operator_01",
    "releaseId": "dining_release:...",
    "status": "published"
  },
  "snapshot": {}
}
```

规则：

- release snapshot 是学生端 `/api/dining/*` 的读取 truth
- draft tables 不能直接被 `campus-web` 读取
- release publish 必须写 audit event
- release 不允许 best-effort 部分发布；失败时不更新 latest published snapshot

## Audit Envelope

Audit list 返回：

```json
{
  "events": [
    {
      "action": "menu_offering.updated",
      "actorDisplayName": "Ops User",
      "actorPrincipalId": "operator_01",
      "after": {},
      "auditEventId": "dining_audit:...",
      "before": {},
      "objectId": "offering:...",
      "objectKind": "dining.menu_offering",
      "occurredAt": "2026-06-08T00:00:00.000Z"
    }
  ]
}
```

规则：

- audit event 保存 object-level before/after summary
- audit response 不暴露 raw auth row、session token、operator cookie 或 secret
- operator identity 只投影 principal id 和 display name

## Pagination

当前 dining ops list routes 只返回 bounded in-memory/DB result set，不冻结 cursor
pagination shape。新增大列表时必须先在本 contract 中冻结 `limit`、`cursor` 和排序规则。
