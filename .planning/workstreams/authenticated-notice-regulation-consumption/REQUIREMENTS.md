---
doc_type: requirements
status: active
created: 2026-04-19
updated: 2026-05-02
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
- selected manual-review promotion write gate for explicitly resolved
  regulation rows with ready owner text
- historical selected regulation canonical backfill before downstream chunk/RAG
  consumption

## Non-goals

- auth-window `file_release` capture 或 owner recovery
- source-wide replay / unfiltered materialization
- embedding、Qdrant、release、alias publish
- collector foundation 重写或 repo-wide object storage 重构
- OCR / multimodal recovery for rows that remain `needs_multimodal`
- manual-review resolution without explicit target collection review

## Success Criteria

1. 已捕获 corpus 的 admitted regulation inventory 保持稳定且可复现。
2. `institutional_rules` 与 `scoped_rules` 的 bounded target materialization 可持续回放。
3. target-side metadata、chunk prep 与 quality gate 形成明确 closeout 口径。
4. 当前 stop point 继续固定在 `offline_preparation`，不越权进入 release / publish。
5. 新的 first-batch write gate 只能推进显式 admitted 的 `8` 条 selected
   candidates，并证明 query serving / RAG release 仍关闭。
6. 新的 manual-review write gate 只能推进显式 resolved 的 `481` / `619`，
   并证明 query serving / RAG release 仍关闭。
7. 历史 selected regulation notices 必须先通过 current canonical cleaning
   backfill，生成带 v2 cleaning provenance 的 canonical artifacts，再进入 chunk /
   RAG release 消费。

## Closeout Evidence

- Phase 8 offline-preparation evidence:
  `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-08-acceptance-freeze/`
- Phase 10 serving-admission evidence:
  `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-10-regulation-serving-admission/`
- Phase 11 manual-review admission evidence:
  `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-11-second-batch-manual-review-admission/`
- latest Phase 11 target registry postflight split:
  `institutional_rules=3` / `scoped_rules=16`
- latest Phase 11 stop point: target materialization; no RAG release / serving
  opening for new targets
- Phase 13 canonical backfill implementation:
  `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-13-historical-regulation-canonical-backfill/`

## Latest Reopen

- latest reopened phase: `Phase 13: Historical Regulation Canonical Backfill`
- input evidence:
  `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1-regulation-candidate-audit-and-admission/`
- selected cohort:
  - `institutional_rules`: `594`, `619`
  - `scoped_rules`: `481`, `483`, `485`, `487`, `493`, `509`, `564`, `620`
- status: implementation completed; run Phase 13 worker `--execute` in target
  operator environment before RAG release admission

## Canonical Entry

- `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`
