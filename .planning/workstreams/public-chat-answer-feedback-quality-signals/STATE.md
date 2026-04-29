---
doc_type: state
status: backlog
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# State: Public Chat Answer Feedback And Quality Signals

## Current Status

- status: `backlog`
- current slice: planning only
- owner: unassigned
- active implementation: no
- next phase if activated: `Phase 0: Scope And Contract Freeze`

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

## Blockers

- 需要 Phase 0 冻结 route shape、feedback enum、reason codes、comment 是否开放与删除语义。
- 需要确认 operator quality 当前 store / API 是否已有足够 join 字段支持 feedback aggregate。
- 需要确认 public-chat-web 当前 vendor compatibility 类型是否要保留 `Vote` 兼容层或重命名成
  repo-owned `AnswerFeedback` 类型。

## Verification

- 本 workstream 当前只完成 planning 文件落盘；未执行功能实现验证。
- 激活后第一批验证应覆盖：
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
