# Technology Stack

**Analysis Date:** 2026-04-26

## Languages

**Primary:**
- Go - owns `apps/supervisor-api`, the internal execution runtime, deterministic
  runtime policy, structured planning, readiness, metrics, cancellation, finalization,
  and bridge projection.
- TypeScript - owns Worker product/web surfaces such as `apps/app-api`,
  `apps/public-chat-web`, `apps/public-docs`, and `apps/protected-panel-web`.
- Python 3.12 - owns the private supervisor agent worker, agent packages,
  retrieval/data-plane libraries, ingestion worker shells, and eval tooling.

**Secondary:**
- SQL / PostgreSQL DDL (referenced in `packages/ingestion-core/src/campus_ingestion_core/registry.py`) – backing the document/raw asset registries and the `DOCUMENT_REGISTRY_DATABASE_URL` contract.
- JSON / Markdown – configuration slices (`configs/ingestion/*/runtime-profile.json`, `.env.example`) and documentation (`docs/`).

## Runtime

**Environment:**
- Go module tooling for `apps/supervisor-api`.
- Python 3.12 running inside the `uv` workspace for Python apps/packages.
- Node / pnpm / Worker tooling for TypeScript apps.

**Package Manager:**
- `uv` workspace orchestration with shared `uv.lock` and `pip`/`hatch` dependency resolution; build/system definition comes from `build-system` entries that install `hatchling>=1.24.0`.
- Packaging hooks defined in every `pyproject.toml` (see any `packages/*/pyproject.toml` for `tool.hatch.build` targets) so `hatch` can publish each package if desired.

## Workspace Layout

- Transport/runtime boundaries in the current tracked tree span `apps/supervisor-api`,
  `apps/supervisor-agent-worker`, `apps/ingestion-worker`, `apps/app-api`,
  `apps/public-chat-web`, `apps/public-docs`, and `apps/protected-panel-web`.
- Historical 04.6/04.7 surfaces such as `public-entry-worker` and `public-consumer-chat` still appear in docs/planning history, but they are not current tracked app directories in merged truth.
- Capability packages: `apps/supervisor-agent-worker`, `packages/rag-agent`, `packages/navigation-agent`, `packages/campus-services-agent`, `packages/notice-agent`, `packages/official-web-core`, `packages/retrieval-core`, `packages/ingestion-core`, `packages/contracts`, `packages/shared`, `packages/evals`, each with its own `pyproject.toml` and `src/` entry points.
- Architecture framing is documented in `docs/architecture/target-architecture.md` and the phase-1 implementation details in `docs/architecture/system/data-plane-architecture.md`, so stack decisions follow those boundaries.

## Apps & Packages Inventory

- `apps/supervisor-api` – Go internal execution engine and deterministic runtime owner.
- `apps/supervisor-agent-worker` – Python private bridge worker that dispatches injected
  agent delegates and returns `AgentResponse`.
- `apps/ingestion-worker` – CLI shells (`apps/ingestion-worker/src/campus_ingestion_worker/*`) for importing campusRAG OCR assets, submitting ingestion jobs, and rebuilding local datasets, controlled by `apps/ingestion-worker/README.md`.
- `apps/app-api` – shared Worker application/control-plane backend with the TypeScript runtime, shared database/schema ownership, operator query APIs, `official_web` control-plane modules, telemetry hooks, and the retained Python `ContextProjection` seam.
- `apps/public-chat-web` – public Worker web surface that proxies chat traffic into the shared `app-api` runtime and forwards trace headers.
- `apps/protected-panel-web` – protected Worker operator surface that talks to runtime APIs only and now includes `Overview`, `Requests`, and `Official Web` domains.
- `packages/campus-services-agent` – structured campus-services runtime agent family, tool adapter seam, and query-service protocol owner.
- `packages/navigation-agent` – place-finding agent boundary and `place_lookup` contract owner.
- `packages/notice-agent` – notice runtime agent family, notice-tool adapter seam, and query-service protocol owner.
- `packages/official-web-core` – official-web control-plane domain logic shared below the Worker shell.
- `packages/rag-agent` – knowledge agent and confidence computation funneling to
  `campus_retrieval_core`.
- `packages/retrieval-core` – LlamaIndex + Qdrant backend, retrieval settings, and retrieval service wrappers (`packages/retrieval-core/src/campus_retrieval_core/`).
- `packages/ingestion-core` – ingestion pipelines, object store helpers, registries, OCR glue, corpus profiles (`packages/ingestion-core/src/campus_ingestion_core/`).
- `packages/contracts` – shared DTOs such as `AgentRequest`, `AgentResponse`,
  `SupervisorResponse`, `EvidenceBundle`, and shared capability models.
- `packages/shared` – shared constants (`packages/shared/src/campus_shared/constants.py`).
- `packages/evals` – evaluation & smoke fixtures that depend on the shared contracts.

## Core Libraries & Frameworks

**Core:**
- Go standard library HTTP plus internal packages shape the supervisor runtime without
  leaking concrete runtime host types into `packages/contracts`.
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
- `.env.example` and app-local examples lay out variables for supervisor auth/runtime,
  prompt/runtime admission, retrieval/embedding, MinIO-compatible object storage,
  ingestion/OCR/backfill, and telemetry.
- Collection runtime profiles (`configs/ingestion/regulations/student_rules/runtime-profile.json`, `configs/ingestion/curriculum/curriculum_plan/runtime-profile.json`, `configs/ingestion/campus_services/*/runtime-profile.json`) are loaded via `load_runtime_profile` / `default_query_scopes` to freeze serving and ingestion behavior per collection.
- Retrieval no longer reads a global `QDRANT_COLLECTION` env. Runtime profiles declare the serving alias, collection prefix, and vector bindings; physical Qdrant collections are published per release as `<collection_prefix>__<release_id>`.

**Build:**
- Packaging metadata and source inclusion are centralized in each `pyproject.toml` through `tool.hatch.build.targets`.
- No additional bundler configs (e.g., `webpack`, `vite`) exist; the Python build path relies solely on `hatchling` + `uv`.

## Local Dev Surfaces

- Supervisor API: `apps/supervisor-api/cmd/supervisor-api` exposes `/api/v1/answer`,
  `/api/v1/answer/stream`, `/healthz`, `/readyz`, `/metrics`, and cancellation.
- Supervisor agent worker: `apps/supervisor-agent-worker` exposes only private bridge
  routes.
- Ingestion tooling: `apps/ingestion-worker` (`import_campusrag_existing_ocr`, `process_raw_ingestion_job`, `submit_raw_ingestion_job`, `rebuild_local_data`) is described in `apps/ingestion-worker/README.md` and relies on `campus_ingestion_core` entry points.
- `apps/app-api` now has both the retained Python projection seam and the merged TypeScript Worker runtime (`src/app.ts`, `src/index.ts`, `src/modules/*`).
- `apps/public-chat-web/src/index.ts` and `apps/protected-panel-web/src/index.ts` are first-class tracked Worker surfaces in the current tree.
- Tests: root `README.md` documents `uv run --all-packages python -m unittest discover
  -s tests -t .`; Go supervisor-api tests run through the Go module and repo `pnpm`
  wrappers where configured.
- Trace/log surface: Go `apps/supervisor-api` owns metrics, readiness, OTel seams, and
  execution audit projection.
