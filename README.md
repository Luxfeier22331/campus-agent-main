# campus-agent v2

新一代 campus 入口 agent 的 monorepo。

## 先定架构

这个仓库正在围绕长期的 `supervisor-led hybrid orchestration` 架构重建。

- 文档索引与标识规则：`docs/README.md`
- 长期架构文档：`docs/architecture/long-term-architecture.md`
- `app-api` 架构文档：`docs/architecture/app-api-architecture.md`
- `app-api` 产品层 contract：`docs/contracts/app-api-http.md`
- `app-api -> supervisor-api` 执行契约：`docs/contracts/app-api-supervisor-execution.md`
- `app-api` 数据模型：`docs/data/app-api-schema.md`
- supervisor 专项架构：`docs/architecture/supervisor-architecture.md`
- 第一阶段决策记录：`docs/decisions/adr-0001-phase1-architecture.md`
- 编排与安全边界：`docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- shared `apps/app-api` runtime 已冻结为 Worker；见 `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `apps/supervisor-api` 表示 execution engine boundary，不代表已经选定 FastAPI 或其他 runtime
- execution engine runtime 选择仍保持未冻结；当前实现取舍见 `docs/decisions/adr-0001-phase1-architecture.md`

## 仓库范围

- `apps/supervisor-api`: 入口 / supervisor 的对外服务边界
- `apps/app-api`: forward shared product backend boundary，长期形态为 internal Worker runtime
- `packages/supervisor-core`: user goal 路由、委派和最终响应组装
- `packages/rag-specialist`: 知识域 specialist 入口
- `packages/retrieval-core`: retrieval 抽象和 evidence 获取引导层
- `packages/contracts`: 共享请求 / 响应与 delegation / handoff schema
- `packages/evals`: 评测辅助和 smoke 场景
- `packages/shared`: 轻量共享常量和工具

## 当前基线

仓库已经从纯 bootstrap 进入 phase-1 主链路收口阶段。

- 旧 bootstrap 已从工作树移除；如需追溯请查看 git 历史
- 当前主路径是 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core`
- forward product topology 已冻结为 `public-chat-web -> app-api -> supervisor-api` 与 `protected-panel-web -> app-api -> request projection`
- 架构目标是 `supervisor-led hybrid orchestration`，而不是把 RAG 降级成顶层产品路径里的扁平 tool adapter
- ingestion/object-store/registry/retrieval 地基已落地
- 查询链路当前由 collection runtime profile 控制；当前 query-enabled surface 是 `regulations/student_handbook` 和 `curriculum/curriculum_plan`
- ingestion truth 统一为 `corpus + collection`：默认入口是 `regulations/student_handbook`；source 资产位于 `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...`，并在同一来源前缀下按 `capture/`、`provider/`、`source-truth/` 分层保存，清洗后的文档存放在 derived bucket 的 `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/...`
- `curriculum/curriculum_plan` 已进入 query-serving runtime profile 的受控 surface
- `campus_services/service_catalog` 与 `campus_services/contact_directory` 已作为离线 taxonomy 预留，当前保持 `offline_preparation`，不开放 retrieval 或默认 query-serving
- `rag-specialist`、`supervisor-core`、`supervisor-api`、`evals` 已有可测试的 phase-1 入口
- `uv run --all-packages python -m unittest discover -s tests -t .` 当前通过，作为仓库级基线验证命令
- 运行态 buckets、live collection 重建证据、points count 与 benchmark 结果不在 README 维护；应以 `.planning/STATE.md` 和 `docs/verification/` 为准

## 协作约定

- 提交标题默认使用 `Conventional Commit` 前缀加中文结果描述，例如：`feat: 完成 Phase 2A 工作流补全（resume/apply-choice + navigation_mode）`
- 详细工作协议与提交标题规则以根 `AGENTS.md` 为准

## 实现入口

- phase-1 地基实施基线：`docs/plans/agentic-rag-foundation.md`
- 编排架构刷新：`docs/plans/agent-orchestration-architecture-refresh.md`
- `app-api` 实施方案：`docs/plans/app-api-worker-foundation.md`
- `app-api` contract / lifecycle / schema：`docs/contracts/`、`docs/data/`
- 当前执行状态与 phase 推进：`.planning/PROJECT.md`、`.planning/ROADMAP.md`、`.planning/STATE.md`
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
