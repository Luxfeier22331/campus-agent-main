# public-consumer-chat

Public consumer chat frontend for campus-agent v2.

This app is a separate `apps/*` product surface. Its accepted direction is:

- app host: `TanStack Start`
- auth: `Better Auth`
- primary relational store: `Supabase Postgres`
- auth/chat: one Postgres with schema split
- online retrieval store: `Qdrant`

This app owns chat UI, app-level session UX, and conversation history UX. It does not replace the public entry Worker or `apps/supervisor-api`.

## Canonical Docs

- [`docs/architecture/public-consumer-chat-surface.md`](../../docs/architecture/public-consumer-chat-surface.md)
- [`docs/architecture/public-consumer-chat-auth-and-data-boundary.md`](../../docs/architecture/public-consumer-chat-auth-and-data-boundary.md)
- [`docs/decisions/adr-0008-public-consumer-auth-and-storage.md`](../../docs/decisions/adr-0008-public-consumer-auth-and-storage.md)
- [`docs/decisions/adr-0009-public-consumer-frontend-host.md`](../../docs/decisions/adr-0009-public-consumer-frontend-host.md)

## Phase-Local Handoffs

- [`04.7-CONSUMER-APP-BOUNDARY-HANDOFF.md`](../../.planning/phases/04.7-public-consumer-chat-app-design/04.7-CONSUMER-APP-BOUNDARY-HANDOFF.md)
- [`04.7-IMPLEMENTATION-HANDOFF.md`](../../.planning/phases/04.7-public-consumer-chat-app-design/04.7-IMPLEMENTATION-HANDOFF.md)

Architectural guardrails:

- Worker admission is not canonical app identity truth
- app auth / conversation CRUD stay inside `apps/public-consumer-chat`
- `apps/supervisor-api` stays the runtime ingress only
- `Qdrant` remains the online retrieval store
- no bare `TanStack Router + 外挂后端壳`
- no `D1 for auth`

Local commands:

```bash
pnpm test
pnpm typecheck
pnpm install
pnpm dev
pnpm build
pnpm start
pnpm db:print-auth-migration
pnpm db:bootstrap
pnpm test:integration
pnpm smoke:live
```

## Local topology

- browser -> `TanStack Start` app host
- app-local route/UI/auth/conversation boundary -> `apps/public-consumer-chat`
- same-site answer seam -> public entry Worker -> `apps/supervisor-api`
- app-level relational truth -> `Supabase Postgres`
- online retrieval truth -> `Qdrant`

## Environment

`pnpm dev` / `pnpm start` use these variables:

- `PUBLIC_CHAT_MODE=mock|live`
- `PUBLIC_CONSUMER_CHAT_APP_BASE_URL=http://127.0.0.1:3000`
- `PUBLIC_CONSUMER_CHAT_DATABASE_URL=postgresql://postgres.<project-ref>:<url-encoded-password>@<session-pooler-host>:5432/postgres?sslmode=require`
- `PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE=require`
- `PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA=auth`
- `PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA=chat`
- `PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA=ingestion_registry`
- `PUBLIC_CHAT_TEST_DATABASE_URL=postgres://...` for real Postgres integration tests
- `SUPERVISOR_API_BASE_URL=http://127.0.0.1:8000`
- `SUPERVISOR_API_BEARER_TOKEN=local-dev-token`
- `PUBLIC_CONSUMER_CHAT_SCOPE_CORPUS=<query-enabled corpus>`
- `PUBLIC_CONSUMER_CHAT_SCOPE_COLLECTION=<query-enabled collection>`
- `BETTER_AUTH_SECRET=<generate-with-openssl-rand-base64-32>`

`SUPERVISOR_API_BEARER_TOKEN` must match the repo root `API_BEARER_TOKEN` used by `apps/supervisor-api`.

Production / shared-dev auth secret rule:

- `BETTER_AUTH_SECRET` must be high-entropy and at least 32 characters outside localhost-style development
- generate it with `openssl rand -base64 32`
- do not use a checked-in or low-entropy fallback secret

Recommended local defaults:

```bash
PUBLIC_CHAT_MODE=mock
PUBLIC_CONSUMER_CHAT_APP_BASE_URL=http://127.0.0.1:3000
PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE=require
PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA=auth
PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA=chat
PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA=ingestion_registry
BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
```

To exercise the real answer seam locally:

```bash
PUBLIC_CHAT_MODE=live
PUBLIC_CONSUMER_CHAT_APP_BASE_URL=http://127.0.0.1:3000
PUBLIC_CONSUMER_CHAT_DATABASE_URL=postgresql://postgres.<project-ref>:<url-encoded-password>@<session-pooler-host>:5432/postgres?sslmode=require
PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE=require
PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA=auth
PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA=chat
PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA=ingestion_registry
SUPERVISOR_API_BASE_URL=http://127.0.0.1:8000
SUPERVISOR_API_BEARER_TOKEN=local-dev-token
PUBLIC_CONSUMER_CHAT_SCOPE_CORPUS=curriculum
PUBLIC_CONSUMER_CHAT_SCOPE_COLLECTION=curriculum_plan
BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
```

Keep the app and supervisor tokens aligned:

```bash
API_BEARER_TOKEN=local-dev-token
SUPERVISOR_API_BEARER_TOKEN=local-dev-token
```

## Recommended Live Dev Workflow

Use two terminals.

Terminal 1: start `apps/supervisor-api`

```bash
export CAMPUS_AGENT_HTTP_HOST=127.0.0.1
export CAMPUS_AGENT_HTTP_PORT=8000
export API_AUTH_MODE=bearer
export API_BEARER_TOKEN=local-dev-token
export API_DEFAULT_ACTOR_GROUPS=students
export API_DEFAULT_ACTOR_ROLES=student
export API_DEFAULT_CAMPUS_SCOPE=main

uv run --all-packages campus-supervisor-api-dev
```

Terminal 2: start the app host

```bash
cd apps/public-consumer-chat
export PUBLIC_CHAT_MODE=live
export PUBLIC_CONSUMER_CHAT_APP_BASE_URL=http://127.0.0.1:3000
export PUBLIC_CONSUMER_CHAT_DATABASE_URL=postgresql://postgres.<project-ref>:<url-encoded-password>@<session-pooler-host>:5432/postgres?sslmode=require
export PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE=require
export PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA=auth
export PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA=chat
export PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA=ingestion_registry
export SUPERVISOR_API_BASE_URL=http://127.0.0.1:8000
export SUPERVISOR_API_BEARER_TOKEN=local-dev-token
export PUBLIC_CONSUMER_CHAT_SCOPE_CORPUS=curriculum
export PUBLIC_CONSUMER_CHAT_SCOPE_COLLECTION=curriculum_plan
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"

pnpm dev
```

`SUPERVISOR_API_BEARER_TOKEN` must match `API_BEARER_TOKEN`; otherwise the live answer path fails before retrieval.

The checked-in `pnpm dev` script binds the host to `http://127.0.0.1:3000`, which keeps the Better Auth origin stable during local smoke and manual testing.

If `3000` is already occupied and Vite auto-increments to another port, `PUBLIC_CONSUMER_CHAT_APP_BASE_URL` must be updated to that exact origin before login or sign-up. Otherwise Better Auth rejects the request as `Invalid origin`.

`pnpm start` is the production-style host entry once `pnpm build` has completed.

## Database Bootstrap

The accepted direction is no longer “runtime auto-create and hope.” Use explicit bootstrap commands against a reachable Postgres database:

```bash
cd apps/public-consumer-chat
export PUBLIC_CONSUMER_CHAT_APP_BASE_URL=http://127.0.0.1:3000
export PUBLIC_CONSUMER_CHAT_DATABASE_URL=postgresql://postgres.<project-ref>:<url-encoded-password>@<session-pooler-host>:5432/postgres?sslmode=require
export PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE=require
export PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA=auth
export PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA=chat
export PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA=ingestion_registry
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"

pnpm db:print-auth-migration
pnpm db:bootstrap
```

`pnpm db:bootstrap` does three things:

1. creates the `auth`, `chat`, and `ingestion_registry` schemas if missing
2. runs Better Auth migrations with `search_path=auth,public`
3. applies checked-in chat SQL migrations from `db/migrations/*.sql`

## Better Auth Posture

The app now treats Better Auth as a first-class app boundary rather than a thin endpoint passthrough.

- login / sign-up UI calls the Better Auth React client, not handwritten `fetch("/api/auth/*")` protocol glue
- authenticated access to `/login` redirects back to `/chat`
- server-side session lookup is centralized before app ownership checks
- session policy is explicit: database-backed session, 7 day expiry, 1 day refresh window
- password policy is explicit: minimum 10 chars, maximum 128 chars
- production rate limiting is enabled for the auth boundary

Still deferred until external mail infrastructure exists:

- email verification delivery
- password reset email delivery
- account recovery mail UX

## Postgres Integration Test

When you have a disposable Postgres database or isolated schema for verification:

```bash
cd apps/public-consumer-chat
export PUBLIC_CHAT_TEST_DATABASE_URL=postgresql://postgres.<project-ref>:<url-encoded-password>@<session-pooler-host>:5432/postgres?sslmode=require
export PUBLIC_CONSUMER_CHAT_APP_BASE_URL=http://127.0.0.1:3000
export PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE=require
export PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA=auth
export PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA=chat
export PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA=ingestion_registry
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"

pnpm db:bootstrap
pnpm test:integration
```

`test:integration` is reserved for real Postgres-backed auth/session/ownership checks. It should not be pointed at SQLite, D1, or a fake compatibility layer.

When using Supabase, prefer the session pooler endpoint and keep `?sslmode=require` on the connection string.

## Availability Gate

Before the retrieval chain is fully live, treat the first acceptance gate as app availability rather than RAG correctness.

The availability gate is complete when these commands pass:

```bash
cd apps/public-consumer-chat
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
```

What this proves:

- the TanStack Start host can build and boot
- Better Auth session creation works against Supabase Postgres
- app-local conversation CRUD and ownership checks stay inside `apps/public-consumer-chat`
- deleting a conversation removes its messages
- live upstream outages still map into a stable app-level `error` state

What this does not prove:

- supervisor retrieval is healthy
- Qdrant recall is healthy
- grounded answer quality is acceptable

## API Smoke

The repo-local smoke command exercises:

1. Better Auth email sign-up or sign-in route
2. `POST /api/conversations`
3. `POST /api/answer`

Run it from the repo root:

```bash
cd apps/public-consumer-chat
PUBLIC_CONSUMER_CHAT_APP_BASE_URL=http://127.0.0.1:3000 pnpm smoke:live
```

Optional overrides:

```bash
PUBLIC_CHAT_SMOKE_EMAIL=smoke-student@example.com
PUBLIC_CHAT_SMOKE_PASSWORD=password123
PUBLIC_CHAT_SMOKE_PROMPT='图书馆开放到几点？'
PUBLIC_CHAT_SMOKE_LOGIN_MODE=sign-up
```

The smoke output prints:

- `login_ok`
- `conversation_id`
- `answer_kind`
- `message`
- `correlation_id`

## Historical 04.7 Execution Records

PR #4 has already merged the 04.7 app implementation and baseline docs into `main`. These files are retained as historical execution artifacts, not as the current migration entrypoint:

- [`04.7-CHATBOT-COMPONENT-MIGRATION-PLAN.md`](../../.planning/phases/04.7-public-consumer-chat-app-design/04.7-CHATBOT-COMPONENT-MIGRATION-PLAN.md)
- [`04.7-CHATBOT-COMPONENT-MIGRATION-CHECKLIST.md`](../../.planning/phases/04.7-public-consumer-chat-app-design/04.7-CHATBOT-COMPONENT-MIGRATION-CHECKLIST.md)

`correlation_id` is taken from `request_id` or `trace_id` mapping, so you can correlate app-local output with supervisor-side traces.

Only use `pnpm smoke:live` as a live availability or live RAG check when `apps/supervisor-api` is running. If retrieval is not ready yet, keep this as an outage/degradation verification rather than a grounded-answer acceptance test.

## Browser Smoke

With both local servers running and `PUBLIC_CONSUMER_CHAT_DATABASE_URL` pointing at a reachable Supabase Postgres:

1. Open `http://127.0.0.1:3000`.
2. Sign up or sign in on `/login`.
3. Start a new chat.
4. Send a handbook question such as `图书馆开放到几点？`.
5. Confirm the UI renders one of the live result states:
   - grounded answer
   - clarification
   - no-answer style error
   - runtime error
6. If the UI shows a failure state, check the surfaced `request_id` in the thread/error card.

## Known Failure Modes

- Missing `PUBLIC_CONSUMER_CHAT_DATABASE_URL`
  The app cannot create Better Auth or conversation persistence without a reachable Supabase Postgres connection string.
- Missing database schemas or tables
  This scaffold now assumes Postgres-backed `auth` and `chat` schema ownership. If your database is empty, login and conversation endpoints will fail until migrations/bootstrap are applied.
- `401 unauthorized`
  Usually means `SUPERVISOR_API_BEARER_TOKEN` is missing in `apps/public-consumer-chat` or does not match `API_BEARER_TOKEN` in `apps/supervisor-api`.
- `400 invalid_request` for missing `requested_scope`
  `public-consumer-chat` now requires `PUBLIC_CONSUMER_CHAT_SCOPE_CORPUS` and `PUBLIC_CONSUMER_CHAT_SCOPE_COLLECTION` in live mode. If you hit this, the live scope env is missing or the live code path was bypassed.
- `error` / `no_answer`
  These can be real supervisor semantics from the live chain, not necessarily a frontend fault. Check the returned message and `correlation_id` before assuming the app-local server is broken.
- Transport failure with `The public answer path is unavailable right now.`
  Usually means `apps/supervisor-api` is not running or `SUPERVISOR_API_BASE_URL` is wrong.

## External Conditions

This worktree now points at the accepted long-term direction. A fully working end-to-end launch still requires:

- reachable `Supabase Postgres`
- created `auth` and `chat` schemas
- installed TanStack Start dependencies via `pnpm install`
- reachable `apps/supervisor-api` if `PUBLIC_CHAT_MODE=live`
- existing retrieval/index runtime behind the Worker path; `Qdrant` remains the online retrieval store
