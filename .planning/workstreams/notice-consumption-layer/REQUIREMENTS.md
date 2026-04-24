---
doc_type: requirements
status: completed
created: 2026-04-21
updated: 2026-04-24
---

# Requirements: Notice Consumption Layer

## Goal

把 `notice-consumption-layer` 从 semantic modeling truth 收口成真实 implementation：
在 `source_notice` 与 downstream consumer 之间补 repo-owned persisted projection，
使 notice 的 derived-unit routing、hold/manual/no-adoption 状态与 target-ready 判定成为可重放、可查询的 metadata truth。

## In Scope

- 保留并继续执行 `source_notice`、`notice_attachment`、`derived consumption unit` 的既有 schema / authority / handoff truth
- notice consumption projection shared model
- projection store / canonical rebuild path
- `internal_notice_restricted` source family 的第一版 implementation
- `regulations/institutional_rules` / `regulations/scoped_rules` consumer 通过 projection 过滤 ready candidate
- “一条 notice 当前是否仍停在 notice runtime、是否 ready for target、是否 manual/no-adoption” 的显式状态落盘

## Non-goals

- 直接打开 notice runtime、`scoped_rules` 或任何新的 query-serving surface
- 重写 `Phase 1-5` 已冻结的 source family / schema / authority 基线
- 重开 auth-window `file_release` owner recovery
- 重做 `authenticated-notice-regulation-consumption` 的 target-side chunk prep / acceptance closeout
- 把 procurement / lecture / roster 的全部 future surface 一次做完

## Success Criteria

1. repo 中存在 repo-owned persisted notice consumption projection store，而不是只剩 planning 语义。
2. `internal_notice` 的 regulation / scoped downstream consumer 不再直接以 source holding collection 作为唯一决策输入，而是读取 projection 的 ready derived-unit truth。
3. 至少能显式记录：
   - `notice_window`
   - `attachment_rule_body`
   - `annual_cycle_rule`
   - `time_bound_operational_rule`
   的 `default_agent` / `target_surface` / `completeness_status` / `answerability` / current consumption status。
4. operator 或后续 consumer 可以回答：
   - 一条 notice 当前是否已形成 target-ready consumption unit
   - 为什么还停在 notice runtime
   - 为什么是 manual review / no-adoption
5. `notice-consumption-layer` 不再错误地被表述为 “只要 modeling closeout 就完成”。
6. internal notice 的 non-regulation derived-unit coverage 至少覆盖 `procurement_notice`、internal restricted no-adoption、`service_status_override` 与 `attachment_form_template`，且不打开新的 query-serving/runtime surface。

## Canonical Entry

- `.planning/workstreams/notice-consumption-layer/README.md`
