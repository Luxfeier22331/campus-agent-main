---
doc_type: requirements
status: completed
created: 2026-05-02
updated: 2026-05-02
---
# Regulation RAG Release Lane Requirements

## Objective

建立 regulation canonical document 到 downstream RAG serving 的独立 release lane。

目标状态：

- regulation admission 产生 `rag_release_candidate`
- periodic worker 增量处理 pending candidates
- release acceptance 通过后才切换 serving alias
- stale / withdrawn / deleted regulation chunks 有显式 cleanup truth
- operator panel 能看到 document site 与 RAG lane 的分离状态

## Scope

- `regulations/institutional_rules`
- `regulations/scoped_rules`
- notice-derived regulation documents that already passed promotion eligibility
- app-api / protected-panel 可见的 sanitized downstream status projection
- ingestion-core / ingestion-worker 的 candidate、batch、release、audit 与 cleanup contract

## Non-Goals

- 不重新打开 `regulations/*` promotion eligibility 规则
- 不把 historical / annual-cycle / search-only scoped rules 提升为默认 current RAG
  query-serving
- 不把 document center original resources 直接暴露给 RAG
- 不让 panel 读取 raw object storage、backend-native vector payload 或 raw chunk text
- 不把 vendor-specific indexing framework type 写入 `packages/contracts`

## Functional Requirements

- `rag_release_candidate` 必须记录 document identity、version/hash、target collection、
  runtime profile、candidate reason、visibility/authz carrier summary 与 cleanup disposition。
- Candidate lifecycle 至少包含 `pending`、`batched`、`preparing`、`indexed`、
  `acceptance_failed`、`serving_published`、`verification_failed`、`skipped_unchanged`、
  `not_query_enabled`、`held_search_only`、`profile_disabled`、`deleted`。
- Periodic worker 必须支持 selected batch 与 scheduled reconciliation 两种入口。
- Incremental decision 必须基于 document identity、document version/hash、chunk profile
  identity、embedding/runtime profile identity 与 current/withdrawn status。
- Unchanged documents 可以跳过 re-embedding，但 release manifest 必须记录 skip reason 与
  reused provenance。
- Withdrawn / deleted documents 必须产生 explicit delete/tombstone plan，不能让 stale
  chunks 留在 current alias。
- No-longer-current historical / search-only documents 如果不是 withdrawn / deleted，必须进入
  `held_search_only` 等 non-serving terminal status，不能误触 current alias cleanup。
- Alias publish 必须先通过 deterministic retrieval acceptance、chunk quality gate、
  qrels coverage gate 与 post-publish audit。
- Acceptance 失败不得切换 current pointer；必须保留 old alias 并生成 repair backlog。
- Operator-safe projection 必须分开展示 `documentSiteStatus`、`ragPreparationStatus`、
  `ragIndexStatus`、`ragServingStatus` 与 `ragVerificationStatus`。

## Success Criteria

- 架构文档明确 reader publish lane 与 RAG release lane 不同。
- 至少一个 selected regulation canary 能从 candidate 入队跑到 RAG verification。
- 至少一个 historical / search-only scoped-rule canary 被证明不会进入 current RAG alias。
- Panel/API projection 不泄漏 raw body、OCR payload、object key、chunk text 或 vector payload。
- Focused unit tests 覆盖 candidate lifecycle、incremental skip、delete/tombstone、alias
  fail-closed 与 status projection。

## External Design References

- LlamaIndex ingestion pipeline uses document identity and document hashes to avoid
  reprocessing unchanged documents:
  <https://docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/>
- LangChain indexing / RecordManager models source identity, hash and cleanup semantics
  for incremental indexing:
  <https://api.python.langchain.com/en/latest/indexing/langchain_core.indexing.base.RecordManager.html>
- Pinecone documents upsert/update/delete as explicit index data operations:
  <https://docs.pinecone.io/guides/index-data/indexing-overview>
- Qdrant documents point upsert/delete/update as explicit point lifecycle operations:
  <https://qdrant.tech/documentation/concepts/points/>
