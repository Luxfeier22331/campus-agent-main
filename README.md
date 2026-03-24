# campus-agent v2

新一代 campus 入口 agent 的 monorepo。

## 先定架构

这个仓库正在围绕长期的 supervisor + specialist 架构重建。

- 文档索引与标识规则：`docs/README.md`
- 长期架构文档：`docs/architecture/long-term-architecture.md`
- 第一阶段决策记录：`docs/decisions/adr-0001-phase1-architecture.md`
- `apps/supervisor-api` 表示对外 serving boundary，不代表已经选定 FastAPI 或其他 runtime
- runtime 选择要放在 contract 和 package 边界稳定之后

## 仓库范围

- `apps/supervisor-api`: 入口 / supervisor 的对外服务边界
- `packages/supervisor-core`: user goal 路由、委派和最终响应组装
- `packages/rag-specialist`: 知识域 specialist 入口
- `packages/retrieval-core`: retrieval 抽象和 evidence 获取引导层
- `packages/contracts`: 共享请求 / 响应和 handoff schema
- `packages/evals`: 评测辅助和 smoke 场景
- `packages/shared`: 轻量共享常量和工具

## 当前状态

仓库已经从纯 bootstrap 进入 phase-1 主链路收口阶段。

- 旧 bootstrap 已从工作树移除；如需追溯请查看 git 历史
- 当前主路径是 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core`
- 架构目标是 supervisor-led multi-agent orchestration，而不是 `RAG as a tool`
- ingestion/object-store/registry/retrieval 地基已落地
- 查询链路当前默认只开放 `regulations` corpus 中的 `student_handbook` collection
- ingestion truth 统一为 `corpus + collection`：默认入口是 `regulations/student_handbook`；raw 来源资产位于 `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...`，processed source artifacts 位于 `{corpus}/sources/{source_channel}/{source_asset_slug}/{year}/{ingest_id}/...`，清洗后的文档存放在 `{corpus}/documents/{collection}/{title_slug}--{docid8}/{representation}/{year}/...`
- `curriculum/curriculum_plan` 已进入 data-plane / cleaned-ingestion 收口，但 phase-1 默认仍不放开 query-serving
- `rag-specialist`、`supervisor-core`、`supervisor-api`、`evals` 已有可测试的 phase-1 入口
- `uv run --all-packages python -m unittest discover -s tests -t .` 当前通过，仓库基线测试为 `85` 项
- 运行态已确认本机 `MinIO` 可访问，`campus-rag-raw` / `campus-rag-processed` bucket 和现有 `student_handbook` 资产已存在
- 运行态已确认配置中的 `Qdrant Cloud` endpoint 可达，但当前实例没有 collection；`.env` 指向的 `student_handbook` collection 仍不存在，因此向量上传尚未完成

## 协作约定

- 提交标题默认使用 `Conventional Commit` 前缀加中文结果描述，例如：`feat: 完成 Phase 2A 工作流补全（resume/apply-choice + navigation_mode）`
- 详细工作协议与提交标题规则以根 `AGENTS.md` 为准

## 实现入口

- phase-1 实施文档：`docs/plans/agentic-rag-foundation.md`
- ingestion/data plane：`apps/ingestion-worker`、`packages/ingestion-core`
- retrieval kernel：`packages/retrieval-core`
- specialist / supervisor：`packages/rag-specialist`、`packages/supervisor-core`
- API shell：`apps/supervisor-api`
- baseline / smoke：`packages/evals`、`tests/`

## 本地验证

```bash
uv sync --all-packages --dev
uv run --all-packages python -m pytest tests/specialist/test_rag_specialist.py tests/supervisor/test_supervisor_core.py tests/api/test_supervisor_api.py tests/evals/test_golden_cases.py -q
uv run --all-packages python -m unittest discover -s tests -t .
```
