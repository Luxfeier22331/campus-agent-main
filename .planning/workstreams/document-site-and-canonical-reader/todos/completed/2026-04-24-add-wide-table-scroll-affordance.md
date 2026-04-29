---
created: 2026-04-24T15:55:00.000Z
title: Add wide table scroll affordance
area: docs
files:
  - apps/public-docs/theme/docs-ui.css
  - apps/public-docs/docs/curriculum-plan/社会学类本科人才培养方案.mdx
  - apps/public-docs/docs/curriculum-plan/计算机类本科人才培养方案.mdx
---

## Problem

Wide generated tables no longer create whole-page horizontal overflow, but many curriculum and
handbook tables still require inner horizontal scrolling. On mobile the table is scrollable, but the
UI gives little indication that more columns exist off-screen.

Live examples include `社会学类本科人才培养方案#1-通识教育` and multiple support-matrix / course-list
tables in `计算机类本科人才培养方案`.

## Solution

Add a low-noise scroll affordance for overflowing document tables. Options include a subtle trailing
fade, sticky first columns where safe, or a small "横向滑动查看更多" hint that only appears for
overflowing tables.

The implementation must preserve current no-page-overflow behavior and avoid making desktop table
reading worse.
