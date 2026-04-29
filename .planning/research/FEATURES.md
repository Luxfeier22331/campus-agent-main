# Feature Research

**Domain:** Campus QA assistant for students, staff, and prospective students with an architecture-first student handbook agentic RAG path and controlled expansion toward `curriculum_plan`.
**Researched:** 2026-03-23
**Confidence:** MEDIUM

> Historical research snapshot: this document predates the current runtime-profile serving refactor. Current serving truth is maintained in `README.md`, `docs/`, and `.planning/`, not here.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Cited, verifiable `student_rules` answers | Students and staff treating the assistant as an official channel expect citations so they can act without reopening email queues. | MEDIUM | Microsoft’s campus support assistant scenario shows ingestion and retrieval before answering, and StackAI’s guide frames grounding/audit as non-negotiable for production RAG.citeturn0search0turn3search0 |
| Role-based identity and ACL gating for students, staff, and prospects | FERPA/GDPR/SOC2 compliance and campus trust require each persona to see only its approved scope. | HIGH | Florida State University’s Copilot rollout paused for privacy/data usage reviews, echoing EdTech guidance that permissions and logging are foundational.citeturn2search1turn2search2 |
| Observability, citation logging, and escalation traces | Support teams need to understand what happened, why routing occurred, and which evidence grounded the answer. | MEDIUM | StackAI and Microsoft both insist on traceability and audit so humans can follow a request from query to citation.citeturn3search0turn0search0 |
| Multi-channel scheduling and human escalation | Campus assistants commonly integrate with calendars/ticketing so users can self-serve while keeping a human fallback. | MEDIUM | Microsoft’s scenario explicitly wires calendar integration and escalation to student services to keep the human fallback visible.citeturn0search0 |
| Structured ingestion pipeline for `student_rules` answers + `curriculum_plan` prep | Modern knowledge assistants rely on chunking, metadata, deduplication, and analytics before answering, keeping new corpuses ready. | MEDIUM | LearnWise’s platform and Times Higher Education’s human-centred rollout stress focused corpuses plus analytics-driven ingestion discipline.citeturn4search0turn1search0 |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Supervisor-led multi-agent orchestration with explicit `rag-specialist` handoff | Guarantees architectural clarity: the supervisor owns policy/routing while specialists own retrieval, yielding deterministic governance and easier debugging. | HIGH | StackAI’s 2026 guide and agent-platform analysis recommend this topology for regulated workflows because each agent gets clear contracts, limited tool sets, and scoped context.citeturn3search0turn3search1 |
| Curriculum plan controlled expansion pipeline with analytics-ready chunks | Prepares the next corpus without destabilizing the student handbook path; serving exposure stays explicitly gated by runtime policy and release verification. | MEDIUM | LearnWise and Microsoft’s education strategy describe phased activation—ingest, dedupe, add metadata, and only then expose new knowledge.citeturn4search0turn0search0 |
| Human-in-the-loop evaluation and clarification loops | Builds trust by flagging ambiguous policy questions, capturing reviewer feedback, and surfacing citation confidence for each response. | MEDIUM | Times Higher Education and AiMatch both highlight continuous refinement, escalation, and human oversight as differentiators for trustworthy campus assistants.citeturn1search0turn5search0 |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Opening new corpus scope without explicit live gate | Pressure to show progress by surfacing more knowledge quickly. | Skips the runtime-profile + verification discipline and destabilizes the already validated path. | Keep serving-surface changes explicit in runtime policy and add release-gate evidence before opening more scope. |
| Decentralized swarm or judge-only agents without a supervisor | Feels flexible—multiple agents debating could cover every angle. | StackAI warns swarms are hard to debug, hard to restrict, and leak sensitive data when coordination drifts. | Stick with the supervisor → specialist pattern and deterministic contracts so behavior stays measurable.citeturn3search0 |
| Caching sensitive student data in shared, long-lived artifacts | Improves latency and looks easier than repeated lookups. | Violates FERPA/GDPR expectations and leaks context across roles; EdTech cautions explicit privacy reviews before storing PII. | Use ephemeral storage, log every access, and forget sensitive details immediately; keep ACLs at the retrieval layer.citeturn2search1turn2search0 |

## Feature Dependencies

```
[Student Handbook Agentic RAG]
    └──requires──> [Student handbook ingestion + chunking pipeline]
                       └──requires──> [Secure object store + metadata + ACL tagging]
    └──enhances──> [Observability + evaluation + human escalation loops]

[Curriculum Plan Ingestion Pipeline]
    └──requires──> [Metadata schema + deduplication + analytics tagging]

[Identity & ACL Layer]
    └──requires──> [Audit logging + role tags + retrieval pre-filtering]
```

### Dependency Notes
- **[Student Handbook Agentic RAG] requires [Student handbook ingestion + chunking pipeline]:** The Microsoft campus support assistant story enforces ingestion before retrieval and citation delivery.citeturn0search0  
- **[Pipeline] requires secure storage and ACL metadata:** Campus rollouts like Florida State’s Copilot pause for data usage agreements, showing storage plus entitlements must exist before retrieval.citeturn2search1  
- **[Identity & ACL Layer] enhances [Student Handbook Agentic RAG]:** StackAI’s agent-platform analysis highlights policy-driven ACLs feeding specialists with scoped artifacts, improving trust and enabling future phases.citeturn3search1  
- **[Curriculum Plan Ingestion Pipeline] can run parallel to the handbook agent:** LearnWise and Microsoft describe incremental corpuses; ingestion and monitoring can proceed offline while exposure waits for contract validation.citeturn4search0turn0search0  

## MVP Definition

### Launch With (v1)
- [ ] Verified `student_rules` ingestion + chunking pipeline feeding the `rag-specialist` index with citations and structured metadata.  
- [ ] Supervisor → specialist query path with audit, trace, and escalation hooks so every answer is explainable and human-reviewable.  
- [ ] Role-based identity, ACL gating, and logging that satisfy FERPA/SOC2 guardrails while serving students, staff, and prospects.  
- [ ] Observability dashboards that surface unresolved queries, manual escalations, and evidence gaps for continuous refinement.  

### Add After Validation (v1.x)
- [ ] Curriculum plan serving/release gate evidence (deduping, metadata, analytics, verification) that proves the new scope is safe to keep open.  
- [ ] Human-in-the-loop evaluation, citation confidence scoring, and audit-ready summaries that feed the logging dashboard.  
- [ ] Proactive scheduling + escalation paths wired to campus calendars/ticketing for the next wave of use cases.  

### Future Consideration (v2+)
- [ ] Additional corpuses (housing, financial aid, alumni) once supervisor-specialist contracts are stable and ACL metadata scales.  
- [ ] Persona-aware behaviors (advisor tone vs. prospect outreach) enabled by metadata in `packages/contracts`.  
- [ ] Secure multi-campus deployment with localized compliance, multilingual knowledge, and shared analytics.  

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Student handbook agentic RAG with citations | HIGH | MEDIUM | P1 |
| Role-based identity + ACL gating | HIGH | HIGH | P1 |
| Observability/evaluation loops | HIGH | MEDIUM | P1 |
| Curriculum plan ingestion prep | MEDIUM | MEDIUM | P2 |
| Multi-channel scheduling + escalation | MEDIUM | MEDIUM | P2 |

## Competitor Feature Analysis

| Feature | Kampster (Universities) | LearnWise AI | Our Approach |
|---------|------------------------------|--------------|--------------|
| Verified, cited knowledge | Grounded answers from uploaded documents with SOC2/FERPA security and citation links. | Comprehensive assistant covering academic and administrative journeys while surfacing analytics-driven gaps. | Student-handbook-first RAG with supervisor checks, citations, and architecture guardrails for safe expansion.citeturn6search0turn4search0 |
| Security & governance | SOC2/GDPR/FERPA-ready storage, encryption, and controls. | Enterprise-grade compliance plus flows/custom instructions for escalation. | FERPA-grade ACL + logging in `packages/contracts`, ephemeral data, and retrieval filters.citeturn6search0turn4search0 |
| Architecture clarity | Focused on secure ingestion + knowledge assistant but less explicit about orchestration. | AI assistant platform with analytics but lighter on supervisor-led orchestration. | Supervisor-led multi-agent flow with `rag-specialist` handoff, explicit visibility, and deterministic contracts per StackAI.citeturn3search0 |

## Sources
- Microsoft Adoption: “Campus support assistant agent” outlines ingestion, retrieval, calendar integration, monitoring, and escalation paths.【turn0search0】  
- Times Higher Education: “How to harness AI for student support: a human-centred approach” (Sep 2025).【turn1search0】  
- EdTech Magazine: “How higher ed is using built-in generative AI tools” and related privacy reviews for student services assistants.【turn2search0】【turn2search1】  
- EdTech Magazine: “Streamlining student services AI assistants” for privacy, bias, and human-in-the-loop guardrails.【turn2search2】  
- StackAI: “The 2026 Guide to Agentic Workflow Architectures.”【turn3search0】  
- StackAI: “Best AI Agent Building Platforms in 2026.”【turn3search1】  
- LearnWise AI: “Best AI chatbot solutions for students in higher education (2025)” plus analytics-focused knowledge management guidance.【turn4search0】  
- Kampster for Universities: secure, cited knowledge answers for higher-ed organizations.【turn6search0】  
- AiMatch Pro: “AI Agent Workflows in 2025: The 2026 Playbook.”【turn5search0】

---
*Feature research for: Campus QA assistant (historical architecture-first snapshot)*  
*Researched: 2026-03-23*
