# Project Research Summary

**Project:** Campus Agent
**Domain:** Supervisor-led multi-agent campus QA assistant proving the student_rules agentic RAG path with disciplined expansion toward `curriculum_plan`
**Researched:** 2026-03-23
**Confidence:** MEDIUM

## Executive Summary

Campus Agent is an architecture-first effort: this research snapshot originally assumed a handbook-only live query domain, but the current repo has since promoted query-serving scope into collection runtime profiles and now serves both `student_rules` and `curriculum_plan` by configuration. The enduring goal remains to prove that the supervisor→rag-specialist→retrieval runway can replace the legacy campusRAG flat tool without leaking retrieval, ACL, or storage details back into the orchestrator.

The recommended implementation stack centers on the OpenAI Responses API plus Retrieval API tooling, the Agent Builder/Agents SDK for typed workflows, and GPT-5.2 for reasoning, with trace grading and eval dashboards layered on top. This keeps retrieval and specialist responsibilities inside their packages, reserves supervisor-core for policy/routing/audit, and gives the runtime boundary in `apps/supervisor-api` a clean contract to work with.

The primary research risk is scope creep and observability gaps: expanding beyond student_rules, skipping guardrails/tracing, or neglecting retrieval QA makes the new architecture hard to govern. Mitigations are explicit Phase 1 boundaries, enforced contracts, ACL/tracing instrumentation from day one, and eval-driven retrieval monitoring before any release.

## Key Findings

### Recommended Stack

Responding to research, the stack should pair the Responses API (for multi-agent workflows with built-in tool support) with the Retrieval API's File Search tool and vector-store connectors, while authoring supervisor-led flows in Agent Builder and running all reasoning on GPT-5.2. Trace grading, Evals dashboards, guardrail nodes, and prompt/runtime tooling from the Agents SDK keep the pipeline auditable and compliant.

**Core technologies:**
- OpenAI Responses API (2026) — orchestrates supervisor → specialist handoffs with structured trace IDs and tool guards.
- OpenAI Retrieval API + File Search tool — returns cited student_rules snippets while hiding retrieval details behind the specialist contract.
- OpenAI Agent Builder / Agents SDK — composes the supervisor, rag-specialist, and guardrail nodes as typed workflow exports consumed by `apps/supervisor-api`.
- GPT-5.2 (`gpt-5.2`, `gpt-5.2-chat-latest`) — the reasoning model that understands citations, tool calls, and structured instructions in regulated workflows.

### Expected Features

Table-stakes for Phase 1 are cited, verifiable student_rules answers, role-based identity/ACL gating for students/staff/prospects, and comprehensive observability (traces, audit logs, escalation hooks). Support for multi-channel scheduling and a structured ingestion pipeline that keeps curriculum_plan ready are also expected from campus assistant scenarios.

**Must have (table stakes):**
- Cited, verifiable student_rules answers — users expect auditable responses backed by ingestion metadata.
- Role-based identity/ACL gating plus audit traces — protects FERPA/GDPR requirements and builds campus trust.

**Should have (competitive):**
- Supervisor-led multi-agent orchestration with an explicit rag-specialist handoff — differentiates our approach and keeps policies centralized.
- Curriculum_plan ingestion/query preparation plus analytics-ready chunking — signals progress while keeping serving-surface expansion explicit and separately gated.

**Defer (v2+):**
- Additional corpuses, persona-aware behavior, and multi-campus deployments — wait until supervisor-contracts, ACL metadata, and eval systems are stable.

### Architecture Approach

The architecture layers runtime, orchestration, and data-plane boundaries: `apps/supervisor-api` handles transport/ACL/tracing, `packages/supervisor-core` owns policy routing and audit projection, `packages/rag-specialist` plus `packages/retrieval-core` wrap retrieval and evidence bundling, and `packages/contracts` freezes the handoff schema so ingestion, retrieval, and evaluations never leak infra details.

**Major components:**
1. `apps/supervisor-api` — runtime boundary, request validation, ACL enforcement, and trace propagation before handing payloads to supervisor-core.
2. `packages/supervisor-core` — centralized supervisor router, intent normalizer, policy gatekeeper, and audit manager.
3. `packages/rag-specialist` + `packages/retrieval-core` — retrieval-facing specialist that obeys contracts and delegates Qdrant/registry lookups to retrieval-core abstractions.

### Critical Pitfalls

1. **Reverting to the legacy flat RAG flow** — prevent supervisor-core from embedding vector-store or chunking code by codifying the agent-as-tool pattern and keeping all retrieval logic inside the specialist packages.
2. **Visibility/audit gaps around ACL and tracing** — hook guardrail instrumentation and trace emissions between supervisor and specialist so every request records identity, ACL decisions, and evidence IDs.
3. **Premature scope expansion beyond validated release gates** — keep serving-surface changes explicit in runtime profiles, and do not open new corpora/specialists until evals confirm stability.
4. **Neglecting retrieval QA instrumentation** — bake eval dashboards, trace grading, and retrieval precision/recall monitoring into the workflow to spot hallucinations before release.

## Implications for Roadmap

### Phase 1: Student Handbook Stabilization
**Rationale:** Proven architecture and governance come from focusing on a single corpus and enforcing the supervisor→rag-specialist contract before any additional complexity.
**Delivers:** End-to-end student_rules ingestion/chunking, ACL-aware supervisor routing, audit/tracing hooks, and citations plus eval gating for every answer.
**Addresses:** Table-stakes (cited answers, ACL gating, observability) and the Phase 1 MVP checklist.
**Avoids:** Scope creep into curriculum_plan query-serving and early retrieval tangles (Pitfalls 1 and 3).

### Phase 2: Observability & Curriculum Prep
**Rationale:** With the baseline flow stable, add retrieval QA instrumentation and curriculum data-plane work to prepare for controlled serving-surface expansion.
**Delivers:** Trace grading + Evals dashboards, guardrail nodes, and a curriculum_plan ingestion/query pipeline (dedupe, metadata tagging, analytics) whose live gate remains explicit and separately verifiable.
**Uses:** Stack tooling such as trace grading/Evals API, Agent Builder guardrails, and Responses API trace metadata.
**Implements:** The layered data-plane architecture (contracts → ingestion-core → retrieval-core) and evaluation tooling needed to keep the specialist honest.

### Phase 3: Corpus & Delivery Expansion
**Rationale:** Only after eval confidence and ACL governance are proven should additional corpora, scheduling integrations, and escalation flows be added.
**Delivers:** Additional knowledge domains (housing, aid, alumni) or persona-aware behaviors, multi-channel scheduling/escalation, and stronger analytics.

### Phase Ordering Rationale
- Contracts and Phase 1 stabilize the supervisor entrypoint before any other package changes, matching the built-order constraint (contracts → ingestion → retrieval → supervisor).
- Phase 2 layers guardrails/evals on top of the stable pipeline, aligning with the Supervisor-as-Manager and layered data-plane patterns that emphasize observability before scale.
- Phase 3 waits until evals and ACL instrumentation prove the architecture, avoiding the scope creep, visibility, and retrieval pitfalls documented in the research.

### Research Flags
- **Phase 2:** Guardrail instrumentation and eval thresholds need deeper research—define the exact trace/audit schema and retrieval QA benchmarks that will block a release.
- **Phase 3:** Multi-corpus compliance, ACL metadata growth, and persona-aware behavior require policy/legal validation before broad rollout.

### Phases with standard patterns (skip research-phase)
- **Phase 1:** Follows a documented supervisor → rag-specialist pattern with existing contracts and ingestion flows.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Based on multiple OpenAI/industry signals in STACK.md but still beta tooling. |
| Features | MEDIUM | Derived from multiple research sources, though exact priorities may shift with stakeholders. |
| Architecture | MEDIUM | Grounded in architecture docs and research, though runtime choices could evolve. |
| Pitfalls | MEDIUM | Critical traps surfaced by research, but mitigation success depends on discipline. |

**Overall confidence:** MEDIUM

### Gaps to Address
- **Identity gating enforcement:** Need concrete ACL schemas and runtime checks for students/staff/prospects before finalizing contracts.
- **Retrieval QA metrics:** Define precise precision/recall targets for student_rules and how Evals dashboards will gate releases.

## Sources

### Primary (HIGH confidence)
- `docs/architecture/target-architecture.md` — architecture guardrails, boundaries, and contracts.
- `docs/architecture/data-plane-architecture.md` — Phase 1 scope, ingestion/data-plane expectations, and storage semantics.

### Secondary (MEDIUM confidence)
- `.planning/PROJECT.md` — project mission, phase requirements, active constraints, and goals.
- `.planning/research/STACK.md` — vetted stack recommendations and guardrails.
- `.planning/research/FEATURES.md` — table stakes, differentiators, and MVP definition.
- `.planning/research/ARCHITECTURE.md` — component map, build order, and boundary definitions.
- `.planning/research/PITFALLS.md` — critical risks and technical debt patterns.

### Tertiary (LOW confidence)
- OpenAI Responses / Retrieval / Agent Builder beta release notes referenced in STACK.md — confirm updates before final roadmap.

---
*Research completed: 2026-03-23*
*Ready for roadmap: yes*
