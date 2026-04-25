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
  - 2026-04-25 closeout supplement：notice discover runtime 已支持
    `target_surfaces` facet，例如只查 `procurement_notice_history`；read-model
    consistency doctor 已落地为 repo-owned worker CLI，只读检查 projection 与
    read model 的 missing/extra unit
  - 2026-04-25 machine-processing downline：新生成的 consumption projection 不再把
    attachment classification 写成 consumption status；promotion action 不再产出
    attachment classification，可机器继续处理的 action 使用
    `requires_multimodal_processing` 并投向 `pending_multimodal_processing` +
    `multimodal_processing_candidate`；硬性不采纳 reason 转为 `no_adoption` +
    `unsupported`，并新增 processing gaps audit CLI
  - 2026-04-25 multimodal closeout：新增 selected-notice multimodal processor，
    通过 env chat endpoint 处理 `pending_multimodal_processing` units；机器摘要
    只回写为 notice-level query/read-model truth 或 `no_adoption`，不把视觉模型输出
    伪装成 regulation ready target
  - 2026-04-25 runtime closeout：consumer admission batch 已有 started /
    completed / failed lifecycle 与 operator list CLI；projection rows 与
    multimodal attempts 会携带 consumer admission batch provenance；multimodal
    attempt store 已持久化，runtime smoke 与 multimodal decision eval gate 已落地
  - 2026-04-25 execution closeout：legacy manual-review consumption migration
    CLI/core path 已移除；admission
    batch 记录 selection source/path/hash 与 command args；read-model rebuild /
    repair 也纳入 admission lifecycle；regulation/scoped downstream materializer
    在未注入或未配置 projection store 时 fail closed，不再 fallback 到空内存
    projection；runtime smoke 会校验 projection admission provenance、
    pending-multimodal attempts 与可选 chat endpoint；multimodal eval gate 支持
    accuracy / needs-additional-processing 阈值
  - 2026-04-25 non-smoke closeout：补齐 repo-owned
    `consumption-layer-schema.sql` 持久化 schema artifact；consumer admission
    current batch 外新增 append-only event log；新增 projection-only pending
    multimodal drain CLI；multimodal eval CLI 默认使用 repo-tracked JSONL fixture
    gate；真实 PG/chat smoke 不作为本次修复前置条件
  - 2026-04-25 multimodal eval hardening：decision fixture 扩到 20 个
    action/classification case；新增 visual fixture gate，检查 required text
    spans、forbidden claims、reason codes 与 confidence；多模态写回前新增
    retain/no-adoption guard，低置信或空内容 retain、带 extracted text 的
    no-adoption 均保持 pending，不进入 read model

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- 2026-04-22 semantic-modeling closeout
  snapshot：`../../../docs/plans/archive/completed/notice-consumption-layer.md`
