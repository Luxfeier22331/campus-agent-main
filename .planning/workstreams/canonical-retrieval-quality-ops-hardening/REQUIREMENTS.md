---
doc_type: requirements
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Canonical Retrieval Quality Ops Hardening

## Goal

把已经 release-safe 的 `canonical -> chunk -> embedding -> retrieval` 主路径继续推进到
production quality / operations ready：qrels denominator 足够覆盖真实校园问答风险，release
规模成本可测，runtime failure 可观测可回流，reranker 有 deterministic adoption gate，
freshness/live 分支显式而不污染默认 current retrieval，repo-wide gate 与 workstream focused
gate 清晰分层。

## Background

前置 workstream `canonical-retrieval-release-hardening` 已完成：

- alias publish 前 deterministic retrieval acceptance gate
- chunk quality release blocking gate
- qrels coverage fail-closed gate
- release manifest / point payload provenance
- runtime drift guard
- embedding cache identity hardening
- Qdrant payload index audit
- sanitized JSONL runtime observation sink
- deterministic rerank before/after eval branch

本线只处理该主路径之后仍剩的质量与运营缺口。

## External Baseline

本线按以下外部 baseline 落地到仓库场景：

- OpenAI eval best practices：eval set 应混合 domain samples、historical/production cases 与
  edge cases，并持续加入 failure observations。
- RAG evaluation / best-practice literature：retrieval quality 需要同时评估 chunking、embedding、
  hybrid retrieval、reranking、context relevance、faithfulness 与 freshness。
- Qdrant production guidance：query-time filter 字段需要 payload index，index 应在 points upsert
  前建立并纳入 audit。
- OpenTelemetry guidance：生产观测应让 logs/traces/metrics 可按 resource、trace/span、request
  关联，而不是只依赖本地文件。
- Turborepo / monorepo CI guidance：repo-wide gate 与 focused/affected gate 应分层，避免无关脏
  工作区掩盖当前 workstream 结论。

## In Scope

- query-enabled collections 的 qrels / acceptance fixture denominator 扩容。
- qrels coverage policy 从“有 fixture”推进到“有 required scenario denominator”。
- large-scale release benchmark：chunk count、embedding calls、cache hit/miss、Qdrant upsert、
  payload index audit、alias publish、query latency 与 cost report。
- production-grade retrieval observation intake：schema、privacy posture、durable sink seam、
  backlog generation 与 failure classification。
- reranker adoption gate：deterministic before/after eval、latency/cost budget、runtime profile
  opt-in、fallback posture。
- explicit `freshness_sensitive` / `live_assisted` branch design and gated implementation plan。
- workstream focused gates 与 repo-wide gates 的 documented separation。
- docs / runbook / planning truth update。

## Non-goals

- 不重新打开 `canonical-retrieval-release-hardening`，除非它的 reopen rule 被命中。
- 不修改 raw asset capture、source-specific collector 或 source-truth schema ownership。
- 不把 operator observation 反向写入 release manifest、runtime profile、canonical qrels 或 alias truth。
- 不让 supplemental judge 成为 alias publish 或 profile patch 的唯一通过依据。
- 不把 reranker 直接作为全局默认 runtime path。
- 不把 live source result 写入 canonical index；live evidence 必须显式标注模式与时间。
- 不解决 unrelated worktree dirty files、authenticated-notice queue、tool governance 或 public web UI 事项。

## Success Criteria

1. 每个默认 query-enabled collection 都有扩展 qrels denominator，覆盖 positive、hard negative、
   no-hit、title/entity exact match、long-form semantic、version/current-only、authz filtered、
   citation back-link 与 source freshness-relevant cases。
2. release acceptance 可以报告 missing scenario / missing class / missing fixture，并保持 fail
   closed；缺 denominator 不得 publish alias。
3. release benchmark CLI 能在 dry-run / real provider mode 下输出稳定 JSON report，并记录规模、
   latency、cost、cache 与 Qdrant index/upsert 指标。
4. runtime observation 有 sanitized durable intake seam；JSONL 只保留为 local/debug sink，生产
   sink failure 不破坏 answer path，但必须产生 warning / failure observation。
5. no-hit、low-confidence、forbidden hit、version mismatch、release metadata drift 与 reranker
   degraded/fallback 都能进入 eval/backlog candidate。
6. reranker 只有在 collection-level deterministic eval 同时满足 retrieval quality、latency 与 cost
   budget 时才允许 profile opt-in；失败时 fallback 到 baseline hybrid/RRF。
7. `freshness_sensitive` / `live_assisted` query mode 与默认 `current` retrieval 分离；回答必须能携带
   `as_of` / source timestamp / retrieval mode。
8. CI / local verification 明确区分 focused workstream gate、affected gate、repo-wide gate 与已知
   unrelated blockers。

## Canonical Entry

- `.planning/workstreams/canonical-retrieval-quality-ops-hardening/README.md`
