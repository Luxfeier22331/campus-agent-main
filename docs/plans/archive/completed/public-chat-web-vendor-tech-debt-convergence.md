---
doc_type: plan
status: completed
created: 2026-04-10
updated: 2026-04-20
---

# Public Chat Web Vendor Tech Debt Convergence

## Completion Note

这条 `public-chat-web` donor debt convergence 已关闭。
它完成的是 strict donor parity closeout 之后的 vendor debt 收口，不再作为当前默认执行入口。

## What This Plan Closed

- 固定 `donor reset + exact-specifier adapter + whitelist shrink` 方向
- 把 repo-owned runtime 差异从 vendor runtime 文件中继续收回
- 让 strict parity closeout 与后续 donor debt 收口退出默认 active 入口

## Current Canonical Entry

- `docs/architecture/current-architecture.md`
- `docs/reference/public-chat-web-donor-diff-classification.md`
- `docs/reference/public-chat-web-donor-parity-review-checklist.md`
- `docs/plans/README.md`
- `.planning/WORKSTREAMS.md`

## Reopen Rule

只有在 donor upgrade、新的 accepted product diff，或 exact compat seam 再次出现结构性漂移时，才应新开 follow-up lane。
