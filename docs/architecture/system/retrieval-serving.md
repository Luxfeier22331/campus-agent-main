---
doc_type: architecture
truth_scope: execution
owner_boundary: retrieval-serving
status: active
created: 2026-04-21
updated: 2026-07-11
---
# Retrieval Serving Architecture

## Boundary

This document owns indexed knowledge-serving admission and evidence retrieval.
It does not own top-level tool selection or answer synthesis.

The primary agent enters the Knowledge Agent through `knowledge_query`. Only the
Knowledge Agent can invoke internal `knowledge_search`.

## Current Scope Registry

`configs/runtime/query-serving-scopes.v3.json` is the canonical mapping from
model-facing scope to corpus, collection and allowed version modes. The current
admitted scopes are:

- `student_rules`;
- `institutional_rules`;
- `curriculum`.

Tool schemas may guide arguments, but they do not publish a scope. Missing,
unknown or unversioned registry truth fails closed.

## Search Pipeline

Each `knowledge_search` call follows this bounded internal sequence:

```text
run-bound request validation
-> scope/version admission
-> serving profile and release/alias compatibility
-> query embedding
-> Qdrant filtered lookup
-> optional admitted rerank
-> bounded evidence shaping
-> sanitized result projection
```

This sequence is an internal query implementation, not a Temporal activity
graph. Tool execution remains inside the single SDK Agent Activity.

## Version Semantics

Supported version modes are `current`, `historical`, `as_of` and `compare`, as
admitted per scope.

- `current` uses serving config and current-version filters.
- `historical` resolves one explicit visible version.
- `as_of` resolves exactly one version covering the requested timestamp.
- `compare` resolves two different visible versions and requires evidence for
  both sides.

Version resolution occurs before Qdrant lookup. Missing or ambiguous resolution
fails closed; the Knowledge Agent cannot repair version truth in prose.

## Serving And Release Truth

Canonical documents, document units, chunks, physical collections, release
manifests and serving aliases remain separate truth layers. Reader publication
does not open knowledge serving.

Query serving requires compatible:

- scope registry entry;
- collection serving profile;
- embedding model and dimensions;
- release metadata;
- current alias or explicitly resolved historical version;
- visibility and source-trust policy.

An index build or schema declaration alone never opens a scope.

## Evidence Boundary

The internal result exposes only bounded answer-bearing evidence with stable
evidence refs, version identity, source identity and safe snippets. It does not
expose raw Qdrant points, provider payloads, unrestricted page text or index
credentials.

The Knowledge Agent produces the semantic answer. Execution-control
finalization verifies evidence refs and derives browser-safe sources.

## Official Web

`official_web` has not completed its canonical document, chunk, index, release
manifest and alias publication chain. It is absent from the active scope
registry and cannot be queried online.

There is no live-source branch, public-web provider or general web fallback.
Future official-web serving requires a completed offline release and an
explicit scope-registry change.

## Observability

Sanitized observation may include resolved scope/version, provider/model-safe
identity, latency, candidate/evidence counts, result kind/ref and fail-close
reason. Raw query vectors, source bodies and provider responses stay internal.

## Related Documents

- `agentic-retrieval.md`
- `tool-routing.md`
- `../../contracts/tool-execution.md`
- `../../reference/runtime-serving-and-index-terms.md`
