---
doc_type: state
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# State: Public Chat Answer Feedback And Quality Signals

## Current Status

- status: `active`
- current slice: Phase 0 completed; Phase 1 ready
- owner: current Codex session
- active implementation: no code implementation yet
- next phase: `Phase 1: App API Feedback Truth`

## Captured Context

2026-04-29 review / planning context:

- public-chat-web 旧 donor vote UI / `/api/vote` 不能直接恢复，因为它绕过 `app-api`
  owned product truth。
- `docs/architecture/system/product-runtime-architecture.md` 固定 public-chat-web 只通过
  same-site `/api/*` seam 调用 `apps/app-api`，不拥有 auth/session/conversation truth。
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
  固定 request projection 与 operator read model 由 `apps/app-api` 拥有。
- `docs/architecture/system/operator-observability-architecture.md` 已把 Quality 定位为
  `app-api` owned operator-facing read model。
- 当前 `chat.messages` 已有 assistant message、`kind`、`request_id` 与 structured parts，
  适合成为 feedback target，但尚无 feedback schema。

## Phase 0 Frozen Decisions

- Route shape:
  - `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`
  - `DELETE /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- Read path: conversation detail returns nullable feedback state on current owner assistant messages.
- Target: assistant messages with non-null `request_id`; feedback controls should only render for
  `kind in ('answer', 'clarification', 'no_answer')`.
- Request body: `vote: helpful | unhelpful`, optional `reasonCodes` for `unhelpful` only.
- Reason codes: `wrong_intent`, `not_enough_detail`, `outdated_or_missing_source`,
  `incorrect_answer`, `unclear_or_hard_to_use`, `other`.
- v1 does not accept free-form comment.
- Idempotency: latest row per owner user + assistant message.
- Delete: hard-delete current feedback row; no tombstone in v1.
- Metrics: coverage denominator is feedback-eligible assistant answers, not all requests.

## Blockers

- Phase 0 blockers resolved.
- Phase 1 still needs implementation decisions for exact migration number, service file ownership,
  and store method names.
- Phase 2 still needs implementation decision on whether vendor compatibility keeps an internal
  adapter or renames donor `Vote` usage to repo-owned `AnswerFeedback`.

## Verification

- Phase 0 verification: docs diff review plus `pnpm docs:lint`.
- Phase 1 第一批验证应覆盖：
  - `pnpm --dir apps/app-api test`
  - `pnpm --dir apps/public-chat-web test:worker`
  - `pnpm --dir apps/public-chat-web typecheck`
  - operator quality query targeted tests
  - browser smoke for feedback submit + operator visibility

## Continuity Notes

- 不要把 feedback 做进 `apps/supervisor-api`、`packages/rag-agent` 或 retrieval backend。
- 不要让 feedback 直接改变 capability routing、serving surface 或 ACL。
- 不要把 donor `/api/vote` 作为临时兼容层恢复；UI 恢复必须以 app-api route 为前置条件。
- negative feedback 只能作为质量诊断与 case-set sampling 输入，不能自动变成线上策略。
