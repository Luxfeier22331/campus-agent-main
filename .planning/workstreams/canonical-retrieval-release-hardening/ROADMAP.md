---
doc_type: roadmap
status: active
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Canonical Retrieval Release Hardening

## Phase 0: Scope And Truth Alignment

**Status:** planned.

**Goal:** 冻结本 workstream 的边界、当前事实、外部 baseline 与 acceptance denominator。

**Scope:**

- 确认当前 canonical retrieval chain 的 owner 分层。
- 盘点 query-enabled scopes、retrieval-ready scopes、offline-preparation scopes。
- 盘点 release / replay / backup / retrieval runtime 的入口文件。
- 建立 phase-by-phase test denominator。

## Phase 1: Query-Enabled Truth Fix

**Status:** planned.

**Goal:** 消除 query-enabled scope 在 docs、runtime profile、Go policy、planning 中的漂移。

**Scope:**

- 决定 `official_web/stable_reference` 是否默认 query-enabled。
- 更新 architecture / planning / runtime config / Go policy。
- 保留 drift tests，防止未来再次出现多套 truth。

## Phase 2: Release Retrieval Acceptance Gate

**Status:** planned.

**Goal:** alias publish 前对 physical collection 跑 deterministic retrieval acceptance。

**Scope:**

- 新增 release acceptance case contract。
- 针对 physical collection 执行 positive qrels、hard negative、authz、current-only、
  version filter 与 evidence back-link checks。
- release CLI 支持 `--acceptance-case-path`。
- 未通过 gate 时不发布 alias。

## Phase 3: Retrieval Runtime Drift Guard

**Status:** planned.

**Goal:** runtime 查询 alias 前校验 release metadata 与当前 retrieval settings/profile 一致。

**Scope:**

- 从 Qdrant point payload 读取 release metadata。
- 必要时从 object store 读取 release manifest。
- 校验 dense/sparse/hybrid/chunk policy/current profile。
- mismatch fail closed，缓存 manifest 但保留 TTL / invalidation。

## Phase 4: Sparse And Hybrid Provenance

**Status:** planned.

**Goal:** release manifest / point payload 完整记录 sparse 与 hybrid query profile。

**Scope:**

- 增加 sparse provider/model/tokenizer/language 字段。
- 增加 RRF / dense+sparse prefetch / query instruction profile hash。
- qdrant backup / restore loader 兼容新增字段。
- provider replay preview artifact 同步记录但不发布 alias。

## Phase 5: Chunker And Tokenizer Provenance

**Status:** planned.

**Goal:** preparation manifest 能证明 chunk 结果对应具体 tokenizer、normalizer 与 chunker implementation。

**Scope:**

- 记录 tokenizer name/version、chunker implementation version、document-units schema
  version、normalizer version。
- 将这些字段纳入 preparation hash / release gate。
- 明确 config bump 与 implementation bump 的 operator rule。

## Phase 6: Embedding Cache And Cost Control

**Status:** planned.

**Goal:** 建立 deterministic embedding cache，降低 rebuild 成本并提升 replay 稳定性。

**Scope:**

- 设计 cache key 与 cache object schema。
- ingestion release 使用 cache hit，cache miss 才调用 provider。
- 校验 cached vector dimension / model identity。
- release report 记录 hit/miss/provider-call count。

## Phase 7: Eval-Driven Retrieval Tuning

**Status:** planned.

**Goal:** 让 dense/sparse/RRF/no-hit 参数由 per-collection eval 证据驱动。

**Scope:**

- 为 `student_rules`、`institutional_rules`、`curriculum_plan`、`official_web/stable_reference`
  建立 retrieval qrels mini-set。
- 覆盖 exact title/entity、long-form semantic、hard negative、version/current-only、
  authz restricted cases。
- 输出 tuning report 与 profile patch recommendation。
- 只接受 deterministic gate；supplemental judge 仅做诊断。

## Phase 8: Acceptance, Docs And Closeout

**Status:** planned.

**Goal:** 完成全链路验收、文档同步、runbook 更新与 workstream closeout。

**Scope:**

- 更新 architecture / reference / runbook。
- 运行 focused ingestion + retrieval + backup + eval gates。
- 记录未解决的真实 smoke 或 data-volume blockers。
- 将 workstream 标记 completed 或留下明确 follow-up trigger。
