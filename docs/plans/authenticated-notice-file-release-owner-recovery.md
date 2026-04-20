---
doc_type: plan
status: deferred
created: 2026-04-18
updated: 2026-04-20
---

# Authenticated Notice File-Release Owner Recovery

## 文档边界

本文固定 auth-dependent `file_release` capture / owner recovery 这条独立 workstream。

它负责：

- auth-window targeted `file_release` capture
- source-byte verification
- owner body recovery
- 将 recovered owner body 回接 downstream promotion / materialization

它不负责：

- non-auth `internal_notice -> regulations/*` downstream hardening
- source-wide export / replay
- collector foundation 重写
- embedding、Qdrant、release、alias publish

相关文档：

- `docs/reference/authenticated-notice-file-release-export-contract.md`
- `docs/reference/authenticated-notice-file-release-owner-recovery-readiness-contract.md`
- `docs/runbooks/authenticated-notice-file-release-auth-window-runbook.md`
- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`

## Execution Contract

这条线始终按一条 auth-dependent workstream 推进：

`auth-window targeted capture -> source-byte verification -> owner body recovery -> promotion/materialization re-entry -> bounded validation`

固定解释：

- `notice`、`file_release` 与 regulation owner body 继续保持三层分离
- `file_release` 只能补 owner body，不反向改写 `internal_notice` source-truth contract
- exact active slice、auth window 状态与执行进度只写在 `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`

## Current Baseline

当前 repo 已冻结的前提：

- `file_release` export contract 已有 repo-tracked bundle / manifest 形状
- auth-window operator 顺序已固定为 `auth:check -> targeted export -> bounded verify`
- readiness taxonomy 已固定为：
  - `ready`
  - `missing_capture`
  - `missing_source_bytes`
  - `ambiguous_match`
- auth-dependent missing owner body 不再混写到 non-auth downstream workstream

## First Bounded Slice

默认首条恢复切片固定为：

- `351119 / 中央民族大学差旅费管理办法（民大校发〔2025〕104号）`

固定原则：

- 先 targeted capture
- 再做 owner recovery
- 再回接 bounded promotion / materialization rerun
- 不用 full export、source-wide replay 或 collector 改造代替这一步

## Forward Phases

### Phase A: Auth-Window Readiness And Capture

目标：

- 在认证窗口内完成 `auth:check`
- 生成目标 `file_release` 的 bounded export artifact

退出条件：

- target `file_release` bundle / manifest / source locator 已落盘
- readiness 不再停留在 `missing_capture`

### Phase B: Source-Byte Verification

目标：

- 验证导出物与 source bytes 可消费

退出条件：

- bundle / manifest / source bytes 一致
- blocker 不再停留在 `missing_source_bytes` / `ambiguous_match`

### Phase C: Owner Body Recovery

目标：

- 将 bounded `file_release` 还原成可消费的 regulation owner body

退出条件：

- recovered owner body 可进入 canonical downstream consumer
- 不再需要用 wrapper notice 正文冒充 owner text

### Phase D: Promotion / Materialization Re-entry

目标：

- 把 recovered owner body 回接到现有 promotion/materialization path

退出条件：

- target rerun 只覆盖 bounded candidate
- 非 auth downstream truth 不被整线重跑

### Phase E: Bounded Validation

目标：

- 对 recovered target 做 bounded validation，并回写 planning truth

退出条件：

- bounded target validation 完成
- `.planning` 已记录该切片结果与剩余 frontier

## Exclusions

固定不包含：

- full `file_release` inventory refresh
- source-wide replay / materialization
- shared OCR / chunk policy 泛化
- release / alias publish

## Handoff Rule

后续接手时：

1. 先看 `.planning/WORKSTREAMS.md`
2. 再看对应 workstream `STATE.md`
3. 再回到本文确认固定 phase order 与 bounded slice 规则

不要把 auth-window capture、owner recovery 和 non-auth downstream 再次混成一条线。
