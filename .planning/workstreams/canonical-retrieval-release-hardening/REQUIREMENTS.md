---
doc_type: requirements
status: active
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Requirements: Canonical Retrieval Release Hardening

## Goal

把 `canonical -> chunk -> embedding -> retrieval` 从“结构上能跑通”推进到
release-safe、runtime-safe、可审计、可回放、可调优的生产级 retrieval data-plane。

## In Scope

- query-enabled serving truth 的 repo-wide 一致性。
- registry-scope alias publish 前的 physical collection retrieval acceptance gate；缺
  acceptance cases 时 query-serving publish 必须 fail closed。
- retrieval runtime 对 alias point payload / current release metadata / env settings 的
  drift guard；object-store manifest 不作为 online request-path 强依赖。
- dense embedding、sparse embedding、hybrid query profile、chunk profile、
  tokenizer/chunker implementation 的 release provenance。
- provider-response replay 与 registry-scope release 的边界校验。
- embedding cache 与成本/重试/维度校验。
- per-collection retrieval qrels、hard negative、no-hit、authz/current-only/version
  cases 与 release gate threshold。
- Qdrant backup / restore / retention 与新增 release metadata 的兼容性。
- docs / runbook / planning truth closeout。

## Non-goals

- 重新设计 raw asset capture、official-web collector、authenticated-notice collector 或
  source-specific scraping policy。
- 把 `campus_services/*` structured tools 改成 generic retrieval。
- 把 notice title/url card search 提升成 RAG collection。
- 引入新的 vector database 或把 Qdrant 从当前 accepted retrieval backend 中替换出去。
- 重新打开 supervisor capability routing、prompt synthesis 或 public-chat browser UI。
- 用 supplemental judge 直接取代 deterministic retrieval gate。
- 把 live-assisted / freshness-sensitive branch 提升为默认 query path。

## Success Criteria

1. `docs/architecture/current-architecture.md`、`docs/architecture/system/retrieval-serving-architecture.md`、`.planning/PROJECT.md`、runtime profiles 与 `configs/runtime/query-serving-scopes.v1.json` 对默认 query-enabled scope 的描述完全一致。
2. registry-scope query-serving alias publish 前必须通过 release acceptance gate；gate 至少覆盖 positive qrels、hard negative/no-hit、authz filter、current-only/version filter 与 evidence back-link；缺少 case fixture 不得视为通过。
3. retrieval runtime 查询 alias 时可以确认当前 release metadata 与自身 embedding/sparse/hybrid/runtime profile 一致；不一致时 fail closed，而不是静默低召回。
4. release manifest 与 Qdrant point payload 记录 dense embedding、sparse embedding、hybrid RRF profile、chunk/cleaning policy、document-units content hash 与 chunk fingerprint。
5. chunk preparation manifest 记录 tokenizer / chunker / normalizer / document-units schema provenance；实现或 tokenizer 漂移时 release gate 能阻断。
6. embedding cache 以 `text_sha256 + model + dimensions + chunk/query profile` 为 key，支持 cache hit / miss 统计、维度校验与 provider retry 边界。
7. per-collection retrieval tuning 报告能解释 `dense_prefetch_limit`、`sparse_prefetch_limit`、RRF weights、no-hit threshold 的选择；这些值不再是无证据的默认常量。
8. 现有 provider replay、qdrant backup、release worker CLI、retrieval service tests 继续通过，且新增 gate 不破坏 offline preparation / docs-only materialization。

## Canonical Entry

- `.planning/workstreams/canonical-retrieval-release-hardening/README.md`
