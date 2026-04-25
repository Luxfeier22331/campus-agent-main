---
doc_type: index
status: active
created: 2026-04-22
updated: 2026-04-25
---

# Workstream: Authenticated Notice Live Portal Control Plane

这是 `authenticated-notice-live-portal-control-plane` 的 native workstream 入口。
它负责 authenticated source-channel 的 live portal capture、scheduler、run ledger、artifact refs 与 bounded control-plane；当前已从 deferred 恢复并完成本轮 auth-readiness / live capture truth refresh。
本轮已补齐正文内联图片漏采集，不再把 `<img src>` 附件静默写成“无附件”；collector run ledger 与 exported bundle/manifest artifact refs 已进入 repo-owned path。

## Current Status

- status: `active`
- current position: fresh authenticated notice export succeeded through the trusted proxy path; notice source-truth import and PG inventory sync succeeded for the refreshed 60-notice slice; selected refresh resolved the remaining retriable attachment rows
- latest capture truth: `source_truth_inventory_entries=71`, `attachment_ref_total=101`, `attachment_fetch_status_record_count=101`, `status_counts={collected_internal:98, terminal_unavailable:3}`
- reference-only truth: `reference_only_attachment_count=9`, `object_backed_inline_image_reference_only=6`, `terminal_unavailable=3`, `action_required_count=0`
- remaining work: scheduler admission and bounded operator control-plane are still open workstream phases

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- superseded plan snapshot: `../../../docs/plans/archive/superseded/authenticated-notice-live-portal-control-plane.md`
