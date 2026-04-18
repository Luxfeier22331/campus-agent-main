---
workstream: shared-product-surfaces-acceptance-hardening
created: 2026-04-19
updated: 2026-04-19
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** F
**Current Phase Name:** Public Auth Shell Productization
**Current Plan:** `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-f-public-auth-shell-productization/PLAN.md`
**Total Phases:** 9
**Total Plans in Phase:** N/A
**Progress:** 5/9 phases complete
**Last Activity:** 2026-04-19
**Last Activity Description:** Executed the first `Phase F` auth-shell slice: added campus-specific donor-shell copy, froze the `/login` recovery CTA placement, and captured fresh local auth browser evidence.

## Current Slice

- latest closeout summary for completed `Phase A-E`：`.planning/quick/260419-sps-phase-d-e-closeout/260419-sps-SUMMARY.md`
- current reopen slice starts at `Phase F`:
  - freeze `/login` `/register` as formal public auth surface
  - then land forgot/reset password through shared `app-api + public-chat-web` auth seam
  - `protected-panel-web` login remains Cloudflare Access reentry and is not part of the password product
- local public chat browser smoke artifact：
  - `.tmp/local-smoke/20260419T022048+0800-sps-phase-d-public-chat/SUMMARY.md`
- local public auth shell artifact：
  - `.tmp/local-smoke/20260419T061332+0800-sps-phase-f-auth-shell/SUMMARY.md`
- staging panel query recovery artifact：
  - `.tmp/staging-smoke/20260419T033550+0800-sps-phase-d-panel-query-recovery/SUMMARY.md`
- staging readyz / deploy recovery artifact：
  - `.tmp/staging-smoke/20260419T035932+0800-sps-phase-e-readyz-recovery/SUMMARY.md`
- staging fixed-domain cutover artifact：
  - `.tmp/staging-smoke/20260419T041000+0800-sps-phase-e-fixed-domain-cutover/SUMMARY.md`
- staging scheduled-task hardening artifact：
  - `.tmp/staging-smoke/20260419T042434+0800-sps-phase-e-scheduled-task-hardening/SUMMARY.md`
- integrated acceptance continuity anchor remains:
  - `conversationId=9cb68dd1-9a74-4ed5-a616-308c41761a4c`
  - `requestId=req_4be3b117d87a40fc807d5644d06133d0`
- current staging `app-api` deploy version:
  - `2a70e797-082a-43b6-b13b-03f77a335298`
- current fixed-domain supervisor upstream injected into staging:
  - `https://exec-staging.ayafeed.com`
- current local persistence mechanism for the named tunnel:
  - Windows scheduled task `CampusAgent-DevBackedSupervisorStaging`
  - repo-native lifecycle lock `.tmp/dev-backed-supervisor-staging/lifecycle.lock`
  - canonical strict health gate `infra/local/staging/status-dev-backed-supervisor-staging.sh --check`

## Blockers

- 当前没有 repo-level blocker
- `Phase G` 之前仍缺 canonical auth mail provider / secret inventory truth；这是执行依赖，不是 `Phase F` blocker
- residual operator note only:
  - staging `app-api` 目前依赖 named tunnel `supervisor-api-staging` 的 active connector
  - 这已经是固定域名姿势，且当前主机已装配 scheduled task 自愈补拉；若 host 整体离线，`campus-api-staging /readyz` 仍会回退到 upstream not-ready

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
- `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy cloudflared tunnel --config /dev/null --no-autoupdate --edge-ip-version 4 --metrics 127.0.0.1:20244 --loglevel debug --logfile /home/reptilian/code/campus-agent/.tmp/cloudflared-20244.log --url http://127.0.0.1:8081` 已 fresh 通过：
  - live upstream `https://seen-hugh-partners-plasma.trycloudflare.com`
- `curl --noproxy '*' -sS -i https://seen-hugh-partners-plasma.trycloudflare.com/healthz` 已 fresh 通过
- `curl --noproxy '*' -sS -i https://seen-hugh-partners-plasma.trycloudflare.com/readyz` 已 fresh 通过
- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/auth-and-db.test.ts` 已 fresh 通过
- `pnpm --dir apps/app-api exec vitest run -c vitest.worker.config.mts test/worker.test.ts` 已 fresh 通过
- `bash -lc 'set -a; source ./.env; set +a; export STAGING_SUPERVISOR_API_BASE_URL="https://seen-hugh-partners-plasma.trycloudflare.com"; export STAGING_APP_API_OPERATOR_DATABASE_URL="${STAGING_APP_API_OPERATOR_DATABASE_URL:-$STAGING_APP_API_MANAGEMENT_DATABASE_URL}"; pnpm --dir apps/app-api deploy:staging'` 已 fresh 通过：
  - deployed version `dddc9945-183b-4402-936f-18eb1ec15ab2`
- `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy cloudflared tunnel --config /home/reptilian/.cloudflared/config.yml --no-autoupdate --edge-ip-version 4 --metrics 127.0.0.1:20245 --loglevel debug --logfile /home/reptilian/code/campus-agent/.tmp/cloudflared-named-20245.log run supervisor-api-staging` 已 fresh 通过：
  - named connector started for `exec-staging.ayafeed.com`
- `curl --noproxy '*' -sS -i https://exec-staging.ayafeed.com/healthz` 已 fresh 通过
- `curl --noproxy '*' -sS -i https://exec-staging.ayafeed.com/readyz` 已 fresh 通过
- `cloudflared tunnel info 7d0db8a7-53bd-417d-8028-548c35c8e30e` 已 fresh 通过：
  - active connector present for `supervisor-api-staging`
- `bash -lc 'set -a; source ./.env; set +a; export STAGING_APP_API_OPERATOR_DATABASE_URL="${STAGING_APP_API_OPERATOR_DATABASE_URL:-$STAGING_APP_API_MANAGEMENT_DATABASE_URL}"; pnpm --dir apps/app-api deploy:staging'` 已 fresh 通过：
  - deployed version `2a70e797-082a-43b6-b13b-03f77a335298`
- `infra/local/staging/install-dev-backed-supervisor-staging-task.sh` 已 fresh 通过：
  - installed scheduled task `CampusAgent-DevBackedSupervisorStaging`
- `bash -lc './infra/local/staging/start-dev-backed-supervisor-staging.sh >/tmp/start1.out 2>/tmp/start1.err & ./infra/local/staging/start-dev-backed-supervisor-staging.sh >/tmp/start2.out 2>/tmp/start2.err & wait'` 已 fresh 通过：
  - overlapping start attempts no longer emit `OSError: [Errno 98] Address already in use`
- `infra/local/staging/stop-dev-backed-supervisor-staging.sh` + `Start-ScheduledTask -TaskName 'CampusAgent-DevBackedSupervisorStaging'` 已 fresh 通过：
  - stack relaunched from scheduled task instead of the interactive shell
- `infra/local/staging/status-dev-backed-supervisor-staging.sh` 已 fresh 通过：
  - `supervisor-api: running`
  - `cloudflared: running`
  - local `readyz = 200`
  - public `readyz = 200`
- `infra/local/staging/status-dev-backed-supervisor-staging.sh --check` 已 fresh 通过：
  - local/public/app-api readiness 全部收口为单个 exit code
- `uv run --all-packages python -m unittest tests.test_dev_backed_supervisor_staging` 已 fresh 通过：
  - `status --check` 在依赖失效时返回非零
  - `status --check` 在 local/public/app-api 都 ready 时返回零
  - log rotation 会在单文件超出 `20 MiB` 时 copy-truncate 并只保留最近 `5` 份
- `powershell.exe -NoProfile -Command "Get-ScheduledTaskInfo -TaskName 'CampusAgent-DevBackedSupervisorStaging' | Format-List LastRunTime,LastTaskResult,NextRunTime,NumberOfMissedRuns"` 已 fresh 通过：
  - `LastTaskResult = 0`
- `curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/readyz` 已 fresh 通过（scheduled-task cold start 后再次确认）：
  - `auth: ready`
  - `database: ready`
  - `supervisorApi: ready`
- `curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/healthz` 已 fresh 通过
- `curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/readyz` 已 fresh 通过：
  - `auth: ready`
  - `database: ready`
  - `supervisorApi: ready`
- `pnpm --dir apps/app-api test:node` 已 fresh 通过（2026-04-19 当前 worktree 复跑两次）：
  - `37` test files / `214` tests passed
  - 先前 closeout 中记录的 `5` 个 node-lane timeout 已不再复现，应视为过期状态
- `node scripts/run-wrangler-command.mjs --cwd apps/public-chat-web whoami --json` 已 fresh 通过；Cloudflare 登录态存在
- public/panel `secret list` 在 direct CLI probe 下可返回，说明 `5s` manual timeout probe 不再代表 canonical preflight truth
- `campus-panel-staging` via `mcp__chrome_devtools__` 已 fresh 证明 panel shell 与开放域读取仍正常：
  - `GET /api/overview` -> `200`
  - `GET /api/official-web/runs?limit=20` -> `200`
  - `GET /api/requests?limit=20&conversationId=9cb68dd1-9a74-4ed5-a616-308c41761a4c` -> `200`
  - `GET /api/official-web/sites` -> `200`
- `pnpm --dir apps/public-chat-web typecheck` 已 fresh 通过
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-regressions.test.ts test/public-chat-auth-actions.test.ts test/worker.test.ts` 已 fresh 通过：
  - `3` test files / `25` tests passed
- `pnpm --dir apps/public-chat-web test:worker` 当前在默认并发 worker pool 下复现 websocket `ECONNRESET`
- `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy pnpm --dir apps/public-chat-web exec vitest run --maxWorkers=1` 已 fresh 通过：
  - `23` test files / `92` tests passed
- `pnpm --dir apps/app-api db:bootstrap` 已 fresh 通过：
  - local shared product schemas and chat migrations reconciled before auth smoke
- local Playwright auth smoke 已 fresh 通过并落盘到 `.tmp/local-smoke/20260419T061332+0800-sps-phase-f-auth-shell/`：
  - desktop `/login` screenshot
  - mobile `/login` screenshot
  - desktop `/register` screenshot
  - mobile `/register` screenshot
  - `POST /api/auth/sign-up/email` -> `200`
  - UI sign-out -> `/login`
  - `POST /api/auth/sign-in/email` -> `200`
  - same-site `Referer` preserved for `/register`, `/chat`, `/login`
- 已确认当前 auth follow-up gap：
  - `Phase F` 的 planning truth 已冻结：`/login` `/register` 是正式 public auth surface，future `/forgot-password` `/reset-password` 必须挂在同一 auth family
  - `app-api` 当前只接了 Better Auth email/password sign-up / sign-in，没有 reset-password callback
  - `app_auth.verification` schema 已存在，可作为 reset token contract 基础
  - repo 当前没有 end-user auth mail provider 的 canonical inventory / runbook truth
  - `protected-panel-web` 明确不拥有 self-serve signup / password reset / profile management

## Session Continuity

**Stopped At:** `Phase A-E` closeout remains valid, and `Phase F` now has explicit context + plan; next session can execute against the frozen auth-shell contract instead of reopening surface ownership
**Resume File:** `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-f-public-auth-shell-productization/PLAN.md`
