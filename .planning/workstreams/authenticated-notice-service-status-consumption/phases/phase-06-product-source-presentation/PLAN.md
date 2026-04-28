---
doc_type: plan
status: implemented
created: 2026-04-28
updated: 2026-04-28
phase: Phase 6
workstream: authenticated-notice-service-status-consumption
---
# Phase 6 Plan: Product Source Presentation

<!-- markdownlint-disable MD013 -->

## Goal

收口 public-chat/app-api 的 service status 答案表达和来源展示，让用户看到可执行状态、
有效时间和来源通知，而不是内部 release/read-model/debug 字段。

## Tasks

1. Review app-api structured answer normalization for `service_status_lookup`.
1. Render clear Chinese answers.
   - service name
   - observed status label
   - effective window
   - concise status note
   - source notice card
1. Hide technical details.
   - No release id in user text.
   - No raw internal locator in user text.
   - No PG/read-model/current-pointer naming.
1. Preserve operator observability.
   - Internal source refs may remain in safe trace/observability fields, not
     browser prose.
1. Add app-api/browser-facing tests for resolved, not found, fail-close and
   source conflict paths.

## Expected Artifacts

- Updated `apps/app-api/src/modules/runtime-command/service/normalize.ts`
- Updated app-api tests
- Optional public-chat component/card update if current source card cannot
  express service status

## Acceptance Criteria

- Chinese product text is user-facing and action-oriented.
- Source presentation is low-noise and source-linked.
- Technical details are hidden from public answer prose.
- Fail-close answers do not pretend the service is open/closed.

## Verification

```bash
pnpm web:test -- --runInBand \
  apps/app-api/test/chat-command.service.core.structured.suite.ts
```

```bash
pnpm web:lint
```
