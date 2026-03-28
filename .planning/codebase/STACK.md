# Technology Stack

**Analysis Date:** 2026-03-28

## Languages

**Primary:**
- Python 3.12 - Governs every workspace member (`pyproject.toml`, `apps/supervisor-api/pyproject.toml`, `packages/*/pyproject.toml`) and is the interpreter required by both runtime shells and library packages.

**Secondary:**
- SQL / PostgreSQL DDL (referenced in `packages/ingestion-core/src/campus_ingestion_core/registry.py`) – backing the document/raw asset registries and the `DOCUMENT_REGISTRY_DATABASE_URL` contract.
- JSON / Markdown – configuration slices (`configs/ingestion/*/runtime-profile.json`, `.env.example`) and documentation (`docs/`).

## Runtime

**Environment:**
- Python 3.12 running inside the `uv` workspace (`pyproject.toml` `tool.uv` section, `uv.lock` present); root `README.md` also references `uv sync --all-packages --dev` and `uv run --all-packages ...` for validation.
- AgentOS (`provider="agno"` via the `AgentOSRuntime` dataclass in `apps/supervisor-api/src/campus_supervisor_api/app.py`) is the runtime naming convention even though the code stays framework-agnostic to keep the supervisor boundary portable.

**Package Manager:**
- `uv` workspace orchestration with shared `uv.lock` and `pip`/`hatch` dependency resolution; build/system definition comes from `build-system` entries that install `hatchling>=1.24.0`.
- Packaging hooks defined in every `pyproject.toml` (see any `packages/*/pyproject.toml` for `tool.hatch.build` targets) so `hatch` can publish each package if desired.

## Workspace Layout

- Transport/runtime boundaries: `apps/supervisor-api` (API shell, see `apps/supervisor-api/src/campus_supervisor_api/api.py` for `/api/v1/answer`, `/healthz`, `/readyz`) and `apps/ingestion-worker` (ingestion CLI, per `apps/ingestion-worker/README.md`).
- Capability packages: `packages/supervisor-core`, `packages/rag-specialist`, `packages/retrieval-core`, `packages/ingestion-core`, `packages/contracts`, `packages/shared`, `packages/evals`, each with its own `pyproject.toml` and `src/` entry points.
- Architecture framing is documented in `docs/architecture/long-term-architecture.md` and the phase-1 implementation details in `docs/architecture/phase1-ingestion-and-storage-architecture.md`, so stack decisions follow those boundaries.

## Apps & Packages Inventory

- `apps/supervisor-api` – bootstrap API boundary wiring supervisor handler (`apps/supervisor-api/src/campus_supervisor_api/app.py` and `settings.py`).
- `apps/ingestion-worker` – CLI shells (`apps/ingestion-worker/src/campus_ingestion_worker/*`) for importing campusRAG OCR assets, submitting ingestion jobs, and rebuilding local datasets, controlled by `apps/ingestion-worker/README.md`.
- `packages/supervisor-core` – superintendent agent, routing, policy, and response assembly (`packages/supervisor-core/src/...`).
- `packages/rag-specialist` – specialist agent and confidence computation funneling to `campus_retrieval_core`.
- `packages/retrieval-core` – LlamaIndex + Qdrant backend, retrieval settings, and retrieval service wrappers (`packages/retrieval-core/src/campus_retrieval_core/`).
- `packages/ingestion-core` – ingestion pipelines, object store helpers, registries, OCR glue, corpus profiles (`packages/ingestion-core/src/campus_ingestion_core/`).
- `packages/contracts` – shared DTOs such as `SupervisorRequest`, `SpecialistRequest`, `SpecialistResponse`, `EvidenceBundle`, and `ALLOWED_CORPORA` (`packages/contracts/src/campus_contracts/models.py`).
- `packages/shared` – shared constants (`packages/shared/src/campus_shared/constants.py`).
- `packages/evals` – evaluation & smoke fixtures that depend on the shared contracts.

## Core Libraries & Frameworks

**Core:**
- Agno AgentOS semantics (via `AgentOSRuntime` in `apps/supervisor-api/src/campus_supervisor_api/app.py`) shape the supervisor runtime without leaking Agno types outside the API boundary.
- LlamaIndex (`llama-index-core>=0.14.18`, `llama-index-vector-stores-qdrant>=0.10.0`) drives chunk embeddings and retrieval filtering in `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`.
- Qdrant (`qdrant-client>=1.17.1`) stores chunk vectors and feeds back metadata to the evidence bundle process.
- MinIO-compatible object storage through `boto3>=1.35.0` and `ObjectStoreSettings` (`packages/ingestion-core/src/campus_ingestion_core/object_store.py`) acts as the source/derived data plane.
- Requests-based PaddleOCR client (`requests>=2.31.0` inside `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`) powers online PDF parsing when `OCR_BASE_URL` + `OCR_API_KEY` are configured.

**Testing:**
- `pytest>=8.0.0` (from `pyproject.toml` dev dependencies) as the primary runner for `tests/` and package suites.
- Standard library `unittest` (invoked by `uv run --all-packages python -m unittest discover -s tests -t .` in `README.md`) covers legacy or integration smoke tests.

**Build/Dev:**
- Hatchling (`build-system` entries in each `pyproject.toml`) is the build backend for packaging wheels/sdists.
- `uv` workspace tooling orchestrates builds, installs, and tests; commands described in `README.md` cover syncing (`uv sync --all-packages --dev`) and running test suites.
- `docs/README.md` served as the doc index for architecture/plans, keeping the documentation stack aligned with the code.

## Key Configs

**Environment:**
- `pyproject.toml` anchors Python 3.12 and declares the workspace members (`apps/*`, `packages/*`), so every command runs within a consistent `uv` context.
- `.env.example` lays out the required variables for the Supervisor API (`API_AUTH_MODE`, `AGNO_SUPERVISOR_MODEL`, `AGNO_SPECIALIST_MODEL`, `API_BEARER_TOKEN`), retrieval/embedding (`QDRANT_URL`, required `QDRANT_COLLECTION`, `EMBEDDING_MODEL`, `DOCUMENT_REGISTRY_DATABASE_URL`, `EMBEDDING_PROVIDER=gitee` by default), MinIO (`OBJECT_STORE_*`), ingestion/OCR/backfill (`CAMPUSRAG_OCR_ROOT`, `OCR_BASE_URL`, `OCR_API_KEY`), and placeholders for traces (`TRACE_ENABLED`, `TRACE_EXPORTER=console`).
- Collection runtime profiles (`configs/ingestion/regulations/student_handbook/runtime-profile.json`, `configs/ingestion/curriculum/curriculum_plan/runtime-profile.json`, `configs/ingestion/campus_services/*/runtime-profile.json`) are loaded via `load_runtime_profile` / `default_query_scopes` to freeze serving and ingestion behavior per collection.

**Build:**
- Packaging metadata and source inclusion are centralized in each `pyproject.toml` through `tool.hatch.build.targets`.
- No additional bundler configs (e.g., `webpack`, `vite`) exist; the Python build path relies solely on `hatchling` + `uv`.

## Local Dev Surfaces

- API shell: `apps/supervisor-api/src/campus_supervisor_api/api.py` exposes `/api/v1/answer`, `/healthz`, and `/readyz` and is wired through `apps/supervisor-api/src/campus_supervisor_api/app.py`.
- Ingestion tooling: `apps/ingestion-worker` (`import_campusrag_existing_ocr`, `process_raw_ingestion_job`, `submit_raw_ingestion_job`, `rebuild_local_data`) is described in `apps/ingestion-worker/README.md` and relies on `campus_ingestion_core` entry points.
- Tests: root `README.md` documents `uv run --all-packages python -m unittest discover -s tests -t .`, and `tests/` contains API, ingestion, retrieval, specialist, supervisor, eval, and contract suites that mirror each package boundary.
- Trace/log surface: `apps/supervisor-api/settings.py` defaults `audit_log_path` to `./var/log/audit.log` and reads `TRACE_ENABLED`/`TRACE_EXPORTER` from `.env`.
