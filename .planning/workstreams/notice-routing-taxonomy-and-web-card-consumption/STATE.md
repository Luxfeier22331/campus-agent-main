---
doc_type: state
status: completed
created: 2026-04-28
updated: 2026-04-28
---

# State: Notice Routing Taxonomy And Web Card Consumption

## Current Status

- status: `completed`
- current phase: `Phase 5`
- current slice: closeout
- owner: unassigned
- active implementation: no

## Current Context

用户明确新的产品口径：

- 通知不是全部都要深处理。
- 当前策略是先采集入库，再按类型一批批 admission 到 consumption layer。
- 首期专用 downstream consumption 只开放三类：
  - `regulation`
  - `schedule`
  - `service_status`
- procurement、讲座、活动、宣传、一般公告等其他 notice 暂缓进入专用下游；
  当前只要求正确分类、分流、PG 搜索命中，并返回 title/url 供 Web 侧消费。
- 采购类 notice 不需要新 tool，也不作为首期独立 pilot；与讲座、活动类通知一样，
  归入 generic notice search/title-url card。
- 2026-04-28 Phase 1 implementation closeout：
  - active downstream denominator 固定为 `regulation_candidate` 与
    `service_status_candidate` 两条 route family；schedule 由 service-status
    candidate 内的 transport schedule kind 承接。
  - procurement、lecture、activity、publicity、campus-news、meeting/training、
    staff/internal-admin 等 generic-card-only family 统一路由为
    `notice_level_query + machine_processing_policy=skip`。
  - routing attachment policy 已改为：只要 machine policy 为 `skip`，即使存在
    attachment ref，也只保留 metadata，不进入 OCR/VLM backlog。
  - projection 已停止按采购标题生成额外 `procurement_notice_history` sidecar；
    采购通知只保留 `notice_window` read-model card。
  - lecture/activity 类通知不再生成额外 no-adoption sidecar；同样只保留
    `notice_window` read-model card。
- 2026-04-28 Phase 2-5 implementation closeout：
  - `NoticeCard` 与 `CampusNoticeGetResult` shared contract 已携带
    `target_surface`。
  - notice-agent HTTP adapter 已从 Go structured-query response 解码
    `target_surface`。
  - Go `campus_notice_discover` 对缺失 `notice_id`、`source_family`、`title`、
    `source_url` 或 `target_surface` 的 read-model row fail-close。
  - `canonical_url` 为空时由 query runtime 回退到 `source_url`。
  - repo-owned routing taxonomy eval fixture 已更新为 generic card first-phase
    posture，并通过默认 fixture gate。

## Baseline Facts

- completed `notice-consumption-layer` 已提供：
  - source-truth inventory 与 consumption projection 的边界
  - selected admission manifest
  - read-model rebuild / consistency doctor
  - routing taxonomy sampler/eval
  - `procurement_notice_history` target surface
  - `campus_notice_discover/get` read-model backing path
- `procurement_notice_history` target surface 虽已存在，但首期 product opening
  暂缓；当前 routing config 不再产生该 route，projection 也不再按标题生成该
  sidecar。
- `internal-notice-procurement-publication-history` backlog 应更新为 deferred
  procurement-specific facet，不再作为当前首期 pilot。
- 当前 shared PG read-model audit：
  - table: `ingestion_projection.internal_notice_read_model`
  - total rows: `1`
  - queryable rows: `1`
  - missing title rows: `0`
  - missing source_url rows: `0`
  - current row source family: `wechat_public_notice`
  - current row target surface: `notice_level_query`
- 该 audit 说明当前已入库 queryable row 满足 title/url contract，但不覆盖
  procurement/internal notice 全量链路。
- 2026-04-28 regulation routing update：
  - `policy_regulation` 继续映射到 `regulation_candidate`。
  - 稳定制度文本扩展覆盖 `实施办法`、`暂行办法`、`试行办法`、`若干规定`、
    `处分规定`、`管理规范`、`实施意见`，以及发布/印发/修订/公布/颁布/
    废止动作。
  - 制度专题学习、解读会、宣传材料和方案/报告不作为 regulation 正文消费；
    学习/解读会归入 `meeting_training -> notice_level_query`，并跳过机器深处理。
- 2026-04-28 regulation document-site dry-run update：
  - `regulation_candidate` selected admission 使用 broad family
    `target_surface=regulations/*`。
  - consumption projection 继续解析 concrete target：
    `institutional_regulation -> regulations/institutional_rules`，
    `annual_cycle_rule / time_bound_operational_rule -> regulations/scoped_rules`。
  - dry-run worker 已扩展为同时 materialize institutional/scoped target records，
    并为两个 scope 生成 canonical document reader assets。
  - 本 slice 仍保持 `query_serving_opened=false` 与 `rag_release_opened=false`。

## Current Open Questions

- none for this workstream.

## Immediate Next Step

Workstream completed. 后续只有在产品范围决定打开 procurement-specific facet、
新增 dedicated notice downstream family，或真实入口验收发现 generic notice card
contract 漂移时重开。
