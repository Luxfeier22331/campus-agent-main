---
doc_type: requirements
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Requirements: Authenticated Notice Regulation Consumption

## Goal

把已捕获的 `internal_notice` regulation cohort 稳定下游消费到 `regulations/institutional_regulations` 与 `regulations/scoped_rules`，在不扩 scope 的前提下完成 bounded target hardening。

## In Scope

- `internal_notice` current-scope / admitted regulation inventory
- promotion routing 与 `candidate / hold / manual_review_required`
- local-only candidate artifacts
- `regulations/institutional_regulations` / `regulations/scoped_rules` materialization
- target-side chunk prep、metadata 与 quality acceptance

## Non-goals

- auth-window `file_release` capture 或 owner recovery
- source-wide replay / unfiltered materialization
- embedding、Qdrant、release、alias publish
- collector foundation 重写或 repo-wide object storage 重构

## Success Criteria

1. 已捕获 corpus 的 admitted regulation inventory 保持稳定且可复现。
2. `institutional_regulations` 与 `scoped_rules` 的 bounded target materialization 可持续回放。
3. target-side metadata、chunk prep 与 quality gate 形成明确 closeout 口径。
4. 当前 stop point 继续固定在 `offline_preparation`，不越权进入 release / publish。

## Canonical Entry

- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`
