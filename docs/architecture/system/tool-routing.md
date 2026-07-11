---
doc_type: architecture
truth_scope: execution
owner_boundary: tool-routing
status: active
created: 2026-04-21
updated: 2026-07-11
---
# Tool Routing Architecture

## Boundary

This document owns the online boundary between deterministic admission and
model-facing tool routing.

Execution-control admits the run and supplies a request-scoped visible tool
set. OpenAI Agents SDK is the only owner of semantic tool selection, function
tool calls and agent handoffs.

## Canonical Order

```text
app-api auth/session/conversation transport
-> execution-control run + visible-tool admission
-> Temporal Agent Activity
-> primary agent SDK loop
-> direct terminal / model-visible function tool / official handoff
-> SDK terminal output
-> execution-control evidence/source validation
-> final projection
```

App-api does not infer a tool, maintain a parallel allowlist or add a knowledge
scope. Execution-control does not classify user text or run a second router.

## Primary Agent Decision

The primary agent receives only the model-visible tools admitted for the run.
It may:

- answer directly;
- ask for clarification;
- refuse or return out-of-scope;
- call a model-visible SDK function tool;
- select `knowledge_query`, which invokes the official Knowledge Agent handoff.

The current model-visible set is `transport_schedule_lookup` and
`knowledge_query`. No public-web, notice, navigation or generic campus-service
tool is open.

## Knowledge Handoff

`knowledge_query` is a real SDK handoff, not an acknowledgement or routing fact
for later Go execution. `handoff()` transfers control from the primary agent to
the Knowledge Agent inside the same SDK run and Temporal Agent Activity.

The handoff carries strict query, scope and version arguments. The Knowledge
Agent can call only internal `knowledge_search`. Execution-control independently
enforces the admitted scope/version and returns bounded evidence.

The Knowledge Agent owns answer synthesis and evidence-backed structured output.
Execution-control owns evidence-reference validation and source generation.

## Trusted Tool Hint

A trusted internal eval/debug request may constrain SDK tool choice. It remains
subject to the same runtime registry, scope/version admission, SDK handoff,
evidence validation and finalization. Public chat does not accept this field.

The hint does not select a Temporal branch or create a separate knowledge path.

## Clarification

Clarification is an SDK agent outcome. Scope/version schemas and allowed-scope
context help the active agent ask a bounded question, while execution-control
still enforces the final arguments. No deterministic classifier or workflow
planner generates user-facing clarification text.

## Observability

Sanitized routing evidence may include available tool names, decision kind,
selected tool or handoff, safe argument shape/hash, SDK invocation id, result
kind/ref, usage, latency and fail-close reason.

Provider-native traces and SDK state are debug inputs. They do not replace the
repo-owned run, event, tool trajectory or finalization projection.

## Official Web

`official_web` is an offline source channel and is not present in the current
query-serving scope registry. The online tool loop has no public web search,
live-source lookup or provider fallback. Future indexed serving requires a full
offline publish chain and explicit scope-registry opening.

## Forbidden Shapes

- defaulting ordinary chat to `knowledge_query`
- app-api or execution-control text classification before the primary agent
- handoff acknowledgement followed by a Go semantic graph
- per-tool Temporal activities or specialist queues
- raw retrieval, collection or vector-store controls in model-visible tools
- public-web or provider-native search fallback
- answer rewriting in finalization or app-api

## Related Documents

- `agent-framework.md`
- `tool-runtime.md`
- `execution-agent-layer.md`
- `retrieval-serving.md`
- `../../contracts/tool-execution.md`
