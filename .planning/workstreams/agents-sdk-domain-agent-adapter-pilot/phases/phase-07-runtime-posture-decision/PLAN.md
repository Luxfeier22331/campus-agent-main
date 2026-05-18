---
doc_type: phase_plan
workstream: agents-sdk-domain-agent-adapter-pilot
phase: 07-runtime-posture-decision
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 7: Runtime Posture Decision

## Goal

Make an explicit runtime posture decision for the Agents SDK pilot based on Phase 5 observability
and Phase 6 parity evidence. This phase decides the SDK role; it does not silently change product
defaults.

## Decision Options

1. `promote_selected_adapter`
   - SDK may replace the custom provider function-call loop for `notice-agent + campus_notice_get`
     under the same explicit runtime gate.
   - Requires complete parity, no boundary leakage, acceptable latency/cost evidence, and clear
     rollback path.

2. `keep_experimental_lane`
   - SDK remains available as a default-off experimental lane.
   - This is the default decision if evidence is useful but insufficient for promotion.

3. `defer_expansion`
   - Keep current pilot but do not open additional tools until more denominator or product evidence
     exists.

4. `reject_sdk_adapter`
   - Remove or quarantine SDK runtime code if it adds complexity, fails parity, leaks boundaries, or
     does not improve maintainability versus the custom loop.

## Inputs Required

- Phase 5 sanitized projection tests and source guards.
- Phase 6 parity report for all required `campus_notice_get` cases.
- Readiness posture evidence:
  - gate off
  - dependency missing
  - provider config missing
  - model missing
  - target/tool mismatch
  - admitted
- Boundary evidence:
  - no SDK types in `packages/contracts`
  - no raw SDK trace/model output in eval/panel/workflow projection
  - no hosted/private MCP or forbidden query-time tool surface
- Runtime evidence:
  - deterministic unit parity
  - optional live smoke result if environment is intentionally configured
  - latency/cost notes if live smoke is run

## Implementation Plan

1. Add a decision artifact template.
   - Candidate path:
     `.planning/workstreams/agents-sdk-domain-agent-adapter-pilot/phases/phase-07-runtime-posture-decision/RUNTIME-POSTURE-DECISION.md`
   - Required sections:
     - selected posture
     - evidence considered
     - promotion criteria
     - rejection criteria
     - rollout / rollback notes
     - residual risks
     - next allowed changes

2. Add an optional evidence checker.
   - Candidate module: `packages/evals/src/campus_evals/agents_sdk_posture_decision.py`.
   - It should consume the Phase 6 parity report shape, not raw SDK traces.
   - It returns a recommendation:
     - `promote_selected_adapter`
     - `keep_experimental_lane`
     - `defer_expansion`
     - `reject_sdk_adapter`
   - Keep the recommendation deterministic and conservative.

3. Add tests for decision logic.
   - Candidate test: `tests/evals/agents_sdk_posture_decision_suite.py`.
   - Cases:
     - full parity + no leaks => promotion allowed
     - any parity failure => keep experimental or reject depending severity
     - missing Phase 5 projection => defer
     - boundary leak => reject
     - live evidence absent => no blocker for experimental, blocker for default promotion

4. Update runtime policy docs only after decision.
   - If selected posture is experimental, update workstream state only.
   - If selected posture is promotion, update architecture docs to say selected SDK adapter is an
     accepted gated domain-agent substrate, not orchestration owner.
   - Do not move SDK into Go `supervisor-api`.

5. Keep env gates conservative.
   - No phase 7 implementation should flip default env values.
   - Any promotion still remains explicit-gate unless a separate product-runtime rollout phase is
     admitted.

## Acceptance Criteria

- There is a single written posture decision with evidence links.
- The decision distinguishes implementation evidence from merged/product truth.
- Any promotion recommendation is tied to concrete parity and boundary checks.
- If evidence is incomplete, the workstream explicitly records `keep_experimental_lane` or
  `defer_expansion` rather than implying success.
- No default product runtime behavior changes in this phase.

## Completion Notes

- Added `campus_evals.agents_sdk_posture_decision` with conservative deterministic posture
  recommendation logic.
- Added tests for promotion eligibility, live-evidence absence, parity failure, missing Phase 5
  projection, and boundary-leak rejection.
- Added `RUNTIME-POSTURE-DECISION.md` with selected posture:
  `keep_experimental_lane`.
- The SDK pilot remains scoped to `notice-agent + campus_notice_get`, default-off, and behind
  explicit env gates.
- No default product runtime behavior or architecture current truth was changed.

## Verification

```bash
uv run --all-packages python -m unittest tests.evals.agents_sdk_posture_decision_suite -q
uv run --all-packages python -m unittest tests.evals.agents_sdk_pilot_parity_suite tests.supervisor.test_agents_sdk_notice_get_pilot tests.contracts.contract_boundary_guardrails_suite -q
uv run --all-packages ruff check packages/evals/src tests/evals apps/supervisor-agent-worker/src tests/supervisor tests/contracts/contract_boundary_guardrails_suite.py
uv run --all-packages ruff format packages/evals/src tests/evals apps/supervisor-agent-worker/src tests/supervisor tests/contracts/contract_boundary_guardrails_suite.py --check
pnpm docs:lint
git diff --check
```

## External References

- OpenAI agent workflow evals:
  `https://developers.openai.com/api/docs/guides/agent-evals`
- OpenAI Agents SDK choose-your-starting-point:
  `https://developers.openai.com/api/docs/guides/agents#choose-your-starting-point`
