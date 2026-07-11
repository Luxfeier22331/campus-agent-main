# Active Planning Signals

## Status

There are no tracked active workstream directories in this repo.

This file is the compact repo-level planning signal surface. It is not a
completed-workstream ledger, phase archive, closeout artifact tree, or session
handoff store. Historical workstream and phase material is available through git
history.

This file is a `planning_signal`. It records work signals only. It does not
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
  - project-level planning signals -> `.planning/PROJECT.md` and this file
- Do not recreate tracked `.planning/workstreams`, `.planning/quick`,
  `.planning/legacy-flat`, `.planning/milestones`, `.planning/research`,
  `.planning/todos`, `.planning/codebase`, or `.planning/seeds`.

## Owner Areas

| Area | Scope | Reopen Trigger |
| --- | --- | --- |
| Product Plane | `campus-web` including `/docs/*`, `operator-console-web`, shared `app-api` | Product surface, auth/session, request projection, or browser contract changes |
| Execution Plane | `execution-control`, Temporal workflows, run/step projection, readiness | Workflow topology, projection schema, execution ingress, cancel semantics, or worker readiness changes |
| Tool Plane | RAG, navigation, notice, campus services, semantic worker | New typed tool/activity, agent-as-tool boundary, routing/admission, or tool evidence changes |
| Data Plane | ingestion, object storage, Qdrant, source truth, read models | Source family admission, ingestion release, query-enabled surface, ACL, or data-plane transport changes |
| Ops / QA | staging, release gates, observability, deploy hygiene | Staging closeout, release smoke, ingress, secrets, closeout artifact, or monitoring changes |

## Recovery Rule

If a deleted planning archive contains useful context, recover only the specific
decision, requirement, or closeout reference into an active doc/ADR/runbook with
current terminology. Do not restore the archive directory or treat old phase
status as current project truth.

## Current Signal Ledger

- Ops / QA signal: Temporal execution-control normal-path release closeout has
  real `nc-arm-6c` artifacts; remaining closeout work is failure-mode coverage
  for cancel, timeout, late completion, and panel/eval/operator consumption.
  This is release/ops work, not the definition of main-chain architecture
  completion.
- Execution-plane signal: main answer path first-decision work has moved into
  the primary agent SDK loop:
  direct/no-tool turns finalize from `agent.primary`; knowledge turns use
  `knowledge_query` to enter the Go RAG graph. Ordinary chat with missing
  `requested_tool` now remains an absent caller hint and lets `agent.primary`
  choose within the admitted visible tool set. Model-selected campus-services /
  notice read-only tools now project success / fail-close results as normalized
  `sdk_tool.execute.<tool>.<index>` tool steps. Clarification and out-of-scope
  terminal outcomes now project as typed `needs_clarification` / `rejected`
  finalization responses. Strict SDK tool argument schema is hardened by the
  canonical `tool_function_schemas.v1` fixture and execution-control validation;
  remaining runtime closeout is tracked as ops/release work.
- Operator / eval signal: step projection remains the panel/eval/operator
  diagnostic spine and carries cancel/timeout/late-completion/token/cost/
  fail-close/replan operator diagnostic evidence for local failure-mode
  projection tests.
- Operator / eval signal: eval, badcase and release closeout consumption should
  converge on the app-api-owned `operator_step_trajectory.v1` export. Real
  closeout and Temporal metrics sampling remain deferred until the runtime path
  is mature.
- Ops signal: worker autoscaler remains an operations-plane projection. It reads
  Temporal/task queue metrics and downstream budgets, outputs desired replicas,
  and never writes workflow/run/event/terminal state.
- Tool-plane signal: notice, navigation and campus-services tools
  should continue as typed activity/tool contracts, not entry-level agents.
- Tool-plane signal: campus services P1 now has an app-api
  operator-maintained source channel base:
  manual attestations, bounded transport overrides, preview,
  publish release snapshot, audit events, and execution-control consumption of
  published current-effective release snapshots. Remaining runtime closeout
  and tool-opening work belong to tool/ops tracking, not main-chain
  completion.
- Product-plane signal: conversation attachment upload is now captured as a
  proposed PRD in `docs/product/attachments.md`. It is a
  per-message user-provided image/document context feature for `campus-web` Q&A,
  not an institution RAG ingestion path, notice/source-truth path, release
  closeout path or long-term personal file library. Until the backend contract
  and execution projection are implemented, the browser attachment entry must
  remain hidden or fail closed.
- Tool-plane signal: dining published projection is eligible for explicit
  product/tool admission into
  the Q&A path as a read-only `campus_services` typed tool such as
  `dining_lookup`. It must read app-api-owned published dining projection, not
  Lark / Feishu Base, raw dining draft, release candidate, source observation or
  floorplan SVG assets. This is a deferred tool expansion signal, not a
  current implementation gap until a ToolSpec / contract is accepted.
- Tool-plane signal: dining operator review/apply remains deferred. If accepted,
  it must enter through a product requirement and operations contract before
  adding observation listing, apply or reject routes.
- Document reader appendix / form downloads are deferred planning signals, not part of
  the current docs hardening closeout. Current reader delivery renders appendix
  tables as reader sections/blocks. An accepted reader supplement should
  expose "download original appendix" only when source truth contains a real
  original file asset, delivered under the same document version package;
  generated table exports may be added separately but must not be labeled as
  original source files.
- Execution-plane signal: bounded semantic retry / replan is now implemented as
  an explicit typed
  outcome allow-list: `provider_timeout`, `tool_handler_failed`,
  `provider_connection_aborted`, `tool_executor_not_configured`, and
  `transient_internal_query_failed` can replan once inside the same visible
  tool set; deterministic semantic/policy/contract/admission failures
  and unclassified failures fail closed.
- Ops signal: remote deploy worktrees must remain clean pinned deploy checkouts;
  secrets and runtime env belong to ops/Docker-managed config, not repo checkout
  state.

## Implementation Gap Ledger

This ledger records only work that is already required by active docs/contracts
and not yet closed by current merged code truth. It is not a place for deferred
product opening, release closeout, downstream consumers, content quality, or
badcase-driven hardening signals.

Scope rules:

- Include only gaps where an active doc or contract defines a target behavior and
  current code does not yet close that behavior.
- Exclude release closeout, content-quality maturity, product
  opening decisions, and tools intentionally kept closed unless
  they require code to become available.
- Exclude old-document contradictions once the owning doc has been corrected.

Current active implementation gaps:

- Campus-services current primary-agent exposure is intentionally limited to
  `transport_schedule_lookup`. Generic service status, service guide, contact
  directory, and academic calendar lookup are not active implementation gaps for
  this workstream.

Current non-gaps after the doc audit:

- Main answer chain completion is judged by the generic execution skeleton, not
  by every tool's content maturity or product opening.
- Explicit personal memory upsert / disable / owner-disable and post-finalization
  inferred memory update are implemented through
  `app-api -> execution-control -> Hindsight`; Qdrant personal memory has been
  retired. Candidate confirmation UI / strong governance requires separate product
  work, not a current main-chain gap.
- Campus-services read-only contracts can exist without being model-visible.
  Current model-visible campus-services exposure is limited by `tools.v4` and
  runtime profile `open_tools`; `service_process_lookup` requires separate
  admission.
- Notice content maturity and manual校对 work are data / quality work, not a
  generic main-chain implementation gap.
- Go RAG `grounding.verify` is current evidence-integrity verification, not
  claim-level semantic grounding. Semantic grounding can only re-enter as
  badcase/eval-driven hardening.

Deferred signals that must not be treated as active implementation gaps:

- Concrete freshness/live source executor, source-selection policy, and product
  opening for a real live surface.
- `official_web/fresh_news` and `official_web/news_archive` opening after their
  checklist, metadata, duplicate-collapse, freshness gate, and eval conditions
  are satisfied.
- Navigation map/route/current-location product opening after spatial truth and
  map surface work resumes.
- Production storage, panel consumption, or release-closeout consumption of
  `retrieval.runtime_observation`.
