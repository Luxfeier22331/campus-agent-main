---
doc_type: phase-summary
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 2 Summary: Positive Routing And Handoff Matrix

## Scope

Phase 2 added deterministic product-path acceptance coverage for campus-services
positive routing.

The harness path is:

`public-chat-web -> app-api /api/chat/requests -> buildChatCommandService`

Then:

`buildChatCommandService -> SupervisorExecutionClient`

The supervisor execution client remains a deterministic test double in this
phase. This phase proves the public/chat product path carries selected
campus-services prompts into the app-api handoff and persists the expected
finalized request truth. It does not claim live model routing or staging
readiness.

## Implemented

`apps/public-chat-web/test/worker.test.ts` now covers four positive routing cases:

- `service_status_lookup`: 丰台校区通勤班车在哪里上车
- `transport_schedule_lookup`: 2月24日丰台回海淀最早的班车是几点
- `service_guide_lookup`: 地铁接驳车怎么预约
- `contact_directory_lookup`: 研究生院办公室电话是多少

For each case, the test asserts:

- public-chat-web proxies the request into app-api and receives a browser-safe
  answer envelope
- app-api calls supervisor with `surface=public_chat_web` and the original prompt
- public chat does not force an explicit browser `requestedCapability`
- selected target is `campus-services-agent`
- structured result contains `allowed_tools`, `payload_kind`, `target`, and
  tool-specific result fields
- finalized request projection records `selectedTarget=campus-services-agent`,
  `status=completed`, `surface=public_chat_web`, and diagnostics summary

## Boundary

Phase 2 did not:

- expose raw supervisor responses on the browser-facing chat contract
- call staging services or real PostgreSQL
- rebuild source-truth projections
- change supervisor planner internals
- open a production rollout flag

## Verification

Focused commands run during Phase 2:

```bash
pnpm --dir apps/public-chat-web test:worker -- --runInBand test/worker.test.ts
```

```bash
WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1 \
XDG_CONFIG_HOME=./.wrangler-home \
pnpm exec vitest run test/worker.test.ts
```

Result: the worker test lane passed after the matrix was added. The package
script currently forwards the extra arguments through Vitest's `--` delimiter,
so the first run executed the public-chat-web worker suite rather than only
`test/worker.test.ts`. The second command is the targeted rerun.

## Next

Phase 3 should validate answer rendering and source trace acceptance on top of
this matrix:

- final answer text must be derived from structured result facts
- source refs / notice refs / contact source refs must render safely
- public answers must not leak release ids, projection internals, raw parser
  state, or debug-only fields
