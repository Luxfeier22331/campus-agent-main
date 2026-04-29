---
doc_type: index
status: completed
created: 2026-04-22
updated: 2026-04-28
---

# Workstream: Notice Consumption Layer

这是 `notice-consumption-layer` 的本地 workstream 入口。
这条线的 `Phase 1-8` 已完成 projection / read-model / runtime closeout。
`Phase 9` 补齐了 consumer admission manifest + release gate；
`Phase 10` 将同一 admission 边界扩展到 notice-derived campus-services typed
materializer，并补齐 stable-contact candidate 的最小离线构建路径。

## Current Status

- status: `completed`
- current phase: `Phase 10 complete`
- closeout focus:
  - campus-services typed materializer 统一 fail-close admission gate
  - notice-only service-guide release 显式 override guard
  - stable-contact candidate 离线 artifact 路径
- completed closeout retained truth:
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
  - 2026-04-26 multimodal token-spend policy：source-truth
    `multimodal_processing_required` 不再直接等同 action backlog；projection
    metadata 明确 `source_multimodal_processing_required_count` /
    `pending_multimodal_attachment_count` / `multimodal_consumption_policy`。低价值、
    短生命周期活动/讲座/宣讲/工作坊 inline-image 海报保留 notice-level query
    truth，并以 `low_value_ephemeral_event_poster` 跳过 VLM drain；采购、公示名单、
    流程手册、材料表格、附件指向、二维码/扫码/报名方式等高价值缺口继续进入
    pending multimodal processing。
  - 2026-04-26 routing taxonomy sampling：新增 authenticated notice routing
    sampler，可从 historical bundle 或 source-truth inventory 生成分层抽样报告；初版
    taxonomy 补齐 course teaching、student application、document collection、
    exchange visit、research project、safety compliance、meeting/training、
    competition 与 recruitment family，作为后续 reviewer 回放和规则收口入口。
  - 2026-04-26 routing taxonomy eval：新增 repo-tracked
    `routing-taxonomy-eval.v1.jsonl` 与
    `evaluate_authenticated_notice_routing_taxonomy` gate，确定性校验
    `notice_family`、`suggested_consumption_route` 与
    `machine_processing_policy`；同时收窄 research project 的 `专项` 规则，避免抢占
    safety/compliance 的 `专项检查` 样本。
  - 2026-04-26 routing taxonomy expansion：补齐
    academic affairs lifecycle、finance/payment、health/medical、form/template、
    survey/feedback、facility/IT/library/transport service status、library
    resource、internal governance 与 general cultural publicity 分流；历史 3000
    条 bundle 回放中 `other/review_later` 从 1278 降到 900，`notice_level_query`
    为 1016，`service_status_candidate` 为 96。
  - 2026-04-26 routing taxonomy expansion round 2：继续补齐
    academic course/exam operation、student status/registration、student
    program/award selection、health/welfare service、facility/transport/classroom
    status、IT platform operation、library acquisition service、staff/internal
    admin、research publicity call、governance party life 与 cultural publicity
    activity 分流；历史 3000 条 bundle 回放中 `other/review_later` 从 900 降到
    568，`notice_level_query` 为 1209，`service_status_candidate` 为 166，
    `defer` 为 936。
  - 2026-04-26 routing taxonomy expansion round 3：继续补齐 academic program
    selection、student status/registration 扩展、finance reimbursement/subsidy、
    exchange/study-abroad project、course operation 扩展、facility/library/IT
    service status 扩展、competition event 扩展、campus news/publicity 与更多
    staff/governance/research publicity defer 分流；历史 3000 条 bundle 回放中
    `other/review_later` 从 568 降到 289，`notice_level_query` 为 1364，
    `service_status_candidate` 为 185，`defer` 为 1041。
  - 2026-04-26 routing taxonomy expansion round 4：继续补齐选调生招录、红色
    1+1、图书馆考研读者服务、门户/App 试运行、后勤服务信息、银行扣款、辅导员岗位等级评聘与
    校历/开学放假等窄规则；fallback `other/review_later` 明确
    `machine_processing_policy=skip`，不作为 VLM backlog。历史 3000 条 bundle
    回放中 `other/review_later` 收敛到 205，`notice_level_query` 为 1385，
    `service_status_candidate` 为 198，`defer` 为 1091。
  - 2026-04-26 full routing taxonomy audit：`sample_authenticated_notice_routing_candidates`
    新增 `--audit-output-path`，可对 historical bundle 或当前 source-truth
    inventory 写出只读 audit artifact，包含全部 `review_later` notices 和
    deterministic clusters；该 artifact 不创建 consumer admission。当前本机
    source-truth inventory replay 返回 282 条，`other/review_later` 从 66 收敛到
    1；保留的 1 条为低置信“为师生办实事清单”。历史 3000 条 bundle 回放中
    `other/review_later` 从 205 收敛到 198，eval fixture 扩到 127 cases。
  - 2026-04-27 Phase 10 closeout：`build_service_status_projection` 与
    `build_service_guide_projection` 的 notice-derived typed materialization 必须携带
    consumer admission manifest，并通过 `typed_materialization` gate。`service_guide`
    notice-only release 默认阻断，必须显式 `--allow-notice-derived-only-release`；
    新增 `build_notice_stable_contact_candidates` worker CLI 和
    `notice_derived_contact_candidate.py`，用于输出 stable-contact candidate 离线
    artifact，不直接晋升到 contact directory current release。
  - 2026-04-28 schedule notice consumption：新增
    `SCHEDULE-NOTICE-CONSUMPTION-LEDGER-2026-04-28.md` 作为第一批 39 条
    schedule notice 的逐条消费 ledger。`transport_schedule` selected write
    默认收口为单 notice stage；all-ready / multi-notice stage 或 promote 必须显式
    `--allow-multi-notice-release`。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- schedule consumption ledger:
  `./SCHEDULE-NOTICE-CONSUMPTION-LEDGER-2026-04-28.md`

## Archived Snapshot

- 2026-04-22 semantic-modeling closeout
  snapshot：`../../../docs/plans/archive/completed/notice-consumption-layer.md`
