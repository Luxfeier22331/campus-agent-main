---
doc_type: roadmap
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Roadmap: Notice Semantic Fan-out And Consumption Modeling

## Overview

这条 workstream 只负责 notice 的 semantic fan-out 与消费建模。
它不替代 `campus-services-notices-runtime-admission` 的 runtime/tool contract，
也不替代 `authenticated-notice -> regulation downstream consumption` 的 target-side hardening。

## Phases

- [ ] **Phase 1: Notice Source And Role Taxonomy Freeze** — 冻结 `source_notice`、`notice_attachment`、`derived consumption unit` 的基本关系，以及 `notice_window`、`annual_cycle_rule`、`time_bound_operational_rule`、`roster_publication`、`lecture_activity`、`service_status_override` 等 role taxonomy。
- [ ] **Phase 2: Derived Consumption Unit Schema Freeze** — 为 derived unit 冻结最小正式 schema，至少包括 `primary_role`、`semantic_owner`、`default_agent`、`target_surface`、`temporal_policy`、`completeness_status` 与 provenance。
- [ ] **Phase 3: Attachment Authority And Completeness Contract Freeze** — 明确 notice body、attachment body、wrapper text 的 authority / precedence，冻结 `attachments_declared` / `attachments_captured` / `authoritative_attachment_missing` / `body_only_answerable` 等 contract。
- [ ] **Phase 4: Agent Routing And Target Surface Handoff Freeze** — 收口各 role 如何交给 `notice-agent`、future `rag-agent`、`campus-services-agent`，以及何时继续停留在 notice runtime、何时具备成为 future rule/service surface 候选的条件。
- [ ] **Phase 5: Verification Slice And Adoption Routing** — 用 bounded exemplar 验证 fan-out model 的可用性，并把 adoption 路由回相关 workstream，避免 semantic modeling 长期悬空。
