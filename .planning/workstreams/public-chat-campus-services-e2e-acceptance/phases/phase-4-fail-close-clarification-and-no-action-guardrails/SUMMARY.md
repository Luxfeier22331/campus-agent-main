---
doc_type: summary
status: accepted
created: 2026-04-27
updated: 2026-04-27
---

# Phase 4 Summary: Fail-close, Clarification, And No-action Guardrails

## Delivered

- `apps/public-chat-web/test/worker.test.ts` 新增 deterministic guardrail matrix，覆盖
  public/chat 产品路径上的 8 条负向与防执行提示词：
  - route/direction ambiguity -> `needs_clarification`
  - contact ambiguity -> `needs_clarification`
  - currentness/source-conflict -> `no_answer` fail-close
  - action prompts（预约/代提交/打电话/发邮件）-> 只读引导或显式 no-action blocked
- 断言维度包括：
  - browser-facing `result.kind` 与 runtime `requestExecution.status` 一致
  - `selectedTarget=campus-services-agent` 与 `allowed_tool/payload_kind` 稳定
  - fail-close/clarification 文案不回退到 generic retrieval 猜测文案
  - no-action prompts 不产生执行承诺文案
  - 非 completed 终态不产出 `campus_service_trace_cards`，completed 终态继续产出 trace cards

## Verification

- `pnpm --dir apps/public-chat-web test:worker -- --runInBand test/worker.test.ts`
- `pnpm --dir apps/app-api test:node -- --runInBand test/chat-command.service.core.structured.suite.ts`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm exec biome check apps/public-chat-web/test/worker.test.ts`
