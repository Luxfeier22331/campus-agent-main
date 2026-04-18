---
doc_type: plan
status: deferred
created: 2026-04-02
updated: 2026-04-19
---

# Operator Observability Control-Plane Foundation

## 文档边界

本文固定 `operator observability / control-plane` 这条单一 workstream 的前向范围：

- `apps/app-api` owned request-scoped observability fact
- app-owned audit projection、quality/safety/cost rollup 与 operator APIs
- `protected-panel-web` 的 `Overview / Requests / Quality / Safety/Authz / Cost / Audit` 扩面
- `Sentry` / `Axiom` / sampled grading 的 sink participation 与 app-owned 回流
- planning closeout 与 operator control-plane 当前真相更新

本文不负责：

- 替代 `docs/architecture/operator-observability-architecture.md` 的长期边界
- 替代 `ADR-0023` 的 ownership / sink participation 决策
- 固定某个 dashboard 的视觉细节
- 把 panel 变成 raw sink explorer、trace console 或数据库查询台
- 把 `shared product surfaces acceptance / hardening` 的现有三端验收，和这条 control-plane 扩面混成同一条 workstream

## 当前生命周期状态

- 当前状态是 `deferred`
- 当前只是明确入口，不表示 operator control-plane 已恢复扩面执行
- 它可以与其他独立 workstreams 并行存在；但这条线内部保持固定顺序，不再拆成并发 lane
- 当前 repo 的默认 active lane 不包含这条 control-plane 扩面；其中仅与已开放 surface 验收直接相关的 observability 维护，继续留在对应 active workstream 内

## 直接结论

operator observability expansion 不应拆成多条并发 workstream。

它必须作为一条 `operator observability / control-plane` workstream 推进，固定顺序如下：

1. request-scoped observability foundation
2. audit projection
3. metric rollup and aggregate APIs
4. panel domain expansion
5. sink participation and grading backflow
6. planning closeout

原因固定为：

- request observability fact、aggregate API、panel 新域与 sink participation 共享同一 app-owned operator truth
- 如果把 `app-api` observability fact、panel 扩面、sink participation 拆成多条 lane，容易让 panel 回退成 sink viewer，或让 app-owned read model 永远停在半开状态
- 这条线的目标不是“修当前已开放 surface”，而是新增一整条 operator product/control-plane 扩面，验收口径与 `shared product surfaces` 不同

## 前置真相

接手这条线之前，先以以下文档为准：

- `docs/architecture/operator-observability-architecture.md`
- `docs/decisions/adr-0010-observability-and-telemetry-stack.md`
- `docs/decisions/adr-0023-operator-observability-control-plane-and-sink-participation.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`

## 固定执行规则

- `apps/app-api` 持续是 operator-facing observability read-model owner；panel 不得绕回 raw audit log、telemetry sink 或 `apps/supervisor-api`
- `Sentry`、`Axiom`、grading/eval 只作为 sink 或回流输入，不得直接成为 panel canonical truth
- `Requests` 当前已开放 surface 的稳定化，仍属于 `shared product surfaces`；只有当目标扩成 `Overview / Quality / Safety/Authz / Cost / Audit` 时，才属于这条 workstream
- 同一条 workstream 内禁止把 `app-api` observability fact、aggregate API、panel domain、sink participation 拆成并发 lane
- 如果扩面过程中发现某个问题只是当前 product surface 验收 defect，应回到 `shared product surfaces` 或当前 owner seam 修复，而不是在 control-plane 线内堆兼容层

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
