---
doc_type: roadmap
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Campus-Bounded Autonomous RAG Completion

## Phase Status

- [x] **Phase 0: Admission And Gap Audit** — freeze scope, audit code/docs/eval truth, and turn
  the remaining campus-bounded autonomous RAG gaps into implementation slices.
- [x] **Phase 1: Bounded Agent Handoff And Tool Contract** — harden how supervisor/domain agents
  pass bounded projections and allowed tools into RAG.
- [x] **Phase 2: Query Mode, Version, And Source-Trust Planning** — make query mode/version/source
  trust/freshness posture explicit in plan-time decisions.
- [x] **Phase 3: Evidence Selection And Claim Grounding Hardening** — enforce answer-bearing
  evidence, claim coverage and contradiction/no-answer behavior.
- [x] **Phase 4: Untrusted Content And Tool Guardrails** — quarantine retrieved instructions and
  guard tool/context usage against prompt-injection style failures.
- [x] **Phase 5: RAG Eval Denominator And Regression Gates** — extend RAGAS and workflow evals so
  failures are repeatable and stage-attributed.
- [x] **Phase 6: Runtime Budget, Observability, And Ops Controls** — enforce max turns, budgets,
  cancellation, timeout and trace-safe production diagnostics.
- [x] **Phase 7: Product Path Acceptance And Closeout** — verify public/protected product paths,
  update docs and close the workstream.

## Phase 0: Admission And Gap Audit

**Status:** completed.

**Goal:** Confirm this workstream's exact implementation scope against current merged/worktree truth.

**Scope:**

- Audit `packages/rag-agent`, `packages/retrieval-core`, `packages/evals`,
  `apps/supervisor-api`, `apps/supervisor-agent-worker` and `packages/contracts` only where they
  touch RAG handoff, context projection, plan diagnostics or eval gates.
- Compare current code to `agentic-rag-runtime-rearchitecture`,
  `supervisor-multi-agent-runtime-contract-hardening` and retrieval serving docs.
- Produce a gap matrix: already done, missing, deferred, explicitly out of scope.
- Freeze no-opening rules for `fresh_news`, general web fallback and arbitrary URL fetch.

**Exit Criteria:**

- Phase 0 summary identifies concrete implementation files and tests for Phases 1-6.
- No phase depends on changing source-truth ownership or expanding query-enabled surfaces.
- Registry/state/roadmap agree on active phase and current slice.

**Planning Artifacts:**

- `./phases/phase-0-admission-and-gap-audit/CONTEXT.md`
- `./phases/phase-0-admission-and-gap-audit/PLAN.md`
- `./phases/phase-0-admission-and-gap-audit/SUMMARY.md`

## Phase 1: Bounded Agent Handoff And Tool Contract

**Status:** completed.

**Goal:** Ensure RAG consumes only bounded, typed, trace-safe context and allowed tools from the
supervisor-led workflow.

**Scope:**

- Validate `AgentRequest.workflow_context` projection refs are the only cross-agent RAG context
  input path.
- Add/adjust schema, planner or bridge tests so raw context keys, raw source bodies and provider
  traces fail closed.
- Ensure RAG allowed tools are derived from repo-owned ToolSpec / runtime policy and do not expose
  `retrieval.query` as a top-level user/tool surface.
- Ensure selected notice/service/navigation context can frame RAG retrieval only through admitted
  projection kinds and budgets.

**Exit Criteria:**

- RAG handoff has typed projection-kind admission and budget checks.
- Missing required projection fails closed rather than falling back to prompt history.
- Tool allowlist drift is covered by deterministic tests.

## Phase 2: Query Mode, Version, And Source-Trust Planning

**Status:** completed.

**Goal:** Move version/source-trust/freshness eligibility into explicit planning decisions.

**Scope:**

- Audit and harden `current`、`historical`、`as_of`、`compare` mode resolution.
- Add source-trust matrix for current admitted surfaces.
- Explicitly keep `freshness_sensitive` / `live_assisted` closed unless separate admission opens them.
- Ensure answer payload/diagnostics carry mode, version/source refs and fail-close reason.

**Exit Criteria:**

- Planner output records query mode, source trust and freshness posture.
- Default RAG cannot silently use non-current/live branch.
- Mode mismatch and missing version/source trust have regression coverage.

## Phase 3: Evidence Selection And Claim Grounding Hardening

**Status:** completed.

**Goal:** Prevent low faithfulness/relevancy regressions by requiring final claims to map to
answer-bearing evidence.

**Scope:**

- Add claim/evidence coverage checks for regulations, curriculum and stable official-web.
- Downgrade title/entity hits to selection hints unless supporting text backs the answer.
- Handle contradictory evidence, partial evidence and no-hit/no-answer cases explicitly.
- Preserve supporting evidence provenance, citation back-links and grounding verdicts in diagnostics.

**Exit Criteria:**

- Unsupported claims fail closed or produce clarification/no-answer.
- Each accepted final answer has traceable supporting evidence.
- Existing answer-quality regressions cover title-hit and non-answer-bearing-evidence failures.

## Phase 4: Untrusted Content And Tool Guardrails

**Status:** completed.

**Goal:** Treat retrieved/source content as data, not instructions.

**Scope:**

- Add instruction-quarantine rules for retrieved chunks, source HTML, OCR text, notice body and
  cross-agent projection summaries.
- Add prompt/tool tests for malicious source instructions, tool exfiltration requests and source
  attempts to override citation/fail-close policy.
- Ensure tool guardrails live next to the tool/function boundary rather than only in prompt text.

**Exit Criteria:**

- Retrieved content cannot alter system/developer/tool policy.
- Tool calls remain within allowed tool and allowed argument policy.
- Prompt-injection regression fixtures fail before the answer leaves product path.

## Phase 5: RAG Eval Denominator And Regression Gates

**Status:** completed.

**Goal:** Make answer relevancy/faithfulness, workflow correctness and diagnostic performance
repeatable and actionable.

**Scope:**

- Extend small-sample RAGAS lanes for admitted current surfaces.
- Add workflow trace/eval cases for handoff, query mode, source trust, evidence coverage,
  grounding and guardrail outcomes.
- Separate runtime execution latency from judge/scorer overhead and retain concurrent scorer support.
- Keep `fresh_news` excluded from current RAG eval denominator.

**Exit Criteria:**

- Eval output attributes failures by stage and product surface.
- Low answer relevancy / faithfulness examples have deterministic root-cause labels.
- Regression gates are small enough for local iteration and scalable for larger runs.

## Phase 6: Runtime Budget, Observability, And Ops Controls

**Status:** completed.

**Goal:** Bound autonomous RAG cost, time, turns and failure behavior in production paths.

**Scope:**

- Enforce max retrieval steps, max replan count, max context tokens, max tool calls and stage
  deadlines.
- Add cancellation/timeout/fail-close observability for planner, retrieval, synthesis and scorer.
- Ensure metrics/traces expose safe low-cardinality labels and do not leak raw source/provider data.
- Preserve `gpt-5.4` for eval/judge model paths where model selection is part of this workstream.
  Product chat runtime model changes require explicit model-surface admission and must not be folded
  into budget/observability work.

**Exit Criteria:**

- Budget violations return typed fail-close outcomes.
- Stage metrics can explain slow RAGAS or slow runtime paths.
- Production diagnostics remain trace-safe and actionable.

## Phase 7: Product Path Acceptance And Closeout

**Status:** completed.

**Goal:** Prove the completed bounded autonomous RAG behavior through admitted product paths and
close planning truth.

**Scope:**

- Verify public chat and relevant protected/operator diagnostics for admitted RAG surfaces.
- Run focused Python/eval gates and docs/planning lint.
- Update architecture/planning docs if implemented truth changes accepted boundaries.
- Close workstream with remaining deferred items and reopen rule.

**Exit Criteria:**

- Product path acceptance shows no new serving surface opened.
- Phase summaries include verification evidence.
- README/STATE/WORKSTREAMS.md reflect completion status and reopen rule.
