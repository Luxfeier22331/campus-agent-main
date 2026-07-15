---
doc_type: architecture
truth_scope: execution
owner_boundary: tool-routing
status: active
created: 2026-04-21
updated: 2026-07-13
---
# Tool Routing

## Boundary

Execution-control admits a run and supplies its model-visible tools. OpenAI
Agents SDK owns semantic tool selection, function calls and handoffs.

## Canonical Order

```text
app-api auth, session and conversation transport
-> execution-control run and tool admission
-> Temporal Agent Activity
-> primary agent SDK loop
-> direct output, function call or Knowledge Agent handoff
-> structured terminal output
-> execution-control evidence validation and final projection
```

App-api does not classify intent, choose a knowledge target or maintain a
parallel tool allowlist. Execution-control does not inspect user text to select
a tool.

## Primary Agent Decision

The primary agent may answer, clarify, refuse, call
`transport_schedule_lookup` or hand off through `knowledge_query`. The handoff
accepts only the complete `query_text`.

There is no model-visible retrieval target, collection or version field on the
primary-agent handoff. The Knowledge Agent receives admitted targets after the
handoff and selects them when it calls `knowledge_search`.

## Trusted Tool Hint

The private execution contract may carry `requested_tool` for trusted eval or
debug calls. It constrains SDK tool choice but does not select a target, create
a Temporal branch or bypass registry and evidence validation. Ordinary product
chat omits it.

## Official Web

`official_web` has no query-serving target and is unavailable to the Knowledge
Agent. There is no public-web, provider-native search or live-source fallback.

## Forbidden Shapes

- app-api or execution-control intent classification before the primary agent;
- caller-selected corpus, collection, target or version controls;
- handoff acknowledgement followed by a Go semantic graph;
- per-tool Temporal activities or specialist queues;
- answer rewriting after SDK terminal output.

## Related Documents

- `agent-framework.md`
- `tool-runtime.md`
- `agentic-retrieval.md`
- `../../decisions/adr-0075-target-based-knowledge-search.md`
