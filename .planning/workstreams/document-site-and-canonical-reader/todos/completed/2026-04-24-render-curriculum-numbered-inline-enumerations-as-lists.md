---
created: 2026-04-24T16:02:00.000Z
title: Render curriculum numbered inline enumerations as lists
area: docs
files:
  - apps/public-docs/scripts/sync-real-docs/curriculum.ts
  - apps/public-docs/docs/curriculum-plan/中央民族大学通识课程-大学体育-课程教学计划.mdx
  - apps/public-docs/docs/curriculum-plan/法学本科第二学士学位人才培养方案.mdx
---

## Problem

Some curriculum-plan pages contain dense inline numeric enumerations such as
`(1) 第一层次 ...;(2) 第二层次 ...;(3) 第三层次 ...` or long requirement paragraphs mixing
`(一)(二)(三)` clauses in one rendered paragraph. Live examples were observed in
`中央民族大学通识课程 “大学体育”课程教学计划` and `法学本科第二学士学位人才培养方案`.

These are structured lists in the source document, but public-docs currently renders them as dense
prose, reducing scanability on both desktop and mobile.

Additional live samples reproduced the same pattern in `哲学类本科人才培养方案` and
`电子信息类本科人才培养方案`, including long `(1)...;(2)...;(3)...` goal / practice requirement
paragraphs under curriculum-plan content.

## Solution

Add curriculum generator normalization for inline numbered / parenthesized enumerations. Split safe
multi-clause sequences into readable Markdown list blocks or separated list-like paragraphs.

The rule should be separate from the handbook enumeration rule because curriculum content has
different surrounding heading and table patterns. It must avoid splitting ordinary parenthetical
course names, program names, or explanatory phrases that are not list markers.
