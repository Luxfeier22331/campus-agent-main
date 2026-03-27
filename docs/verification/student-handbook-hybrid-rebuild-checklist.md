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
  唯一制度名 exact-match 不应被相邻制度噪声压掉
- `fixed_phrase_sparse_win`
  handbook 当前真实存在的固定措辞、规章术语、表述复现类问题应由 sparse 信号稳定召回
- `semantic_dense_win`
  不含标题原文措辞的语义问法仍应有 dense 命中能力
- `no_hit`
  无命中时返回空 `EvidenceBundle`，不得回退到不受控的本地 repair

当前 handbook live fixture 额外约束：

- 样本必须只覆盖当前 `regulations/student_handbook` collection 的真实语料边界，不把 `campus_services` 或历史 handbook 服务/导航页样本混入
- 如果当前 handbook manifest 不包含 `acl_groups` 或 `campus_scope` 真相，官方 handbook live fixture 不应继续保留 `acl_filter` / `campus_scope_filter` case
- `policy_title_exact_match` 与 `fixed_phrase_sparse_win` 样本必须至少能回连到当前 handbook manifest 的标题关键词，避免出现 collection 已纯化但旧样本未更新的 fixture drift
- 如需验证 ACL 或 `campus_scope` 检索行为，应在真实承载这些 payload 维度的 collection 上维护单独 fixture，而不是继续塞在 handbook live 样本里

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

## 2026-03-27 Live 验收记录

本轮使用更新后的 `packages/evals/fixtures/student_handbook_hybrid_queries.json` 官方 handbook live 样本重跑真实验收，目标是确认：

- fixture 已与当前 `regulations/student_handbook` collection 边界重新对齐
- live collection schema / points count / query 行为保持正确
- handbook 官方 5 条样本可以作为当前 Gate 3 / Gate 4 的运行态抽样证据

本轮运行前置验证：

- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.evals.test_retrieval_benchmark.StudentHandbookHybridFixtureTest`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_retrieval_benchmark`

结果：

- `StudentHandbookHybridFixtureTest`: `6 tests`, `OK`
- `tests.evals.test_golden_cases + tests.evals.test_retrieval_benchmark`: `30 tests`, `OK`

本轮 live retrieval 验收环境：

- 验收日期：`2026-03-27`
- Qdrant collection：`student_handbook`
- Qdrant URL：`https://e3ae1c33-0bce-466a-a68c-299e5714a611.us-east4-0.gcp.cloud.qdrant.io`
- points count：`509`
- dense schema：named `dense`, size `2560`, distance `Cosine`
- sparse schema：named `sparse`, `modifier=IDF`
- fixture drift 检查：`fixture_drift_errors = []`
- fresh schema 快照：[`.tmp/phase7/handbook-live-collection-baseline.json`](/home/reptilian/code/campus-agent/.tmp/phase7/handbook-live-collection-baseline.json)

本轮 live query 结果：

- `article-number-degree-procedure`
  - query：`中央民族大学全日制本科学生学士学位授予规定 第十条`
  - top1：`handbook:742d4831bfb443b99323041e263fac2fd9aafcf6`
  - top1 chunk：`...:chunk-0003`
  - 命中片段：`三、学士学位授予程序`
- `policy-title-scholarship`
  - query：`中央民族大学本科学生国家奖学金评审办法`
  - top1：`handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15`
  - top1 chunk：`...:chunk-0001`
  - 命中片段：`中央民族大学本科学生国家奖学金评审办法`
- `fixed-phrase-dormitory-lighting`
  - query：`宿舍照明`
  - top1：`handbook:2ec80263a9e7b11379281349196ceb96afa44c3b`
  - top1 chunk：`...:chunk-0003`
  - 命中片段：`中央民族大学关于学生宿舍照明的管理规定`
- `semantic-student-card-reissue`
  - query：`学生证丢了怎么办`
  - top1：`handbook:e90f9707387f9e232ea88ce1c7f5328242e52389`
  - top1 chunk：`...:chunk-0001`
  - 命中片段：`中央民族大学本科(预科)学生证管理办法`
- `no-hit-impossible-query`
  - query：`火星校区飞船停靠规则`
  - 结果：`0 hits`

本轮结论：

- handbook 官方 live fixture 已重新对齐当前 collection 边界
- handbook live collection 未出现跨 collection 泄漏
- 官方 handbook 5 条样本的 top1 方向正确，`no_hit` 行为正确
- 当前 Gate 3 / Gate 4 的 handbook retrieval 运行证据可继续使用这 5 条官方样本

## 2026-03-27 Retrieval Benchmark 与 Fail-Close 修复

在 live rebuild 验收通过后，本轮又补跑了 handbook retrieval qrels 与 workflow/status 样本，目标是确认：

- retrieval benchmark 不只在抽样 query 上正确，而且在 repo-tracked qrels 上没有回退
- `no_hit` fail-close 语义不会被弱 lexical 噪声误触发
- handbook 当前主链路的终态状态分布仍符合 `completed` / `needs_clarification` / `no_answer` 预期

本轮发现的问题：

- 修复前，`student_handbook_retrieval_qrels.json` 中的 `no-hit-nonexistent-visa` 会错误返回非空命中
- 失败 query：`校内宇宙签证办理处`
- 根因不是 Qdrant schema、也不是 qrels 标注错误，而是 retrieval fail-close 判定把弱中文 bigram 当成了足够强的 lexical support
- 误触发片段主要来自 handbook 内部包含 `校内`、`办理` 等高频弱词的无关制度片段

根因修复：

- 在 [`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`](/home/reptilian/code/campus-agent/packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py) 为 `_apply_no_hit_policy()` 增加弱 CJK token 过滤
- `_segment_has_strong_lexical_support()` 不再把 `校内`、`办理`、`学校`、`学生`、`规定`、`办法`、`管理`、`申请`、`流程` 等弱 bigram / trigram 视为足以放行 evidence 的强支撑
- 对应 regression 已补到 [`tests/retrieval/test_backend_qdrant.py`](/home/reptilian/code/campus-agent/tests/retrieval/test_backend_qdrant.py)

本轮验证命令：

- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`

结果：

- `tests.retrieval.test_backend_qdrant`: `23 tests`, `OK`
- `tests.retrieval.test_backend_qdrant + tests.evals.test_retrieval_benchmark + tests.evals.test_golden_cases`: `54 tests`, `OK`

本轮 live retrieval benchmark 汇总：

- total cases：`13`
- `Hit@1 = 1.0`
- `Hit@3 = 1.0`
- `Recall@5 = 0.9743589743589743`
- `Precision@5 = 0.35384615384615387`
- `MRR@5 = 1.0`
- `forbidden_hit_rate = 0.0`
- `no-hit-nonexistent-visa` 修复后恢复为空结果，case 指标全部为 `1.0`

本轮 workflow/status 样本汇总：

- sample total：`6`
- `status_accuracy = 1.0`
- status distribution：
  - `completed = 4`
  - `no_answer = 1`
  - `needs_clarification = 1`

本轮结论：

- handbook retrieval 当前不仅通过 live query 抽样，也通过了 doc-level qrels benchmark
- `no_hit` fail-close 漏放行已修复，当前 handbook 主链路没有发现新的 retrieval regression
- 当前 live workflow/status gate 按设计只覆盖稳定主链路；`error` 分支现已迁移为单独的 deterministic error gate，不再要求依赖 live 偶发故障取样
- 详细数值快照与 split 维度汇总已单独落盘到 `docs/verification/student-handbook-eval-metrics.md`

## 完成标准

- live collection 中所有 handbook 点均带有 named `dense` 与 named `sparse`
- native hybrid query 能稳定返回 registry-backed `EvidenceBundle`
- exact-match / fixed-phrase 场景相较 dense-only 更稳
- ACL / `campus_scope` / no-hit 行为未回退
