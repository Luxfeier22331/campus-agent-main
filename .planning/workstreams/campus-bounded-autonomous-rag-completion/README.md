---
doc_type: index
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Workstream: Campus-Bounded Autonomous RAG Completion

这是 `campus-bounded-autonomous-rag-completion` 的 native workstream 入口。

本 workstream 负责补齐当前校园场景真正需要的 autonomous RAG 缺口：让已完成的
planner-first `rag-agent` 能在 supervisor-led 多 agent 体系里消费受控 domain context、
显式规划 query mode / source trust、强化 evidence selection / claim grounding、隔离
untrusted retrieved content，并把 RAG 质量、成本、超时、并发与产品入口验收纳入可回归的 gate。

它不是开放域 full autonomous agentic RAG，也不重新打开 `official_web/fresh_news`、
general web fallback、arbitrary URL fetch 或无限自主 planner loop。

## Current Status

- status: `completed`
- current phase: `closed`
- active implementation: none
- current slice: bounded autonomous RAG completion closed in current worktree
- model posture: eval/judge planning should preserve the user-requested `gpt-5.4` target for
  `EVAL_RAGAS_MODEL` / `EVAL_JUDGE_MODEL` paths unless a later model-selection task explicitly
  retargets them. Product chat runtime config such as `PROMPT_RUNTIME_MODEL` is a separate surface
  and must not be changed incidentally by runtime budget or observability work.

## Why This Exists

`agentic-rag-runtime-rearchitecture` 已经把 `rag-agent` 从 shape-driven single-shot path
推进到：

`planner -> retrieval -> evidence_selection -> synthesis -> grounding`

但当前系统距离“校园边界内的 autonomous RAG”仍有缺口：

- supervisor/domain-agent handoff 与 RAG context consumption 还需要按真实 product path 收口。
- query mode、version、source trust、freshness posture 需要从答案阶段前移到 plan/admission。
- evidence selection 与 claim grounding 需要能阻止 non-answer-bearing evidence 进入最终答案。
- retrieved content、source HTML、OCR/body text 等 untrusted content 需要明确 instruction quarantine。
- RAGAS / eval 不能只看最终 answer relevancy / faithfulness，需要覆盖 planner、handoff、
  evidence、grounding、guardrail 与 runtime budgets。
- 运行时需要清楚的 max turns、tool budgets、latency/token/cost、cancel/fail-close 与 trace gate。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- gap ledger: `./GAP-LEDGER.md`
- best-practice coverage: `./BEST-PRACTICE-COVERAGE.md`
- phase plans: `./phases/*/PLAN.md`

## Boundary Notes

- 不重开开放域 web search、general browsing、arbitrary URL fetch 或 `official_web/fresh_news`。
- 不把 `rag-agent` 重新变成所有校园请求的 hidden mega-agent。
- 不把 `retrieval-core` 提升为 product scope / serving surface owner。
- 不把 retrieval executable seam、provider SDK type、tool vendor type 或 raw trace 放入
  `packages/contracts`。
- 不把 `campus_services`、`notice`、`navigation` 的 structured current state 问题伪装成 RAG
  retrieval step；RAG 只能消费 bounded StepOutputProjection / context projection。
- 不把 prompt 或 retrieved document 中的指令当成系统指令、tool policy 或 routing policy。
- 默认 current query-enabled scope 保持：
  `regulations/student_rules`、`regulations/institutional_rules`、
  `curriculum/curriculum_plan`、`official_web/stable_reference`。

## External Design Inputs

这些外部资料只作为 best-practice 设计输入，不替代 repo-owned architecture truth：

- OpenAI Agents orchestration distinguishes handoff ownership transfer from manager-style bounded
  specialist calls:
  `https://developers.openai.com/api/docs/guides/agents/orchestration`
- OpenAI tool/function calling uses explicit tool schemas and tool outputs:
  `https://developers.openai.com/api/docs/guides/function-calling`
- OpenAI structured outputs provide schema-constrained model responses:
  `https://developers.openai.com/api/docs/guides/structured-outputs`
- OpenAI guardrails guidance separates input, output and tool guardrails:
  `https://developers.openai.com/api/docs/guides/agents/guardrails-approvals`
- OpenAI agent eval guidance recommends traces, graders, datasets and eval runs for workflow
  regressions:
  `https://developers.openai.com/api/docs/guides/agent-evals`

## Related Architecture

- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `.planning/workstreams/agentic-rag-runtime-rearchitecture/README.md`
- `.planning/workstreams/supervisor-multi-agent-runtime-contract-hardening/README.md`
- `.planning/workstreams/canonical-retrieval-quality-ops-hardening/README.md`

## Reopen Rule

Reopen only if a query-time RAG path again depends on unbounded web/source fetch, loses explicit
query mode/source-trust/fail-close planning, consumes raw cross-agent context instead of bounded
projection refs, lets retrieved content alter instructions/tool policy, loses stage-level
answer-quality attribution, or production path regressions cannot be tied to
planner/retrieval/evidence/grounding/guardrail/runtime stages.
