---
phase: "I"
name: "Auth Hardening And Smoke"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase I Summary

## What Closed

- 在 `apps/app-api` 与 `apps/public-chat-web` 之间收口了 Turnstile-backed auth hardening：
  - sign-up
  - sign-in
  - request-password-reset
- same-site auth proxy 已固定 `x-captcha-response` transport seam，并继续把 `Origin` / `Referer` 留在 `/api/auth/*` 范围内。
- staging config 现在对 Turnstile sitekey fail-close：
  - 缺 key 不允许 deploy
  - Cloudflare testing key 不允许进入 staging
- local smoke 已证明 Turnstile testing credentials 下的 captcha transport 正常。
- staging smoke 已证明真实域名、真实 Turnstile、真实 Resend、real reset callback 与 post-reset sign-in continuity 全部闭环。
- dedicated staging Turnstile widget 已切到 `non-interactive` mode：
  - 仍保持 `campus-chat-staging.ayafeed.com` domain-bound validation
  - 不再把 operator smoke 阻塞在手工 challenge 上
- old session revocation 也已被 staging continuity smoke 直接证明：
  - reset 完成后，同一浏览器上下文里的旧 session 对 `/api/me` 返回 `401`

## Fresh Evidence

- `.tmp/local-smoke/20260419T082600+0800-sps-phase-i-turnstile-local/SUMMARY.md`
- `.tmp/staging-smoke/20260419T105000+0800-sps-phase-i-auth-continuity/SUMMARY.md`
- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/auth-and-db.test.ts`
- `pnpm --dir apps/app-api exec vitest run -c vitest.worker.config.mts test/worker.test.ts`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api test:node`
- `pnpm --dir apps/app-api test:shared-db-integration`
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-actions.test.ts test/public-chat-auth-regressions.test.ts test/worker.test.ts`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web build`
- `pnpm --dir apps/public-chat-web deploy:verify-config:staging`
- `uv run --all-packages python -m unittest tests.test_check_worker_secret_presence`
- `uv run --all-packages python -m scripts.check_worker_secret_presence --app apps/app-api --env staging --json`
- `uv run --all-packages python -m scripts.check_worker_secret_presence --app apps/public-chat-web --env staging --json`
- `curl --noproxy '*' -sS https://campus-api-staging.ayafeed.com/readyz`
- `curl --noproxy '*' -sS https://campus-api-staging.ayafeed.com/healthz`
- `curl --noproxy '*' -sS https://campus-chat-staging.ayafeed.com/readyz`
- `curl --noproxy '*' -sS https://campus-chat-staging.ayafeed.com/healthz`

## Handoff

- `shared-product-surfaces-acceptance-hardening` 到 `Phase I` 为止已完整关闭，没有下一阶段。
- 未来只有在 public auth family contract、staging auth runtime posture、或 abuse-control scope 被重新打开时才需要 reopen 这条 workstream。
