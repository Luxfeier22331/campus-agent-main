---
doc_type: reference
truth_scope: ops
owner_boundary: docs/environment
status: active
created: 2026-04-12
updated: 2026-06-29
---

# Providers

## Boundary

This document is the single provider and secret inventory for repo-supported
runtime work. It names provider families, ownership, where values live and the
minimum provider/env sets for common tasks. It does not duplicate provider
console walkthroughs or deploy runbooks.

Reading model:

- `.env.example` is not a staging or production secret inventory.
- Local seed env may initialize provider-config, but online serving consumes
  explicit provider-config projection artifacts where that runtime requires it.
- Server-only secrets stay in app-local dev vars, deploy secret stores or
  ops-owned runtime env files.
- Browser public runtime strings must be explicitly labeled as public.

## Core Providers

### LLM

- Owner: `apps/app-api` provider-config connection/profile.
- Consumers: `execution-control`, Hindsight and eval runtime through local
  provider projection artifacts.
- Required roles: `primary_agent`, `rag_synthesis`, `hindsight_llm`.
- Local seed keys: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, optional
  `RAG_SYNTHESIS_MODEL`.
- Runtime truth: `CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH`.
- Validation: create, validate and activate profiles through Operator Console;
  raw keys must not return to browser surfaces.

### Embeddings

- Owner: `apps/app-api` provider-config connection/profile.
- Current retrieval baseline: `Qwen3-Embedding-4B`, `dimensions=2560`,
  `openai-compatible`.
- Roles: `rag_query_embedding`, `hindsight_embedding`,
  `eval_ragas_embedding`.
- Local seed keys: `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`,
  `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`.
- Runtime truth: provider projection artifact plus collection runtime profile.
- References:
  - `../decisions/adr-0007-phase1-retrieval-baseline-update.md`
  - `../policies/student-handbook-chunking-and-validation-policy.md`

### Rerank

- Owner: `apps/app-api` provider-config connection/profile.
- Role: `rag_reranker`.
- Local seed keys: `RERANK_BASE_URL`, `RERANK_API_KEY`, `RERANK_PATH`,
  `RERANK_MODEL`.
- Runtime truth: local provider projection artifact.
- Rule: runtime profile must explicitly enable rerank; missing profile, path,
  score or provider response fails closed.

### Qdrant

- Owner: ingestion/retrieval data plane.
- Canonical local/staging lifecycle projects `QDRANT_URL=http://qdrant:6333`
  and generated keys.
- Online runtime uses read-only `QDRANT_QUERY_API_KEY`.
- Admin `QDRANT_API_KEY` is only for lifecycle, backup, restore or ingestion.
- External endpoint override belongs in ops-owned runtime env and must use HTTPS
  plus `QDRANT_TLS_CA_CERT_PATH` when crossing substrate/public ingress.
- Reference: `../architecture/system/data-plane.md`.

### Hindsight

- Owner: personal memory runtime.
- Handles: `PERSONAL_MEMORY_BASE_URL`, `PERSONAL_MEMORY_API_SECRET`,
  `PERSONAL_MEMORY_OWNER_SALT`.
- Provider roles: `hindsight_llm`, `hindsight_embedding`.
- Deployment-internal keys such as Hindsight Postgres password, generated API
  secret and owner salt live in local/staging generated runtime env, not root
  `.env`.
- Reference: `../architecture/system/memory-plane.md`.

### Postgres

- Root `.env` only owns shared local Postgres handles:
  `CAMPUS_SHARED_POSTGRES_URL`, `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`.
- App-specific, registry, run-projection and staging operator DSNs live in the
  owning app/runtime env.
- Runtime ownership is documented in `../data/postgres-ownership.md`.

### Object Storage

- Architecture semantic: S3-compatible object storage.
- Bucket names and source/derived ownership are repo truth; provider brand is
  not.
- Object storage is not the online query-time source for transport timetable
  reads.
- Reference: `../architecture/system/data-plane.md`.

## App And Edge Providers

### Cloudflare Turnstile

- Server secret: `AUTH_TURNSTILE_SECRET_KEY` in `apps/app-api/.dev.vars` or
  Worker secret store.
- Browser public values: `AUTH_TURNSTILE_SITE_KEY`,
  `AUTH_TURNSTILE_APPEARANCE`, `AUTH_TURNSTILE_EXECUTION` in `apps/campus-web`.
- Scope: sign-in, sign-up and password reset protection.
- Staging/production must use admitted host widgets. Automation tests may use
  Cloudflare testing credentials only.

### OCR

- Scope: ingestion, replay and comparison only; not online query serving.
- Command/domain keys: `OCR_*` and optional lane-specific `OCR_MINERU_*`.
- `OCR_PROVIDER_MODE` must be explicit.
- MinerU is a controlled extraction lane, not a repo-wide second canonical
  provider.
- Reference: `../decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`.

### FeedWe

- Owner: WeChat official account public source-channel acquisition.
- Env owner: `apps/wechat-official-account-collector/.env` or deploy-side
  secret store.
- Keys: `FEEDWE_EMAIL`, `FEEDWE_PASSWORD`, `FEEDWE_BASE_URL`,
  `WECHAT_OFFICIAL_ACCOUNT_APP_API_BASE_URL`,
  `WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN`.
- Rule: FeedWe response is acquisition/audit input; canonical body/media must
  come from follow-up public article capture.

### Better Auth

- Owner: `apps/app-api`.
- Current auth mode: email/password with reset flow.
- Required secret: `BETTER_AUTH_SECRET`.
- Current merged truth does not require GitHub, Google, WeChat or other social
  OAuth credentials.

### Resend

- Owner: `apps/app-api`.
- Scope: Better Auth password reset and password-change transactional email.
- Keys: `RESEND_API_KEY`, `AUTH_RESET_EMAIL_FROM`, optional
  `AUTH_RESET_EMAIL_REPLY_TO`.
- Runtime: HTTPS provider from Worker runtime; not SMTP-only.

### Cloudflare Worker Deploy

- Owner: each Worker app and deploy secret store.
- Surfaces: `apps/app-api`, `apps/campus-web`, `apps/operator-console-web`.
- Rule: app runtime secrets stay in app-local Worker secret stores. Retrieval
  data-plane, object-store and execution-control compose env stay in ops-owned
  runtime env.

### Telemetry

- Owner: observability runtime and deploy-side secret store.
- Collector/provider keys belong to `infra/otel/collector.env.example`,
  app-local env or staging runtime env according to the owning runtime.
- Reference: `../architecture/system/ops-observability.md`.

## Environment Sets

### Query / App API / Web Local Dev

Required:

- root `.env`: shared Postgres handles only
- app-api provider-config active profiles:
  `primary_agent`, `rag_synthesis`, `rag_query_embedding`
- local runtime lifecycle projection for Qdrant and generated runtime secrets
- `apps/app-api/.env`: Wrangler / Drizzle process env
- `apps/app-api/.dev.vars`: app-api Worker runtime env, including auth,
  execution-control and internal shared-secret handles
- `apps/campus-web/.dev.vars`: `APP_API_BASE_URL`
- `apps/operator-console-web/.dev.vars`: only when using operator panel

Not required:

- OCR
- object storage
- eval-only provider isolation

### Docs Reader Build / Smoke

Add:

- `env/commands/campus-docs-reader-build.env`
- derived object-store access for the docs reader publish path

For feature worktrees, first run:

```bash
uv run --all-packages python -m scripts.link_worktree_app_local_env \
  --repo-root "$PWD"
```

### Ingestion / Replay / Rebuild

Add only what the selected task registry/command requires:

- collector app-local or command-scoped object-store env
- OCR provider env for extraction lanes
- domain runtime profile inputs

Do not revive old Python ingestion command env as fallback truth.

### Worker Staging Deploy

Add:

- Cloudflare deploy access
- app-local Worker secrets for each deployed app
- Cloudflare Access configuration for protected operator/machine ingress
- Sentry / telemetry env for the deployed surface when enabled
- controlled OTLP ingest endpoint/shared secret for app-api when enabled

Execution-control Docker/K8s runtime env remains ops-owned and is not copied into
Worker secret stores.

### Not Required By Current Merged Truth

- GitHub / Google / WeChat social OAuth credentials
- independent eval providers unless budget or quota isolation is explicitly
  required
- extra OCR sidecar providers unless a declared extraction lane or comparison
  task needs them
