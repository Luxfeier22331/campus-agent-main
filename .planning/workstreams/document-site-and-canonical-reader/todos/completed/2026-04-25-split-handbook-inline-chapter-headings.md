---
created: 2026-04-25T00:12:00.000Z
title: Split handbook inline chapter headings
area: docs
files:
  - apps/public-docs/scripts/sync-real-docs/handbook.ts
  - apps/public-docs/docs/student-handbook/中央民族大学本科创新教育实施办法.md
---

## Problem

Some student-handbook generated pages contain chapter headings merged into the previous article
paragraph instead of rendered as section headings. A live sample in
`中央民族大学本科创新教育实施办法` shows content such as `学校为学生参与创新教育活动设立专项经费、提供必要的条件。 二、管理`,
`各院系负责日常的与创新教育有关的教学活动和实践活动的管理。 三、项目`,
`校级项目竞赛规则由教务处与承办院系共同制订... 四、本科生研究训练计划的组织与实施`,
and `未按期结题的项目取消经费资助... 五、本科生学科竞赛计划的组织与实施`.

This breaks the reader hierarchy: major chapter boundaries disappear from the outline and are hard
to scan in the page body.

## Solution

Add a handbook generator normalization rule that detects inline Chinese chapter markers
`一、...` through `十、...` when they appear after sentence-ending punctuation inside an article
paragraph, splits them out of the paragraph, and emits them as section headings.

The rule should be bounded to handbook chapter-style markers and should avoid splitting ordinary
inline enumerations or curriculum course names.
