---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Batched Downstream Replay

## Goal

对已设计好的目标分批进入下游消费，不让未设计内容自动晋升。

## Tasks

1. 为 `regulation` 生成 admission manifest、dry-run、stage report 和 consistency report。
2. 为 `transport_schedule` 生成 admission manifest、dry-run、stage report 和 consistency report。
3. 为 `service_status` 生成 admission manifest、dry-run、stage report 和 consistency report。
4. 输出 rejected/deferred source report。
5. 验证 downstream rows 能回链到 searchable notice row 和 source objects。

## Acceptance

- downstream 只包含 admitted notice ids。
- transport schedule 不缺 OCR/结构化 evidence。
- service status current promotion 必须显式。
- regulation 不默认打开 query-serving。
