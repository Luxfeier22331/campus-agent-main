---
doc_type: index
status: active-blocked
created: 2026-04-22
updated: 2026-04-25
---

# Workstream: Authenticated Notice Live Portal Control Plane

这是 `authenticated-notice-live-portal-control-plane` 的 native workstream 入口。
它负责 authenticated source-channel 的 live portal capture、scheduler、run ledger、artifact refs 与 bounded control-plane；当前已从 deferred 恢复到 auth-readiness 收口。
恢复后还需显式收口一类已知 capture gap：正文声明存在附件，但 detail payload / source-truth 未 materialize 出任何附件实体或 attachment ref。

## Current Status

- status: `active-blocked`
- current blocker: 当前候选 `SSO_TGC` 已能 seed collector storage state，但真实 `auth:check` 返回 `auth-expired: session invalid`；需要重新复制当前有效的 `SSO_TGC@.muc.edu.cn`
- reopen rule: 认证窗口恢复，或产品范围决定恢复 source-channel live portal scheduling / authenticated control-plane

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- superseded plan snapshot: `../../../docs/plans/archive/superseded/authenticated-notice-live-portal-control-plane.md`
