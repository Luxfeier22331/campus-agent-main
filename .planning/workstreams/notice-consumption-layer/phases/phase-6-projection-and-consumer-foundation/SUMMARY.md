---
doc_type: phase_summary
phase: "6"
phase_name: "Projection And Consumer Foundation"
status: completed
created: 2026-04-24
updated: 2026-04-24
---

# Phase 6 Summary

## Outcome

`notice-consumption-layer` 已从 semantic modeling truth 进入 repo implementation truth：

- persistent projection store 已落地到 `ingestion_projection.notice_consumption_projection`
- canonical rebuild path 已落地到 `internal_notice_consumption_projection`
- import path 已支持在显式 projection store / 专用 projection DB env 存在时同步 rebuild imported notice projection
- `institutional_rules` / `scoped_rules` materialization 已经经由 projection ready gate 过滤 candidate
- operator read-model 已能按 notice id 汇总 ready / held / manual / no-adoption units

## Remaining Work Closed Later

- Phase 7 已补齐 non-regulation derived-unit coverage，包括 `procurement_notice`、internal restricted no-adoption、`service_status_override` 与 `attachment_form_template`
- Phase 8 已围绕 operator/read-model closeout 扩展状态查询、原因输出与 selected-notice stale-unit replacement
