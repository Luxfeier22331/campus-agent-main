---
doc_type: requirements
status: completed
created: 2026-04-28
updated: 2026-04-28
---

# Requirements: Notice Routing Taxonomy And Web Card Consumption

## Goal

建立 notice 采集后的分流与最低消费口径：

1. source-truth notice 先采集入库。
2. routing taxonomy 负责判断 family、route、machine-processing policy。
3. selected admission manifest 负责一批批进入 consumption projection/read model。
4. 下游消费按 target surface 分开。
5. 首期专用 downstream consumption 只开放 `regulation`、`schedule`、
   `service_status`。
6. 对 procurement、讲座、活动、宣传、一般公告等其他 notice，现阶段只保证
   分类、分流、PG 搜索命中和 title/url 卡片。

## In Scope

- authenticated/internal notice routing taxonomy 的产品口径复核
- `notice_family -> suggested_consumption_route -> target_surface/status` 的
  显式映射
- selected batch admission 的分流验收
- queryable read-model title/source_url completeness audit
- 首期 downstream denominator：`regulation`、`schedule`、`service_status`
- 非首期 downstream notice 的通用 PG search/title-url card contract
- low-priority notice 的 minimum Web card contract
- routing taxonomy eval fixture 和 terminal residual audit 收敛
- Web 侧消费字段：
  - `notice_id`
  - `title`
  - `source_url`
  - optional `canonical_url`
  - `published_at`
  - `source_family`
  - `target_surface`

## Non-goals

- 重新采集 portal、附件或图片
- 全量 notice 直接进入 read model
- 所有 notice 都做 OCR/VLM/正文摘要
- 新增 procurement lifecycle object 或 dedicated procurement tool
- 首期开放 `procurement_notice_history` 专用下游 surface
- 把低价值宣传/讲座/活动强行推进到 agent answer synthesis
- 改写 `regulations/*` 或 `campus_services/*` 已完成的 downstream owner

## Success Criteria

1. repo planning truth 明确 notice 分流是一条独立 active workstream。
2. taxonomy route 与 target surface 的当前矩阵被重新记录，含 procurement、
   service-status candidate、notice-level query 和 no_adoption；active route 不再使用
   `defer`。
3. queryable read model rows 有可重复审计命令，确认 title/source_url 完整。
4. 首期专用 downstream denominator 被明确限制为 `regulation`、`schedule`、
   `service_status`。
5. procurement、lecture、activity、publicity、general notice / announcement
   不进入专用 downstream target；它们只通过通用 PG notice search/read model
   返回 title/url card。
6. 低优先级 notice 的 minimum card contract 被明确：不深处理，但可按需返回
   title/url。
7. 低置信 residual 不形成延后人工处理状态；无动作信号直接 `no_adoption`，
   需要机器判断的高价值附件/图片通知进入 multimodal processing。
8. Web 侧消费 title/url 卡片有至少一条 deterministic acceptance path。

## Canonical Entry

- `.planning/workstreams/notice-routing-taxonomy-and-web-card-consumption/README.md`
