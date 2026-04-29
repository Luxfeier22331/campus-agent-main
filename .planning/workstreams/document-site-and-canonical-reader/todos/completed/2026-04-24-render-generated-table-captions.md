---
created: 2026-04-24T15:55:00.000Z
title: Render generated table captions
area: docs
files:
  - apps/public-docs/scripts/sync-real-docs/curriculum.ts
  - apps/public-docs/scripts/sync-real-docs/handbook.ts
  - apps/public-docs/theme/docs-ui.css
  - apps/public-docs/docs/curriculum-plan/计算机类本科人才培养方案.mdx
---

## Problem

Generated table titles such as `表 1 计算机科学与技术专业毕业要求对培养目标的支撑关系矩阵`
currently render as ordinary paragraphs. They are visually disconnected from the table that follows
and do not communicate "caption" semantics.

## Solution

Introduce a generator-level table-caption representation for lines matching bounded table-title
patterns such as `表 1 ...`. Render them as a caption-like block immediately associated with the
following table. This should not promote captions into outline headings, because table captions are
not section navigation entries.

Style captions consistently in `public-docs` so they are visually tied to the table without adding
noise to the right-side outline.
