---
doc_type: plan
status: active
created: 2026-04-18
updated: 2026-04-18
---

# Shared Product Surfaces Acceptance And Hardening

## 文档边界

本文固定以下三端的联合验收 / 硬化方案：

- `apps/app-api`
- `apps/public-chat-web`
- `apps/protected-panel-web`

本文不负责：

- 改写 `docs/architecture/current-architecture.md` 已冻结的 shared product topology
- 把 `apps/supervisor-api` 重新升格为 product-facing backend
- 为 panel 单独再建一套 product backend
- 重新开放 `Jobs` / `Operations` / `Audit`
- 把 `official_web`、`authenticated_notice`、`regulation import` 或其他数据面工作混入本 workstream

## 当前生命周期状态

- 当前状态是 `active`
- 这条 workstream 已在 2026-04-19 完成原始 `A-E` staging closeout 后 reopen
- 当前 reopen scope 固定为 public auth follow-up：`/login` `/register` 产品化、forgot/reset password、auth mailer contract 与 smoke evidence
- 同一 workstream 内不再并发；并行只发生在不同 workstreams 之间

## 直接结论

`app-api`、`public-chat-web`、`protected-panel-web` 不能拆成三条并发 workstream。

它们必须作为一条 `shared product surfaces acceptance / hardening` workstream 推进，固定顺序如下：

1. `app-api` acceptance baseline
2. `public-chat-web` acceptance
3. `protected-panel-web` acceptance
4. integrated acceptance
5. staging preflight and planning closeout
6. public auth shell productization
7. password reset backend / mail contract
8. public recovery UX
9. auth hardening / smoke

原因固定为：

- 三端共享同一 product backend seam，chat / panel 的表层问题很可能根因在 `apps/app-api`
- panel `Requests` 的 ownership 已冻结在 `apps/app-api`，不能回退成 panel side synthesis
- 如果把三端拆成独立并发 lane，容易把 backend seam defect 错判成 surface 局部问题，并继续累积局部 patch

## 前置真相

接手这条线之前，先以以下文档为准：

- `docs/architecture/current-architecture.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/protected-panel-runtime-api-inventory.md`

当前已存在的相关 closeout 证据：

- `docs/plans/public-chat-web-vendor-tech-debt-convergence.md`
- `.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/SUMMARY.md`
- `.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/SUMMARY.md`

## 固定执行规则

- 同一 workstream 内禁止并发拆分 `app-api`、chat、panel
- 如果 chat 或 panel 的失败根因属于 shared backend seam，修复必须回到 `apps/app-api`
- `protected-panel-web` 只验证已开放域：`Overview`、`Requests`、`Official Web`
- `Jobs`、`Operations`、`Audit` 继续视为未开放域，不纳入本轮验收
- `protected-panel-web` 的 `/login` 继续只视为 Cloudflare Access reentry，不纳入 end-user password product
- 验收关注的是 accepted topology 上的 product acceptance / hardening，不是重新设计 topology

## Phase A: `app-api` Acceptance Baseline

目标：

- 先确认 shared backend 的 auth/session/chat ingress/request projection/operator query 基线成立
- 在进入 chat 和 panel 之前，先把 shared seam 的失败定位能力补齐

建议命令：

- `pnpm --dir apps/app-api db:bootstrap`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api test`
- `pnpm --dir apps/app-api test:worker`
- `pnpm --dir apps/app-api test:shared-db-integration`

退出条件：

- local shared DB bootstrap 成立
- Node lane、Worker lane、shared DB integration lane 都通过
- chat ingress、session persistence、request projection、operator read-model 不存在已知未分类失败

## Phase B: `public-chat-web` Product Acceptance

目标：

- 在 `app-api` 基线稳定后，确认 public chat surface 的 type/test/build 与关键交互成立
- 只把 donor parity closeout 视为历史基础，不把它冒充成当前产品验收

建议命令：

- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web build`

浏览器 smoke 最小范围：

- `/login`
- `/chat`
- 首次发送
- reload 后会话 / history 保持

退出条件：

- same-site chat path 可用
- 首次发送、会话路由、reload/history 都成立
- surface failure 若落回 shared seam，已回到 Phase A 修复而不是在 chat 侧打补丁

## Phase C: `protected-panel-web` Acceptance

目标：

- 确认 protected panel 作为 operator surface 的当前开放域可稳定消费 `app-api` owned APIs

建议命令：

- `pnpm --dir apps/protected-panel-web typecheck`
- `pnpm --dir apps/protected-panel-web test:worker`
- `pnpm --dir apps/protected-panel-web build`

浏览器验收范围：

- `Overview`
- `Requests`
- `Official Web`

退出条件：

- panel 可稳定进入当前开放域
- `Requests` 不回退为 audit log 直读、telemetry sink 直读或 panel-side synthesis
- surface failure 若落回 shared seam，已回到 Phase A 修复

## Phase D: Integrated Acceptance

目标：

- 验证 public chat 与 protected panel 通过 shared `app-api` 连成同一条产品链路

最小验收动作：

- 在 public chat 发起一条真实请求
- 在 panel `Requests` 中看到同一条 request projection
- 验证 request 状态、问题摘要和主体信息能被 operator surface 消费

退出条件：

- chat request 到 panel request projection 的链路成立
- integrated failure 已明确归因到 `app-api` seam、chat surface 或 panel surface 之一

## Phase E: Staging Preflight And Planning Closeout

目标：

- 在 local/integrated 验收完成后，再做 staging preflight 和 planning truth closeout

建议命令：

- `pnpm --dir apps/app-api deploy:preflight:staging`
- `pnpm --dir apps/public-chat-web deploy:preflight:staging`
- `pnpm --dir apps/protected-panel-web deploy:preflight:staging`

退出条件：

- 三端 staging preflight 都通过
- `.planning` 真相明确记录本轮验收结果、剩余缺口与下一条 follow-up
- 不把 preflight 成功误写成真实 staging smoke 已完成

## Phase F: Public Auth Shell Productization

目标：

- 把 `public-chat-web` 的 `/login` `/register` 从“可用但 out-of-scope 的 donor wrapper”提升为正式 public auth surface
- 冻结 visible owner、允许差异、redirect contract 与 future recovery CTA 位置

退出条件：

- `/login` `/register` 的产品可见 owner、route contract 与 acceptance matrix 已冻结
- 不再把 public auth shell 留在长期灰区

## Phase G: Password Reset Backend And Mail Contract

目标：

- 在 `app-api` 内补齐 Better Auth password reset backend
- 冻结 auth mail provider / secret / callback / runbook truth

退出条件：

- reset request / token consumption backend 可用
- mail provider / env inventory / staging secret ownership 落盘

## Phase H: Public Recovery UX

目标：

- 在 `public-chat-web` 增加 `/forgot-password` 与 `/reset-password`
- 收口 request-sent、token invalid、token expired、reset success 与 post-reset sign-in 路径

退出条件：

- end-user 可以从登录页进入恢复流程并完成真实账户恢复

## Phase I: Auth Hardening And Smoke

目标：

- 补齐 node / worker / browser / staging recovery verification
- 显式验证枚举防护、same-site origin / referer 保持与 reset 后重新登录闭环

退出条件：

- public auth shell 与 recovery flow 有 fresh local / staging evidence
- 没有把 reset token、账户存在性或 raw auth material 泄漏到错误 surface

## 接手标准

其他会话接手这条线时，默认按以下顺序开始：

1. 先检查 `.planning/WORKSTREAMS.md` 和 `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`，确认这条 line 仍保持 active，而不是被改写为 paused / backlog
2. 再按本文顺序推进 `app-api -> chat -> panel -> integrated acceptance`
3. 完成后再更新 `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`、`.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md` 与相关 evidence 文档
