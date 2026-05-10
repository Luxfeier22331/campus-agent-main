---
doc_type: phase_plan
phase: "5B"
phase_name: "Golden Dataset Expansion And Domain Case Governance"
status: completed
created: 2026-04-29
updated: 2026-05-10
---

# Phase 5B Plan: Golden Dataset Expansion And Domain Case Governance

## Objective

在采集与消费内容补全后，基于 Phase 5A 的 governance scaffold 正式扩编 accepted golden dataset。

当前执行拆成两层，并已按 eval owner 边界收口：

- `current-corpus golden expansion`：只基于已经进入当前 RAG/docs 消费面的稳定文档补齐 qrels、
  deterministic answer / answer-quality contract、known-gap/no-hit contract 与 coverage
  audit；该层已完成。
- `authenticated-gap expansion`：依赖认证态源恢复后补采缺失 canonical 文档，再把相关 query
  从 known-gap 晋升为 accepted qrels / answer truth；该层不再作为 eval blocker，而是移交
  backlog seed `.planning/seeds/SEED-005-authenticated-canonical-regulation-gap-collection.md`。

## Entry Conditions

- Phase 5A completed.
- 对应 domain workstream 已补齐 source truth / consumption / read model / tool surface。
- domain owner 已给出可审计 truth artifact，而不是只给一次 runtime answer。
- accepted case 的 expected truth 能绑定到稳定 source / version / trace / policy artifact。

## Scope

- 扩编 retrieval qrels。
- 扩编 workflow/status accepted cases。
- 扩编 deterministic answer truth。
- 晋升被 review 通过的 synthetic / observed candidates。
- 补齐 release gate / regression locked / smoke / exploratory 分层。
- 按 denominator registry 生成 coverage gap report。

## Non-Goals

- 不替代 domain owner authoring truth。
- 不把 exploratory / pending-review case 作为 blocking gate。
- 不用单次 acceptance 结果直接改 repo baseline。

## Residual Backlog

- eval 当前无 active blocker。
- 认证态源与 canonical 文档缺口登记为 backlog/source-domain work。例如
  `中央民族大学本科生创新教育学分认定管理办法` 当前只在历史 authenticated notice export 中
  作为正文引用出现，不是当前文档库/RAG 的 canonical document。
- eval 继续通过 known-gap/no-hit contract 防止缺源问题被误标为 accepted truth，但不得把缺失
  canonical 文档的相近
  文档、notice 引用或 synthetic answer 提升为 accepted truth。

## Exit Criteria

- admitted surface 的 denominator coverage 有明确 pass / gap report。
- accepted cases 全部有 source / version / owner / review decision。
- qrels、workflow/status cases、answer truth 与 synthetic promotion 都有 drift handling。
- current-corpus 的 known-gap case 能阻止缺源问题被误标为 accepted truth。
- `eval` workstream 不再等待 authenticated-gap expansion；该缺口已明确移交 backlog，并且在
  canonical source 补采前只能保持 known-gap/no-hit contract。
