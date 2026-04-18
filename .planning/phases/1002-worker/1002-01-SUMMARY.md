# 1002-01 Summary: 三端 deploy-time release identity 已统一

## Outcome

`1002-01` 已完成。`app-api`、`public-chat-web`、`protected-panel-web` 三端 staging release identity 现在统一在 deploy-time 生成并注入，不再把历史 `SENTRY_RELEASE` 静态写死在 repo-owned staging config 里。

## Key Changes

- `scripts/staging-release.mjs`
  - 固定三端共享的 staging release 生成规则：`<app>@staging-<sha>`
- `apps/app-api/scripts/deploy-staging.mjs`
- `apps/public-chat-web/scripts/deploy-staging.mjs`
- `apps/protected-panel-web/scripts/deploy-staging.mjs`
  - 三端 deploy 脚本统一改为 publish 时注入 `SENTRY_RELEASE`
- `apps/app-api/wrangler.toml`
- `apps/public-chat-web/wrangler.toml`
- `apps/protected-panel-web/wrangler.toml`
  - staging config 不再保留静态 `SENTRY_RELEASE`
- `apps/app-api/test/worker.test.ts`
- `apps/public-chat-web/test/worker.test.ts`
- `apps/protected-panel-web/test/worker.test.ts`
  - worker lane 固化“staging config 不得重新长出静态 `SENTRY_RELEASE`”

## Verification

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose test/worker.test.ts
pnpm --dir apps/public-chat-web exec vitest run test/worker.test.ts --reporter=verbose
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose test/worker.test.ts
```

Result:

- `apps/app-api`: `Test Files 1 passed`, `Tests 9 passed`
- `apps/public-chat-web`: `Test Files 1 passed`, `Tests 16 passed`
- `apps/protected-panel-web`: `Test Files 1 passed`, `Tests 22 passed`

## Remaining Gap

- 这一步只关闭 repo-level release identity debt
- 真正的 post-deploy smoke artifact 与 release-scoped evidence 继续由 `1002-03` 收口

## Next

- 继续执行 canonical staging preflight 与 release-scoped evidence contract
