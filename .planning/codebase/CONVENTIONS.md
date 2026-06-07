# Coding Conventions

**Analysis Date:** 2026-04-26

## Repo invariants
- `AGENTS.md` anchors the project as the v2 campus assistant, where the primary
  semantic path flows `apps/execution-control -> apps/supervisor-agent-worker ->
  packages/rag-agent -> packages/retrieval-core`; Go `apps/execution-control` owns
  deterministic runtime/control-plane decisions.
- The supervisor-led architecture described in `docs/architecture/target-architecture.md` and the phase-1 grounding in `docs/architecture/target-architecture.md` keep ingestion and serving clearly split while query-serving scope is controlled by collection runtime profiles rather than a single hardcoded default corpus.
- Local object storage is only a temporary implementation detail; `docs/decisions/adr-0002-local-minio-conventions.md` treats MinIO as an S3-compatible facade so future cloud migration does not leak filesystem paths.

## Package boundaries
- `apps/` directories (for example `apps/execution-control`) host transport/runtime shells while `packages/` folders declare stable capabilities such as `packages/contracts`, `packages/ingestion-core`, and `packages/retrieval-core` (see `AGENTS.md` and `docs/architecture/system/data-plane-architecture.md`).
- `packages/contracts` defines schema-only dataclasses
  (`packages/contracts/src/campus_contracts/models.py`), Go `apps/execution-control`
  coordinates runtime policy/finalization, `apps/supervisor-agent-worker` dispatches
  private agent requests, `packages/rag-agent` performs retrieval-oriented semantic
  work, and `packages/retrieval-core` is the evidence abstraction; retrieval details
  are not permitted to bleed into supervisor contracts or runtime control-plane layers.
- Ingestion work stays inside `packages/ingestion-core` and the `apps/ingestion-worker` runtime shells, with document/registry rules traced in `docs/architecture/system/data-plane-architecture.md`.

## Documentation lifecycle
- Canonical docs reside under `docs/` and obey the front-matter schema described in `docs/README.md` (metadata keys like `doc_type`, `status`, `created`, `updated`, and `decision_id` for ADRs).
- `docs/decisions/` files use the `adr-NNNN-<slug>.md` naming, and architecture/plan files use semantic slugs without dates in the filename; keep updates idempotent by refreshing the `updated` field rather than renaming.
- Use the plan/architecture/decision split (per `docs/README.md`) to decide where new guidance belongs before editing any code.

## Naming Patterns

**Files:**
- Python modules use `snake_case.py` under `src` (e.g., `packages/rag-agent/src/campus_rag_agent/service.py`, `packages/ingestion-core/src/campus_ingestion_core/chunking.py`).
- Package directories use kebab-case (`packages/rag-agent`, `packages/retrieval-core`, etc.) and tests mirror functionality in `tests/<layer>/test_*.py` such as `tests/ingestion/test_chunking_policy.py` or `tests/api/test_supervisor_api.py`.

**Functions:**
- Free functions, helpers, and service entry points favour `snake_case` (`delegate_to_rag_agent`, `chunk_structured_unit`, `_split_token_windows`).
- Private helpers and utilities start with an underscore and are keyword-heavy when they operate on complex objects (see the keyword-only signature in `chunk_structured_unit`).

**Variables:**
- Local and module-level variables follow `snake_case`, while shared constants use `UPPER_SNAKE_CASE` (`DEFAULT_CHUNK_SIZE`, `ALLOWED_CORPORA`, etc. in `packages/ingestion-core/src/campus_ingestion_core/chunking.py` and `packages/contracts/src/campus_contracts/models.py`).
- Tuples of allowed values (`ALLOWED_CORPORA`, `ALLOWED_DELEGATE_STATUSES`, `ALLOWED_CONFIDENCE_LEVELS`) freeze runtime invariants so callers treat them as constants.

**Types:**
- Dataclasses and class names are `PascalCase` without `I` prefixes (`ChunkProfile`, `DocumentRegistryRecord`, `SupervisorRequest`, `QdrantRetrievalBackend`).
- Contract models use `@dataclass(frozen=True, slots=True)` (`packages/contracts/src/campus_contracts/models.py`), and ingestion models follow the same pattern (`packages/ingestion-core/src/campus_ingestion_core/models.py`).

## Code Style
- Every Python module starts with `from __future__ import annotations` to delay type evaluation (`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`, `packages/ingestion-core/src/campus_ingestion_core/chunking.py`).
- Type hints are pervasive, using `typing.Literal`, `tuple[str, ...]`, and generous keyword-only arguments to keep signatures self-documenting (`chunk_structured_unit`, `QdrantRetrievalBackend.__post_init__`).
- Guard clauses prevail: `delegate_to_rag_agent` returns practical `AgentResponse` values before doing work, and `ChunkProfile.__post_init__` raises `ValueError` immediately when configuration is invalid.
- The repo relies on PEP 8 conventions (4-space indent, blank lines between logical blocks) rather than an enforced formatter; maintainers keep functions short and expressive to stay readable.

## Import Organization
- Imports follow the standard library → third-party → workspace order, as shown by `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`, which pulls `dataclasses`/`typing`, `llama_index`/`qdrant_client`, then opens with `campus_*` modules.
- Blank lines separate each group, and workspace modules use their package-style names (`campus_contracts`, `campus_ingestion_core`, etc.) rather than relative paths.

## Error Handling
- API and agent surfaces convert downstream failures into structured `AgentResponse`
  objects (`packages/rag-agent/src/campus_rag_agent/service.py`) instead of letting raw
  exceptions bubble up.
- The retrieval layer raises specific `CorpusQueryDisabledError`/`RetrievalBackendError` types defined in `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py` and wraps low-level exceptions with `raise ... from exc` so traces stay actionable.
- Dataclasses enforce invariants via `__post_init__` raising `ValueError` (`packages/contracts/src/campus_contracts/models.py`, `packages/ingestion-core/src/campus_ingestion_core/models.py`, `ChunkProfile` in `chunking.py`).

## Logging
- There is no shared Python logger yet; the codebase prefers returning structured
  responses or raising domain errors (`packages/rag-agent/src/campus_rag_agent/service.py`).
  Go `apps/execution-control` owns runtime metrics/audit/telemetry. If logging is introduced,
  place statements near transport or supervisor boundaries and keep low-level utilities
  log-free for easier testing.

## Comments
- Inline comments are rare and serve to document type workarounds or coverage gaps only (`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py` uses `# pragma: no cover` next to the error branch, and `tests/ingestion/test_chunking_policy.py` adds `# type: ignore[arg-type]` when intentionally driving validation errors).
- When a rationale is needed, describe the why rather than the what and avoid commenting obvious actions.

## Function Design
- Entry functions validate inputs early and return or raise before doing work: `delegate_to_rag_agent` strips the goal, rejects empty text, and short-circuits `CorpusQueryDisabledError`/`RetrievalBackendError` cases, while `chunk_structured_unit` returns quickly for tables or empty strings.
- Helpers use `_` prefixes (`_split_token_windows`, `_merge_short_tail`, `_build_metadata_filters`) and live near the consumer to limit scope.
- Functions with many collaborators prefer keyword-only signatures so callers spell out `unit=` and `chunk_profile=` rather than relying on positional arguments.

## Module Design
- Each package follows the `pyproject.toml` → `src/<package_name>` layout so publishing is predictable (`packages/contracts/pyproject.toml`, `packages/rag-agent/pyproject.toml`).
- `packages/contracts/src/campus_contracts/__init__.py` re-exports the public API via `__all__`, keeping downstream users reliant on the stable schema rather than internal helpers.
- Shared dataclasses are `frozen` and `slots`-aware, reinforcing the contract boundary and preventing accidental mutation.

## Anti-patterns explicitly forbidden
- Do not drag retrieval implementation details or vendor-specific objects (Agno,
  LlamaIndex, Qdrant, MinIO internals) into `packages/contracts` or other contract
  layers; infrastructure stays behind the supervisor runtime / agent boundary.
- Avoid flattening the `retired prototype` stack back into a tool-adapter; follow the supervisor-led orchestration plan, not the old bootstrap path mentioned in `AGENTS.md`.
- Never mix online query logic with ingestion/data-plane responsibilities; `docs/architecture/system/data-plane-architecture.md` spells out separate `Raw`/`Processed`/`Chunk/Index` layers.

## Workflow expectations
- Before any structural change read the `Source Of Truth` list in `AGENTS.md`, respect the contract/package boundaries, and verify the new behavior with the baseline command `uv run --all-packages python -m unittest discover -s tests -t .` referenced in the same file.
- Keep changes minimal when the repo is in the v2 foundation stage (`AGENTS.md` says to prioritise a working loop over speculative generalisations) and avoid locking the workspace to a new runtime until the contracts show the path forward.
