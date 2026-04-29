---
phase: "12"
name: "Replay, Drift Guard, And Acceptance Closeout"
status: completed
created: 2026-04-28
updated: 2026-04-30
---

# Phase 12 Plan

## Goal

完成 reopened WeChat chain 的 replay、drift guard、live smoke 和收口证据。

## Scope

- Add parser regression fixtures for real page, verification page, and modern
  shell page shapes.
- Run live FeedWe discovery plus real `mp.weixin` capture.
- Project selected source-truth refs through the normal notice consumption path.
- Run optional multimodal drain and runtime smoke.
- Audit historical state and produce explicit repair selection evidence.
- Close planning truth and move the workstream to completed.

## Acceptance Gates

- Collector tests pass.
- Live capture writes real page/source-truth/media objects.
- Projection dry-run and write path do not open query serving prematurely.
- Multimodal drain records attempts for pending rows.
- Runtime smoke reports `ok=true`.
- Historical state audit has `suspect_unit_count=0`.
