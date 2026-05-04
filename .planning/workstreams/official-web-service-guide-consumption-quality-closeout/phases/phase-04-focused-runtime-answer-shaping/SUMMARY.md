---
doc_type: summary
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 4 Summary

## Delivered

- extended `apps/supervisor-api/internal/structuredplanning/planner_test.go` with explicit
  `service_guide_lookup` focus routing cases for:
  - `校园卡补办办公时间是什么` -> `office_hours`
  - `校园卡补办哪些人能办` -> `eligibility`
- corrected `campus_services` planner precedence in
  `apps/supervisor-api/internal/structuredplanning/planner.go`:
  - explicit `service_guide` focuses such as `entry` / `required_materials` / `office_hours` /
    `eligibility` now preempt broad `service_status` keyword hits
  - service-guide procedure/contact questions still retain the final service-guide fallback instead
    of dropping to `nil`
  - contact-directory questions like `信息公开联系电话是多少` still route to
    `contact_directory_lookup`
- hardened Python answer shaping in
  `packages/campus-services-agent/src/campus_services_agent/tool_adapter.py`:
  - procedure focus now renders canonical `procedure_groups`
  - compatibility `guide_sections.procedure` with the same selected section id is suppressed, so
    VPN grouped procedure answers no longer render duplicate install content
- extended browser-surface regression in
  `apps/app-api/test/chat-command.service.core.structured.suite.ts` so the VPN product answer keeps
  one focused install answer even when the runtime result carries both `procedure_groups` and
  compatibility `guide_sections`

## Answer Examples Closed

- `VPN客户端怎么安装`
  - returns only the selected client-install procedure group
  - does not repeat the same procedure from compatibility `guide_sections`
  - does not include unrelated direct-login/mobile branches
- `校园卡补办办公时间是什么`
  - now plans to `service_guide_lookup` with `guide_focus=office_hours`
- `校园卡补办哪些人能办`
  - now plans to `service_guide_lookup` with `guide_focus=eligibility`

## Verification

```bash
cd apps/supervisor-api && go test ./internal/structuredplanning ./internal/structuredquery
pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.core.structured.test.ts
```
