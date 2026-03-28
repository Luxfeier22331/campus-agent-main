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
- identity / memory / personalization 边界：`docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- request projection ownership：`docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- supervisor internal execution admission：`docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- supervisor 专项架构：`docs/architecture/supervisor-architecture.md`
- 第一阶段数据平面架构：`docs/architecture/phase1-ingestion-and-storage-architecture.md`
- 编排与安全边界：`docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- shared `apps/app-api` runtime 已冻结为 Worker；见 `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `apps/supervisor-api` 表示 execution engine boundary，不代表已经选定 FastAPI 或其他 runtime
- execution engine runtime 选择仍保持未冻结；当前实现取舍与 Agno 集成边界见 `docs/architecture/supervisor-architecture.md`

## 仓库范围

- `apps/public-chat-web`: public-facing Worker web surface
- `apps/protected-panel-web`: protected Worker web surface
- `apps/app-api`: shared Worker-native product backend
- `apps/supervisor-api`: execution engine boundary
- `apps/ingestion-worker`: ingestion runtime 壳与离线任务入口
- `packages/supervisor-core`: user goal 路由、委派和最终响应组装
- `packages/ingestion-core`: ingestion/data plane 逻辑消费层
- `packages/rag-specialist`: 知识域 specialist 入口
- `packages/retrieval-core`: retrieval 抽象和 evidence 获取引导层
- `packages/contracts`: 共享请求 / 响应与 delegation / handoff schema
- `packages/evals`: 评测辅助和 smoke 场景
- `packages/shared`: 轻量共享常量和工具

## 当前基线

仓库已经从纯 bootstrap 进入 phase-1 主链路收口阶段。

- 旧 bootstrap 已从工作树移除；如需追溯请查看 git 历史
- 当前主路径是 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core`
- forward product topology 已落地为 `public-chat-web -> app-api -> supervisor-api` 与 `protected-panel-web -> app-api -> request projection`
- `apps/app-api` 已正式落地为 shared Worker runtime，并已接上 `public-chat-web` 与 `protected-panel-web`
- `app-api` 是唯一的产品层 auth/session/principal owner；`supervisor-api` 只做 internal execution caller admission
- identity / memory truth 已冻结为 `verified identity`、`profile memory`、`session memory`、`institutional knowledge` 四层；memory 只能个性化，不能授权
- canonical request projection 由 `app-api` command path 一次产出，并通过 runtime-owned operator request APIs 提供给 panel
- 架构目标是 `supervisor-led hybrid orchestration`，而不是把 RAG 降级成顶层产品路径里的扁平 tool adapter
- ingestion/object-store/registry/retrieval 地基已落地
- 查询链路当前由 collection runtime profile 控制；当前 query-enabled surface 是 `regulations/student_handbook` 和 `curriculum/curriculum_plan`
- ingestion truth 统一为 `corpus + collection`：默认入口是 `regulations/student_handbook`；source 资产位于 `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...`，并在同一来源前缀下按 `capture/`、`provider/`、`source-truth/` 分层保存，清洗后的文档存放在 derived bucket 的 `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/...`
- `curriculum/curriculum_plan` 已进入 query-serving runtime profile 的受控 surface
- `campus_services/service_catalog` 与 `campus_services/contact_directory` 已作为离线 taxonomy 预留，当前保持 `offline_preparation`，不开放 retrieval 或默认 query-serving
- `rag-specialist`、`supervisor-core`、`supervisor-api`、`evals` 已有可测试的 phase-1 入口
- `uv run --all-packages python -m unittest discover -s tests -t .` 当前通过，作为仓库级基线验证命令
- Node / Worker app 当前统一使用 `pnpm`，不再维护 `package-lock.json`
- `apps/public-consumer-chat` 是已合入主线的 04.7 历史实现参考，不再是 forward backend truth
- 运行态 buckets、live collection 重建证据、points count 与 benchmark 结果不在 README 维护；应以 `.planning/STATE.md`、`docs/runbooks/`、`docs/reference/` 和 `docs/policies/` 为准

## 协作约定

- 提交标题默认使用 `Conventional Commit` 前缀加中文结果描述，例如：`feat: 完成 Phase 2A 工作流补全（resume/apply-choice + navigation_mode）`
- 详细工作协议与提交标题规则以根 `AGENTS.md` 为准

## 实现入口

- phase-1 地基实施基线：`docs/plans/agentic-rag-foundation.md`
- `app-api` 实施方案：`docs/plans/app-api-worker-foundation.md`
- identity / memory / ACL 实施方案：`docs/plans/intent-memory-acl-foundation.md`
- `app-api` contract / lifecycle / schema：`docs/contracts/`、`docs/data/`
- 当前执行状态与 phase 推进：`.planning/PROJECT.md`、`.planning/ROADMAP.md`、`.planning/STATE.md`
- ingestion/data plane：`apps/ingestion-worker`、`packages/ingestion-core`
- retrieval kernel：`packages/retrieval-core`
- specialist / supervisor：`packages/rag-specialist`、`packages/supervisor-core`
- API shell：`apps/supervisor-api`
- baseline / smoke：`packages/evals`、`tests/`
- forward Worker smoke runbook：`docs/runbooks/forward-worker-surface-smoke-runbook.md`

## 本地验证

```bash
uv sync --all-packages --dev
uv run --all-packages python -m unittest discover -s tests -t .
pnpm --dir apps/app-api test
pnpm --dir apps/app-api typecheck
pnpm --dir apps/public-chat-web test
pnpm --dir apps/public-chat-web typecheck
pnpm --dir apps/protected-panel-web test
pnpm --dir apps/protected-panel-web typecheck
```

当前 forward Worker topology 的 targeted smoke 命令与验证边界见 `docs/runbooks/forward-worker-surface-smoke-runbook.md`。
