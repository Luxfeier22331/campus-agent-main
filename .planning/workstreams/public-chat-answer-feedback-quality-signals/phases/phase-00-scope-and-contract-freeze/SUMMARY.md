---
doc_type: phase_summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Summary: Scope And Contract Freeze

## Outcome

Phase 0 已完成。第一版 answer feedback contract 冻结为 `app-api` owned durable truth +
public-chat-web browser action + operator quality signal，不恢复 donor `/api/vote`。

## Frozen Product Semantics

- 反馈对象是单条 assistant answer 的质量反馈。
- UI 语义是“有帮助 / 没有帮助”，不是公开投票、排序、社区评价或训练自动闭环。
- feedback 不改变 authorization、serving surface、tool permission、retrieval ACL、memory
  projection 或 supervisor admission。
- negative feedback 只进入质量诊断、badcase sampling、intent drift / false positive /
  false negative review。

## Frozen API Contract

- `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- `DELETE /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- caller class: `browser-surface`
- admission: `session principal required`
- target validation:
  - conversation belongs to current owner
  - message belongs to that conversation
  - message role is `assistant`
  - message has non-null `request_id`
- read path: `GET /api/chat/conversations/:conversationId` returns nullable feedback state on
  current owner assistant messages; conversation list does not include feedback.

## Frozen Request Shape

```json
{
  "vote": "unhelpful",
  "reasonCodes": ["wrong_intent"]
}
```

- `vote`: `helpful | unhelpful`
- `reasonCodes`: optional, only accepted for `unhelpful`, max 3, duplicates rejected
- free-form `comment`: not accepted in v1
- `PUT` replaces previous feedback for the same owner user + assistant message
- `DELETE` hard-deletes current feedback row and returns `204 No Content`

## Frozen Reason Codes

- `wrong_intent`
- `not_enough_detail`
- `outdated_or_missing_source`
- `incorrect_answer`
- `unclear_or_hard_to_use`
- `other`

## Frozen Data Shape

First implementation should add `chat.message_feedback` or an equivalent `app-api` owned table:

- `feedback_id`
- `owner_user_id`
- `conversation_id`
- `message_id`
- `request_id`
- `vote`
- `reason_codes_json`
- `created_at`
- `updated_at`

Indexes / constraints:

- unique `(owner_user_id, message_id)`
- index `(request_id)` when non-null
- index `(updated_at desc)`

Forbidden payload:

- raw prompt
- raw answer
- provider raw response
- retrieval payload
- auth material

## Frozen Metric Denominator

- feedback-eligible answer: public-chat assistant message with non-null `request_id` and
  `kind in ('answer', 'clarification', 'no_answer')`
- excluded: user messages, in-flight messages, assistant `kind='error'`, missing/deleted trailing
  messages
- feedback coverage: feedback row count / feedback-eligible answer count
- helpful rate: helpful feedback count / feedback row count
- unhelpful rate: unhelpful feedback count / feedback row count
- negative answer rate: unhelpful feedback count / feedback-eligible answer count
- no-answer negative overlap: unhelpful feedback on `kind='no_answer'`, as count and rate over
  no-answer eligible answers
- wrong-intent signal: unhelpful feedback containing `wrong_intent`, joined through `request_id` to
  request observability intent summary

## Required Follow-up Files

Phase 1 must update:

- `apps/app-api/src/db/schema/chat.ts`
- app-api shared-product migration files
- `apps/app-api/src/modules/chat/*` or a new app-api feedback module
- `apps/app-api/src/app/routes/chat.ts`
- `apps/app-api/src/app/route-exposure.ts`
- `docs/contracts/app-api-http.md`
- `docs/data/app-api-schema.md`

Later phases must update:

- `apps/public-chat-web` API helper and message actions
- `apps/app-api/src/modules/operator-query/*`
- `docs/contracts/app-api-operator-observability-http.md` if quality API shape changes
- `docs/architecture/system/operator-observability-architecture.md` if metric taxonomy changes

## Verification

- Planning diff reviewed against product/runtime and operator observability ownership rules.
- `pnpm docs:lint` is the required local verification for this phase.
