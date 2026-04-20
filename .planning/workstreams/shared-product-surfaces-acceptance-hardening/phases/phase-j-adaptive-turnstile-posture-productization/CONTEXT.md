---
phase: "J"
name: "Adaptive Turnstile Posture Productization"
created: 2026-04-19
updated: 2026-04-21
status: completed
---

# Phase J Context

## Goal

在不重开 `Phase F-I` 已冻结的 auth owner / provider / same-site contract truth 的前提下，把 public auth family 的 Turnstile posture 从“已接入 captcha”提升为明确的 runtime / delivery truth：always-on verification、Cloudflare-managed adaptive interactive challenge only on elevated risk，以及 local / staging / production 的 posture seam 与 closeout evidence。

## Current Truth

- `apps/app-api` 继续是唯一 product-layer auth / session / principal owner；Turnstile 的 server-side verification 仍在 Better Auth captcha plugin 内完成。
- `public-chat-web` 当前正式拥有 `/login`、`/register`、`/forgot-password`、`/reset-password` 这组 public auth family route shell。
- `Phase I` 已关闭：
  - Turnstile-backed captcha enforcement 已在 `sign-in`、`sign-up`、`request-password-reset` 生效
  - same-site `/api/auth/*` proxy 已固定只转发 `Origin` / `Referer` / `x-captcha-response`
  - local / staging auth continuity smoke 已证明旧 baseline 闭环成立
- 当前 `Phase J` 起点已经有第一段代码落地：
  - `public-chat-web` auth shell 现在会显式注入 `turnstileAppearance` / `turnstileExecution`
  - 默认 posture 已收口为 `interaction-only` / `render`
  - staging deploy / verify 脚本现在拥有 `STAGING_AUTH_TURNSTILE_APPEARANCE` / `STAGING_AUTH_TURNSTILE_EXECUTION` 这条可选 override seam
- 当前仍未完成的真相：
  - `Phase J` 已完成 fresh staging deploy，`public-chat-web-staging` 当前版本为 `05075dab-32c0-4f29-b6f0-9f12659854a7`
  - 已落新的 execute artifact：`.tmp/staging-smoke/20260419T234915+0800-sps-phase-j-adaptive-turnstile/`
  - 还没有 real-browser 条件下的 admitted-widget smoke closeout evidence
  - 还没有把实际 staging widget mode 与 repo runtime posture 重新对齐到最终 closeout 结论

## Official Doc Facts

- Cloudflare Turnstile widget docs 说明：
  - widget `mode` 的平台真相是 `Managed`、`Non-Interactive`、`Invisible`
  - `Managed` 是推荐模式，会按 visitor risk level 自动选择 non-interactive 或 checkbox challenge
- Cloudflare Turnstile widget configuration docs 说明：
  - code-level render options 里可显式传 `appearance`
  - `appearance` 可选 `always`、`execute`、`interaction-only`
  - `execution` 可选 `render`、`execute`
- Cloudflare Turnstile testing docs 说明：
  - automated testing suites（例如 Selenium、Cypress、Playwright）会被 Turnstile 识别为 bot
  - automation 应搭配 dummy/testing keys，而不是拿真实 admitted widget 做最终验收
- 这意味着：
  - repo 不应复制一套自己的 `Managed` / `Non-Interactive` mode 语义
  - repo 代码层应只暴露 runtime `appearance/execution` seam
  - production 的“always-on verification + elevated-risk-only interactive challenge”应通过 Cloudflare `Managed` widget + repo 默认 `interaction-only/render` 协同达成
  - 对真实 staging widget 的最终 closeout smoke 必须使用真实浏览器 session，不能把 live Playwright 失败误判成产品回归

## Locked Decisions

### Provider Boundary

- Turnstile widget `mode` 继续是 Cloudflare dashboard/widget truth，不在 repo 内再建一层平行 mode 配置。
- repo 代码层只表达：
  - `AUTH_TURNSTILE_SITE_KEY`
  - `AUTH_TURNSTILE_APPEARANCE`
  - `AUTH_TURNSTILE_EXECUTION`

### Default Runtime Posture

- public auth family 默认 posture 固定为：
  - `appearance=interaction-only`
  - `execution=render`
- 这条默认值服务于 always-on verification，同时避免对低风险流量强制显示可见 challenge。

### Environment Split

- `local`
  - 允许 Cloudflare 官方 testing credentials
  - 允许沿默认 `interaction-only/render` 做 deterministic smoke
- `staging`
  - 必须使用真实、hostname-admitted widget credentials
  - runtime posture 允许通过 deploy shell env 临时 override，但不能写回 repo-fixed staging vars
  - 对真实 admitted widget 的 closeout smoke 必须使用真实浏览器；automation browser 只用于证明 testing-key lane 或记录 Cloudflare bot detection 行为
- `production`
  - widget mode 默认应为 Cloudflare `Managed`
  - repo runtime posture 默认仍是 `interaction-only/render`

### Closeout Rule

- `Phase J` 的完成标准不只是代码已落，还必须包含 fresh staging deploy + smoke evidence。
- closeout 前不得把当前状态写成“长期 strategy 已 fully verified”。
- live Turnstile smoke 如果来自 automation suite，只能当作非 closeout 诊断证据，不能充当最终 staging continuity 证明。

## Existing Code Insights

### Reusable Assets

- `apps/public-chat-web/src/platform/auth/turnstile-runtime-config.ts`
  - 已统一承接 Turnstile runtime config normalization，可继续作为 auth shell 和 worker 注入的唯一 posture seam
- `apps/public-chat-web/src/platform/auth/turnstile.tsx`
  - 已消费 `turnstileAppearance` / `turnstileExecution`，并在 `execution=execute` 时显式调用 `turnstile.execute`
- `apps/public-chat-web/src/index.ts`
  - 已通过 auth runtime config script 把 posture 注入 shell，且不扩散到非 auth runtime API
- `apps/public-chat-web/scripts/deploy-staging.mjs`
- `apps/public-chat-web/scripts/verify-staging-config.mjs`
  - 已接住 staging posture override 和 fail-close 校验，是后续 staging closeout 的现成入口

### Established Patterns

- staging runtime truth 继续通过 publish-time vars 注入，不把 secret 或 operator-only posture 固定回 repo。
- workstream closeout 一律以 `.tmp/staging-smoke/` artifact + `STATE.md` 回写为准，不以“本地构建通过”代替。

### Integration Points

- Cloudflare Dashboard Turnstile widget config
- `apps/public-chat-web` staging deploy shell env
- staging browser smoke 路径：
  - `/login`
  - `/register`
  - `/forgot-password`

## Non-goals

- 不重开 `Phase I` 的 captcha transport / Better Auth integration 基础实现
- 不给 repo 新增 `AUTH_TURNSTILE_MODE` 一类平行于 Cloudflare widget mode 的自定义概念
- 不新增 repo-owned attack-mode 开关、双套 auth flow 或 page-local abuse-control patch
- 不把 `Phase J` 扩成 panel auth、MFA、social login、passkey phase

## Canonical References

- `docs/architecture/product-runtime-architecture.md`
- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/environment/provider-and-secret-inventory.md`
- `docs/runbooks/staging-worker-deploy-runbook.md`
- `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/REQUIREMENTS.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `apps/public-chat-web/src/platform/auth/turnstile-runtime-config.ts`
- `apps/public-chat-web/src/platform/auth/turnstile.tsx`
- `apps/public-chat-web/src/index.ts`
- `apps/public-chat-web/scripts/deploy-staging.mjs`
- `apps/public-chat-web/scripts/verify-staging-config.mjs`
- `apps/public-chat-web/test/worker.test.ts`
- `apps/public-chat-web/test/public-chat-turnstile-runtime.test.ts`
- Cloudflare Turnstile widget docs: `https://developers.cloudflare.com/turnstile/concepts/widget/`
- Cloudflare Turnstile widget configuration docs: `https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/`
- Cloudflare Turnstile testing docs: `https://developers.cloudflare.com/turnstile/troubleshooting/testing/`
