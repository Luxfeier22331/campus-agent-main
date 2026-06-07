---
doc_type: plan
workstream: rag-agent-internal-agents-sdk-loop
status: active_reference
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Agents SDK Expansion Plan

This file is a follow-up reference for extending Agents SDK usage beyond the completed
RAG-internal loop. It does not reopen the completed workstream and does not replace Go
`supervisor-api` as the supervisor-led orchestration owner.

## Current Accepted Baseline

- RAG-internal SDK loop exists behind repo-owned `RagSdkRunRequest` / `RagSdkRunResult`
  projections, bounded retrieval function tools, claim/span guardrails and sanitized trace
  projection.
- Domain-agent adapter promotion already covers ToolSpec-admitted read-only structured tools:
  `campus_notice_discover`, campus-services tools, contact directory and academic calendar.
- `retrieval.query` remains `agent_internal` / closed and must not become a public ToolSpec or SDK
  handoff tool.
- SDK-native objects, raw provider responses, raw SDK traces and handoff graphs do not enter
  `packages/contracts`, panel APIs, eval canonical fixtures or public product responses.

## Expansion Principles

- Use Agents SDK where it removes hand-written provider/tool-loop glue inside a bounded domain
  agent.
- Keep Go `WorkflowPlan`, ToolSpec admission, AgentSpec admission, opening gates, budgets and
  finalization canonical.
- Prefer SDK function tools for repo-owned read-only query adapters.
- Prefer agents-as-tools for manager-style bounded specialist calls inside one admitted domain step.
- Use explicit SDK handoffs only when a specialist must take over next-turn reply ownership; otherwise
  handoff ownership stays in Go.
- Keep hosted tools, remote MCP, shell/filesystem, arbitrary HTTP, raw SQL, object-store reads,
  ingestion writes and index builds out of public query-time SDK surfaces unless a separate
  workstream admits them.
- Treat SDK tracing as development/debug input only until a redaction/exporter gate is admitted.

## Candidate Expansion Lanes

### Lane A: RAG SDK Default-On Hardening

**Purpose:** keep the completed RAG SDK loop usable as the primary semantic loop when the worker
enables it.

Required work:

- Keep Python SDK unit suites in the release denominator.
- Keep public-chat product-path E2E asserting `prompt_runtime_state=rag_sdk_completed`.
- Restore real-provider E2E evidence after the local Docker backend is healthy.
- Continue eval coverage for category discovery, claim/span support, no-evidence fail-close,
  version preservation and routing-negative samples.

Exit evidence:

- Focused Python SDK suites pass.
- Public-chat local real-provider E2E passes through
  `app-api -> supervisor-api -> worker -> rag-agent SDK loop -> Go finalizer`.
- No user-facing fallback answer route remains; failures are explicit and observable.

### Lane B: Structured Domain-Agent Adapter Parity

**Purpose:** ensure currently admitted ToolSpec SDK adapters stay in parity as more read-only tools
are added.

Required work:

- New read-only tools must first be admitted in ToolSpec and Go runtime policy.
- Worker SDK adapter compiles only the `AgentRequest.allowed_tools` subset.
- Tool result guardrails must project typed, sanitized result payloads before `AgentResponse`.
- Add tool-level eval fixtures before opening product-path smoke.

Exit evidence:

- ToolSpec drift test proves no SDK-only tool exists.
- SDK runner tests prove raw tool/provider payloads are not serialized into shared responses.
- Product-path smoke proves `single_step` / `sdk_completed` for each newly admitted tool.

### Lane C: Multi-Step Workflow Runtime Integration

**Purpose:** use Agents SDK inside individual domain-agent steps without replacing governed
multi-agent workflow truth.

Required work:

- Wait for `governed-multi-agent-workflow-runtime` to reopen with a Go-owned `WorkflowPlan` pilot.
- Compile each admitted step into a bounded domain-agent SDK run, not into a global SDK graph.
- Exchange context only through repo-owned `StepOutputProjection` references.
- Use agents-as-tools only for step-local specialist decomposition that does not change the Go
  workflow plan.

Exit evidence:

- Workflow trace remains Go-owned and lists ordered steps, projection refs and safe summaries.
- SDK-native handoff graph never becomes workflow truth.
- Missing projection, widened tool request or exhausted budget fails closed.

### Lane D: Notice Multimodal / Media Review Adapter

**Purpose:** reduce manual media review in ingestion-side semantic classification without creating a
query-time tool.

Required work:

- Keep this in ingestion/worker offline processing, not public chat runtime.
- SDK adapter may orchestrate OCR text, image/page excerpts and model classification prompts behind
  bounded media-review DTOs.
- Output must be normalized target-fact decisions, routing taxonomy labels or unsupported reasons.
- Raw images, OCR dumps and portal-auth material must stay out of shared contracts and product
  responses.

Exit evidence:

- Fixture eval covers transport/schedule, service-status, regulation-like and irrelevant notice
  samples.
- Review output maps to existing notice source-truth / projection state machine.
- Low-value notices can be classified/searchable without expensive multimodal processing.

### Lane E: Service-Guide / Contact Synthesis Loop

**Purpose:** let a domain agent synthesize short, source-backed guidance from structured read models
when deterministic card output is insufficient.

Required work:

- Source truth remains PostgreSQL release current pointer + read model, not prompt memory.
- SDK tools read only admitted read-model projections.
- Output guardrails require title/source URL/contact/source refs where applicable.
- Keep deterministic lookup response as the default for exact lookup.

Exit evidence:

- Exact lookup stays deterministic.
- Synthesis loop improves "怎么办" style answers without inventing materials, phone numbers or
  office hours.
- Missing current read-model rows produce no-answer/clarification, not model invention.

## Not Yet Admitted

- Repo-wide SDK orchestration owner.
- Public query-time web search, hosted file search, code interpreter, remote MCP or shell tools.
- SDK-native sessions as product conversation memory.
- SDK-native tracing export into production telemetry without a repo redaction/exporter gate.
- State-changing tools such as appointment booking, form submission, payment or ticket creation.

## Next Planning Action

Open a new workstream only when one candidate lane needs implementation. Until then this file is the
durable planning reference for scope, prerequisites and acceptance evidence.
