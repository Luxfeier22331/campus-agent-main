# Codebase Structure

**Analysis Date:** 2026-03-28

## Directory Layout

```
[project-root]/
├── AGENTS.md                 # Work rules, guardrails, and repo snapshot
├── README.md                 # High-level orientation and phase goals
├── apps/                     # Runtime adapters and transport surfaces
│   ├── supervisor-api/       # API routes + AgentOS glue (`src/campus_supervisor_api/`)
│   └── ingestion-worker/      # Ingestion shells (`src/campus_ingestion_worker/`)
├── configs/                  # Static corpus/runtime profiles for ingestion
│   └── ingestion/
│       ├── campus_services/
│       │   ├── contact_directory/
│       │   └── service_catalog/
│       ├── curriculum/
│       │   └── curriculum_plan/
│       └── regulations/
│           └── student_handbook/
├── docs/                     # Architecture, decisions, and planning references
│   ├── architecture/
│   ├── decisions/
│   └── plans/
├── infra/                    # Local infrastructure descriptors
│   └── local/
├── legacy/                   # Bootstrap artifacts (read-only experiment history)
├── packages/                 # Core capability packages (supervisor, specialist, retrieval, ingestion)
│   ├── contracts/
│   ├── evals/
│   ├── ingestion-core/
│   ├── rag-specialist/
│   ├── retrieval-core/
│   ├── shared/
│   └── supervisor-core/
├── tests/                    # Domain-targeted unit/regression suites
├── var/                      # Runtime artifacts (registries, import reports, backups)
├── pyproject.toml            # workspace + build configuration
├── uv.lock                   # Locked uv dependency state
├── tmp.md                    # Scratch notes
└── .planning/                # Generated planning artifacts
    └── codebase/
        ├── ARCHITECTURE.md
        └── STRUCTURE.md
```

## Directory Purposes

**apps/**
- Purpose: surface runtime adapters for request handling (`supervisor-api`) and ingestion orchestration (`ingestion-worker`).
- Contains: `apps/supervisor-api/src/campus_supervisor_api/app.py`, `api.py`, `auth.py`, `settings.py`, and `apps/ingestion-worker/src/campus_ingestion_worker/*` scripts such as `process_raw_ingestion_job.py`.
- Key files: `build_routes` + `handle_answer` route definitions, ingestion worker shells that call `campus_ingestion_core.process_raw_ingestion_job`.
- Subdirectories: two runtime surfaces; keep transport/auth logic here and delegate business policies to packages per `AGENTS.md`.

**configs/**
- Purpose: housing per-corpus runtime profiles consumed by retrieval and ingestion code.
- Contains: `configs/ingestion/<corpus>/<collection>/runtime-profile.json`.
- Key files: collection-level JSON profiles that `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py` loads to enforce `serving_stage`, `retrieval_enabled`, `query_enabled_by_default`, and allowed artifact modes.
- Subdirectories: one corpus directory containing one or more collection directories; extend at the collection boundary rather than flattening corpus and collection together.

**docs/**
- Purpose: persistent architecture, decision, and plan references (`README.md`, `docs/architecture/*.md`, `docs/decisions/*.md`, `docs/plans/*.md`).
- Contains: `docs/architecture/long-term-architecture.md`, `docs/architecture/phase1-ingestion-and-storage-architecture.md`, `docs/decisions/adr-0001-phase1-architecture.md`, `docs/plans/agentic-rag-foundation.md`.
- Key files: architecture/phase-1 docs describe goals and constraints; plans track future phases.

**infra/**
- Purpose: descriptions of local infrastructure used during development (`infra/local` for MinIO/Qdrant placeholder configs).
- Contains: `infra/local/...` (monitor for environment-specific samples).

**legacy/**
- Purpose: snapshot of prior bootstrap/legacy flows; avoid editing unless tracking historical decisions.
- Contains: legacy ports of campusRAG (currently empty but preserved to prevent accidental deletion).

**packages/**
- Purpose: grouped capability packages where most business logic lives (contracts, supervisor, specialist, retrieval, ingestion, evals, shared utilities).
- Contains: Python packages under `packages/*/src/<module>`.
- Key files:
  - `packages/contracts/src/campus_contracts/*.py` for request/response/evidence schemas.
  - `packages/supervisor-core/src/campus_supervisor_core/*.py` for routing/agent coordination.
  - `packages/rag-specialist/src/campus_rag_specialist/*.py` for specialist logic.
  - `packages/retrieval-core/src/campus_retrieval_core/*.py` for vector retrieval backends.
  - `packages/ingestion-core/src/campus_ingestion_core/*.py` for ingestion pipelines, object store, and registries.
  - `packages/evals` for regression/eval scaffolding and `packages/shared` for immutable constants.
- Subdirectories: each package carries its own `pyproject.toml` and README; extend within the appropriate package rather than creating new root-level directories.

**tests/**
- Purpose: unit and functional suites grouped by domain (`tests/supervisor`, `tests/specialist`, `tests/retrieval`, `tests/ingestion`, `tests/api`, `tests/contracts`, `tests/evals`).
- Contains: `tests/test_workspace_layout.py` plus domain-specific fixtures (e.g., `tests/retrieval/test_backend_qdrant.py`).
- Key files: domain tests mirror package layout and exercise the same boundaries as the runtime code.

**var/**
- Purpose: runtime artifacts produced by ingestion or test runs.
- Contains: `var/import-reports`, `var/registry`, `var/qdrant-cloud-backups`.
- Key files: JSON registries used by ingestion tests and import reports; treat as environment-specific outputs (committed directories for test fixtures, not generated frequently).

**.planning/**
- Purpose: generated guidance/artifacts such as these codebase maps.
- Contains: `codebase/ARCHITECTURE.md` and `codebase/STRUCTURE.md`.
- Subdirectories: add other `.planning/<area>` docs as the workflow expands; do not mix with runtime code.

## Key File Locations

**Entry Points:**
- `apps/supervisor-api/src/campus_supervisor_api/app.py` – builds `SupervisorApiApp` and wires HTTP/AgentOS runtime.
- `apps/supervisor-api/src/campus_supervisor_api/api.py` – defines `/api/v1/answer`, `/healthz`, `/readyz`, error handling, and tracing.
- `packages/supervisor-core/src/campus_supervisor_core/agent.py` – supervisor handle loop that delegates to specialists.
- `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py` – ingestion worker shell that prints `ImportReport`.

**Configuration:**
- `pyproject.toml` – root uv workspace setup and workspace membership (`apps/*`, `packages/*`).
- `uv.lock` – pinned dependencies for uv.
- `packages/retrieval-core/src/campus_retrieval_core/settings.py` – Qdrant/document registry/embedding config.
- `apps/supervisor-api/src/campus_supervisor_api/settings.py` – bearer token, runtime metadata, and audit logging path.

**Core Logic:**
- `packages/contracts/src/campus_contracts/models.py` – type-level contracts shared across packages.
- `packages/supervisor-core/src/campus_supervisor_core/*.py` – routing, policy, audit, response composition, and context creation.
- `packages/rag-specialist/src/campus_rag_specialist/*.py` – specialist entrypoint/composition and confidence heuristics.
- `packages/retrieval-core/src/campus_retrieval_core/*.py` – retrieval abstractions and Qdrant backend.
- `packages/ingestion-core/src/campus_ingestion_core/*.py` – ingestion pipelines, registries, object store keys, and runtime profile handling.

**Testing:**
- `tests/` – domain-aligned tests verifying contracts, retrieval backend, ingestion helpers, and supervisor flows.
- `tests/conftest.py` – shared fixtures across suites.

**Documentation:**
- `README.md` – top-level orientation and baseline instructions.
- `docs/architecture/*.md` – permanent architecture/phase docs.
- `docs/decisions/*.md` – ADRs such as `adr-0001-phase1-architecture.md`.
- `docs/plans/*.md` – planning artifacts for future phases.

## Naming Conventions

**Files:**
- `snake_case.py` for modules and helper scripts (e.g., `process_raw_ingestion_job.py`, `backend_qdrant.py`).
- `kebab-case` for runtime directories (e.g., `apps/supervisor-api`, `packages/supervisor-core`).
- `test_*.py` for unit tests under `tests/` mirroring package names.

**Directories:**
- `kebab-case` or `snake_case` depending on context; runtime packages use hyphenated names and `src/<module>` remains snake case.
- `configs/ingestion/<corpus>/` uses lowercase underscores when a corpus name includes `_`.

**Special Patterns:**
- `__init__.py` re-exports curated API surfaces (see `packages/contracts/src/campus_contracts/__init__.py` and others).
- `*.py` modules inside `src/<module>` follow package boundaries (no multi-level cross imports).
- `tests/<domain>/` mirrors the package structure it exercises.

## Where to Add New Code

**New Feature (query path):**
- Primary code: `packages/supervisor-core/src/campus_supervisor_core` (agent, routing, response) and `packages/contracts` if schema changes are required.
- Tests: `tests/supervisor/` plus relevant domain suites (e.g., `tests/contracts/` for schema validation).
- Config: update `configs/ingestion` only when a new corpus or runtime profile is introduced.

**New Specialist or Retrieval Module:**
- Implementation: `packages/rag-specialist/src/campus_rag_specialist` for specialist orchestration, `packages/retrieval-core/src/campus_retrieval_core` for backend adapters.
- Types: `packages/contracts/src/campus_contracts/models.py` when adding new handoff fields or statuses.
- Tests: `tests/specialist/` and `tests/retrieval/` for the new behavior/backends.

**New Ingestion Capability:**
- Implementation: `packages/ingestion-core/src/campus_ingestion_core` (raw ingestion, chunking, registry helpers).
- Config: add new corpus profile in `configs/ingestion/<corpus>/runtime-profile.json`.
- Tests: `tests/ingestion/` plus `tests/retrieval/` if retrieval gating changes.

**Utilities & Shared Helpers:**
- Shared helpers: `packages/shared/src/campus_shared/`.
- Type definitions: `packages/contracts/src/campus_contracts/`.
- Tests: `tests/contracts/` or package-specific suites as necessary.

**Runtime Shells & Scripts:**
- API adjustments: `apps/supervisor-api/src/campus_supervisor_api/`.
- Ingestion shells: `apps/ingestion-worker/src/campus_ingestion_worker/`.

## Special Directories

**.planning/**
- Purpose: workspace planning artifacts (like this structure map). Source-of-truth for planning tools and should not contain runtime code.
- Source: created by mapper agents (`.codex/get-shit-done` workflows).
- Committed: yes (these docs live under version control).

**var/**
- Purpose: holds runtime-generated registries and import reports.
- Source: ingestion job outputs and local test runners writing to `var/import-reports`, `var/registry`, `var/qdrant-cloud-backups`.
- Committed: yes (fixtures) but treat contents as environment-specific; avoid committing runtime noise beyond controlled fixtures.

**legacy/**
- Purpose: preserved bootstrap artifacts; not part of the v2 architecture.
- Source: manual snapshots; leave untouched unless explicitly migrating old flows.
- Committed: yes (empty) to signal that bootstrap history exists.

**infra/**
- Purpose: local infrastructure reference configs.
- Source: developer-provided scripts or configs under `infra/local`.
- Committed: yes; extend when local infra definitions evolve.
