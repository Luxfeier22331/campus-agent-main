---
doc_type: index
status: completed
created: 2026-04-22
updated: 2026-04-24
---

# Workstream: Notice Consumption Layer

这是 `notice-consumption-layer` 的本地 workstream 入口。
这条线的 `Phase 1-5` 已完成 semantic modeling closeout，但 “implementation 应完全回到 adoption target、因此本线可关闭” 这一判断已被证实过早。
当前这条 workstream 已完成 active implementation closeout：repo-owned notice consumption projection 已落成代码与持久化 metadata truth。

## Current Status

- status: `completed`
- current phase: `closeout`
- closeout focus:
  - `source_notice -> derived consumption unit` projection store / rebuild path 已落地
  - `internal_notice` regulation/scoped downstream consumer 已通过 projection ready truth 过滤
  - `procurement_notice`、internal restricted no-adoption、`service_status_override`、`attachment_form_template` coverage 已代码化
  - operator/read-model 查询入口已补齐，不重开 query-serving、panel、live control-plane 或 authenticated portal runtime

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- 2026-04-22 semantic-modeling closeout snapshot: `../../../docs/plans/archive/completed/notice-consumption-layer.md`
