---
doc_type: requirements
status: deferred
created: 2026-04-19
updated: 2026-04-27
---

# Requirements: Restricted Document Surface Rollout Verification

## Goal

在 canonical authz truth 已冻结的前提下，只有当产品范围显式打开 restricted
用户可见 surface 时，完成 release posture、surface behavior、allow/deny matrix 与
leakage-hardening verification。

## In Scope

- restricted surface opening admission
- 参与 rollout 的 principal / entitlement / visibility projection
- restricted collection / reader / query / download release posture
- public / operator / service surface allow/deny behavior
- retrieval candidate pre-filter、fail-close 与 deny-path no-leak evidence
- authenticated document center、restricted reader 或 restricted retrieval 被提升到真实用户路径时的
  rollout verification

## Non-goals

- 重开 identity / authz foundation ownership 或 `app-api` canonical authz ownership
- `campus_notices/internal_notice` source-triage、离线 preparation、owner recovery 或
  authenticated notice collector work
- notice-derived regulation downstream materialization
- public static document reader / public docs shell
- 先召回后裁剪的 restricted retrieval
- 把 Better Auth 登录态、Cloudflare Access 或 prompt-only filtering 当作 restricted data
  authorization

## Success Criteria

1. 参与 rollout 的 principal / entitlement / visibility 语义明确。
2. restricted collection / reader / query / download release posture 与 surface behavior 一致。
3. restricted retrieval 保持 candidate-pre-filter + fail-close。
4. allow/deny behavior、evidence 暴露边界与 operator/service 口径同时收口。
5. 未授权路径不泄露 restricted title、snippet、citation、anchor 或 existence hint。

## Canonical Entry

- `.planning/workstreams/restricted-document-rollout-verification/README.md`
