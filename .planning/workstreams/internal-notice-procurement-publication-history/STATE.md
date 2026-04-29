---
doc_type: state
status: backlog
created: 2026-04-24
updated: 2026-04-28
---

# State: Internal-Notice Procurement Notice Classification

## Current Status

- status: `backlog`
- current slice: none
- owner: unassigned
- active implementation: no
- current posture: deferred procurement-specific facet; first-phase product opening uses
  generic notice search/title-url card

## Captured Context

2026-04-28 重新评估结论：

- `procurement_notice` family 与 `procurement_notice_history` target surface
  已在 notice consumption layer 中存在；本 backlog 不再表示“还没分类”。
- 2026-04-28 最新产品口径：采购类与讲座、活动、一般公告没有本质区别，首期
  不作为独立 downstream pilot，不打开 procurement-specific history surface。
- 采购类 notice 的首期正确消费面是 generic PG notice search/title-url card，
  不是 `regulations/*`、`campus_services/*` 或新 procurement tool。
- 对采购类和低优先级 notice，当前最低产品要求是：
  - 正确分类
  - 正确分流到 target surface 或 defer/no-adoption
  - 检索时能够命中
  - 返回 title + source url，供 Web 侧消费
- 不是所有 notice 都需要正文解析、附件 OCR、VLM、summary 或 tool
  materialization。低价值宣传/活动类可以 skip machine processing；如果进入
  queryable read model，必须仍满足 title/url card contract。
- 当前 contract 事实：
  - `InternalNoticeReadModelEntry` 已有 `title`、`source_url`、
    `canonical_url`、`published_at`、`target_surface`
  - `NoticeCard` contract 要求 `notice_id`、`title`、`source_url`
    非空
  - Go `campus_notice_discover` 会返回 card-level title/source_url
  - Go `campus_notice_get` 对 resolved notice 会 fail-close 缺失 title/source_url；
    public/reference-only notice 可只返回原文链接

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
  - `procurement_notice_history` 只作为 deferred procurement-specific facet，
    不是首期 product opening
  - 不误投到 `regulations/institutional_rules`
  - 不误投到 `regulations/scoped_rules`
  - 不误投到 `campus_services/*`
- storage truth 是在现有 notice / publication/read-model 中保留
  `procurement_notice` / `procurement_notice_history` 分类，而不是单独引入
  procurement lifecycle object

## Blockers

- 只有当产品范围决定从 generic notice search/card 提升采购专项 facet 时，才需要
  为采购历史 query facet 增加产品级验收样例
- 需要确认 Web 侧 notice card 是否消费并展示 `title` + `source_url`
- 需要审计 queryable notice read-model rows 是否都具备非空 title/source_url
- restricted notice auth boundary 仍必须保留；title/url card 不等于公开访问

## Verification

- 本 backlog 捕获来自真实 authenticated notice 样本审阅、当前 notice
  consumption layer truth 与 structured query contract 对齐；本次未执行 runtime
  或 ingestion implementation
- 恢复为 active 后，第一步应先确认产品范围是否仍要 procurement-specific
  facet；否则继续由 generic notice search/card 验收承载 title/url

## Continuity Notes

- future canonical category 是 `procurement_notice`
- 不要求 `stage` 字段
- attachment-backed procurement notice 不能因为没有 dedicated procurement tool，
  就被误归为 regulation body
- 采购类默认不需要新 tool；首期先通过 generic notice search/title-url card 消费
- 低优先级 notice 现阶段只需要分类、分流、检索命中和 title/url card
