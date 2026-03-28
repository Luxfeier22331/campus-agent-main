---
doc_type: plan
status: active
created: 2026-03-27
updated: 2026-03-27
---

# Phase-1 Ingestion / Retrieval 实现真相快照

## 目的

本文不定义长期架构，只记录当前代码已经落地的 phase-1 实现真相，供文档对齐、验收和跨会话协作使用。

当本文与以下文档冲突时：

- 长期边界以 `docs/architecture/` 为准
- 已接受决策以 `docs/decisions/` 为准
- 当前执行状态以 `.planning/STATE.md` 为准

本文只回答“代码现在实际上是什么”。

## 当前真相源

- object key / bucket builder:
  - `packages/ingestion-core/src/campus_ingestion_core/object_store.py`
- replay / rebuild:
  - `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
- raw-first ingestion:
  - `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- source-truth shared core:
  - `packages/ingestion-core/src/campus_ingestion_core/source_truth_common.py`
- source-truth quality gate:
  - `tests/ingestion/test_source_truth_quality_gate.py`
- retrieval hybrid query:
  - `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- runtime env baseline:
  - `.env.example`

## Object Storage 真相

当前 source bucket 的 canonical 前缀不是旧的 `pdf/`、`ocr/`、`source-truth/` 三棵顶层树，而是同一来源前缀下的三段 stage：

- `capture/`
- `provider/`
- `source-truth/`

当前 canonical 形态：

- raw capture artifact:
  - `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/capture/{original_filename}`
- provider artifact:
  - `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/provider/{provider_slug}/{artifact_filename}`
- source-truth artifact:
  - `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/source-truth/{artifact_filename}`
- derived document artifact:
  - `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/{artifact_filename}`

这里的实现主字段仍然是 `revision_track`。如果其他文档出现 `representation` 作为当前代码路径主字段，应以本文列出的代码与已接受 ADR 为准。

当前 handbook 默认 source channel / provider slug：

- `source_channel=official_pdf`
- `provider_slug=paddleocr-vl-1-5`

## Replay / Rebuild 输入语义

`provider_response_replay` 的外部主身份是 typed request：

- `raw_version_id`
- 可选 `raw_asset_id`
- 可选 `source_pdf`

当前准确表述：

- replay / migration 运行时只接受 `raw_version_id` 作为 handbook source replay 的必需主身份
- `REBUILD_PROVIDER_RESPONSE_KEY` 已从运行时接口面移除，不再作为 env bridge 存在

## Handbook 专用变量与通用变量

当前通用 retrieval / indexing baseline env：

- `EMBEDDING_PROVIDER`
- `EMBEDDING_MODEL`
- `EMBEDDING_DIMENSIONS`
- `SPARSE_PROVIDER`
- `SPARSE_MODEL`
- `SPARSE_TOKENIZER`
- `SPARSE_LANGUAGE`
- `QDRANT_URL`
- `DOCUMENT_REGISTRY_DATABASE_URL`

当前物理 Qdrant target 不再由单个全局 env 指定，而是由每个
`configs/ingestion/<corpus>/<collection>/runtime-profile.json` 中的
`qdrant_collection_name` 与 vector binding 字段声明。

当前明显带 `student_handbook` 语义的 rebuild / migration 变量：

- `REPLAY_SOURCE_PDF`
- `HANDBOOK_CANONICAL_RAW_FILENAME`
- `HANDBOOK_SOURCE_PROJECTIONS_PATH`

当前 raw-first ingestion artifact modes：

- `normalized`
- `source_truth_only`

其中 `source_truth_only` 的真实语义是：

- 仍会写 raw/provider/source-truth
- 不进入 document registry 或 per-document artifact
- 当前 handbook 与 curriculum 都会持久化 `source-truth/layout-elements.jsonl`

## Source-Truth 归一化真相

当前 OCR/source-truth 归一化已经固定为：

- provider adapter:
  - `packages/ingestion-core/src/campus_ingestion_core/handbook_provider_normalize.py`
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_provider_normalize.py`
- shared source-truth core:
  - `packages/ingestion-core/src/campus_ingestion_core/source_truth_common.py`

shared core 当前统一负责：

- base text normalization
- bbox normalization
- repeat candidate enrichment
- parent heading hints
- cross-page continuation hints
- HTML table cell/grid extraction
- table shape inference

当前显式 source-truth 质量门禁已经落盘到：

- `tests/ingestion/test_source_truth_quality_gate.py`

该门禁当前覆盖：

- handbook synthetic 语义断言
- curriculum synthetic 语义断言
- handbook real fixture regression
- curriculum real fixture regression
- forbidden source-truth fields regression

## Retrieval 真相

当前 handbook accepted baseline：

- dense: `Qwen3-Embedding-4B @ 2560`
- sparse: `Qdrant native BM25`
- fusion: `RRF`
- output: registry-backed `EvidenceBundle`

当前 live / remote sparse 路径：

- ingestion / rebuild 向 runtime profile 声明的 named dense / sparse vectors 写入
- sparse live path 不再使用仓库内本地 tokenizer/hash 生成在线真相
- remote Qdrant client 启用 `cloud_inference=True`
- sparse query / sparse index payload 直接使用 `qdrant/bm25`

当前本地 `:memory:` / mock 路径：

- 仅保留最小兼容 fallback
- 目的只是单元测试和本地断言
- 不代表 live sparse 服务真相

## 当前最容易漂移的点

以下信息不应再写成长期稳定事实：

- live Qdrant points count
- 某次 rebuild 的具体 collection 数字
- 某次 benchmark 的瞬时结果
- 把 `representation` 误写成当前 derived path / registry 主字段

这类信息应进入：

- `.planning/STATE.md`
- `docs/verification/`
- `.tmp/` 或 `var/` 下的证据产物

而不是留在 `README.md` 这类稳定入口文档里。
