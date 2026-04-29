---
doc_type: requirements
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Requirements: Public Chat Answer Feedback And Quality Signals

## Goal

为 public chat 增加用户对单条 assistant answer 的质量反馈入口，并把反馈稳定落到
`app-api` owned durable truth、operator quality metrics 与后续 drift / eval 分析链路。

## Captured Gaps

1. public-chat-web 当前不能展示 helpful / unhelpful，因为旧 donor `/api/vote` 没有
   `app-api` owned write surface。
2. `apps/app-api` 当前没有 answer feedback 的 schema、service、route、route exposure
   inventory 或 HTTP contract。
3. 当前 `chat.messages` 能保存 assistant message 与 `request_id`，但没有 feedback
   upsert truth。
4. operator quality surface 当前可承接质量聚合，但没有用户反馈维度。
5. intent drift / false positive / false negative 分析目前缺少真实用户侧 negative
   feedback 信号。
6. public-chat-web 中 donor vote 类型仍存在于 vendor compatibility 层，后续恢复时需要避免
   重新暴露 unsupported `/api/vote`。

## In Scope

- `app-api` answer feedback schema / migration / Drizzle model。
- `app-api` feedback command service 与 browser-surface route。
- 对 conversation ownership、assistant message role、message/request correlation 的服务端校验。
- 每个 user + assistant message 的幂等 upsert 语义。
- public-chat-web message action 中恢复 helpful / unhelpful UI，并走 same-site
  `app-api` helper。
- optional unhelpful reason codes；v1 不开放自由文本 comment，避免新增隐私与滥用面。
- operator quality read model / summary / timeseries 中增加 feedback aggregate。
- feedback export / sampled badcase feed，供 eval 与 drift review 使用。
- contract docs、schema docs、route exposure inventory、tests 与 smoke。

## Non-goals

- 不恢复 donor-only `/api/vote` route 或 donor DB schema。
- 不让 public-chat-web 直接写数据库、日志 sink 或 local-only vote truth。
- 不让 feedback 改变用户权限、资料可见范围、serving surface、tool permission 或
  supervisor admission。
- 不把 raw transcript、raw prompt、provider response 或 retrieval payload 复制进 feedback 表。
- 不做答案排名、社区投票、公开评价展示或 model training 自动闭环。
- 不把 negative feedback 直接变成自动 reroute / auto memory / auto block 规则。
- v1 不采集自由文本 comment；需要 comment 时必须重新 admission 数据最小化、留存与滥用控制。

## Frozen Feedback Contract

Phase 0 已冻结第一版为 answer-scoped feedback：

- target: assistant message
- write route:
  `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- delete route:
  `DELETE /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- read path: `GET /api/chat/conversations/:conversationId` 在当前用户自己的 assistant
  messages 上返回 nullable `feedback` state；conversation list 不内嵌 feedback
- vote values: `helpful`, `unhelpful`
- reason code values:
  - `wrong_intent`
  - `not_enough_detail`
  - `outdated_or_missing_source`
  - `incorrect_answer`
  - `unclear_or_hard_to_use`
  - `other`
- reason code rules: only accepted for `unhelpful`; optional; max 3 values; duplicates rejected
- comment: not accepted in v1
- idempotency: one latest feedback row per owner principal + assistant message
- change: later `PUT` replaces previous vote and reason codes
- delete: `DELETE` hard-deletes the current feedback row; no tombstone in v1
- response: `PUT` returns latest feedback state; `DELETE` returns `204 No Content`

## Frozen Data Contract

第一版 durable truth 使用 `chat.message_feedback` 或等价 app-api owned table：

- `feedback_id`
- `owner_user_id`
- `conversation_id`
- `message_id`
- `request_id` nullable but copied when assistant message has one
- `vote`
- `reason_codes_json`
- `created_at`
- `updated_at`

约束：

- unique `(owner_user_id, message_id)`
- index `(request_id)` when non-null
- index `(updated_at desc)`
- no raw prompt / raw answer / provider response / retrieval payload

## Frozen Metric Denominator

- feedback-eligible answer: public-chat assistant message with non-null `request_id` and
  `kind in ('answer', 'clarification', 'no_answer')`
- excluded: user messages, in-flight messages, assistant `kind='error'`, missing/deleted trailing
  messages
- feedback coverage: feedback row count / feedback-eligible answer count
- helpful rate: helpful feedback count / feedback row count
- unhelpful rate: unhelpful feedback count / feedback row count
- negative answer rate: unhelpful feedback count / feedback-eligible answer count
- no-answer negative overlap: unhelpful feedback on `kind='no_answer'`, reported as count and
  rate over no-answer eligible answers
- wrong-intent signal: unhelpful feedback containing `wrong_intent`, joined through `request_id`
  to request observability intent summary

## Success Criteria

1. 登录用户只能给自己 conversation 内的 assistant message 提交或修改反馈。
2. user message、missing message、cross-user message、orphan request 与 deleted trailing
   message 都 fail closed。
3. public-chat-web 展示 copy / helpful / unhelpful action，且不会调用 donor `/api/vote`。
4. 反馈写入不会复制 raw prompt、raw answer、provider response 或 retrieval payload。
5. 用户可以通过 DELETE 撤回自己的反馈，撤回后不计入 v1 feedback metrics。
6. operator quality summary 至少能展示 helpful rate、unhelpful rate、feedback coverage。
7. operator drilldown / export 能定位 requestId、conversationId、messageId、intent/capability
   summary 与 feedback reason，不暴露超范围内容。
8. eval / drift 流程能消费 negative feedback case set，用于人工标注 false positive /
   false negative / wrong intent。
9. docs 与 route exposure inventory 明确 route caller class、admission 与 boundary。
10. app-api、public-chat-web、operator query 与 worker proxy tests 覆盖主路径和 fail-closed
   情况。

## Canonical Entry

- `.planning/workstreams/public-chat-answer-feedback-quality-signals/README.md`
