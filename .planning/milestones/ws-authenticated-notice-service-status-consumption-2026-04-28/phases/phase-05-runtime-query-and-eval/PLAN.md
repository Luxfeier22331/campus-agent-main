---
doc_type: plan
status: implemented
created: 2026-04-28
updated: 2026-04-28
phase: Phase 5
workstream: authenticated-notice-service-status-consumption
---
# Phase 5 Plan: Runtime Query And Eval

<!-- markdownlint-disable MD013 -->

## Goal

让 `service_status_lookup` 对新的 service-status read model 具备稳定查询、消歧、
current-effective 过滤与 fail-close regression。

## Tasks

1. Extend Go runtime record model if schema fields changed.
1. Improve subject matching.
   - Match service family, aliases, campus scope, location refs, platform refs
     and search text.
   - Preserve clarification when multiple current subjects match.
1. Strengthen temporal semantics.
   - Current/latest defaults to current effective window.
   - Expired matching records return
     `temporarily_unverifiable/current_effective_miss`.
   - Explicit `as_of` remains bounded by contract.
1. Strengthen conflict handling.
   - Same subject + overlapping effective window + conflicting status/note =>
     `source_conflict`.
   - More recent/narrower override wins only when not conflicting.
1. Add eval/golden cases.
   - 图书馆今天开不开
   - 信息门户是否维护
   - 一卡通/校园网/VPN 是否暂停
   - 某楼/自习室/场馆是否开放
   - 综合服务大厅/校医院假期服务时间
   - schedule-owned and guide-owned negative cases

## Expected Artifacts

- Updated `apps/supervisor-api/internal/structuredquery/service_status*.go`
- Updated runtime fixtures/tests
- Updated `packages/evals` cases if release gate needs denominator expansion

## Acceptance Criteria

- Runtime only reads PG current release + typed read model.
- New service families are queryable without raw notice scan.
- Ambiguous/conflicting/currentness-missing paths fail closed.
- Negative cases do not route to service status incorrectly.

## Verification

```bash
uv run --all-packages python -m unittest tests.agent.test_campus_services_agent
```

```bash
go test ./apps/supervisor-api/internal/structuredquery \
  ./apps/supervisor-api/internal/httpapi
```

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile campus-services-product-path \
  --json
```
