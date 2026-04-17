# 1002-02 Summary: canonical staging preflight 与 secret/config gate 已收口

## Outcome

`1002-02` 已完成。三端 Worker staging 发布前现在都有统一的 canonical preflight 入口，shell env、Cloudflare secret、repo-owned config truth、shared DB drift 与 admission prerequisites 会在 publish 前显式 fail-close。

## Key Changes

- `scripts/run-worker-staging-preflight.mjs`
  - 固定每个 Worker 的 staging preflight 编排顺序
- `scripts/check_worker_secret_presence.py`
  - 把 Cloudflare secret presence 固定成 repo-owned gate
- `apps/app-api/scripts/verify-staging-config.mjs`
  - `app-api` 拥有独立的 staging config verification
- `apps/app-api/package.json`
- `apps/public-chat-web/package.json`
- `apps/protected-panel-web/package.json`
  - 三端统一暴露 `deploy:preflight:staging`
- `docs/runbooks/staging-worker-deploy-runbook.md`
- `docs/environment/README.md`
  - deploy 前 gate 的责任边界、执行顺序与环境输入已写成长期 truth

## Verification

```bash
uv run --all-packages python -m scripts.check_worker_secret_presence --env staging --json
```

Result:

- `overall_ready = true`
- `apps/app-api`: `missing_secrets = []`
- `apps/public-chat-web`: `missing_secrets = []`
- `apps/protected-panel-web`: `missing_secrets = []`

并结合：

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose test/worker.test.ts
pnpm --dir apps/public-chat-web exec vitest run test/worker.test.ts --reporter=verbose
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose test/worker.test.ts
```

确认三端 worker shell 仍与新的 preflight / deploy script contract 对齐。

## Remaining Gap

- built config verification 与真实 publish 前 smoke 仍需要在真实 staging release 窗口执行
- 这不是 repo-level 设计缺口，而是环境执行窗口待触发

## Next

- 进入 `1002-03`，把 release-scoped post-deploy evidence contract 固定下来
