---
doc_type: review
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Review: Campus-Bounded Autonomous RAG Completion Planning

## Scope

Reviewed the full workstream planning set:

- `README.md`
- `REQUIREMENTS.md`
- `ROADMAP.md`
- `STATE.md`
- all Phase 0-7 `CONTEXT.md`, `PLAN.md` and `SUMMARY.md`

This is a planning review, not an implementation review. It checks phase sequencing, architecture
boundary safety, executable file/test ownership, verification commands and scope discipline.

## Findings

### P1: Model target is ambiguous between chat runtime and eval/judge runtime

The workstream says chat/judge paths should preserve `gpt-5.4`, and Phase 6 asks for a model config
test that chat/judge resolves to `gpt-5.4`. Local repo truth currently distinguishes these surfaces:
RAGAS/eval settings already use `EVAL_RAGAS_MODEL=gpt-5.4`, while supervisor process smoke expects
`PROMPT_RUNTIME_MODEL=gpt-5.5`.

Risk: Phase 6 can silently turn a runtime budget/observability phase into a model migration phase,
or change the supervisor chat runtime when the intended scope was only RAGAS/judge evaluation.

Required correction before Phase 6:

- Phase 0 must explicitly resolve model-surface ownership:
  - `EVAL_RAGAS_MODEL` / `EVAL_JUDGE_MODEL` for judge/eval paths
  - `PROMPT_RUNTIME_MODEL` / supervisor chat runtime for product chat paths
- If product chat runtime must move to `gpt-5.4`, make that an explicit model-config subtask with
  its own tests and docs, not an incidental budget/ops edit.

Evidence:

- `README.md` says `gpt-5.4` for chat/judge posture.
- `phase-6-runtime-budget-observability-and-ops-controls/PLAN.md` asks for chat/judge model config
  tests.
- `tests/test_supervisor_runtime_process_smoke.py` currently asserts `PROMPT_RUNTIME_MODEL=gpt-5.5`.
- `tests/evals/ragas_runtime_settings_suite.py` currently asserts `EVAL_RAGAS_MODEL=gpt-5.4`.

### P2: Phase 1 plans Go allowed-tools validation but omits Go ToolSpec files from ownership

Phase 1 says to check Go handoff `allowed_tools` against ToolSpec/runtime policy. The primary code
targets include Go bridge payload, but omit the Go ToolSpec registry/runtimepolicy owner files even
though the repo has a Go ToolSpec registry and tests.

Risk: implementation either edits outside the declared write set or only hardens Python dispatch
while leaving the Go side under-verified.

Required correction before Phase 1:

- Add `apps/supervisor-api/internal/runtimepolicy/tool_registry.go` and
  `apps/supervisor-api/internal/runtimepolicy/tool_registry_test.go` to Phase 1 targets if Go
  ToolSpec behavior changes.
- Or state explicitly that Phase 1 only verifies existing Go ToolSpec behavior and changes Python
  dispatch/schema seams.

Evidence:

- Phase 1 implementation step says to check Go handoff `allowed_tools` against ToolSpec/runtime
  policy.
- `apps/supervisor-api/internal/runtimepolicy/tool_registry.go` is the current Go ToolSpec owner.
- `apps/supervisor-api/internal/runtimepolicy/tool_registry_test.go` already tests Go ToolSpec
  alignment.

### P2: Phase 4 provider/tool runtime targets are too broad without a Phase 0 gate

Phase 4 includes provider function calling, provider tool runtime policy and Agents SDK closeout
guardrail tests. That can be valid if Phase 0 proves RAG answer generation actually crosses those
tool boundaries, but the current phase text does not require that proof before editing provider
runtime files.

Risk: a RAG guardrail phase can drift into the already governed SDK/provider tool runtime lanes and
reopen unrelated tool governance.

Required correction before Phase 4:

- Add an explicit Phase 0 dependency: provider/tool runtime files are editable only when the gap
  matrix shows a RAG product path reaches that boundary.
- Otherwise Phase 4 should limit implementation to RAG prompt packet, remote content hardening,
  grounding and workflow trace/eval redaction.

Evidence:

- Phase 4 primary code targets include provider function/tool runtime files.
- Phase 4 non-goals reject broad provider framework migration, but the write set still permits
  supervisor tool/function policy edits without a concrete RAG boundary trigger.

### P3: Phase 5 JSON fixture verification is incomplete

Phase 5 may edit `.json` eval fixtures, but its fixture syntax checks list `pnpm yaml:lint` plus
JSONL/TOML tests. Those do not validate plain JSON fixture syntax.

Risk: invalid JSON in eval fixtures could pass the phase's documented verification commands.

Required correction before Phase 5:

- Add a JSON fixture validation command for edited `.json` fixtures.
- Prefer an existing repo test if one is found during Phase 0; otherwise use a deterministic
  `python -m json.tool` loop over changed JSON fixtures.

Evidence:

- Phase 5 primary code targets include multiple `packages/evals/fixtures/*.json` files.
- Phase 5 verification lists YAML, JSONL and TOML checks, but no JSON check.

## Checks Performed

- All referenced Markdown files exist.
- All referenced Python unittest modules in Phase 0-7 plans exist.
- All referenced Go package directories in Phase 1/6/7 verification commands exist.
- New workstream Markdown lint passes.
- `git diff --check` passes for the workstream planning files.

Commands run:

```bash
pnpm exec markdownlint-cli2 ".planning/workstreams/campus-bounded-autonomous-rag-completion/*.md" \
  ".planning/workstreams/campus-bounded-autonomous-rag-completion/**/*.md"
git diff --check -- .planning/workstreams/campus-bounded-autonomous-rag-completion .planning/WORKSTREAMS.md
```

## Fix Status

- `P1`: fixed in `README.md`, `ROADMAP.md`, Phase 0 and Phase 6 planning by separating
  eval/judge model paths from product chat runtime model config.
- `P2`: fixed in Phase 1 planning by adding Go ToolSpec owner files as conditional write targets
  and adding the Go runtimepolicy verification command.
- `P2`: fixed in Phase 4 planning by making provider/tool runtime edits conditional on Phase 0
  proving a RAG product path reaches that boundary.
- `P3`: fixed in Phase 5 planning by adding explicit `python -m json.tool` validation for edited
  JSON fixtures.

## Review Verdict

Verdict: `PASS_WITH_IMPLEMENTATION_GATE`.

The phase plan is structurally sound and executable after the fixes above. Implementation must still
start with Phase 0 because Phase 0 owns the remaining concrete gate decisions: model-surface
ownership, provider/tool runtime edit eligibility and exact file/test write sets for later phases.
