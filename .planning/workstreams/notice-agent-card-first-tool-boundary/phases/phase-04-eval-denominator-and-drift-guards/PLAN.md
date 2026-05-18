---
doc_type: phase_plan
workstream: notice-agent-card-first-tool-boundary
phase: 04-eval-denominator-and-drift-guards
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4: Eval Denominator And Drift Guards

## Goal

Prove the new card-first behavior and prevent body-serving notice tools from returning through ToolSpec, provider/SDK schema generation, answer text, workflow trace or eval fixtures.

## Depends On

- Phase 1 contract/ToolSpec recut.
- Phase 2 Go runtime behavior.
- Phase 3 Python/provider/SDK behavior.

## Eval Denominator Design

Add or update cases for these product intents:

- “帮我找某类通知” -> `campus_notice_discover` -> `NoticeCardSet` with official URLs.
- “打开/看看这条通知原文” -> selected notice ref -> official URL/card, not copied body.
- “总结这条通知” -> internal bounded context -> short summary + official URL.
- “这条通知里提到的事实是什么” -> internal bounded fact extraction + source link.
- “现在班车/服务状态是什么” -> dedicated structured runtime first, notice context only as recent-change evidence.
- restricted notice authz -> fail closed without entitlement.
- historical/current-year miss -> downgrade reason is visible but still card-first.

## Drift Guard Design

Add deterministic guards:

- ToolSpec guard:
  - No active provider-loop notice tool can have body/get semantics.
  - Internal query functions cannot be emitted by `generate_provider_function_schemas()`.
- Contract guard:
  - Public result/result projection cannot require or expose raw body fields.
  - `display_policy.full_body_forbidden` must be true for public notice surfaces.
- Runtime guard:
  - `answer_text` and workflow trace fixtures cannot include full notice body markers.
- SDK guard:
  - Agents SDK pilot cannot list `campus_notice_get` as the only allowed/default tool.

## Work Packages

1. Update eval fixtures:
   - `packages/evals/fixtures/tool_family_denominators.v1.json`
   - `packages/evals/fixtures/tool_routing_cases.v1.json`
   - `packages/evals/fixtures/provider_function_tools.v1.json`
   - `packages/evals/fixtures/provider_tool_call_cases.v1.json`
   - retire or replace `agents_sdk_notice_get_parity.v1.json`.
2. Update eval code:
   - `packages/evals/src/campus_evals/tool_family_denominator.py`
   - `packages/evals/src/campus_evals/tool_routing_product_path.py`
   - `packages/evals/src/campus_evals/provider_tool_call_cases.py`
   - `packages/evals/src/campus_evals/agents_sdk_posture_decision.py`
3. Add source-level regression tests that scan ToolSpec and SDK config for stale body-get posture.
4. Add negative fixtures with synthetic body/OCR/attachment text and assert public projections omit them.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.evals.test_tool_family_denominator \
  tests.evals.test_provider_tool_call_cases \
  tests.evals.tool_routing_product_path_suite \
  tests.supervisor.test_tool_function_schema \
  tests.supervisor.test_agents_sdk_closeout_guardrails
git diff --check
```

## Exit Criteria

- Eval denominator reflects card-first notice behavior.
- A stale body-serving notice tool fails at least one guard.
- Provider/SDK snapshot changes are intentional and documented.
