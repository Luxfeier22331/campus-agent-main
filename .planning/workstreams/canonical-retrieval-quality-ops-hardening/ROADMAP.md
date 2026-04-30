---
doc_type: roadmap
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Canonical Retrieval Quality Ops Hardening

## Status Semantics

All phases have `PLAN.md` files so the generic `gsd-sdk workstream.status` helper reports them
as `in_progress`. For this workstream, execution truth is the explicit `Status:` line in this
roadmap plus `STATE.md`: Phase 0 is next, and Phases 1-6 are planned but not started.

## Phase 0: Scope And Denominator Freeze

**Status:** completed on 2026-05-01.

**Goal:** 冻结本 workstream 的边界、query-enabled collection denominator、scenario taxonomy、
baseline external guidance 与 phase-by-phase verification plan。

**Scope:**

- 确认本线不是 `canonical-retrieval-release-hardening` reopen。
- 盘点当前 query-enabled collections、retrieval-ready but default-off collections 与
  offline-preparation collections。
- 盘点现有 qrels fixtures、release acceptance cases、chunk quality reports 与 runtime observation
  outputs。
- 定义 qrels scenario denominator：title/entity exact、long semantic、hard negative、no-hit、
  current-only、historical/as_of/compare、authz filtered、citation/source back-link、freshness。
- 冻结 observation privacy posture：默认只存 `query_sha256`，raw query 只能 operator debug 临时开。

**Outputs:**

- Phase 0 summary / inventory evidence。
- qrels scenario denominator contract draft。
- 之后 phases 的 focused verification matrix。

**Evidence:** `./phases/phase-00-scope-and-denominator-freeze/SUMMARY.md`.

## Phase 1: Qrels And Acceptance Expansion

**Status:** not started.

**Goal:** 将 qrels / release acceptance 从 bootstrap fixture 扩成 collection-level denominator，并让
缺 case / 缺 scenario 的 publish 继续 fail closed。

**Scope:**

- 扩展 `packages/evals/fixtures/*_retrieval_qrels.json`。
- 为每个默认 query-enabled scope 增加 required scenarios 与 minimum case counts。
- 增加 missing scenario / missing class / missing case id 的 validator coverage。
- 将 runtime observations 中的 no-hit / low-confidence / forbidden hit 候选纳入 pending qrels
  candidate manifest，而不是直接修改 canonical qrels。
- 更新 release acceptance tests 和 runbook。

**Acceptance:**

- qrels coverage gate 对 required scenario denominator fail closed。
- 默认 query-enabled scope 的 fixture 覆盖不少于 Phase 0 定义的 required scenarios。
- focused eval / ingestion release gate tests 通过。

## Phase 2: Large-Scale Release Benchmark

**Status:** not started.

**Goal:** 建立可重复的 release rebuild / embedding / Qdrant index / query latency benchmark，证明
规模、成本、cache 与 alias publish posture。

**Scope:**

- 新增 benchmark harness，支持 real corpus、sample corpus 与 synthetic scale multiplier。
- 记录 canonical document count、document-unit count、chunk count、token estimate、embedding
  provider call count、cache hit/miss、retry count、Qdrant upsert latency、payload index latency、
  post-publish audit latency、alias publish latency。
- 支持 dry-run provider mode 与 real provider mode；real provider mode 需要显式 env admission。
- 输出 JSON report 与 human summary。
- 不自动 publish alias；benchmark evidence 不能绕过 release gate。

**Acceptance:**

- local dry-run benchmark 可稳定运行。
- report schema 有 tests。
- real provider smoke 如凭据可用则记录；不可用时明确 blocked，不伪装通过。

## Phase 3: Production Retrieval Observation

**Status:** not started.

**Goal:** 将 JSONL debug sink 提升为可接入生产的 durable observation seam，同时保持隐私默认值和
answer path fail-safe。

**Scope:**

- 定义 retrieval observation event schema：request/trace correlation、scope、query mode、
  release id、profile hash、topK、filter counts、latency、failure kind、query sha。
- 保留 JSONL sink 作为 local/debug sink。
- 增加 durable sink interface / adapter，允许后续接入 OTel-compatible logs/events 或 repo-owned
  operator observation storage。
- observation sink failure 只 warning，不破坏在线 answer path。
- backlog generation 支持 no-hit、low-confidence、forbidden hit、version mismatch、release drift、
  reranker fallback/degraded。

**Acceptance:**

- retrieval runtime 能同时支持 no sink、JSONL sink、durable sink test double。
- raw query text 默认不落盘。
- failed retrieval / drift / sink failure 都有 deterministic tests。

## Phase 4: Reranker Adoption Gate

**Status:** not started.

**Goal:** 把 reranker 从 eval-only branch 推进到 profile-gated runtime candidate，而不是直接全局打开。

**Scope:**

- 明确 baseline：dense+sparse hybrid + RRF first-stage retrieval。
- reranker 只对 bounded candidate set 生效。
- 增加 collection-level deterministic before/after eval：nDCG、MRR、Hit@K、context precision、
  latency、cost。
- runtime profile 增加显式 reranker opt-in 字段与 release/profile provenance。
- reranker failure / timeout fallback 到 baseline hybrid/RRF，并写 degraded observation。

**Acceptance:**

- 未 opt-in collection 不走 reranker。
- opt-in collection 缺 deterministic eval evidence 时 fail closed。
- fallback 不破坏 answer path，且可观测。

## Phase 5: Freshness And Live-Assisted Branch Design

**Status:** not started.

**Goal:** 将 `freshness_sensitive` / `live_assisted` 作为显式 query branch 设计和受控实现入口，
避免动态事实污染默认 current retrieval。

**Scope:**

- 明确 `current`、`freshness_sensitive`、`live_assisted` 的 query mode admission。
- 定义 freshness SLA / source timestamp / release age 判定。
- `freshness_sensitive` 过期时 fail closed 或转 live branch，不静默使用旧 index 回答动态事实。
- `live_assisted` 结果作为 live evidence 标注，不写入 canonical index。
- 增加动态事实、过期事实、false-premise、近期通知类 eval cases。

**Acceptance:**

- 默认 `current` retrieval 行为不变。
- freshness/live 只能通过显式 query mode 或 explicit planner decision 进入。
- answer evidence 能携带 `as_of` / source timestamp / retrieval mode。

## Phase 6: Gate Separation And Closeout

**Status:** not started.

**Goal:** 固定 focused workstream gate、affected gate、repo-wide gate 与 unrelated blockers 的记录
口径，并完成 docs/runbook/workstream closeout。

**Scope:**

- 为 Python retrieval/ingestion/evals 建立 focused gate 列表。
- 为 JS/TS repo gate 记录 affected / root gate 入口，不把 unrelated dirty files 归咎本线。
- 更新 retrieval architecture、runbook、planning state。
- 记录真实 smoke、benchmark、qrels expansion、observation 与 reranker/freshness branch 的 remaining
  risks。
- workstream completion / reopen rule。

**Acceptance:**

- phase summaries 记录每阶段 verification。
- workstream closeout 明确 repo-wide blockers 是否 unrelated。
- `.planning/WORKSTREAMS.md` registry 状态与本线 `STATE.md` 一致。
