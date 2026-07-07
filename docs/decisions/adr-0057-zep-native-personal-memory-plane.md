---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0057
status: superseded
created: 2026-06-16
updated: 2026-07-04
supersedes:
  - adr-0053-qdrant-native-personal-memory-index
superseded_by:
  - adr-0058-hindsight-self-hosted-personal-memory-plane.md
---
# ADR-0057: Zep CE Self-Hosted Personal Memory Plane

## Status

Accepted on 2026-06-16. Superseded on 2026-06-17 by ADR-0058 Hindsight
Self-Hosted Personal Memory Plane.

This ADR is retained only as historical decision background. Do not use Zep CE,
Graphiti, Neo4j, Zep `/api/v2`, `memory_graph_llm`,
`infra/local/.generated/zep-ce.env` or `zep-memory-product-path` as current
implementation, deployment or target architecture truth.

## Historical Decision

ADR-0057 replaced the Qdrant-native personal memory plan with self-hosted Zep CE.
The intent was correct: personal memory should not be rebuilt as repo-owned
Qdrant collections, extraction prompts, embedding profiles or dedupe logic.

The chosen substrate is no longer current. Current personal memory truth is:

- `docs/decisions/adr-0058-hindsight-self-hosted-personal-memory-plane.md`
- `docs/architecture/system/memory-plane.md`

## Historical Consequences

ADR-0057 retired these Qdrant-native personal memory surfaces:

- `personal_memory_v1`
- `personal_memory_extraction`
- `personal_memory_embedding`
- `PERSONAL_MEMORY_COLLECTION`
- `PERSONAL_MEMORY_TOP_K`
- `PERSONAL_MEMORY_MAX_CHARS`
- `PERSONAL_MEMORY_SCORE_THRESHOLD`
- `UpdateInferredMemoryActivity`

ADR-0058 keeps those retirements and additionally retires the Zep CE / Graphiti
runtime posture.
