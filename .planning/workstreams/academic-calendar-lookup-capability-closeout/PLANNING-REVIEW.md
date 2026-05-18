---
doc_type: planning-review
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Planning Review: Academic Calendar Lookup Capability Closeout

## Review Scope

Reviewed files:

- `README.md`
- `REQUIREMENTS.md`
- `ROADMAP.md`
- `CURRENT-DESIGN.md`
- `PHASE-0-AUDIT.md`
- `STATE.md`
- `.planning/WORKSTREAMS.md`

Compared against implementation facts in:

- `configs/runtime/agents.v1.json`
- `configs/runtime/tools.v1.json`
- `configs/runtime/intent-policy.v1.json`
- `packages/contracts/src/campus_contracts/models_tools.py`
- `packages/campus-services-agent/src/campus_services_agent/*`
- `apps/supervisor-api/internal/structuredquery/academic_calendar.go`
- `packages/ingestion-core/src/campus_ingestion_core/academic_calendar_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/official_web_academic_calendar_projection.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py`
- calendar projection and runtime tests

## Findings Fixed

### P1: README Phase Drifted Behind State

`STATE.md` and `.planning/WORKSTREAMS.md` already record Phase 0 as complete
and Phase 1 as current, but `README.md` still said `current phase: Phase 0`.

Fix:

- `README.md` now records the current phase as
  `Phase 1 - Contract Shape For Calendar Fact Queries`.
- The current posture now explicitly says Phase 0 audit is complete.

### P1: Time Anchor Ownership Was Ambiguous

Initial Phase 1 text listed `time_anchor` as a payload addition. Current code
already uses `temporal_query` for request temporal intent and
`queried_time_anchor` for the server-resolved trusted execution anchor. Adding
a client-controlled free-form `time_anchor` would blur that boundary.

Fix:

- `REQUIREMENTS.md`, `ROADMAP.md` and `PHASE-0-AUDIT.md` now require
  `temporal_query` to remain the request-level temporal intent.
- The trusted execution anchor remains server-owned and result-only through
  `queried_time_anchor`.

### P2: Date-Week Coverage Wording Was Too Broad

The Phase 0 audit listed `2026-05-04 是第几教学周` as supported. Existing Go
runtime tests cover that exact case through `date_hint`; they do not yet prove
arbitrary date extraction from raw `query_text`, and the user-facing acceptance
target is `2026-05-07 是第几教学周`.

Fix:

- `PHASE-0-AUDIT.md` now describes current support as date-hinted exact
  date-to-week lookup.
- `REQUIREMENTS.md` and `ROADMAP.md` keep `2026-05-07 是第几教学周` as Phase
  acceptance coverage to be added.

### P2: Spring Break Gap Needed A Narrower Scope

The initial blocker wording could be read as saying the whole system cannot
ever support `春假`. The actual finding is narrower: the current accepted
2025-2026 calendar source truth lacks an explicit source-backed `春假` event.
The selected-write path can still add support later if source evidence exists.

Fix:

- `README.md` and `REQUIREMENTS.md` now describe this as a current
  source-truth gap.
- The required fix remains source-backed: either curated calendar event data or
  selected-write extraction must provide the event before the query is marked
  supported.

### P1: Data Plane Was Described Too Narrowly

Initial planning described the calendar projection as one-time curated source
truth only. Code shows there is also an official-web selected-write candidate
path that can publish into `calendar/academic_calendar`.

Fix:

- `CURRENT-DESIGN.md` now records both the curated path and selected-write path.
- `REQUIREMENTS.md` now requires Phase 2 to handle both paths.

### P1: Spring Break Support Was Overstated By Implication

The user-facing target includes `今年春假是什么时候`, but current accepted
2025-2026 calendar source truth does not contain an explicit `春假` event
record. The official-web extractor also recognizes several holiday names but
not `春假`.

Fix:

- `README.md`, `REQUIREMENTS.md`, `CURRENT-DESIGN.md`, `ROADMAP.md` and
  `STATE.md` now state this as the current blocker.
- Requirements now forbid inferring `春假` from `春季社会实践周` unless an
  explicit institution-specific alias rule is admitted and documented.

### P1: Contract Generation Path Was Underspecified

Initial roadmap said to update generated Go/Python/TS artifacts without naming
the actual generation path.

Fix:

- `REQUIREMENTS.md` and `ROADMAP.md` now name
  `scripts.generate_supervisor_execution_contracts` as the OpenAPI generated
  artifact path.
- The plan distinguishes `packages/contracts` DTOs from supervisor execution
  generated artifacts.

### P2: Phase 0 Had No Concrete Output

The first roadmap version asked for an audit but did not define a durable
artifact.

Fix:

- Phase 0 now requires `PHASE-0-AUDIT.md` with file owners, existing tests,
  supported examples, unsupported examples and contract decisions.

### P2: Public Chat E2E Ownership Was Ambiguous

The planning required public/chat E2E but did not say how it relates to the
completed `public-chat-campus-services-e2e-acceptance` workstream.

Fix:

- `REQUIREMENTS.md` and `ROADMAP.md` now separate deterministic
  public/chat denominator fixtures from real browser/staging entry evidence.
- Real entry observation remains owned by
  `public-chat-campus-services-e2e-acceptance`.

### P1: Closeout Audit Found Final Drift

The Phase 1-8 implementation changed the correct `春假` outcome from
"event-range required" to source-backed `not_found`, and upgraded the runtime
from simple holiday lookup to typed query-kind resolution. Some planning text
still described pre-implementation gaps as current truth.

Fix:

- `README.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `CURRENT-DESIGN.md` and
  `PHASE-0-AUDIT.md` now reflect the final outcome.
- `GAP-LEDGER.md` records closeout evidence by requirement.
- Go runtime tests now cover missing source refs, unsupported query kind and
  holiday-vs-teaching-week day-status precedence.

### P1: Registry And Provider Contract Drift After Closeout

The workstream-local files marked the line completed, but the repo-level
`.planning/WORKSTREAMS.md` registry still listed it as active Phase 1. The
provider function schema also exposed `query_kind` as a nullable field even
though the final contract requires deterministic query-kind normalization.

Fix:

- `.planning/WORKSTREAMS.md` now moves this workstream to Completed with the
  same reopen rule as `STATE.md` / `GAP-LEDGER.md`.
- `AcademicCalendarLookupPayload` now requires non-empty `query_kind`.
- The bridge payload decoder requires `query_kind` for
  `academic_calendar_lookup`.
- The provider function schema keeps strict JSON-object compatibility while
  making `query_kind` a non-null enum; snapshot and schema tests were updated.
- Existing agent/SDK tests now pass explicit `query_kind`.

## External Basis Checked

- OpenAI function calling docs describe tool/function calling as the way to
  connect models to external systems and data, and recommend strict mode for
  schema-adherent function calls:
  <https://developers.openai.com/api/docs/guides/function-calling>
- OpenAI Structured Outputs docs state schema adherence and recommend using
  evals when choosing structure:
  <https://developers.openai.com/api/docs/guides/structured-outputs>
- OpenAI agent eval docs recommend trace grading for workflow-level issues and
  datasets/eval runs for repeatability:
  <https://developers.openai.com/api/docs/guides/agent-evals>
- RFC 5545 defines `VEVENT` start as inclusive and `DTEND` as non-inclusive:
  <https://www.rfc-editor.org/rfc/rfc5545>

## Remaining Boundaries

- Real browser/staging public-chat observations are delegated to
  `public-chat-campus-services-e2e-acceptance`.
- Future `春假` support requires explicit source-backed event evidence.
- Natural-language relative date arithmetic such as `下周一` remains outside
  this closeout unless normalized into `target_date` / `date_hint`.

## Review Verdict

The workstream is complete within its declared boundary. It correctly
separates:

- runtime ownership, already completed elsewhere
- calendar fact capability completion, owned here
- public/chat real-entry evidence, allowed here or as a named artifact handoff
- data-plane source truth, still owned by `calendar/academic_calendar`
