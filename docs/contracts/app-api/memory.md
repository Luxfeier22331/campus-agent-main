---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# App API 个人记忆接口

接口面向当前会话用户。app-api 拥有用户意图、命令 outbox 和产品读取投影；execution-control
拥有已准入命令的运行时 receipt、generation、profile 合成和访问屏障；Hindsight 拥有个人记忆
内容和整篇画像。app-api 不直连 Hindsight，也不解析 Temporal history。

产品模型是整篇画像：助手把全部已准入记忆合成为一份自然语言 profile，用户提交自然语言
纠正，而不是逐条增删改。逐条 CRUD 不在产品合同中。

## 查询

`GET /api/me/profile-memory` 返回：

```json
{
  "profileMemory": {
    "lifecycleState": "active",
    "syncStatus": "synced",
    "operations": []
  }
}
```

`lifecycleState` 是产品侧当前生命周期投影：`active`、`paused` 或 `erased`。清除请求
接受后立即投影为 `erased`（画像读取返回空），数据面删除由 execution-control 异步完成。
`syncStatus` 只描述生命周期命令：`synced`、`pending` 或 `failed`，不代表记忆写入命令的完成状态。
execution-control 的 receipt 可通过受内部 worker 鉴权保护的
`POST /internal/memory/personal/commands/status` 查询；产品侧尚未把运行时状态字段直接
暴露为新的公开生命周期字段。响应包含 `stale` 布尔值：非终态 receipt 超过既定触碰
间隔（execution-control 定义的 margin）未被触碰时为 true，只表示本地进度长时间未更新，
不能据此判定 workflow 已结束或 Hindsight operation 已停止。

`operations` 返回当前用户尚未完成或当前失败的产品命令，每项包含：

```text
commandId
commandKind
status: pending_admission | admitted | failed
errorCode: string | null
```

`admitted` 表示 execution-control 已接收命令，不表示 Hindsight 已完成。app-api 的定时任务会对
admitted 命令按 command ID 查询 execution-control；已知 succeeded/failed 的 receipt 会重新写入
产品投影。查询不到的命令重新准入（同 workflow ID 幂等）；运行时仍未终态但已 `stale` 的命令
同样用原 payload、command ID 和 workflow ID 重新准入；已运行的 workflow 保持不变，
已结束的 workflow 重新启动以查询或恢复同一 provider operation。
未确认终态的命令继续保持 admitted；stale 不触发失败终态化，也不放行旧 generation 的排空。

`GET /api/me/profile-memory/profile` 返回：

```json
{
  "profile": {
    "content": "偏好简洁的回答……",
    "generating": false,
    "isStale": false,
    "lastRefreshedAt": "2026-09-20T10:00:00Z"
  }
}
```

profile 由 execution-control 通过当前用户 generation 的 Hindsight bank 合成，不建立产品侧
条目镜像。`generating` 表示首次合成仍在进行；`isStale` 表示新记忆已准入但画像尚未重刷。
`content` 为空串且 `generating` 为 true 表示还没有足够记忆生成画像。

生命周期约束：

- `erased` 返回本地终态空画像（`content` 为空串、其余字段为默认值），不调用 execution-control；
- 清除即时生效：请求返回 202 时 `lifecycleState` 已是 `erased`，`syncStatus` 为 `pending`，
  数据面删除完成后收敛为 `synced`；
- 供应商不可用等运行时错误按原错误语义透传，不伪装为空画像。

## 修改

除重试外的修改要求 8–200 字符的 `Idempotency-Key`，返回 HTTP 202。响应包含 command ID 和当前
产品投影；202 只表示命令已接受，不表示 Hindsight 已完成。

| 操作 | 请求 |
| --- | --- |
| 提交自然语言纠正 | `POST /api/me/profile-memory/corrections`，`{text}` |
| 暂停 / 启用 | `PATCH /api/me/profile-memory/settings`，`{enabled:false}` / `{enabled:true}` |
| 重试当前失败命令 | `POST /api/me/profile-memory/operations/:commandId/retry` |
| 清除全部记忆 | `DELETE /api/me/profile-memory` |

纠正文本去首尾空白且不得为空，保留正文内部格式；纠正与普通对话记忆一起参与下次画像合成，
不直接改写已有条目。暂停拒绝新的 recall/append，但允许读取画像和提交纠正；清除即时把投影
置为 `erased` 并触发异步删除，完成后保持关闭。清除不能与旧代次的 Hindsight 访问并发。

重试只接受当前用户、当前 generation、尚未被后续同目标操作替代的失败命令，并创建新的 command ID。
运行时 receipt 仍在 processing/retryable 时，产品命令保持 admitted；只有 execution-control 确认
终态后，app-api 才写入 succeeded/failed。provider operation 的未知状态不能被当作安全失败来重试。

## 投递和失败语义

命令写入 app-api outbox 后由 execution-control 接纳。callback 仍用于及时更新投影，定时任务按
command ID 查询 receipt 作为补偿。callback 传输失败属于投影延迟，不改变已准入命令的运行事实。

运行时状态与产品投递状态分开处理：

- `pending_admission`：命令仍在 app-api outbox，尚未被 execution-control 接纳；
- `admitted`：execution-control 已接纳，运行时可能仍在处理；
- `failed`：运行时已确定失败，错误码可供用户重试；
- `succeeded`：内部终态，成功命令不会继续保留在公开 operations 列表中。

普通 memory 写入失败不关闭画像读取。生命周期命令失败时，即使产品投影已置为 `erased`，运行时
fence 仍会阻止该代次的 Hindsight 访问，直到生命周期命令成功重试，避免产品状态和 runtime
fence 分叉后继续调用 provider。清除命令失败后由 memory 定时任务自动重新入队重试；用户侧
重试接口语义不变。

## 内容和安全边界

管理读取、profile 合成、recall、append 和 erase 都由 execution-control 按当前用户、tenant-main
和 generation 执行。bank、租约、workflow 和 provider operation 标识不作为浏览器授权凭证，不进入
模型可见工具。个人记忆不能改变身份、授权、工具准入或机构知识证据要求。

删除或裁剪会话只修改聊天数据，不触发记忆清理；完整清除和账号注销才承诺删除长期记忆。暂停
保留 bank，恢复不重新导入历史消息。

实现所有者：`apps/app-api/src/modules/profile-memory/`、`apps/execution-control/internal/` 和
`apps/campus-web/src/features/profile-memory/`。运行时所有权与生命周期屏障见
[个人记忆架构](../../architecture/system/memory-plane.md)。
