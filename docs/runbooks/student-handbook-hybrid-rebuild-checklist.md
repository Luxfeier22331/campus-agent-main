---
doc_type: runbook
status: active
created: 2026-03-26
updated: 2026-04-23
---
# Student Handbook Hybrid Rebuild Checklist

## 目标

本文负责 `student_rules` retrieval baseline 的 live rebuild 与运行验收清单。

当前冻结 baseline：

- dense: `Qwen3-Embedding-4B @ 2560`
- sparse: `Qdrant native BM25`
- sparse tokenizer: `multilingual`
- sparse language: `none`
- query shape: `native hybrid query + RrfQuery(k=60, weights=[1.0, 1.0])`
- evidence shape: registry-backed `EvidenceBundle`

补充说明：

- live / remote sparse 路径使用 Qdrant cloud inference 执行 `qdrant/bm25`
- 本地 `:memory:` / mock 路径只保留最小测试 double，不代表 live sparse 真相源

## 不在本文负责

- handbook raw -> source truth -> projections 的清洗与 chunking 规则细节
- supervisor / agent 路由与对话层行为
- curriculum / campus_services 等其他 collection 的 live 验收

## 前置真相源

- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `.planning/WORKSTREAMS.md`
- `packages/evals/fixtures/student_handbook_hybrid_queries.json`

补充边界：

- `student_handbook_hybrid_queries.json` 当前只承担 live rebuild 后的抽样查询验收，不是
  retrieval qrels 的 canonical truth 文件
- 后续用于 `Hit@K` / `Recall@K` / `Precision@K` / `MRR@K` 的 retrieval ground
  truth，应独立维护在 `packages/evals/fixtures/` 下的专用 qrels fixture 中

## 实现完成后 Code Review Checklist

- `RetrievalSettings` 已同时暴露 dense / sparse 配置，不再假设单 dense collection
- ingestion / rebuild 已通过同一条路径写入 named `dense` 与 named `sparse` vectors
- `index_chunks_to_qdrant()` 不再依赖 `QdrantVectorStore.add()` 单向量默认行为
- retrieval 不再走本地 lexical fallback，不再用 `scroll + local sparse score`
- retrieval query 已使用 Qdrant native `prefetch + RrfQuery(...)`
- payload contract 未丢失：`document_id`、`revision_track`、`version_id`、`chunk_id`、`e
  ntitlement_groups`、`visibility_scope`、`visibility_level`、`anchor`
- `DocumentRegistry` 回链仍是最终 source shaping 的真相源

## Live Rebuild 前检查

- `.env` 中 dense 配置为 `Qwen3-Embedding-4B @ 2560`
- `.env` 中 sparse 配置为：
  - `SPARSE_PROVIDER=qdrant`
  - `SPARSE_MODEL=qdrant/bm25`
  - `SPARSE_TOKENIZER=multilingual`
  - `SPARSE_LANGUAGE=none`
- retrieval hybrid 运行参数不再放在 `.env`，而是以
  `configs/ingestion/regulations/student_rules/runtime-profile.json` 为准：
  - `embedding_query_instruction`
  - `dense_prefetch_limit`
  - `sparse_prefetch_limit`
  - `rrf_k`
  - `rrf_dense_weight`
  - `rrf_sparse_weight`
  - `document_support_limit`
- remote Qdrant client 必须启用 `cloud_inference=True`
- handbook runtime profile 中的 `qdrant_alias_name` / `qdrant_collection_prefix` /
  vector binding / `retrieval_top_k=8` / hybrid runtime knobs 必须对齐本轮目标索引，不与旧
  dense-only target 混用
- handbook runtime profile 中的 source OCR truth 必须保持：
  - `source_ocr_provider=mineru_api`
  - `source_ocr_model=vlm`
  - `source_parser_version=mineru-vlm-adapted-v2`
- `DOCUMENT_REGISTRY_DATABASE_URL` 指向本轮 live registry
- `REBUILD_RESET_QDRANT=true` 或已确认目标 alias family 可以被新 schema 重建
- replay indexing 现在是 fail-closed：
  - 任一 replay 文档缺少 registry record，会直接中止本轮 index release
  - 任一 replay 文档产出空 chunk，会直接中止本轮 index release

## Live Rebuild 执行顺序

1. 校验 `.env`、serving alias 和目标 physical collection 前缀。
1. 执行 rebuild。
1. 确认 collection schema 为 named `dense` + named `sparse`。
1. 记录点数、payload 样本和 registry back-link 样本。
1. 使用 fixtures 抽样查询做 Gate 3 / Gate 4 验收。

## Formal Benchmark 验收入口

推荐直接走 shared live benchmark acceptance flow：

- 先启动 repo-local `supervisor-api` 与 `app-api` dev runtime
- root `.env` 需要补齐本地 eval ingress 参数，而不是远端部署变量：
  - `APP_API_BASE_URL`
  - `APP_API_INTERNAL_SHARED_SECRET`
  - `APP_API_EVAL_USER_EMAIL`
- 其中 `APP_API_INTERNAL_SHARED_SECRET` 必须与本地 `apps/app-api/.dev.vars` 保持同值
- `set -a && source .env && set +a`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m
  campus_evals.handbook_live_benchmark accept --reruns 3 --verbose --log-jsonl
  .tmp/evals/student-handbook-runtime-events.jsonl`

accept flow 语义：

- 先跑 fresh live benchmark
- 若存在 transient supplemental infra failure，再自动进入 repair rerun
- 在 acceptance 根目录输出最终 verdict，而不改写原 run artifact

## Runtime Observability Artifact

每轮 handbook acceptance 建议至少保留：

- `run/supplemental-runtime-events.jsonl`
- `run/supplemental-provider-summary.json`
- 若发生 repair：
  - `repair/supplemental-runtime-events.jsonl`
  - `repair/supplemental-provider-summary.json`
- acceptance 根目录：
  - `accept-config.json`
  - `final-summary.json`

如果使用 `--log-jsonl`：

- `accept` 会把 base path 自动拆成 `<base>.run.jsonl` 与 `<base>.repair.jsonl`
- `--verbose` 会直接打印 preflight、retrying、recovered、breaker 等高信号事件，便于现场确认 provider
  瞬时失败是否已自动重试

## Historical Artifact Pointer

具体数值快照、acceptance 结论与历史 artifact 解释统一看 [student-handbook-eval-metrics.md](/home/
reptilian/code/campus-agent/docs/reference/student-handbook-eval-metrics.md)。

这份 runbook 只维护 rebuild 与 live acceptance 的操作顺序、证据模板和命令入口。

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
  - `visibility_level`
  - `entitlement_groups`
  - `anchor`
- 任意抽样命中回链后，`canonical_url` / `latest_url` / `is_current` 必须来自 registry
  truth，而不是直接取 Qdrant payload

## 常见故障签名

- 如果 handbook live query 返回 `status=error`，且底层异常包含 `Bad request: Index required
  but not found for "entitlement_groups"`：
  - 先不要把它归因到 LLM provider 或 supplemental adapter
  - 这表示当前 serving alias 指向的 remote Qdrant collection 缺少 authorization projection
    需要的 payload index
  - 当前 ingestion/indexing 代码对 remote Qdrant 已要求创建 `entitlement_groups` /
    `visibility_scope` / `visibility_level` / `policy_projection_version` 等
    payload index；出现该错误通常意味着 alias 仍指向旧 schema collection
  - 正确处置是核对 serving alias、physical collection 和最近一次 release manifest，必要时重做
    release-managed rebuild / publish
  - 当前 retrieval 代码已经避免在 `entitlement_groups=()` 的 public-only 请求上额外发送空 group
    谓词，但这不替代 serving collection 应具备的完整 authorization projection schema

## Query 抽样验收

优先使用 `packages/evals/fixtures/student_handbook_hybrid_queries.json` 中的样本，至少覆盖：

- `article_number_exact_match` 条款号、章节号、标题号检索必须稳定命中对应制度片段
- `policy_title_exact_match` 唯一制度名 exact-match 不应被相邻制度噪声压掉
- `fixed_phrase_sparse_win` handbook 当前真实存在的固定措辞、规章术语、表述复现类问题应由 sparse 信号稳定召回
- `semantic_dense_win` 不含标题原文措辞的语义问法仍应有 dense 命中能力
- `no_hit` 无命中时返回空 `EvidenceBundle`，不得回退到不受控的本地 repair

当前 handbook live fixture 额外约束：

- 样本必须只覆盖当前 `regulations/student_rules` collection 的真实语料边界，不把 `campus_services`
  或历史 handbook 服务/导航页样本混入
- 如果当前 handbook manifest 不包含 `entitlement_groups` 或 `visibility_scope` 真相，官方
  handbook live fixture 不应继续保留 restricted filter case
- `policy_title_exact_match` 与 `fixed_phrase_sparse_win` 样本必须至少能回连到当前 handbook
  manifest 的标题关键词，避免出现 collection 已纯化但旧样本未更新的 fixture drift
- 如需验证 restricted entitlement 或 `visibility_scope` 检索行为，应在真实承载这些 payload 维度的
  collection 上维护单独 fixture，而不是继续塞在 handbook live 样本里

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
- restricted projection / `visibility_scope` / no-hit 行为未回退
