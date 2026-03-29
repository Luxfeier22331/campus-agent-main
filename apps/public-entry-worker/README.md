# public-entry-worker

Cloudflare Worker runtime shell for the public consumer answer entry.

This app is an `apps/*` runtime boundary in front of `apps/supervisor-api`. It does not own supervisor orchestration, specialist logic, or any `packages/*` capability semantics.

Frozen public path:

- `client -> public hostname -> Cloudflare Route -> public-entry-worker -> trusted origin/apps/supervisor-api`

Frozen entry modes:

- `authenticated-only`
- `anonymous-enabled`

Implementation rules carried from Phase 04.5 and 04.6:

- `workers_dev = false`
- `preview_urls = false`
- Worker remains the only public answer entry code path
- Worker-to-origin trust is projected with runtime auth material, not app-layer actor semantics

Local commands:

```bash
pnpm install
pnpm --filter public-entry-worker test
pnpm --filter public-entry-worker typecheck
pnpm --filter public-entry-worker dev
```

The repo now uses a shared root `pnpm-workspace.yaml` and `turbo.json` for JS/TS apps. Install dependencies from the repo root; app-local commands remain valid if you run them from this directory with `pnpm test`, `pnpm typecheck`, or `pnpm dev`.

## Local Env

- Local Worker bindings should live in `apps/public-entry-worker/.dev.vars`
- Start from `apps/public-entry-worker/.dev.vars.example`
- Do not put Worker-local bindings back into the repo root `.env`
- `ORIGIN_SHARED_SECRET` must match repo root `API_WORKER_SHARED_SECRET`

Runtime env keys:

- `ORIGIN_BASE_URL`
- `ORIGIN_SHARED_SECRET`
- `ENTRY_MODE`
- `WORKER_ALLOW_ANONYMOUS`
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_POLICY_AUD`

When `ENTRY_MODE=authenticated-only`, both `ACCESS_TEAM_DOMAIN` and `ACCESS_POLICY_AUD` are required.
When `ENTRY_MODE=anonymous-enabled`, `WORKER_ALLOW_ANONYMOUS=true` is required.
