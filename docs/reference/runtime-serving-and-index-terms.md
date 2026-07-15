---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-03-28
updated: 2026-07-12
---
# Serving And Index Terms

## Boundary

This glossary distinguishes product, retrieval and index terms. Architecture,
contracts and rollout state remain in their owning documents.

## Product And Data Terms

### Reader Permalink

A stable student-facing document URL such as
`/docs/:corpus/:collection/:docSlug`. It does not contain chunk or object-store
identity.

### Source Channel

The adapter and provenance boundary from which raw source material is
collected. A source channel may feed more than one corpus or collection.

### Corpus

A broad indexed knowledge family such as `regulations` or `curriculum`.

### Collection

The canonical/index ownership unit inside a corpus, for example
`regulations/student_rules`. Collection names are data-plane identity, not
model-visible tool arguments.

### Query-Serving Target

A semantic target id available to the Knowledge Agent, for example
`student_rules` or `curriculum`. The target registry maps it to one server-owned
serving config. A target is not a corpus or collection alias.

### Tool Read Model

A typed projection consumed by a structured function tool instead of generic
knowledge retrieval. `transport_schedule_lookup` reads the transport schedule
read model.

## Agent And Tool Terms

### Model-Visible Tool

A function tool or handoff exposed to the primary agent by `tools.v5` for the
current run.

### Internal Tool

A registered tool available only to its owning specialist.
`knowledge_search` is internal to the Knowledge Agent.

### Knowledge Handoff

The official OpenAI Agents SDK `handoff()` from the primary agent to the
Knowledge Agent. Its payload contains only the complete `query_text`.

### Knowledge Search

One bounded internal call with focused query, target and history flag. It runs
inside the same SDK Agent Activity and does not create a Temporal phase.

### Search Budget

The maximum internal searches in one SDK run. The current Knowledge Agent
budget is three; it is independent from Temporal retry and SDK `maxTurns`.

## Retrieval Terms

### Current Search

`include_history=false`; retrieval filters to documents marked current.

### History-Inclusive Search

`include_history=true`; retrieval may return admitted historical document
versions. It is not an online version-id resolver.

### Candidate Set

Internal Qdrant results before evidence validation and size bounding. Candidates
are not automatically supporting evidence.

### Hybrid Retrieval

Qdrant dense and sparse prefetch followed by native reciprocal rank fusion
(RRF).

### Bounded Evidence

The validated evidence subset returned to the Knowledge Agent. It has stable
evidence/document/chunk ids, target, safe snippet, source URL, optional version,
rank and fusion score.

### Resolved Targets

The unique targets represented by completed searches that support the final
run. `resolved_targets[]` is a finalization/eval projection, not caller input.

## Index Terms

### Chunk Preparation

Offline document-unit cleanup, chunking and validation before embedding and
index writing.

### Physical Collection

A versioned Qdrant collection written by one index release. It is not the
runtime-stable endpoint.

### Serving Alias

A stable Qdrant alias referenced by the serving config and switched by an
offline publish operation.

### Serving Config

Server-owned mapping for corpus, collection, alias, vector names, retrieval
limits, revision tracks and visibility policy.

### Index Release

An offline operation that writes a validated physical collection and publishes
the serving alias. Reader publication does not imply index release or target
opening.

## Common Confusions

- Tool exposure is not target exposure.
- Target identity is not collection identity.
- Reader publication is not retrieval publication.
- A serving config is not a model-visible schema.
- A dataset case is eval truth, not source truth or runtime admission.
- Langfuse trace presence is not Temporal lifecycle truth.
