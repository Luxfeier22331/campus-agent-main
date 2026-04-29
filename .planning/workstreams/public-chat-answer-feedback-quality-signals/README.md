---
doc_type: index
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Workstream: Public Chat Answer Feedback And Quality Signals

这是 `public-chat-answer-feedback-quality-signals` 的 native backlog workstream 入口。
它承接 public chat 中“这条回答是否有帮助”的用户反馈闭环，并把反馈收口为
`app-api` owned product truth 与 operator-facing quality signals。

## Current Status

- status: `active`
- current phase: `Phase 2` ready
- active implementation: Phase 1 app-api durable feedback truth completed; Phase 2 not started
- current posture: public-chat-web 中旧 donor `/api/vote` 行为保持关闭；只有在
  `app-api` 拥有反馈写入、持久化、权限校验、指标与导出链路后，才恢复用户可见的
  helpful / unhelpful action

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Phase Plans

- Phase 0: `./phases/phase-00-scope-and-contract-freeze/PLAN.md`
- Phase 0 summary: `./phases/phase-00-scope-and-contract-freeze/SUMMARY.md`
- Phase 1: `./phases/phase-01-app-api-feedback-truth/PLAN.md`
- Phase 1 summary: `./phases/phase-01-app-api-feedback-truth/SUMMARY.md`
- Phase 2: `./phases/phase-02-browser-surface-and-public-chat-ui/PLAN.md`
- Phase 3: `./phases/phase-03-quality-read-model-and-metrics/PLAN.md`
- Phase 4: `./phases/phase-04-drift-export-and-eval-loop/PLAN.md`
- Phase 5: `./phases/phase-05-acceptance-docs-and-rollout/PLAN.md`

## Boundary Notes

- 这条线的对象是 answer quality feedback，不是泛化“投票”、排名或社交互动。
- `apps/app-api` 必须拥有 feedback write surface、durable truth、ownership validation
  与 operator quality read model。
- `apps/public-chat-web` 只承担浏览器入口、同站 API 调用、交互状态与错误展示。
- 不恢复 donor-only `/api/vote`，不在 public-chat-web 自建本地反馈 truth。
- feedback 不改变 authorization、serving surface、tool permission、retrieval ACL 或
  supervisor admission。
- feedback 可以成为质量分析、badcase sampling、intent drift / false positive /
  false negative 诊断的输入，但不能直接驱动在线答案或权限决策。

## Related Architecture

- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `docs/data/app-api-schema.md`
- `docs/contracts/app-api-http.md`
