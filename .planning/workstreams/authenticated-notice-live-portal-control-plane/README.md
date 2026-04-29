---
doc_type: index
status: completed
created: 2026-04-22
updated: 2026-04-26
---

# Workstream: Authenticated Notice Live Portal Control Plane

这是 `authenticated-notice-live-portal-control-plane` 的 native workstream 入口。
它负责 authenticated source-channel 的 live portal capture、collector run admission、run
ledger、artifact refs、live-historical reconcile 与 bounded operator control-plane。
本轮已完成 closeout：正文内联图片漏采集已修复，notice-type live policy 已从单一办公通知补宽到 7 个默认启用类型，collector run ledger、exported bundle/manifest artifact refs、run admission、reconcile 与 operator status 均已进入 repo-owned path。

## Current Status

- status: `completed`
- current position: repo-owned authenticated notice live capture/control-plane closeout complete
- latest live import: widened incremental authenticated notice export succeeded through the trusted proxy path; notice source-truth import and PG inventory sync succeeded for the 282-notice widened slice
- latest capture truth: `source_truth_inventory_entries=282`, `attachment_ref_total=311`, `attachment_fetch_status_record_count=332`, `missing_fetch_status_attachment_refs=0`, `extra_fetch_status_attachment_refs=21`, `status_counts={collected_internal:329, terminal_unavailable:3}`
- reference-only truth: `reference_only_attachment_count=20`, `object_backed_inline_image_reference_only=20`, `action_required_count=0`
- unsupported terminal truth: `unsupported_notice_count=1`, `unsupported_binary_count=1` for notice `355493` attachment `优秀毕业生相关报送材料.zip`; it is recorded as `unsupported_binary`, not `reference_only`
- collector run admission: incremental/backfill require enabled notice types; selected mode requires selected notice ids; export manifest records admitted scope and page budget
- live-historical reconcile: repo-owned CLI reports fetch-status missing/extra refs and body-declared attachment owner-expectation mismatches
- bounded operator status: repo-owned CLI aggregates inventory, reconcile, reference-only explanation, unsupported binary count, multimodal count, and latest collector run ledger when configured
- remaining work: none inside this workstream; future product/API scheduler work should be opened separately

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- superseded plan snapshot: `../../../docs/plans/archive/superseded/authenticated-notice-live-portal-control-plane.md`
