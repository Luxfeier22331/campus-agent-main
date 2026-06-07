---
doc_type: contract
status: active
created: 2026-03-28
updated: 2026-06-04
---
# App API Supervisor Execution Contract

## 文档边界

这份文档冻结 shared `apps/app-api` 调用 `apps/execution-control` 的内部执行契约。

它补充但不替代以下文档：

- shared product topology：`docs/architecture/system/product-runtime-architecture.md`
- `app-api` runtime 边界：`docs/architecture/system/product-runtime-architecture.md`
- supervisor execution engine
  边界：`docs/architecture/system/execution-and-agents-architecture.md`
- capability routing / admission supporting
  truth：`docs/architecture/system/capability-routing-and-admission-architecture.md`
- 产品层 HTTP contract：`docs/contracts/app-api-http.md`
- request lifecycle：`docs/contracts/app-api-request-lifecycle.md`
- durable agent runtime contract：`docs/contracts/durable-agent-runtime-contract.md`
- execution admission
  ownership：`docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- capability-neutral routing 与 surface capability policy：`docs/decisions/adr-004
  2-capability-neutral-supervisor-routing-and-surface-capability-policy.md`

这份文档不冻结：

- `packages/contracts` 中 agent payload 的全部字段
- execution engine runtime 必须采用哪种 Python/HTTP 框架
- Docker 镜像构建细节、容器编排平台与 repo-level staging hostname
- public entry Worker 对 `apps/execution-control` 的现有 Cloudflare ingress contract

## Machine-Readable Contract Source

`app-api -> execution-control -> supervisor-agent-worker` 的 execution /
bridge wrapper 以机器可读 schema 为 canonical source：

- `docs/contracts/schemas/supervisor-execution.openapi.yaml`：OpenAPI 3.1.1 +
  JSON Schema 2020-12，冻结 internal supervisor execution request / response、
  bridge v6 envelope、runtime decisions summary 与 workflow trace summary 的 wire shape
- `scripts/generate_supervisor_execution_contracts.py`：从上述 schema 生成三种 runtime
  artifact
- `apps/app-api/src/modules/integration/generated/supervisor-execution-contract.ts`：Worker
  adapter 消费的 TS wire enum / interface
- `apps/execution-control/internal/contracts/supervisor_execution_contract.go`：Go
  execution runtime 消费的 bridge version、response contract 与 wire DTO
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/generated/supervisor_execution_contract.py`：
  Python private semantic worker 消费的 Pydantic DTO

生成物必须通过以下命令保持同步：

```bash
pnpm contracts:check
```

这条 check 已接入 `multi-agent-runtime-contract` eval gate。凡是修改 schema、bridge
version、runtime decision schema version、status enum 或 terminal response shape，都必须先更新
canonical schema，再重新生成 artifact。

`packages/contracts/schemas/agent-handoff.v1.schema.json` 只冻结 supervisor -> agent
handoff 的 `AgentRequest` / `AgentResponse`。它不承载 `runtime_decisions`、
`supervisor_bridge_v6` 或具体 transport wrapper，避免把 execution runtime truth 泄漏进共享
agent contract 包。

Run projection compatibility note：

- 本文冻结的是 current internal execution transport / bridge wrapper
- `docs/contracts/durable-agent-runtime-contract.md` 冻结 forward production run /
  event / lease contract
- run projection cutover 不能通过在本 schema 中塞入 vendor queue、worker process
  state 或 transient stream state 来替代 run store

## Strict Wire Policy

internal execution seam 只接受 canonical `snake_case` JSON。

固定规则：

- `supervisor-execution.openapi.yaml` 是 `app-api -> execution-control ->
  supervisor-agent-worker` wrapper 的唯一 schema truth；TS / Go / Python 生成物只能从它派生
- `app-api` adapter 必须 strict parse supervisor response；`200` body 如果出现 camelCase
  top-level field、未知 top-level field、非法 enum 或缺少必需字段，按
  `supervisor_invalid_response` transport/protocol failure 处理
- Go `execution-control` 与 Python bridge 对 bridge v6 envelope 也必须 strict decode；缺少
  `runtime_decisions`、`handoff.agent_request`、非法 `bridge_version`、非法 enum 或未知
  canonical wrapper 字段都 fail-closed
- browser / panel / public product API 可以继续使用产品层 camelCase projection，但不能把
  camelCase 反向带入 internal supervisor wire
- panel 只能消费 `app-api` 物化后的 sanitized request / workflow trace projection；即使 projection
  里误带 raw bridge/provider/prompt key，panel formatter 也必须 drop 这些字段

这条规则由 `tests/fixtures/supervisor_execution_contract/` 的 valid / invalid
fixture matrix 跨 Python、Go 与 TypeScript 一起验证。

## Versioning Policy

`x-campus-contract` 中的以下字段是可机器读取的版本治理口径：

- `bridge_version`：bridge envelope 出现不兼容 shape 变化时必须 bump
- `response_contract`：`AgentResponse` / terminal response wire 语义出现不兼容变化时
  必须 bump
- `runtime_decisions_schema_version`：`runtime_decisions` shape 或 required provenance
  变化时必须 bump
- `runtime_decision_summary_schema_version`：operator / eval 消费的 runtime decision
  summary shape 变化时必须 bump
- `workflow_trace_summary_version`：sanitized workflow trace summary 的 operator-visible
  shape 变化时必须 bump

修改这些字段或对应 shape 时，必须同步：

- 更新 `docs/contracts/schemas/supervisor-execution.openapi.yaml`
- 运行 `pnpm contracts:generate` 或至少通过 `pnpm contracts:check`
- 更新共享 fixture matrix 中的 canonical valid / invalid 样本
- 更新 `multi-agent-runtime-contract` gate 或对应 targeted tests

`runtime_decisions.workflow_plan` 是 planner 的 safe projection，当前
`schema_version=workflow-plan-v1`。它只记录 workflow mode、step / edge skeleton、
terminal policy、resume policy 与 semantic retry policy；真实 delegate payload 仍只通过
`runtime_decisions.handoff.agent_request` 进入 Python bridge。当前 runtime 可发出
`terminal`、`single_step`，以及受 gate 保护的 `multi_step`。
首条 live `multi_step` path 是 selected notice context + knowledge follow-through：
`notice-agent internal selected notice resolve
(payload_kind=campus_notice_get) -> rag-agent retrieval.query`。notice step 输出会被
`execution-control` 投影成 canonical `StepOutputProjection`，再输入后续 RAG step；
`workflow_plan.edges[].required_projection_kind` 声明跨 step 输入要求。operator / eval
可见的 `workflow_trace_summary.context_projections` 只包含 sanitized projection summary：
`projection_id`、`source_step_id`、`projection_kind`、`content_hash` 与 `safety`，不包含
notice 正文 payload。该 path 必须配置 workflow run store；completed `multi_step` trace
至少包含两个 handoff。semantic retry/replan 与 resumable resume 仍不是当前 public
contract 承诺。

## 设计原则

长期执行链路固定为：

`public-chat-web -> app-api -> execution-control -> supervisor-agent-worker -> agent`

这里的关键规则只有三条：

- browser 永远不直接使用这份 contract
- `app-api` 负责产品层 auth/session/principal mapping，并把 execution-side `actor` 显式传给
  `execution-control`
- `execution-control` 继续只是 execution engine，只做 internal caller admission，不重新吸收产品层
  auth/session/conversation
- `execution-control` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service；这不改变本文冻结的 request/response 语义

## Transport Conclusion

当前固定使用 dedicated internal execution endpoint：

- `POST /internal/execution/runs`
- `GET /internal/execution/runs/:runId`
- `GET /internal/execution/runs/:runId/events`
- `POST /internal/execution/runs/:runId/cancel`
- `POST /internal/execution/cancel`
- `GET /healthz`
- `GET /readyz`

retired legacy answer transport 已从 active `app-api -> execution-control`
submit path 退役；它不得作为 runtime fallback、smoke shortcut 或兼容双路径恢复。
Forward canonical seam 是 `app-api -> execution-control` 的 internal execution
run command/query contract，不是 browser-facing public API。

JSON 命名保持 `snake_case`，原因如下：

- 当前 `apps/execution-control` 已以 shared `SupervisorRequest` /
  `SupervisorResponse` model 为 wire truth
- 这里是 internal execution seam，不是 browser product API
- 这样可以减少 `app-api -> execution-control` 之间的翻译噪音

## Streaming Lifecycle Endpoint

产品级 streaming 由 `app-api` 读取 sanitized run projection / event stream 后对 browser
输出。`execution-control` 不再提供 active answer SSE endpoint。

固定事件：

- `execution.started`
- `execution.queued`
- `execution.running`
- `execution.completed`
- `execution.failed`
- `execution.cancelled`

固定规则：

- `app-api` browser SSE response 一旦进入 stream，status 固定为 `200`；terminal failure /
  cancel 的真实 `http_status`、`outcome`、`error`、`retryable` 必须放在 event `data`
  中
- `execution.completed` 的 `data.response` 承载 app-api product-safe response object，并注入
  `trace_id`
- `execution.failed` / `execution.cancelled` 的 `data.error` 承载 stable
  `{ code, message, retryable }`
- 不承诺 token-level delta、partial answer、tool trace replay 或 browser 直连
- `app-api` 不读取 Temporal history，也不把 raw execution-control / Temporal event
  直接暴露给 browser；它只读取 PG projection / event rows
- 产品层 auth、session、request projection、terminal answer shape 与 duplicate-submit UX
  仍归 `app-api` / web surface 所有

## Required Request Headers

- `content-type: application/json`
- `x-trace-id: <trace-id>`
- `x-worker-origin-auth: <shared-secret-or-equivalent>`
- optional Cloudflare Access service token headers when the Docker supervisor
  ingress is Access-protected:
  - `CF-Access-Client-Id: <client-id>`
  - `CF-Access-Client-Secret: <client-secret>`

规则：

- `x-trace-id` 由 `app-api` 生成并负责透传
- `x-worker-origin-auth` 是 execution-side internal caller admission 头；`app-api`
  第一版可以直接复用这个名字
- `cf-access-jwt-assertion` 不是 shared `app-api` 调用 `execution-control` 的长期 contract
  一部分
- Cloudflare Access service token 只保护 machine ingress，不替代 `x-worker-origin-auth`
  这层 app-level shared secret

## Cancellation Endpoint

`POST /internal/execution/cancel` 是 execution-side internal endpoint，只允许
`app-api` 这类 trusted internal caller 使用，不暴露给 browser。

请求头继续复用：

- `content-type: application/json`
- `x-worker-origin-auth: <shared-secret-or-equivalent>`

请求体固定为：

```json
{
  "request_id": "req_01HQ...",
  "reason": "user_requested"
}
```

响应语义：

- active execution 返回 `202`，body 中 `status=cancel_requested`
- Go `apps/execution-control` 会在 body 中附带 `bridge_cancel_status`，取值为 `accepted`、
  `not_found`、`not_configured` 或 `failed`；该字段只表示 Go -> Python
  cooperative cancel signal 的投递结果，不改变 `app-api` 对 cancel request 的
  canonical lifecycle 判断
- 找不到 active execution 返回 `404 execution_not_found`
- 鉴权失败返回 `401 unauthorized`
- malformed request 返回 `400 invalid_request`

当前取消语义保证 Go `apps/execution-control` 停止等待、释放 execution admission slot，
并把 lifecycle 标记为 `cancel_requested` / `cancelled`。Python bridge 已提供
`/internal/bridge/execution/cancel` 并记录 active request id 的 cooperative cancel
state；默认 supervisor orchestration 会在路由、prompt composition、agent
delegation 和 finalization 前后检查该状态，并以 `499 execution_cancelled` 终止。
已经进入阻塞 provider / prompt executor HTTP 调用的工作仍不承诺 hard-abort。

## Bridge Circuit Breaker

Go `apps/execution-control` 拥有 Python bridge transport / protocol health 的 circuit
breaker。

配置项：

- `EXECUTION_CONTROL_BRIDGE_BREAKER_FAILURE_THRESHOLD`：默认 `5`
- `EXECUTION_CONTROL_BRIDGE_BREAKER_OPEN_MS`：默认 `10000`
- `EXECUTION_CONTROL_BRIDGE_RETRY_MAX_ATTEMPTS`：默认 `2`
- `EXECUTION_CONTROL_BRIDGE_RETRY_BASE_MS`：默认 `50`

语义：

- 连续 bridge timeout / unavailable / invalid envelope 达到阈值后，circuit 进入 `open`
- `open` 期间 answer path fail fast，返回 `503 supervisor_bridge_circuit_open`
- `open` 状态会让 `/readyz` 降级，并在 `/metrics` 暴露 circuit state、open count
  与 rejected count
- 只有 transient bridge transport unavailable 会在同一 bridge timeout budget 内进行
  有界 retry；request timeout、client / execution cancel、oversized response、invalid
  envelope、`bridge_invalid_request` 与语义层 `supervisor_error` 不通过 bridge retry
  掩盖
- 恢复成功的 delegate response 会在 `workflow_trace_summary.trace_steps` 的
  `finalization` step 中写出 `attempt_count` 与 `runtime_retry_count`；Prometheus
  通过 `campus_execution_control_bridge_retries_total{kind=...}` 记录 retry attempt
- 语义层 supervisor error 不代表 bridge transport 不健康；有效 bridge envelope 会重置 circuit
- breaker 只保护 Docker-side execution runtime，不替代 `app-api` 的 product-layer
  user limit、热点合并或 duplicate-submit UX

## Structured Query Internal Runtime

Go `apps/execution-control` 当前承载 gate-closed structured query runtime foundation：

- `POST /internal/query/campus-services/service-status`
- `POST /internal/query/campus-services/service-guide`
- `POST /internal/query/campus-services/transport-schedule`
- `POST /internal/query/campus-services/contact-directory`
- `POST /internal/query/calendar/academic-calendar`
- `POST /internal/query/notices/discover`
- `POST /internal/query/notices/get`

这组 endpoint 是 `domain-agent -> thin adapter -> internal query
service` 的 Docker-local seam，不是 browser-facing API，也不是 `app-api`
product/control-plane endpoint。

调用规则：

- 仅允许 Python orchestration bridge 这类 trusted internal caller 使用
- 请求头使用 `x-supervisor-query-auth`
- JSON 命名保持 `snake_case`
- response body 对齐对应 tool result contract 的 safe typed summary
- runtime 只读 configured projection / normalized truth；不得 query-time 回扫 raw
  source bundle、notice HTML 或 generic retrieval chunk

当前状态：

- `service_status_lookup` 已迁移到 PostgreSQL release current pointer + typed read
  model，用于 deterministic runtime tests 与后续打开 gate 的一致 serving 路径
- `service_guide_lookup`、`contact_directory_lookup` 与 `academic_calendar_lookup`
  已使用 PostgreSQL release current pointer + typed read model；其中
  `academic_calendar_lookup` 只消费 `calendar/academic_calendar`
  projection-backed 校历事实
- `transport_schedule_lookup` 已具备 projection-backed deterministic query
  kernel，可解析 current snapshot metadata、route clarification、first / next /
  last departure、departure list、service window、timetable 与 temporary
  suspension summary
- `campus_notice_discover` 与 internal selected notice resolve
  (`payload_kind=campus_notice_get`) 已具备 Go-owned PG read-model 与
  S3-compatible source-backed bounded context query runtime；notice 请求使用
  `payload + access_context` envelope 以在 Go 内执行 restricted notice fail-close
  authorization
- Python orchestration 仅在 execution runtime harness 注入
  `EXECUTION_CONTROL_INTERNAL_QUERY_BASE_URL` 与 `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET`
  时消费该 internal query seam
- 这不打开 `campus_services` 或 `notice` 产品 serving surface；产品主路由 opening gate 仍需
  release-gate regression / eval evidence
  与 app-owned observability 证据

## Execution Audit Backflow

Go `apps/execution-control` 可以把 execution runtime kernel 事件回流给 `app-api`，但这条回流不是
browser-facing execution response，也不是 panel query backend。

回流 endpoint 固定为：

- `POST /api/internal/execution/audit-events`

调用规则：

- 由 Go `apps/execution-control` 使用 `x-app-internal-auth` 调用 `app-api`
- delivery 是 fail-closed；开启 execution audit 后，audit sink 不可用或返回非 2xx 时，
  `apps/execution-control` 必须返回稳定诊断错误，不得继续完成 answer request
- Go writer 同步发送每个 safe audit event；不存在 batch、flush、retry、local spool 或
  drop path
- `app-api` 验证 `request_id` 与 `trace_id` 后写入 `runtime.projection_outbox`
- ingest 成功后 `app-api` 会调度 request-scoped projector drain；cron projector drain
  只承担周期性一致性检查，不承担 answer path 的补救语义
- `Sentry` / `Axiom` 只作为 sanitized telemetry sink 或 backlink 来源，不成为 panel
  canonical truth
- request lifecycle 中的 trace / issue backlink 由 `app-api` optional recorder
  写入 `operator.trace_backlink_projection`；Go `apps/execution-control` 不直接服务
  panel，也不直接写 operator schema

第一版允许的 event type：

- `execution.admission_rejected`
- `execution.cancel_requested`
- `execution.cancelled`
- `execution.bridge_failed`
- `execution.timed_out`

payload 只允许 safe runtime summary：lane、requested capability、decision、failure
kind、HTTP status、retryable、duration、queue wait、bridge duration。禁止 raw
`user_goal`、raw prompt、raw answer、raw transcript、auth material、retrieval
payload 或 provider raw response。

## Request Body

最小请求体如下：

```json
{
  "request_id": "req_01HQ...",
  "conversation_id": "conv_01HQ...",
  "user_goal": "图书馆开放到几点？",
  "version_query": {
    "mode": "as_of",
    "as_of": "2024-06-01"
  },
  "context": {
    "actor": {
      "user_id": "user_01HQ...",
      "principal_id": "principal_01HQ...",
      "roles": ["student"],
      "departments": []
    },
    "authorization": {
      "principal_id": "principal_01HQ...",
      "entitlement_groups": ["students"],
      "visibility_scope": "main",
      "retrieval_filter": {
        "entitlement_groups": ["students"],
        "visibility_level": "public",
        "visibility_scope": "main",
        "policy_projection_version": "phase1-authorization-projection-v1"
      }
    },
    "profile_memory": {
      "items": []
    },
    "session": {
      "confirmed_slots": [],
      "selected_notice_ref": null,
      "turn_count": 0
    }
  },
  "requested_capability": "knowledge"
}
```

字段说明：

- `request_id` 来自 `app-api` 分配的 canonical request identity；当前 Go
  `apps/execution-control` runtime 要求它非空，用作 in-flight lifecycle 与 cancel key
- `conversation_id` 来自 chat domain truth
- `user_goal` 来自产品层 prompt
- `context` 由 `app-api` 显式投影的最小 `ContextProjection`；当前至少包含
  `actor`、`authorization.retrieval_filter`、`profile_memory.items` 与
  `session.confirmed_slots`、可选的 `session.selected_notice_ref`，以及 turn count 摘要
- `profile_memory.items` 只包含当前 principal 名下、已启用 projection、且
  `visibility=user_visible` 的 profile memory item；关闭 profile memory projection
  时必须为空。它只能用于 personalization，不得参与 authorization filter、serving
  surface、approval 或 tool permission 判定
- `requested_capability` 当前 wire 允许 `knowledge`、`place_lookup`、
  `campus_services`、`notice`。这只是 internal execution
  capability label，不等于对应 browser surface 已开放；当前公开 chat surface
  仍由 `app-api` surface capability policy 决定允许子集
- `requested_scope` 可选；当前 wire truth 仍保留这个顶层字段，但它只应被解释为 knowledge-family path 的
  scope hint。如果上游已经显式约束 serving surface，则传入这个字段。若缺失，execution path 必须允许
  agent 自主解析最终 serving surface，而不是由 `app-api` 或 `execution-control` 伪造默认
  collection。当前 Wave E 的 `place_lookup` request 不传 `requested_scope`，因为
  `place_catalog` 仍是 `navigation-agent` 消费的 internal spatial truth，而不是默认公开
  query-serving surface；`campus_services` 与 `notice` 同样不得携带
  `requested_scope`
- `version_query` 可选；当前只允许与 `requested_capability=knowledge` 一起出现。`app-api` 负责把
  browser/eval 路径上的 `camelCase versionQuery` 归一化成 Python-side `snake_case` 形态后传给
  `execution-control`

补充说明：

- `place_lookup` contract 仍保留在 internal execution seam
- 当前产品路径已对 `place_lookup` fail-close，等待地图产品上线后再开放地点查询、
  route planning、地图 UI 或完整 `place_card` product consumption；
  `app-api` 只按 capability/request projection 传递请求，不伪造 retrieval scope
- `campus_services` / `notice` 只有在上游 surface policy 已显式
  admission 时才应传入；
  knowledge path 下的 notice/service-like query 仍保持现有 gate posture，不被这次 wire
  对齐自动打开
- `version_query` 缺失时按 `current` 解释；显式 `historical` / `as_of` / `compare` 必须在这条
  seam 上传递，不允许 `app-api` 静默折叠回 current

## Response Body

`execution-control` 返回的最小成功 body 继续对齐 `SupervisorResponse + trace_id`：

```json
{
  "selected_target": "rag-agent",
  "status": "completed",
  "answer_text": "图书馆开放到 22:00。",
  "follow_up_question": "",
  "confidence": "high",
  "result": null,
  "error": null,
  "observability": {
    "retrieval_attempted": true,
    "candidate_count": 2,
    "retrieved_source_count": 2,
    "retrieved_sources": [
      {
        "doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
        "chunk_id": "chunk-0007",
        "score": 0.94,
        "source_title": "法学（民族实验班）本科人才培养方案"
      }
    ],
    "citation_expected": true,
    "citation_count": 2,
    "citation_missing": false,
    "resolved_scope_corpus": "regulations",
    "resolved_scope_collection": "student_rules",
    "refusal_class": "",
    "acl_decision": "allowed",
    "fail_closed": false,
    "intent_capability": "knowledge",
    "intent_task_kind": "knowledge_lookup",
    "intent_launch_state": "open",
    "intent_next_action": "delegate",
    "intent_scope_class": "in_scope",
    "intent_scope_reason": "explicit_requested_scope",
    "intent_policy_reason": "",
    "intent_classifier_version": "deterministic-intent-v1",
    "intent_schema_version": "intent-schema-1.0.0",
    "intent_routing_confidence": "high",
    "intent_context_resolution_state": "not_follow_up",
    "intent_context_reference_type": "none",
    "intent_resolved_slots": {},
    "intent_missing_slots": [],
    "intent_ambiguity_signal": "",
    "intent_ambiguity_reason": "",
    "prompt_runtime_state": "",
    "prompt_runtime_detail": "",
    "prompt_trace": {
      "prompt_id": "rag_answer_v1",
      "prompt_version": "v1",
      "template_sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "variables_schema_version": "v1",
      "output_schema_version": "v1",
      "model_provider": "openai-responses",
      "model_name": "gpt-5.2-mini"
    }
  },
  "trace_id": "trace_01HQ..."
}
```

`status` 固定允许：

- `completed`
- `needs_clarification`
- `no_answer`
- `error`
- `approval_required`
- `rejected`
- `cancelled`

`app-api` 依赖的最小字段只有：

- `status`
- `trace_id`
- `selected_target`
- `answer_text`
- `follow_up_question`
- `error`
- `result`
- `observability` optional

其中：

- `selected_target` 始终表示 execution path 实际选择的 current runtime target。 在当前 phase
  它只能是 shared contract 中已 admitted 的 runtime label，例如
  `rag-agent`、`navigation-agent`、`campus-services-agent`、`notice-agent`。 它不是
  capability family label，也不是 operator-facing display label；当 current runtime
  label 与 family label 一致时，serialized contract 直接承载这个 admitted runtime target。
- `result` 仍由 agent / shared contract 拥有，不在这里完整重定义
- 当 `selected_target = navigation-agent` 时，`result` 使用 `PlaceLookupResult` 的
  Python-side `snake_case` 形态：
  - `query_text`
  - `matched_alias`
  - `resolved_place.{place_id, entity_type, display_name, campus_scope,
    campus_area}`
  - `place_card.{place, location_description, landmark_hint, access_note,
    opening_note, service_tags, point_geometry, coordinate_reference_system,
    source_refs}`
  - `candidate_places[].{place, clarification_hint}`
- 当 `selected_target = rag-agent` 且 `result.diagnostics` 存在时，`app-api` 当前会消费其中的
  summary truth：
  - `retrieval_adequacy_verdict`
  - `retrieval_adequacy_reason`
  - `grounding_verdict`
  - `claim_supports`
  - `unsupported_fields`
- 上述 `result.diagnostics.*` 只用于 app-owned summary projection；它不是 panel 或 browser
  的 raw agent dump contract
- `app-api` 可以从 `result` 中提取 source identifiers 进入 projection，但不得把 agent
  payload 直接当 browser contract 暴露
- 当前这份 `place_card` normalization shape 继续保留为 future navigation rollout seam；但由于
  supervisor 已在产品路径上 fail-close `place_lookup`，浏览器当前不会收到这类 payload
- `observability` 是 execution-side typed summary seam，用于
  `runtime.request_observability_fact` 的 seed / finalize；字段继续保持 Python-side
  `snake_case`
- `observability.intent_*` 是 supervisor-owned routing intent governance summary；其中
  `intent_schema_version` 描述字段 / 枚举 / reason code 兼容性，
  `intent_classifier_version` 描述当前 deterministic classifier / resolver 行为版本，两者必须分离
- `observability.intent_context_resolution_*`、`intent_resolved_slots` 与
  `intent_missing_slots` 只承载 app-api 投影出的最小 typed context 解析结果，不承载 raw
  transcript 或 browser-local state
- `observability.retrieved_sources` 表示 execution side 原始 retrieval candidate
  trace；它与最终 `result.evidence.sources` 不是同一层 truth
- 对 structured runtime lane，`observability` 还会回传 compact summary：
  - `selected_tool`
  - `tool_business_outcome`
  - `tool_fail_close_reason`
  - `tool_historical_downgrade_reason`
  - `notice_source_family_summary`
  - `temporal_posture`
- 当 execution side 解析了最终 serving surface 时，`observability.resolved_scope_*`
  必须显式回传给 `app-api`
- `observability.prompt_trace` 只返回 observability-safe prompt identity，不返回 raw
  prompt text
- `observability.prompt_runtime_state` / `observability.prompt_runtime_detail`
  用于区分 `provider_refusal`、`provider_incomplete`、`content_filter` 等 fail-close
  branch
- `observability` 不返回 raw prompt、raw answer、raw transcript、raw retrieval
  payload、raw provider citation blob 或 raw auth material
- `app-api` 必须把 `observability.retrieved_sources` 归一化成 operator-safe、bounded
  source trace，再与最终 supporting evidence 分开持久化；不得把 raw `EvidenceSource` snippet
  dump 直接暴露给 panel
- `result.diagnostics` 也不应携带 provider-native citation blob、raw support snippet
  dump 或其他 operator 不可见的 vendor payload；operator-facing query path 只保留 compact
  summary
- token / model / cost 字段如果出现，必须来自 execution-side typed telemetry seam，而不是
  panel-side 或 sink-side 反推

## HTTP Status Rule

对 `app-api` 来说，需要区分两类失败：

- transport / admission / malformed execution request 使用非 `200`
- execution 已被受理并得到 typed `SupervisorResponse` 返回 `200`，由 body 内 `status` 区分
  `completed` / `needs_clarification` / `no_answer` / `error` /
  `approval_required` / `rejected` / `cancelled`

这意味着：

- `app-api` 应把 `200 + status=error` 视为 execution-level handled outcome
- `409 execution_already_in_flight` 表示同一 `request_id` 已在 Go `execution-control`
  in-flight
  registry 中，不应重试成新的 execution identity
- `499 execution_cancelled` 表示 Go `execution-control` 已接受 explicit cancel 或
  upstream cancel 后停止等待；它不是 semantic answer failure
- `503 transport_lane_queue_full` 与 `503 transport_lane_queue_timeout` 表示特定
  workload lane 饱和，区别于全局 `transport_queue_full` / `transport_queue_timeout`
- `503 supervisor_bridge_circuit_open` 表示 Go execution runtime 已确认 Python bridge
  transport / protocol health 处于 open circuit，`app-api` 应按 retryable runtime
  unavailability 处理，而不是生成新的 request identity 绕过 breaker
- `app-api` 应保留 `approval_required` / `rejected` 作为 runtime / panel projection
  的最终状态，即使 browser chat surface 折叠为 `error`
- `app-api` 不应把所有非理想执行结果都折叠成 transport error

## Terminal State Semantics

terminal response 的跨语言语义固定如下：

- `completed`：必须有 canonical `selected_target` 与 response-level confidence
- `needs_clarification` / `no_answer`：仍是 typed execution outcome，不等价于
  transport failure
- `error`：必须携带 safe `{ code, message, retryable }`，并在
  `workflow_trace_summary.fail_close_reason` 中保留 deterministic failure class
- `cancelled`：允许 `selected_target=null`，表示 execution lifecycle 已终止，不要求 agent
  handoff 已发生
- timeout / bridge unavailable / bridge circuit open 不能伪装成 completed answer；它们必须通过
  typed `error` / HTTP status / workflow trace summary 保留 fail-close provenance

Go finalizer 必须保证 delegate branch 与 `handoff.agent_request.target`、`selected_target`、
runtime version provenance 一致；否则 fail-closed，而不是返回半结构化成功 body。

## Current Compatibility Note

当前仓库里的 public execution ingress 已 hardcut 到 `apps/execution-control`。
shared product path 已收口为：

- internal caller admission 由 Go `execution-control` 验证 runtime header
- `context` 由 `app-api` 显式提供，并携带最终 `actor` 与 `authorization`
- Go `execution-control` 的 `trusted-worker` 不依赖 Cloudflare Access JWT 或 edge
  identity header 来恢复最终业务 actor
- top-level `actor` 不是 canonical request body 的必需字段；如果出现在 trusted-worker
  请求里，只能作为与 `context.actor` 一致的冗余投影
- Python `apps/supervisor-agent-worker` 只保留 private bridge worker，不再暴露 public
  compatibility ingress

这不重开 `packages/contracts`，因为 `ActorContext` 本身已经是 accepted shared contract。

## Forward Evolution

- 当前 internal execution wire truth 仍是 `requested_capability + knowledge-only optional
  requested_scope`
- 在明确引入新版本 contract 之前，`app-api` 与 `execution-control` 继续按这组字段互操作，不把
  capability-neutral routing 误写成“当前 wire 已经 capability-family-native”
- `requested_scope` 的长期语义应收窄为 knowledge-family-specific field；它不能代替 capability
  routing，也不应要求非 knowledge path 伪造等价字段
- `selected_target` 的语义不变：它继续序列化 current execution path 实际选中的 admitted runtime
  target，而不是 future capability-family alias、surface label 或 operator-facing 名称
- capability-neutral routing、surface capability policy 与 routing clarification
  的长期 supporting truth 见
  `docs/architecture/system/capability-routing-and-admission-architecture.md`
  与
  `docs/decisions/adr-0042-capability-neutral-supervisor-routing-and-surface-capability-policy.md`

## Non-Goals

- 不把 panel query 做进 `execution-control`
- 不让 `execution-control` 理解 Better Auth session 或 operator trusted-access provider
  细节
- 不把 public entry Worker 的外部 ingress contract 直接复制为 shared `app-api` 的内部
  execution contract
