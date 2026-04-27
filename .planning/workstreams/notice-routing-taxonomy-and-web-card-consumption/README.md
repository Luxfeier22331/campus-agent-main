---
doc_type: index
status: active
created: 2026-04-28
updated: 2026-04-28
---

# Workstream: Notice Routing Taxonomy And Web Card Consumption

这是 `notice-routing-taxonomy-and-web-card-consumption` 的 native active
workstream 入口。

本 workstream 接续已完成的 `notice-consumption-layer`，专门收口“采集后如何
分类型、分批 admission，并为 Web 侧提供最低可消费 title/url 卡片”的设计与
验收。

## Current Status

- status: `active`
- current phase: `Phase 0`
- current slice: workstream setup and current-state audit
- active implementation: yes

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 这条线不重开 authenticated notice collector、auth portal、附件下载或 OCR/VLM
  provider 采集链路
- 这条线不重写 completed `notice-consumption-layer` 的 projection/admission
  基础设施
- 这条线不新增 procurement 专用 tool；采购类先通过 notice/history card 消费
- 这条线不要求所有 notice 深处理；低优先级 notice 当前只需正确分类、分流、
  检索命中并返回 title/url
- 这条线可以调整 routing taxonomy、selected batch admission policy、
  read-model title/url contract、Web card acceptance 和 eval/audit fixtures

## Inputs

- completed `notice-consumption-layer`
- updated `internal-notice-procurement-publication-history` backlog
- current read-model audit：当前 shared PG 中 queryable notice row 为 1，
  且 title/source_url 完整；该结果不覆盖 procurement/internal notice 全量链路
