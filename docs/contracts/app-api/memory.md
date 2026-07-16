---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# App API 个人记忆接口

这些接口只管理当前已登录用户的显式个人记忆和开关。

## `GET /api/me/profile-memory`

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

## `POST /api/me/profile-memory/items`

新增或更新一条用户声明的个人记忆：

```json
{
  "key": "recent_goal",
  "value": "准备保研材料"
}
```

返回 `{ "item": <已保存项> }`，其中项的字段与列表响应一致。

## `PATCH /api/me/profile-memory/settings`

```json
{ "enabled": false }
```

返回：

```json
{
  "profileMemory": {
    "enabled": false
  }
}
```

## `DELETE /api/me/profile-memory/items/:itemId`

删除当前用户的指定项，成功返回：

```json
{ "deleted": true }
```

## 规则

- 所有接口都要求已解析的会话用户。
- `key` 使用小写类型键，并拒绝授权、权限和 ACL 类键。
- `enabled=false` 不删除已有项，但 execution-control/Hindsight 必须停止召回和追加该用户记忆。
- 删除项后，app-api 必须同步禁用对应 Hindsight 文档，后续召回不得再返回该项。
- 个人记忆不能改变用户身份、授权、工具准入或知识目标准入。
- 当前单租户标识为 `tenant-main`；app-api 调用 execution-control 个人记忆内部命令时
  必须显式传递。

## 可执行来源

- `apps/app-api/src/app/routes/profile-memory.ts`
- `apps/app-api/src/modules/profile-memory/`
- `apps/app-api/src/modules/integration/execution-control-runtime.ts`
