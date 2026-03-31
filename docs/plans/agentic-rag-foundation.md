---
doc_type: plan
status: completed
created: 2026-03-22
updated: 2026-03-31
---

# Agentic RAG 历史地基实施基线（原第一阶段文档）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## 文档状态说明

这份文档保留为 `campus-agent` 早期地基实施的历史基线与背景材料，不再承担当前 GSD 执行状态、phase 进度或待办优先级的真相源角色。

- 长期边界、架构方向和历史 accepted implementation baseline 仍可参考这份文档
- 当前 phase 的执行顺序、最新 pending work、讨论结论和进度状态，以 `.planning/PROJECT.md`、`.planning/ROADMAP.md`、`.planning/STATE.md` 以及对应 phase 目录下的 context / plan / validation 产物为准
- 当这份文档中的早期 phase-1 实施叙事与 `.planning/` 中的当前执行现实不一致时，应优先更新这里的文档边界说明，并按 `.planning/` 继续推进执行，而不是把过时叙事重新提升为当前硬约束
- 当前 retrieval accepted baseline 不再单独由本文维护；以 `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md` 与 `docs/architecture/retrieval-query-strategy.md` 为准
- 当前 serving/indexing 术语不再由本文解释；以 `docs/reference/runtime-serving-and-index-terms.md` 为准

当前不应从本文直接读取的运行真相包括：

- 当前 query-enabled scope
- 当前 serving alias / physical collection 语义
- 当前 release manifest / rollback 运行约束

这些内容分别以 runtime profile、`.planning/PROJECT.md` / `.planning/STATE.md`、以及 operator runbook 为准。

**Goal:** 以下 Goal 保留为当时的历史实施目标：在 `campus-agent` monorepo 中补齐第一阶段地基，以“符合最佳实践前提下跑通端到端 agentic RAG 流程”为验收标准。

**Architecture:** 以下 Architecture 保留为当时的历史实施设定：本次实施只做第一阶段可上线闭环，不保留旧 `/api/search`、`/api/answer` 兼容层。数据面按 `Source -> Derived -> Chunk/Index` 三层分离落地，当前对象存储使用本机部署的 `MinIO`；早期初始开放 collection 为 `student_handbook`。source bucket 采用 corpus-agnostic 的 `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...` 前缀，并在同一来源前缀下按 `capture/`、`provider/`、`source-truth/` 分层保存来源资产；derived bucket 的命名空间固定拆成 `{corpus}/documents/...`，其中 handbook OCR truth 固定为 `provider-response.jsonl -> layout-elements.jsonl -> split-manifest -> per-document canonical.md + document-units.jsonl`，逻辑文档以 `document_id + revision_track + version_id` 建模，不再依赖 `campusRAG` 作为运行时输入。查询面采用 `Supervisor API -> Supervisor Core -> RAG Specialist -> Retrieval Core`，内部 runtime 使用 AgentOS-native，检索实现使用 `LlamaIndex + Qdrant`。当前运行态的 query-serving truth 和 index release 语义不再由本文维护，而由 collection runtime profile、`.planning/PROJECT.md` / `.planning/STATE.md` 以及 operator runbook 控制。

**Tech Stack:** Python 3.12, uv workspace, Agno AgentOS, LlamaIndex, Qdrant, MinIO (local S3-compatible), pytest/unittest

---

## 摘要

本实施文档从架构文档中拆出，保留为历史实施基线，用于追溯当时的可执行动作、文件落点、接口、测试和验收标准。它不再是当前 phase 推进文档。其历史目标不是做完整产品，而是补齐项目地基：

- 冻结 contract 和 evidence bundle
- 建立本机 MinIO 对象存储边界
- 增加 ingestion/data plane 基础层
- 冻结 `regulations` corpus 中 `student_handbook` collection 的 `provider-response.jsonl` / `split-manifest.v1.json` / `document-units.jsonl` ingestion truth
- 建立 document registry 与 Qdrant 检索链路
- 跑通最小 agentic RAG 主链路
- 冻结第一批 baseline 场景

实施范围固定为：

- 初始基线默认开放 `regulations` corpus 中的 `student_handbook` collection；当前 query-serving truth 已由 runtime profile 扩展到 `curriculum/curriculum_plan`
- storage/data-plane 可增量支持其他已冻结 scope；当前 `campus_services/service_catalog` 与 `campus_services/contact_directory` 仍保持 `offline_preparation`
- 上游可以保留 `crawler job` / `queue` 概念边界，但当前 worker runtime 只消费已登记的 raw asset identity，不实现本地 placeholder queue
- 当前对象存储只做本机 `MinIO`
- 不保留旧 RAG API 兼容层
- 硬化阶段内容不进入本轮实现

## 文档定位

这份文档只回答三件事：

- 第一阶段到底做到哪里算“地基完成”
- 各个基础组件应该按什么顺序落地
- 哪些输入、配置和 baseline 必须在第一轮就冻结

它不重复长期架构原则，也不替代 ADR。关系固定如下：

- 长期边界、职责拆分、可替换性定义，留在 `docs/architecture/long-term-architecture.md`
- supervisor / execution engine 当前设计取舍，留在 `docs/architecture/supervisor-architecture.md`
- 第一阶段数据平面约束，留在 `docs/architecture/phase1-ingestion-and-storage-architecture.md`
- 本机 `MinIO` 作为本地对象存储替代实现的规则，留在 `docs/decisions/adr-0002-local-minio-conventions.md`
- 当前阶段执行状态、phase 排序、pending work 和最新讨论结论，留在 `.planning/`
- 这份文档只负责把上面三类原则拆成历史地基方案的实施基线、门禁、文件落点和验收标准，不再充当当前 phase-by-phase 执行日志

## 历史阅读方式

下文大部分章节保留当时的“第一阶段”原始表述，只用于追溯地基方案为何这样设计。

- 可以把其中的架构约束、接口冻结点和门禁定义视为历史背景
- 不应把其中任何“当前 / 默认 / 第一阶段”叙事重新解释成今天的执行状态
- 需要当前 truth 时，统一回到 `.planning/*`、运行态 reference、ADR 与对应 architecture 文档

## 完成定义

这一阶段不是“代码骨架更多了”，而是以下闭环可以稳定重跑：

- 本机 `MinIO` 已部署，并通过 `S3-compatible` 配置被接入
- `campusRAG` 现有 OCR 资产已经被导入 object storage，并在 registry 中登记
- 已能基于导入资产完成 chunking、embedding、Qdrant 建索引
- `Supervisor API -> Supervisor Core -> RAG Specialist -> Retrieval Core` 能返回带 evidence 的回答
- 第一批 `student_handbook` baseline 已冻结，并且可重复执行

## Migration note: 2026-03-26 phase snapshot

以下内容保留为 `2026-03-26` 的阶段快照，只用于理解当时的推进背景，不再作为当前执行状态真相源。当前如需判断 Gate 是否已通过、live collection 是否已重建、当前验证卡点是什么，应以 `.planning/STATE.md` 与 `docs/runbooks/`、`docs/reference/`、`docs/policies/` 下的最新文档为准。

- 当时的代码基线验证命令为：`uv run --all-packages python -m unittest discover -s tests -t .`
- 当时已记录 `MinIO` bucket、handbook source artifacts、retrieval baseline 调整与 live rebuild 待完成等阶段信息
- 这些快照信息不应覆盖本文下面的 Gate 定义，也不应替代 `.planning/` 中的当前状态板

## 第一阶段实施拓扑

```text
                        +----------------------+
                        |   supervisor-api     |
                        | HTTP shell + AgentOS |
                        +----------+-----------+
                                   |
                                   v
                        +----------------------+
                        |   supervisor-core    |
                        | route / audit / trace|
                        +----------+-----------+
                                   |
                                   v
                        +----------------------+
                        |   rag-specialist     |
                        | query / answer / conf|
                        +----------+-----------+
                                   |
                                   v
                        +----------------------+
                        |   retrieval-core     |
                        | registry + qdrant    |
                        +----+------------+----+
                             |            |
                             v            v
                   +---------------+   +-----------------+
                   | document       |   | qdrant          |
                   | registry       |   | chunk + vector  |
                   +-------+--------+   +-----------------+
                           ^
                           |
                 +---------+----------+
                 |   ingestion-core   |
                 | import/process/index|
                 +----+-----------+----+
                      |           |
                      v           v
          +------------------+   +------------------------+
          | MinIO source bucket | | MinIO derived bucket |
          +------------------+   +------------------------+
                      ^
                      |
          +------------------------------+
          | upstream raw asset producer  |
          | crawler/job/queue boundary   |
          +------------------------------+
```

## 初始实施前冻结项（历史基线）

在写任何正式实现之前，先冻结以下输入，不允许边做边漂移：

- 当时的 query-serving 默认范围：开放 `regulations` corpus 中的 `student_handbook` collection
- 当时的 data-plane 增量语料：允许 `curriculum` corpus 下的 `curriculum_plan` 与 `campus_services` corpus 下的服务类 collection 完成 source/derived/registry 与清洗真相收口，但不自动放开 retrieval
- handbook OCR 输入：只允许对象存储中的 `provider-response.jsonl` 与 repo-tracked `split-manifest.v1.json`
- object storage 语义：只允许 `campus-rag-source` / `campus-rag-derived`
- object key 结构：
  - source raw asset:
    - `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/capture/{original_filename}`
  - source artifact:
    - `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/provider/{model_slug}/{artifact_filename}`
    - `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/source-truth/{artifact_filename}`
  - derived document artifact:
      `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/{artifact_filename}`
- 其他 phase-1 collection 必须沿用同一套 derived 侧按 corpus 分前缀的路径语义；source raw asset 不按 corpus 分前缀
- retrieval 实现：只允许 `LlamaIndex + Qdrant`
- chunk profile：第一轮固定一套 chunk 大小、overlap、metadata 映射
- embedding profile：第一轮固定一个 embedding model 标识
- baseline 场景：第一轮固定 `student_handbook` collection 的问题集和预期 source locator

## OCR 资产导入规则

第一阶段不再把 `campusRAG` 当作运行时依赖。`regulations` corpus 中 `student_handbook` collection 的 OCR truth 固定为对象存储中的 provider 原始响应与仓库内 split truth，历史 `campusRAG` 结果只保留为参考对照样本。

导入映射规则固定为：

- 如果上游能提供原始 PDF/HTML/Markdown 等源文件：
  - 写入 `campus-rag-source`
  - `raw_source_uri` 指向原始来源
- 如果上游只提供 OCR JSON、OCR 文本、结构化抽取结果：
  - 写入 `campus-rag-source`
  - handbook 仅接受仓库规定的 `provider-response.jsonl` 形状，并写入 canonical source prefix 下的 `provider/...`
- 如果 OCR 来自在线供应商：
  - source bucket 下至少同时保存 source-level `provider-response.jsonl` 与 source-level `layout-elements.jsonl`
  - derived bucket 下保存 per-document `document-units.jsonl`
  - `provider-response.jsonl` 保留供应商原始响应
  - `layout-elements.jsonl` 是 split 前唯一内部统一结构真相
  - `document-units.jsonl` 只表示单篇逻辑文档，不表示整本 handbook source
- `curriculum/curriculum_plan` 在 split manifest 冻结前，允许先走 `source_truth_only` 预接入路径，只上传 raw PDF 并保留 asset-level `provider-response.jsonl` 供切分策略设计；正式 `normalized` ingestion 仍要求 repo-tracked split manifest
- `source_truth_only` 不是 file-registry 兼容模式；它仍应写入 canonical raw asset registry，只是不写 document registry
- 不允许因为第一阶段赶进度，就把 OCR 文本直接冒充 raw layer 真相源
- 不允许继续支持历史外部存储导入的非 `provider-response.jsonl` handbook OCR 形状

feature worktree 环境规则：

- ingestion worker CLI 优先读取当前 worktree 根目录 `.env`
- 如果当前 worktree 没有 `.env`，允许显式回退到根集成 worktree 的 `.env`
- 不允许因为 worktree 缺少 `.env` 就临时切到本地 file registry、mock OCR 或其他非 canonical backend

第一阶段至少要冻结以下导入基线资产：

- 导入源目录或 manifest 的解析规则
- `document_id` 的生成规则
- `version_id` 的推进规则
- `content_hash` 的计算口径
- campus / ACL metadata 的映射规则
- import report 的输出格式

## 阶段门禁

为了避免“代码写了很多但主链路仍然不通”，第一阶段按门禁推进：

以下 Gate 定义仍是本文要冻结的实施门禁；但每个 Gate 的当前通过状态、阻塞项与运行态证据不再在本文维护。当前真相请以 `.planning/STATE.md` 和 `docs/runbooks/`、`docs/reference/`、`docs/policies/` 下的最新文档为准。

- Gate 0: 基线冻结
  - 冻结 corpus、导入来源、chunk profile、embedding profile、baseline cases
- Gate 1: 对象存储就绪
  - 本机 `MinIO` 已部署，bucket 已初始化，应用侧只能通过 `S3-compatible` 配置访问
- Gate 2: 数据面可用
  - `campusRAG` OCR 资产已导入 object storage，registry 可记录 stable ID / version / hash
- Gate 3: 检索面可用
  - `LlamaIndex + Qdrant` 已能返回带 source locator 的 evidence bundle
- Gate 4: Agentic RAG 主链路可用
  - supervisor 到 specialist 的委派跑通，baseline queries 可重复通过

## 关键接口与公共类型

需要在 `packages/contracts` 中冻结以下公共类型：

- `TraceContext`
  字段：`trace_id`, `parent_run_id`, `tool_call_id`
- `ActorContext`
  字段：`user_id`, `roles`, `departments`, `groups`, `campus_scope`, `snapshot`
- `DocumentRef`
  字段：`document_id`, `revision_track`, `version_id`, `corpus`, `collection`, `source_uri`, `content_hash`
- `EvidenceSource`
  字段：`doc_id`, `revision_track`, `version_id`, `chunk_id`, `anchor`, `acl_level`, `canonical_url`, `latest_url`, `source_channel`, `collection`, `is_current`, `snippet`, `score`
- `EvidenceBundle`
  字段：`query_text`, `corpus`, `collection`, `sources`
- `SupervisorRequest`
  字段：`user_goal`, `conversation_id`, `request_id`, `trace`, `actor`, `requested_capability`, `requested_scope`
- `SpecialistRequest`
  字段：`target`, `user_goal`, `payload`, `conversation_id`, `request_id`, `trace`, `actor`
- `SpecialistResponse`
  字段：`target`, `status`, `answer_text`, `follow_up_question`, `confidence`, `result`, `error`

固定状态枚举：

- `completed`
- `needs_clarification`
- `no_answer`
- `error`

固定 confidence 枚举：

- `high`
- `medium`
- `low`

## 实施任务

### Task 1: 冻结 contracts 与基础测试

**Files:**
- Modify: `packages/contracts/src/campus_contracts/models.py`
- Modify: `packages/contracts/src/campus_contracts/__init__.py`
- Create: `tests/contracts/test_models.py`

**Implementation:**
- 扩展现有 request/response dataclass，加入 trace、actor、evidence、error 相关模型。
- 保持 `packages/contracts` 纯 Python schema，不引入 Agno、LlamaIndex、MinIO SDK 类型。
- 初始基线里 `scope` 默认先围绕 `{"corpus": "regulations", "collection": "student_handbook"}` 设计；当前运行态 query-serving truth 已由 runtime profile 控制，不再由这里声明单一默认查询面。
- 明确 `DocumentRef` 与 `EvidenceSource` 的最小字段集，对齐现有决策文档与 legacy source locator 语义。

**Verification:**
- `uv run --all-packages python -m pytest tests/contracts/test_models.py -q`
- 断言 dataclass 字段、默认值和序列化结构稳定。

### Task 2: 建立本机 MinIO 接入配置与对象存储客户端

**Files:**
- Create: `packages/ingestion-core/pyproject.toml`
- Create: `packages/ingestion-core/README.md`
- Create: `packages/ingestion-core/src/campus_ingestion_core/__init__.py`
- Create: `packages/ingestion-core/src/campus_ingestion_core/settings.py`
- Create: `packages/ingestion-core/src/campus_ingestion_core/object_store.py`
- Create: `infra/local/docker-compose.minio.yml`
- Create: `infra/local/minio/create_buckets.sh`
- Create: `tests/ingestion/test_object_store_config.py`

**Implementation:**
- 新建 `packages/ingestion-core`，统一承载数据摄入侧逻辑。
- 增加本机 `MinIO` 的最小部署骨架，但仍保持“本地替代实现”定位，不把部署方式写进 contract。
- 增加 MinIO/S3-compatible 配置：
  - `OBJECT_STORE_ENDPOINT`
  - `OBJECT_STORE_ACCESS_KEY`
  - `OBJECT_STORE_SECRET_KEY`
  - `OBJECT_STORE_REGION`
  - `OBJECT_STORE_BUCKET_SOURCE`
  - `OBJECT_STORE_BUCKET_DERIVED`
- 固定 bucket 默认值：
  - `campus-rag-source`
  - `campus-rag-derived`
- 提供 object storage 客户端工厂，不暴露 MinIO 内部细节到 contract 层。
- bucket 创建由部署脚本或初始化步骤完成，不允许业务代码在运行期隐式兜底创建。

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_object_store_config.py -q`
- 覆盖默认 bucket、endpoint、禁止本机目录 fallback 的约束。

### Task 3: 建立 document registry schema 与 storage adapter

**Files:**
- Create: `packages/ingestion-core/src/campus_ingestion_core/registry.py`
- Create: `packages/ingestion-core/src/campus_ingestion_core/models.py`
- Create: `tests/ingestion/test_registry_models.py`

**Implementation:**
- 定义 `DocumentRegistryRecord`，字段至少包含：
  - `document_id`
  - `version_id`
  - `source_uri`
  - `content_hash`
  - `corpus`
  - `acl_groups`
  - `campus_scope`
  - `status`
  - `ingestion_timestamp`
  - `parser_version`
  - `embedding_model`
- 第一阶段 registry 可以先以 repository-local adapter interface 为主，真实 DB 实现留到后续 task。
- 所有 ingestion 和 retrieval 都通过 registry 接口读取元数据，不允许从 object key 反推真相字段。

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_registry_models.py -q`

### Task 4: 建立 raw-first ingestion runtime

**Files:**
- Create: `apps/ingestion-worker/pyproject.toml`
- Create: `apps/ingestion-worker/README.md`
- Create: `apps/ingestion-worker/src/campus_ingestion_worker/__init__.py`
- Create: `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py`
- Create: `tests/ingestion/test_process_raw_ingestion_job.py`

**Implementation:**
- 新建 `apps/ingestion-worker`，作为摄入运行时壳。
- 提供 `process_raw_ingestion_job` 入口，表达 worker 边界；对已登记到 raw asset registry 的 source PDF 做在线 OCR，写 source/derived artifacts 与 registry。
- worker 主路径只接受 `raw_asset_id + raw_version_id`，不接受本地 PDF 路径或本地 placeholder job envelope。
- 初始实现先以 `regulations/student_handbook` 为查询主链路。
- `curriculum_plan` 在当时仅通过 split manifest 进入 storage/registry；当前 serving truth 已以后续 runtime profile 为准。
- 如果 OCR 来自在线供应商：
  - source / derived 层必须分开保存 `provider-response.jsonl` 与 `document-units.jsonl`
  - 两者必须分开保存，不能互相替代
- 导入过程必须产出 import report，最少包含成功数、跳过数、失败数、产生的 `document_id` 列表。

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_process_raw_ingestion_job.py -q`
- 验证入口边界、object key 结构、registry 写入和 raw asset registry 驱动的处理路径。

### Task 5: 建立去重、版本推进和 stable ID 规则

**Files:**
- Create: `packages/ingestion-core/src/campus_ingestion_core/dedup.py`
- Create: `packages/ingestion-core/src/campus_ingestion_core/identity.py`
- Create: `tests/ingestion/test_dedup_and_identity.py`

**Implementation:**
- 固定去重策略：
  - exact duplicate 使用 `content_hash`
  - stable identity 使用 `document_id`
  - mutable version 使用 `version_id`
- 规则：
  - 相同 `document_id` 且相同 `content_hash` -> skip
  - 相同 `document_id` 且 `content_hash` 变化 -> 新 `version_id`
  - `chunk_id = {document_id}:{version_id}:{chunk_order}`
- 第一阶段不做 near-duplicate。

**Verification:**
- `uv run --all-packages python -m pytest tests/ingestion/test_dedup_and_identity.py -q`

### Task 6: 建立 processed/chunking/embedding 流程

**Files:**
- Create: `packages/ingestion-core/src/campus_ingestion_core/process.py`
- Create: `packages/ingestion-core/src/campus_ingestion_core/chunking.py`
- Create: `packages/ingestion-core/src/campus_ingestion_core/embed.py`
- Create: `tests/ingestion/test_processing_pipeline.py`

**Implementation:**
- 基于导入的 OCR/processed 结果建立规范化处理流程。
- 第一阶段允许直接消费已有 OCR 文本，不要求重新做 OCR。
- 第一阶段将 `student_handbook` chunking / cleaning policy 冻结为 runtime truth，而不是开放 env 级参数调节：
  - `target_tokens = 384`
  - `max_tokens = 512`
  - `overlap_tokens = 64`
  - `min_tokens = 96`
  - `safety_margin_tokens = 16`
  - `split_strategy = structure_first`
  - `chunk_policy_version = student_handbook_semantic_v3`
  - `cleaning_policy_version = student_handbook_cleaning_v1`
  - 预算以最终 contextualized chunk text 为准，必须把标题/章节/条款等 header 计入同一预算
  - `Qwen3-Embedding-4B` tokenizer 是 handbook chunk budgeting 的唯一真相源
- handbook 结构化单元固定为 `article_body`、`policy_page`、`table`、`table_row`
- parent unit 中的原始 HTML table 必须移除并替换为占位文本；表格证据通过 `table` / `table_row` 单元保留
- ingestion-core 负责按冻结策略生成 chunks，并把 metadata 写入后续 `LlamaIndex/Qdrant` 检索路径
- 每个 chunk 必须带：
  - `document_id`
  - `version_id`
  - `chunk_id`
  - `corpus`
  - `acl_groups`
  - `campus_scope`

**Verification:**
- `uv run --all-packages python -m unittest tests.ingestion.test_processing_pipeline`

### Task 7: 建立 retrieval-core 的真实 backend

**Files:**
- Modify: `packages/retrieval-core/pyproject.toml`
- Create: `packages/retrieval-core/src/campus_retrieval_core/settings.py`
- Create: `packages/retrieval-core/src/campus_retrieval_core/models.py`
- Create: `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- Modify: `packages/retrieval-core/src/campus_retrieval_core/service.py`
- Create: `tests/retrieval/test_backend_qdrant.py`

**Implementation:**
- 用 `LlamaIndex + Qdrant` 替换占位的 `retrieve_sources()`
- retrieval 输入至少包含：
  - `query_text`
  - `corpus`
  - `campus_scope`
  - `acl_groups`
- retrieval 输出必须是 `EvidenceBundle` 能直接消费的结构
- retrieval 前置 ACL filter 基于 metadata 执行
- retrieval 读取 corpus runtime profile；当前 query-enabled surface 由 profile 驱动，当前为 `regulations/student_handbook` 与 `curriculum/curriculum_plan`，对未放开的 collection 必须 fail-closed

**Verification:**
- `uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant`
- 验证 source locator、ACL filter、no hit、error mapping。

### Task 8: 落地 rag-specialist

**Files:**
- Modify: `packages/rag-specialist/pyproject.toml`
- Create: `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- Create: `packages/rag-specialist/src/campus_rag_specialist/confidence.py`
- Modify: `packages/rag-specialist/src/campus_rag_specialist/service.py`
- Create: `tests/specialist/test_rag_specialist.py`

**Implementation:**
- 用真实 retrieval-core 替代当前薄封装。
- 引入 Agno specialist agent 包装层，但 service 层仍保持纯 contract 输入输出。
- 固定规则：
  - 空 query -> `needs_clarification`
  - 无证据 -> `no_answer`
  - 有证据 -> `completed`
- `answer_text` 必须基于 evidence bundle 构造。

**Verification:**
- `uv run --all-packages python -m pytest tests/specialist/test_rag_specialist.py -q`

### Task 9: 落地 supervisor-core

**Files:**
- Modify: `packages/supervisor-core/pyproject.toml`
- Create: `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- Create: `packages/supervisor-core/src/campus_supervisor_core/response.py`
- Create: `packages/supervisor-core/src/campus_supervisor_core/audit.py`
- Modify: `packages/supervisor-core/src/campus_supervisor_core/__init__.py`
- Create: `tests/supervisor/test_supervisor_core.py`

**Implementation:**
- 从“直接转调 specialist”升级为真正的 supervisor coordination。
- 第一阶段只路由一个 specialist：`rag-specialist`
- 记录最小审计字段：
  - `request_id`
  - `trace_id`
  - `user_id`
  - `status`
  - `source_doc_ids`

**Verification:**
- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py -q`

### Task 10: 落地 supervisor-api 与 AgentOS runtime

**Files:**
- Modify: `apps/supervisor-api/pyproject.toml`
- Create: `apps/supervisor-api/src/campus_supervisor_api/settings.py`
- Create: `apps/supervisor-api/src/campus_supervisor_api/auth.py`
- Create: `apps/supervisor-api/src/campus_supervisor_api/api.py`
- Modify: `apps/supervisor-api/src/campus_supervisor_api/app.py`
- Create: `tests/api/test_supervisor_api.py`

**Implementation:**
- 用真实 `AgentOS-native + custom HTTP shell` 替换当前 dict descriptor。
- 只暴露新接口：
  - `POST /api/v1/answer`
  - `GET /healthz`
  - `GET /readyz`
- 不保留旧 `/api/search`、`/api/answer`
- auth 层把 bearer principal 映射为 `ActorContext`

**Verification:**
- `uv run --all-packages python -m pytest tests/api/test_supervisor_api.py -q`

### Task 11: 冻结 baseline 与评测

**Files:**
- Create: `packages/evals/src/campus_evals/models.py`
- Modify: `packages/evals/src/campus_evals/scenarios.py`
- Create: `packages/evals/src/campus_evals/expectations.py`
- Create: `packages/evals/src/campus_evals/runner.py`
- Create: `tests/evals/test_golden_cases.py`

**Implementation:**
- 将 `packages/evals` 收口为通用 golden-case / runner / grading 边界，而不是 handbook 专用 smoke helper
- 冻结第一批 `student_handbook` baseline 场景
- 至少覆盖：
  - library hours
  - scholarship eligibility
  - graduation credits
  - registrar transcript
  - add/drop
  - leave of absence
- 支持 multi-corpus request truth，但当前只对“单次请求选一个 query-enabled corpus”的路由语义做评测
- 增加 ingestion 基线：
  - OCR 导入成功
  - 重复导入 skip
  - 更新生成新 `version_id`

**Verification:**
- `uv run --all-packages python -m pytest tests/evals/test_golden_cases.py -q`

### Task 12: 更新骨架 smoke 与项目文档

**Files:**
- Modify: `tests/test_workspace_layout.py`
- Modify: `README.md`
- Modify: `docs/architecture/phase1-ingestion-and-storage-architecture.md` 仅补实现链接
- Modify: `docs/architecture/supervisor-architecture.md` 仅补当前设计链接

**Implementation:**
- 把当前 smoke 从“骨架存在”升级为“主链路可用”
- README 增加实施文档入口
- 架构/决策文档只加索引，不重复复制实施步骤

**Verification:**
- `uv run --all-packages python -m unittest discover -s tests -t .`

## 验收标准

完成后以下条件同时成立：

- 本机 `MinIO` 可作为 raw/processed 真相层使用
- 现有 `campusRAG` OCR 结果可被导入到对象存储
- document registry 可记录 stable ID、version、hash、ACL、状态
- `Qdrant + LlamaIndex` 可产出可回链 evidence bundle
- `Supervisor API -> Supervisor Core -> RAG Specialist -> Retrieval Core` 可跑通
- 返回结果带 `trace_id`、最小 source locator、confidence
- `student_handbook` baseline 场景冻结并可重复运行
- `curriculum_plan` 已完成 data-plane / cleaned-ingestion 收口并进入 profile-driven query-serving；`campus_services` collection 当前仍不进入 query-serving
- gate 0 到 gate 4 均有明确通过证据，而不是只停留在代码存在

## 并行策略

可以使用 subagent/multiagent，但按依赖分批，不同时修改强耦合文件。

推荐分批：

1. A 组
   `contracts`
2. B 组
   `ingestion-core + object store + registry + import`
3. C 组
   `retrieval-core`
4. D 组
   `rag-specialist + supervisor-core`
5. E 组
   `supervisor-api + evals + smoke`

不要并行：

- `contracts` 未冻结前，不写 `retrieval-core` 和 `specialist`
- `retrieval-core` 未稳定前，不冻结 eval baseline

## 假设与默认值

- 当前 `campusRAG` 原始 OCR 结果在本机可访问
- 初始主链路只处理 `regulations/student_handbook`；当前如涉及运行态 serving surface，以 runtime profile 和 `.planning/` 为准
- MinIO 为本机部署，但 contract 一律按 S3-compatible 设计
- worker 输入冻结为 `raw_asset_id + raw_version_id`
- 不做云服务接入
- 不做旧接口兼容层

## 这轮不做的事

- 不在第一阶段引入第二套 retrieval backend
- 不为了未来云厂商预埋多套对象存储 key 规则
- 不做 crawler/job/queue 的真实分布式生产化实现
- 不做 replayable 审计账本、字段级 ACL 或完整 ABAC
- 不为了“方便导入”把本机目录直接提升为长期真相源

补充边界：

- 本文中的 object key 示例如果与 `docs/decisions/adr-0002-local-minio-conventions.md` 冲突，以 `ADR-0002` 和当前实现为准。
