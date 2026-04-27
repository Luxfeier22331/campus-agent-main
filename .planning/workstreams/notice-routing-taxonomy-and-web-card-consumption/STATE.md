---
doc_type: state
status: active
created: 2026-04-28
updated: 2026-04-28
---

# State: Notice Routing Taxonomy And Web Card Consumption

## Current Status

- status: `active`
- current phase: `Phase 1`
- current slice: regulation selected dry-run into document storage / document reader
- owner: unassigned
- active implementation: yes

## Current Context

用户明确新的产品口径：

- 通知不是全部都要深处理。
- 当前策略是先采集入库，再按类型一批批 admission 到 consumption layer。
- 低优先级 notice 现阶段只要保证正确分类、分流、检索命中，并返回
  title/url 供 Web 侧消费。
- 采购类 notice 不需要新 tool，优先通过 `campus_notice_discover/get` +
  `target_surfaces=["procurement_notice_history"]` 消费。

## Baseline Facts

- completed `notice-consumption-layer` 已提供：
  - source-truth inventory 与 consumption projection 的边界
  - selected admission manifest
  - read-model rebuild / consistency doctor
  - routing taxonomy sampler/eval
  - `procurement_notice_history` target surface
  - `campus_notice_discover/get` read-model backing path
- `internal-notice-procurement-publication-history` backlog 已更新为
  procurement/history title-url card productization，不再表示“还没分类”。
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
    学习/解读会归入 `meeting_training -> defer`。
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

- 哪些 family 应默认 queryable 但只提供 title/url card？
- `defer` 与 queryable title/url card 是否允许并存，还是 defer 一律不进入
  read model？
- 低置信 residual 如何在不引入 human review 状态的前提下关闭：默认
  `no_adoption`，还是少量进入 multimodal processing？
- procurement/history 第一批 selected notice 应覆盖哪些类型：公告、结果公示、
  更正/延期、附件型公告？
- Web 侧是否需要 `source_url` 优先，还是 `canonical_url` 优先并回退 source URL？

## Immediate Next Step

继续 Phase 1/2 收口：regulation selected dry-run 已证明可以进入 document storage
与 document reader artifact；下一步不要直接开放 query-serving，应转回 Web card /
procurement minimum consumption 或先补 controlled publish/import 的真实 PG 路径。
