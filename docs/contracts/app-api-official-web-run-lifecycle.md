---
doc_type: contract
status: active
created: 2026-03-29
updated: 2026-03-29
---

# App API Official Web Run Lifecycle

## 文档边界

这份文档冻结 `official_web` crawl run 在 `apps/app-api` control plane 内的生命周期、状态流转、幂等规则与 ingestion handoff 语义。

它补充但不替代以下文档：

- control-plane 架构：`docs/architecture/official-web-architecture.md`
- HTTP contract：`docs/contracts/app-api-official-web-http.md`
- logical schema：`docs/data/app-api-official-web-schema.md`
- source-channel 总边界：`docs/architecture/official-web-architecture.md`

## Lifecycle Conclusion

长期 run lifecycle 固定为：

1. collector start admission
2. `app-api` durable 写入 crawl-run accepted fact
3. collector 上传 object-storage artifacts 并发送 heartbeat
4. collector finalize，`app-api` durable 写入 terminal state 与 artifact refs
5. `app-api` 发出 ingestion handoff event
6. ingestion worker 消费 handoff event 并开始 offline execution
7. operator 只通过 app-owned projections 查看 site/run/detail

这里冻结的重点是：

- crawl run truth 必须先进入 `app-api` durable ledger
- object storage artifacts 与 app-owned run ledger 共同构成 control-plane truth
- ingestion handoff 只能在 terminal finalize 之后发生
- panel 不能通过对象存储扫描、日志扫描或 ingestion worker 直连来补状态

## 状态模型

`official_web.crawl_runs.status` 第一版固定允许：

- `accepted`
- `running`
- `completed`
- `completed_with_errors`
- `failed`
- `abandoned`

状态语义：

| Status | Meaning |
| --- | --- |
| `accepted` | start 请求已 durable 接受，`runId` 已分配 |
| `running` | collector 正在执行，并且 heartbeat 仍在可接受窗口内 |
| `completed` | crawl 完整终结，并且 finalize 报告无 run-level failures |
| `completed_with_errors` | crawl 完整终结，但存在 URL / host / parser failures |
| `failed` | crawl 无法完成，或 finalize 以失败收口 |
| `abandoned` | `app-api` 在 heartbeat 超时后判定 run 已失活 |

补充约束：

- crawl status 与 ingestion status 必须分开建模
- `completed` / `completed_with_errors` 只表示 crawl finalize 成功，不表示 chunk/index 已完成

## Command-Side Sequence

### Step 1: Start Admission

collector 调用 `POST /api/official-web/runs`。

`app-api` 必须完成：

- service principal admission
- `siteId` 校验
- `schedulerRunKey` 幂等检查
- canonical `runId` 分配

如果此时失败：

- 直接返回 HTTP error
- 不创建 crawl-run durable record

### Step 2: Durable Accepted Fact

第一次 command-side commit 至少写入：

- `official_web.crawl_runs`
- 第一条 lifecycle outbox/event

最小 accepted 状态包括：

- `runId`
- `siteId`
- `schedulerRunKey`
- `collectorVersion`
- `configVersion`
- `status=accepted`
- `startedAt`

### Step 3: Heartbeats

collector 在 run 期间发送 heartbeat。

heartbeat 规则：

- 更新 `lastHeartbeatAt`
- 可以推进 `accepted -> running`
- 允许写入过程摘要计数
- 不得替代 terminal finalize

### Step 4: Finalize

collector 调用 finalize 时，`app-api` 至少写入：

- terminal crawl status
- terminal summary
- artifact refs
- ingestion handoff event

terminal finalize 规则：

- `completed`
  只在 run-level summary 无失败时允许
- `completed_with_errors`
  有 artifacts 且存在 URL/host/parser failures 时允许
- `failed`
  crawl 中止、run 失效或 terminal summary 无法收口时允许

### Step 5: Ingestion Handoff

handoff 规则固定为：

- 只能在 terminal finalize commit 之后触发
- outbox/queue payload 只携带 ingestion 所需的 run identity、site identity 与 artifact refs
- ingestion worker 消费 handoff 时再去对象存储读取 artifact 内容

第一版推荐链路：

`official_web.crawl_runs -> official_web.run_outbox -> ingestion-worker`

## 一致性规则

这里明确接受 eventual consistency：

- crawl run finalize 成功后，operator projection 可以短时间滞后
- ingestion handoff 已排队后，panel 仍可能短时间只看到 `queued`

这不是允许 panel 改去读：

- 对象存储目录
- `apps/ingestion-worker` 内部状态
- telemetry sink
- raw logs

## 幂等规则

### Start Idempotency

幂等范围固定为：

- `siteId + schedulerRunKey`

重放规则：

- payload fingerprint 相同
  返回既有 `runId`
- payload fingerprint 不同
  返回 `409 idempotency_conflict`

### Finalize Idempotency

同一 `runId` 的 finalize：

- terminal payload 相同
  返回既有 terminal state
- terminal payload 冲突
  返回 `409 run_already_finalized`

### Heartbeat Ordering

同一 `runId` 的 heartbeat：

- `sequence` 必须单调递增
- 过旧 heartbeat 可丢弃或返回冲突

## Heartbeat Timeout Rule

`accepted` 或 `running` 的 run 在超过声明阈值后可被标记为 `abandoned`。

固定约束：

- `abandoned` 只能由 app-owned control plane 标记
- `abandoned` 不代表对象存储 artifacts 必须删除
- 如果 collector 事后尝试 finalize abandoned run，必须按显式冲突或显式恢复策略处理，而不是静默覆盖

## Failure Boundary

这里必须区分三类失败：

- pre-accept failure
  没有 durable run truth
- crawl terminal failure
  有 run truth，但 run 以 `failed` 收口
- downstream ingestion failure
  crawl 已完成，但 handoff 之后的 ingestion 执行失败

operator query surface 需要能把这三类边界分清，而不是折叠成一个“失败”标签。

## Non-Goals

- 不在本文定义 queue vendor 或 cron 平台
- 不在本文设计 collector 内部 frontier persistence
- 不让 ingestion worker 反向拥有 crawl-run lifecycle truth
