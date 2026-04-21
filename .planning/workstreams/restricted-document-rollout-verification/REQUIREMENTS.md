---
doc_type: requirements
status: deferred
created: 2026-04-19
updated: 2026-04-22
---

# Requirements: Restricted Document Rollout Verification

## Goal

在 canonical authz truth 已冻结的前提下，完成 restricted collection rollout、surface behavior、allow/deny matrix 与 leakage-hardening verification。

## In Scope

- authorization / release posture truth
- restricted collection and retrieval rollout
- public / operator / service surface behavior
- verification 与 leakage-hardening evidence

## Non-goals

- 重开 identity / authz foundation ownership
- 先召回后裁剪的 restricted retrieval
- 把 rollout 拆成 principal / collection / surface / verification 多条并发线

## Success Criteria

1. 参与 rollout 的 principal / entitlement / visibility 语义明确。
2. restricted collection / release posture 与 surface behavior 一致。
3. restricted retrieval 保持 candidate-pre-filter + fail-close。
4. allow/deny behavior、evidence 暴露边界与 operator/service 口径同时收口。

## Canonical Entry

- `.planning/workstreams/restricted-document-rollout-verification/README.md`
