---
doc_type: index
status: completed
created: 2026-04-22
updated: 2026-05-02
---

# Workstream: Authenticated Notice Regulation Consumption

这是 `authenticated-notice-regulation-consumption` 的 native workstream 入口。
它只负责已捕获 `internal_notice` corpus 的 bounded downstream consumption，不负责 auth-window `file_release` capture 或 owner recovery。

## Current Status

- status: `completed`
- completed phase: `Phase 13`
- closeout: collected-notice Phase 6R/7 已证明 ready 的 `8` 条 regulation
  candidates 已通过 selected promotion write gate 进入
  `regulations/institutional_rules` / `regulations/scoped_rules` target
  materialization；Phase 10 已完成 provenance hardening、chunk-preparation、
  Qdrant release alias、gated reader assets 与 retrieval smoke。`institutional_rules`
  已进入默认 query-serving allowlist；`scoped_rules` 只保持 retrieval-ready /
  explicit-internal posture，不进入默认 query allowlist；public-chat citation 仍关闭。
  Phase 11 已把 `481` / `619` 两条已解决 manual-review regulation rows 通过
  显式 target resolution 写入 target materialization，但未打开 RAG release 或
  query serving。Phase 12 将 canonical cleaning 前移到 materialization；Phase 13
  增加历史 selected cohort backfill，使 Phase 9/11 既有 regulation notices 可先重建
  current canonical artifacts，再进入独立 RAG release lane。

## Closeout Evidence

- `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-08-acceptance-freeze/`
- `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-09-first-batch-regulation-promotion-write-gate/`
- `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-10-regulation-serving-admission/`
- `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-11-second-batch-manual-review-admission/`
- `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-13-historical-regulation-canonical-backfill/`

## Completed Phase

- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-09-first-batch-regulation-promotion-write-gate/CONTEXT.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-09-first-batch-regulation-promotion-write-gate/PLAN.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-09-first-batch-regulation-promotion-write-gate/SUMMARY.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-10-regulation-serving-admission/PLAN.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-10-regulation-serving-admission/SUMMARY.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-11-second-batch-manual-review-admission/PLAN.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-11-second-batch-manual-review-admission/SUMMARY.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-13-historical-regulation-canonical-backfill/PLAN.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-13-historical-regulation-canonical-backfill/SUMMARY.md`

## Reopen Rule

只有在下一批 regulation candidates 被 admission、`32` 个 multimodal blocked 被解决，
Phase 11 新 materialized target 进入 RAG release / serving admission，
`scoped_rules` 被提升为默认 query allowlist，public-chat citation / public reader
被显式打开，或 regulation serving evidence 与当前 runtime/profile/alias truth
漂移时恢复。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- superseded plan snapshot: `../../../docs/plans/archive/superseded/internal-notice-policy-regulation-consumption-implementation.md`
