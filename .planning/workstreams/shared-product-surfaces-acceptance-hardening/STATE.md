---
workstream: shared-product-surfaces-acceptance-hardening
created: 2026-04-19
updated: 2026-04-19
---

# Project State

## Current Position

**Status:** In Progress
**Current Phase:** D
**Current Phase Name:** Integrated Acceptance
**Current Plan:** `.planning/quick/260419-sps-phase-d-e-closeout/260419-sps-PLAN.md`
**Total Phases:** 5
**Total Plans in Phase:** N/A
**Progress:** 3/5 phases complete
**Last Activity:** 2026-04-19
**Last Activity Description:** Recovered the staging shared-DB seam after Supabase-side cleanup, captured fresh panel query pass evidence, and tightened `app-api` staging preflight so dead supervisor upstreams now fail fast.

## Current Slice

- local Phase A-C baseline 已 fresh 通过
- current quick plan: `.planning/quick/260419-sps-phase-d-e-closeout/260419-sps-PLAN.md`
- current execution summary: `.planning/quick/260419-sps-phase-d-e-closeout/260419-sps-SUMMARY.md`
- public chat browser smoke 已 fresh 落盘：
  - `.tmp/local-smoke/20260419T022048+0800-sps-phase-d-public-chat/SUMMARY.md`
- protected panel browser evidence 已 fresh 落盘：
  - `.tmp/staging-smoke/20260419T031000+0800-sps-phase-d-panel-browser-evidence/SUMMARY.md`
- protected panel query recovery evidence 已 fresh 落盘：
  - `.tmp/staging-smoke/20260419T033550+0800-sps-phase-d-panel-query-recovery/SUMMARY.md`
- same request 已在 `app-api` operator projection 中可见：
  - `conversationId=9cb68dd1-9a74-4ed5-a616-308c41761a4c`
  - `requestId=req_4be3b117d87a40fc807d5644d06133d0`
- 下一步固定为收口 staging `app-api` query seam / shared DB gate，然后再判断 Phase D integrated acceptance 是否可 closeout
- 当前可视 Chrome DevTools 浏览器已打开 Supabase staging 项目页：
  - `https://supabase.com/dashboard/project/syocoxoferlnhururfxl/database/settings`
  - 当前会话已可读取 `Connect` / `Network bans`

## Blockers

- shared DB seam / panel query seam blocker 已关闭；当前 remaining blocker 变为 dev-backed supervisor upstream 不可达
- staging `app-api /readyz` 当前只剩 `supervisorApi` not-ready：`Supervisor readiness probe returned 530.`
- 当前 repo-tracked `STAGING_SUPERVISOR_API_BASE_URL=https://duplicate-remarkable-investor-joining.trycloudflare.com` live probe 返回 `404`
- `apps/app-api` staging preflight 已补 live upstream probe；当前会在 dead supervisor URL 上 fail fast，而不再误报 green

## Verification

- `apps/app-api` type/test/test:worker/test:shared-db-integration 已 fresh 通过
- `apps/public-chat-web` type/test/build 已 fresh 通过
- `apps/protected-panel-web` type/test/build 已 fresh 通过
- `pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"` 已 fresh 通过
- public chat Phase D local browser smoke 已 fresh 通过并落盘到 `.tmp/local-smoke/20260419T022048+0800-sps-phase-d-public-chat/SUMMARY.md`
- `campus-panel-staging` via `mcp__chrome_devtools__` 已 fresh 证明 Access admission 与 panel shell 正常：
  - `GET /api/overview` -> `200`
  - `GET /api/requests?limit=20` -> `200`
  - `GET /api/official-web/sites` -> `200`
  - `GET /api/official-web/runs?limit=20` -> `200`
- `pnpm --dir apps/public-chat-web deploy:preflight:staging` 已 fresh 通过
- `pnpm --dir apps/protected-panel-web deploy:preflight:staging` 已 fresh 通过
- Supabase dashboard 已 fresh 证明 staging session-pooler truth 未变化：
  - host `aws-1-ap-southeast-2.pooler.supabase.com`
  - port `5432`
  - database `postgres`
  - user `postgres.syocoxoferlnhururfxl`
  - `Network bans` 空
- `bash -lc 'set -a; source ./.env; set +a; pnpm --dir apps/app-api db:reconcile-shared-drift:staging -- --json'` 已 fresh 通过：
  - `driftDetected: false`
- `curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/healthz` 已 fresh 通过
- `curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/readyz` 已 fresh 返回 `503 dependency_not_ready`：
  - 仅 `supervisorApi` 失败，`database` / `auth` 已恢复
- `curl --noproxy '*' -sS -i https://duplicate-remarkable-investor-joining.trycloudflare.com/healthz` 已 fresh 返回 `404`
- `curl --noproxy '*' -sS -i https://duplicate-remarkable-investor-joining.trycloudflare.com/readyz` 已 fresh 返回 `404`
- `STAGING_SUPERVISOR_API_BASE_URL=https://duplicate-remarkable-investor-joining.trycloudflare.com STAGING_APP_API_OPERATOR_DATABASE_URL=<redacted> pnpm --dir apps/app-api deploy:preflight:staging` 已 fresh fail fast：
  - `STAGING_SUPERVISOR_API_BASE_URL health probe (...) returned HTTP 404.`
- `pnpm --dir apps/app-api exec vitest run -c vitest.worker.config.mts test/worker.test.ts` 已 fresh 通过
- `pnpm --dir apps/app-api test:node` 当前不是 clean gate：
  - repo baseline 仍有 5 个 unrelated timeout failures
- `node scripts/run-wrangler-command.mjs --cwd apps/public-chat-web whoami --json` 已 fresh 通过；Cloudflare 登录态存在
- public/panel `secret list` 在 direct CLI probe 下可返回，说明 `5s` manual timeout probe 不再代表 canonical preflight truth

## Session Continuity

**Stopped At:** staging shared DB/query seam is healthy again and panel query evidence is closed. Remaining work is to provide a live supervisor upstream for staging and then rerun app-api/public-chat integrated acceptance against that current upstream.
**Resume File:** `.planning/quick/260419-sps-phase-d-e-closeout/260419-sps-SUMMARY.md`
