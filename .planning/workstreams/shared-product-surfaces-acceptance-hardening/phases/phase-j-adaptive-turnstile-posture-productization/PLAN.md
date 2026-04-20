---
doc_type: phase_plan
phase: "J"
phase_name: "Adaptive Turnstile Posture Productization"
status: completed
created: 2026-04-19
updated: 2026-04-21
---

# Phase J Plan

## Objective

在已落 `public-chat-web` Turnstile runtime posture seam 的基础上，完成 `Phase J` 的 staging deploy / smoke / closeout，把 public auth family 的 Turnstile posture 真正收口为：always-on verification、Cloudflare-managed adaptive interactive challenge only on elevated risk，以及 local / staging / production 的单一路径 runtime truth。

## Why This Phase Exists

`Phase I` 已证明 Turnstile-backed auth continuity 成立，但它留下了一个未收口的灰区：

- staging closeout 曾使用 dedicated widget + `non-interactive` posture 降低 operator friction
- production 方向又要求 `Managed` widget + elevated-risk-only interactive challenge
- repo 之前没有显式的 code/runtime seam 去表达这层差异

如果不补这一 phase，仓库会长期停在“代码能跑，但 posture 真相散落在 dashboard / shell env / 旧 smoke 叙事里”的状态。

## External References

- Cloudflare Turnstile widget docs:
  - https://developers.cloudflare.com/turnstile/concepts/widget/
- Cloudflare Turnstile widget configuration docs:
  - https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/
- Cloudflare Turnstile testing docs:
  - https://developers.cloudflare.com/turnstile/troubleshooting/testing/

## Decisions To Freeze

1. repo 代码层只表达 `sitekey + appearance + execution`，不新增 repo-owned `mode` 概念。
2. 默认 runtime posture 固定为 `interaction-only/render`。
3. production 的 widget mode 固定应回到 Cloudflare `Managed`。
4. staging 允许通过 deploy shell env 临时 override `appearance/execution`，但不允许把这些值回写到 repo-fixed staging vars。
5. `Phase J` closeout 必须包含 fresh staging deploy + browser smoke，而不是只靠本地 test/build。
6. 对真实 admitted widget 的最终 smoke，不接受 Playwright / Selenium / Cypress 这类 automation suite 作为 closeout gate；这些浏览器只适用于 Cloudflare testing keys。

## Current Baseline

- 代码已落：
  - `public-chat-web` 已显式注入并消费 `turnstileAppearance` / `turnstileExecution`
  - staging deploy/verify 脚本已拥有 posture override seam
- fresh local gate 已通过：
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web test:worker`
  - `pnpm --dir apps/public-chat-web build`
- 当前剩余 gap 只在 staging：
  - 视需要确认真实 widget mode
  - 用真实浏览器补完 login/register/forgot-password closeout smoke
  - 回写 evidence 与 planning truth

## Execution Slices

### Slice 1: Freeze Phase J Planning Truth

- 创建 `phase-j-adaptive-turnstile-posture-productization/CONTEXT.md`
- 创建 `phase-j-adaptive-turnstile-posture-productization/PLAN.md`
- 更新 workstream `STATE.md` / repo `WORKSTREAMS.md`，把 current plan 指向 `Phase J`

### Slice 2: Confirm Staging Widget Truth

- 在 Cloudflare Dashboard 核对 `campus-chat-staging.ayafeed.com` 当前使用的 Turnstile widget：
  - sitekey 是否仍是 admitted 真实 widget
  - widget mode 当前是 `Managed` 还是 `Non-Interactive`
- 如果 staging 仍保留临时 low-friction widget mode，需要明确记录它只代表 staging operator posture，不代表 production policy

### Slice 3: Re-Deploy Public Chat Staging With Posture Seam

- 使用当前 shell 的 `wrangler` 登录态执行：
  - `pnpm --dir apps/public-chat-web deploy:preflight:staging`
  - `pnpm --dir apps/public-chat-web deploy:staging`
- deploy 时显式注入：
  - `STAGING_AUTH_TURNSTILE_SITE_KEY`
- 如 staging 需要临时不同 runtime posture，再显式注入：
  - `STAGING_AUTH_TURNSTILE_APPEARANCE`
  - `STAGING_AUTH_TURNSTILE_EXECUTION`
- 禁止把这三个值写回 repo-fixed staging var

### Slice 4: Run Fresh Staging Browser Smoke

- 用 admitted staging hostname 验证：
  - `/login`
  - `/register`
  - `/forgot-password`
- 对真实 admitted widget 的 final smoke，必须使用真实浏览器 session；Playwright / Selenium / Cypress 只可作为 automation diagnostic，不可作为 closeout 通过依据
- 最低 smoke 证据：
  - auth page 正常加载
  - Turnstile token 正常生成
  - same-site `/api/auth/*` 请求无回归
  - 在默认 posture 下，低风险流量不会被固定可见 challenge 打断
- 如 widget mode 是 `Managed`，要额外确认：
  - 默认情况下不是每次都可见交互 challenge
  - 交互 challenge 仍可在需要时出现

### Slice 5: Close Out Docs And Workstream State

- 在 `.tmp/staging-smoke/` 落 fresh artifact
- 更新：
  - `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
  - `.planning/WORKSTREAMS.md`
- 只有当 staging evidence 已成立时，才允许把 `Phase J` 标记为 complete

## Proposed Write Set For Remaining Execution

- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-j-adaptive-turnstile-posture-productization/CONTEXT.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-j-adaptive-turnstile-posture-productization/PLAN.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/WORKSTREAMS.md`
- `.tmp/staging-smoke/*`
- 视 smoke 结果决定是否需要再改：
  - `apps/public-chat-web/scripts/deploy-staging.mjs`
  - `apps/public-chat-web/scripts/verify-staging-config.mjs`
  - `docs/environment/provider-and-secret-inventory.md`
  - `docs/runbooks/staging-worker-deploy-runbook.md`

## Verification Loop

- planning truth:
  - `Phase J` 已有 workstream-native `CONTEXT.md` / `PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向 `Phase J` plan 文件
- code truth:
  - `turnstileAppearance` / `turnstileExecution` 仍是唯一 runtime seam
  - staging deploy / verify 脚本继续阻止 repo-fixed staging var 漂移
- command truth:
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web test:worker`
  - `pnpm --dir apps/public-chat-web build`
  - `pnpm --dir apps/public-chat-web deploy:preflight:staging`
  - `pnpm --dir apps/public-chat-web deploy:staging`
- staging truth:
  - fresh artifact 证明真实 admitted widget + current runtime posture seam 已上线到 staging，并记录了 automation browser 被 Turnstile 拒绝的行为
  - real-browser artifact 继续作为 closeout 所需剩余证据，用来证明 login/register/forgot-password continuity
  - fresh artifact 证明当前 staging posture 与 production target posture 的区别已被显式记录，而不是隐性漂移

## Exit Rule

Phase J 完成后，repo 应达到：

- public auth family 的 Turnstile posture 已有单一路径 runtime truth
- Cloudflare widget mode 与 repo runtime posture 的职责边界已清楚分离
- staging 有 fresh deploy/smoke evidence
- `shared-product-surfaces-acceptance-hardening` 不再存在剩余 active phase
