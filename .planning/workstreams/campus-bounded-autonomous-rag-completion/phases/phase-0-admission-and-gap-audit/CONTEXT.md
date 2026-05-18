---
doc_type: phase_context
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Context: Admission And Gap Audit

## Goal

Freeze the exact implementation scope for campus-bounded autonomous RAG completion before changing
runtime code.

## Starting Truth

- `agentic-rag-runtime-rearchitecture` is completed and provides planner, retrieval,
  evidence_selection, synthesis and grounding stages.
- `supervisor-multi-agent-runtime-contract-hardening` is completed and provides the multi-agent
  contract baseline for AgentSpec, AgentInvocation, context projection and trace eval.
- Current RAG surfaces stay limited to `regulations/student_rules`,
  `regulations/institutional_rules`, `curriculum/curriculum_plan` and
  `official_web/stable_reference`.
- `official_web/fresh_news` is excluded from current RAG eval and must not be reopened here.

## Key Questions

- Which gaps are code gaps versus documentation/eval gaps?
- Which gaps are already covered by completed workstreams and only need acceptance wiring?
- Which runtime paths currently consume RAG context from supervisor or other domain agents?
- Which tests already protect query mode, source trust, evidence grounding and guardrail behavior?

## Required Inputs

- `.planning/workstreams/agentic-rag-runtime-rearchitecture/`
- `.planning/workstreams/supervisor-multi-agent-runtime-contract-hardening/`
- `.planning/workstreams/canonical-retrieval-quality-ops-hardening/`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `packages/rag-agent`
- `packages/retrieval-core`
- `packages/evals`
- `apps/supervisor-api`
- `apps/supervisor-agent-worker`
- `packages/contracts`

## Out Of Scope

- Runtime implementation before the gap matrix is written.
- New query-enabled surfaces.
- Open-domain web search or arbitrary URL fetch.
- Source-truth ownership changes.
