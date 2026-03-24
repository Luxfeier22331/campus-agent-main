# Phase 3: Retrieval Corpus Preparation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `03-CONTEXT.md`; this log preserves the alternatives considered.

**Date:** 2026-03-24
**Phase:** 03-retrieval-corpus-preparation
**Mode:** Auto (`$gsd-next` routed to `$gsd-discuss-phase 3 --auto`)
**Areas discussed:** Processed artifact truth, Chunk metadata semantics, Index ownership, Rebuild/version semantics

---

## Processed artifact truth

| Option | Description | Selected |
|--------|-------------|----------|
| Continue from canonical normalized artifacts | Build Phase 3 on `provider-response.jsonl -> layout-elements.jsonl -> split-manifest -> canonical.md + document-units.jsonl` and persist processed outputs through shared object-store/document-registry truth. | ✓ |
| Re-derive processed text directly from raw PDFs during retrieval prep | Skip some intermediate processed artifacts and regenerate text later from raw assets. | |
| Allow ad hoc per-call parsing inputs | Let processing accept local files or non-canonical OCR payloads to speed up indexing. | |

**User's choice:** Auto-selected the recommended default: continue from canonical normalized artifacts.
**Notes:** This matches the frozen architecture docs and Phase 2 provenance boundary.

---

## Chunk metadata semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Stable chunk IDs plus full evidence-trace metadata | Keep `chunk_id`, `document_id`, `revision_track`, `version_id`, `source_chunk_id`, `anchor`, split metadata, and policy metadata on every chunk. | ✓ |
| Minimal retrieval metadata only | Keep chunk text and a document reference, but drop most split/unit metadata. | |
| Retrieval-time enrichment | Index sparse payloads now and reconstruct anchors or unit lineage later during query serving. | |

**User's choice:** Auto-selected the recommended default: stable chunk IDs plus full evidence-trace metadata.
**Notes:** This matches `build_indexable_chunks_from_jsonl()` and the phase-1 evidence-trace requirement.

---

## Index ownership

| Option | Description | Selected |
|--------|-------------|----------|
| Ingestion-core owns chunk/index writes; Qdrant is canonical online store | Keep all indexing on the data-plane side and let retrieval-core only query the resulting store. | ✓ |
| Retrieval-core owns both indexing and retrieval | Move chunk/index write logic into the online retrieval package. | |
| Store canonical chunk manifests in object storage instead of Qdrant | Treat object storage as the online chunk truth and use Qdrant only as a cache. | |

**User's choice:** Auto-selected the recommended default: ingestion-core owns chunk/index writes and Qdrant stays canonical online store.
**Notes:** This preserves the ingestion/retrieval package boundary and avoids leaking indexing details upward.

---

## Rebuild/version semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse registry version truth for incremental rebuilds | Skip unchanged versions, rebuild changed versions, and reconcile stale index entries from document-registry truth. | ✓ |
| Always full rebuild the entire collection | Re-process and re-index all handbook documents on every run. | |
| Introduce a new handbook representation during Phase 3 | Add a parallel “latest/current-effective” lane while building retrieval artifacts. | |

**User's choice:** Auto-selected the recommended default: reuse registry version truth for incremental rebuilds.
**Notes:** This extends Phase 2 identity/version semantics without expanding Phase 3 scope.

---

## The agent's Discretion

- Exact helper decomposition inside ingestion-core for process/chunk/index orchestration.
- Whether to persist a derived chunk/index manifest for audit or rebuild support.
- Final test split between focused unit coverage and ingestion-style integration coverage.

## Deferred Ideas

- Query-serving answer semantics, clarification logic, and no-answer/error handling.
- Supervisor ACL/audit propagation work.
- Additional handbook representations beyond the current registry truth.
- `curriculum_plan` chunking and offline-only retrieval prep.
