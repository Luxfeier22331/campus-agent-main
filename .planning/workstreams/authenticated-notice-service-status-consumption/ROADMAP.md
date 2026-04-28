---
doc_type: roadmap
status: active
created: 2026-04-28
updated: 2026-04-28
---
# Roadmap: Authenticated Notice Service Status Consumption

<!-- markdownlint-disable MD013 -->

## Overview

这条 workstream 将 authenticated internal notice 的 service-status candidates 收口为
`service_status_lookup` 可消费的 structured current truth。

固定执行顺序是：

```text
boundary/cohort
-> projection contract
-> materializer coverage
-> release/read-model publication
-> runtime/eval regression
-> product source presentation
-> live admission and downstream consumption loop
```

## Phases

- [x] **Phase 1: Boundary And Selected Admission** — 冻结 service status 与
  regulation / schedule / service guide / contact / notice-level query 的边界，形成第一批
  selected admission cohort。当前 live cohort 只有 transport boundary 样本，其余家族使用
  deterministic fixtures 等待后续真实 admission。
- [x] **Phase 2: Projection Contract And Schema** — 扩展并冻结
  `service_status_records` schema、validation report、rejected-source report 与
  source provenance contract。
- [x] **Phase 3: Materializer Coverage** — 扩展 notice-derived materializer，覆盖
  facility、 IT platform、library、service counter 与 transport-adjacent status，保持
  fail-close。
- [x] **Phase 4: Release Read Model And Promotion** — 对齐 transport schedule 的
  `preview / stage / promote` 发布语义，并验证 PG release catalog/current pointer/read
  model。stage 不写 current artifact，不移动 PG current pointer；preview 可记录 rejected-source
  evidence。
- [x] **Phase 5: Runtime Query And Eval** — 补齐 `service_status_lookup` subject
  matching、 time-window、ambiguity、conflict 与 fail-close deterministic
  regression。
- [x] **Phase 6: Product Source Presentation** — 收口 public-chat/app-api 对
  service status answer 的中文表达、来源卡片和技术字段隐藏。
- [x] **Phase 7: Live Admission And Downstream Consumption Loop** — 真实
  publishable service-status notice `355650` 已完成
  `notice_consumption_projection -> service_status projection -> PG read model ->
  service_status_lookup -> app-api/public-chat answer` 闭环；`355867`
  继续保留为 transport/schedule 边界拒绝证据。workstream 暂不归档，等待最终
  verification、commit organization 与显式 archive 决策。

## Stop Point

Phase 7 的 stop point 是真实 live 闭环证据，而不是当前代码路径可运行或 fixture
coverage。当前 `355650` 已满足以下闭环条件：

- 至少一个 publishable live service-status notice family 被正确 admission 到
  `notice_consumption_projection`，且不来自 regulation / schedule / service guide /
  contact directory / generic notice query 的误吸收。
- service-status typed consumption 由 live source 生成 versioned artifact、
  rejected-source report、release row、PG current pointer 与 typed read model。
- `service_status_lookup` 从 PG current read model 读取该 live truth，并在缺失、
  歧义或冲突时 fail closed。
- app-api/public-chat 能用中文展示用户可理解的状态、有效窗口和低打扰来源，不暴露技术字段。
- captured evidence 覆盖 preview、stage、promote、PG current/list、runtime lookup
  和 product answer。

当前保留 active 的原因不是缺少 live loop，而是等待最终 verification、commit organization
和是否归档的显式决策。

## Reopen Rule

完成上述 live 闭环后，才允许讨论归档。完成后仅在以下情况恢复：

- 新 service-status family 被 admission 到 typed current truth；
- ADR-0044 release/read-model semantics 被改写；
- `service_status_lookup` runtime contract 或 product-path opening gate 被改写；
- public-chat/panel 发现 service-status 来源展示或当前状态语义漂移。
