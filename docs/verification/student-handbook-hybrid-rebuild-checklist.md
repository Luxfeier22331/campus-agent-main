---
doc_type: plan
status: active
created: 2026-03-26
updated: 2026-03-27
---

# Student Handbook Hybrid Rebuild Checklist

## 目标

本文负责 `student_handbook` phase-1 retrieval baseline 的 live rebuild 与运行验收清单。

当前冻结 baseline：

- dense: `Qwen3-Embedding-4B @ 2560`
- sparse: `Qdrant native BM25`
- sparse tokenizer: `multilingual`
- sparse language: `none`
- query shape: `native hybrid query + FusionQuery(RRF)`
- evidence shape: registry-backed `EvidenceBundle`

补充说明：

- live / remote sparse 路径使用 Qdrant cloud inference 执行 `qdrant/bm25`
- 本地 `:memory:` / mock 路径只保留最小测试 fallback，不代表 live sparse 真相源

## 不在本文负责

- handbook raw -> source truth -> projections 的清洗与 chunking 规则细节
- supervisor / specialist 路由与对话层行为
- curriculum / campus_services 等其他 collection 的 live 验收

## 前置真相源

- `docs/architecture/retrieval-query-strategy.md`
- `docs/architecture/phase1-ingestion-and-storage-architecture.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `.planning/STATE.md`
- `packages/evals/fixtures/student_handbook_hybrid_queries.json`

补充边界：

- `student_handbook_hybrid_queries.json` 当前只承担 live rebuild 后的抽样查询验收，不是 retrieval qrels 的 canonical truth 文件
- 后续用于 `Hit@K` / `Recall@K` / `Precision@K` / `MRR@K` 的 retrieval ground truth，应独立维护在 `packages/evals/fixtures/` 下的专用 qrels fixture 中

## 实现完成后 Code Review Checklist

- `RetrievalSettings` 已同时暴露 dense / sparse 配置，不再假设单 dense collection
- ingestion / rebuild 已通过同一条路径写入 named `dense` 与 named `sparse` vectors
- `index_chunks_to_qdrant()` 不再依赖 `QdrantVectorStore.add()` 单向量默认行为
- retrieval 不再走本地 lexical fallback，不再用 `scroll + local sparse score`
- retrieval query 已使用 Qdrant native `prefetch + FusionQuery(RRF)`
- payload contract 未丢失：`document_id`、`revision_track`、`version_id`、`chunk_id`、ACL、`campus_scope`、`anchor`
- `DocumentRegistry` 回链仍是最终 source shaping 的真相源

## Live Rebuild 前检查

- `.env` 中 dense 配置为 `Qwen3-Embedding-4B @ 2560`
- `.env` 中 sparse 配置为：
  - `SPARSE_PROVIDER=qdrant`
  - `SPARSE_MODEL=qdrant/bm25`
  - `SPARSE_TOKENIZER=multilingual`
  - `SPARSE_LANGUAGE=none`
- remote Qdrant client 必须启用 `cloud_inference=True`
- `QDRANT_COLLECTION` 指向本轮目标 collection，不与旧 dense-only collection 混用
- `DOCUMENT_REGISTRY_DATABASE_URL` 指向本轮 live registry
- `REBUILD_RESET_QDRANT=true` 或已确认目标 collection 可以被新 schema 重建

## Live Rebuild 执行顺序

1. 校验 `.env` 和目标 collection 名称。
2. 执行 rebuild。
3. 确认 collection schema 为 named `dense` + named `sparse`。
4. 记录点数、payload 样本和 registry back-link 样本。
5. 使用 fixtures 抽样查询做 Gate 3 / Gate 4 验收。

## Schema / Payload / Registry 检查

- collection schema 中必须存在：
  - dense vector: `dense`
  - sparse vector: `sparse`
- dense vector size 必须为 `2560`
- sparse vector params 必须包含 `Modifier.IDF`
- 任意抽样点 payload 必须包含：
  - `document_id`
  - `revision_track`
  - `version_id`
  - `chunk_id`
  - `corpus`
  - `collection`
  - `acl_level`
  - `acl_groups`
  - `anchor`
- 任意抽样命中回链后，`canonical_url` / `latest_url` / `is_current` 必须来自 registry truth，而不是直接取 Qdrant payload

## Query 抽样验收

优先使用 `packages/evals/fixtures/student_handbook_hybrid_queries.json` 中的样本，至少覆盖：

- `article_number_exact_match`
  条款号、章节号、标题号检索必须稳定命中对应制度片段
- `policy_title_exact_match`
  制度名 exact-match 不应被语义噪声压掉
- `fixed_phrase_sparse_win`
  固定措辞、规章术语、表述复现类问题应由 sparse 信号稳定召回
- `semantic_dense_win`
  不含原文措辞的语义问法仍应有 dense 命中能力
- `acl_filter`
  非授权组不应看到 restricted chunk
- `campus_scope_filter`
  指定 campus scope 时不能跨 scope 泄漏
- `no_hit`
  无命中时返回空 `EvidenceBundle`，不得回退到不受控的本地 repair

## Gate 3 / Gate 4 证据模板

建议为每次 live rebuild 至少记录以下证据：

- rebuild 时间
- git commit / branch
- Qdrant Cloud cluster 名称 / 区域
- collection 名称
- Inference 页 pricing snapshot 摘要
- collection schema 摘要
- points count
- payload sample
- registry back-link sample
- 通过的 query case 列表
- 失败 case 与原因

## 完成标准

- live collection 中所有 handbook 点均带有 named `dense` 与 named `sparse`
- native hybrid query 能稳定返回 registry-backed `EvidenceBundle`
- exact-match / fixed-phrase 场景相较 dense-only 更稳
- ACL / `campus_scope` / no-hit 行为未回退
