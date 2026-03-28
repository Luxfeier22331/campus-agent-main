---
doc_type: contract
status: active
created: 2026-03-28
updated: 2026-03-28
---

# App API Request Lifecycle

## 文档边界

这份文档冻结 `POST /api/chat/requests` 的生命周期、幂等规则、状态流转，以及 request projection 如何进入 operator read model。

它补充但不替代以下文档：

- 产品层 HTTP contract：`docs/contracts/app-api-http.md`
- `app-api -> supervisor-api` 契约：`docs/contracts/app-api-supervisor-execution.md`
- error model：`docs/contracts/app-api-error-model.md`
- 数据模型：`docs/data/app-api-schema.md`
- request projection ownership：`docs/architecture/request-projection-and-runtime-read-model.md`

## Lifecycle Conclusion

长期请求链路固定为：

1. `app-api` 解析 session / trusted operator identity
2. 校验 conversation ownership 与请求体
3. 生成 canonical `requestId` 与 `traceId`
4. 在 command boundary durable 写入 `runtime.request_execution`
5. 调用 `apps/supervisor-api`
6. 写回最终 execution outcome，并产出 `runtime.projection_outbox`
7. projector 在同一 `app-api` boundary 内物化 `operator.request_projection`
8. panel 只通过 `GET /api/operator/requests*` 读取 projection

这里冻结的重点是：

- durable request facts 必须在 `app-api` command path 内产生
- projection read model 可以异步物化
- panel 不得通过同步回放 answer execution 来补 operator query

## State Model

`runtime.request_execution.status` 第一版固定允许：

- `accepted`
- `completed`
- `needs_clarification`
- `no_answer`
- `error`

状态语义：

| Status | Meaning | Chat-visible result |
| --- | --- | --- |
| `accepted` | 请求已 durable 接受，但最终执行结果尚未写回 | 无；仅内部短暂状态 |
| `completed` | 返回 grounded answer | `answer` |
| `needs_clarification` | 返回追问问题 | `clarification` |
| `no_answer` | 安全地无法给出 grounded answer | `no_answer` |
| `error` | 请求被接受，但执行或依赖失败 | `error` |

第一版不强制单独暴露 `running` 状态。

## Command-Side Sequence

### Step 1: Admit

`app-api` 完成：

- session / principal lookup
- conversation ownership 校验
- prompt normalize
- `Idempotency-Key` 校验
- canonical `requestId` / `traceId` 分配

如果此时失败：

- 直接返回 HTTP error envelope
- 不创建 `runtime.request_execution`

### Step 2: Durable Request Record

在第一次 command-side commit 中至少写入：

- `chat.messages` user message
- `runtime.request_execution`

此时最小状态为：

- `status=accepted`
- 已记录 `requestId`、`traceId`
- 已绑定 conversation / actor snapshot / requested scope

### Step 3: Execute

`app-api` 使用内部 execution contract 调用 `apps/supervisor-api`。

该调用：

- 不暴露给 browser
- 不回写 panel projection
- 只返回 typed execution outcome

### Step 4: Finalize

第二次 command-side commit 至少写入：

- assistant message 或 safe failure message
- `runtime.request_execution` 最终状态
- `runtime.projection_outbox` 事件

最终状态写回规则：

- `completed` 写 `answer_text` 摘要与 source identifiers
- `needs_clarification` 写 follow-up question 摘要
- `no_answer` 写 safe no-answer 摘要
- `error` 写 error code / retryable

## Projection Rule

projection 的长期规则固定为：

- canonical truth 先进入 `runtime.request_execution`
- panel-facing read model 不直接由 chat response body 拼装
- `operator.request_projection` 通过 `runtime.projection_outbox` 物化

推荐链路：

`runtime.request_execution -> runtime.projection_outbox -> projector -> operator.request_projection`

实现说明：

- projector 可以是 Queue consumer、scheduled projector 或 Worker 内异步消费者
- 但它必须仍属于 `app-api` boundary
- panel 查询不等待 projector 完成

## Consistency Rule

第一版明确接受 eventual consistency：

- chat response 可以先成功返回
- panel list/detail 可以短时间内看不到刚完成的请求
- 这不是让 panel 反查 `runtime.request_execution`、JSONL audit、telemetry sink 或 `apps/supervisor-api` 的理由

## Idempotency Rule

### Scope

`Idempotency-Key` 只适用于：

- `POST /api/chat/requests`

### Storage Rule

第一版在 `runtime.request_execution` 上至少保存：

- `idempotency_key`
- `request_fingerprint_sha256`
- `request_id`

唯一性范围固定为：

- `actor_user_id + idempotency_key`

### Replay Rule

如果收到同一个 `Idempotency-Key`：

- fingerprint 相同且原请求已完成
  返回原始结果
- fingerprint 相同但原请求仍停留在 `accepted`
  返回 `409 request_in_progress`
- fingerprint 不同
  返回 `409 idempotency_conflict`

`requestId` 不是幂等键。

它的职责只是：

- correlation
- panel / operator 可见 request identity
- user support reference

## Error Boundary Rule

这里固定区分两类错误：

- pre-accept error
  使用 HTTP error envelope
- post-accept execution error
  使用 `200 + result.kind=error`

原因：

- 一旦请求已经 durable 接受，必须保留 `requestId`
- 用户和 operator 需要能关联这次失败
- panel request projection 也需要看到这次失败请求

## Non-Goals

- 不把 panel detail 变成 execution replay 接口
- 不要求 chat response 同步等待 projection materialization
- 不用 raw log 或 telemetry sink 替代 outbox / read model
