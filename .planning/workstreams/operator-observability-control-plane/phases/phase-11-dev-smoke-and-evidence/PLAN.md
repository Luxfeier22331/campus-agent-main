---
doc_type: phase_plan
phase: "11"
phase_name: "Dev Smoke And Evidence"
status: active
created: 2026-04-20
updated: 2026-04-20
---

# Phase 11 Plan

## Objective

把 `operator-observability-control-plane` 当前已完成的 product surface，收口成一轮 fresh、可复现、明确标注为 dev/local 的 smoke + evidence 闭环。

## Current Baseline

- 已具备 operator observability 的 canonical read surfaces：
  - `Overview`
  - `Quality`
  - `Safety/Authz`
  - `Cost`
  - `Audit`
- 已具备 canonical Worker smoke gate
- 已具备 canonical local live-smoke 拓扑
- 已具备 smoke identity / seeded request 数据入口
- 尚未具备：
  - fresh dev smoke artifact
  - browser smoke screenshot / console / network 证据
  - 明确区分 dev readiness 与 staging closeout 的本轮落盘材料

## Online Best-Practice Alignment

### Playwright

- 以用户可见行为为主，不验证实现细节
- 使用可重复的 seeded 数据和受控身份
- 优先 role / text 等 user-facing locators
- 不把第三方登录页或外部 sink 页面当成本阶段主 smoke 目标

### Cloudflare Workers

- 复用本地 `workerd` / Miniflare / Vite-plugin 路径
- 复用当前 service binding 拓扑验证 same-site Worker-to-Worker 路径
- 不为了 smoke 再拆出第二条与部署形态不一致的本地链路

### Evidence

- browser smoke 失败时优先保留 trace / HTML report / console / network artifact
- 成功时至少保留截图、关键请求摘要、主要命令结果和最终 verdict

## Phase 11 Product Decisions

### Slice 1: Preflight And Local Convergence

- 先执行 observability preflight：
  - `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m scripts.check_worker_observability_env --json`
- 如果 env 未对齐，再执行：
  - `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m scripts.sync_worker_observability_env`
- 在 local shared DB 可能落后 migration 时，先执行：
  - `pnpm --dir apps/app-api db:bootstrap`
- 预置 smoke 身份与 deterministic request 数据：
  - `pnpm --dir apps/app-api smoke-identity:provision`
  - `pnpm --dir apps/app-api requests:seed-smoke`
- 只有在实际 smoke 范围触及 `official_web` control-plane 页面时，才执行：
  - `pnpm --dir apps/app-api official-web:seed-smoke`

### Slice 2: Canonical Worker Smoke Gates

- 按 runbook 固定命令执行三条 canonical Worker smoke：
  - `pnpm --dir apps/app-api test:worker -- --reporter=verbose`
  - `pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "smokes a chat request through public-chat-web into app-api"`
  - `pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"`
- 如 Worker smoke 暴露 auth regression，再回看 `pnpm --dir apps/app-api test:shared-db-integration`
- 这一 slice 的目标是先证明 runtime shell / bridge / admission / no-store 语义仍然正常

### Slice 3: Public Chat Live Browser Smoke

- 用 `pnpm --dir apps/public-chat-web dev:live-smoke` 带起可见浏览器 smoke 拓扑
- 通过 `mcp__playwright__` 连接可见浏览器，验证：
  - 登录态可进入
  - same-site `/api/*` 路径仍命中 shared `app-api`
  - 聊天壳层可正常加载
  - 如果上游执行链路稳定，则提交一条最小真实问题
  - 如果上游执行链路当前不稳定，则退回 seeded conversation / history 验证，但必须在 artifact 中明确标注这不是 live answer generation
- 保留：
  - 页面截图
  - 关键 network 摘要
  - console 摘要
  - 关键请求路径与状态码

### Slice 4: Protected Panel Live Browser Smoke

- 用 `pnpm --dir apps/protected-panel-web dev:live-smoke` 带起可见浏览器 smoke 拓扑
- 通过 `mcp__playwright__` 连接可见浏览器，验证：
  - 受保护入口可进入
  - `/observability/overview`
  - `/observability/quality`
  - `/observability/safety`
  - `/observability/cost`
  - `/observability/audit`
- 验证重点是：
  - 页面可加载
  - seeded data 已进入各域 summary / list / timeseries
  - panel 继续通过 same-site `/api/operator/*` 消费 `app-api`
  - 关键页面不存在新的 runtime shell 回退或 admission 漏洞
- 保留：
  - 每个主域至少一张截图
  - console 摘要
  - 关键 same-site `/api/operator/*` 请求摘要

### Slice 5: Artifact Pack

- 为本轮执行建立：
  - `.tmp/observability-smoke/<timestamp>-dev-<release>/`
- 最小产物：
  - `SUMMARY.md`
  - `chat-trace.md`
  - `panel-trace.md`
  - `app-api-runtime-event.md`
- 其中：
  - `SUMMARY.md` 明确写 `Scope=pre-deploy-readiness`
  - `Environment` 必须写明 `dev-local` 或等价本地/dev 标识
  - 如果本轮未获取真实部署 sink 证据，则必须写 `Post-Deploy Verification: pending`
  - `app-api-runtime-event.md` 可以写成本地不可验证 / 真实 deploy pending，但不能留空

### Slice 6: Planning Writeback And Handoff

- 执行完成后补齐：
  - `SUMMARY.md`
  - `STATE.md`
  - 如达成 exit rule，则准备前推 `Phase 12`
- 如果 dev smoke 过程中发现新的 product/runtime 回退：
  - 先按 blocker 记录到 artifact 与 phase summary
  - 不擅自把 `Phase 11` 改写成功能开发 phase

## Proposed Write Set

- `.planning/workstreams/operator-observability-control-plane/phases/phase-11-dev-smoke-and-evidence/CONTEXT.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-11-dev-smoke-and-evidence/PLAN.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-11-dev-smoke-and-evidence/SUMMARY.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`
- `.tmp/observability-smoke/<timestamp>-dev-<release>/SUMMARY.md`
- `.tmp/observability-smoke/<timestamp>-dev-<release>/chat-trace.md`
- `.tmp/observability-smoke/<timestamp>-dev-<release>/panel-trace.md`
- `.tmp/observability-smoke/<timestamp>-dev-<release>/app-api-runtime-event.md`

## Verification

- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m scripts.check_worker_observability_env --json`
- `pnpm --dir apps/app-api test:worker -- --reporter=verbose`
- `pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "smokes a chat request through public-chat-web into app-api"`
- `pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"`
- `pnpm --dir apps/public-chat-web dev:live-smoke`
- `pnpm --dir apps/protected-panel-web dev:live-smoke`

## Exit Rule

只有在以下条件同时成立时，`Phase 11` 才算完成：

- observability preflight 已有 fresh 结果
- 三条 canonical Worker smoke gate 已有 fresh 结果
- `public-chat-web` 已完成一轮 live browser smoke 并留下 artifact
- `protected-panel-web` observability domains 已完成一轮 live browser smoke 并留下 artifact
- artifact pack 明确写清 dev/local readiness 与 post-deploy pending 的边界
- 没有把 dev smoke 误写成 staging closeout
