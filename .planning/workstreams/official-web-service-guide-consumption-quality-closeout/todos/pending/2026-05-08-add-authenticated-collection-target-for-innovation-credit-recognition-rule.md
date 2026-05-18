---
created: 2026-05-08T16:41:56.298Z
title: Add authenticated collection target for innovation credit recognition rule
area: planning
files:
  - configs/ingestion/regulations/student_rules/split-manifest.v1.json:105
  - apps/authenticated-notice-collector/runtime/exports/notices-bundle-20260427T020248.597Z.json:267107
---

## Problem

The current document library contains `中央民族大学本科创新教育实施办法`, but does not contain `中央民族大学本科生创新教育学分认定管理办法` / `创新学分认定办法` as a canonical document.

This is a real coverage gap for student-facing queries such as `创新学分怎么认定`, `创新学分认定办法`, and `创新创业课程算什么学分`. A historical authenticated notice export references `《中央民族大学本科生创新教育学分认定管理办法》（教发[2016]9号）`, but that reference is only notice body evidence and should not be treated as the full regulation document.

## Solution

When authenticated collection is available again, add this rule as a first-class one-time collection target. Confirm the current/latest effective version, capture the full source artifact, normalize the title, and promote it through the regulation source-pack path into the student-facing regulation surface for docs-site and RAG consumption.

Do not mark the gap closed merely because related handbook material exists; the canonical rule text needs to be collected or an explicit source-unavailable decision must be recorded.
