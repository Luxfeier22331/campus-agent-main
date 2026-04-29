# Stack Research

**Domain:** Supervisor-led multi-agent campus QA assistant proving the `student_rules` agentic RAG path while keeping clean contracts and runtime boundaries during the brownfield migration from the legacy `campusRAG` flow.
**Researched:** 2026-03-23
**Confidence:** MEDIUM

> Historical research snapshot: this file captures external-platform research, not the repo's current implementation truth. Current serving/runtime truth is maintained in local source-of-truth docs.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| OpenAI Responses API | v1 (2026) | Unified inference endpoint with built-in tool and workflow support for supervisor → rag-specialist handoffs. | The migration guide frames Responses as the future API, encouraging incremental cutover from Chat Completions so we can rewire the legacy `campusRAG` RAG loops into a supervisor-led multi-agent pipeline that already exposes tool use, structured traces, and ACL hooks without custom orchestration glue. citeturn0search9turn1search10 |
| OpenAI Retrieval API | v1 (2026) | Semantic search front end that feeds vector-store results into subsequent reasoning nodes for grounded QA. | Official guidance describes vector-store backed semantic search plus the synthesize-with-model pattern, which keeps retrieval detail out of the supervisor core and delivers the grounded `student_rules` snippets needed by the rag-specialist responder. citeturn0search1 |
| OpenAI Agent Builder / Agents SDK | Beta (Q1 2026) | Visual canvas for composing typed agent nodes, control flow, and SDK exports that can be wired into the supervisor runtime. | Agent Builder documentation highlights multi-step workflows, preview/debugging, published versions, and tight integration with trace grading, giving us the architecturally correct supervisor-led orchestration instead of the old flat tool approach. citeturn1search3turn1search0 |
| GPT-5.2 (`gpt-5.2`, `gpt-5.2-chat-latest`) | gpt-5.2 | High-capability reasoning model for complex planning, tool calls, and structured instruction-following required by the multi-agent QA path. | GPT-5.2 is described as the flagship reasoning model with superior instruction following, accuracy, and tool handling, so it should power both the supervisor router and the rag-specialist node that handles `student_rules` queries. citeturn1search7 |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Trace grading + Evals dashboards | Trace grading Beta + Evaluations API (2026) | Grade structured traces and run automated evals to build an audit trail and regression guardrail for curator-assisted QA and access control. | Run after every significant change to the supervisor/rag-specialist workflow so you can certify trace-level behavior, detect regressions, and maintain the required minimal auditing closure. citeturn1search0turn0search10 |
| Agent Builder safety guardrails | Safety guide Beta (2026) | Structured outputs, tool-approval nodes, guardrail sanitizers, and human oversight to reduce prompt injection and leakage in multi-agent flows. | Insert guardrail nodes between user input and retrieval/tool nodes, enforce approvals, and sanitize before each ACL-sensitive action to satisfy the student/staff/prospective user gating requirements. citeturn1search1 |
| File Search + Vector Store tool | Responses API tool (2026) | Hosted vector-store search tool for grounding answers in uploaded source material. | Use instead of crafting a bespoke vector-store pipeline so `student_rules` data can stay in a managed store with automatic citations, keeping ingest/retrieval isolated from supervisor routing. citeturn0search0 |
| ChatKit advanced integration | ChatKit advanced (Beta 2026) | Embeddable UX + SDK that connects a frontend or custom backend to the agent workflow created in Agent Builder. | When `apps/supervisor-api` needs to expose chat without leaking runtime logic, use ChatKit advanced integration or the exported SDK so the UI talks to the workflow ID while the supervisor maintains control. citeturn1search2 |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Trace grading & Eval dashboard | Inspect traces, run graders, and understand regressions across multi-agent runs to satisfy tracing/audit minimum closure. | Use the dashboards described in the trace guide every sprint so you can prove what triggered each decision, attach audit metadata, and export results to the `student_rules` QA reports. citeturn1search0 |
| Prompt optimizer + Datasets | Iterate on developer prompts with evaluator feedback to improve structured handoffs and guardrails. | Feed grader annotations/config critiques from `student_rules` flows into the optimizer so multi-node prompts stay disciplined across roles. citeturn1search4 |
| Function-calling inspector | Validate tool schemas and allowed inputs/outputs for retrieval and downstream helpers. | Follow the function-calling guide to keep tool definitions explicit, which shields ACL-sensitive vector-store access from unintended prompts or injections. citeturn1search12 |

## Installation

```bash
# Core
pip install openai>=1.0.0
npm install @openai/agents@latest @openai/chatkit@latest

# Supporting
pip install opentelemetry-api>=1.37.0 opentelemetry-sdk>=1.37.0

# Dev dependencies
pip install pytest uv
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Responses API workflows | Chat Completions API | Keep legacy flows on Chat Completions until all nodes have migrated, but plan an incremental cutover so that future reasoning, tracing, and tool integrations align with the newest API. citeturn0search9 |
| Agent Builder orchestrations | Ad-hoc campusRAG-style script that directly shuttles queries between retrieval and a single model | Use the legacy script only for quick experiments or rollback scenarios, but keep the long-term plan focused on Agent Builder’s typed nodes to preserve clean contracts and observation points. citeturn1search3 |
| Retrieval API + File Search tool | Manual embedding + scoring pipelines (e.g., homegrown vector cache) | Reserve manual pipelines for offline ingestion/debugging; production QA should rely on the managed Retrieval + File Search tooling for consistent citations and auditability. citeturn0search0turn0search1 |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Chat Completions API | Responses is the recommended future path and offers better reasoning, tool handling, and tracing compared to the deprecated chat endpoint. | Responses API. citeturn0search9 |
| Letting supervisor-core ingest or query vector stores directly | Mixing retrieval logic into the supervisor violates the clean contract boundary and blocks ACL/tracing requirements. | Keep ingestion in `ingestion-core`/`retrieval-core` and rely on Responses + Retrieval tools. citeturn1search1 |
| Continuing to treat campusRAG as the primary agent entry point | The repo’s mandate is to replace that flat tool with supervisor-led orchestrations; reverting erodes the new architecture. | Supervisor → rag-specialist via Agent Builder. |

## Stack Patterns by Variant

**If different user roles (students, faculty, prospects) require ACL gating before retrieval:**
- Use guardrail nodes that sanitize inputs, enforce structured outputs, and require human approval before tools run, then pass sanitized tokens into Retrieval/File Search so the supervisor can tag traces with user metadata. citeturn1search1

**If you are onboarding new `student_rules` data or evolving the corpus:**
- Ingest via the Retrieval API’s vector store + File Search tool, grade workflows with trace/eval dashboards, and iterate prompts with the prompt optimizer so each update stays grounded, auditable, and consistent with phase-1 expectations. citeturn0search1turn1search0turn1search4

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| openai>=1.0.0 | Responses API + GPT-5.2 | Required to call the recommended API and reasoning models described in the migration and GPT-5.2 guides. citeturn0search9turn1search7 |
| @openai/agents@latest | Agent Builder exports | Matches the Beta SDK code that Agent Builder outputs when you publish workflows. citeturn1search3 |
| @openai/chatkit@latest | ChatKit advanced integration | Ensures the frontend/backends can consume workflow IDs as described in the ChatKit docs. citeturn1search2 |

## Sources

- citeturn0search9 — Responses API vs Chat Completions migration guidance and multi-agent tooling.
- citeturn1search10 — Responses API future direction recap and workflow primitives.
- citeturn0search1 — Retrieval API guide covering vector stores and semantics.
- citeturn0search0 — File Search tool for hooking into vector store-backed knowledge bases.
- citeturn1search3 — Agent Builder multi-step workflow composition and SDK exports.
- citeturn1search0 — Trace grading instructions for auditing agent behavior.
- citeturn0search10 — Evaluation best practices for multi-agent/non-d deterministic flows.
- citeturn1search1 — Agent Builder safety guardrails (structured outputs, tool approvals, etc.).
- citeturn1search2 — ChatKit integration options for embedding agent workflows.
- citeturn1search4 — Prompt optimizer and dataset iteration guidance.
- citeturn1search12 — Function calling best practices for explicit tools.
- citeturn1search7 — GPT-5.2 best practices for reasoning and agentic tasks.

---
*Stack research for: Supervisor-led multi-agent campus QA assistant (historical snapshot)*
*Researched: 2026-03-23*
