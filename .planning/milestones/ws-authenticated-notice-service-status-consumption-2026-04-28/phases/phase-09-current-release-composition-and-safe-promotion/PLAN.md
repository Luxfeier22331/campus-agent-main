---
doc_type: plan
status: implemented
created: 2026-04-28
updated: 2026-04-28
phase: Phase 9
workstream: authenticated-notice-service-status-consumption
---
# Phase 9 Plan: Current Release Composition And Safe Promotion

<!-- markdownlint-disable MD013 -->

## Goal

把 Phase 7 已发布的 live current truth 和 Phase 8 发现的当前有效
service-status candidate 收口为可安全 promote 的完整 current release。

Phase 9 不再用 selected preview bundle 直接覆盖 current truth，而是建立
current-release composition 规则：只把当前有效、边界明确、可 typed materialize
的 service-status records 组合成完整 release，再写入 PostgreSQL current read
model，并通过 runtime/product path 验证多条 current service status 可消费。

## Non-Goals

- 不吸收 schedule、regulation、service guide、contact-directory 或 generic
  notice-query 工作。
- 不把 Phase 8 的 historical preview bundle 直接 promote 为 current truth。
- 不重开 `notice-consumption-layer` 的基础 admission 设计。
- 不让 runtime query-time scan raw notice body。

## Tasks

1. Define current-release composition semantics.
   - 明确 current release 的输入只能来自当前有效
     `campus_services/service_status_candidate`。
   - 明确 historical as-of preview 继续保留为证据，不进入 current release。
   - 明确 selected preview、stage、promote 三种模式对 PG current pointer 的影响。
1. Build a current-effective candidate selection gate.
   - 从 `notice_consumption_projection` 读取 ready service-status candidates。
   - 用 materializer 的 `effective_from/effective_until` 过滤当前有效 records。
   - 对缺失窗口、过期窗口、边界不清的候选 fail closed，并记录 rejected-source
     evidence。
1. Compose a complete current service-status release.
   - 至少包含 Phase 7 `355650` 当前 live facility truth。
   - 如果 `354845` 在当前锚点有效，则纳入同一 release。
   - 不因 Phase 8 historical samples 替换或删除现有 current truth。
1. Stage before promote.
   - 先生成 versioned artifact、validation summary、release manifest 和
     rejected-source report。
   - stage 不移动 PG current pointer。
   - stage evidence 必须能证明候选集合、materialized records 和 rejected sources。
1. Promote and verify read model.
   - promote 后验证 PG release catalog/current pointer/read model。
   - 验证 `service_status_lookup` 对多 subject 的当前查询。
   - 验证 app-api/public-chat 中文答案不暴露 raw locator、release id 或
     `2099` sentinel。
1. Capture rollback/restore evidence.
   - 记录 promote 前 current release id。
   - 明确如何恢复上一版 current pointer。
   - 不把 rollback 当作默认执行，只作为可审计恢复路径。

## Expected Artifacts

- `evidence/phase-09-current-release-composition-and-safe-promotion/current-candidate-audit.json`
- `evidence/phase-09-current-release-composition-and-safe-promotion/current-composition-plan.json`
- `evidence/phase-09-current-release-composition-and-safe-promotion/service-status-current-stage/`
- `evidence/phase-09-current-release-composition-and-safe-promotion/service-status-current-promote/`
- `evidence/phase-09-current-release-composition-and-safe-promotion/pg-current-read-model-smoke.json`
- `evidence/phase-09-current-release-composition-and-safe-promotion/supervisor-service-status-multi-current-smoke.json`
- `evidence/phase-09-current-release-composition-and-safe-promotion/app-api-public-chat-multi-current-smoke.json`
- `phases/phase-09-current-release-composition-and-safe-promotion/SUMMARY.md`

## Acceptance Criteria

- Current release composition 不使用 Phase 8 historical selected preview 直接覆盖
  current truth。
- Current release 至少保留已验证的 `355650`，并按当前有效性决定是否纳入
  `354845`。
- Promote 前有 stage evidence；stage 不移动 PG current pointer。
- Promote 后 PG current read model、supervisor `service_status_lookup` 和
  app-api/public-chat product answer 都能消费多条 current service-status truth。
- 用户可见答案隐藏 raw notice locators、release ids 和 `2099` sentinel。
- 被拒绝或未纳入 current 的候选都有可审计原因。

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_notice_derived_service_status_materialization \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_structured_projection_postgres \
  tests.agent.test_campus_services_agent
```

```bash
go test ./internal/runtimepolicy ./internal/structuredplanning ./internal/structuredquery ./internal/httpapi
```

Run Go verification from `apps/supervisor-api`.

```bash
pnpm --dir apps/app-api test:node -- \
  chat-command.service.core.structured.suite.ts \
  supervisor-adapter.response.suite.ts
```
