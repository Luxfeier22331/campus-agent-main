---
doc_type: phase_plan
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 5 Plan: Acceptance, Docs And Rollout

## Goal

完成端到端验收、文档更新和 rollout / rollback 口径。

## Tasks

1. 运行 app-api、public-chat-web、operator quality 的 targeted test suites。
2. 运行 public-chat-web browser smoke：
   - 登录
   - 发送问题
   - 对 assistant answer 提交 helpful / unhelpful
   - 刷新后保持 feedback state
3. 验证 operator quality / export 可看到 aggregate 或 candidate。
4. 更新 docs：
   - `docs/contracts/app-api-http.md`
   - `docs/data/app-api-schema.md`
   - `docs/architecture/system/operator-observability-architecture.md` 如新增指标口径
5. 记录 rollout posture：
   - UI 可关
   - route 保持 fail closed
   - 已写 feedback 不因 UI rollback 删除
6. 更新 workstream STATE / ROADMAP closeout。

## Exit Criteria

- 端到端 feedback path 有自动化与 browser evidence。
- docs 与 route exposure inventory 无漂移。
- rollout / rollback 规则清楚。

## Verification

- `pnpm --dir apps/app-api test`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web test:worker`
- targeted operator quality tests
- browser smoke evidence
