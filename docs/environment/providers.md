---
doc_type: reference
truth_scope: ops
owner_boundary: docs/environment
status: active
created: 2026-04-12
updated: 2026-07-06
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
- K8s ConfigMap/Secret, Helm values and Cloudflare Worker vars/secrets carry
  deploy bootstrap config or secret material. They must not become LLM/search
  provider active-profile truth.

## Core Providers

### LLM

- Owner: `apps/app-api` provider-config connection/profile.
- Consumers: `execution-control`, Hindsight and eval runtime through local
  provider projection artifacts.
- Required roles: `primary_agent`, `rag_synthesis`, `hindsight_llm`.
- Local seed keys: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, optional
  `RAG_SYNTHESIS_MODEL`.
- Local seed template: `env/commands/provider-config-seed.env.example`.
- Runtime truth: `CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH`.
- Validation: create, validate and activate profiles through Operator Console;
  raw keys must not return to browser surfaces.
- Search-provider pricing must not be represented as zero when unknown. Add a
  `provider-pricing.v1` entry only after the configured provider/model has a
  real accepted rate; otherwise public-web-search readiness and eval evidence
  should report provider/model identity without cost projection.

### Search

- Owner: `apps/app-api` provider-config connection/profile.
- Role: `public_web_search`.
- Scope: this section is only the admitted provider inventory. Provider class
  taxonomy, candidate matrix and default-provider bakeoff rules live in
  `../domains/public-web-search.md` and `../reference/eval.md`.
- Current admitted provider identities:

| role | provider | kind | transport |
| --- | --- | --- | --- |
| `public_web_search` | `perplexity` | `search` | `perplexity_search` |
| `public_web_search` | `perplexity_compatible` | `search` | `perplexity_search` |
| `public_web_search` | `openai` | `search` | `openai_responses_web_search` |
| `public_web_search` | `gemini` | `search` | `gemini_google_search` |
| `public_web_search` | `linux_do` | `search` | `openai_chat_completions_web_search` |

- `provider` is the real provider identity. `transport` is the wire contract.
  `perplexity_compatible` must not be recorded as official `perplexity`.
- Linux.do prompt profiles and Linux.do public-web-search profiles are
  separate. `public_web_search` with Linux.do must be `kind=search` and
  `transport=openai_chat_completions_web_search`, not a generic
  `chat_completions` prompt profile.
- Provider adoption is an eval decision. Candidate search providers must be
  configured as explicit provider/transport pairs and scored through the same
  public-web-search eval pipeline before becoming a default provider profile.
- Local seed keys: `PUBLIC_WEB_SEARCH_BASE_URL`,
  `PUBLIC_WEB_SEARCH_API_KEY`, `PUBLIC_WEB_SEARCH_MODEL`,
  `PUBLIC_WEB_SEARCH_PROVIDER`, `PUBLIC_WEB_SEARCH_TRANSPORT`.
- Local seed template: `env/commands/provider-config-seed.env.example`.
- Consumer: `apps/execution-control` `public_web_search` typed tool.
- Rule: search profile output is sanitized online evidence only; it must not
  mutate official-web source truth, object storage, Qdrant or release manifests.
- Rule: no provider fallback chain, provider auto-detection, result merge or
  model-selected provider routing is admitted for this role.

### Embeddings

- Owner: `apps/app-api` provider-config connection/profile.
- Current retrieval baseline: `Qwen3-Embedding-4B`, `dimensions=2560`,
  `openai-compatible`.
- Roles: `rag_query_embedding`, `hindsight_embedding`,
  `eval_ragas_embedding`.
- Local seed keys: `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`,
  `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`.
- Local seed template: `env/commands/provider-config-seed.env.example`.
- Runtime truth: provider projection artifact plus collection serving config.
- References:
  - `../decisions/adr-0007-phase1-retrieval-baseline-update.md`
  - `../policies/student-handbook-chunking-and-validation-policy.md`

### Rerank

- Owner: `apps/app-api` provider-config connection/profile.
- Role: `rag_reranker`.
- Local seed keys: `RERANK_BASE_URL`, `RERANK_API_KEY`, `RERANK_PATH`,
  `RERANK_MODEL`.
- Local seed template: `env/commands/provider-config-seed.env.example`.
- Runtime truth: local provider projection artifact.
- Rule: serving config must explicitly enable rerank; missing config, path,
  score or provider response fails closed.

### Qdrant

- Owner: ingestion/retrieval data plane.
- Canonical local/staging lifecycle projects `QDRANT_URL=http://qdrant:6333`
  and generated keys.
- Online runtime uses read-only `QDRANT_QUERY_API_KEY`.
- Admin `QDRANT_API_KEY` is only for lifecycle, backup, restore or ingestion.
- K8s online execution clients must not carry `QDRANT_API_KEY` or
  `QDRANT_READ_ONLY_API_KEY`; they consume only `QDRANT_QUERY_API_KEY`.
  Qdrant server keys and TLS material are platform/data GitOps Secret
  contracts (`qdrant-server-secrets`, `qdrant-server-tls`) and are mounted into
  the Qdrant Helm release, not rendered by execution-runtime.
- External endpoint override belongs in ops-owned runtime env and must use HTTPS
  plus `QDRANT_TLS_CA_CERT_PATH` when crossing substrate/public ingress. K8s
  in-cluster Qdrant also enables service TLS because Qdrant API-key transport
  over plaintext is not admitted.
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

### Dining Feishu/Lark Sync

- Owner: `jobs/dining-sync`.
- Scope: read Feishu/Lark Base catalog records into
  `dining.source_observations`, publish accepted catalog observations into
  dining catalog/release tables, read Feishu/Lark Base review records, download
  accepted attachments, write public images to S3-compatible object storage and
  publish `dining.source_observations(source_type=feishu_review)` plus
  `dining.review_projections`.
- Catalog import env keys:
  `DATABASE_URL` or `APP_API_OPERATOR_DATABASE_URL`.
- Shared Feishu/Lark catalog env keys:
  `DINING_LARK_APP_ID`, `DINING_LARK_APP_SECRET`,
  `DINING_LARK_BASE_TOKEN`, `DINING_LARK_CAMPUS_TABLE_ID`,
  `DINING_LARK_HALL_TABLE_ID`, `DINING_LARK_STALL_TABLE_ID`,
  `DINING_LARK_DISH_TABLE_ID`, `DATABASE_URL`.
- Review sync env keys add:
  `DINING_LARK_REVIEW_TABLE_ID`, `DINING_LARK_REVIEW_VIEW_ID`,
  `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_REGION`, `OBJECT_STORE_ACCESS_KEY`,
  `OBJECT_STORE_SECRET_KEY`, `DINING_OBJECT_STORE_BUCKET`,
  `DINING_OBJECT_STORE_PUBLIC_BASE_URL`, `DINING_OBJECT_STORE_REVIEW_PREFIX`.
- Moderation env keys:
  `DINING_MODERATION_BASE_URL`, `DINING_MODERATION_API_KEY`,
  `DINING_MODERATION_TEXT_MODEL`, `DINING_MODERATION_IMAGE_MODEL`,
  `DINING_MODERATION_TIMEOUT_MS`.
- Current moderation provider: Gitee AI OpenAI-compatible moderation endpoint,
  default `DINING_MODERATION_BASE_URL=https://ai.gitee.com/v1`.
- Current moderation models:
  `DINING_MODERATION_TEXT_MODEL=Security-semantic-filtering` and
  `DINING_MODERATION_IMAGE_MODEL=nsfw-classifier`.
- `moark-text-moderation` is a paid optional text moderation model and may be
  selected by overriding `DINING_MODERATION_TEXT_MODEL` when needed.
- `nonescape-v0` is not the dining review image safety gate.
- `DINING_MODERATION_API_KEY` is a server-side Job/CronJob secret. Never commit
  the real token to git, docs, ConfigMap, or browser-facing env.
- `nsfw-classifier` consumes `image_url` inputs, so
  `DINING_OBJECT_STORE_PUBLIC_BASE_URL` must expose the derived moderation
  object prefix to the provider. The moderation prefix is not written to
  `dining.review_projections`.
- Placement: dining sync Job/CronJob Secret/ConfigMap or manual Job env.
  These values are not app-api Worker env and are not browser public env.
- Minimum Feishu/Lark scopes for the current catalog/review table shape:
  `base:table:read`, `base:field:read`, `base:record:retrieve`,
  `docs:document.media:download`.
- Wider scopes such as `bitable:app:readonly` or `bitable:app` are only
  acceptable when the tenant/platform cannot grant the narrower Base read
  scopes.
- Production uses a project-specific Feishu/Lark application identity. Local
  user `lark-cli` login is for validation/debug only and must not be mounted
  into CronJob runtime.
- `DINING_OBJECT_STORE_PUBLIC_BASE_URL` must resolve to a student/tool readable
  static resource base. Published projections must never store Feishu/Lark
  `file_token` or temporary download URLs.
- Catalog commands:
  - `sync-all` is the default Job/CronJob command. It refreshes and publishes
    catalog first, then syncs review observations/projections against that
    current catalog.
  - `catalog-observations` writes only
    `dining.source_observations(source_type=feishu_catalog)` by upsert and
    stale marking; it does not require review, object-store or moderation env.
  - `publish-catalog` refreshes Feishu/Lark catalog observations and writes the
    latest dining catalog/release snapshot; it does not require review,
    object-store or moderation env.
  - `publish-catalog-from-observations` writes the latest dining catalog/release
    snapshot from already-synced PG observations; it requires only a target PG
    connection and does not require Feishu/Lark env.
  - `import-dev-seed` imports a minimal local/dev seed outside production; it is
    not production catalog source truth.
  - `run` syncs only reviews and requires already-active catalog observations
    for stall/window binding.
- Current catalog sync does not write raw Feishu/Lark catalog archives to
  object storage. S3-compatible object storage is used for review image
  attachment materialization only.

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
- Env owner: `apps/source-collector/adapters/wechat-official-account/.env` or
  deploy-side secret store.
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
- Worker vars/secrets do not own `primary_agent`, `rag_synthesis`,
  `rag_query_embedding`, `rag_reranker`, `hindsight_*` or
  `public_web_search` active provider profiles. Those stay in app-api
  provider-config and are projected to runtimes through explicit snapshots.

### Kubernetes / GitOps Deploy

- Owner: K8s deploy substrate and GitOps runtime.
- Surfaces: `infra/k8s/**` Kustomize overlays and `infra/gitops/**` Argo CD
  skeleton.
- Rule: ConfigMaps carry non-secret bootstrap handles, Secrets carry delivered
  secret material, and the concrete K8s secret delivery path is selected by the
  deployment. Sealed Secrets is the repo-supported self-hosted/open-source
  GitOps recommended default; manual Kubernetes Secrets, External Secrets
  Operator and SOPS-backed encrypted Secrets remain valid deployment choices.
- Helm values are allowed only for third-party platform chart deployment
  parameters. They must not contain provider API keys, DSNs, tokens or app-api
  provider active-profile decisions.

### Telemetry

- Owner: observability runtime and deploy-side secret store.
- Collector/provider keys belong to `infra/otel/collector.env.example`,
  app-local env or staging runtime env according to the owning runtime.
- Reference: `../architecture/system/ops-observability.md`.

## Environment Sets

### Query / App API / Web Local Dev

Required:

- root `.env`: shared Postgres handles only
- `env/commands/provider-config-seed.env`: only when seeding/updating app-api
  provider-config profiles
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

For feature worktrees, provide the command-scoped env file explicitly in that
checkout or via the developer's local secret manager. The repo does not maintain
a script that copies or symlinks ignored env files between worktrees.

### Ingestion / Replay / Rebuild

Add only what the selected task registry/command requires:

- collector app-local or command-scoped object-store env
- OCR provider env for extraction lanes
- domain serving config inputs

Do not revive old Python ingestion command env as fallback truth.

### Dining Sync Job / CronJob

Add:

- dining Feishu/Lark sync env listed above
- shared Postgres runtime DSN for writing `dining.source_observations`,
  catalog/release tables and `dining.review_projections`
- S3-compatible object-store credentials for public review images
- content moderation provider env for `jobs/dining-sync`

Do not add these values to `apps/app-api/.dev.vars`; app-api online requests
read published projections only.

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
