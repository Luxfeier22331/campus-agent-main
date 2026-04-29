---
created: 2026-04-24T15:55:00.000Z
title: Render handbook parenthesized enumerations as lists
area: docs
files:
  - apps/public-docs/scripts/sync-real-docs/handbook.ts
  - apps/public-docs/docs/student-handbook/中央民族大学学生管理规定.md
  - apps/public-docs/docs/student-handbook/中央民族大学本科学生综合素质测评办法.md
---

## Problem

Student handbook articles currently render Chinese parenthesized enumerations such as
`(一) ...; (二) ...; (三) ...` as dense body paragraphs. Examples observed in live docs include
`中央民族大学学生管理规定` 第四条 / 第五条 and `中央民族大学本科学生综合素质测评办法` 第十一条 /
第二十三条. The content is legally structured list content, but the public docs page presents it as
undifferentiated prose.

Additional live samples from the next audit batch reproduced the same defect in
`中央民族大学本科学生学籍管理办法`, `中央民族大学学生考试违规认定与处理办法`,
`中央民族大学学生资助管理工作暂行办法` and `普通高等学校学生管理规定`. The most severe
observed paragraph was the student-aid funding-method list, which rendered as one 800+ character
paragraph on mobile.

A later batch reproduced it again in `中央民族大学家庭经济困难学生临时困难补助管理办法`,
`中央民族大学本科生国家助学金评审办法`, `中央民族大学本科学生国家励志奖学金评审办法`
and `中央民族大学解除学生纪律处分实施办法`, so this should be treated as a handbook-wide
normalization rule rather than isolated cleanup.

Another batch reproduced the same pattern across scholarship / award / evaluation pages, including
`中央民族大学本科学生专项奖学金评定办法`, `中央民族大学本科学生专业奖学金评定办法`,
`中央民族大学本科学生先进班集体评选办法`, `中央民族大学优秀本科毕业生评选办法` and
`中央民族大学学生志愿服务管理办法`.

## Solution

Teach the handbook public-docs generator to preserve Chinese parenthesized enumeration boundaries
as readable Markdown list blocks or separated list-like paragraphs. This should happen in the
generator / canonical-consumption layer, not by adding CSS to arbitrary paragraphs.

The rule must avoid corrupting ordinary inline parentheticals and should be covered by samples that
contain both full-line `(一)` entries and dense paragraphs that contain multiple `(一)(二)(三)` clauses.
