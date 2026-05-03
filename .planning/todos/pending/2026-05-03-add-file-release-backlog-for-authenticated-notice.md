---
created: 2026-05-03T00:00:00+08:00
title: Add file-release backlog for authenticated notice
area: planning
files:
  - docs/plans/archive/completed/authenticated-notice-file-release-owner-recovery.md:12-15
  - .planning/workstreams/authenticated-notice-file-release-owner-recovery/STATE.md:23-36
  - .planning/workstreams/historical-regulation-denominator-expansion/evidence/phase-05-school-level-inventory/hold-backlog.json:70-99
---

## Problem

`351119` 的 regulation 正文不在当前 notice body 里，而是在信息门户的 `file_release` surface。当前工作流已经确认 `authenticated-notice-file-release-owner-recovery` 关闭，且 `351119` 被显式 excluded；但后续如果要重新评估这条差旅费管理办法，必须先恢复对 `信息门户-文件发布` 的登录态采集/owner recovery 入口。

## Solution

把“信息门户-文件发布 / file_release owner recovery”作为显式 backlog 项保留，后续在有登录态时重新采集对应 file_release source bytes，再决定是否重新开放 `351119` 的 regulation recovery。
