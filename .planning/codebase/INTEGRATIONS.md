# External Integrations

**Analysis Date:** 2026-03-28

## APIs & External Services

**Embedding & semantic search backend (OpenAI-compatible by default)**
- Service: Embeddings are requested through `llama_index.embeddings.openai.OpenAIEmbedding` (see `packages/ingestion-core/src/campus_ingestion_core/embed.py`), but the repo default is an OpenAI-compatible endpoint rather than the OpenAI public endpoint itself.
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
- File-based fallback registries (`FileDocumentRegistry`, `FileRawAssetRegistry`) store JSON snapshots under `var/` when Postgres is absent.

**File Storage:**
- MinIO-compatible S3 service (configuration in `packages/ingestion-core/src/campus_ingestion_core/settings.py`).
  - Connection: `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY`, `OBJECT_STORE_REGION`, `OBJECT_STORE_SECURE`.
  - Buckets: `OBJECT_STORE_BUCKET_SOURCE` and `OBJECT_STORE_BUCKET_DERIVED` (default `campus-rag-source` / `campus-rag-derived`).
  - Client: `boto3>=1.35.0`, with key construction defined in `packages/ingestion-core/src/campus_ingestion_core/object_store.py`.
- Qdrant vector database (the vector store is fronted by `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`).
  - Connection: `QDRANT_URL`, optional `QDRANT_API_KEY`, required `QDRANT_COLLECTION`, and `QDRANT_TIMEOUT_SECONDS`.
  - Client libraries: `qdrant-client>=1.17.1`, `llama-index-vector-stores-qdrant>=0.10.0`.
  - Collections: `RetrievalSettings.from_env()` now fail-closes when `QDRANT_URL` or `QDRANT_COLLECTION` is missing. Shared-dev and production are expected to use a managed/cloud Qdrant endpoint; local `:memory:` remains a test-only fallback, not a serving default.
- CampusRAG legacy assets are ingested through `apps/ingestion-worker` using `CAMPUSRAG_OCR_ROOT`, `CAMPUSRAG_RAW_ROOT`, and `RAW_INGESTION_SOURCE_PATHS`; these paths simply point to local files/directories that the ingestion worker uploads to MinIO.

**Caching:**
- No dedicated cache service is registered; all state is persisted via Postgres, MinIO, or Qdrant, so caching incentives remain inside the retrieval service’s metadata filters (`MetadataFilters` in `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`).

## Authentication & Identity

**Supervisor API bearer auth**
- Implementation: `apps/supervisor-api/src/campus_supervisor_api/auth.py` enforces `API_AUTH_MODE=bearer` (default).
  - Credentials: `API_BEARER_TOKEN` must match the `Authorization: bearer` header; bearer mode projects the configured default actor (`API_DEFAULT_ACTOR_ID`, `API_DEFAULT_ACTOR_GROUPS`, `API_DEFAULT_ACTOR_ROLES`, `API_DEFAULT_CAMPUS_SCOPE`) instead of trusting caller-supplied actor headers.
  - Sessions are stateless per request, and actor metadata is mapped into the `ActorContext` model from `packages/contracts`.

**Trusted worker auth**
- Implementation: `API_AUTH_MODE=trusted-worker` requires `x-worker-origin-auth` plus a forwarded `cf-access-jwt-assertion`; `map_actor_context` derives user/group/role claims from the configured trusted JWT claim names and falls back to worker defaults only when claims are absent.

**AgentOS runtime metadata**
- The supervisor records model hints in `AgentOSRuntime` (`apps/supervisor-api/src/campus_supervisor_api/app.py`), and the runtime expects Agno models to be supplied via `AGNO_SUPERVISOR_MODEL` and `AGNO_SPECIALIST_MODEL`. The repo does not yet invoke an Agno API from here, but the metadata fields keep longer-term deployments consistent with AgentOS conventions.

## Monitoring & Observability

**Tracing/logging**
- All tracing toggles are environment-driven: `TRACE_ENABLED`/`TRACE_EXPORTER` are listed in `.env.example`, and the API defaults to console logging (`TRACE_EXPORTER=console`).
- Audit logs are written to `./var/log/audit.log` by default via `apps/supervisor-api/src/campus_supervisor_api/settings.py`.

**Error tracking / analytics**
- No third-party error/analytics services are declared in the repo; observability currently relies on local console output and the audit log path.

## CI/CD & Deployment

**Hosting:**
- No hosted platform is codified; the repo intentionally keeps runtime choices open (`docs/architecture/long-term-architecture.md` emphasizes boundary-first design).
- Local runs are expected through the `uv` workspace entrypoints (for example `uv run --all-packages campus-supervisor-api-dev`), with `apps/supervisor-api` acting purely as a transport shim.

**CI Pipeline:**
- Tests and verification are executed via `uv run --all-packages python -m unittest discover -s tests -t .` (documented in `README.md`). There is no GitHub Action, Terraform, or other pipeline defined inside the repo.

## Environment Configuration

**Development:**
- Required env vars (all spelled out in `.env.example`): `AGNO_SUPERVISOR_MODEL`, `AGNO_SPECIALIST_MODEL`, `API_BEARER_TOKEN`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `DOCUMENT_REGISTRY_DATABASE_URL`, `QDRANT_URL`, `QDRANT_COLLECTION`, `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY`, `CAMPUSRAG_OCR_ROOT`, `OCR_BASE_URL`, `OCR_API_KEY`.
- Secrets are expected in the environment (no checked-in `.env`), so local developers typically copy `.env.example` and fill values before running `uv sync` + ingestion/retrieval commands.
- Mock coverage: the embedding stack can run with `EMBEDDING_PROVIDER=mock` if actual OpenAI credentials are unavailable, and registry fallbacks exist in `var/` files.
- `apps/public-consumer-chat` live mode additionally requires `PUBLIC_CONSUMER_CHAT_SCOPE_CORPUS` and `PUBLIC_CONSUMER_CHAT_SCOPE_COLLECTION`, so the app sends an explicit supervisor answer scope instead of relying on a handbook hardcode.

**Staging / Production:**
- The repo does not include separate staging overrides; promote env vars from the `.env.example` sections and swap `QDRANT_URL`/`OBJECT_STORE_ENDPOINT` to staging endpoints as needed.
- `TRACE_ENABLED` and `TRACE_EXPORTER` can be toggled per environment if richer tracing backends are added later.

## Webhooks & Callbacks

**Incoming:**
- None beyond the standard HTTP routes defined in `apps/supervisor-api/src/campus_supervisor_api/api.py` (`/api/v1/answer`, `/healthz`, `/readyz`); no webhook signatures or event handlers are registered.

**Outgoing:**
- No background webhook calls are defined. All external communication happens (1) via the OCR provider, (2) via embedding/Qdrant services, and (3) through the ingestion worker uploading to MinIO or writing to Postgres.
