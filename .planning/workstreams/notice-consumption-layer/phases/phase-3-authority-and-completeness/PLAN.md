---
doc_type: phase_plan
phase: "3"
phase_name: "Authority And Completeness"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 3 Plan

## Objective

冻结 `derived consumption unit` 的 authority / completeness / answerability contract，
让后续 work 不再重复争论“正文能不能替代附件”“附件没抓到是不是等于 manual review”
“同一 notice 下能不能同时存在可答与 fail-close 单元”，并为 `Phase 4` 的 agent/surface
handoff 提供稳定输入。

## Why This Phase Exists

当前 repo 已经有：

- `Phase 1` 冻结后的 source family / layering truth
- `Phase 2` 冻结后的 derived-unit schema 位
- authenticated notice source-truth / inventory / promotion 对 owner、wrapper、missing-owner、manual-review 的已有 pattern

当前 repo 还没有：

- `semantic_owner` 的正式 derivation rule
- `attachments_declared` / `attachments_captured` 的 consumption-layer 定义
- `completeness_status` / `answerability` 的正式 derivation
- `body_only_answerable` 与 `authoritative_attachment_missing` 的边界

如果不先做这一步，后续 phase 会持续漂移：

- `notice_window` 会不会被附件缺失一起拖成不可答
- `annual_cycle_rule` 会不会被 wrapper notice 正文静默冒充
- `manual_review_required` 与 `reference_only` 会不会被误当成 capture 缺失
- `body_only_answerable` 会不会被误写成 future rule/service surface 的 admission 依据

## Locked Inputs

- `source_notice -> notice_attachment -> derived consumption unit` 三层关系已冻结。
- `derived consumption unit` 的 root schema 已冻结：
  - `semantic_owner`
  - `completeness_status`
  - `answerability`
  已是正式字段。
- `authenticated_notice` source-truth 已冻结：
  - `attachment-refs.jsonl`
  - `owner_expectations`
- attachment lane 已冻结显式终态：
  - `reference_only`
  - `manual_review_required`
  - `no_extractable_text`
  - `unsupported_binary`
- 本 phase 不 admission `file_release_document` 为 root owner enum，也不执行 owner recovery。

## Decisions To Freeze

1. authority / completeness / answerability 的判定单位固定为单个 `derived consumption unit`，不是整条 `source_notice`。
2. authority / precedence 固定按 unit owner 决定：
   - `attachment_document`
     - 已捕获 attachment body 是 canonical owner
   - `notice_body`
     - notice 正文自身已经提供完整 answer-bearing body
   - `wrapper_notice`
     - 只承载 publication / reference / provenance 级事实
   - `authority_pending`
     - 上游明示 authoritative owner 应存在，但当前 owner 尚未恢复到可消费真相
3. `attachments_declared` 固定表示 source notice 明示存在的 owner candidates，至少来自：
   - `attachment-refs.jsonl`
   - `owner_expectations`
   - notice body 中显式 owner 指向信号
4. `attachments_captured` 固定表示 declared owner 中已恢复为 source-level relation truth 的子集；它至少要能回链到稳定 relation 与已知 outcome。
5. `semantic_owner` derivation 固定为：
   - body 已完整承载该 unit 正文 -> `notice_body`
   - captured attachment 承载该 unit 正文 -> `attachment_document`
   - unit 只保留 wrapper/reference fact -> `wrapper_notice`
   - authoritative owner 应存在但当前未恢复/未可用 -> `authority_pending`
6. `completeness_status` 固定只允许：
   - `complete`
   - `authoritative_attachment_missing`
   - `manual_review_required`
   - `reference_only`
7. `answerability` 固定至少允许：
   - `answerable`
   - `body_only_answerable`
   - `manual_review_required`
   - `reference_only`
   - `not_answerable`
8. completeness derivation 固定为：
   - `complete`
     - required owner 已恢复，且当前 unit 已具备其最小 canonical body
   - `authoritative_attachment_missing`
     - unit 依赖 attachment/file-backed owner，但 owner relation、bytes 或 child owner truth 尚未恢复
   - `manual_review_required`
     - owner 已捕获，但当前 admitted lane 只能落到 manual outcome
   - `reference_only`
     - 当前 unit 只保留 reference/provenance，不主张存在 answer-bearing owner body
9. answerability derivation 固定为：
   - `answerable`
     - unit 已 `complete`，且当前 consumer 可以直接读取 canonical body
   - `body_only_answerable`
     - unit 未形成 attachment-backed canonical owner，但 notice body 已独立满足最小 answer contract
   - `manual_review_required`
     - 当前只能停在 manual lane，不可自动回答
   - `reference_only`
     - 当前只允许返回 reference / provenance / follow-up 指引，不允许伪装成正文已读
   - `not_answerable`
     - 当前 authoritative owner 未恢复，且 body 也不足以独立回答
10. `manual_review_required` 与 `reference_only` 不得被重写成 `authoritative_attachment_missing`：
    - 前者是 captured-but-not-automatable
    - 后者是 intentionally non-answer-bearing
11. `body_only_answerable` 只允许支持 bounded notice-runtime 解释，不得自动成为 future `regulations/*` / `service_status_runtime` adoption truth。
12. unresolved `file_release` owner 一律收口为：
    - `semantic_owner=authority_pending`
    - completeness / answerability 再决定 fail-close
13. attachment lane 的 `no_extractable_text` / `unsupported_binary` 继续保持 lane-local truth；如果它们阻断 required owner，则 unit answerability 必须不是 `answerable`，但本 phase 不另增 root completeness enum。

## Execution Slices

### Slice 1: Freeze Unit-Level Decision Scope

- 明确 authority / completeness / answerability 都属于 unit-level derivation。
- 明确同一条 notice 可同时产出：
  - `complete + answerable` unit
  - `authority_pending + not_answerable` unit

### Slice 2: Freeze Owner And Authority Rules

- 冻结 `notice_body`、`attachment_document`、`wrapper_notice`、`authority_pending` 的判定边界。
- 明确 wrapper text 不能替代缺失 attachment/file owner。
- 明确 file-release-backed unresolved owner 在本 phase 统一落到 `authority_pending`。

### Slice 3: Freeze Declared vs Captured Attachment Contract

- 冻结 `attachments_declared` 的来源集合。
- 冻结 `attachments_captured` 的最小要求。
- 明确“声明了 owner 但未恢复 relation/bytes”与“owner 已捕获但终态非 answer-bearing”是两类不同问题。

### Slice 4: Freeze Completeness Matrix

- 冻结 `complete`
- 冻结 `authoritative_attachment_missing`
- 冻结 `manual_review_required`
- 冻结 `reference_only`
- 明确它们与 attachment lane outcome 的关系

### Slice 5: Freeze Answerability Matrix

- 冻结 `answerable`
- 冻结 `body_only_answerable`
- 冻结 `manual_review_required`
- 冻结 `reference_only`
- 冻结 `not_answerable`
- 明确 `body_only_answerable` 不是开放 surface 的 admission shortcut

### Slice 6: Freeze Worked-Example Expectations

- exemplar notice:
  - `关于启动2026届推荐优秀应届本科毕业生免试攻读研究生工作的通知`
- 预期至少允许：
  - `notice_window`
    - `semantic_owner=notice_body`
    - `completeness_status=complete`
    - `answerability=answerable`
  - `annual_cycle_rule`
    - 如果实施办法 attachment 未恢复出来：
      - `semantic_owner=authority_pending`
      - `completeness_status=authoritative_attachment_missing`
      - `answerability=not_answerable`
- 明确二者可以同时存在，彼此不互相覆盖

### Slice 7: Prepare Phase 4 Handoff

- 为 `Phase 4` 固定输入：
  - 哪些 unit 状态允许进入 `notice-agent`
  - 哪些只允许 reference/manual outcome
  - 哪些未来才可能进入 `rag-agent` / `campus-services-agent` target surface

## Proposed Write Set

- `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/PLAN.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/WORKSTREAMS.md`
- `docs/plans/archive/completed/notice-consumption-layer.md`

## Verification Matrix

- phase artifact verification
  - `Phase 3` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向本 phase plan
- planning progression verification
  - `ROADMAP.md` 将 `Phase 2` 标记为已完成
  - `WORKSTREAMS.md` 的当前 phase 前移到 `Phase 3`
- contract verification
  - planning truth 明确区分：
    - `authoritative_attachment_missing`
    - `manual_review_required`
    - `reference_only`
  - planning truth 明确 `body_only_answerable` 只是窄例外，不是 surface-admission shortcut
  - planning truth 明确 file-release-backed unresolved owner 在本 phase 归并为 `authority_pending`
- scope verification
  - planning truth 不重开 schema 设计
  - planning truth 不 admission file-release recovery execution
  - planning truth 不打开任何新 query surface

## Exit Rule

Phase 3 完成后，repo 应达到：

- `semantic_owner`、`completeness_status`、`answerability` 的 derivation 已经冻结
- 同一条 notice 下 mixed outcome 的合法性已经写清
- `attachments_declared` / `attachments_captured` 的 contract 已经正式落盘
- wrapper notice、attachment owner、missing owner 之间的 authority 边界已经稳定
- `Phase 4` 可以直接围绕 agent/surface handoff 继续推进
