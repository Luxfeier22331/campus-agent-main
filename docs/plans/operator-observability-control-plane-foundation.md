---
doc_type: plan
status: deferred
created: 2026-04-02
updated: 2026-04-12
---

# Operator Observability Control-Plane Foundation

## 文档边界

本文只负责 operator observability control plane 的前向实施 handoff。

本文不负责：

- 替代 `docs/architecture/operator-observability-architecture.md` 的长期边界
- 替代 `ADR-0023` 的 ownership / sink participation 决策
- 固定某个 dashboard 的视觉细节

## 当前生命周期状态

- 本文仍代表被接受的 operator observability productization 方向，但当前没有独立 active execution wave 按本文整包推进
- 当前 repo 的默认 active lane 是 Phase 15；其中与 observability expansion 直接相关的工作，应以 `docs/plans/hallucination-governance-and-grounded-generation-execution-plan.md` 与 `.planning/phases/15-grounded-generation/` 为准
- 如需恢复完整 control-plane 扩面，应在 `.planning/PROJECT.md` / `.planning/STATE.md` 中显式重开执行面，而不是把本文误读成当前 handoff

## 目标

把 protected panel 从“只有 request list/detail 的 operator shell”推进到具备 audit、quality、safety、cost 基础控制面的长期正确形态，同时保持：

- panel 继续只读 runtime APIs
- `apps/app-api` 继续是 operator read-model owner
- `Sentry` / `Axiom` 继续只是 sink，不反向变成 panel truth

## 实施问题

这份文档只回答六个问题：

- app-owned observability read model 要补哪几类
- 哪些字段属于 request-scoped observability foundation
- 哪些 operator APIs 应先落地
- panel 页面应按什么顺序扩展
- `Sentry` / `Axiom` / grading 如何参与
- 需要什么验证证据

## 已冻结默认值

本轮已确认以下默认值，不再继续作为开放问题：

- `Sentry`
  - `trace_id` 保留为 searchable correlation key
  - `request_id` 进入 context / span attributes，不作为长期 searchable tag
- token / model facts
  - 必须来自 execution-side typed telemetry seam
  - 不由 panel、`Axiom` 或其他下游 query path 反推
- `retrieval_attempted`、`citation_expected`、`acl_decision`
  - 必须来自显式 execution outcome 或 typed telemetry seam
  - 不采用 panel-side 或 sink-side 启发式推断

## 实施顺序

### Wave 1：Request-Scoped Observability Foundation

在 `apps/app-api` 内补齐 request-scoped observability facts，至少覆盖：

- retrieval attempted / source count
- citation expected / citation count / citation missing
- refusal class
- ACL decision summary / anomaly code / fail-close marker
- token usage / estimated cost
- projection lag / trace presence

要求：

- request identity 继续与 `request_id` / `trace_id` 对齐
- 不把 raw prompt、raw answer、raw transcript、raw auth material 写入这些字段

建议最小 family：

- `runtime.request_observability_fact`

建议最小字段：

- `request_id`
- `trace_id`
- `conversation_id`
- `surface`
- `principal_type`
- `entitlement_snapshot_id`
- `policy_projection_version`
- `requested_capability`
- `requested_scope_summary`
- `selected_target`
- `status`
- `error_code`
- `started_at`
- `completed_at`
- `duration_ms`
- `retrieval_attempted`
- `candidate_count`
- `retrieved_source_count`
- `empty_recall`
- `citation_expected`
- `citation_count`
- `citation_missing`
- `refusal_class`
- `acl_decision`
- `acl_anomaly_code`
- `fail_closed`
- `model_provider`
- `model_name`
- `input_tokens`
- `output_tokens`
- `cached_input_tokens`
- `estimated_cost_microusd`
- `trace_available`
- `projection_lag_ms`
- `measured_at`
- `updated_at`

建议最小索引：

- `(started_at desc)`
- `(status, started_at desc)`
- `(surface, started_at desc)`
- `(selected_target, started_at desc)`
- `(principal_type, started_at desc)`
- `(model_name, started_at desc)`
- partial `(acl_anomaly_code, started_at desc)` where anomaly is present

建议写入规则：

- `accepted`
  - write command truth
  - seed `request_observability_fact`
  - emit `request.accepted`
- `finalized`
  - update command truth
  - upsert `request_observability_fact`
  - emit `request.finalized`
  - emit `retrieval.summary`
  - emit `citation.summary`
  - emit `authz.decision`
  - emit `cost.usage`
- `projection materialization`
  - update `projection_lag_ms` / projection health
  - emit `projection.enqueued` / `projection.drain`
- sampled grading / provider reconciled cost
  - write separate projection / rollup path
  - do not mutate `runtime.request_execution`

### Wave 2：Audit Projection

新增 app-owned audit projection，支持 panel `Audit` 域最小时间线：

- principal / entitlement snapshot summary
- selected target / requested capability
- retrieval / deny / approval / fail-close markers
- terminal reason code

要求：

- 这是 curated audit timeline，不是 raw JSONL replay
- 不允许 panel 直连现有 file-backed audit sink

### Wave 3：Metric Rollup And Aggregate APIs

新增 app-owned aggregate family，至少支持：

- `Overview`
- `Quality`
- `Safety/Authz`
- `Cost`

优先 API：

- `GET /api/operator/overview`
- `GET /api/operator/quality/summary`
- `GET /api/operator/quality/timeseries`
- `GET /api/operator/safety/summary`
- `GET /api/operator/cost/summary`
- `GET /api/operator/audit`
- `GET /api/operator/audit/:id`

要求：

- 聚合结果由 app-owned rollup 生成
- 不让 panel BFF 直接向 sink 发查询

### Wave 4：Panel Domain Expansion

`apps/protected-panel-web` 按以下顺序扩展：

1. `Overview` 指标卡与告警摘要
2. `Requests` detail 增加 trace link、audit summary、quality summary
3. `Quality`
4. `Safety/Authz`
5. `Cost`
6. `Audit`

要求：

- 仍通过 panel-local `/api/*` 调用 `app-api`
- 仍不把 `Jobs` / `Operations` 自动扩成 generic infra console

### Wave 5：Sink Participation And Grading Backflow

在不改变 ownership 的前提下补齐 sink participation：

- `Sentry`
  - trace continuity
  - error / dependency / latency debugging
  - request-level deep link
- `Axiom`
  - structured runtime events
  - retrieval / citation / ACL / token / cost trend
  - badcase slicing 输入
- sampled grading / eval
  - 输出写回 app-owned quality grade projection，而不是让 panel 直接读 grader 原始结果

`Sentry` 字段模型建议冻结为：

- searchable tags
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
- request context / span attributes
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
- panel-facing minimal deep link projection
  - `trace_link`
  - `issue_link`
  - `issue_fingerprint`

`Axiom` 事件治理建议冻结为：

- governance rule
  - `event_type -> allowlist`
  - global forbidden-field blacklist remains last-resort guard only
- common event envelope
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
- stable event families
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

建议事件专属字段：

- `request.accepted`
  - `conversation_id`
  - `actor_id_hash`
- `request.finalized`
  - `conversation_id`
  - `duration_ms`
  - `retryable`
  - `source_doc_ids_count`
- `request.transport_error`
  - `conversation_id`
  - `retryable`
- `projection.enqueued`
  - `conversation_id`
  - `projection_stage`
- `projection.drain`
  - `projector_name`
  - `processed_count`
  - `failed_count`
  - `abandoned_count`
  - `projector_last_error_code`
- `retrieval.summary`
  - `retrieval_attempted`
  - `candidate_count`
  - `retrieved_source_count`
  - `retrieval_latency_ms`
  - `empty_recall`
- `citation.summary`
  - `citation_expected`
  - `citation_count`
  - `citation_missing`
  - `source_doc_ids_count`
- `authz.decision`
  - `entitlement_snapshot_id`
  - `policy_projection_version`
  - `visibility_scope`
  - `applicability_scope`
  - `acl_decision`
  - `acl_anomaly_code`
  - `fail_closed`
- `cost.usage`
  - `model_provider`
  - `model_name`
  - `input_tokens`
  - `output_tokens`
  - `cached_input_tokens`
  - `estimated_cost_microusd`
- `quality.sampled_grade`
  - `grade_type`
  - `grade_label`
  - `grade_score`
  - `grader_version`
  - `rationale_summary`

## 推荐数据面

长期建议至少形成以下 family：

- `runtime.request_execution`
- `runtime.request_observability_fact`
- `operator.request_projection`
- `operator.request_audit_projection`
- `operator.metric_rollup`
- `quality.trace_grade_projection`

这里的关键目标不是一次把所有字段都做完，而是先冻结 family 和 ownership，再分波补字段。

当前继续向前推进时，新增 family 固定为：

- `operator.quality_grade_projection`
- `operator.trace_backlink_projection`

它们分别承担：

- sampled grading / reviewer truth 的 app-owned 回流面
- panel-safe sink backlink 的 app-owned 回流面

它们都不允许退化成：

- panel 直连 grader / sink 的 query passthrough
- raw grader payload / raw sink blob dump

## 当前执行补充：Grade Projection And Backlink Projection

在已完成 `request_observability_fact`、`request_audit_projection`、`metric_rollup`、`quality_badcase_projection` 的基础上，下一波最小前向实现固定为：

### `operator.quality_grade_projection`

职责：

- 接住 sampled trace grading / eval tooling 的回流结果
- 作为 `quality summary.sampledGrades`、`quality timeseries.sampledGroundingPassRate`、`quality badcases.grade` 的唯一 app-owned 上游

写入规则：

- 不回写 `runtime.request_execution`
- 不把 grader sink 结果直接暴露给 panel
- 每条 grade 必须与单个 `request_id` 对齐
- grade 维度至少拆成 `grounding`、`citation`、`policy`
- 第一版只接受一条 request / source / domain 的最新 grade projection；重复到达通过 stable id upsert 覆盖

字段最小化：

- 允许 `request_id`、`trace_id`、`surface`、`request_started_at`、`selected_target`
- 允许 `requested_capability`、`principal_type`、`collection`、`model_name`
- 允许 `grade_source`、`grade_domain`、`verdict`、`score`、`grader_version`
- 允许 `sampled_at`、`projected_at`
- 允许 `rationale_summary`
- 不允许 raw prompt、raw answer、raw grader transcript、raw span payload

### `operator.trace_backlink_projection`

职责：

- 接住 `Sentry` / sink reconciliation 后的 panel-safe deep link
- 作为 request observability detail、audit detail、quality badcase queue 的 `links.*` 上游

写入规则：

- 一条 request 最多一条 backlink projection
- `trace_link`、`issue_link`、`issue_fingerprint` 允许为空
- 只保存安全 deep link / fingerprint，不保存 raw issue JSON 或 raw trace payload

### Internal Ingest Seam

`app-api` 需要一个受 internal shared secret 保护的 app-owned command seam，用于写入：

- quality grades
- trace backlinks

当前前向默认 workflow 约束：

- release-gate / acceptance eval 应优先直接消费 final `run-XX-case-results.json` 内嵌的 `request_correlation`
- 仅在历史 artifact 仍缺 inline correlation 时，才继续传外部 correlation manifest
- publish summary / evidence 应落回 acceptance artifact root，避免 release 证据与 app-owned 回流结果脱节

边界规则：

- 这是 internal producer -> `app-api` 的写入 seam，不是 browser-facing API
- 它只接受最小 payload，并优先通过 `request_observability_fact` 回填 request 维度
- 它的存在是为了保持 `panel -> app-api` 与 `sink/grader -> app-api projection` 两条链路分离，而不是给 panel 新增 side door

## 验证闭环

至少验证以下五类证据：

- request-level truth
  - request / trace correlation、request detail 与 aggregate 一致
- trace continuity
  - `protected-panel-web -> app-api` 与 `public-chat-web -> app-api` 继续贯通
- sink minimization
  - `Sentry` / `Axiom` 不出现 raw prompt、raw answer、JWT、cookie、operator email、transcript
- quality metrics correctness
  - empty recall、citation miss、refusal、ACL anomaly、cost 口径样本可解释
- panel ownership correctness
  - panel 只通过 `app-api` runtime APIs 获取 observability domain

## 推荐验证命令

Python baseline:

```bash
uv run --all-packages python -m unittest discover -s tests -t .
```

JS/TS baseline:

```bash
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:test:integration
pnpm web:build
```

deploy-side observability verification：

- 继续以 `docs/runbooks/worker-observability-smoke-runbook.md` 为准

## 当前不做

- 不在本轮做 raw sink query UI
- 不在本轮新增 generic Operations console
- 不在本轮把 release-gate eval 结果直接混进 runtime aggregate truth
- 不在本轮把 provider pricing table 写死成 repo canonical cost truth
