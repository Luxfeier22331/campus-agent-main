---
created: 2026-04-24T15:55:00.000Z
title: Promote curriculum requirement subsection labels
area: docs
files:
  - apps/public-docs/scripts/sync-real-docs/curriculum.ts
  - apps/public-docs/docs/curriculum-plan/计算机类本科人才培养方案.mdx
---

## Problem

Some curriculum-plan pages contain short colon-ended labels that start meaningful sub-blocks but
currently render as plain body paragraphs. Live examples from `计算机类本科人才培养方案` include
`学年论文要求:`, `综合实践要求:`, `毕业设计要求:`, `(2) 论文质量方面:`,
`计算机科学与技术专业拓展培养:` and `数据科学与大数据技术专业拓展培养:`.

Additional samples show adjacent cases such as `毕业五年后应达到的具体目标为:` and
`培养目标具体细化如下:` in `电子信息类本科人才培养方案`. These should be classified by the
generator as content-start labels, table/list lead-ins, or ordinary prose before rendering.

Further curriculum samples show the same plain-paragraph rendering for repeated course-list lead-ins
in `经济学本科人才培养方案`, `金融学本科人才培养方案`, `财政学本科人才培养方案`,
`统计学类本科人才培养方案`, `新闻传播学类本科人才培养方案`, `翻译本科人才培养方案`
and `民族学本科人才培养方案`, including variants such as `课程清单如下:`, `建议课程清单:`,
`建议课程清单如下:` and numbered lead-ins like `(1) 学科视野提升类课程共 4 门, 清单如下:`.

These labels are weaker than real headings but stronger than body text. When rendered as normal
paragraphs they disappear inside long curriculum content.

## Solution

Add a curriculum generator normalization rule for bounded, colon-ended subsection labels and render
them as semantic subheadings or a consistent label block under the current section. The rule should
be narrower than "any line ending in colon" and should avoid promoting ordinary lead-in sentences
such as `各级别大学英语课程在1-4学期课程安排如下:`.

The target behavior should be verified against `计算机类本科人才培养方案` around the practice
requirements and extension-training sections.
