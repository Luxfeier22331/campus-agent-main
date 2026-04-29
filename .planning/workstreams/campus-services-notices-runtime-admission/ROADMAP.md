---
doc_type: roadmap
status: active
created: 2026-04-20
updated: 2026-04-21
---

# Roadmap: Campus Services Notices Runtime Admission

## Overview

这条 workstream 只负责 `campus_services` / `campus_notice` 的 runtime-facing admission。
它独立于 `campus_services/*` 的 `offline_preparation` hardening，也不替代 `official_web` news opening。
首发固定收口为 `4` 个 tool：`service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover`、`campus_notice_get`。

## Phases

- [x] **Phase 1: Agent And Tool Boundary Freeze** — 冻结 `supervisor`、`campus-services-agent`、`notice-agent`、`navigation-agent`、`rag-agent` 的职责边界，以及首发 `4` 个 tool 的 routing / fail-close 口径；明确服务开放状态/临时关闭问题进入 `service_status_lookup`，而稳定制度/流程问题继续由 `rag-agent` 承接。
- [x] **Phase 2: Tool Contract Freeze** — 为 `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover`、`campus_notice_get` 冻结 strict schema、status enum、时间语义、historical downgrade 与 output shape。
- [x] **Phase 3: Structured Truth Admission And Query Projection Freeze** — 冻结这 `4` 个 tool 各自消费的 source-truth / normalized-truth lane 与 projection shape，明确 transport / notice / service status 不进入 generic RAG，并禁止 query-time raw notice scan。
- [x] **Phase 4: Internal Query Service And Supervisor Handoff Wiring** — 为 projection-backed internal query service、tool adapter、`supervisor -> campus-services-agent / notice-agent` handoff、per-agent `allowed_tools` 与 execution ownership 收口实现方向；`navigation-agent` 只消费 transport point refs 而不重新拥有 timetable truth，也不得通过 `app-api` loopback HTTP 取数。
- [x] **Phase 5: Verification And Opening Gate** — 已冻结首发 `4` 个 tool 的 verification matrix、minimal observability summary 与 opening-gate checklist；当前明确保持 gate closed，直到 backing query implementation、release-gate evidence 与 typed summary seam 同时成立。
- [x] **Phase 6: Contact Directory Lookup Admission** — 已冻结 `contact_directory_lookup` 的 bounded query class、semantic-owner truth、stable-reference / RAG boundary，以及 clarification / fail-close 口径；当前仍不自动打开 `contact_directory` runtime lane。
- [x] **Phase 7: Service Process Lookup Admission** — 已冻结 `service_process_lookup` 的 bounded query class、semantic-owner truth、stable-RAG / stable-reference boundary，以及与 `contact_directory_lookup` / `service_status_lookup` 的分工；当前仍不自动打开 `service_catalog` runtime lane。
