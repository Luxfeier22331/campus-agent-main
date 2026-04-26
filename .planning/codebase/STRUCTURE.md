# Codebase Structure

**Analysis Date:** 2026-04-26

## Directory Layout

```
[project-root]/
├── AGENTS.md                 # Work rules, guardrails, and repo snapshot
├── README.md                 # High-level orientation and phase goals
├── apps/                     # Runtime adapters and current Worker/web surfaces
│   ├── app-api/              # Shared Worker application/control-plane backend
│   ├── ingestion-worker/     # Ingestion shells (`src/campus_ingestion_worker/`)
│   ├── protected-panel-web/  # Protected panel Worker surface
│   ├── public-chat-web/      # Public chat Worker surface
│   ├── public-docs/          # Public docs Worker surface
│   ├── supervisor-agent-worker/ # Private Python bridge worker
│   └── supervisor-api/       # Go execution engine
├── configs/                  # Static corpus/runtime profiles for ingestion
│   └── ingestion/
│       ├── campus_services/
│       │   ├── contact_directory/
│       │   └── service_catalog/
│       ├── curriculum/
│       │   └── curriculum_plan/
│       └── regulations/
│           └── student_rules/
├── docs/                     # Architecture, decisions, plans, runbooks, references, policies
│   ├── architecture/
│   ├── decisions/
│   ├── plans/
│   ├── policies/
│   ├── reference/
│   └── runbooks/
├── infra/                    # Local infrastructure descriptors
│   └── local/
├── packages/                 # Stable capability/data packages
│   ├── campus-services-agent/
│   ├── contracts/
│   ├── evals/
│   ├── ingestion-core/
│   ├── navigation-agent/
│   ├── notice-agent/
│   ├── official-web-core/
│   ├── rag-agent/
│   ├── retrieval-core/
│   └── shared/
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
- Purpose: surface runtime adapters plus the current shared Worker/web product surfaces.
- Contains: Go `apps/supervisor-api/internal/*`, Python
  `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/*`,
  ingestion worker shells, `apps/app-api/src/*`, `apps/public-chat-web/src/*`,
  `apps/public-docs/*`, and `apps/protected-panel-web/src/*`.
- Key files: Go supervisor HTTP/runtime packages, Python bridge app/parser/delegate
  modules, ingestion worker shells that call `campus_ingestion_core` entrypoints,
  `apps/app-api/src/app.ts`, `apps/app-api/src/index.ts`, and Worker web entries.
- Subdirectories: treat only tracked app directories as current merged-truth boundaries; historical 04.6/04.7 app references now live in docs/planning history rather than current `apps/` inventory.

**configs/**
- Purpose: housing per-corpus runtime profiles consumed by retrieval and ingestion code.
- Contains: `configs/ingestion/<corpus>/<collection>/runtime-profile.json`.
- Key files: collection-level JSON profiles that `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py` loads to enforce `serving_stage`, `retrieval_enabled`, `query_enabled_by_default`, and allowed artifact modes.
- Subdirectories: one corpus directory containing one or more collection directories; extend at the collection boundary rather than flattening corpus and collection together.

**docs/**
- Purpose: persistent architecture, decision, plan, runbook, reference, and policy docs.
- Contains: `docs/architecture/current-architecture.md`, `docs/architecture/target-architecture.md`, `docs/architecture/system/product-runtime-architecture.md`, `docs/architecture/system/execution-and-agents-architecture.md`, `docs/architecture/system/identity-and-authorization-architecture.md`, `docs/architecture/system/retrieval-serving-architecture.md`, `docs/architecture/system/data-plane-architecture.md`, `docs/architecture/domains/official-web/architecture.md`, `docs/reference/*`, `docs/runbooks/*`, `docs/policies/*`.
- Key files: `current-architecture.md` is the merged-truth architecture snapshot, `target-architecture.md` holds long-term shape/invariants, supporting architecture docs expand specific boundaries, and `plans/*` only keeps forward-looking implementation handoffs that still guide work.

**infra/**
- Purpose: descriptions of local infrastructure used during development (`infra/local` for MinIO/Qdrant placeholder configs).
- Contains: `infra/local/...` (monitor for environment-specific samples).

**packages/**
- Purpose: grouped capability packages where most business logic lives (contracts,
  agents, retrieval, ingestion, evals, shared utilities).
- Contains: Python packages under `packages/*/src/<module>`.
- Key files:
  - `packages/campus-services-agent/src/campus_services_agent/*.py` for structured campus-services tool orchestration.
  - `packages/contracts/src/campus_contracts/*.py` for request/response/evidence schemas.
  - `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/*.py` for
    private bridge parsing and injected agent dispatch.
  - `packages/navigation-agent/src/campus_navigation_agent/*.py` for place lookup behavior.
  - `packages/notice-agent/src/campus_notice_agent/*.py` for notice-tool orchestration.
  - `packages/official-web-core/src/campus_official_web_core/*.py` for official-web domain logic below app shells.
  - `packages/rag-agent/src/campus_rag_agent/*.py` for agent logic.
  - `packages/retrieval-core/src/campus_retrieval_core/*.py` for vector retrieval backends.
  - `packages/ingestion-core/src/campus_ingestion_core/*.py` for ingestion pipelines, object store, and registries.
  - `packages/evals` for regression/eval scaffolding and `packages/shared` for immutable constants.
- Subdirectories: each package carries its own `pyproject.toml` and README; extend within the appropriate package rather than creating new root-level directories.

**tests/**
- Purpose: unit and functional suites grouped by domain (`tests/supervisor`,
  `tests/agent`, `tests/retrieval`, `tests/ingestion`, `tests/api`, `tests/contracts`,
  `tests/evals`).
- Contains: `tests/test_workspace_layout.py` plus domain-specific fixtures (e.g., `tests/retrieval/test_backend_qdrant.py`).
- Key files: domain tests mirror package layout and exercise the same boundaries as the runtime code.

**var/**
- Purpose: runtime artifacts produced by ingestion or test runs.
- Contains: `var/import-reports`, `var/registry`, `var/qdrant-cloud-backups`.
- Key files: import reports, local backups, and other environment-specific outputs; do not treat `var/` as canonical registry truth for the current runtime path.

**.planning/**
- Purpose: generated guidance/artifacts such as these codebase maps.
- Contains: `codebase/ARCHITECTURE.md` and `codebase/STRUCTURE.md`.
- Subdirectories: add other `.planning/<area>` docs as the workflow expands; do not mix with runtime code.

## Key File Locations

**Entry Points:**
- `apps/supervisor-api/cmd/supervisor-api/main.go` – Go supervisor runtime entry.
- `apps/supervisor-api/internal/httpapi/*.go` – `/api/v1/answer`, streaming,
  readiness, metrics, cancellation, finalization, and bridge response handling.
- `apps/app-api/src/index.ts` – Worker fetch/scheduled entrypoint for the shared app backend.
- `apps/app-api/src/app.ts` – HTTP route composition for auth/chat/operator/official-web/runtime modules.
- `apps/app-api/src/campus_app_api/projection.py` – retained Python `ContextProjection` seam used by shared contract-alignment tests.
- `apps/public-chat-web/src/index.ts` – public Worker shell that proxies browser chat traffic into `app-api`.
- `apps/protected-panel-web/src/index.ts` – protected Worker shell and internal bridge into `app-api`.
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/app.py` – builds the
  private bridge worker with injected agent delegates.
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/api.py` – private
  bridge routes that return `AgentResponse`.
- `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py` – ingestion worker shell that prints `ImportReport`.

**Configuration:**
- `pyproject.toml` – root uv workspace setup and workspace membership (`apps/*`, `packages/*`).
- `uv.lock` – pinned dependencies for uv.
- `packages/retrieval-core/src/campus_retrieval_core/settings.py` – Qdrant/document registry/embedding config.
- `apps/supervisor-api/internal/config/*.go` – supervisor runtime config.

**Core Logic:**
- `packages/contracts/src/campus_contracts/models.py` – type-level contracts shared across packages.
- `apps/supervisor-api/internal/runtimepolicy` and
  `apps/supervisor-api/internal/structuredplanning` – deterministic runtime policy and
  structured planner.
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/*.py` – bridge v6
  parsing, prompt runtime setup, and injected agent dispatch.
- `packages/rag-agent/src/campus_rag_agent/*.py` – agent entrypoint/composition and confidence heuristics.
- `packages/navigation-agent/src/campus_navigation_agent/*.py` – place-finding agent behavior.
- `packages/campus-services-agent/src/campus_services_agent/*.py` – structured campus-services runtime orchestration.
- `packages/notice-agent/src/campus_notice_agent/*.py` – notice runtime orchestration.
- `packages/official-web-core/src/campus_official_web_core/*.py` – official-web control-plane and source-truth logic.
- `packages/retrieval-core/src/campus_retrieval_core/*.py` – retrieval abstractions and Qdrant backend.
- `packages/ingestion-core/src/campus_ingestion_core/*.py` – ingestion pipelines, registries, object store keys, and runtime profile handling.

**Testing:**
- `tests/` – domain-aligned tests verifying contracts, retrieval backend, ingestion helpers, and supervisor flows.
- `tests/conftest.py` – shared fixtures across suites.

**Documentation:**
- `README.md` – top-level orientation and baseline instructions.
- `docs/architecture/*.md` – permanent architecture/phase docs.
- `docs/decisions/*.md` – ADRs such as `adr-0006-agent-orchestration-and-safety.md`.
- `docs/plans/*.md` – planning artifacts for future phases.

## Naming Conventions

**Files:**
- `snake_case.py` for modules and helper scripts (e.g., `process_raw_ingestion_job.py`, `backend_qdrant.py`).
- `kebab-case` for runtime directories (e.g., `apps/supervisor-api`, `apps/supervisor-agent-worker`).
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
- Primary deterministic/runtime code: `apps/supervisor-api/internal/*`.
- Primary semantic agent code: the relevant `packages/*-agent` package.
- Bridge-only Python code: `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker`
  when private bridge parsing or agent delegate injection changes.
- Tests: `tests/supervisor/`, Go package tests under `apps/supervisor-api`, plus relevant
  domain suites.
- Config: update `configs/ingestion` only when a new corpus or runtime profile is introduced.

**New Agent or Retrieval Module:**
- Implementation: `packages/rag-agent/src/campus_rag_agent` for knowledge-agent
  orchestration, `packages/retrieval-core/src/campus_retrieval_core` for backend adapters.
- Types: `packages/contracts/src/campus_contracts/models.py` when adding new handoff fields or statuses.
- Tests: `tests/agent/` and `tests/retrieval/` for the new behavior/backends.

**New Ingestion Capability:**
- Implementation: `packages/ingestion-core/src/campus_ingestion_core` (raw ingestion, chunking, registry helpers).
- Config: add new corpus profile in `configs/ingestion/<corpus>/runtime-profile.json`.
- Tests: `tests/ingestion/` plus `tests/retrieval/` if retrieval gating changes.

**Utilities & Shared Helpers:**
- Shared helpers: `packages/shared/src/campus_shared/`.
- Type definitions: `packages/contracts/src/campus_contracts/`.
- Tests: `tests/contracts/` or package-specific suites as necessary.

**Runtime Shells & Scripts:**
- API adjustments: `apps/supervisor-api/internal/*`.
- Ingestion shells: `apps/ingestion-worker/src/campus_ingestion_worker/`.
- Shared app/backend runtime: `apps/app-api/src/`.
- Worker web surfaces: `apps/public-chat-web/src/` and `apps/protected-panel-web/src/`.

## Special Directories

**.planning/**
- Purpose: workspace planning artifacts (like this structure map). Source-of-truth for planning tools and should not contain runtime code.
- Source: created by mapper agents (`.codex/get-shit-done` workflows).
- Committed: yes (these docs live under version control).

**var/**
- Purpose: holds runtime-generated registries and import reports.
- Source: ingestion job outputs and local test runners writing to `var/import-reports`, `var/registry`, `var/qdrant-cloud-backups`.
- Committed: yes (fixtures) but treat contents as environment-specific; avoid committing runtime noise beyond controlled fixtures.

**infra/**
- Purpose: local infrastructure reference configs.
- Source: developer-provided scripts or configs under `infra/local`.
- Committed: yes; extend when local infra definitions evolve.
