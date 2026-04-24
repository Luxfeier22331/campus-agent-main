---
doc_type: index
status: completed
created: 2026-04-22
updated: 2026-04-25
---

# Workstream: Notice Consumption Layer

这是 `notice-consumption-layer` 的本地 workstream 入口。
这条线的 `Phase 1-5` 已完成 semantic modeling closeout，但
“implementation 应完全回到 adoption target、因此本线可关闭” 这一判断已被证实过早。
当前这条 workstream 已完成 active implementation closeout：repo-owned notice
consumption projection 已落成代码与持久化 metadata truth，并已把 archive /
consumption projection / query read model / query runtime 语义拆开。

## Current Status

- status: `completed`
- current phase: `closeout`
- closeout focus:
  - `source_notice -> derived consumption unit` projection store / rebuild path
    已落地
  - `internal_notice` regulation/scoped downstream consumer 已通过 projection ready
    truth 过滤
  - `procurement_notice`、internal restricted no-adoption、
    `service_status_override`、`attachment_form_template` coverage 已代码化
  - notice-level 留存状态使用 `retained_for_notice_query`
  - target surface 使用 `notice_level_query` / `procurement_notice_history` /
    `campus_services/service_status_candidate` / `unsupported` 等消费语义
  - 不再把留档、read model 与 query runtime 混写成 `notice_runtime`
  - import path 可在 projection store / read-model store 存在时显式重建 query
    read model
  - notice-agent package 内的 backing query service 已能从 read model + canonical
    body adapter 映射 `campus_notice_discover` / `campus_notice_get`
  - operator/read-model 查询入口已补齐，不重开 query-serving、panel、
    live control-plane 或 authenticated portal runtime
  - 2026-04-24 本地补全：internal_notice query read model 收口为 lightweight
    metadata/read projection，PG 只保存 short body excerpt / short search text /
    object key；完整 canonical markdown 继续由对象存储在 get 路径按需读取
  - 2026-04-25 correction：PG read/projection 写入不能把 source-truth
    inventory 或 holding collection 当成已消费 notice；persistent consumer
    projection rebuild 的 core path 与 CLI 默认拒绝 implicit full-scope
    rebuild，必须显式传入 `--notice-id` 或 `--document-id`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- 2026-04-22 semantic-modeling closeout
  snapshot：`../../../docs/plans/archive/completed/notice-consumption-layer.md`
