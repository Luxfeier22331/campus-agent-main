---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-17
---

# App API HTTP System Auth Profile Memory

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## System Endpoints

### `GET /healthz`

返回最小 liveness 信息。

```json
{
  "status": "ok",
  "app": "app-api"
}
```

### `GET /readyz`

返回 runtime dependency readiness 信息。

```json
{
  "status": "ready",
  "dependencies": {
    "auth": "ready",
    "database": "ready",
    "officialWebHandoff": "not_configured",
    "operatorBridge": "configured",
    "authShellOrigin": "configured",
    "executionControl": "ready"
  },
  "preflight": {
    "campusServicesProductPath": {
      "status": "ready",
      "capabilityGate": "open",
      "projectionSource": "postgres",
      "checks": {
        "serviceStatusProjection": "ready",
        "serviceStatusReadModel": "ready",
        "transportSchedule": "ready",
        "transportScheduleReadModel": "ready",
        "serviceGuideProjection": "ready",
        "serviceGuideReadModel": "ready",
        "contactDirectoryProjection": "ready",
        "contactDirectoryReadModel": "ready",
        "structuredQueryRuntime": "ready"
      },
      "blockers": {}
    }
  }
}
```

当 runtime config 缺失时，返回 `503 dependency_not_ready`，并在 `details.missing` 中列出缺失键。

`preflight.campusServicesProductPath` 是 online answer campus services opening gate
的诊断块。
它不改变 `app-api` 对非 campus-services 产品路径的基础 readiness 语义；当 status 为
`blocked` 时，`blockers` 会指出具体 gate / projection / read-model 缺口。

当 config 已齐但实际依赖未 ready 时，返回 `503 dependency_not_ready`，并在 `details.failed`
中列出失败 probe，例如：

```json
{
  "error": {
    "code": "dependency_not_ready",
    "message": "Runtime dependencies are not ready.",
    "retryable": true,
    "details": {
      "failed": {
        "auth": "better-auth session runtime failed probe",
        "executionControl": "execution-control /readyz returned 503"
      }
    }
  }
}
```

## Auth Endpoints

### `ALL /api/auth/*`

- 由 Better Auth handler 挂载
- `campus-web` 通过 same-site route 暴露给浏览器
- `operator-console-web` 不在 v1 上复用这一套 end-user 登录流程

### `GET /api/me`

返回当前 app principal。

```json
{
  "principal": {
    "type": "campus_member",
    "principalId": "user_01HQ...",
    "displayName": "Jane Doe",
    "email": "jane@example.edu"
  },
  "session": {
    "sessionId": "sess_01HQ...",
    "expiresAt": "2026-03-29T07:00:00.000Z"
  },
  "permissions": {
    "chat": true,
    "operator": false
  }
}
```

规则：

- 已登录 end-user 默认投影为 `campus_member`
- `session.sessionId` 是当前 end-user path 的 canonical app-owned session
  identifier；它来自 typed auth projection，不来自 browser 自造 conversation id
- `operator` 使用 protected surface trusted identity bridge
- v1 不要求单独的 operator 用户系统或 operator session 表
- 当前 chat routes 继续要求 resolved principal；无 principal 请求返回
  `session_required`，不会创建 anonymous chat conversation

## Profile Memory Endpoints

这些接口是当前 signed-in end-user 的 profile memory 控制面。

### `GET /api/me/profile-memory`

返回当前用户 profile memory projection setting 与 user-visible memory items。

```json
{
  "profileMemory": {
    "enabled": true,
    "items": [
      {
        "itemId": "mem_01HQ...",
        "key": "recent_goal",
        "value": "准备保研材料",
        "sourceType": "user_declared",
        "confidence": "low",
        "visibility": "user_visible",
        "lastVerifiedAt": "2026-04-27T00:00:00.000Z",
        "updatedAt": "2026-04-27T00:00:00.000Z"
      }
    ]
  }
}
```

### `POST /api/me/profile-memory/items`

Upsert 一个用户声明的 profile memory item。

```json
{
  "key": "recent_goal",
  "value": "准备保研材料"
}
```

返回：

```json
{
  "item": {
    "itemId": "mem_01HQ...",
    "key": "recent_goal",
    "value": "准备保研材料",
    "sourceType": "user_declared",
    "confidence": "low",
    "visibility": "user_visible",
    "lastVerifiedAt": "2026-04-27T00:00:00.000Z",
    "updatedAt": "2026-04-27T00:00:00.000Z"
  }
}
```

### `PATCH /api/me/profile-memory/settings`

打开或关闭 profile memory projection。

```json
{
  "enabled": false
}
```

返回：

```json
{
  "profileMemory": {
    "enabled": false
  }
}
```

### `DELETE /api/me/profile-memory/items/:itemId`

删除当前用户名下的 profile memory item。

```json
{
  "deleted": true
}
```

规则：

- 所有接口都要求 resolved session principal
- memory item `key` 使用小写 typed key，并拒绝 authorization / permission / ACL 类 key
- `profileMemory.enabled=false` 不删除已有 item，但 execution-control / Hindsight personal
  memory recall 必须停止返回 active memory context
- 删除 item 后，该 item 必须被同步 delete from Hindsight document / recall path；不得再被
  `context.memory_recall` 返回
- profile memory 不进入 authorization filter、serving surface、approval 或 tool permission
- 当前单校区默认 product tenant 为 `tenant-main`；app-api 调用 execution-control
  personal-memory internal command 时必须显式传该 tenant，不得传空字符串让下游猜默认值
