---
doc_type: architecture
truth_scope: execution
owner_boundary: knowledge-agent
status: active
created: 2026-04-21
updated: 2026-07-11
---
# Knowledge Agent Retrieval Architecture

## Boundary

This document owns how the Knowledge Agent consumes governed institutional
evidence. The Knowledge Agent runs inside the same OpenAI Agents SDK run as the
primary agent and can call only internal `knowledge_search`.

It does not define a Temporal retrieval graph, planner contract, synthesis
activity, specialist queue or replanning state.

## Entry

The primary agent selects model-visible `knowledge_query` and the SDK invokes
official `handoff()` to the Knowledge Agent. The handoff carries a strict user
query, knowledge scope and version query admitted for the run.

The Knowledge Agent receives no raw collection name, vector-store handle,
provider credential, source body or ingestion control surface.

## Knowledge Search

`knowledge_search` is an internal-only SDK function tool. Execution-control
validates:

- run, request, trace and invocation identity;
- scope against `query-serving-scopes.v3`;
- version mode and explicit version fields;
- serving config, release metadata and current alias compatibility;
- bounded top-k and result-size limits.

After admission, execution-control performs query embedding, Qdrant lookup,
optional rerank and bounded evidence shaping. Missing or inconsistent serving
truth fails closed.

## Evidence Contract

Each result returns:

- resolved scope and version;
- an explicit found/no-evidence outcome;
- bounded evidence items with stable evidence refs and source identity;
- a sanitized result reference for projection correlation.

Candidate internals, raw provider scores, raw Qdrant payloads and unrestricted
source text do not enter the SDK context.

## Agent Semantics

The Knowledge Agent owns query framing, use of returned evidence, clarification
when the governed question is underspecified, answer synthesis and structured
terminal output.

It may call `knowledge_search` again within the SDK turn budget when the SDK
loop requires another admitted search. That is an ordinary function-tool call,
not a Temporal replan. Every call remains within the handoff scope/version
boundary and cannot open another tool or source surface.

The Knowledge Agent must return unsupported-by-evidence when admitted evidence
cannot support an answer. It cannot fill evidence gaps from model memory.

## Final Evidence Validation

Execution-control finalization validates all terminal evidence refs against the
projected results from this run. It derives browser-safe sources from trusted
evidence metadata and rejects forged, missing or cross-scope references.

Finalization does not edit the answer. App-api stores and streams the finalized
answer and sources without rewriting them.

## Official Web

`official_web` remains an offline source channel. It is not in the active scope
registry and cannot be queried by `knowledge_search`. No public-web provider,
live lookup or general-web fallback is available.

Future official-web knowledge serving requires canonical documents, chunks,
index, release manifest, alias publication and an explicit scope-registry
change before the Knowledge Agent can retrieve it.

## Evaluation

Evaluation separates:

- primary-agent handoff selection;
- handoff argument quality;
- `knowledge_search` scope/version and evidence retrieval quality;
- Knowledge Agent answer/evidence quality;
- finalization source-integrity failures.

SDK traces may support diagnosis, but repo-owned datasets, qrels and sanitized
projections remain canonical eval truth.

## Related Documents

- `agent-framework.md`
- `retrieval-serving.md`
- `tool-routing.md`
- `../../contracts/tool-execution.md`
