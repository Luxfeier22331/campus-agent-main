---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Focused Runtime Answer Shaping

## Goal

Make `service_guide_lookup` answer the requested facet rather than dumping the full service guide.

## Inputs

- Phase 1 `SUMMARY.md`
- Phase 3 `SUMMARY.md`
- `apps/supervisor-api/internal/structuredplanning/planner.go`
- `apps/supervisor-api/internal/structuredplanning/planner_test.go`
- `apps/supervisor-api/internal/structuredquery/service_guide.go`
- `packages/campus-services-agent/src/campus_services_agent/tool_adapter.py`
- `packages/campus-services-agent/src/campus_services_agent/http_query_service.py`

## Tasks

1. Extend supervisor planner tests before answer rendering:
   - `入口在哪里` -> `entry`
   - `怎么安装` / `怎么使用` -> `procedure`
   - `需要什么表` / `需要哪些材料` -> `required_materials`
   - `电话是多少` -> `contact`
   - `办公时间` / `办理时间` -> `office_hours`
   - `哪些人能办` -> `eligibility`
   - `完整流程` -> `full_guide`
2. Implement focused section selection in Go query service or campus-services-agent according to
   Phase 1 contract ownership.
3. Carry selected and omitted section metadata in structured result details.
4. Render focused answers:
   - entry questions return entry refs and source
   - procedure questions return only matching procedure group(s)
   - material questions return materials/forms and source
   - missing requested facet returns source-not-provided semantics
5. Keep `full_guide` as the only path allowed to return a broad summary.

## Acceptance Criteria

- `VPN入口在哪里` returns the VPN entry URL and does not include client/mobile install steps.
- `VPN客户端怎么安装` returns client-install steps and not direct-login/mobile-only steps.
- `邮箱申请需要什么表` returns form/material information and source.
- `信息公开怎么申请` returns procedure information without unrelated contact dump unless requested.
- `校园卡丢了怎么办` returns relevant guide facts without unrelated full-guide content.
- Planner focus tests fail if the focus classifier drifts.

## Verification

```bash
go test ./internal/structuredplanning ./internal/structuredquery ./internal/httpapi
uv run --all-packages python -m unittest tests.supervisor.agent_dispatch_suite
uv run --all-packages ruff check packages/campus-services-agent
```

## Done Summary Template

When complete, write `SUMMARY.md` with:

- focus routing cases
- selection ownership decision
- answer examples
- missing-facet behavior
- verification evidence
