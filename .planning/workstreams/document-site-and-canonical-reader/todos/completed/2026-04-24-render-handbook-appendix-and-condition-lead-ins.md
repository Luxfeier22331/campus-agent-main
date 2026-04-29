---
created: 2026-04-24T16:04:00.000Z
title: Render handbook appendix and condition lead-ins
area: docs
files:
  - apps/public-docs/scripts/sync-real-docs/handbook.ts
  - apps/public-docs/docs/student-handbook/中央民族大学学生公费医疗管理办法.md
---

## Problem

Some student-handbook pages contain short lead-in labels that introduce a following condition,
procedure, responsibility or item list, but public-docs renders them as ordinary body paragraphs. A
live sample in `中央民族大学学生公费医疗管理办法` shows
`附:有下列情况之一者,不属于享受公费医疗范围:` as plain prose.

Additional live samples in `中央民族大学本科创新教育实施办法` include
`校级本科生学科竞赛计划项目主要包括:`, `立项申请与审批程序:`, `院、系具体职责是:`,
`指导教师的职责是:`, `教务处负责:` and `院系负责:`. These are not chapter headings, but they
are stronger than ordinary body text and should visually bind to the list that follows.

This loses the appendix / condition-list boundary and makes the following content feel like a loose
paragraph sequence instead of a structured exception list.

## Solution

Teach the handbook generator to recognize bounded appendix, condition, procedure and responsibility
lead-ins, such as `附:有下列情况之一者...:` / `附：有下列情况之一者...：`,
`...程序:`, `...职责是:`, `...负责:` and `...主要包括:`, and render them as a stable label
block or semantic subheading before the following list content.

This rule should stay separate from the broader parenthesized-enumeration splitter. It must not
promote ordinary explanatory sentences that merely end with a colon.
