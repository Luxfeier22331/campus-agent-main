---
doc_type: index
status: deferred
created: 2026-04-22
updated: 2026-04-27
---

# Workstream: Restricted Document Surface Rollout Verification

这是 `restricted-document-rollout-verification` 的 native workstream 入口。
它不再承载 identity / authz foundation，也不覆盖 `internal_notice` 的离线 source-triage、
regulation downstream materialization 或 public docs reader。

它只负责未来真正打开 restricted 用户可见 surface 时的 rollout verification：
restricted reader / query / download surface、app-api entitlement projection、retrieval
pre-filter、allow/deny matrix 与 leakage-hardening evidence。

## Current Status

- status: `deferred`
- reopen rule:
  产品范围显式决定打开 restricted 用户可见 surface，发布 restricted collection/query
  serving alias，或推进 authenticated document center / restricted reader / restricted
  retrieval 到真实用户路径时恢复

## Current Interpretation

- canonical identity / authorization ownership 已由 `app-api` 冻结，不在本 workstream 重开
- `campus_notices/internal_notice` 当前仍是 `restricted + offline_preparation`，不是已开放
  query-serving surface
- notice-derived regulation consumption、document reader public route 与 source-truth
  recovery 已分别由其它 workstream/docs 承接，不属于本条线
- 本条线保留为 future restricted surface opening guard，防止半开 surface、后置裁剪
  retrieval 或 deny-path 泄露

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- superseded plan snapshot: `../../../docs/plans/archive/superseded/restricted-document-rollout-and-verification.md`
