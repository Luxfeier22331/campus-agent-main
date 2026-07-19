---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# App API 个人记忆接口

这些接口管理当前已登录用户的个人记忆投影和生命周期。app-api 接受修改后写入 durable command；
Hindsight 是否已经完成对应操作由响应状态和后续查询确认。

## 查询

### `GET /api/me/profile-memory`

成功返回 `200`：

```json
{
  "profileMemory": {
    "itemCount": 1,
    "items": [
      {
        "itemId": "mem_01HQ...",
        "key": "answer_style",
        "revision": 2,
        "state": "synced",
        "updatedAt": "2026-04-27T00:00:00.000Z",
        "value": "先给结论"
      }
    ],
    "lifecycleState": "active",
    "syncStatus": "synced"
  }
}
```

`lifecycleState` 为 `active`、`paused`、`erasing` 或 `erased`；`syncStatus` 为 `synced`、
`pending` 或 `failed`；item `state` 为 `synced`、`saving`、`deleting` 或 `failed`。

## 修改

所有修改都要求非空 `Idempotency-Key` 请求头。服务接受命令后返回 `202` 和当前产品投影；
`202` 不表示 Hindsight 已经同步完成。

### `POST /api/me/profile-memory/items`

```json
{
  "key": "answer_style",
  "value": "先给结论"
}
```

### `PATCH /api/me/profile-memory/items/:itemId`

```json
{
  "key": "answer_style",
  "value": "简洁回答"
}
```

新增和修改响应包含正在保存的 item：

```json
{
  "profileMemory": {
    "item": {
      "itemId": "mem_01HQ...",
      "key": "answer_style",
      "revision": 2,
      "state": "saving",
      "updatedAt": "2026-04-27T00:00:00.000Z",
      "value": "简洁回答"
    },
    "lifecycleState": "active",
    "syncStatus": "pending"
  }
}
```

### `PATCH /api/me/profile-memory/settings`

```json
{ "enabled": false }
```

`enabled=false` 将 lifecycle 设为 `paused`；`enabled=true` 将其设为 `active`。pause 保留现有
item 和 Hindsight bank，但后续运行不会召回或追加个人记忆。

### `DELETE /api/me/profile-memory/items/:itemId`

接受指定 item 的 durable 删除命令。响应不返回 `{ "deleted": true }`；客户端通过
`profileMemory.syncStatus` 和后续 GET 观察完成状态。

### `DELETE /api/me/profile-memory`

接受当前账号的完整清除命令，响应 lifecycle 为 `erasing`。只有代次隔离、Hindsight
bank 删除和受约束的 Langfuse trace 删除均完成后，状态才会进入 `erased`。

## 共同规则

- 所有接口都要求已解析的会话用户；认证和错误 envelope 见 [错误合同](./error.md)。
- `key` 必须以小写字母开头，只包含小写字母、数字、`_`、`:`、`-`，最长 64 个字符，并拒绝
  授权、权限、token 和可见性类键。
- `value` 会去除首尾空白、合并连续空白，非空且最长 500 个字符。
- item ID 只在当前用户范围内有效；浏览器不会获得 bank、document、operation 或 provider ID。
- 个人记忆不能改变身份、授权、工具准入或知识目标准入。
- 当前产品 tenant 为显式 `tenant-main`，由 app-api 调用 execution-control 内部命令时传递。

## 可执行来源

- `apps/app-api/src/app/routes/profile-memory.ts`
- `apps/app-api/src/modules/profile-memory/`
- `apps/app-api/src/modules/integration/execution-control-runtime.ts`
