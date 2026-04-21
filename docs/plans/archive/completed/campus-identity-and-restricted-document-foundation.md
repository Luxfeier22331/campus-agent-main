---
doc_type: plan
status: completed
created: 2026-04-02
updated: 2026-04-20
---

# Campus Identity And Restricted Document Foundation

## Completion Note

这条 campus identity / restricted foundation 已关闭。
它完成的是 principal taxonomy、authorization projection 与 restricted retrieval fail-close 的 foundation 收口；当前前向工作已经转向 rollout / verification 与 legacy compatibility sunset。

## What This Plan Closed

- 固定 campus identity 与 restricted document 的基础授权边界
- 固定 allow/deny 与 projection-based retrieval posture
- 让 foundation 与后续 rollout / sunset workstream 解耦

## Current Canonical Entry

- `docs/domains/identity-authz-memory.md`
- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `.planning/workstreams/restricted-document-rollout-verification/README.md`
- `docs/plans/archive/historical/legacy-acl-carrier-compatibility-sunset.md`

## Reopen Rule

restricted rollout、legacy ACL sunset 或更复杂 IAM productization 应在各自 follow-up lane 推进，不再回到这份 foundation 计划。
