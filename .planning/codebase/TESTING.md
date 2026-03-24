# Testing Patterns

**Analysis Date:** 2026-03-23

## Test Framework

**Runner:**
- `python -m unittest discover -s tests -t .` is the baseline; every package is expected to load through the workspace `tests/__init__.py` setup so the runner can import `apps/*/src` and `packages/*/src`.
- Targeted runs (e.g., `uv run --all-packages python -m pytest tests/specialist/test_rag_specialist.py -q` as listed in `packages/rag-specialist/AGENTS.md`) use `pytest` to take advantage of its filtering flags even though the file itself defines `unittest.TestCase` subclasses.

**Assertion Library:**
- Built-in `unittest` assertions provided by `test.TestCase` (`assertEqual`, `assertIsInstance`, `assertRaises`, etc.) dominate existing suites such as `tests/ingestion/test_chunking_policy.py` and `tests/api/test_supervisor_api.py`.
- `pytest` is used purely as a runner for targeted suites; no `pytest`-specific matcher APIs (like `expect` or fixtures) appear in current test files.

## Run Commands

```bash
uv run --all-packages python -m unittest discover -s tests -t .
uv run --all-packages python -m pytest tests/specialist/test_rag_specialist.py -q
```

The first command is the canonical “run everything” verification referenced in `AGENTS.md`. The second command is recommended when working inside `packages/rag-specialist` (`packages/rag-specialist/AGENTS.md`) to focus on the specialist logic without rerunning unrelated suites.

## Test File Organization

- `tests/` mirrors the code layers: `tests/api/`, `tests/ingestion/`, `tests/retrieval/`, `tests/specialist/`, `tests/supervisor/`, plus `tests/contracts/` and `tests/test_workspace_layout.py` for meta-checks.
- Files live under `tests/<layer>/test_<feature>.py`, such as `tests/api/test_supervisor_api.py` for transport behavior and `tests/ingestion/test_chunking_policy.py` for ingestion chunking logic.
- Shared fixtures and workspace setup live in `tests/__init__.py` and `tests/conftest.py`, which are imported automatically by the runner (no separate `tests/fixtures` directory is currently used).

## Test Structure

- Suites are standard `unittest.TestCase` subclasses (`ChunkingPolicyTest`, `SupervisorApiTest`, `BackendQdrantTest`), with each `test_*` method focusing on a single behavior.
- Tests follow the arrange/act/assert pattern: arrange dependencies (helper builders or `TemporaryDirectory` setups), call the system under test, and assert results (`self.assertEqual`, `self.assertRaises`, `self.assertIn`, etc.).
- Helper methods live inside the test module (e.g., `_make_registry_record`, `_make_structured_jsonl` in `tests/retrieval/test_backend_qdrant.py`) to share common data without a separate fixture file.
- When repeated setup is needed (such as adjusting environment variables), tests use context helpers like `patch.dict(os.environ, ...)` from `unittest.mock`.

## Mocking

- Use `unittest.mock.patch` liberally to isolate external dependencies (`tests/api/test_supervisor_api.py` patches the supervisor handler and environment, `tests/retrieval/test_backend_qdrant.py` patches `build_document_registry_from_env`).
- `TemporaryDirectory` and in-memory backends (`QdrantClient(location=":memory:")`) simulate file systems and external services without hitting real infrastructure.
- Build mock embedding behavior via helpers from the ingestion package (`MockEmbeddingSettings`, `build_mock_embedding_model` in `tests/retrieval/test_backend_qdrant.py`) so the backend can produce deterministic vectors.
- When mocking modules, patch at import time with `patch("module.path")` and rely on `mocked_instance.return_value` to control downstream behavior while keeping assertions within the owning test.

## Fixtures and Factories

- `tests/__init__.py` and `tests/conftest.py` call `add_workspace_sources()` so that `uv run`/`pytest` discover the package `src/` directories—this is the only repo-wide fixture and is executed before any test file runs.
- Tests define inline factory helpers for domain objects (`_make_registry_record`, `_make_structured_jsonl`, `StructuredUnitChunkInput` builders), keeping them close to the tests that use them.
- Shared configuration values (e.g., chunking defaults from `packages/ingestion-core/src/campus_ingestion_core/chunking.py`) are imported directly so tests track the same runtime truth as production code.

## Coverage Expectations

- No explicit coverage target is enforced; the repo focuses on ensuring the baseline `uv run --all-packages python -m unittest discover -s tests -t .` passes before merging.
- Coverage reporting is not configured in `pyproject.toml` or anywhere else, so teams treat coverage as informational and add tooling only when a future need arises.

## Test Types

- **Unit tests:** cover discrete helpers and dataclasses (`tests/ingestion/test_chunking_policy.py`, `tests/contracts/test_models.py`) with direct imports from `packages/*`.
- **Integration tests:** exercise multiple layers together by building registries, invoking `QdrantRetrievalBackend`, and routing through `create_app` in `tests/api/test_supervisor_api.py`.
- **E2E tests:** none currently exist; call `apps/supervisor-api` or `apps/ingestion-worker` manually if deeper verification is required.

## Common Patterns

- Arrange inputs with helpers or fixtures, run the subject, assert outcomes, and prefer `with self.assertRaises(...)` for invalid inputs (`ChunkProfile` validation uses this style).
- Use `TemporaryDirectory` to house registries/objects and clean up automatically, which keeps tests hermetic (`tests/retrieval/test_backend_qdrant.py`).
- Build deterministic evidence/assertion objects for each test rather than reusing global mutable state (`tests/specialist/test_rag_specialist.py` uses `_make_evidence` for reproducibility).
- Keep mocks scoped to the test function so they do not bleed into other suites; `patch` is usually applied as a context manager inside the method.

## Local Verification

- Run the full suite via the canonical command; rely on `tests/__init__.py` to load all `src` paths first.
- Target the specialist suite with `uv run --all-packages python -m pytest tests/specialist/test_rag_specialist.py -q` when working inside `packages/rag-specialist`.
- When adding ingestion tests, focus on `tests/ingestion/` filenames and follow the chunking/cleaning helpers already present.

## CI Gates

- There is no dedicated CI workflow documented yet, but the repo-level `AGENTS.md` specifies that the same `uv run --all-packages python -m unittest discover -s tests -t .` command should serve as the verification gate before merging.
