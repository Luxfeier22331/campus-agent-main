---
phase: "11"
name: "Dev Smoke And Evidence"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase 11 Context

## Goal

交付 `operator-observability-control-plane` 的 dev smoke 与 evidence 收口。

这一阶段不再新增 observability product surface，而是把当前 merged truth 用可重复的本地/dev 闭环跑通并留下证据：

- Worker preflight
- deterministic seeded data
- canonical Worker smoke gates
- `public-chat-web` 与 `protected-panel-web` 的 live browser smoke
- dev-labeled artifact pack

## Current Truth

- `Phase 1-10` 已完成：
  - request observability fact
  - audit projection
  - aggregate APIs
  - panel `Overview / Quality / Safety / Cost / Audit`
  - `Sentry` tag/context 收口
  - `Axiom` allowlist + canonical envelope
  - `quality.sampled_grade` backflow
- 当前 canonical local smoke 入口已经存在，不需要再发明新体系：
  - `pnpm --dir apps/app-api test:worker -- --reporter=verbose`
  - `pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "smokes a chat request through public-chat-web into app-api"`
  - `pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"`
- 当前 canonical local browser/live smoke 拓扑也已经存在：
  - `pnpm --dir apps/public-chat-web dev:live-smoke`
    - `http://127.0.0.1:5173`
    - 通过 Vite auxiliary Worker 带起 shared `app-api`
  - `pnpm --dir apps/protected-panel-web dev:live-smoke`
    - `http://127.0.0.1:5174`
    - 同样通过 Vite auxiliary Worker 带起 shared `app-api`
- 当前 deterministic smoke data / identity 入口已经存在：
  - `pnpm --dir apps/app-api smoke-identity:provision`
  - `pnpm --dir apps/app-api requests:seed-smoke`
  - `pnpm --dir apps/app-api official-web:seed-smoke`
- observability evidence 的 canonical artifact 目录与模板已经存在：
  - `.tmp/observability-smoke/<timestamp>-<environment>-<release>/`
  - `docs/runbooks/templates/worker-observability-smoke-artifact-template.md`
- shared-db integration 里的 auth runtime blocker 已在 `Phase 10` 修掉：
  - 原因不是长期 auth 架构缺口，而是 Turnstile 已进入真实 auth path 后，shared-db integration / smoke provision path 没有补齐 testing secret 与 dummy captcha token
  - 现在 local/test provisioning 与 shared-db helper 都已补齐默认 testing secret/token，真实 sign-up path 可以在 integration env 中通过

## Contract Reality

- 本阶段只关闭 `dev smoke + evidence`，不是 staging closeout。
- `protected-panel-web` 仍然只能通过 same-site BFF 消费 `app-api` owned operator read model，不得直查 `Sentry`、`Axiom` 或数据库。
- `public-chat-web` 与 `protected-panel-web` 的浏览器 smoke，必须基于当前 canonical Worker live-smoke 拓扑，而不是另起两套分离 dev session。
- dev evidence 必须明确标记为：
  - `pre-deploy-readiness`
  - `development` / `dev-local`
  - `post-deploy verification pending`（如果没有真实部署 sink 证据）
- browser smoke 应验证用户可见行为与 same-site runtime path，不把第三方登录页、Cloudflare Access 本身或外部 sink UI 当成主测试对象。

## Why This Phase Exists

虽然 `Phase 1-10` 已把 operator observability control plane 的结构和 product surface 做出来了，但当前还缺少 fresh dev evidence：

- 没有统一落盘的 preflight + Worker smoke 证据
- 没有 `public-chat-web` live browser smoke 证据
- 没有 `protected-panel-web` observability domain live browser smoke 证据
- 没有 dev-labeled artifact pack 去支撑 `Phase 12` 的 staging closeout

也就是说，当前已经接近“能验收”，但还不能把已有实现说成“已经有 fresh smoke evidence”。

## Locked Decisions

### Smoke Topology Decision

- 复用当前 repo 已有 runbook 与命令，不新增 repo-wide 新 smoke framework
- local browser smoke 固定走 auxiliary Worker live-smoke 拓扑
- 不把 `pnpm dev` 双会话调试路径当成 canonical smoke 入口

### Evidence Decision

- evidence 目录固定落在 `.tmp/observability-smoke/<timestamp>-<environment>-<release>/`
- 当前 phase 产出的证据只能声明为 dev/local readiness
- 不得把 dev/browser artifact 冒充成 staging / post-deploy closure

### Browser Execution Decision

- 本轮浏览器 smoke 优先使用 `mcp__playwright__`
- 执行时优先使用可见浏览器窗口，以便人工协助通过受保护入口
- 当前 phase 不再回退到 Chrome DevTools MCP 作为主执行路径

### Data Decision

- 优先使用 deterministic seeded identity / requests / operator data
- 不把随机历史数据或手工临时构造页面状态当成主要 smoke 基线
- 如果 live chat 执行链路受上游执行依赖影响，允许在浏览器 smoke 中退回到 seeded conversation / history / operator aggregates，但必须在 artifact 中显式标注

### Auth Decision

- `Phase 11` 只消费 `Phase 10` 已修好的 shared-db auth baseline
- 只有当 shared-db integration 或 smoke identity provisioning 再次回退时，才允许重新打开 auth blocker；否则不在本阶段重写 auth runtime

### Anti-Shortcut Decision

- 不新增 repo-wide 一键总控烟雾脚本
- 不把 panel 变成 sink explorer
- 不为了本地 smoke 方便而改写长期 ownership / topology
- 不把“能打开页面”替代成“已经完成 observability smoke”

## External Best-Practice Inputs

### Playwright Best Practices

- 官方建议测试用户可见行为，而不是实现细节
- 官方建议让测试数据与会话保持隔离和可重复
- 官方建议优先使用 role / text 等 user-facing locators
- 官方建议避免把第三方依赖本身作为主要测试对象
- 参考：
  - `https://playwright.dev/docs/best-practices`

### Playwright Trace / Report Guidance

- 官方 Trace Viewer 与 HTML report 是失败排查和 smoke 留痕的 canonical artifact
- trace 能保留 step、network、console、DOM snapshot
- 这直接支撑本阶段把 browser smoke 证据写入 artifact pack
- 参考：
  - `https://playwright.dev/docs/trace-viewer-intro`

### Cloudflare Workers Local Development

- 官方明确本地开发应在本机通过 `Miniflare` / `workerd` 执行 Worker 代码
- 官方明确 `Wrangler` 与 Cloudflare Vite plugin 都是 canonical local-dev path
- 官方明确本地开发时 binding API 与部署后保持一致
- 这与当前 `dev:live-smoke` auxiliary Worker 拓扑完全一致
- 参考：
  - `https://developers.cloudflare.com/workers/local-development/`

### Cloudflare Service Bindings

- 官方明确 service bindings 是 Worker-to-Worker 的 canonical internal path
- 官方明确本地开发支持 service bindings
- 这与当前 `public-chat-web` / `protected-panel-web` same-site `/api/*` 命中 shared `app-api` 的 smoke 方向一致
- 参考：
  - `https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/`

## Existing Code Insights

### Relevant Docs

- `docs/architecture/operator-observability-architecture.md`
- `docs/runbooks/worker-observability-smoke-runbook.md`
- `docs/runbooks/forward-worker-surface-smoke-runbook.md`
- `docs/runbooks/templates/worker-observability-smoke-artifact-template.md`

### Relevant Runtime Entrypoints

- `apps/public-chat-web/package.json`
- `apps/public-chat-web/README.md`
- `apps/protected-panel-web/package.json`
- `apps/protected-panel-web/README.md`
- `apps/protected-panel-web/vite.config.ts`
- `apps/app-api/README.md`

### Relevant Seed / Provision Scripts

- `apps/app-api/scripts/provision-smoke-identity-lib.mjs`
- `apps/app-api/scripts/seed-request-smoke.ts`
- `apps/app-api/scripts/seed-official-web-smoke.ts`
- `apps/app-api/test/shared-db-integration-helpers.ts`

## Phase 11 Deliverable Boundary

本 phase 结束时，应至少具备：

- fresh dev preflight 结果
- fresh Worker smoke gate 结果
- `public-chat-web` live browser smoke 记录
- `protected-panel-web` observability route live browser smoke 记录
- `.tmp/observability-smoke/...` artifact pack
- 明确写清 dev evidence 与 post-deploy pending 的边界

本 phase 不要求：

- staging closeout
- 重新设计 observability product architecture
- 新增 panel 功能页
- 引入新的 telemetry sink 或新的 query truth owner
- 把 `official_web` control plane 纳入本阶段主 smoke 结论

## Canonical References

- `docs/architecture/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/plans/operator-observability-control-plane-foundation.md`
- `docs/runbooks/worker-observability-smoke-runbook.md`
- `docs/runbooks/forward-worker-surface-smoke-runbook.md`
- `docs/runbooks/templates/worker-observability-smoke-artifact-template.md`
- `.planning/workstreams/operator-observability-control-plane/REQUIREMENTS.md`
- `.planning/workstreams/operator-observability-control-plane/ROADMAP.md`
