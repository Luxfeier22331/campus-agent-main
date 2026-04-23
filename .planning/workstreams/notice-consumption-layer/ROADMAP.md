---
doc_type: roadmap
status: active
created: 2026-04-21
updated: 2026-04-24
---

# Roadmap: Notice Consumption Layer

## Overview

`Phase 1-5` 已完成 `source_notice / notice_attachment / derived consumption unit`
的 semantic modeling closeout。
当前这条线已重开为 implementation workstream：
先把 repo-owned `notice consumption projection` 真正落成，再让 downstream consumer 经由它读取 ready
derived-unit truth，而不是继续直接扫 `internal_notice` source holding collection。

## Phases

- [x] **Phase 1: Source Family Boundary** — 冻结 `source_notice`、`notice_attachment`、`derived consumption unit` 的基本关系，以及 public/restricted notice source family 的消费边界和 role taxonomy。
- [x] **Phase 2: Consumption Unit Schema** — 为 derived unit 冻结最小正式 schema，至少包括 `primary_role`、`semantic_owner`、`default_agent`、`target_surface`、`temporal_policy`、`completeness_status` 与 provenance。
- [x] **Phase 3: Authority And Completeness** — 明确 notice body、attachment body、wrapper text 的 authority / precedence，冻结 `attachments_declared` / `attachments_captured` / `authoritative_attachment_missing` / `body_only_answerable` 等 contract。
- [x] **Phase 4: Agent And Surface Handoff** — 收口各 role 如何交给 `notice-agent`、future `rag-agent`、`campus-services-agent`，以及何时继续停留在 notice runtime、何时具备成为 future rule/service surface 候选的条件。
- [x] **Phase 5: Adoption And Verification** — 用 bounded exemplar 验证 consumption-layer model 的可用性，并把 adoption 路由回相关 workstream，避免消费层建模长期悬空。
- [ ] **Phase 6: Projection And Consumer Foundation** — 落地 persistent notice consumption projection store / rebuild path，并让 `internal_notice` regulation/scoped downstream materialization 通过 projection 过滤 ready candidates。
- [ ] **Phase 7: Non-Regulation Derived-Unit Coverage** — 把 `procurement_notice`、publication-like / no-adoption family、future `service_status_override` 等尚未代码化的 derived-unit coverage 显式补齐到 projection truth。
- [ ] **Phase 8: Operator Query And Closeout** — 为 operator/read-model 补查询与审计入口，关闭 “notice 是否已消费、为何 hold/manual/no-adoption” 的观测缺口，并完成这条 implementation line 的 closeout。
