---
doc_type: phase_plan
phase: "5B"
phase_name: "Golden Dataset Expansion And Domain Case Governance"
status: blocked
created: 2026-04-29
updated: 2026-04-29
---

# Phase 5B Plan: Golden Dataset Expansion And Domain Case Governance

## Objective

在采集与消费内容补全后，基于 Phase 5A 的 governance scaffold 正式扩编 accepted golden dataset。

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

## Blocker

- 采集与消费内容尚未形成足够稳定的 source truth / read model / runtime trace。

## Exit Criteria

- admitted surface 的 denominator coverage 有明确 pass / gap report。
- accepted cases 全部有 source / version / owner / review decision。
- qrels、workflow/status cases、answer truth 与 synthetic promotion 都有 drift handling。
- `eval` workstream 可以标记 shared golden dataset governance completed。
