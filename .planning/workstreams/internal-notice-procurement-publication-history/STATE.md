---
doc_type: state
status: backlog
created: 2026-04-24
updated: 2026-04-24
---

# State: Internal-Notice Procurement Notice Classification

## Current Status

- status: `backlog`
- current slice: none
- owner: unassigned
- active implementation: no

## Captured Context

2026-04-24 人工样本审阅结论：

- `355222 / 中央民族大学海淀校区学生宿舍供电智能管理系统维保服务项目比选公告`
  - 面向外部供应商的 procurement notice
  - 含 1 个 attachment-backed authority file
  - 应归类为 `procurement_notice`
- `355325 / 中央民族大学海淀校区学生宿舍供电智能管理系统维保服务项目中选结果公示`
  - 也是 procurement notice
  - 应归类为 `procurement_notice`，不额外要求 `stage`
- 当前正确 posture：
  - `internal_notice` source-triage / provenance truth 保留
  - downstream 保持 `audit/holding`
  - 不误投到 `regulations/institutional_rules`
  - 不误投到 `regulations/scoped_rules`
  - 不误投到 `campus_services/*`
- future storage truth 是在现有 notice / publication 存储中新增 `procurement_notice` 分类，
  而不是单独引入 procurement lifecycle object

## Blockers

- 当前 repo 还没有 `procurement_notice` 分类落到 storage / projection contract
- 当前产品主路径尚未开放 restricted notice runtime
- 当前 backlog 只冻结分类方向，不承诺立即开放 history query

## Verification

- 本 backlog 捕获来自真实 authenticated notice 样本审阅与 planning truth 对齐；未执行 runtime
  或 ingestion implementation
- 恢复为 active 后，第一步应先冻结分类与最小 metadata contract，而不是直接改 query/runtime

## Continuity Notes

- future canonical category 是 `procurement_notice`
- 不要求 `stage` 字段
- attachment-backed procurement notice 不能因为当前没有 dedicated target，就被误归为 regulation body
