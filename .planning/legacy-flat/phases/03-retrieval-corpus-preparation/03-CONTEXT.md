# Phase 3: Retrieval Corpus Preparation - Context

> Historical phase context. This file records what Phase 3 assumed at planning time.
> If its wording conflicts with current serving/index semantics, prefer `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, and the current architecture/decision docs.

**Gathered:** 2026-03-24
**Status:** Ready for planning
**Source:** Derived from roadmap, ingestion/retrieval architecture docs, prior phase context, and current ingestion-core / retrieval-core code

<domain>
## Phase Boundary

Phase 3 closes `ING-02` for `student_handbook`. The scope is not to design a new retrieval product surface or expand supervisor behavior; it is to turn the Phase 2 raw-ingestion truth into retrieval-ready processed text, chunk metadata, and index artifacts that later query-serving phases can safely consume.

The phase delivers three things:

- `student_handbook` raw-ingestion outputs are converted into stable processed document artifacts that can be regenerated from canonical source truth.
- document-level `document-units.jsonl` can be chunked into retrieval-ready units with evidence-trace metadata and stable chunk identity.
- index writes are produced through ingestion/data-plane boundaries so `rag-specialist` and `supervisor-core` consume retrieval results without inheriting indexing details.

</domain>

<decisions>
## Implementation Decisions

### Processed artifact truth and pipeline boundary
- Phase 3 addresses `ING-02` only; answer composition, clarification/no-answer semantics, and supervisor routing stay in later phases.
- The canonical Phase 3 pipeline continues from the Phase 2 raw-first path: `raw asset -> provider-response.jsonl -> layout-elements.jsonl -> split-manifest -> canonical.md + document-units.jsonl -> chunk/index`.
- `layout-elements.jsonl` remains the only asset-level internal structured truth before document splitting; do not shortcut from raw PDF paths or retrieval-time parsing.
- `document-units.jsonl` is the direct chunking input for `student_handbook`; chunking must build on cleaned document-level units, not on provider payloads or ad hoc text blobs.
- Phase 3 should close the processed-text path by persisting document-level artifacts through the shared object-store key builders and document registry fields that Phase 2 already stabilized.

### Chunk identity and evidence-trace metadata
- Chunk identity remains a derived data-plane concept owned by ingestion-core, with stable IDs based on `document_id + representation + version_id + chunk_order`.
- Every retrieval-ready chunk must preserve evidence back-links needed by later query phases: `document_id`, `representation`, `version_id`, `source_chunk_id`, `anchor`, `source_channel`, ACL metadata, and chunk-policy metadata.
- Oversize split results must keep `root_unit_id`, `segment_index`, `segment_total`, `split_reason`, and `boundary_rule`; these are part of evidence traceability, not optional debug metadata.
- Table evidence stays structure-preserving: `table` / `table_row` units remain atomic evidence units, while parent article text keeps placeholder text instead of embedded raw HTML tables.

### Index ownership and online retrieval boundary
- `packages/ingestion-core` owns chunk construction and index writes; `packages/retrieval-core` owns query-time retrieval only.
- Qdrant remains the canonical online chunk/index store for phase-1 retrieval. Object storage may keep small index release manifests for audit and rollback, but it must not keep chunk dumps or serve as online chunk truth.
- Index-writing logic may use Qdrant/LlamaIndex inside ingestion-core, but those infrastructure details must not leak into `packages/contracts`, `packages/supervisor-core`, or roadmap-level contracts.
- Retrieval-facing metadata shape should match what `packages/retrieval-core` already consumes in Qdrant payloads and document-registry lookups, instead of inventing a second index contract.

### Version progression and rebuild semantics
- Phase 3 should reuse Phase 2 document-registry truth for incremental processing. Processed/chunk/index outputs are derived from registered logical document versions, not from source filenames.
- Unchanged handbook document versions should be reusable without forced re-chunking or re-indexing; changed versions must produce new processed/chunk/index outputs keyed by their new `version_id`.
- Do not introduce new handbook representations in this phase. Retrieval-ready artifacts should continue to follow the existing document `representation` and registry `is_current` truth rather than inventing a parallel “latest” lane.
- Current code may still use the field name `revision_track` internally, but Phase 3 planning should treat it as the implementation name for the architecture-level `representation` concept.
- Phase 3 planning should assume stale retrieval entries are reconciled through registry/version truth, not by supervisor-side filtering hacks.

### The agent's Discretion
- Exact function decomposition between raw-ingestion orchestration, document-unit serialization, chunk building, and index-write helpers, as long as package boundaries remain intact.
- The precise shape of release-manifest metadata written to object storage for audit or rollback, provided Qdrant remains the canonical online chunk store and chunk dumps are not persisted there.
- The precise verification split between unit tests and integration-style ingestion tests, as long as processed artifacts, chunk metadata, and index outputs are asserted directly.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Repo and milestone guardrails
- `AGENTS.md` — monorepo architecture constraints, verification rules, and GSD execution expectations
- `README.md` — current repo status and package-boundary orientation
- `.planning/PROJECT.md` — project-level scope, non-goals, and phase-1 priorities
- `.planning/REQUIREMENTS.md` — `ING-02` requirement and traceability mapping
- `.planning/ROADMAP.md` — Phase 3 goal, success criteria, and plan inventory
- `.planning/STATE.md` — current milestone position after Phase 2 completion
- `.planning/phases/01-contract-and-boundary-guardrails/01-CONTEXT.md` — locked package-boundary and query-scope rules that Phase 3 must preserve
- `.planning/phases/02-student-handbook-raw-ingestion/02-CONTEXT.md` — raw-ingestion truths and provenance guarantees that Phase 3 must consume rather than redesign

### Ingestion and retrieval architecture
- `docs/architecture/data-plane-architecture.md` — canonical Raw -> Processed -> Chunk/Index layering, registry truth, chunk metadata requirements, and Qdrant ownership
- `docs/reference/student-handbook-normalization-strategy.md` — `provider-response.jsonl -> layout-elements.jsonl -> split-manifest -> canonical.md -> document-units.jsonl -> chunks` truth for `student_handbook`
- `docs/architecture/target-architecture.md` — long-term package boundaries across supervisor, specialist, retrieval, and ingestion layers
- `docs/architecture/data-plane-architecture.md` — accepted phase-1 scope, data-plane, and package-boundary constraints
- `docs/decisions/adr-0002-local-minio-conventions.md` — S3-compatible object-store semantics and bucket conventions
- `docs/architecture/target-architecture.md` — implementation gates, processed/chunk/index expectations, and phase-1 completion framing

### Corpus runtime truth
- `configs/ingestion/regulations/student_handbook/README.md` — collection-level artifact chain and config purpose
- `configs/ingestion/regulations/student_handbook/runtime-profile.json` — retrieval-enabled runtime truth for `student_handbook`
- `configs/ingestion/regulations/student_handbook/chunk-profile.json` — repo-tracked chunking/runtime profile record for handbook document units
- `configs/ingestion/regulations/student_handbook/split-manifest.v1.json` — logical document boundary truth reused from Phase 2
- `configs/ingestion/regulations/student_handbook/canonical-profile.json` — handbook identity and metadata profile

### Existing code surfaces
- `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py` — worker-shell entrypoint for canonical raw-first ingestion
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py` — raw-asset processing, handbook split-manifest projection, and document persistence path
- `packages/ingestion-core/src/campus_ingestion_core/process.py` — chunk-building and Qdrant index-write helpers already present for structured document units
- `packages/ingestion-core/src/campus_ingestion_core/chunking.py` — handbook chunking policy, structure-first split rules, and split metadata semantics
- `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py` — runtime-profile loader that gates retrieval-enabled collections
- `packages/ingestion-core/src/campus_ingestion_core/object_store.py` — processed artifact key builders and storage semantics
- `packages/ingestion-core/src/campus_ingestion_core/models.py` — document-registry record fields consumed by processing and retrieval
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py` — retrieval-time expectations for Qdrant payload metadata and registry back-links
- `packages/retrieval-core/src/campus_retrieval_core/service.py` — query entrypoint that consumes retrieval-ready evidence

### Test surfaces
- `tests/ingestion/test_processing_pipeline.py` — chunk metadata, split semantics, and handbook processing expectations
- `tests/ingestion/test_process_raw_ingestion_job.py` — raw-ingestion artifact persistence and document provenance assertions that Phase 3 builds upon
- `tests/ingestion/test_corpus_runtime_profile.py` — runtime-profile gating for retrieval-enabled collections
- `tests/retrieval/test_backend_qdrant.py` — retrieval backend expectations for chunk payloads, ACL filtering, and evidence bundle shaping

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `process_raw_ingestion_job()` in `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`: already rebuilds handbook logical documents from canonical raw-asset truth and persists document-level artifacts.
- `build_indexable_chunks_from_jsonl()` in `packages/ingestion-core/src/campus_ingestion_core/process.py`: already turns `document-units.jsonl` into `IndexableChunk` records with stable IDs and retrieval metadata.
- `index_chunks_to_qdrant()` in `packages/ingestion-core/src/campus_ingestion_core/process.py`: already encapsulates Qdrant writes and payload-index creation on the ingestion side.
- `ChunkProfile` and `StudentHandbookChunkingStrategy` in `packages/ingestion-core/src/campus_ingestion_core/chunking.py`: already encode the runtime-truth chunking defaults for `student_handbook`.
- `QdrantRetrievalBackend.retrieve()` in `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`: already documents the metadata retrieval-core expects from indexed chunks and the document registry.

### Established Patterns
- Runtime truth is repo-tracked: corpus behavior is frozen through `configs/ingestion/...` files rather than environment-only toggles.
- Ingestion-core owns data-plane mutation. Worker shells stay thin, and retrieval-core reads from registries/Qdrant without re-running ingestion logic.
- Tests prefer file-backed registries, fake object stores, and focused `unittest`-style assertions under `pytest`, instead of real infrastructure dependencies.
- Phase 2 already separated raw-asset truth from logical document truth. Phase 3 should preserve that split and add processed/chunk/index derivation on top.

### Integration Points
- `apps/ingestion-worker` remains the runtime shell that should invoke any new Phase 3 processing/index steps rather than embedding them into retrieval or supervisor packages.
- `raw_ingestion.py` is the bridge from registered raw assets to per-document processed artifacts; new chunk/index orchestration should connect here or in adjacent ingestion-core helpers.
- `process.py` already aligns chunk payload metadata with retrieval-core expectations, making it the natural extension point for Phase 3 closure.
- `backend_qdrant.py` plus the document registry form the retrieval-time consumer surface; Phase 3 should shape artifacts so Phase 4 can call retrieval without additional data migrations.

</code_context>

<specifics>
## Specific Ideas

- Auto mode selected all Phase 3 gray areas for discussion: processed artifact truth, chunk metadata semantics, index ownership, and rebuild/version semantics.
- Auto decisions followed the repo’s existing architecture rather than inventing new product behavior.
- Treat Phase 3 as a closure phase over the current ingestion-core baseline, similar to Phase 2: there is already chunking/index code, so the work is to make the end-to-end processed/chunk/index path canonical, repeatable, and well-tested.
- Keep verification aligned with repo commands:
  - `uv run --all-packages python -m pytest tests/ingestion/test_processing_pipeline.py tests/retrieval/test_backend_qdrant.py -q`
  - `uv run --all-packages python -m unittest discover -s tests -t .`

</specifics>

<deferred>
## Deferred Ideas

- Retrieval answer composition, confidence shaping, clarification handling, and no-answer/error semantics belong to Phase 4.
- Supervisor entrypoint, caller identity propagation, ACL enforcement at request boundary, and audit projection belong to Phase 5.
- New handbook representations such as `current-effective` or editorial overlays belong to later phases; Phase 3 should not expand scope to representation design.
- `curriculum_plan` processed/chunk work remains Phase 05.1 and Phase 6 scope, even if shared chunking helpers continue to evolve.

</deferred>

---

*Phase: 03-retrieval-corpus-preparation*
*Context gathered: 2026-03-24 via roadmap + architecture docs + current ingestion/retrieval audit*
