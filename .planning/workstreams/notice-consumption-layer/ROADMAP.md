---
doc_type: roadmap
status: completed
created: 2026-04-21
updated: 2026-04-22
---

# Roadmap: Notice Consumption Layer

## Overview

这条 workstream 已作为 notice semantic modeling closeout 关闭。
它完成的是 `source_notice / notice_attachment / derived consumption unit` 的边界冻结、
authority / completeness contract、agent/surface handoff truth，以及 `Phase 5`
的 worked example / adoption routing closeout。

## Phases

- [x] **Phase 1: Source Family Boundary** — 冻结 `source_notice`、`notice_attachment`、`derived consumption unit` 的基本关系，以及 public/restricted notice source family 的消费边界和 role taxonomy。
- [x] **Phase 2: Consumption Unit Schema** — 为 derived unit 冻结最小正式 schema，至少包括 `primary_role`、`semantic_owner`、`default_agent`、`target_surface`、`temporal_policy`、`completeness_status` 与 provenance。
- [x] **Phase 3: Authority And Completeness** — 明确 notice body、attachment body、wrapper text 的 authority / precedence，冻结 `attachments_declared` / `attachments_captured` / `authoritative_attachment_missing` / `body_only_answerable` 等 contract。
- [x] **Phase 4: Agent And Surface Handoff** — 收口各 role 如何交给 `notice-agent`、future `rag-agent`、`campus-services-agent`，以及何时继续停留在 notice runtime、何时具备成为 future rule/service surface 候选的条件。
- [x] **Phase 5: Adoption And Verification** — 用 bounded exemplar 验证 consumption-layer model 的可用性，并把 adoption 路由回相关 workstream，避免消费层建模长期悬空。
