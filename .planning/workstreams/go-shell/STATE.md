---
doc_type: state
status: completed
created: 2026-04-23
updated: 2026-04-27
---

# State: go-shell

## Current Status

- status: `completed`
- current phase: `<none>`
- current slice: Phase 0-63 repo-local implementation 已完成；Go `supervisor-api` runtime kernel hardening、bridge v6
  canonical projection、deterministic capability/scope/version 裁决、structured
  runtime payload planner、prompt config admission summary、readiness runtime
  truth、execution audit batching/retry/spool、OTel sample accounting 与
  lifecycle SSE endpoint 已落地；Go handoff planner 已从 structured-only 扩展为
  all-delegate preplanned handoff，knowledge `rag_request` 也由 Go bridge v6 投影；
  Go 同时拥有 terminal envelope、non-delegate terminal direct answer path、
  `place_lookup` Go direct runtime、structured tool policy summary、opened structured capability non-stream /
  lifecycle SSE direct answer path、runtime decision observability summary 与 full
  `AgentRequest` handoff projection，以及
  `AgentResponse -> SupervisorResponse` finalization；Python bridge 已收窄为
  delegate-only
  semantic worker，`apps/supervisor-agent-worker` production path 不再依赖
  `RoutingDecision` / terminal envelope / runtime audit sink；legacy Python
  `routing.py`、supervisor-core `audit.py`、`policy.py`、`response.py` 与 worker
  stale audit helper 已删除，intent eval 只通过 Go `supervisor-api`
  runtime-policy runner 执行；Python supervisor-core residual `intent.py`、
  `scope_policy.py`、`query_policy.py`、`validation.py`、`context.py` 与
  `tool_policy.py` 已删除，Python worker cancel flag store 仅保留
  request-scoped flag，不再发布 execution lifecycle counters；旧
  `SupervisorAgent` / `agent.py` / `handle_agent_request` /
  `AgentDelegate` / `MissingAgentDelegateError` 已退役，剩余
  `AgentDispatcher`、`AgentDelegate`、`dispatch_agent_request` 与 dispatch error
  已内联到 `apps/supervisor-agent-worker`，standalone `packages/supervisor-core`
  已退役；默认 agent delegate map 已迁到 worker runtime assembly，dispatch helper
  不再 import concrete agent packages；worker/test/docs active naming
  已收口到 agent worker / agent handoff / agent request，bridge v6 private
  contract 以 `AgentRequest` / `AgentResponse` / `agent_response` 为 canonical
  命名；旧 `specialist` aliases 与 `supervisor-core-worker` runtime 名称已从
  active code / tests / docs 移除；`campus_services` /
  `notice` 产品主路由 gate 仍默认关闭
- owner: unassigned
- active implementation: completed, Go `apps/supervisor-api` plus Python
  `apps/supervisor-agent-worker`

## Captured Context

2026-04-24 hardcut 结论：

- Go implementation path 已从 `apps/go-shell` hardcut 到 `apps/supervisor-api`。
- Python private bridge worker 已从 `apps/supervisor-api` hardcut 到
  `apps/supervisor-agent-worker`。
- active runtime pair 是 `supervisor-api + supervisor-agent-worker`；`go-shell` 仅保留为
  这条迁移 workstream 的短名。
- Python worker module/package/env 已 hardcut 到
  `campus_supervisor_agent_worker` / `campus-supervisor-agent-worker` /
  `SUPERVISOR_AGENT_WORKER_*`；bridge v6 private wire contract 已 hardcut 到
  canonical `AgentRequest` / `AgentResponse` / `agent_response`。

2026-04-23 讨论结论：

- 用户希望创建短名持久化 workstream，名称确定为 `go-shell`。
- 范围是 Docker 部署侧，不涉及 Worker 侧选型。
- Python 性能和服务器预算是主要驱动，但迁移必须保持边界正确。
- 第一刀不是 Go 重写 `supervisor-core`，而是迁移 execution runtime control plane：
  - HTTP transport / dispatch
  - internal caller auth
  - admission / backpressure / lane budgets
  - cancellation / streaming lifecycle
  - health / readiness / metrics
  - audit/logging runtime
  - Python orchestration bridge
- 2026-04-25 补充：Go `supervisor-api` 现在拥有 effective capability/lane inference
  与 `campus_services` / `notice` structured runtime opening gate；Python
  `supervisor-agent-worker` 不再拥有本地 JSONL audit writer。
- 2026-04-25 补充：Go `supervisor-api` 现在拥有 bridge v4 canonical request
  projection、capability/scope/version 单源裁决、deterministic structured
  payload planner 与 prompt config admission summary；Python
  `supervisor-agent-worker` 只消费 Go preplanned handoff，并只发布 minimal
  semantic worker readiness。
- 2026-04-25 补充：Go `supervisor-api` 的 preplanned handoff 已覆盖 knowledge
  delegate path；Python bridge 对 delegate routing 缺失 Go preplanned payload
  fail-closed，`packages/supervisor-core` 不再 fallback 到 Python `route_request()`，
  也不再构造 RAG / navigation / structured agent request payload。
- 2026-04-25 补充：Go `supervisor-api` 现在拥有 non-delegate terminal envelope、
  nested bridge v4 runtime decisions、structured tool policy summary、opened
  structured capability non-stream / lifecycle SSE direct answer path，以及低基数
  runtime decision observability labels；Python bridge hardcut 到 v4，
  `packages/supervisor-core` 不再合成 terminal prompt response，也不再维护 target ->
  tool matrix。
- 2026-04-25 补充：bridge v4 handoff 改为传完整 `AgentRequest`，Python
  `framing.py` 与 production supervisor terminal prompt stack 已删除；Python bridge 不再
  作为 execution audit runtime emission owner。
- 2026-04-25 补充：Go non-stream / lifecycle SSE answer path 现在直接执行
  non-delegate terminal envelope；Python bridge answer route 只接受 delegate
  `runtime_decisions.handoff.agent_request`，`packages/supervisor-core` public
  handler 只接受 `preplanned_agent_request`，不再暴露 `preplanned_routing_decision`
  或 `audit_sink`。
- 2026-04-25 补充：legacy Python `packages/supervisor-core/routing.py`、direct
  `audit.py` helper 与 worker stale audit seam 已删除；intent eval hardcut 到 Go
  `supervisor-api` runner，guard 覆盖 `python-legacy` runner、`route_request()`、
  `RoutingDecision` 与 runtime audit helper 回流。
- 2026-04-25 补充：Python supervisor-core residual intent/scope/query/validation/
  context/tool policy helpers 已删除；Go runtime policy / execution tests 承接 residual
  裁决覆盖，Python core 不再维护 target/tool matrix；Python bridge cancel flag store
  只保留 request-scoped flag，execution lifecycle counters 继续由 Go 发布。
- 2026-04-26 补充：bridge envelope 升级为 `supervisor_bridge_v6`，并要求
  `response_contract=agent_response`；Python bridge 只返回 private
  `AgentResponse`，Go `supervisor-api` 统一 finalizes public
  `SupervisorResponse` 与 response observability。`packages/supervisor-core`
  已删除 `policy.py` / `response.py` 与 legacy `handle_request` public handler。
- 2026-04-26 补充：Python active core 进一步退役为 private agent dispatch helper；
  `SupervisorAgent` / `agent.py` / `handle_agent_request` / `AgentDelegate`
  / `MissingSpecialistDelegateError` 已移除，默认 agent delegate map 迁到
  `apps/supervisor-agent-worker`，`packages/supervisor-core` 不再 import concrete agent
  packages。
- 2026-04-26 补充：完成内部命名 closeout；worker 内部变量/函数、supervisor focused
  tests 与 docs/planning active 叙述统一为 agent handoff / agent request。bridge v6
  wire 字段 `runtime_decisions.handoff.agent_request`、`response_contract=agent_response`
  与 shared contract `AgentRequest` / `AgentResponse` 作为 canonical bridge v6
  private contract 保留。
- 2026-04-26 补充：standalone `packages/supervisor-core` 已退役；剩余 private
  `AgentDispatcher` / `dispatch_agent_request` 与 dispatch error API 已内联到
  `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_dispatch.py`。
  Worker Dockerfile、workspace dependency、tests、guard 与 active docs 已同步到
  worker-owned agent dispatch。
- 2026-04-27 补充：Go runtime intent signal taxonomy 收口到
  `configs/runtime/intent-policy.v1.json`；capability inference、runtime policy 与
  structured handoff planner 共用同一份 loaded artifact，`execution` 与
  `structuredplanning` 不再维护独立 signal 表。
- 更宽的 Go/Rust/Python split 保留在
  `supervisor-docker-runtime-language-split` backlog。

2026-04-23 技术栈结论：

- 第一轮迁 runtime control plane，不迁业务 agent。
- Go 侧使用标准库 `net/http` / `http.ServeMux`、`context.Context`、
  `log/slog`、`testing` / `httptest`；当前 slice 以 `supervisor-api`-owned `/metrics` 与
  structured logs 承接 observability，OTel collector / sink fan-out 留待后续重开。
- 第一版 bridge 使用 private loopback HTTP/JSON 调用长驻 Python orchestration
  worker，不默认引入 UDS 或 gRPC。
- `app-api` 继续拥有产品层限流；Go `supervisor-api` 只拥有 execution admission /
  backpressure。
- RAG provider-backed prompt executor 和 prompt stack assembly 暂不迁，除非后续
  profiling 证明 Go `apps/supervisor-api` 稳定后它们是下一条瓶颈线。

## Blockers

- no repo-local closeout blocker
- repo-owned environment-side hard-cut automation 当前无 blocker。
- `chat-capacity-and-cancellation-hardening` 若后续恢复，会影响 product-layer
  stop/cancel UX、request lifecycle projection 与 browser duplicate-submit guard；
  当前 Go `supervisor-api` 只实现 execution-side cancel、Go -> Python cooperative cancel
  signal，以及 Python semantic orchestration checkpoint-level cancellation。
- `transport_schedule_lookup` 的 runtime kernel 已实现；opening gate 仍需要 eval /
  regression evidence、产品路由 admission 与真实 projection 数据接入决策。
- `campus_notice_discover` / `campus_notice_get` 的 runtime kernel 已实现；
  opening gate 仍需要 eval / regression evidence 与产品路由 admission 决策。
- `place_lookup` 的 Go direct runtime 已实现；地图 UI、route planning 与
  `place_card` product consumption 仍属于 navigation rollout backlog，不在本线继续扩展。
- `Phase 16-63` 已完成 repo-local implementation；剩余 opening gate 不在
  `go-shell` execution runtime control-plane 范围内。

## Verification

- Phase 56-60 focused verification passed on 2026-04-26:
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `pnpm go:check`
  - `uv run --all-packages python -m unittest`
    `tests.api.supervisor_api_bridge_suite`
    `tests.api.supervisor_api_audit_suite`
    `tests.api.test_supervisor_api_bridge_server`
    `tests.api.test_supervisor_api_asgi`
    `tests.api.test_supervisor_api_prompt_stack`
    `tests.api.test_supervisor_api_prompt_executor`
    `tests.api.supervisor_api_settings_and_health_suite`
    `tests.supervisor.supervisor_core_routing_suite`
    `tests.supervisor.supervisor_core_agent_policy_suite`
    `tests.supervisor.supervisor_core_prompt_execution_suite`
    `tests.supervisor.test_supervisor_runtime_guardrails`
    `tests.agent.rag_agent_answer_grounding_suite`
  - `uv run --all-packages ruff check`
    `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker`
    `packages/supervisor-core/src/campus_supervisor_core`
    `tests/api/supervisor_api_bridge_suite.py`
    `tests/api/supervisor_api_audit_suite.py`
    `tests/api/test_supervisor_api_bridge_server.py`
    `tests/api/test_supervisor_api_asgi.py`
    `tests/api/test_supervisor_api_prompt_stack.py`
    `tests/api/test_supervisor_api_prompt_executor.py`
    `tests/api/supervisor_api_settings_and_health_suite.py`
    `tests/supervisor/supervisor_core_routing_suite.py`
    `tests/supervisor/supervisor_core_agent_policy_suite.py`
    `tests/supervisor/supervisor_core_prompt_execution_suite.py`
    `tests/supervisor/test_supervisor_runtime_guardrails.py`
    `tests/agent/rag_agent_answer_grounding_suite.py`
    `tests/agent/rag_agent_test_support.py`
  - `uv run --all-packages ruff format` for the same Python paths with
    `--check`
  - `pnpm docs:lint`
  - `git diff --check`
  - active drift scan found no concrete agent package imports inside
    `packages/supervisor-core`; legacy `SupervisorAgent` /
    `handle_agent_request` / `AgentDelegate` /
    `MissingAgentDelegateError` hits are limited to guard assertions and
    descriptive planning / architecture closeout records
- Phase 55 focused verification passed on 2026-04-26:
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `pnpm go:check`
  - `uv run --all-packages python -m unittest`
    `tests.api.supervisor_api_bridge_suite`
    `tests.api.supervisor_api_audit_suite`
    `tests.supervisor.supervisor_core_routing_suite`
    `tests.supervisor.supervisor_core_agent_policy_suite`
    `tests.supervisor.supervisor_core_prompt_execution_suite`
    `tests.supervisor.test_supervisor_runtime_guardrails`
    `tests.agent.rag_agent_answer_grounding_suite`
  - `uv run --all-packages ruff check`
    `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker`
    `packages/supervisor-core/src/campus_supervisor_core`
    `tests/api/supervisor_api_bridge_suite.py`
    `tests/api/supervisor_api_audit_suite.py`
    `tests/supervisor/supervisor_core_routing_suite.py`
    `tests/supervisor/supervisor_core_agent_policy_suite.py`
    `tests/supervisor/supervisor_core_prompt_execution_suite.py`
    `tests/supervisor/test_supervisor_runtime_guardrails.py`
    `tests/agent/rag_agent_answer_grounding_suite.py`
    `tests/agent/rag_agent_test_support.py`
  - `uv run --all-packages ruff format` for the same Python paths with
    `--check`
  - `pnpm docs:lint`
  - `git diff --check`
  - active drift scan returned only guard-test forbidden fragments and the explicit
    v4 rejection fixture; no active Python core / bridge code imports
    `campus_supervisor_core.policy` / `campus_supervisor_core.response`, calls
    `handle_request`, or emits legacy supervisor finalization helpers
- Phase 49-54 focused verification passed on 2026-04-25:
  - `uv run --all-packages python -m unittest`
    `tests.supervisor.test_supervisor_runtime_guardrails`
    `tests.api.supervisor_api_bridge_suite`
    `tests.api.supervisor_api_audit_suite`
    `tests.api.test_supervisor_api_prompt_stack`
    `tests.api.test_supervisor_api_prompt_executor`
    `tests.shared.test_prompt_runtime`
    `tests.supervisor.supervisor_core_routing_suite`
    `tests.supervisor.supervisor_core_agent_policy_suite`
    `tests.supervisor.supervisor_core_prompt_execution_suite`
    `tests.supervisor.supervisor_core_observability_context_suite`
    `tests.supervisor.test_supervisor_policy`
    `tests.supervisor.test_supervisor_structured_runtime_observability`
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `pnpm go:check`
  - `uv run --all-packages ruff check`
    `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker`
    `packages/supervisor-core/src/campus_supervisor_core`
    `tests/api/supervisor_api_bridge_suite.py`
    `tests/api/supervisor_api_audit_suite.py`
    `tests/api/test_supervisor_api_prompt_stack.py`
    `tests/api/test_supervisor_api_prompt_executor.py`
    `tests/shared/test_prompt_runtime.py`
    `tests/supervisor/supervisor_core_routing_suite.py`
    `tests/supervisor/supervisor_core_agent_policy_suite.py`
    `tests/supervisor/supervisor_core_prompt_execution_suite.py`
    `tests/supervisor/supervisor_core_observability_context_suite.py`
    `tests/supervisor/test_supervisor_runtime_guardrails.py`
    `tests/supervisor/test_supervisor_policy.py`
    `tests/supervisor/test_supervisor_structured_runtime_observability.py`
  - `uv run --all-packages ruff format` for the same Python paths with
    `--check`
  - `pnpm docs:lint`
  - `git diff --check`
  - active drift scan returned only guard-test forbidden fragments, descriptive
    go-shell closure records and Go lifecycle metric names in a runbook; no active
    Python code imports legacy helper modules or publishes cancel runtime counters
- Phase 46-48 focused verification passed on 2026-04-25:
  - `uv run --all-packages python -m unittest`
    `tests.supervisor.test_supervisor_runtime_guardrails`
    `tests.evals.intent_eval_runner_suite`
    `tests.evals.intent_go_runner_suite`
    `tests.evals.intent_gate_script_suite`
    `tests.evals.intent_drift_suite`
    `tests.evals.intent_release_gate_script_suite`
  - `uv run --all-packages python -m unittest`
    `tests.api.supervisor_api_bridge_suite`
    `tests.api.supervisor_api_audit_suite`
    `tests.api.test_supervisor_api_prompt_stack`
    `tests.api.test_supervisor_api_prompt_executor`
    `tests.shared.test_prompt_runtime`
    `tests.supervisor.supervisor_core_routing_suite`
    `tests.supervisor.supervisor_core_agent_policy_suite`
    `tests.supervisor.supervisor_core_prompt_execution_suite`
    `tests.supervisor.supervisor_core_observability_context_suite`
    `tests.supervisor.test_supervisor_runtime_guardrails`
    `tests.supervisor.test_supervisor_policy`
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `pnpm go:check`
  - `uv run --all-packages ruff check`
    `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker`
    `packages/supervisor-core/src/campus_supervisor_core`
    `packages/evals/src/campus_evals/intent_runner.py`
    `scripts/intent_gate.py`
    `tests/evals/intent_eval_runner_suite.py`
    `tests/evals/intent_drift_suite.py`
    `tests/supervisor/test_supervisor_runtime_guardrails.py`
  - `uv run --all-packages ruff format` for the same Python paths with
    `--check`
  - `pnpm docs:lint`
  - `git diff --check`
  - supervisor-scoped drift scan returned only guard-test forbidden fragments and
    descriptive go-shell closure records; no active code imports
    `campus_supervisor_core.routing` / `campus_supervisor_core.audit`, exposes
    `python-legacy`, or calls `route_request()` / runtime audit helper builders
- Phase 39-45 focused verification passed on 2026-04-25:
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `pnpm go:check`
  - `uv run --all-packages python -m unittest`
    `tests.api.supervisor_api_bridge_suite`
    `tests.api.supervisor_api_audit_suite`
    `tests.api.test_supervisor_api_prompt_stack`
    `tests.api.test_supervisor_api_prompt_executor`
    `tests.shared.test_prompt_runtime`
    `tests.supervisor.supervisor_core_routing_suite`
    `tests.supervisor.supervisor_core_agent_policy_suite`
    `tests.supervisor.supervisor_core_prompt_execution_suite`
    `tests.supervisor.supervisor_core_observability_context_suite`
    `tests.supervisor.supervisor_core_audit_record_suite`
    `tests.supervisor.test_supervisor_runtime_guardrails`
    `tests.supervisor.test_supervisor_routing`
    `tests.supervisor.test_supervisor_policy`
  - `uv run --all-packages ruff check`
    `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker`
    `packages/supervisor-core/src/campus_supervisor_core`
    `tests/api/supervisor_api_bridge_suite.py`
    `tests/api/supervisor_api_audit_suite.py`
    `tests/api/test_supervisor_api_prompt_stack.py`
    `tests/api/test_supervisor_api_prompt_executor.py`
    `tests/shared/test_prompt_runtime.py`
    `tests/supervisor/supervisor_core_routing_suite.py`
    `tests/supervisor/supervisor_core_agent_policy_suite.py`
    `tests/supervisor/supervisor_core_prompt_execution_suite.py`
    `tests/supervisor/supervisor_core_observability_context_suite.py`
    `tests/supervisor/supervisor_core_audit_record_suite.py`
    `tests/supervisor/test_supervisor_runtime_guardrails.py`
    `tests/supervisor/test_supervisor_routing.py`
    `tests/supervisor/test_supervisor_policy.py`
  - `uv run --all-packages ruff format` for the same Python paths with
    `--check`
  - `pnpm docs:lint`
  - `git diff --check`
  - at that time, active drift scan returned only guard-test forbidden fragments plus allowed
    legacy `packages/supervisor-core/src/campus_supervisor_core/routing.py` and
    direct `audit.py` helper references; production agent / public API / Python
    bridge parser no longer reference `RoutingDecision`, terminal envelope parsing,
    `preplanned_routing_decision`, or runtime `audit_sink`
- Phase 34-38 focused verification passed on 2026-04-25:
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `pnpm go:check`
  - `uv run --all-packages python -m unittest`
    `tests.api.supervisor_api_bridge_suite`
    `tests.api.supervisor_api_audit_suite`
    `tests.api.test_supervisor_api_prompt_stack`
    `tests.api.test_supervisor_api_prompt_executor`
    `tests.shared.test_prompt_runtime`
    `tests.supervisor.supervisor_core_routing_suite`
    `tests.supervisor.supervisor_core_agent_policy_suite`
    `tests.supervisor.supervisor_core_prompt_execution_suite`
    `tests.supervisor.supervisor_core_observability_context_suite`
    `tests.supervisor.supervisor_core_audit_record_suite`
    `tests.supervisor.test_supervisor_runtime_guardrails`
    `tests.supervisor.test_supervisor_routing`
  - `uv run --all-packages ruff check`
    `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker`
    `packages/supervisor-core/src/campus_supervisor_core`
    `tests/api/test_supervisor_api_prompt_stack.py`
    `tests/api/test_supervisor_api_prompt_executor.py`
    `tests/shared/test_prompt_runtime.py`
    `tests/supervisor/supervisor_core_observability_context_suite.py`
    `tests/supervisor/supervisor_core_audit_record_suite.py`
    `tests/supervisor/supervisor_core_prompt_execution_suite.py`
    `tests/supervisor/test_supervisor_runtime_guardrails.py`
    `tests/api/supervisor_api_bridge_suite.py`
    `tests/api/supervisor_api_audit_suite.py`
    `tests/supervisor/supervisor_core_routing_suite.py`
    `tests/supervisor/supervisor_core_agent_policy_suite.py`
    `tests/supervisor/test_supervisor_routing.py`
  - `uv run --all-packages ruff format` for the same Python paths with
    `--check`
  - `pnpm docs:lint`
  - `git diff --check`
  - active bridge / handoff / supervisor prompt stack drift scan returned only
    guard-test forbidden fragments
- Phase 28-33 focused verification passed on 2026-04-25:
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `pnpm go:check`
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `go test ./... -count=1` in `apps/supervisor-api`
  - `uv run --all-packages python -m unittest`
    `tests.api.supervisor_api_audit_suite`
    `tests.api.supervisor_api_bridge_suite`
    `tests.supervisor.supervisor_core_routing_suite`
    `tests.supervisor.supervisor_core_agent_policy_suite`
    `tests.supervisor.test_supervisor_policy`
    `tests.supervisor.test_supervisor_runtime_guardrails`
    `tests.supervisor.test_supervisor_structured_runtime_observability`
  - `uv run --all-packages ruff check`
    `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker`
    `packages/supervisor-core/src/campus_supervisor_core`
    `tests/api/supervisor_api_bridge_suite.py`
    `tests/api/supervisor_api_audit_suite.py`
    `tests/supervisor/supervisor_core_routing_suite.py`
    `tests/supervisor/supervisor_core_agent_policy_suite.py`
    `tests/supervisor/test_supervisor_policy.py`
    `tests/supervisor/test_supervisor_runtime_guardrails.py`
  - `uv run --all-packages ruff format` for the same Python paths with
    `--check`
  - `pnpm docs:lint`
  - `git diff --check`
  - active legacy bridge / flat planner-field scan returned only guard-test forbidden
    fragments
- Phase 20 focused verification passed on 2026-04-25:
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `pnpm go:check`
  - `uv run --all-packages python -m unittest`
    `tests.api.supervisor_api_audit_suite`
    `tests.api.supervisor_api_settings_and_health_suite`
    `tests.api.supervisor_api_bridge_suite`
    `tests.supervisor.test_supervisor_validation`
    `tests.supervisor.test_supervisor_routing`
  - `uv run --all-packages ruff check`
    `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker`
    `tests/api/supervisor_api_audit_suite.py`
    `tests/api/supervisor_api_settings_and_health_suite.py`
  - `uv run --all-packages ruff format`
    `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker`
    `tests/api/supervisor_api_audit_suite.py`
    `tests/api/supervisor_api_settings_and_health_suite.py --check`
  - `pnpm docs:lint`
  - `git diff --check`
- Hardcut closeout verification passed on 2026-04-24:
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH" pnpm go:check`
  - `uv run --all-packages python -m unittest` for supervisor API bridge,
    ASGI, prompt executor/stack, workspace layout, supervisor-api runtime
    smoke tests, shell/lint coverage tests, campus-services / notice
    agent wiring, and supervisor validation / routing / scope policy
  - `pnpm --dir apps/app-api test:node --`
    `operator-observability-ingest.route.test.ts`
    `operator-observability-command.service.test.ts`
    `projection.service.test.ts worker.test.ts`
  - `pnpm docs:lint`, `pnpm yaml:lint`, `pnpm shell:lint`,
    `pnpm docker:lint`, `pnpm toml:lint`, `pnpm web:lint`,
    `pnpm lock:lint`, `pnpm coverage:lint`, `pnpm env:lint`,
    `pnpm jsonl:lint`, `pnpm sql:lint`, `pnpm editorconfig:lint`,
    `pnpm html:lint`, `pnpm xml:lint`, and `pnpm public-docs:lint`
  - `API_WORKER_SHARED_SECRET=worker-secret`
    `SUPERVISOR_AGENT_WORKER_SHARED_SECRET=core-secret`
    `docker compose -f infra/local/docker-compose.supervisor-runtime.yml config`
  - `docker build -f apps/supervisor-api/Dockerfile -t campus-supervisor-api:local .`
  - `docker build -f apps/supervisor-agent-worker/Dockerfile`
    `-t campus-supervisor-agent-worker:local .`
  - stale runtime naming scan returned no active matches for old
    `apps/go-shell`, `campus_supervisor_api`, `go_shell`, or
    `SUPERVISOR_PY_BRIDGE` surfaces outside the historical workstream slug /
    history namespace
  - `git diff --check`
- Full repo-wide `ruff check .`, `ruff format . --check`, and Python unittest
  discovery are not clean in the current dirty worktree because of unrelated
  baseline failures in contracts / ingestion import ordering, historical
  formatting drift, ingestion fixture imports, MinerU OCR test env assumptions,
  decomposition baseline, and a docs-structure assertion for removed PowerShell
  lane wording. These are not blockers for the supervisor-api hardcut closeout.
- Historical pre-hardcut verification entries below preserve migration evidence
  from before the runtime path was renamed to `apps/supervisor-api`. Paths such
  as `apps/go-shell`, artifacts named `go-shell-*`, and images named
  `campus-go-shell` / `campus-supervisor-orchestrator` are historical evidence,
  not current runtime truth.
- Go check passed on 2026-04-23:
  Later rerun also passed on 2026-04-24.

  ```bash
  PATH="/home/reptilian/code/campus-agent/.tmp/go-toolchain/go/bin:$PATH" pnpm go:check
  ```

- `pnpm docker:lint` passed on 2026-04-23.
- Focused markdown lint for `apps/go-shell/README.md` and workstream docs passed
  on 2026-04-23.
- `docker build -f apps/go-shell/Dockerfile -t campus-go-shell:local .` passed on
  2026-04-23.
- `docker build -f apps/supervisor-api/Dockerfile`
  `-t campus-supervisor-orchestrator:local .` passed on 2026-04-23.
- Historical container smoke passed on 2026-04-23:
  - `GET /healthz` on the pre-hardcut Go prototype returns `200`.
  - `GET /readyz` on the pre-hardcut Go prototype returns aggregated `503 degraded`
    when Python worker prompt runtime is not admitted.
  - `POST /api/v1/answer` through the two-container harness returns `200`
    with current Python orchestration semantics
    (`needs_clarification` in the recorded smoke).
- Updated local compose smoke passed again on 2026-04-24 with artifacts under
  `.tmp/go-shell-local-smoke/20260424T011207/`:
  - `healthz.json`
  - `readyz.json`
  - `metrics-final-clean.txt`
  - `answer-final.http`
- Python compatibility parity rerun passed on 2026-04-24:
  - `python-answer.json` and `go-shell-answer-parity.json` matched on
    `selected_target` / `status` / `follow_up_question` / `confidence` /
    `trace_id`
- Focused markdown lint passed on 2026-04-24 for:
  - `apps/go-shell/README.md`
  - `docs/runbooks/go-shell-local-runtime-smoke.md`
  - `docs/runbooks/README.md`
- Environment-side hard-cut support validation passed on 2026-04-24:
  - `bash -n` passed for `infra/local/staging/supervisor-api-staging-common.sh` and all
    `supervisor-api-staging*.sh` lifecycle scripts
  - `docker compose -f infra/local/docker-compose.supervisor-runtime.yml config`
    passed with dummy bridge / worker secrets
  - `uv run --all-packages python -m scripts.doctor_env supervisor-api --json`
    passed
  - focused markdown lint passed for changed pre-hardcut staging docs and
    workstream docs
- Phase 7 runtime-kernel verification passed on 2026-04-24:
  - `PATH="$PATH:$(go env GOPATH)/bin" pnpm go:check`
  - `pnpm exec markdownlint-cli2` for touched pre-hardcut docs / contracts /
    architecture docs / runbooks / workstream docs
  - `pnpm yaml:lint`
  - `docker compose -f infra/local/docker-compose.supervisor-runtime.yml config`
    with dummy bridge / worker secrets
- Full `pnpm docs:lint` passed during the 2026-04-24 hardcut closeout
  verification.
- Execution audit focused verification passed on 2026-04-24:
  - `pnpm --dir apps/app-api test:node --`
    `operator-observability-ingest.route.test.ts`
    `operator-observability-command.service.test.ts`
    `projection.service.test.ts telemetry.axiom.test.ts`
  - `go test ./... -count=1` in `apps/go-shell`
- Phase 8-9 targeted red/green verification passed on 2026-04-24:
  - `PATH="$PATH:$(go env GOPATH)/bin" go test ./internal/bridge`
    `./internal/httpapi ./internal/structuredquery -count=1`
  - `uv run --all-packages python -m unittest`
    `tests.api.supervisor_api_bridge_suite`
- Phase 10 transport schedule query kernel verification passed on 2026-04-24:
  - `PATH="$PATH:$(go env GOPATH)/bin" pnpm go:check`
  - `uv run --all-packages python -m unittest`
    `tests.agent.test_campus_services_agent`
    `tests.api.supervisor_api_bridge_suite`
    `tests.api.test_supervisor_api_asgi`
  - `uv run --all-packages ruff check apps/supervisor-api/src/campus_supervisor_api`
    `packages/campus-services-agent/src/campus_services_agent`
    `tests/api/supervisor_api_bridge_suite.py`
    `tests/agent/test_campus_services_agent.py`
  - `uv run --all-packages ruff format apps/supervisor-api/src/campus_supervisor_api`
    `packages/campus-services-agent/src/campus_services_agent`
    `tests/api/supervisor_api_bridge_suite.py`
    `tests/agent/test_campus_services_agent.py --check`
  - `pnpm docs:lint`
  - `pnpm yaml:lint`
- Phase 11 forward capability lane alignment focused red/green verification
  passed on 2026-04-24:
  - `PATH="/home/reptilian/code/campus-agent/.tmp/go-toolchain/go/bin:$PATH"`
    `go test ./internal/execution -count=1`
  - `uv run --all-packages python -m unittest`
    `tests.supervisor.test_supervisor_validation`
    `tests.supervisor.test_supervisor_routing`
- Phase 11 broader verification passed on 2026-04-24:
  - `PATH="/home/reptilian/code/campus-agent/.tmp/go-toolchain/go/bin:$PATH"`
    `go test ./... -count=1` in `apps/go-shell`
  - `PATH="/home/reptilian/code/campus-agent/.tmp/go-toolchain/go/bin:$PATH"`
    `go vet ./...` in `apps/go-shell`
  - `PATH="/home/reptilian/code/campus-agent/.tmp/go-toolchain/go/bin:$PATH"`
    `test -z "$(gofmt -l apps/go-shell)"`
  - `uv run --all-packages python -m unittest`
    `tests.contracts.contract_models_request_and_retrieval_suite`
    `tests.supervisor.test_supervisor_validation`
    `tests.supervisor.test_supervisor_routing`
    `tests.api.supervisor_api_bridge_suite`
  - `uv run --all-packages python -m unittest` for the importable supervisor
    suite modules
  - focused `ruff check` / `ruff format --check` for touched Python files
  - `pnpm docs:lint`
  - `pnpm go:check` did not complete because local environment lacks
    `golangci-lint v2.11.4`; its gofmt / go vet stages had already passed before
    the missing linter guard failed
- Phase 12 notice read-model query runtime focused red/green verification passed
  on 2026-04-24:
  - `PATH="$PWD/.tmp/go-toolchain/go/bin:$PWD/.tmp/go-tools/bin:$PATH"`
    `go test ./internal/structuredquery ./internal/config ./internal/httpapi -count=1`
    in `apps/go-shell`
  - `uv run --all-packages python -m unittest`
    `tests.agent.test_notice_runtime_wiring`
    `tests.agent.test_notice_agent`
    `tests.api.supervisor_api_bridge_suite`
- Phase 13-15 bridge hardening focused verification passed on 2026-04-24:
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `go test ./...` in `apps/supervisor-api`
  - `uv run --all-packages python -m unittest`
    `tests.api.supervisor_api_bridge_suite`
    `tests.api.supervisor_api_settings_and_health_suite`
    `tests.api.test_supervisor_api_prompt_stack`
    `tests.supervisor.supervisor_core_routing_suite`
  - `pnpm docs:lint`
  - local two-container Docker smoke artifacts:
    `.tmp/supervisor-api-local-smoke/20260424T163455Z/summary.json`
- Fresh closeout verification rerun passed on 2026-04-24:
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `pnpm go:check`
  - `uv run --all-packages python -m unittest`
    `tests.api.supervisor_api_bridge_suite`
    `tests.api.supervisor_api_settings_and_health_suite`
    `tests.api.test_supervisor_api_prompt_stack`
    `tests.supervisor.supervisor_core_routing_suite`
  - focused `ruff check` / `ruff format --check` for touched Python bridge,
    supervisor-core and targeted test files
  - `pnpm docs:lint`
  - `git diff --check`
  - local two-container Docker smoke artifact:
    `.tmp/supervisor-api-local-smoke/20260424T164328Z/summary.json`
  - `docs/runbooks/supervisor-api-local-runtime-smoke.md` now records that
    answer smoke must wait for `bridge_runtime.reachable=true` and
    `bridge_runtime.circuit_state=closed`, not only `/healthz`
- Phase 16-19 focused red/green verification passed on 2026-04-25:
  - `PATH="$PWD/.tmp/go-tools/bin:$PWD/.tmp/go-toolchain/go/bin:$PATH"`
    `pnpm go:check`
  - `PATH="$PWD/../../.tmp/go-tools/bin:$PWD/../../.tmp/go-toolchain/go/bin:$PATH"`
    `go test ./internal/config ./internal/structuredquery ./internal/executionaudit`
    `./internal/telemetry ./internal/observability ./internal/httpapi -count=1`
    in `apps/supervisor-api`
  - `uv run --all-packages python -m unittest`
    `tests.agent.test_campus_services_agent`
    `tests.api.supervisor_api_bridge_suite`
  - `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts`
    `test/supervisor-adapter.test.ts`
  - `pnpm --dir apps/app-api typecheck`
  - `pnpm docs:lint`
  - `pnpm exec biome check apps/app-api/src/modules/integration/supervisor.ts`
    `apps/app-api/test/supervisor-adapter.test.ts`
  - `git diff --check`
  - Note: `pnpm --dir apps/app-api test:node -- supervisor-adapter.test.ts`
    incorrectly ran the full app-api node lane and hit an unrelated
    `auth-and-db.test.ts` timeout; the targeted Vitest command above passed.
  - Note: full `pnpm web:lint` still fails on unrelated public-docs formatting /
    `!important` baseline in `apps/public-docs/scripts/sync-real-docs/curriculum.ts`,
    `apps/public-docs/test/sync-real-docs.test.ts`, and
    `apps/public-docs/theme/docs-ui.css`; the two touched app-api files pass
    targeted Biome check.

## Continuity Notes

- 不把 Go runtime 类型泄漏进 `packages/contracts`。
- 不把 product-layer auth/session/rate-limit/request projection 移入 `supervisor-core`。
- Go `apps/supervisor-api` 应兼容当前 `app-api -> supervisor-api` internal execution contract。
- Python orchestration bridge 是迁移安全阀，不是长期腐烂兼容层；每个保留边界都要有 owner。
- Go structured query runtime 是 internal query service seam，不是 product API、
  browser-facing tool endpoint 或 `app-api` control plane。
- `transport_schedule_lookup` 当前已有 runtime kernel；不得把 runtime kernel readiness
  冒充成 product serving lane opening。
- `campus_services` / `notice` 作为 explicit internal execution capability label
  可进入对应 Go lane；这不等同于 public chat surface 已开放这些 capability。
- Bridge circuit breaker 属于 Go `supervisor-api` transport / protocol hardening；
  不替代 `app-api` product-layer user limit、热点合并或 duplicate-submit UX。

## Completed Implementation

2026-04-23:

- Added `apps/go-shell` Go module targeting Go `1.26.x`.
- Added `net/http` service entrypoint with structured `slog` JSON logging.
- Added `/healthz`, `/readyz` and `/api/v1/answer`.
- Added request body limit handling, strict top-level JSON object validation and
  fail-closed `bridge_not_configured` behavior.
- Added global admission limiter with transport saturation status.
- Added Dockerfile with container listener configured via
  `CAMPUS_AGENT_HTTP_HOST=0.0.0.0`.
- Added root `pnpm go:check` lane and GitHub Actions Go runtime job.
- Added Go-side external request projection with `bearer` / `trusted-worker`
  auth parity and stable `SupervisorRequest` bridge payload encoding.
- Added private HTTP bridge client for `/internal/bridge/supervisor/answer` and
  `/internal/bridge/readyz`.
- Added `/readyz` aggregation that preserves Python worker runtime status while
  publishing Go transport admission as `transport_runtime`.
- Added repo-owned Python orchestration worker Dockerfile and local compose
  harness at `infra/local/docker-compose.supervisor-runtime.yml`.
- Added Go unit coverage for execution projection, bridge client and bridge
  response handling.
- Confirmed live two-container smoke with the Go runtime fronting Python orchestration.
- Added `supervisor-api`-owned Prometheus-style `/metrics` endpoint.
- Added `supervisor-api`-owned request metrics for request total, duration, inflight,
  transport saturation and bridge failure classes.
- Added answer-path structured logs with `trace_id`, `status_code`, `outcome`
  and `duration_ms`.
- Added bridge answer success/failure fingerprint fields to `/readyz`.
- Added cancellation-path behavior that stops waiting on bridge calls after
  client disconnect.
- Added repo-owned local smoke / shutdown runbook at
  `docs/runbooks/go-shell-local-runtime-smoke.md`.
- Confirmed Go runtime front-door behavior against the private Python
  orchestration bridge with the same `trusted-worker` request and fixed
  `trace_id`.
- Added repo-owned staging hard-cut lifecycle scripts under
  `infra/local/staging/supervisor-api-staging-*`.
- Added repo-owned supervisor-api staging scheduled-task installer.
- Added canonical staging runbooks:
  - `docs/runbooks/supervisor-api-staging-operations.md`
  - `docs/runbooks/supervisor-api-staging-smoke-runbook.md`
- Removed active dev-backed Python public ingress scripts and runbooks after
  the Go `apps/supervisor-api` hardcut.

## Phase 7 Completed Implementation

- non-empty `request_id` is required for answer execution lifecycle
- Go in-flight lifecycle registry rejects duplicate active `request_id`
- `POST /internal/execution/cancel` marks active execution as
  `cancel_requested` and releases the Go wait path
- admission now supports global + per-lane budgets for `rag`, `navigation`,
  `campus_services`, `notice` and `default`
- `/readyz` and `/metrics` expose lane, lifecycle final-state and telemetry
  runtime state
- OTel trace exporter seam is disabled by default and fail-open on answer path
- execution audit emitter is disabled by default, fail-open, bounded, and sends
  only allowlisted runtime events to `app-api` internal ingest
- `/readyz` and `/metrics` expose execution audit runtime status without making
  audit sink health a readiness blocker

## Phase 8 Completed Implementation

- Go bridge client now calls Python private
  `POST /internal/bridge/execution/cancel`
- Go cancel endpoint returns `bridge_cancel_status` while preserving
  `202 cancel_requested` for active executions
- Python bridge keeps a request-scoped cancel flag store
- Python bridge cancel route returns `202 cancel_requested` for active request ids
  and `404 execution_not_found` otherwise
- cooperative cancel metrics are exposed under `/metrics`
- provider / prompt executor mid-flight cancellation remains out of scope

## Phase 9 Completed Implementation

- Go `apps/supervisor-api` exposes internal structured query routes:
  - `POST /internal/query/campus-services/service-status`
  - `POST /internal/query/campus-services/transport-schedule`
- structured query routes require `x-supervisor-query-auth`
- `service_status_lookup` can resolve a configured file projection fixture
- `transport_schedule_lookup` initially returned `temporarily_unverifiable` with
  `source_family_unavailable`; this fail-closed seam was superseded by Phase 10
- `/readyz` reports `structured_query_runtime`
- `/metrics` reports `campus_supervisor_api_structured_query_requests_total`

## Phase 10 Completed Implementation

- `transport_schedule_lookup` reads configured schedule projection records:
  - `transport_schedule_snapshots`
  - `transport_routes`
  - `scheduled_departures`
  - `transport_service_exceptions`
- Go query kernel supports:
  - `schedule_snapshot_metadata`
  - route clarification for missing / ambiguous selectors
  - `next_departure`
  - `first_departure`
  - `last_departure`
  - `departure_list`
  - `service_window`
  - `timetable`
  - temporary suspension summaries with `related_notice_refs`
- service-date semantics use Go `apps/supervisor-api` trusted runtime time in `Asia/Shanghai`
- `campus-services-agent` now has `CampusServicesHTTPQueryService` as the
  Python thin adapter for the Go internal query seam
- `supervisor-api` injects the campus-services query service only when
  `SUPERVISOR_STRUCTURED_QUERY_BASE_URL` and
  `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET` are configured
- product routing remains gate-closed; this implementation does not by itself
  open `campus_services` serving

## Phase 11 Completed Implementation

- shared `requested_capability` contract now accepts:
  - `knowledge`
  - `place_lookup`
  - `campus_services`
  - `notice`
- Go execution parser maps:
  - `knowledge` / missing capability -> `rag` lane
  - `place_lookup` -> `navigation` lane
  - `campus_services` -> `campus_services` lane
  - `notice` -> `notice` lane
- Go execution parser rejects `requested_scope` and non-current `version_query`
  for non-knowledge capability labels
- supervisor validation accepts explicit `campus_services` / `notice` while
  preserving knowledge-only scope/version semantics
- supervisor routing delegates explicit `campus_services` / `notice` requests to
  corresponding agent-owned structured runtime payloads
- existing knowledge-path structured runtime candidates remain gate-closed and
  still route through the current `rag-agent` path unless a higher-level surface
  explicitly admits a forward capability

## Phase 12 Completed Implementation

- Go `apps/supervisor-api` exposes internal structured query routes:
  - `POST /internal/query/notices/discover`
  - `POST /internal/query/notices/get`
- notice structured query routes require `x-supervisor-query-auth`
- Go notice runtime consumes `payload + access_context` envelope so restricted
  internal notice authorization is enforced in Go
- Go notice runtime reads `ingestion_projection.internal_notice_read_model`
  through `pgx/v6`
- Go notice get reads canonical markdown bodies from S3-compatible derived bucket
  through AWS SDK v2 S3 client with path-style endpoint support
- `NoticeHTTPQueryService` is now the Python notice-agent thin adapter for the Go
  internal query seam
- Python notice-agent no longer defaults to env-built PG/S3 read-model runtime;
  direct Python PG/S3 notice query code was removed from the active package
- `supervisor-api` injects notice HTTP query service when
  `SUPERVISOR_STRUCTURED_QUERY_BASE_URL` and
  `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET` are configured
- product routing remains gate-closed; this implementation does not by itself
  open `notice` serving

## Phase 13 Completed Implementation

- Python bridge cancel flag store now exposes request-scoped cancel checks
- worker answer route stops before and after agent dispatch when cancel is observed
- default agent dispatch checks cancellation around prompt execution and agent delegation
- Python bridge returns `499 execution_cancelled` as a `supervisor_error` bridge
  envelope for cancelled executions
- Go `apps/supervisor-api` maps bridge cancellation terminal responses to lifecycle
  final state `canceled` instead of generic bridge failure

## Phase 14 Completed Implementation

- Go bridge circuit breaker opens after configured consecutive bridge transport /
  protocol failures
- while open, answer path returns `503 supervisor_bridge_circuit_open` without calling
  the Python bridge
- `/readyz` reports degraded bridge runtime with `circuit_state=open`
- `/metrics` exposes circuit state, open count and rejected count
- valid bridge envelopes reset the breaker; semantic supervisor errors are not treated as
  bridge transport failure

## Phase 15 Completed Implementation

- execution audit failure / cancellation events now carry measured bridge duration where
  available
- admitted request audit events carry queue wait summary where available
- audit payload remains allowlisted runtime summary only; no raw `user_goal`, prompt,
  answer, transcript, auth material, retrieval payload or provider raw response is emitted

## Phase 34-38 Completed Implementation

- Bridge envelope is now `supervisor_bridge_v4`.
- Go `runtime_decisions.handoff` projects full `agent_request` with trace,
  actor, context, payload and allowed tools; Python parser no longer assembles
  agent requests from payload fragments.
- Python bridge answer handling no longer emits runtime audit records; execution audit
  remains Go-owned.
- Opened structured capabilities can complete through Go direct runtime on both
  `/api/v1/answer` and lifecycle SSE `/api/v1/answer/stream`.
- Production supervisor terminal prompt executor, prompt packets, registry and
  markdown templates have been removed from `packages/supervisor-core`; deterministic
  terminal wording is Go `terminal_envelope` truth.
- Prompt runtime admission now requires the provider, API key, strict structured
  outputs and agent model used by the RAG executor; the removed supervisor
  terminal model is no longer an admission blocker.
- Guard tests cover v4-only bridge parsing, full `agent_request` handoff, deleted
  framing / supervisor prompt stack files, and Python bridge audit emission removal.

## Remaining Implementation

- product-layer cancellation UX belongs to
  `chat-capacity-and-cancellation-hardening`
- provider / prompt executor hard-abort after a blocking HTTP call has started remains
  future work
- `transport_schedule_lookup` opening gate / eval evidence remains future work
- `campus_notice_discover` / `campus_notice_get` opening gate / eval evidence
  remains future work
- actual environment cutover / rollback drill execution remains environment-side
  rollout work
