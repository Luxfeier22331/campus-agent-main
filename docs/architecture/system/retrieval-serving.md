---
doc_type: architecture
truth_scope: execution
owner_boundary: retrieval-serving
status: active
created: 2026-04-21
updated: 2026-07-13
---
# Retrieval Serving

## Boundary

This document owns server-side target admission and indexed evidence retrieval.
It does not own top-level tool selection or answer synthesis.

## Target Registry

`configs/runtime/query-serving-targets.v1.json` is the canonical mapping from a
Knowledge Agent target to one `collection`, one server-owned serving config
and one retrieval limit. The registry does not declare `corpus`.
Current targets are:

- `student_rules`;
- `institutional_rules`;
- `curriculum`.

Targets are semantic serving surfaces, not corpus aliases. The registry's
`collection` is a consistency assertion against the referenced serving config,
not a model-visible vector-store control. A target is available only when both
files validate and the collection values match. `official_web` is absent and
unavailable.

## Search Pipeline

```text
run and access validation
-> target resolution
-> serving config validation
-> query embedding
-> Qdrant dense and sparse prefetch
-> Qdrant native RRF fusion
-> current/history and visibility filtering
-> bounded evidence shaping
-> sanitized search projection
```

This is an internal query inside the SDK Agent Activity, not a Temporal graph.

## Current And Historical Documents

`include_history=false` requires `is_current=true`. `include_history=true`
allows admitted historical document versions in the same target. Returned
evidence may include its source `version_id` for citation and comparison.

## Serving Truth

The target registry points to a serving config that owns offline `corpus`
metadata, collection, Qdrant alias, embedding provider/model/dimensions,
dense/sparse vector names, retrieval enablement, revision tracks and visibility
policy. Execution-control validates the complete embedding/vector profile
before querying. Those fields are runtime-internal and never tool arguments.

An index build, schema declaration or reader publication does not open a
target. Unknown targets, disabled serving configs, vector mismatch or missing
access projection fail closed.

## Evidence And Observability

Search returns bounded, answer-bearing evidence and stable refs. Sanitized
projection may include target, history mode, search ordinal, latency,
candidate/evidence counts, document ids and safe snippets. Raw query vectors,
source bodies, credentials and backend payloads remain internal.

## Related Documents

- `agentic-retrieval.md`
- `data-plane.md`
- `../../contracts/tool-read-model.md`
- `../../decisions/adr-0075-target-based-knowledge-search.md`
