---
doc_type: index
status: backlog
created: 2026-04-24
updated: 2026-04-24
---

# Workstream: Internal-Notice Procurement Notice Classification

这是 `internal-notice-procurement-publication-history` 的 native backlog workstream 入口。
它记录 `campus_notices/internal_notice` 中采购 / 比选 / 招标 / 中选结果类 notice 的长期简化设计：
在现有 notice / publication 存储中新增稳定类别 `procurement_notice`，而不是继续把这类 notice 挤进
`regulations/*`、`campus_services/*` 或当前 `notice-agent` opening。

## Current Status

- status: `backlog`
- reopen rule: 只有在产品范围显式 admission 为 restricted notice / publication storage 新增稳定
  `procurement_notice` 分类，或基于该分类继续做历史查询时恢复
- current posture: `355222` / `355325` 这类 notice 已确认应归为 `procurement_notice` 候选；
  当前仍只保留在 source-triage / audit-holding truth

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 这条线不重开 `authenticated-notice-regulation-consumption`
- 这条线不替代 `authenticated-notice-live-portal-control-plane`
- 这条线不把 procurement notice 伪装成 `service_status_override`
- 这条线不直接打开 current product query-serving
- 这条线不要求 `stage` 字段或 procurement lifecycle object
