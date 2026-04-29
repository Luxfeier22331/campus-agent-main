---
created: 2026-04-24T15:44:09.342Z
title: Promote curriculum specialty graduation requirement markers to headings
area: docs
files:
  - apps/public-docs/scripts/sync-real-docs/curriculum.ts
  - apps/public-docs/docs/curriculum-plan/计算机类本科人才培养方案.mdx
---

## Problem

In generated curriculum-plan pages, markers such as `计算机科学与技术专业毕业要求:`,
`数据科学与大数据技术专业毕业要求:` and `软件工程专业毕业要求:` currently render as plain
paragraphs. They visually look like body text even though they start a new specialty-specific
content block under `## 二、毕业要求`.

This is a general reader hierarchy requirement, not only a single-page cosmetic defect: when a
short curriculum marker clearly starts the next content block, the public-docs generator should
preserve that boundary as reader structure instead of relying on body-text styling.

## Solution

Teach the public-docs curriculum generator to recognize specialty graduation requirement markers
matching the `...专业毕业要求:` / `...专业毕业要求：` pattern and emit them as `###` headings with
the trailing colon removed. This should be a semantic generator fix, not a CSS-only bolding patch,
so the reader outline, anchors and accessibility tree reflect the content hierarchy.

Do not apply the same rule to table captions such as `表 1 ...支撑关系矩阵`; table captions should
be handled by a separate caption styling/normalization rule.
