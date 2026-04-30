---
doc_type: index
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Canonical Retrieval Quality Ops Hardening

这是 `canonical-retrieval-quality-ops-hardening` 的 native workstream 入口。
它承接已完成的 `canonical-retrieval-release-hardening` 之后的质量、观测、规模与
运行治理工作。

## Current Status

- status: `active`
- current phase: `Phase 0` next
- active implementation: none yet; workstream created and phase plan frozen
- current posture: release-managed `canonical -> chunk -> embedding -> retrieval` 主路径已经由
  `canonical-retrieval-release-hardening` 收口；本线不 reopen 该 workstream，而是在它的
  fail-closed release gate、runtime drift guard、chunk quality gate、qrels coverage gate 与
  sanitized observation sink 基础上补齐生产质量运营能力。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Phase Plans

- Phase 0: `./phases/phase-00-scope-and-denominator-freeze/PLAN.md`
- Phase 1: `./phases/phase-01-qrels-acceptance-expansion/PLAN.md`
- Phase 2: `./phases/phase-02-large-scale-release-benchmark/PLAN.md`
- Phase 3: `./phases/phase-03-production-retrieval-observation/PLAN.md`
- Phase 4: `./phases/phase-04-reranker-adoption-gate/PLAN.md`
- Phase 5: `./phases/phase-05-freshness-live-branch-design/PLAN.md`
- Phase 6: `./phases/phase-06-gate-separation-and-closeout/PLAN.md`

## Boundary Notes

- 本线覆盖 retrieval quality / ops，不重新设计 raw capture、official-web collector、
  authenticated-notice collector、document canonicalization ownership 或 source-specific
  ingestion policy。
- 本线不把 `campus_services/*` structured tools 改成 generic retrieval。
- 本线不把 notice title/url card search 提升成 RAG collection。
- 本线不扩大默认 query-enabled scope；新增 scope 仍必须通过 runtime profile、qrels denominator
  和 release acceptance gate。
- 本线不允许 eval tuning 自动改写 production runtime profile、serving alias 或 release manifest。
- `freshness_sensitive` / `live_assisted` 只能作为显式 query mode / target branch 规划和受控实现，
  不得混入默认 `current` retrieval。
- runtime observation 默认只保留 sanitized query identity，不常驻写入 raw query text。

## Related Architecture

- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/runbooks/index-release-runbook.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `.planning/workstreams/canonical-retrieval-release-hardening/README.md`
