---
phase: "J"
name: "Adaptive Turnstile Posture Productization"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase J Summary

## What Closed

- 把 public auth family 的 Turnstile posture 真正收口成单一路径 truth：
  - Cloudflare 继续拥有 widget mode
  - repo 代码层继续只表达 `sitekey + appearance + execution`
  - staging / production 的 repo runtime posture 固定保持 `interaction-only/render`
- 关闭了 `Phase J` 最后的真实浏览器 blocker：
  - 在用户本机可见 Chrome 中，用真实 admitted widget 完成 `/forgot-password`
  - 通过同一次 reset token 闭环完成 `/reset-password`
  - 用新密码在真实浏览器中完成 `/login -> /chat`
  - 匿名态 `/register` 也已在真实 admitted widget 下确认页面与 Turnstile 无回归
- 证明了 low-risk live path 不会被默认固定成可见 challenge，这与 `Always-on Turnstile verification, adaptive interactive challenge only on elevated risk` 的目标一致。

## Fresh Evidence

- `.tmp/staging-smoke/20260421T023205+0800-sps-phase-j-live-browser/SUMMARY.md`
- `.tmp/staging-smoke/20260421T023205+0800-sps-phase-j-live-browser/forgot-password-success.png`
- `.tmp/staging-smoke/20260421T023205+0800-sps-phase-j-live-browser/login-anonymous.png`
- `.tmp/staging-smoke/20260421T023205+0800-sps-phase-j-live-browser/register-anonymous.png`
- `.tmp/staging-smoke/20260421T023205+0800-sps-phase-j-live-browser/chat-after-login.png`

## Notes

- Cloudflare Dashboard 的 widget-mode UI 没有在同一轮 closeout 中补截图，因为 `dash.cloudflare.com` 当前要求新的交互登录。
- 这不再构成 `Phase J` blocker：
  - provider-side widget mode 仍是 Cloudflare-owned truth
  - repo-side runtime posture 已冻结
  - real-browser continuity 证据已经成立

## Handoff

- `shared-product-surfaces-acceptance-hardening` 已无剩余 active phase。
- 如果后续产品再次改写 public auth family、Turnstile posture，或需要单独沉淀 Cloudflare Dashboard operator evidence，再按新 workstream / reopen 规则恢复，不回退当前 closeout。
