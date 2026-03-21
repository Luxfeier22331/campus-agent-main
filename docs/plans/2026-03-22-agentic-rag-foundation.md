# Agentic RAG Foundation Implementation Plan

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
- Create: `tests/ingestion/test_object_store_config.py`

**Implementation:**
- 新建 `packages/ingestion-core`，统一承载数据摄入侧逻辑。
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

### Task 4: 导入 campusRAG 现有 OCR 结果到对象存储

**Files:**
- Create: `apps/ingestion-worker/pyproject.toml`
- Create: `apps/ingestion-worker/README.md`
- Create: `apps/ingestion-worker/src/campus_ingestion_worker/__init__.py`
- Create: `apps/ingestion-worker/src/campus_ingestion_worker/import_campusrag_ocr.py`
- Create: `tests/ingestion/test_import_campusrag_ocr.py`

**Implementation:**
- 新建 `apps/ingestion-worker`，作为摄入运行时壳。
- 提供 `import_campusrag_ocr` 命令式入口：
  - 从现有 `campusRAG` OCR 产物目录读取原始 OCR 结果
  - 计算 `content_hash`
  - 生成稳定的 `document_id` / `version_id`
  - 写入 raw/processed bucket
  - 注册到 document registry
- `crawler job` 和 `queue` 在这一步只用占位结构表示，不实现真实分布式调度。
- `student_handbook` 作为唯一 corpus。

**Assumption locked for implementation:**
- 如果 `campusRAG` OCR 结果当前是本机已有目录或本机可访问路径，导入工具直接面向那个目录。
- 如果后续路径不一致，只替换配置，不改导入 contract。

**Verification:**
- `pytest tests/ingestion/test_import_campusrag_ocr.py -q`
- 验证 object key 结构、registry 写入、重复导入 skip。

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
- Modify: `docs/architecture/2026-03-22-ingestion-and-storage-architecture.md` 仅补实现链接
- Modify: `docs/decisions/2026-03-22-phase1-architecture-decisions.md` 仅补实施链接

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
