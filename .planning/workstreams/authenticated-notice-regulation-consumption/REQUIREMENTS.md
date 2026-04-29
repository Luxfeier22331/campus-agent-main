---
doc_type: requirements
status: active
created: 2026-04-19
updated: 2026-04-30
---

# Requirements: Authenticated Notice Regulation Consumption

## Goal

把已捕获的 `internal_notice` regulation cohort 稳定下游消费到 `regulations/institutional_rules` 与 `regulations/scoped_rules`，在不扩 scope 的前提下完成 bounded target hardening。

## In Scope

- `internal_notice` current-scope / admitted regulation inventory
- promotion routing 与 `candidate / hold / manual_review_required`
- local-only candidate artifacts
- `regulations/institutional_rules` / `regulations/scoped_rules` materialization
- target-side chunk prep、metadata 与 quality acceptance
- selected first-batch promotion write gate for explicitly admitted
  collected-notice/file-release regulation candidates

## Non-goals

- auth-window `file_release` capture 或 owner recovery
- source-wide replay / unfiltered materialization
- embedding、Qdrant、release、alias publish
- collector foundation 重写或 repo-wide object storage 重构
- OCR / multimodal recovery for rows that remain `needs_multimodal`
- manual-review resolution for rows not explicitly admitted

## Success Criteria

1. 已捕获 corpus 的 admitted regulation inventory 保持稳定且可复现。
2. `institutional_rules` 与 `scoped_rules` 的 bounded target materialization 可持续回放。
3. target-side metadata、chunk prep 与 quality gate 形成明确 closeout 口径。
4. 当前 stop point 继续固定在 `offline_preparation`，不越权进入 release / publish。
5. 新的 first-batch write gate 只能推进显式 admitted 的 `8` 条 selected
   candidates，并证明 query serving / RAG release 仍关闭。

## Closeout Evidence

- final evidence: `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-08-acceptance-freeze/`
- final target split: `institutional_rules=2` / `scoped_rules=9`
- final stop point: `offline_preparation`

## Active Reopen

- active phase: `Phase 9: First-Batch Regulation Promotion Write Gate`
- input evidence:
  `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r3-regulation-normalization-quality-gate/`
- selected cohort:
  - `institutional_rules`: `594`
  - `scoped_rules`: `483`, `485`, `487`, `493`, `509`, `564`, `620`

## Canonical Entry

- `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`
