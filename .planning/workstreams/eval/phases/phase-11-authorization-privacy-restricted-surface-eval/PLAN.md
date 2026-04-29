---
doc_type: phase_plan
phase: "11"
phase_name: "Authorization / Privacy / Restricted Surface Eval"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 11 Plan: Authorization / Privacy / Restricted Surface Eval

## Objective

建立 restricted notice/docs、identity projection、entitlement filter、artifact
redaction 与 sensitive payload minimization 的 regression eval。

## Entry Conditions

- restricted resource surface 或 restricted fail-close posture 已由对应
  architecture/domain workstream 固定。
- app-api / supervisor / retrieval 或 notice runtime 能投影 sanitized authorization
  summary。
- Phase 6 workflow trace artifact 已具备 fail-close 与 policy branch 字段。

## Scope

- 覆盖 unauthorized visibility、missing entitlement、restricted source family、closed
  capability 与 policy unavailable。
- 验证 eval artifacts、operator publish、quality candidate manifest 不含 raw JWT、
  cookies、auth envelope、raw transcript、provider raw response 或未经裁剪的
  restricted document payload。
- 建立 authz / privacy fixture 与 redaction guard tests。

## Non-Goals

- 不实现 identity provider、SSO、session 或 entitlement owner。
- 不把 ACL metadata carrier 当 canonical authorization truth。
- 不打开 restricted 用户可见 surface。

## Exit Criteria

- restricted/authz/privacy 失败可被 deterministic gate 发现。
- eval artifact minimization 有测试保护。
- release gate 能区分 restricted deny、scope closed、policy unavailable 与 ordinary
  no-hit。
