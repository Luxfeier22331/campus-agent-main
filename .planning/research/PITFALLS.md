# Pitfalls Research

**Domain:** Campus multi-agent QA assistant migrating from legacy RAG to a supervisor-led architecture with student-handbook-first validation and controlled serving-surface expansion
**Researched:** March 23, 2026
**Confidence:** MEDIUM

> Historical research snapshot: several pitfalls below were written before `curriculum_plan` entered the runtime-profile-driven query surface. Treat this file as risk framing, not current serving truth.

## Critical Pitfalls

### Pitfall 1: Reverting to the legacy flat RAG flow

**What goes wrong:** The supervisor starts calling retrieval helpers directly, blending retrieval, ACL, and response shaping logic into a single monolithic flow instead of treating specialists as callable tools. This erodes the intended supervisor-led orchestration and leaves the system unable to reason about handoffs, observability, or specialist failure modes.

**Why it happens:** Legacy campusRAG wiring was simpler and already tied data access and final response assembly together. Facing delivery pressure, teams may be tempted to reuse that pattern rather than intentionally rebuilding the agent-as-tool hub-and-spoke model that gives the supervisor surface visibility over each specialist. Once that habit is in place it feels faster to keep iterating inside one component, so the new contract boundaries never stabilize. citeturn0view0

**How to avoid:** Codify the “agent-as-tool” pattern from the OpenAI Agents SDK: supervisor is the only entrypoint, and each specialist (retrieval, QA, policy) is invoked like a tool in a constrained handoff. Enforce that supervisor-core never embeds vector store/embedding logic directly and keep retrieval, ACL filtering, and source tracing inside the specialist packages. citeturn0view0

**Warning signs:** Pull requests that introduce vector-store or chunking code in packages/supervisor-core, supervisor responses that incorporate retrieval metadata without calling rag-specialist, or log streams that do not attribute steps to a named specialist.

**Phase to address:** Phase 1 (before the first student_handbook QA release).

---

### Pitfall 2: Visibility and audit gaps around ACL and tracing

**What goes wrong:** Without a tracing/audit layer that carries identity + ACL decisions through the supervisor-specialist handoff, it becomes impossible to prove that every query respected the identity-based filters or to debug why a specialist returned the wrong snippet. This violates the security constraint that requests must be bounded to student_handbook and that ACL decisions are replayable.

**Why it happens:** The new multi-agent architecture is orchestrated through several packages, so teams may delay wiring observability until after core functionality works. Guardrail hooks and trace events are seen as “extra work,” resulting in partial instrumentation or no traceability at all.

**How to avoid:** Integrate the Agents SDK-style guardrails, tracing, and observability hooks mentioned in the OpenAI “New tools for building agents” launch. Emit traces at every supervisor → specialist call, ensure ACL filtering occurs before any retrieval tool executes, and surface these traces in audit logs for Phase 1 compliance. citeturn1view0

**Warning signs:** Missing request/response IDs in logs, `apps/supervisor-api` receiving requests with identity but downstream components never seeing it, or only ad-hoc tracing implemented in one package.

**Phase to address:** Phase 1 (because minimum ACL/tracing closure is a gate to release).

---

### Pitfall 3: Premature scope expansion to extra corpora or multi-specialist workflows

**What goes wrong:** The team opens new corpora or specialist flows without explicit runtime-policy changes and release-gate proof, introducing new ingestion connectors, ACL permutations, and nondeterminism faster than evals can contain them. The result is prolonged debugging, missed contracts, and repeated regressions in reasoning across agents.

**Why it happens:** There is natural pressure (internal or stakeholder-driven) to prove broader coverage, but OpenAI’s evaluation guide warns that multi-agent architectures add complexity that should be driven by evals—starting with a multi-agent architecture before you can reliably evaluate it slows time to production. citeturn3view0 Adding corpora multiplies those handoffs and anchors us to more failure points.

**How to avoid:** Keep serving-surface changes explicit in runtime profiles, require regression-free evals before opening more scope, and track scope drift through current source-of-truth docs rather than this historical research note.

**Warning signs:** New ingestion tickets requesting curriculum_plan query routing, or supervisor changes that allow selecting a new specialist ID via config without a verified eval pass.

**Phase to address:** Phase 1 (because scope creep frustrates the required student_handbook proof-of-value).

---

### Pitfall 4: Neglecting retrieval QA instrumentation and eval coverage

**What goes wrong:** Retrieval returns the wrong context or hallucinated source snippets, but there is no automated evaluation to detect the gap. The system ships with inconsistent citations, no measurement of retrieval precision/recall, and misunderstandings about when to rerank or re-query.

**Why it happens:** Teams focus on wiring retrieval and generation and rely on “looks correct” or sample queries rather than building continuous evals. The OpenAI accuracy guide makes this explicit: RAG introduces a new axis that must be evaluated separately (retrieval + LLM) and logging/evals should run continuously so nondeterminism and context drift are visible. citeturn6search0turn3view0

**How to avoid:** Implement eval-driven development: log every supervisor request, evaluate retrieval hits for precision (e.g., use QA dataset with expected contexts), and continuously monitor for nondeterminism. Tie eval metrics back to spec segments (e.g., citation quality, ACL filtering, source recall). Use the Evals API to automate scoring, and treat any regression as a blocker.

**Warning signs:** Frequent “not confident” responses with missing citations, manual debugging to locate the faulty retrieval call, or high variance in eval metrics week over week.

**Phase to address:** Phase 1 (evaluation coverage is part of the release checklist).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode a single vector DB/embeddings vendor into `supervisor-core` to skip contract wiring | Couples retrieval and response shaping quickly, reducing initial delivery time | Vendor lock-in, harder migration to new storage (MinIO, Agno), and duplicated logic when true specialist package is built | Never in Phase 1; only acceptable for prototyping if flagged for immediate refactor |
| Skipping guardrail/tracing instrumentation until after Phase 1 to move faster | Fewer moving parts in the sprint backlog | Loss of auditability, harder debugging, and fear of breaking ACL requirements later | Only acceptable if there is a timeboxed spike, but trace hooks must be added before any release |
| Allowing supervisor to bypass `packages/contracts` and call retrieval packages directly for convenience | Simpler development feedback loop | Breaks contract guarantees and mandates a future refactor before any other specialist can join | Acceptable only for short-lived experiments that are then deleted |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Vector store connectors (MinIO, Agno) | Upload chunked data without preserving corpus boundaries or metadata, then serve all corpora through the same specialist | Enforce corpus tags in metadata, keep `student_handbook` and `curriculum_plan` indexes separate, and tie them to the correct ACL policies |
| Trace/Audit pipeline | Assume logs in `apps/supervisor-api` are sufficient even though specialists run in separate packages | Pipe supervisor IDs, user identity, ACL decisions, and retrieval trace IDs through every specialist and emit them in a structured audit trail |
| Retrieval QA tooling (eval dashboard) | Rely on manual spot checks when returning QA answers | Automate eval runs with the Evals API, logging retrieval precision/recall per specialist, and gating merges when degradation occurs |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full-corpus retrieval per request (no caching) | Request latency spiking as dataset grows | Cache the most-frequent queries and the student_handbook embeddings; reuse in-memory vector indexes for the Phase 1 corpus | When student_handbook, even alone, exceeds a few thousand chunks and each request runs multiple dense searches |
| Per-user reranking with expensive LLM calls | Throughput drops and costs balloon | Use lightweight rerankers (e.g., logistic scoring) before calling a reasoning model, and only escalate to LLM reranks when ACL or eval metrics demand it | When concurrent user load reaches the expected Phase 1 peak (>200 req/min) |
| Tight loop between retrieval, specialist, and supervisor without backoff | Errors cascade, and retry storms appear | Add timeouts, retry limits, and exponential backoff in the supervisor-specialist handoff, and surface failures in audit logging | When downstream services (vector store, ACL service) degrade temporarily |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Not binding retrieval queries to user identity before ACL filtering | Student-sensitive info leaks to unauthorized groups | Propagate identity to the specialty that runs retrieval, and reject any retrieval attempt that cannot prove the requestor’s identity |
| Delayed enabling of guardrails and tracing | Auditors cannot prove each phase honored ACL or scope requirements | Enable guardrails/tracing from day one to capture every decision point (OpenAI stresses guardrails, tracing, and observability for reliable agents). citeturn1view0 |
| Broadly shared credentials for ingestion vs. request-serving | One compromised credential exposes both ingestion and query paths | Separate credentials and secrets between ingestion (curriculum_plan) and the query-serving stack; rotate them independently |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent failure to provide citations | Users cannot verify where answers originated, so trust erodes | Surface citations and retrieval snippets, as the Responses API’s web search tool does with links—this supports clarity and lets users debug wrong answers. citeturn1view0 |
| Ignoring low-confidence signals | The assistant confidently answers even when retrieval precision is poor | Surface “I’m not sure” or request clarification, and tie the confidence signal to audit logs so it can later be surfaced in the UI |
| Handoff confusion between supervisor and specialist | Users see conflicting responses because multiple agents ran in parallel without a clear winner | Let the supervisor make the final synthesizing decision and explain which specialist (if any) resolved the request |

## "Looks Done But Isn't" Checklist

- [ ] **Ingestion pipeline:** student_handbook and curriculum_plan ingestion jobs exist but ensure deduplication, chunking, and metadata tagging are validated for each corpus.
- [ ] **Contracts:** supervisor-specialist contracts are defined in `packages/contracts` and enforced; no package is bypassing those schemas.
- [ ] **ACL/tracing:** every request has identity, authorization, and trace IDs logged before and after jumping to a specialist.
- [ ] **Retrieval QA:** retrieval precision/recall metrics are included in automated eval runs and the dashboard warns on degradation.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Reverting to flat RAG | HIGH | Roll back to last release where supervisor stayed as entrypoint, refactor supervisor to call specialist, replay golden traces, and rerun evals before next release |
| Missing ACL/tracing visibility | MEDIUM | Inject trace instrumentation ASAP, backfill critical request logs (if possible), and rerun manual audits for the period of blind spots |
| Scope creep to new corpora | MEDIUM | Freeze new ingestion efforts, revert supervisor changes, document why the scope expanded, and prioritize revalidating Phase 1 pipeline |
| Retrieval QA blind spot | MEDIUM | Rebuild eval suites, create synthetic queries with expected passages, and block the release until precision/recall recover |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Reverting to flat RAG | Phase 1 | Code review ensures supervisor never embeds retrieval calls; smoke tests confirm only one specialist is invoked.
| Missing ACL/tracing visibility | Phase 1 | Audit logs demonstrate identity/ACL propagation and trace coverage for every QA request.
| Scope creep to additional corpora | Phase 1+ | Architecture review confirms every newly exposed scope has explicit runtime-policy and release-gate evidence.
| Retrieval QA blind spot | Phase 1 | Continuous eval dashboard shows precision/recall goals met for student_handbook queries.

## Sources

- OpenAI Agents SDK multi-agent portfolio collaboration guide (emphasizes agent-as-tool orchestration and global visibility). citeturn0view0
- OpenAI “New tools for building agents” release (outlines guardrails, tracing, and observability for reliable multi-agent workflows). citeturn1view0
- OpenAI evaluation best practices (encourages continuous evaluation, logging, and warning against premature multi-agent complexity). citeturn3view0
- OpenAI optimizing LLM accuracy guide (frames RAG as a dedicated axis that must be evaluated and logged separately). citeturn6search0
