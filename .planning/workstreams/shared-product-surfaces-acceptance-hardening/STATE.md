---
workstream: shared-product-surfaces-acceptance-hardening
created: 2026-04-19
updated: 2026-04-21
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** None
**Current Phase Name:** None
**Current Plan:** `<none>`
**Total Phases:** 13
**Total Plans in Phase:** 0
**Progress:** 13/13 phases complete
**Last Activity:** 2026-04-21
**Last Activity Description:** Completed `Phase M` curriculum semester answer boundary repair after local smoke exposed a second public answer contract breach: `program_semester_facts` multi-chunk retrieval was leaking chunk-boundary fragments such as broken course names into browser-facing curriculum answers. `rag-specialist` now assembles semester course lists deterministically from structured candidates, the regression is covered in Python tests, and a fresh local browser smoke closed with request `req_e96b9a09ed374ec28ee6231000c5e0f8`.

## Current Slice

- latest closeout summary for completed `Phase A-E`：
  - `.planning/quick/260419-sps-phase-d-e-closeout/260419-sps-SUMMARY.md`
- completed `Phase F` summary：
  - `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-f-public-auth-shell-productization/SUMMARY.md`
- completed `Phase G` summary：
  - `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-g-password-reset-backend-and-mail-contract/SUMMARY.md`
- completed `Phase H` summary：
  - `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-h-public-recovery-ux/SUMMARY.md`
- completed `Phase I` artifacts：
  - plan: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-i-auth-hardening-and-smoke/PLAN.md`
  - summary: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-i-auth-hardening-and-smoke/SUMMARY.md`
  - local smoke: `.tmp/local-smoke/20260419T082600+0800-sps-phase-i-turnstile-local/SUMMARY.md`
  - staging smoke: `.tmp/staging-smoke/20260419T105000+0800-sps-phase-i-auth-continuity/SUMMARY.md`
- completed `Phase K` local auth-shell cutover artifacts：
  - context: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-k-public-auth-shell-mature-layout-cutover/CONTEXT.md`
  - plan: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-k-public-auth-shell-mature-layout-cutover/PLAN.md`
  - summary: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-k-public-auth-shell-mature-layout-cutover/SUMMARY.md`
  - local smoke: `.tmp/local-smoke/20260420T003016+0800-sps-phase-k-auth-shell/SUMMARY.md`
- completed `Phase L` public-answer citation hygiene artifacts：
  - context: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-l-public-answer-citation-hygiene-repair/CONTEXT.md`
  - plan: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-l-public-answer-citation-hygiene-repair/PLAN.md`
  - summary: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-l-public-answer-citation-hygiene-repair/SUMMARY.md`
- completed `Phase M` curriculum semester answer boundary repair artifacts：
  - context: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-m-curriculum-semester-answer-boundary-repair/CONTEXT.md`
  - plan: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-m-curriculum-semester-answer-boundary-repair/PLAN.md`
  - summary: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-m-curriculum-semester-answer-boundary-repair/SUMMARY.md`
- completed `Phase J` live-browser closeout artifacts：
  - context: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-j-adaptive-turnstile-posture-productization/CONTEXT.md`
  - plan: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-j-adaptive-turnstile-posture-productization/PLAN.md`
  - summary: `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-j-adaptive-turnstile-posture-productization/SUMMARY.md`
  - staging smoke: `.tmp/staging-smoke/20260421T023205+0800-sps-phase-j-live-browser/SUMMARY.md`
- workstream closed truth：
  - `public-chat-web` 正式拥有 `/login` `/register` `/forgot-password` `/reset-password` 这组 public auth family
  - `app-api` 正式拥有 Better Auth email/password、password reset、old-session revocation 与 Turnstile-backed captcha enforcement
  - same-site auth proxy 已固定只在 `/api/auth/*` 路径转发 `Origin` / `Referer` / `x-captcha-response`
  - `protected-panel-web` 继续明确排除 self-serve signup / password reset / profile management
- closed `Phase J` truth：
  - public auth family 的前向 posture 固定为 always-on Turnstile verification
  - interactive challenge escalation 固定为 Cloudflare-managed adaptive posture，而不是 repo-owned 手动 attack-mode 开关
  - repo runtime posture 继续固定为 `interaction-only/render`
  - staging deploy shell 仍只允许通过可选 `STAGING_AUTH_TURNSTILE_APPEARANCE` / `STAGING_AUTH_TURNSTILE_EXECUTION` 临时 override，而不把这些值写回 repo-fixed staging vars
  - Playwright live-widget smoke 继续只保留为诊断证据；真实 closeout 已由用户本机可见 Chrome 中的 live widget 成功路径替代
  - 真实 staging 浏览器 closeout 已证明：
    - `/forgot-password` 在 real admitted widget 下返回 neutral success copy
    - staging DB 同步落下 password-reset verification row
    - canonical reset link 可回到 `/reset-password`
    - reset 完成后 `/login` 可用新密码重新登录并回到 `/chat`
    - 匿名态 `/login` `/register` 都在 live admitted widget 下正常渲染，且低风险路径没有被默认固定成可见 challenge
  - Cloudflare Dashboard widget-mode UI 本轮未补截图，因为 `dash.cloudflare.com` 需要新的交互登录；这不再阻塞 workstream closeout，因为 provider-side mode 继续是 Cloudflare-owned truth，而 runtime posture 与 real-browser continuity 已完成验收
- closed `Phase L` truth：
  - browser-facing assistant prose 不再携带 raw `doc_id#chunk_id` / `source-faithful` / `chunk-*` locator
  - deterministic `rag-specialist` answer 继续只负责用户可读 prose，supporting source trace 保留在 structured evidence
  - `app-api` finalize path 对 public answer contract 增加 hygiene guard；即使未来 upstream 再返回 raw locator，browser-facing `assistantText` 也不会原样泄漏
  - operator-safe source trace、request observability 与 panel-side source projection contract 不受影响
- closed `Phase M` truth：
  - `program_semester_facts` 命中多个 partial chunk 时，browser-facing curriculum answer 不再把 chunk 边界残片拼成损坏课程名
  - canonical `program_semester_facts` projection truth 与 MinIO 文档对象不需要被改写；问题边界明确收口在 `rag-specialist` 的 deterministic semester answer composition
  - `rag-specialist` 现按学期课程候选项去重、折叠并输出稳定课程列表，而不是直接复用 generic snippet 拼接
  - fresh local chat continuity 已验证：
    - `conversationId=ee0e20ac-7e56-4705-8a5a-ed919911c0c4`
    - `requestId=req_e96b9a09ed374ec28ee6231000c5e0f8`
    - 浏览器答案不再出现 `中国民族史概要(一；`、`；展经济学` 等断裂片段
  - local smoke 中出现的 `Invalid bearer token` 仅是 operator 启动 supervisor 时误用了 bearer 模式；repo 既有 contract 仍要求本地 `app-api -> supervisor-api` 走 `trusted-worker + API_WORKER_SHARED_SECRET`
- integrated acceptance continuity anchor remains:
  - `conversationId=9cb68dd1-9a74-4ed5-a616-308c41761a4c`
  - `requestId=req_4be3b117d87a40fc807d5644d06133d0`
- staging runtime truth at closeout：
  - `https://campus-api-staging.ayafeed.com/readyz` -> ready
  - `https://campus-api-staging.ayafeed.com/healthz` -> ok
  - `https://campus-chat-staging.ayafeed.com/readyz` -> ready
  - `https://campus-chat-staging.ayafeed.com/healthz` -> ok
  - fixed-domain supervisor upstream remains `https://exec-staging.ayafeed.com`
  - named-tunnel persistence remains the Windows scheduled task `CampusAgent-DevBackedSupervisorStaging`

## Blockers

- 无 active blocker。workstream 已完成。
- 如未来 operator 希望补 Cloudflare Dashboard widget-mode 截图，只能算平台侧附加证据，不再阻塞当前 closeout。
- 如 future smoke 再次发现 browser answer 泄漏 raw specialist locator，或 curriculum semester answer 再次出现 chunk-boundary fragment corruption，则应按 `Phase L/M` 同级 reopen，而不是在前端做一次性清洗。

## Verification

- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/auth-and-db.test.ts`
- `pnpm --dir apps/app-api exec vitest run -c vitest.worker.config.mts test/worker.test.ts`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api test:node`
- `pnpm --dir apps/app-api exec vitest run test/chat-command.service.test.ts`
- `pnpm --dir apps/app-api test:shared-db-integration`
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-actions.test.ts test/public-chat-auth-regressions.test.ts test/worker.test.ts`
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-regressions.test.ts test/worker.test.ts`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web build`
- `node scripts/run-wrangler-command.mjs --cwd apps/public-chat-web whoami --json`
  - `loggedIn: true`
  - `authType: OAuth Token`
  - account: `linear27`
- `pnpm --dir apps/public-chat-web deploy:preflight:staging`
  - `overall_ready: true`
- `pnpm --dir apps/public-chat-web deploy:staging`
  - deployed `public-chat-web-staging`
  - custom domain: `campus-chat-staging.ayafeed.com`
  - current version id: `05075dab-32c0-4f29-b6f0-9f12659854a7`
- `uv run --all-packages python -m unittest tests.test_check_worker_secret_presence`
- `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist`
- `curl -sS http://127.0.0.1:8081/readyz`
  - local trusted-worker supervisor ready after starting with `API_AUTH_MODE=trusted-worker`
- local direct execution smoke
  - `POST http://127.0.0.1:8081/api/v1/answer`
  - `x-worker-origin-auth` matched `apps/app-api/.dev.vars` `SUPERVISOR_API_SHARED_SECRET`
  - response completed and returned a clean semester-course answer without broken fragments
- local browser smoke
  - `public-chat-web` local dev conversation `ee0e20ac-7e56-4705-8a5a-ed919911c0c4`
  - `runtime.request_execution.request_id=req_e96b9a09ed374ec28ee6231000c5e0f8`
  - `answer_preview` confirms clean semester answer
- `uv run --all-packages python -m scripts.check_worker_secret_presence --app apps/app-api --env staging --json`
  - `overall_ready: true`
  - configured `AUTH_RESET_EMAIL_FROM` / `AUTH_TURNSTILE_SECRET_KEY` / `RESEND_API_KEY`
- `uv run --all-packages python -m scripts.check_worker_secret_presence --app apps/public-chat-web --env staging --json`
  - `overall_ready: true`
- `.tmp/local-smoke/20260419T082600+0800-sps-phase-i-turnstile-local/SUMMARY.md`
  - local Turnstile testing credentials proved same-site captcha transport over sign-up / sign-in
- `.tmp/staging-smoke/20260419T105000+0800-sps-phase-i-auth-continuity/SUMMARY.md`
  - register redirected into `/chat`
  - forgot-password returned neutral success copy
  - Resend delivered a real reset mail for the staging identity
  - reset page loaded via the same-site callback URL
  - `GET /api/me` in the pre-reset browser context returned `401` after password reset
  - login page generated a real Turnstile token in the admitted staging domain
  - post-reset sign-in returned `200` and landed back on `/chat`
- `.tmp/staging-smoke/20260419T234915+0800-sps-phase-j-adaptive-turnstile/SUMMARY.md`
  - fresh staging deploy confirmed default runtime posture `interaction-only/render`
  - `/login` `/register` `/forgot-password` all loaded under the admitted hostname with the real staging sitekey
  - Playwright live-widget smoke produced `Security verification failed. Try again.` and `captchaTokenLength = 0` on all three pages
  - login network captured Turnstile PAT `401` on `challenges.cloudflare.com`
  - artifact is diagnostic only; final closeout still requires a real browser session because Cloudflare rejects automation suites on live widgets
- `.tmp/staging-smoke/20260421T023205+0800-sps-phase-j-live-browser/SUMMARY.md`
  - user-owned visible Chrome completed live-widget staging closeout on `/forgot-password`, `/reset-password`, and `/login`
  - `POST /api/auth/request-password-reset` returned `200` and neutral success copy
  - real-browser low-risk path did not surface a forced visible challenge on `/login` `/register` `/forgot-password`
  - reset flow returned to `/login`, and post-reset sign-in landed on `/chat`
  - post-login runtime requests returned `200` for `/api/me`, `/api/models`, and `/api/history?limit=20`
- `.tmp/local-smoke/20260420T003016+0800-sps-phase-k-auth-shell/SUMMARY.md`
  - desktop `/login` `/register` `/forgot-password` 与 invalid `/reset-password` shell screenshots are captured
  - mobile `/login` `/register` screenshots confirm the same single-column shell scales without the donor split preview
  - anonymous local auth pages emit expected `/api/me` `401`, which is pre-auth baseline behavior rather than a shell regression
- `curl --noproxy '*' -sS https://campus-api-staging.ayafeed.com/readyz`
  - `status: ready`
- `curl --noproxy '*' -sS https://campus-api-staging.ayafeed.com/healthz`
  - `status: ok`
- `curl --noproxy '*' -sS https://campus-chat-staging.ayafeed.com/readyz`
  - `status: ready`
- `curl --noproxy '*' -sS https://campus-chat-staging.ayafeed.com/healthz`
  - `status: ok`

## Session Continuity

**Stopped At:** workstream 已完成；若未来重新打开 public auth family / Turnstile posture / public answer contract 的产品工作，应新建 phase 或按 reopen 规则恢复，而不是回退当前 closeout
**Resume File:** `<none>`
