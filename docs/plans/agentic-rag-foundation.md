---
doc_type: plan
status: active
created: 2026-03-22
updated: 2026-03-22
---

# Agentic RAG 第一阶段地基实施文档

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在当前 `campus-agent` monorepo 中补齐第一阶段地基，以“符合最佳实践前提下跑通端到端 agentic RAG 流程”为验收标准。

**Architecture:** 本次实施只做第一阶段可上线闭环，不保留旧 `/api/search`、`/api/answer` 兼容层。数据面按 `Raw -> Processed -> Chunk/Index` 三层分离落地，当前对象存储使用本机部署的 `MinIO`，并从现有 `campusRAG` 导入原始 OCR 结果作为第一批基线资产。查询面采用 `Supervisor API -> Supervisor Core -> RAG Specialist -> Retrieval Core`，内部 runtime 使用 AgentOS-native，检索实现使用 `LlamaIndex + Qdrant`。

**Tech Stack:** Python 3.12, uv workspace, Agno AgentOS, LlamaIndex, Qdrant, MinIO (local S3-compatible), pytest/unittest

---

## 摘要

本实施文档从架构文档中拆出，专门定义第一阶段的可执行动作、文件落点、接口、测试和验收标准。目标不是做完整产品，而是补齐项目地基：

- 冻结 contract 和 evidence bundle
- 建立本机 MinIO 对象存储边界
- 增加 ingestion/data plane 基础层
- 从 `campusRAG` 导入现有原始 OCR 结果到对象存储
- 建立 document registry 与 Qdrant 检索链路
- 跑通最小 agentic RAG 主链路
- 冻结第一批 baseline 场景

实施范围固定为：

- 只支持 `student_handbook`
- `crawler job` 和 `queue` 只保留占位符，不做真实分布式调度
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
- 第一阶段架构取舍和约束，留在 `docs/decisions/adr-0001-phase1-architecture.md`
- 本机 `MinIO` 作为本地对象存储替代实现的规则，留在 `docs/decisions/adr-0002-local-minio-conventions.md`
- 这份文档只负责把上面三类原则拆成可实施的落地顺序、门禁、文件落点和验收标准

## 完成定义

这一阶段不是“代码骨架更多了”，而是以下闭环可以稳定重跑：

- 本机 `MinIO` 已部署，并通过 `S3-compatible` 配置被接入
- `campusRAG` 现有 OCR 资产已经被导入 object storage，并在 registry 中登记
- 已能基于导入资产完成 chunking、embedding、Qdrant 建索引
- `Supervisor API -> Supervisor Core -> RAG Specialist -> Retrieval Core` 能返回带 evidence 的回答
- 第一批 `student_handbook` baseline 已冻结，并且可重复执行

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
          | MinIO raw bucket |   | MinIO processed bucket |
          +------------------+   +------------------------+
                      ^
                      |
          +-----------------------------+
          | campusRAG OCR existing data |
          | crawler/job/queue placeholder|
          +-----------------------------+
```

## 实施前冻结项

在写任何正式实现之前，先冻结以下输入，不允许边做边漂移：

- 语料范围：只允许 `student_handbook`
- 导入来源：只允许当前本机可访问的 `campusRAG` OCR 资产
- object storage 语义：只允许 `campus-rag-raw` / `campus-rag-processed`
- object key 结构：只允许 `student_handbook/{document_id}/{version_id}/raw|processed/...`
- retrieval 实现：只允许 `LlamaIndex + Qdrant`
- chunk profile：第一轮固定一套 chunk 大小、overlap、metadata 映射
- embedding profile：第一轮固定一个 embedding model 标识
- baseline 场景：第一轮固定 `student_handbook` 的问题集和预期 source locator

## campusRAG 资产导入规则

第一阶段导入的不是“重新抓取后的新文档”，而是当前已经存在的 `campusRAG` 资产。这里必须把 raw 和 processed 区分清楚，避免把历史 OCR 结果错误伪装成原始源文件。

导入映射规则固定为：

- 如果上游能提供原始 PDF/HTML/Markdown 等源文件：
  - 写入 `campus-rag-raw`
  - `source_uri` 指向原始来源
- 如果上游只提供 OCR JSON、OCR 文本、结构化抽取结果：
  - 写入 `campus-rag-processed`
  - registry 中明确标记它来自 `campusRAG` 导入，而不是新抓取 raw
- 如果原始文件和 OCR 结果同时存在：
  - raw 和 processed 都写
  - 两者共用同一个 `document_id`
  - 由 `version_id` 表示同一文档版本下的资产集合
- 如果 OCR 来自在线供应商：
  - processed bucket 下至少同时保存 `provider-result.jsonl` 和 `structured.jsonl`
  - `provider-result.jsonl` 保留供应商原始响应
  - `structured.jsonl` 保留内部统一格式，不能直接用供应商原始响应替代
- 不允许因为第一阶段赶进度，就把 OCR 文本直接冒充 raw layer 真相源

第一阶段至少要冻结以下导入基线资产：

- 导入源目录或 manifest 的解析规则
- `document_id` 的生成规则
- `version_id` 的推进规则
- `content_hash` 的计算口径
- campus / ACL metadata 的映射规则
- import report 的输出格式

## 阶段门禁

为了避免“代码写了很多但主链路仍然不通”，第一阶段按门禁推进：

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
  字段：`document_id`, `version_id`, `corpus`, `source_uri`, `content_hash`
- `EvidenceSource`
  字段：`doc_id`, `version_id`, `chunk_id`, `anchor`, `acl_level`, `canonical_url`, `latest_url`, `snippet`, `score`
- `EvidenceBundle`
  字段：`query_text`, `corpus`, `sources`
- `DelegateToRagAgentRequest`
  字段：`user_goal`, `conversation_id`, `request_id`, `trace`, `actor`, `corpora`
- `DelegateToRagAgentResponse`
  字段：`status`, `answer_text`, `follow_up_question`, `confidence`, `evidence`, `error`

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
- `corpora` 第一阶段默认且只允许 `("student_handbook",)`。
- 明确 `DocumentRef` 与 `EvidenceSource` 的最小字段集，对齐现有决策文档与 legacy source locator 语义。

**Verification:**
- `pytest tests/contracts/test_models.py -q`
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
  - `OBJECT_STORE_BUCKET_RAW`
  - `OBJECT_STORE_BUCKET_PROCESSED`
- 固定 bucket 默认值：
  - `campus-rag-raw`
  - `campus-rag-processed`
- 提供 object storage 客户端工厂，不暴露 MinIO 内部细节到 contract 层。
- bucket 创建由部署脚本或初始化步骤完成，不允许业务代码在运行期隐式兜底创建。

**Verification:**
- `pytest tests/ingestion/test_object_store_config.py -q`
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
- `pytest tests/ingestion/test_registry_models.py -q`

### Task 4: 拆分历史 OCR 补录与 raw-first ingestion runtime

**Files:**
- Create: `apps/ingestion-worker/pyproject.toml`
- Create: `apps/ingestion-worker/README.md`
- Create: `apps/ingestion-worker/src/campus_ingestion_worker/__init__.py`
- Create: `apps/ingestion-worker/src/campus_ingestion_worker/import_campusrag_existing_ocr.py`
- Create: `apps/ingestion-worker/src/campus_ingestion_worker/submit_raw_ingestion_job.py`
- Create: `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py`
- Create: `tests/ingestion/test_import_campusrag_existing_ocr.py`
- Create: `tests/ingestion/test_submit_raw_ingestion_job.py`
- Create: `tests/ingestion/test_process_raw_ingestion_job.py`

**Implementation:**
- 新建 `apps/ingestion-worker`，作为摄入运行时壳。
- 提供三个独立入口：
  - `import_campusrag_existing_ocr`
    只负责历史 structured OCR 补录，可选绑定 raw provenance，但绝不触发在线 OCR
  - `submit_raw_ingestion_job`
    表达未来正式链路中的 queue/job 边界；第一阶段只写 placeholder envelope
  - `process_raw_ingestion_job`
    表达未来正式链路中的 worker 边界；对 raw PDF 做在线 OCR，写 raw/processed/registry
- `crawler job` 和 `queue` 在这一步只保留 placeholder 结构，不实现真实分布式调度。
- `student_handbook` 作为唯一 corpus。
- 如果仅存在 OCR 文本或 OCR JSON，则只允许写入 `processed` bucket，不允许伪造 raw layer。
- 如果 OCR 来自在线供应商：
  - `processed/` 下至少同时保存 `provider-result.jsonl` 和 `structured.jsonl`
  - 两者必须分开保存，不能互相替代
- 导入过程必须产出 import report，最少包含成功数、跳过数、失败数、产生的 `document_id` 列表。

**Assumption locked for implementation:**
- 如果 `campusRAG` OCR 结果当前是本机已有目录或本机可访问路径，导入工具直接面向那个目录。
- 如果后续路径不一致，只替换配置，不改导入 contract。

**Verification:**
- `pytest tests/ingestion/test_import_campusrag_existing_ocr.py -q`
- `pytest tests/ingestion/test_submit_raw_ingestion_job.py -q`
- `pytest tests/ingestion/test_process_raw_ingestion_job.py -q`
- 验证入口边界、object key 结构、registry 写入、重复导入 skip 和 placeholder job envelope。

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
- `pytest tests/ingestion/test_dedup_and_identity.py -q`

### Task 6: 建立 processed/chunking/embedding 流程

**Files:**
- Create: `packages/ingestion-core/src/campus_ingestion_core/process.py`
- Create: `packages/ingestion-core/src/campus_ingestion_core/chunking.py`
- Create: `packages/ingestion-core/src/campus_ingestion_core/embed.py`
- Create: `tests/ingestion/test_processing_pipeline.py`

**Implementation:**
- 基于导入的 OCR/processed 结果建立规范化处理流程。
- 第一阶段允许直接消费已有 OCR 文本，不要求重新做 OCR。
- 使用 `LlamaIndex` 的 document/node pipeline 生成 nodes/chunks。
- 每个 chunk 必须带：
  - `document_id`
  - `version_id`
  - `chunk_id`
  - `corpus`
  - `acl_groups`
  - `campus_scope`

**Verification:**
- `pytest tests/ingestion/test_processing_pipeline.py -q`

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
- retrieval 只支持 `student_handbook`

**Verification:**
- `pytest tests/retrieval/test_backend_qdrant.py -q`
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
- `pytest tests/specialist/test_rag_specialist.py -q`

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
- `pytest tests/supervisor/test_supervisor_core.py -q`

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
- `pytest tests/api/test_supervisor_api.py -q`

### Task 11: 冻结 baseline 与评测

**Files:**
- Modify: `packages/evals/src/campus_evals/scenarios.py`
- Create: `packages/evals/src/campus_evals/expectations.py`
- Create: `packages/evals/src/campus_evals/runner.py`
- Create: `tests/evals/test_student_handbook_baseline.py`

**Implementation:**
- 冻结第一批 `student_handbook` baseline 场景
- 至少覆盖：
  - library hours
  - scholarship eligibility
  - graduation credits
  - registrar transcript
  - add/drop
  - leave of absence
- 增加 ingestion 基线：
  - OCR 导入成功
  - 重复导入 skip
  - 更新生成新 `version_id`

**Verification:**
- `pytest tests/evals/test_student_handbook_baseline.py -q`

### Task 12: 更新骨架 smoke 与项目文档

**Files:**
- Modify: `tests/test_workspace_layout.py`
- Modify: `README.md`
- Modify: `docs/architecture/phase1-ingestion-and-storage-architecture.md` 仅补实现链接
- Modify: `docs/decisions/adr-0001-phase1-architecture.md` 仅补实施链接

**Implementation:**
- 把当前 smoke 从“骨架存在”升级为“主链路可用”
- README 增加实施文档入口
- 架构/决策文档只加索引，不重复复制实施步骤

**Verification:**
- `python3 -m unittest discover -s tests -t .`

## 验收标准

完成后以下条件同时成立：

- 本机 `MinIO` 可作为 raw/processed 真相层使用
- 现有 `campusRAG` OCR 结果可被导入到对象存储
- document registry 可记录 stable ID、version、hash、ACL、状态
- `Qdrant + LlamaIndex` 可产出可回链 evidence bundle
- `Supervisor API -> Supervisor Core -> RAG Specialist -> Retrieval Core` 可跑通
- 返回结果带 `trace_id`、最小 source locator、confidence
- baseline 场景冻结并可重复运行
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
- 第一阶段只处理 `student_handbook`
- MinIO 为本机部署，但 contract 一律按 S3-compatible 设计
- `crawler/job` 与 `queue` 仅保留占位结构
- 不做云服务接入
- 不做旧接口兼容层

## 这轮不做的事

- 不在第一阶段引入第二套 retrieval backend
- 不为了未来云厂商预埋多套对象存储 key 规则
- 不做 crawler/job/queue 的真实分布式生产化实现
- 不做 replayable 审计账本、字段级 ACL 或完整 ABAC
- 不为了“方便导入”把本机目录直接提升为长期真相源
