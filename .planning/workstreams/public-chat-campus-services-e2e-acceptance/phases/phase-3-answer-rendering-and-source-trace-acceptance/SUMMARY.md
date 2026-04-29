---
doc_type: summary
status: accepted
created: 2026-04-27
updated: 2026-04-27
---

# Phase 3 Summary: Answer Rendering And Source Trace Acceptance

## Delivered

- Completed answer text for `campus-services-agent` now prefers structured `tool_result` facts over
  upstream free-form `answerText`.
- Covered rendered fact families:
  - `service_status_lookup`: `status_note` + `operational_notices`
  - `transport_schedule_lookup`: departure time + route direction
  - `service_guide_lookup`: guide sections + entry refs
  - `contact_directory_lookup`: contact points + location refs
- Source evidence is now rendered as safe source categories (e.g. `校内通知` / `学校官网` /
  `服务目录`) instead of exposing raw source ref ids.
- Browser-facing completed responses reject leakage from upstream polluted text
  (`release_id`, `projection_internal_state`, raw ref ids, debug parser markers).

## Verification

- `pnpm exec biome check --write apps/app-api/src/modules/runtime-command/service/normalize.ts apps/app-api/src/modules/runtime-command/service/writes.ts apps/app-api/test/chat-command.service.core.structured.suite.ts apps/public-chat-web/test/worker.test.ts`
- `pnpm --dir apps/app-api test:node -- --runInBand test/chat-command.service.core.structured.suite.ts`
- `pnpm --dir apps/public-chat-web test:worker -- --runInBand test/worker.test.ts`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/public-chat-web typecheck`
