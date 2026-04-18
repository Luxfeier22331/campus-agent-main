---
doc_type: decision
decision_id: ADR-0023
status: accepted
created: 2026-04-02
updated: 2026-04-03
---

# ADR-0023 Operator Observability Control Plane And Sink Participation

适用范围：protected panel 的 operator-facing observability / audit / quality / safety / cost domain ownership，以及 `Sentry`、`Axiom`、grading / eval tooling 的长期参与边界

## 背景

当前仓库已经具备以下事实：

- `apps/protected-panel-web` 已冻结为 `runtime APIs only` 的 protected Worker shell
- `apps/app-api` 已拥有 `runtime.request_execution`、`runtime.projection_outbox` 与 `operator.request_projection`
- `ADR-0010` 已冻结 observability stack：`OTel-first`、`Sentry` 负责错误/trace、`Axiom` 负责高吞吐结构化事件
- `ADR-0016` 已冻结 panel `Requests` 不得直接读取 audit log 或 telemetry sink

但仓库仍缺一条更完整的长期规则：

- operator-facing observability / audit / quality / safety / cost surface 由谁拥有
- `Sentry`、`Axiom` 与 sampled grading 到底如何参与
- panel 是否可以直接把 sink 当作 query backend

如果这条边界不冻结，后续很容易长出以下腐烂路径：

- panel 直接嵌入 `Sentry` 或 `Axiom` 查询，变成 sink viewer
- 继续只有 request list/detail，没有长期稳定的 quality / safety / cost control plane
- sampled grading、runtime aggregate、release-gate eval 混成一套 truth
- `apps/supervisor-api` 或 panel BFF 顺手长成 operator observability backend

## 决策 1：operator-facing observability control plane 的第一 owner 固定为 `apps/app-api`

结论：

- operator-facing observability / audit / quality / safety / cost read model 的第一 owner 固定为 `apps/app-api`
- `protected-panel-web` 继续只消费这些 runtime-owned APIs
- `apps/supervisor-api` 不承担 operator observability query backend

原因：

- `apps/app-api` 已拥有 request identity、principal、conversation correlation、request execution truth 与 operator projection 入口
- observability control plane 仍属于 shared application/control-plane concern，而不是 execution engine concern

## 决策 2：panel 的 observability 域固定为 curated control-plane domains，而不是 raw sink explorer

结论：

- 长期 operator observability domain 固定拆成：
  - `Overview`
  - `Requests`
  - `Quality`
  - `Safety/Authz`
  - `Cost`
  - `Audit`
  - `Official Web`
- 这些域都属于 curated control-plane read model
- 不把 panel 做成 raw log / trace / telemetry console

原因：

- protected panel 已冻结为受控 operator control plane，不是万能内部平台
- operator 需要的是解释清楚 request、quality、safety 与 cost，而不是直接暴露底层 sink 查询能力

## 决策 3：`Sentry`、`Axiom` 与其他 sink 都不是 panel canonical read model

结论：

- `Sentry`、`Axiom`、raw audit log、trace dump、OpenAI trace store 都不是 panel canonical read model
- 如果 operator-facing surface 需要消费某类 sink-derived truth，必须先经过 app-owned projection / aggregate seam

原因：

- 这能避免 panel truth 跟随 vendor schema 漂移
- 也能避免把生产 query surface 绑定成调试产品的视图

## 决策 4：`Sentry` 的长期职责固定为错误、trace 与请求级调试

结论：

- `Sentry` 负责：
  - exception / error aggregation
  - request tracing
  - dependency failure
  - release-aware debugging
  - AI / LLM span debugging
- `Sentry` 可以为 panel 提供 trace deep link
- `Sentry` 不承担高吞吐 operator aggregate truth 与 request list/detail truth

原因：

- `Sentry` 更适合 exception、performance tracing 与链路调试
- 它不是高吞吐事件仓，也不应该成为 panel 查询后端

## 决策 5：`Axiom` 的长期职责固定为高吞吐结构化运行分析

结论：

- `Axiom` 负责：
  - retrieval / citation / ACL / refusal / serving / ingestion 结构化事件
  - token usage 与 cost attribution trend
  - long-window aggregate、slice、cohort comparison、badcase slicing
- `Axiom` 不承担 panel canonical request list/detail truth
- `Axiom` 也不是唯一错误调试面

原因：

- 这类信号天然更适合高吞吐结构化事件分析产品
- 但 operator-facing control plane 仍需要 app-owned aggregate/read model 收口

## 决策 6：quality monitoring 固定拆成 online runtime monitoring、sampled grading、release-gate eval 三条线

结论：

- online runtime monitoring 负责 latency、failure、empty recall、citation coverage、refusal distribution、ACL anomaly、token / cost
- sampled grading 负责 grounding、citation correctness、clarification / refusal appropriateness、policy conformance
- release-gate eval 负责 benchmark / replay / regression hard gate
- 三条线不得静默混成同一套 truth

原因：

- 只看线上计数无法识别 workflow-level quality failure
- sampled grading 与 release-gate eval 的目标不同，retention、sampling 与解释口径也不同

## 决策 7：成本治理固定分成 near-real-time estimated cost 与 reconciled provider cost 两层

结论：

- operator panel 可以展示 request-level estimated cost 与 rollup trend
- 最终账务或 budget closure 以 provider-side reconciled cost 为准
- 不把仓库内静态价格表当作长期 canonical truth

原因：

- 运行时估算适合实时监控和异常发现
- 财务预算、对账和供应商账单应使用 provider 口径收口

## 决策 8：`Sentry` 字段模型固定拆成 searchable tags、request context 与 minimal deep link

结论：

- `Sentry` searchable tags 只保留 request-debugging 需要且长期可控的字段：
  - `trace_id`
  - `surface`
  - `route`
  - `status`
  - `selected_target`
  - `requested_capability`
  - `requested_scope_summary`
  - `principal_type`
  - `error_code`
  - `model_name`
  - `release`
  - `environment`
- `request_id` 不作为长期 searchable tag；它与下列高基数字段一起进入 request context / span attributes：
  - `request_id`
  - `conversation_id`
  - `entitlement_snapshot_id`
  - `policy_projection_version`
  - `acl_decision`
  - `acl_anomaly_code`
  - `fail_closed`
  - `duration_ms`
  - `retrieved_source_count`
  - `citation_count`
  - `citation_missing`
  - `projection_lag_ms`
- panel 只允许消费 app-owned 的最小回链信息，例如：
  - `trace_link`
  - `issue_link`
  - `issue_fingerprint`

原因：

- 这能保留 request-level debugging 所需的检索能力，同时避免把 `Sentry` 变成高基数 operator data store
- 也能避免 panel 对 `Sentry` 查询能力形成结构性依赖

## 决策 9：`Axiom` 事件治理固定为 `event_type -> allowlist`，黑名单只做兜底

结论：

- `Axiom` 事件发送长期采用 `event_type -> allowlist`
- 当前通用 forbidden-field blacklist 只作为最后一道数据最小化保险，不再充当主要治理机制
- 所有 `Axiom` 事件默认都应带统一 envelope：
  - `event_type`
  - `occurred_at`
  - `request_id`
  - `trace_id`
  - `surface`
  - `selected_target`
  - `requested_capability`
  - `requested_scope_summary`
  - `principal_type`
  - `status`
  - `error_code`
  - `environment`
  - `release`
- 当前接受的稳定事件族至少包括：
  - `request.accepted`
  - `request.finalized`
  - `request.transport_error`
  - `projection.enqueued`
  - `projection.drain`
  - `retrieval.summary`
  - `citation.summary`
  - `authz.decision`
  - `cost.usage`
  - `quality.sampled_grade`

原因：

- 事件级 allowlist 比全局黑名单更符合长期最小化与 schema 治理要求
- 这也能避免 sink payload 在后续演进中被随手扩张成半结构化 dump

## 决策 10：request-scoped observability facts 与 command truth 长期分表

结论：

- request-scoped observability facts 长期放入独立的 app-owned runtime fact family，接受命名为 `runtime.request_observability_fact`
- `runtime.request_execution` 继续只承担 command-side durable request truth
- `operator.request_projection` 继续只承担 panel `Requests` list/detail truth
- `runtime.request_observability_fact` 作为 `metric_rollup`、request observability detail、sampled grade join 与 cost reconciliation join 的输入层

原因：

- command truth 与派生观测事实的变更频率、字段密度和生命周期不同
- 分表更利于保持 `request_execution` 稳定，并避免 operator truth、command truth、sink truth 混层

## 决策 11：request observability 的写入生命周期固定沿 command path 一次产出，再按后继信号补强

结论：

- `accepted`
  - 写入 command truth
  - seed `request_observability_fact`
  - emit `request.accepted`
- `finalized`
  - 更新 command truth
  - upsert `request_observability_fact`
  - emit `request.finalized`
  - emit `retrieval.summary`
  - emit `citation.summary`
  - emit `authz.decision`
  - emit `cost.usage`
- `projection materialization`
  - 更新 projection lag / projection health 相关事实
  - emit `projection.enqueued` / `projection.drain`
- sampled grading 与 provider reconciled cost
  - 写入独立 projection / rollup / reconciliation path
  - 不反向污染 `runtime.request_execution`

原因：

- request observability 需要与 command truth 保持同一 request identity，但不应回退成“从 sink 事后反推”
- sampled grading 与 provider cost reconciliation 的到达时机更晚，也不适合回写 command truth

## 后果

直接结果：

- 需要新增 app-owned operator observability read-model family，例如 audit projection、metric rollup、quality grade projection
- 需要新增 app-owned runtime fact family，例如 `request_observability_fact`
- 需要为 `Quality` / `Safety/Authz` / `Cost` / `Audit` 增加 operator runtime APIs
- panel 后续扩展必须沿着这些 app-owned APIs 做，而不是 panel BFF 自己向 sink 查询
- `Sentry` tag/context 需要按长期可控字段重整
- `Axiom` sink 需要从黑名单治理升级到 `event_type -> allowlist`

明确不做：

- 不把 panel 做成 `Sentry` 或 `Axiom` 嵌入式 viewer
- 不让 `apps/supervisor-api` 继续长成 operator observability backend
- 不把 sampled grading / release-gate eval / runtime aggregate 混成一张表
- 不让 vendor-specific sink schema 反向定义 `packages/contracts`

当前状态说明：

- 本 ADR 只冻结 accepted direction
- 它不表示 operator observability control plane 已经在代码中完整实现

## 相关文档

- `docs/architecture/operator-observability-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/decisions/adr-0010-observability-and-telemetry-stack.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/data/app-api-schema.md`
