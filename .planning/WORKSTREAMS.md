# Active Work Map

## Status

There are no tracked active workstream directories in this repo.

This file is the compact repo-level work map. It is not a completed-workstream
ledger, phase archive, evidence tree, or session handoff store. Historical
workstream and phase material is available through git history.

This file is a `planning_work_map`. It records work signals only. It does not
define product truth, architecture invariants, contract truth, data truth,
operator truth or release acceptance criteria.

## Working Model

- Use GSD SDK and Codex native sessions for live workstream/session state.
- Persist durable outcomes in the correct long-lived artifact:
  - architecture truth -> `docs/architecture/`
  - decisions -> `docs/decisions/`
  - contracts -> `docs/contracts/`
  - schemas/data truth -> `docs/data/`
  - operations -> `docs/runbooks/`
  - project-level map -> `.planning/PROJECT.md` and this file
- Do not recreate tracked `.planning/workstreams`, `.planning/quick`,
  `.planning/legacy-flat`, `.planning/milestones`, `.planning/research`,
  `.planning/todos`, `.planning/codebase`, or `.planning/seeds`.

## Owner Areas

| Area | Scope | Reopen Trigger |
| --- | --- | --- |
| Product Plane | `hub-web`, `public-chat-web`, `public-docs`, `protected-panel-web`, shared `app-api` | Product surface, auth/session, request projection, or browser contract changes |
| Execution Plane | `execution-control`, Temporal workflows, run/step projection, readiness | Workflow topology, projection schema, execution ingress, cancel semantics, or worker readiness changes |
| Capability Plane | RAG, navigation, notice, campus services, semantic worker | New typed tool/activity, agent-as-tool boundary, routing/admission, or capability evidence changes |
| Data Plane | ingestion, object storage, Qdrant, source truth, read models | Source family admission, ingestion release, query-enabled surface, ACL, or data-plane transport changes |
| Ops / QA | staging, release gates, observability, deploy hygiene | Staging closeout, release smoke, ingress, secrets, evidence, or monitoring changes |

## Recovery Rule

If a deleted planning archive contains useful context, recover only the specific
decision, requirement, or evidence reference into an active doc/ADR/runbook with
current terminology. Do not restore the archive directory or treat old phase
status as current project truth.

## Current Backlog Signals

- Ops / QA signal: Temporal execution-control normal-path staging closeout has
  real `nc-arm-6c` release evidence; remaining closeout work is failure-mode
  proof for cancel, timeout, late completion, and panel/eval/operator
  consumption. This is release/ops work, not the definition of main-chain
  architecture completion.
- Execution-plane signal: main answer path first-decision work has moved into
  the primary agent SDK loop:
  direct/no-tool turns finalize from `agent.primary`; knowledge turns use
  `knowledge_query` to enter the Go RAG graph. Ordinary chat with missing
  `requested_capability` now stays capability-neutral and lets `agent.primary`
  choose within the admitted visible tool set. Model-selected campus-services /
  notice read-only tools now project success / fail-close results as normalized
  `sdk_tool.execute.<tool>.<index>` tool steps. Clarification and out-of-scope
  terminal outcomes now project as typed `needs_clarification` / `rejected`
  finalization responses. Strict SDK tool argument schema is hardened by the
  canonical `tool_function_schemas.v1` fixture and execution-control validation;
  remaining runtime/staging proof is tracked as ops/release work.
- Operator / eval signal: step projection remains the panel/eval/operator
  diagnostic spine and carries cancel/timeout/late-completion/token/cost/
  fail-close/replan operator diagnostic evidence for local failure-mode
  projection tests.
- Operator / eval signal: eval, badcase and future release evidence should
  converge on the app-api-owned `operator_step_trajectory.v1` export. Real
  staging closeout and Temporal metrics sampling remain deferred until the
  runtime path is mature.
- Ops signal: worker autoscaler remains an operations-plane proof. It reads
  Temporal/task queue metrics and downstream budgets, outputs desired replicas,
  and never writes workflow/run/event/terminal state.
- Capability-plane signal: notice, navigation and campus-services capabilities
  should continue as typed activity/tool contracts, not entry-level agents.
- Capability-plane signal: campus services P1 now has an app-api
  operator-maintained source channel base:
  manual attestations, bounded service-status / transport overrides, preview,
  publish release snapshot, audit events, and execution-control consumption of
  published current-effective release snapshots. Remaining staging/runtime proof
  and capability-opening work belong to capability/ops tracking, not main-chain
  completion.
- Execution-plane signal: bounded semantic retry / replan is now implemented as
  an explicit typed
  outcome allow-list: `provider_timeout`, `tool_handler_failed`,
  `provider_connection_aborted`, `tool_executor_not_configured`, and
  `transient_internal_query_failed` can replan once inside the same visible
  capability/tool set; deterministic semantic/policy/contract/admission failures
  and unclassified failures fail closed.
- Ops signal: remote deploy worktrees must remain clean pinned deploy checkouts;
  secrets and runtime env belong to ops/Docker-managed config, not repo checkout
  state.

## Implementation Gap Ledger

This ledger records work that is already designed in active docs / contracts but
is not yet closed by the current merged code truth. It is the repo-level place
for implementation gaps; architecture, contract, data and runbook documents
should not carry duplicate progress boards.

Scope rules:

- Include only gaps where an active doc or contract defines a target behavior and
  current code does not yet close that behavior.
- Exclude staging proof, release evidence, content-quality maturity, product
  opening decisions, and capability families intentionally kept closed unless
  they require code to become available.
- Exclude old-document contradictions once the owning doc has been corrected.

| ID | Area | Gap | Evidence | Current code fact | Closeout posture |
| --- | --- | --- | --- | --- | --- |
| `retrieval-freshness-live-execution` | Retrieval / knowledge | Generic `live_assisted` / `live_source_lookup` backend seam is now implemented in `retrieval-core`, including missing-executor fail-close and top-k bounding. Remaining gap is a real admitted live source executor / source selection policy and product opening for concrete live surfaces. | `docs/architecture/system/retrieval-serving-architecture.md`, `docs/architecture/system/agentic-retrieval-architecture.md`, `docs/contracts/knowledge-retrieval-plan-contract.md`, `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md` define freshness / live vocabulary and fail-close rules. | `packages/retrieval-core/src/campus_retrieval_core/models.py` accepts `live_assisted` and `live_source_lookup`; `service_plan_execution.py` executes the branch only with an injected live executor; Go RAG projection propagates `version_query` instead of forcing `current`; Qdrant indexed lookup fail-closes for `live_assisted` and unresolved `as_of`. | Partially closed backend seam. Keep this as a deferred concrete-runtime gap until a repo-admitted live source executor and surface-specific opening policy exist. |
| `retrieval-runtime-observation-contract` | Retrieval observability | Go online RAG indexed lookup emits the minimum sanitized `retrieval.runtime_observation` event contract for eval / backlog consumption. Production sink, panel consumption and release evidence remain deferred consumers, not current main-chain blockers. | `docs/architecture/system/retrieval-serving-architecture.md`, `docs/reference/runtime-otel-telemetry-taxonomy.md`, and `docs/runbooks/index-release-runbook.md` define `retrieval.runtime_observation` and the adapter-owned OTel/log/export boundary. | `packages/retrieval-core/src/campus_retrieval_core/service_observations.py` exposes the sink/event shape; `apps/execution-control/internal/httpapi/temporal_retrieval_observation.go` maps Go RAG indexed lookup into sanitized observations with `request_id`, `run_id`, `plan_id`, `step_id`, scope, query/retrieval mode, terminal state, counts, latency and `query_sha256`. | Event contract closed for online indexed lookup. Track any production storage, panel consumer or release-evidence consumer as a separate downstream implementation item when that consumer becomes active. |
| `official-web-fresh-news-runtime` | Official web / retrieval | `fresh_news` / `news_archive` have source profiles and opening contracts, but no active runtime/tool path for freshness-sensitive news answers. | `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`, `docs/reference/official-web-news-surface-opening-checklist.md`, and `docs/reference/official-web-fresh-news-eval-baseline.md` keep news surfaces offline/default-closed and require article detail evidence, freshness gate and bounded live assist or fail-close before opening. | Runtime profiles exist under `configs/ingestion/official_web/*`, while current query-enabled surface remains `official_web/stable_reference`; no model-visible or typed runtime branch opens `fresh_news` / `news_archive`. | Deferred capability implementation gap. Do not treat as a main-chain blocker; close only after the generic freshness/live backend path and news-specific routing/evidence contracts are executable. |
| `navigation-route-map-runtime` | Navigation | Long-term navigation design includes route planning, waypoints, distance/duration, accessibility, entrance selection and request-scoped current-location projection, but current product path keeps navigation closed. | `docs/architecture/domains/navigation/architecture.md` defines the target navigation family; `docs/contracts/navigation-place-finding-contract.md` explicitly defers route/map/current-location contracts. | `apps/execution-control/internal/config/config_test.go` and `apps/execution-control/internal/runtimepolicy/policy_test.go` enforce `place_lookup` fail-close before map rollout; browser/app-api shapes retain `place_card` normalization but do not open product consumption. | Deferred product/capability implementation gap. Not a main-chain blocker. Close when map/navigation rollout starts, with spatial truth and route graph ownership intact. |
| `campus-services-service-process` | Campus services | `service_process_lookup` is designed as a later service capability but remains `keep_closed` and has no active tool admission/runtime contract. | `docs/architecture/domains/campus-services/architecture.md` lists `service_process_lookup` as `keep_closed`; `docs/contracts/service-status-lookup-contract.md` treats it as later expansion. | `apps/agent-runtime/src/tool-catalog.ts`, `apps/execution-control/internal/runtimepolicy/tool_registry_test.go`, and structured query endpoints cover `service_status_lookup`, `service_guide_lookup`, `transport_schedule_lookup`, `contact_directory_lookup`, and `academic_calendar_lookup`, not `service_process_lookup`. | Deferred capability implementation gap. Existing campus-services tools are not blocked by this item. |
| `prompt-grounding-validator-depth` | Prompt / knowledge safety | Claim-level grounding validation exists but remains narrower than the full target grounded-generation contract. The first added depth covers degree / credential table-fact claims. | `docs/architecture/system/prompt-and-instruction/safety-observability-and-rollout.md` names grounding validator depth as the remaining gap. | `packages/knowledge-capability` validates generated answers against evidence and records unsupported / downgraded grounding; `grounding_validation_claim_basic.py` now extracts degree / credential claims and requires T0 support. | Partially closed hardening gap. Continue expanding claim extraction/support policy and cross-provider grounded output handling without weakening fail-close behavior. |

Current non-gaps after the doc audit:

- Main answer chain completion is judged by the generic execution skeleton, not
  by every capability's content maturity or product opening.
- Explicit personal memory upsert / disable / owner-disable is implemented
  through `app-api -> execution-control -> Qdrant`; inferred memory update
  workflow remains future target, not a current v1 gap.
- Opened campus-services read-only tools are implemented as model-visible typed
  tools plus Go internal structured query endpoints; only
  `service_process_lookup` remains later-wave.
- Notice content maturity and manual校对 work are data / quality work, not a
  generic main-chain implementation gap.
