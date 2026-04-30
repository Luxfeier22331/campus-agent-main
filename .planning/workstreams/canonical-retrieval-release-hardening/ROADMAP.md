---
doc_type: roadmap
status: completed
created: 2026-04-30
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Canonical Retrieval Release Hardening

## Status Semantics

All phases have `PLAN.md` files so the generic `gsd-sdk workstream.status` helper reports
them as `in_progress`. For this workstream, execution truth is the explicit `Status:` line in
this roadmap plus `STATE.md`: Phases 0-9 are complete.

## Phase 0: Scope And Truth Alignment

**Status:** completed.

**Goal:** 冻结本 workstream 的边界、当前事实、外部 baseline 与 acceptance denominator。

**Scope:**

- 确认当前 canonical retrieval chain 的 owner 分层。
- 盘点 query-enabled scopes、retrieval-ready scopes、offline-preparation scopes。
- 盘点 release / replay / backup / retrieval runtime 的入口文件。
- 建立 phase-by-phase test denominator。

**Evidence:** `./evidence/phase-00-current-inventory.md`.

## Phase 1: Query-Enabled Truth Fix

**Status:** completed.

**Goal:** 消除 query-enabled scope 在 docs、runtime profile、Go policy、planning 中的漂移。

**Scope:**

- 决定 `official_web/stable_reference` 是否默认 query-enabled。
- 更新 architecture / planning / runtime config / Go policy。
- 保留 drift tests，防止未来再次出现多套 truth。

**Evidence:** `./phases/phase-01-query-enabled-truth-fix/SUMMARY.md`.

## Phase 2: Release Retrieval Acceptance Gate

**Status:** completed.

**Goal:** alias publish 前对 physical collection 跑 deterministic retrieval acceptance。

**Scope:**

- 新增 release acceptance case contract。
- 为每个默认 query-enabled collection 准备最低 bootstrap cases；缺 fixture 时 publish fail
  closed。
- 针对 physical collection 执行 positive qrels、hard negative、authz、current-only、
  version filter 与 evidence back-link checks。
- release CLI 支持 `--acceptance-case-path`。
- 未通过 gate 时不发布 alias。

**Evidence:** `./phases/phase-02-release-retrieval-acceptance-gate/SUMMARY.md`.

## Phase 3: Sparse And Hybrid Provenance

**Status:** completed.

**Goal:** release manifest / point payload 完整记录 sparse 与 hybrid query profile。

**Scope:**

- 增加 sparse provider/model/tokenizer/language 字段。
- 增加 RRF / dense+sparse prefetch / query instruction profile hash。
- qdrant backup / restore loader 兼容新增字段。
- provider replay preview artifact 同步记录但不发布 alias。

**Evidence:** `./phases/phase-03-sparse-and-hybrid-provenance/SUMMARY.md`.

## Phase 4: Chunker And Tokenizer Provenance

**Status:** completed.

**Goal:** preparation manifest 能证明 chunk 结果对应具体 tokenizer、normalizer 与 chunker implementation。

**Scope:**

- 记录 tokenizer name/version、chunker implementation version、document-units schema
  version、normalizer version。
- 将这些字段纳入 preparation hash / release gate。
- 明确 config bump 与 implementation bump 的 operator rule。

**Evidence:** `./phases/phase-04-chunker-tokenizer-provenance/SUMMARY.md`.

## Phase 5: Retrieval Runtime Drift Guard

**Status:** completed.

**Goal:** runtime 查询 alias 前校验 release metadata 与当前 retrieval settings/profile 一致。

**Scope:**

- 从 Qdrant point payload / current release metadata 读取 drift guard 所需字段。
- 不在 online query path 扫描 object-store prefix，object-store manifest 只用于 audit /
  offline fallback。
- 校验 dense/sparse/hybrid/chunk policy/current profile。
- mismatch fail closed，缓存 alias release validation result 并保留 TTL / invalidation。

**Evidence:** `./phases/phase-05-retrieval-runtime-drift-guard/SUMMARY.md`.

## Phase 6: Embedding Cache And Cost Control

**Status:** completed.

**Goal:** 建立 deterministic embedding cache，降低 rebuild 成本并提升 replay 稳定性。

**Scope:**

- 设计 cache key 与 cache object schema。
- ingestion release 使用 cache hit，cache miss 才调用 provider。
- 校验 cached vector dimension / model identity。
- release report 记录 hit/miss/provider-call count。
- 该 phase 是成本与稳定性 hardening，不是 Phase 2 publish safety gate 的前置条件；如
  release rebuild 成本成为阻塞，可在 Phase 3/4 provenance 后提前执行。

**Evidence:** `./phases/phase-06-embedding-cache-and-cost-control/SUMMARY.md`.

## Phase 7: Eval-Driven Retrieval Tuning

**Status:** completed.

**Goal:** 让 dense/sparse/RRF/no-hit 参数由 per-collection eval 证据驱动。

**Scope:**

- 为 `student_rules`、`institutional_rules`、`curriculum_plan` 建立 retrieval qrels
  mini-set；`official_web/stable_reference` 只有在 Phase 1 保持默认 query-enabled 时才进入
  同一 gate。
- 覆盖 exact title/entity、long-form semantic、hard negative、version/current-only、
  authz restricted cases。
- 输出 tuning report 与 profile patch recommendation。
- 只接受 deterministic gate；supplemental judge 仅做诊断。

**Evidence:** `./phases/phase-07-eval-driven-retrieval-tuning/SUMMARY.md`.

## Phase 8: Acceptance, Docs And Closeout

**Status:** completed.

**Goal:** 完成全链路验收、文档同步、runbook 更新与 workstream closeout。

**Scope:**

- 更新 architecture / reference / runbook。
- 运行 focused ingestion + retrieval + backup + eval gates。
- 记录未解决的真实 smoke 或 data-volume blockers。
- 将 workstream 标记 completed 或留下明确 follow-up trigger。

**Evidence:** `./phases/phase-08-acceptance-docs-and-closeout/SUMMARY.md`.

## Phase 9: Post-Review Release-Quality Closeout

**Status:** completed.

**Goal:** 将 Phase 8 后 review 识别出的 helper-only / sample-only / identity-too-narrow
缺口收敛为 release blocking gate、runtime fail-close guard 与 eval/monitoring denominator。

**Scope:**

- 将 chunk quality 从 eval helper 升级为 query-serving alias publish 前的 blocking gate。
- 在 release manifest / point payload 中记录 quality gate、chunk quality、qrels coverage 与
  release metadata consistency status。
- 将 runtime drift guard 从单 point payload 读取升级为 collection metadata / multi-point
  sampled consistency 校验，并把 cache key 绑定 profile identity。
- 将 query embedding cache key 扩展为 provider/model/dimension + collection/profile
  identity，避免跨模型或 profile 复用 query embedding。
- 将默认 query-enabled qrels coverage 从 class/count 检查升级为 declared scenario
  denominator 检查。
- 为 retrieval monitoring 增加 sanitized runtime observation JSONL loader 与 backlog JSON
  CLI。

**Evidence:** `STATE.md` Phase 9 focused gate。
