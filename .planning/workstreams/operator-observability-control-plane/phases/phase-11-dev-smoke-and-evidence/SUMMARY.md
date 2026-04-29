---
phase: "11"
name: "Dev Smoke And Evidence"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 11 Summary

## What Closed

- observability preflight 已通过，`overall_ready=true`，三端 `.dev.vars` 与根 `.env` 已对齐。
- local shared DB 已完成 fresh bootstrap。
- smoke identity 与 deterministic request seed 已完成：
  - `help_bot@outlook.com`
  - 5 条 seeded request
  - 覆盖 `completed / needs_clarification / no_answer`
- 三条 canonical Worker smoke gate 已全部通过：
  - `apps/app-api`
  - `apps/public-chat-web`
  - `apps/protected-panel-web`
- `public-chat-web` live browser smoke 已完成：
  - 初次检查时，`5173` 被一个 `2026-04-19` 遗留 dev server 占用
  - 该旧进程下真实 `POST /api/chat/requests` 返回 `500`
  - 回收旧进程并重新启动 fresh `pnpm --dir apps/public-chat-web dev:live-smoke` 后，同一条真实发问链路返回 `200`
  - 页面最终展示回答文案：`请先说明你想查询的校内知识范围或资料集合。`
- `protected-panel-web` live browser smoke 已完成：
  - 初次检查时，本地 Access mock token 已过期，页面表现为 `Invalid Access JWT.`
  - 问题不在 panel route / BFF 本身，而在 `/tmp/panel-local-access` 的静态 token 已过期
  - 刷新本地 mock certs + token 后，`/api/overview` 与五个 same-site `/api/operator/*` seam 全部恢复 `200`
  - `/observability/overview / quality / safety / cost / audit` 五个路由均已加载并渲染 operator context / seeded observability data
- dev/local artifact pack 已落盘。

## Fresh Evidence

- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m scripts.check_worker_observability_env --json`
- `pnpm --dir apps/app-api db:bootstrap`
- `pnpm --dir apps/app-api smoke-identity:provision -- --email help_bot@outlook.com --name "Help Bot"`
- `pnpm --dir apps/app-api requests:seed-smoke -- --email help_bot@outlook.com --name "Help Bot"`
- `pnpm --dir apps/app-api test:worker -- --reporter=verbose`
- `pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "smokes a chat request through public-chat-web into app-api"`
- `pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"`
- artifact pack:
  - `.tmp/observability-smoke/20260420T161442-dev-local-phase11/SUMMARY.md`
  - `.tmp/observability-smoke/20260420T161442-dev-local-phase11/chat-trace.md`
  - `.tmp/observability-smoke/20260420T161442-dev-local-phase11/panel-trace.md`
  - `.tmp/observability-smoke/20260420T161442-dev-local-phase11/app-api-runtime-event.md`

## Residual Gaps

- 这轮只关闭了 `dev-local pre-deploy readiness`，没有关闭 staging / real sink verification。
- `app-api-runtime-event` 仍只写成 `post-deploy verification pending`，因为本轮没有把真实 `Sentry/Axiom` 证据当成 dev phase gate。
- 本地 panel Access mock token 会自然过期；后续 dev smoke 应在开始前主动刷新 `/tmp/panel-local-access` 的 token，而不是等到页面报 `Invalid Access JWT.`

## Handoff

- `Phase 11` 可以视为完成。
- 下一阶段固定进入 `Phase 12: Staging Smoke And Planning Closeout`。
- `Phase 12` 应聚焦：
  - staging deploy truth
  - real sink evidence
  - workstream closeout / gap 清零
