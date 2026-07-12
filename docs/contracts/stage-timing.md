---
doc_type: contract
truth_scope: ops
owner_boundary: apps/execution-control
status: active
created: 2026-07-03
updated: 2026-07-11
---
# Runtime Stage Timing Contract

## Boundary

This contract freezes `stage_timing.v1`, the repo-owned safe latency projection
for online answer requests.

It answers:

- which per-request timing fields may enter app-api request observability facts
- which runtime owns each timing field
- how Operator Console, metrics and learning-loop consumers may interpret timing
- why raw SDK traces, raw provider payloads and raw Temporal history do not
  define product-safe latency truth

It does not define:

- OpenAI Agents SDK trace payloads
- Langfuse OTLP payloads
- Sentry, Axiom or Collector schemas
- Temporal workflow history shape
- Operator Console layout
- alert thresholds or release SLOs. The repo-owned per-field latency budget
  artifact is `configs/runtime/latency-budgets.v1.json`; it classifies this
  contract's fields for ops summary and learning-loop intake, but does not
  change the timing field contract.

## Shape

`stage_timing.v1` is a JSON object whose keys are allowlisted stage names and
whose values are durations in milliseconds:

```json
{
  "request.total_ms": 1840,
  "stream.browser_ttft_ms": 920,
  "agent.primary_ms": 1380,
  "agent.first_delta_ms": 710,
  "knowledge.search_ms": 360
}
```

Rules:

- Keys must come from the canonical field table below.
- Values must be finite non-negative numbers.
- Values are durations in milliseconds.
- Missing fields mean the stage did not run or the current producer cannot
  measure it.
- Producers must not write `0` as a placeholder for missing data.
- Consumers must not infer unreported stages from another stage.
- Timestamps, booleans, strings, arrays and nested objects are not valid timing
  values.

`stage_timing.v1` is a safe projection. It must not contain raw prompt, raw
answer, raw transcript, raw trace body, raw provider response, raw tool IO, raw
retrieval payload, raw memory text, auth material, secrets, local file paths,
object-store keys or Temporal raw history.

## Canonical Fields

| Field | Producer | Meaning |
| --- | --- | --- |
| `request.total_ms` | `apps/app-api` | Product request duration from accepted app-api request to terminal projection visible to app-api. |
| `stream.browser_ttft_ms` | `apps/app-api` | Time from accepted browser-facing request to first answer delta emitted to the browser stream. |
| `execution.admission_ms` | `apps/execution-control` | Time spent admitting the run into the execution path before productive runtime work starts. |
| `memory.recall_ms` | `apps/execution-control` | Duration of personal memory recall and safe memory context projection. |
| `agent.primary_ms` | `apps/execution-control` | End-to-end duration of the single Agent Activity, including primary/Knowledge Agent handoff and SDK tools. |
| `agent.runtime_ms` | `apps/agent-runtime` | Duration of the complete OpenAI Agents SDK run. |
| `agent.first_delta_ms` | `apps/agent-runtime` | Time from agent-runtime request start to first visible answer delta. |
| `tool.total_ms` | `apps/execution-control` | Total projected duration of SDK tool calls for the run, including internal `knowledge_search`. |
| `tool.transport_schedule_lookup_ms` | `apps/execution-control` | Duration of the admitted `transport_schedule_lookup` branch when selected. |
| `knowledge.search_ms` | `apps/execution-control` | Sum of projected durations for internal `knowledge_search` calls in the Agent Activity. |
| `finalization.write_ms` | `apps/execution-control` | Duration of sanitized finalization projection write. |
| `projection.closeout_ms` | `apps/app-api` | Duration between execution finalization receipt and app-api observability fact closeout. |

Do not add vendor-specific fields to this table. If a field is useful only
inside Langfuse, OpenAI SDK tracing, Sentry, Axiom or Temporal UI, keep it in
that sink and expose only a safe deep link or correlation id through app-api.

`provider_queue_ms` is not a required repo-owned timing field. Provider-internal
queueing is not a stable repo-owned measurement unless an explicit
contract admits a safe provider-derived projection. Use `agent.first_delta_ms`,
`agent.runtime_ms`, `stream.browser_ttft_ms` and the correlated external trace
for launch latency diagnosis.

Every canonical field above must be admissible by
`configs/runtime/latency-budgets.v1.json`. A field may be missing from an
individual request because that stage did not run, but it must not be missing
from the versioned budget artifact. `pnpm contracts:check` enforces that budget
rules use canonical field names, unique enabled fields, unique candidate
reasons, exact enabled-field coverage of the canonical field table and
`critical_ms > warn_ms`.

## Producer Rules

`apps/app-api` owns browser-facing and app-api projection timings:

- `request.total_ms`
- `stream.browser_ttft_ms`
- `projection.closeout_ms`

`request.total_ms` is measured from app-api request acceptance to terminal
request projection. `stream.browser_ttft_ms` is measured only for browser
streaming requests that emit a real answer delta. `projection.closeout_ms` is
measured from execution finalization receipt to app-api observability fact
closeout.

`apps/execution-control` owns durable runtime aggregation:

- `execution.admission_ms`
- `memory.recall_ms`
- `agent.primary_ms`
- all `tool.*_ms` fields
- all `rag.*_ms` fields
- `finalization.write_ms`

Execution-control aggregates these fields from sanitized durable run and step
attempt projections when building the final execution response. It must not
read raw Temporal history or raw provider / SDK payloads to build
`stage_timing.v1`.

`apps/agent-runtime` owns local primary-agent runtime timings:

- `agent.runtime_ms`
- `agent.first_delta_ms`

Each producer must emit only fields it owns. Cross-service aggregation happens
at execution-control or app-api projection boundaries; producers must not copy
raw downstream trace payloads into `stage_timing`.

## Consumer Rules

Operator Console may show grouped timing summaries and safe external sink
links. It must not render raw spans, raw trace trees, raw Temporal history or
raw Langfuse / Sentry / Axiom payloads.

Operator Console renders canonical timing fields with product/operator labels
instead of raw field names. Unknown stage timing keys are not rendered.

Learning-loop candidate selection may use canonical fields to select latency
outliers. It must not use raw debug trace bodies, raw prompts, raw answers or
raw provider payloads as repo-owned candidate facts.

Metrics and OTel adapters may derive low-cardinality histograms from canonical
fields. Stage names from this document are bounded labels. Request ids, user
ids, raw URLs, raw errors and arbitrary tool names are not valid metric labels.
The app-api runtime event for this projection is `request.stage_timing`; it
emits one event per canonical numeric field with `stage_field`, `duration_ms`
and budget state only.

`configs/runtime/observability-alerts.v1.json` defines repo-owned symptom alert
policy for this projection. It records signal, threshold, severity, window and
runbook anchor for Collector/backend alert setup. The artifact must materialize
to one Axiom monitor spec per enabled alert rule through
`packages/contracts/scripts/contracts/materialize-observability-alerts.ts`; the contract gate validates that
materialization. It does not create an Operator Console dashboard or mirror
external sink data.

App-api stores `stage_timing.v1` in request observability facts. It validates
canonical finite numeric fields before exposing Operator-safe projections and
fails closed on non-canonical app-api-owned timing fields.

## Relationship To Distributed Tracing

`stage_timing.v1` answers which repo-owned stage was slow. OpenAI Agents SDK
spans, Temporal tracing, Langfuse, Sentry and Axiom can provide additional
diagnostic detail, but they do not replace this projection.

App-api and Operator Console consume `stage_timing.v1` directly. They do not
store external trace bodies or sink-specific trace links. Timing projection
must never embed SDK spans, provider payloads, tool IO, prompts, answers, source
bodies or memory text.

## Related Documents

- `docs/contracts/app-api/observability.md`
- `docs/contracts/langfuse-runtime.md`
- `docs/architecture/system/ops-observability.md`
- `docs/reference/observability-ledger.md`
- `docs/architecture/system/learning-loop.md`
- `docs/reference/runtime-otel-telemetry-taxonomy.md`
