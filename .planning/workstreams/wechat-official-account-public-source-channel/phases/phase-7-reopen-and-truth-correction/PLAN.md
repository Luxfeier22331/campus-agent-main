---
phase: "7"
name: "Reopen And Truth Correction"
status: completed
created: 2026-04-28
updated: 2026-04-30
---

# Phase 7 Plan

## Goal

撤回此前把 FeedWe detail/download 当作正文 truth 的 closeout，重新固定
`FeedWe discovery -> real mp.weixin page capture -> canonical source-truth`
为唯一 accepted chain。

## Scope

- 更新 README / ROADMAP / STATE / REQUIREMENTS 中的 reopened truth。
- 记录 FeedWe detail、download、download-local 只提供 metadata、摘要或占位 HTML。
- 明确 FeedWe 只做 discovery provider，不做 canonical body owner。
- 明确真实正文采集边界是 `mp.weixin.qq.com/s/...` 页面。

## Verification

- planning 文档中不再把 FeedWe summary/download 作为正文投影 owner。
- reopened phases 8-12 接续到真实页面采集和 notice consumption。
