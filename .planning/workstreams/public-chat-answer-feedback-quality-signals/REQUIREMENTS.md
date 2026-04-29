---
doc_type: requirements
status: backlog
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
- optional unhelpful reason codes 与短 comment，必须限制长度、敏感字段与滥用面。
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

## Feedback Contract First Cut

第一版建议冻结为 answer-scoped feedback：

- target: assistant message
- route candidate:
  `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- vote values: `helpful`, `unhelpful`
- optional reason codes:
  - `wrong_intent`
  - `not_enough_detail`
  - `outdated_or_missing_source`
  - `incorrect_answer`
  - `unclear_or_hard_to_use`
  - `other`
- optional comment: length-limited, stored as user-provided feedback text, never used as
  authorization / routing truth
- idempotency: one latest feedback row per owner principal + assistant message
- delete/change: later `PUT` replaces the previous vote/reasons/comment; explicit delete is optional
  and should be decided in Phase 0

## Success Criteria

1. 登录用户只能给自己 conversation 内的 assistant message 提交或修改反馈。
2. user message、missing message、cross-user message、orphan request 与 deleted trailing
   message 都 fail closed。
3. public-chat-web 展示 copy / helpful / unhelpful action，且不会调用 donor `/api/vote`。
4. 反馈写入不会复制 raw prompt、raw answer、provider response 或 retrieval payload。
5. operator quality summary 至少能展示 helpful rate、unhelpful rate、feedback coverage。
6. operator drilldown / export 能定位 requestId、conversationId、messageId、intent/capability
   summary 与 feedback reason，不暴露超范围内容。
7. eval / drift 流程能消费 negative feedback case set，用于人工标注 false positive /
   false negative / wrong intent。
8. docs 与 route exposure inventory 明确 route caller class、admission 与 boundary。
9. app-api、public-chat-web、operator query 与 worker proxy tests 覆盖主路径和 fail-closed
   情况。

## Canonical Entry

- `.planning/workstreams/public-chat-answer-feedback-quality-signals/README.md`
