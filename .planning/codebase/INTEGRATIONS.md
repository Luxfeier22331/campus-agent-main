# External Integrations

**Analysis Date:** 2026-04-26

## APIs & External Services

**Embedding & semantic search backend (OpenAI-compatible by default)**
- Service: Embeddings are requested through `llama_index.embeddings.openai.OpenAIEmbedding` or the repo’s `OpenAICompatibleEmbedding` wrapper (see `packages/ingestion-core/src/campus_ingestion_core/embed.py`), but the runtime default is a Gitee OpenAI-compatible endpoint rather than the OpenAI public endpoint itself.
  - Integration method: Batch embedding requests pulled from `EmbeddingSettings.from_env`, so the ingestion and retrieval cores always call the configured provider before talking to Qdrant.
  - Auth: `EMBEDDING_API_KEY` (plus optional `EMBEDDING_BASE_URL` overrides the provider endpoint). Other knobs include `EMBEDDING_MODEL`, `EMBEDDING_TIMEOUT_SECONDS`, and `EMBEDDING_BATCH_SIZE` as exposed in `.env.example`.

**Online OCR service (PaddleOCR-VL-1.5)**
- Service: PaddleOCR job submission/ polling handled inside `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py` via `PaddleOcrAsyncClient`.
  - Integration method: `requests` POST to `OCR_BASE_URL` with `API_KEY` in the `Authorization: bearer` header, then poll `<base_url>/<job_id>` until the job reports `state == "done"`.
  - Auth: `OCR_API_KEY` (required together with `OCR_BASE_URL`).
  - Config: `OCR_MODEL`, `OCR_POLL_SECONDS`, and `OCR_TIMEOUT_SECONDS` are environment-driven timeouts; the ingestion worker stores source-level `provider-response.jsonl` / `layout-elements.jsonl` plus derived document artifacts in MinIO.

## Data Storage

**Databases:**
- PostgreSQL Document Registry (`PostgresDocumentRegistry` in `packages/ingestion-core/src/campus_ingestion_core/registry.py`).
  - Connection: `DOCUMENT_REGISTRY_DATABASE_URL` (expects a fully formed Postgres URL; `.env.example` warns to use the Supabase pooler when applicable).
  - Client: `psycopg[binary]>=3.2.0`.
  - Schema/migrations: `_ensure_schema()` inside the registry ensures tables exist; there is no separate migration tool logged in the repo, so schema drift must be managed via code changes.
- Current env-backed runtime path does not auto-fallback to file registries; `build_document_registry_from_env()` / `build_raw_asset_registry_from_env()` require Postgres URLs.

**File Storage:**
- MinIO-compatible S3 service (configuration in `packages/ingestion-core/src/campus_ingestion_core/settings.py`).
  - Connection: `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY`, `OBJECT_STORE_REGION`, `OBJECT_STORE_SECURE`.
  - Buckets: `OBJECT_STORE_BUCKET_SOURCE` and `OBJECT_STORE_BUCKET_DERIVED` (default `campus-rag-source` / `campus-rag-derived`).
  - Client: `boto3>=1.35.0`, with key construction defined in `packages/ingestion-core/src/campus_ingestion_core/object_store.py`.
- Qdrant vector database (the vector store is fronted by `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`).
  - Connection: `QDRANT_URL`, optional `QDRANT_API_KEY`, and `QDRANT_TIMEOUT_SECONDS`.
  - Client libraries: `qdrant-client>=1.17.1`, `llama-index-vector-stores-qdrant>=0.10.0`.
  - Collections: `RetrievalSettings.from_env()` now fail-closes when `QDRANT_URL` is missing. Online query targets no longer come from a global env var; retrieval resolves the serving alias from each collection runtime profile, and ingestion publishes versioned physical collections as `<collection_prefix>__<release_id>`.
- CampusRAG legacy assets are ingested through `apps/ingestion-worker` using `CAMPUSRAG_OCR_ROOT`, `CAMPUSRAG_RAW_ROOT`, and `RAW_INGESTION_SOURCE_PATHS`; these paths simply point to local files/directories that the ingestion worker uploads to MinIO.

**Caching:**
- No dedicated cache service is registered; all state is persisted via Postgres, MinIO, or Qdrant, so caching incentives remain inside the retrieval service’s metadata filters (`MetadataFilters` in `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`).

## Authentication & Identity

**Supervisor API bearer auth**
- Implementation: Go `apps/supervisor-api/internal/httpapi/auth.go` enforces internal
  caller auth for the execution service.
  - Credentials: `API_BEARER_TOKEN` must match the `Authorization: bearer` header; bearer mode projects the configured default actor (`API_DEFAULT_ACTOR_ID`, `API_DEFAULT_ACTOR_GROUPS`, `API_DEFAULT_ACTOR_ROLES`, `API_DEFAULT_CAMPUS_SCOPE`) instead of trusting caller-supplied actor headers.
  - Sessions are stateless per request, and actor metadata is mapped into the `ActorContext` model from `packages/contracts`.

**Trusted execution caller auth**
- Implementation: `apps/app-api` owns product identity/session projection, while Go
  `apps/supervisor-api` verifies the internal execution caller and consumes the typed
  actor/context projection.

**Prompt runtime metadata**
- Go `apps/supervisor-api` owns deterministic prompt admission summary, while Python
  `apps/supervisor-agent-worker` and `packages/rag-agent` own provider-backed prompt
  executor construction.

## Monitoring & Observability

**Tracing/logging**
- All tracing toggles are environment-driven: `TRACE_ENABLED`/`TRACE_EXPORTER` are listed in `.env.example`, and the API defaults to console logging (`TRACE_EXPORTER=console`).
- Execution audit/metrics/readiness are owned by Go `apps/supervisor-api`; deployment
  sink configuration is environment-specific.

**Error tracking / analytics**
- Third-party telemetry is now declared in the Worker product surfaces:
  - `apps/app-api`, `apps/public-chat-web`, and `apps/protected-panel-web` depend on `@sentry/cloudflare`.
  - `apps/app-api` also contains a Worker-local Axiom REST ingest adapter for minimal runtime events.
- Current merged truth is not “no external telemetry”, but “runtime code is landed, local pre-deploy readiness is reproducible, and live sink verification belongs to the first real deployed environment”.
- As of 2026-03-31, the repo already has a repeatable local readiness path (`scripts.check_worker_observability_env` plus targeted Worker smokes). `SENTRY_*` / `AXIOM_*` confirmation and sink evidence are now deployment-gate work, not an active local code blocker.

## CI/CD & Deployment

**Hosting:**
- No hosted platform is codified; the repo intentionally keeps runtime choices open (`docs/architecture/target-architecture.md` emphasizes boundary-first design).
- Local Python package commands use `uv`; Go `apps/supervisor-api` runs through its Go
  module / repo wrapper commands when exercising the execution service.

**CI Pipeline:**
- Tests and verification are executed via `uv run --all-packages python -m unittest discover -s tests -t .` (documented in `README.md`). There is no GitHub Action, Terraform, or other pipeline defined inside the repo.

## Environment Configuration

**Development:**
- Required env vars are split by runtime: Go supervisor execution/auth/prompt admission,
  Python prompt provider/executor, retrieval/embedding, object storage, ingestion/OCR,
  and app-api Worker product settings. See app-local env examples and runbooks rather
  than treating one Python supervisor env block as canonical.
- Secrets are expected in the environment (no checked-in `.env`), so local developers typically copy `.env.example` and fill values before running `uv sync` + ingestion/retrieval commands.
- Current retrieval/index defaults are `EMBEDDING_PROVIDER=gitee`, `EMBEDDING_MODEL=Qwen3-Embedding-4B`, `EMBEDDING_DIMENSIONS=2560`, plus Qdrant native sparse settings (`SPARSE_PROVIDER=qdrant`, `SPARSE_MODEL=qdrant/bm25`, `SPARSE_TOKENIZER=multilingual`, `SPARSE_LANGUAGE=none`).
- Mock embedding/sparse helpers still exist for unit tests and isolated local pipelines, but they are not the runtime baseline recorded in `.env.example`.
- Historical `apps/public-consumer-chat` local runs additionally require `PUBLIC_CONSUMER_CHAT_SCOPE_CORPUS` and `PUBLIC_CONSUMER_CHAT_SCOPE_COLLECTION`; those vars belong to the retained migration reference, not the forward merged-truth app topology.

**Staging / Production:**
- The repo does not include separate staging overrides; promote env vars from the `.env.example` sections and swap `QDRANT_URL`/`OBJECT_STORE_ENDPOINT` to staging endpoints as needed.
- `TRACE_ENABLED` and `TRACE_EXPORTER` can be toggled per environment if richer tracing backends are added later.

## Webhooks & Callbacks

**Incoming:**
- None beyond the standard HTTP routes defined in Go `apps/supervisor-api`
  (`/api/v1/answer`, `/api/v1/answer/stream`, `/healthz`, `/readyz`, `/metrics`, and
  cancellation); no webhook signatures or event handlers are registered.

**Outgoing:**
- No background webhook calls are defined. All external communication happens (1) via the OCR provider, (2) via embedding/Qdrant services, and (3) through the ingestion worker uploading to MinIO or writing to Postgres.
