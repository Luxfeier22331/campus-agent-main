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
pnpm test
pnpm typecheck
pnpm dev
```

Runtime env keys:

- `ORIGIN_BASE_URL`
- `ORIGIN_SHARED_SECRET`
- `ENTRY_MODE`
- `WORKER_ALLOW_ANONYMOUS`
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_POLICY_AUD`
