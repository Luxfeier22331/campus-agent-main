---
doc_type: reference
truth_scope: ops
owner_boundary: docs/reference
status: active
created: 2026-07-04
updated: 2026-07-04
---
# Observability Completion Ledger

## 文档边界

本文是在线链路 trace / observability 目标态的 reference ledger。它回答：

- 哪些观测能力已经进入实现
- 哪个 contract、runtime 或 job 拥有该能力
- 哪个测试或检查命令防止回退

它不替代：

- stage timing 字段 contract：
  `docs/contracts/stage-timing.md`
- Langfuse payload contract：
  `docs/contracts/langfuse-runtime.md`
- OTel signal taxonomy：
  `docs/reference/runtime-otel-telemetry-taxonomy.md`
- Collector 操作步骤：
  `docs/runbooks/runtime-otel-collector-pipeline.md`

## Completion Rule

一项观测能力只有同时满足以下条件，才允许标记为 complete：

- `designed`：有 active architecture / contract / runbook 定义边界。
- `implemented`：有 runtime、job、script 或 config 实现。
- `externally_consumed`：进入 Sentry、Axiom、Langfuse、Operator Console、
  learning-loop job 或 contract gate 中至少一个消费面。
- `verified`：有 tracked test、typecheck、contract check 或 collector validation
  命令可以重复执行。

只写文档、只加字段、只通过 smoke、只存在外部平台截图，都不能单独标记 complete。

## Ledger

| Capability | Owner | Status | Verification |
| --- | --- | --- | --- |
| Canonical `stage_timing.v1` field table | `docs/contracts/stage-timing.md` + generated contracts | complete | `pnpm contracts:check`; `uv run --all-packages python -m unittest discover -s tests/contracts -t . -q` |
| App-api stage timing event and histogram projection | `apps/app-api` | complete | `pnpm --dir apps/app-api test -- telemetry.index.test.ts telemetry.otlp.test.ts request-observability.stage-timing.test.ts` |
| Execution-control stage timing producer mapping | `apps/execution-control/internal/httpapi` | complete | `cd apps/execution-control && go test ./internal/httpapi -run 'TestStageTimingForRun' -count=1` |
| Agent-runtime primary-agent runtime / first-delta timing | `apps/agent-runtime` | complete | `pnpm --dir apps/agent-runtime test -- primary-agent.test.ts http-server.test.ts` |
| Latency budget coverage for every canonical stage field | `configs/runtime/latency-budgets.v1.json` | complete | `pnpm contracts:check` |
| Alert policy materialization to Axiom monitor specs | `configs/runtime/observability-alerts.v1.json` + `scripts/materialize_observability_alerts.py` | complete | `uv run --all-packages python -m unittest tests.test_materialize_observability_alerts -q`; `pnpm contracts:check` |
| Collector traces fan-out | `infra/otel` + K8s execution runtime config | complete | `uv run --all-packages python -m unittest tests.infra.test_k8s_execution_runtime_manifests -q`; `otelcol-contrib validate --config=infra/otel/collector-staging-template.yaml` with populated env |
| Collector logs fan-out to Axiom events dataset | `infra/otel` + K8s execution runtime config | complete | `uv run --all-packages python -m unittest tests.infra.test_k8s_execution_runtime_manifests -q` |
| Collector metrics fan-out to Axiom metrics dataset | `infra/otel` + K8s execution runtime config | complete | `uv run --all-packages python -m unittest tests.infra.test_k8s_execution_runtime_manifests -q`; `pnpm --dir packages/eval-langfuse test -- langfuse-core.test.ts` |
| Langfuse trace verification adapter | `packages/eval-langfuse` | complete | `pnpm --dir packages/eval-langfuse test`; `pnpm --dir packages/eval-langfuse typecheck` |
| Learning-loop candidate selection from feedback and stage latency | `jobs/learning-loop-candidates` | complete | `pnpm --dir jobs/learning-loop-candidates test`; `pnpm --dir jobs/learning-loop-candidates typecheck` |
| Learning-loop dataset publish and verify path | `jobs/learning-loop-candidates` + `packages/eval-langfuse` | complete | `pnpm --dir jobs/learning-loop-candidates test`; `pnpm --dir packages/eval-langfuse test` |
| Operator-safe Ops Index boundary | `apps/app-api` + `operator-console-web` docs | complete | `pnpm --dir apps/app-api test -- operator-query.store.request-detail.suite.ts operator-query.store.overview.suite.ts`; no raw sink payload is admitted by contract tests |

## Non-Completion Items

以下事项不属于当前完成台账的缺口：

- 真实 staging trace closeout evidence。它是 release QA 证据，不是当前开发完成条件。
- 外部平台 dashboard 截图。repo 不镜像 dashboard 内容；只维护 safe link、monitor
  spec 与 contract gate。
- OpenAI / provider raw trace 全量入库。raw 或 near-raw LLM IO 只允许进入受控外部
  debug sink，不进入 app-api、Operator Console、Temporal metadata 或 repo-owned
  projection。

## Regression Rule

任何新增 `stage_timing.v1` 字段必须同时更新：

- `docs/contracts/schemas/tool-execution.openapi.yaml`
- generated TS / Go contracts
- `configs/runtime/latency-budgets.v1.json`
- producer mapping or explicit no-synthesize test
- app-api projection tests when the producer is app-api-owned
- learning-loop tests if the field can become a latency candidate

`pnpm contracts:check` 必须在字段缺失、预算未覆盖或 alert 物化失败时失败。
