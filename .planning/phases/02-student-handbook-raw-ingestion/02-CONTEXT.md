# Phase 2: Student Handbook Raw Ingestion - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning
**Source:** Derived from roadmap, ingestion architecture docs, prior phase context, and current ingestion-core / ingestion-worker code

<domain>
## Phase Boundary

Phase 2 delivers the phase-1 raw ingestion closure for `student_handbook`. The goal is not to design a new ingestion architecture or to open retrieval/query-serving scope; it is to make the existing raw-first ingestion path trustworthy for handbook inputs.

The phase delivers three things:

- `student_handbook` source assets can enter the canonical raw ingestion path through object storage plus raw-asset registry, not through local file-path shortcuts.
- handbook logical documents rebuilt from the repo-tracked split manifest receive stable `document_id` / `version_id` metadata and are persisted with provenance back to the raw asset.
- re-ingestion can distinguish unchanged inputs from changed inputs through canonical identity, content hash, and version progression rules.

</domain>

<decisions>
## Implementation Decisions

### Ingestion source and provenance boundary
- Phase 2 addresses `ING-01` only; chunk/index generation and query-serving remain outside this phase.
- The canonical source path is still raw-first: raw asset enters object storage and raw-asset registry first, then `process_raw_ingestion_job` reads it back by `raw_asset_id + raw_version_id`.
- `student_handbook` normalized ingestion must keep the fixed artifact chain `provider-result.jsonl -> structured-full.jsonl -> split-manifest -> per-document structured.jsonl`.
- `provider_only` may exist as a runtime-supported mode, but it is not sufficient to close Phase 2 for `student_handbook`; the phase must cover the normalized path that produces logical document records.
- Do not accept local PDF paths, placeholder local job envelopes, or file-registry compatibility shims as production truth for this phase.

### Identity and version semantics
- Raw file identity is owned by the raw-asset registry through `raw_asset_id`, `raw_version_id`, `content_hash`, `source_filename`, `raw_source_uri`, and `object_key`.
- Logical handbook document identity is created only after split-manifest projection and document-level cleanup; `document_id` and `version_id` are document truth, not asset-level truth.
- Handbook `document_id` generation should continue to follow the canonical title-based normalization strategy already described in the OCR normalization architecture and current cleanup helpers.
- `version_id` must reflect normalized logical document content, not OCR job IDs or raw filenames.
- Document-registry records must preserve provenance back to the originating raw asset (`raw_asset_id`, `raw_version_id`, page range, object keys) so later retrieval/audit work can reuse the same truth.

### Duplicate and update handling
- Re-ingestion decisions should be made from canonical identity plus content hash, not from ad hoc filename comparison.
- Unchanged content for the same stable identity must be treated as skip/reuse, not as a fresh version.
- Changed content for the same stable identity must produce a new `version_id`.
- The raw-asset layer and document layer should make duplicate/update outcomes explicit in the import report; silent overwrite behavior is not acceptable.

### Storage and registry persistence
- Object storage remains S3-compatible by contract, with MinIO only as the current local implementation.
- Raw and processed object keys must be produced through the shared object-store key builders, not hand-built per call site.
- Phase 2 should preserve the existing split between raw-asset registry truth and document-registry truth; do not collapse them into one record type for convenience.
- Registry implementations may remain backend-pluggable (`File*Registry` and `Postgres*Registry`), but phase planning should treat the registry schema fields as fixed runtime truth for this milestone.
- The normalized path must persist handbook cleaning-policy and parser/embedding provenance fields where the current registry model already expects them.

### The agent's Discretion
- Exact helper/function decomposition inside `raw_ingestion.py`, as long as the raw-asset boundary, split-manifest reconstruction, and registry truth remain explicit.
- Import report formatting details, provided success/skip/failure counts and affected document identifiers remain machine-checkable.
- Whether verification adds more focused unit coverage or leans on the existing integration-style ingestion tests, as long as Phase 2 acceptance is directly asserted.

</decisions>

<specifics>
## Specific Ideas

- Treat Phase 2 as a closure phase over the current ingestion-core baseline, not as a greenfield build.
- Plan around the existing runtime distinction between `normalized` and `provider_only`, but make `student_handbook` normalized mode the primary acceptance surface.
- Reuse the repo-tracked handbook artifacts under `configs/ingestion/student_handbook/` instead of inventing a new manifest/profile source.
- Keep verification aligned with the repo's `uv` conventions:
  - `uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py -q`
  - `uv run --all-packages python -m unittest discover -s tests -t .`

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Repo and phase guardrails
- `AGENTS.md` — repo-level architecture, planning, and verification constraints
- `README.md` — current repo status, phase-1 ingestion truth, and local verification baseline
- `.planning/PROJECT.md` — project-level value, scope, and milestone constraints
- `.planning/REQUIREMENTS.md` — `ING-01` requirement and phase mapping
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, and plan count
- `.planning/STATE.md` — current milestone position and completed prior phase
- `.planning/phases/01-contract-and-boundary-guardrails/01-CONTEXT.md` — prior locked decisions about phase-1 scope, contract boundaries, and `student_handbook`-only query policy

### Ingestion architecture and decisions
- `docs/architecture/phase1-ingestion-and-storage-architecture.md` — canonical raw/processed/registry/object-store rules for phase 1
- `docs/architecture/student-handbook-ocr-normalization-strategy.md` — handbook-specific normalization, split, `document_id`, and `version_id` truth
- `docs/decisions/adr-0002-local-minio-conventions.md` — MinIO/S3-compatible storage semantics and bucket conventions
- `docs/plans/agentic-rag-foundation.md` — milestone implementation order, raw-ingestion gate, and acceptance framing

### Corpus runtime truth
- `configs/ingestion/student_handbook/README.md` — handbook ingestion artifact layout and config purpose
- `configs/ingestion/student_handbook/runtime-profile.json` — runtime gating for artifact modes and query behavior
- `configs/ingestion/student_handbook/split-manifest.v1.json` — repo-tracked logical document boundary truth
- `configs/ingestion/student_handbook/canonical-profile.json` — canonical handbook identity/metadata profile

### Existing code surfaces
- `apps/ingestion-worker/README.md` — worker-shell runtime rules, env bootstrap, and mode semantics
- `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py` — worker entrypoint for the canonical raw-first path
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py` — main raw-ingestion orchestration, OCR ingestion modes, handbook split-manifest flow, and import persistence
- `packages/ingestion-core/src/campus_ingestion_core/object_store.py` — canonical raw/processed object-key builders and S3-compatible client factory
- `packages/ingestion-core/src/campus_ingestion_core/registry.py` — raw-asset/document registry interfaces and file/Postgres implementations
- `packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py` — handbook canonical cleanup plus `document_id` helpers
- `packages/ingestion-core/src/campus_ingestion_core/models.py` — raw/document record and import-model shapes used by the pipeline

### Test surfaces
- `tests/ingestion/test_process_raw_ingestion_job.py` — handbook raw-ingestion behavior, registry writes, and artifact persistence assertions
- `tests/ingestion/test_processing_pipeline.py` — downstream processing expectations that should not be broken by raw-ingestion changes
- `tests/ingestion/test_corpus_runtime_profile.py` — corpus runtime-profile gating that constrains ingestion mode semantics

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `process_raw_ingestion_job()` in `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`: existing end-to-end orchestration for OCR fetch, artifact writes, split-manifest reconstruction, and import persistence.
- `_build_handbook_split_manifest_documents(...)` in `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`: current handbook-specific bridge from provider output to logical document imports.
- `build_raw_asset_key(...)`, `build_processed_asset_artifact_key(...)`, and `build_processed_artifact_key(...)` in `packages/ingestion-core/src/campus_ingestion_core/object_store.py`: shared object-key builders that already encode the desired S3-compatible path semantics.
- `FileRawAssetRegistry` / `PostgresRawAssetRegistry` and `FileDocumentRegistry` / `PostgresDocumentRegistry` in `packages/ingestion-core/src/campus_ingestion_core/registry.py`: ready-made persistence backends for the raw/document truth split.
- `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py`: thin runtime shell that already matches the desired boundary.

### Established Patterns
- Worker commands load `.env` from the current worktree and explicitly fall back to the main worktree `.env`; missing local env is not a reason to introduce mock backends.
- Registry interfaces are protocol-driven, and tests commonly use file-backed registries plus fake object-store / fake OCR clients rather than hitting real infrastructure.
- Handbook ingestion already assumes repo-tracked split-manifest and corpus runtime profiles are the source of truth; phase planning should build on that instead of adding new config channels.
- Tests use `unittest` style under `pytest` runners, with `TemporaryDirectory`, `patch`, and in-memory/fake dependencies as the dominant verification pattern.

### Integration Points
- `apps/ingestion-worker` CLI -> `packages/ingestion-core.raw_ingestion.process_raw_ingestion_job` is the runtime entry for Phase 2 behavior.
- `raw_ingestion.py` connects raw-asset registry lookup, object-store reads/writes, online OCR, handbook normalization, and document persistence.
- Registry truth written in Phase 2 is later consumed by processing/chunking and retrieval layers, so provenance fields added here must remain stable for downstream phases.
- Handbook config files under `configs/ingestion/student_handbook/` are already positioned as the non-runtime-host source of corpus-specific truth.

</code_context>

<deferred>
## Deferred Ideas

- Chunk generation, embeddings, and Qdrant indexing belong to Phase 3.
- Grounded answer composition, citation shaping, clarification/no-answer handling, and query-serving semantics belong to Phases 4-5.
- `curriculum_plan` raw/processed onboarding remains a later phase concern except where current runtime profiles already constrain shared ingestion behavior.

</deferred>

---

*Phase: 02-student-handbook-raw-ingestion*
*Context gathered: 2026-03-23 via roadmap + architecture docs + current ingestion pipeline audit*
