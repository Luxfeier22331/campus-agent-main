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
- 数据平面架构约束（历史文件名保留）：`docs/architecture/phase1-ingestion-and-storage-architecture.md`
- 编排与安全边界：`docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- shared `apps/app-api` runtime 已冻结为 Worker；见 `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `apps/supervisor-api` 表示 execution engine boundary，不代表已经选定 FastAPI 或其他 runtime
- execution engine runtime 选择仍保持未冻结；当前实现取舍与 Agno 集成边界见 `docs/architecture/supervisor-architecture.md`

## 导航

- 当前运行面、已开放 serving surface、当前优先级：`.planning/PROJECT.md`、`.planning/REQUIREMENTS.md`、`.planning/STATE.md`
- 长期边界和冻结决策：`docs/architecture/`、`docs/decisions/`
- 环境配置 ownership 与模板索引：`docs/environment/README.md`
- 历史 phase 排期与存档：`.planning/ROADMAP.md`、`.planning/phases/`
- 当前 index / serving 术语：`docs/reference/runtime-serving-and-index-terms.md`
- 分支集成与稳定发布流程：`docs/runbooks/develop-main-release-runbook.md`

## 分支模型

- `develop` 是长期集成分支，`main` 是稳定分支
- 讨论“当前 merged truth”时，默认指已合入 `develop` 的状态；独立 worktree 的进度只有在写明分支或已回 `develop` 后才能当作 merged truth
- 历史上“某实现已合入 `main`”的记录可以保留，但不等于当前工作树一定检出 `main`
- 具体的 `worktree feature -> develop -> main` 流程见 `docs/runbooks/develop-main-release-runbook.md`

## 当前仓库范围

- `apps/public-chat-web`: public-facing Worker web surface
- `apps/protected-panel-web`: protected Worker web surface
- `apps/app-api`: shared Worker-native product backend
- `apps/supervisor-api`: execution engine boundary
- `apps/ingestion-worker`: ingestion runtime 壳与离线任务入口
- `apps/protected-internal-panel`: historical internal panel reference
- `packages/supervisor-core`: user goal 路由、委派和最终响应组装
- `packages/ingestion-core`: ingestion/data plane 逻辑消费层
- `packages/rag-specialist`: 知识域 specialist 入口
- `packages/retrieval-core`: retrieval 抽象和 evidence 获取引导层
- `packages/contracts`: 共享请求 / 响应与 delegation / handoff schema
- `packages/evals`: 评测辅助和 smoke 场景
- `packages/shared`: 轻量共享常量和工具

已接受的前向产品拓扑是 `public-chat-web -> app-api -> supervisor-api` 与 `protected-panel-web -> app-api -> request projection`。当前 `protected-panel-web` worktree 已落地 shared Worker backend 与 web-surface 接线；当这些改动回 `develop` / `main` 时，仍必须保持 `ContextProjection` / `SupervisorResponse` shared seam，不得回退到旧 `snapshot` 路径。

## 当前接受基线

当前执行进度、phase 排序和 pending work 以 `.planning/PROJECT.md`、`.planning/ROADMAP.md`、`.planning/STATE.md` 为准；README 只描述当前 merged truth 下已接受的架构与运行约束。

- 旧 bootstrap 已从工作树移除；如需追溯请查看 git 历史
- 当前主路径是 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core`
- forward product topology 已落地为 `public-chat-web -> app-api -> supervisor-api` 与 `protected-panel-web -> app-api -> request projection`
- `apps/app-api` 已正式落地为 shared Worker runtime，并已接上 `public-chat-web` 与 `protected-panel-web`
- `app-api` 是唯一的产品层 auth/session/principal owner；`supervisor-api` 只做 internal execution caller admission
- identity / memory truth 已冻结为 `verified identity`、`profile memory`、`session memory`、`institutional knowledge` 四层；memory 只能个性化，不能授权
- canonical request projection 由 `app-api` command path 一次产出，并通过 runtime-owned operator request APIs 提供给 panel
- `develop` 新增的 shared seam / curriculum gate / supplemental runtime 文档与评测更新已并入当前 worktree，后续合流不得回退这些约束
- 架构目标是 `supervisor-led hybrid orchestration`，而不是把 RAG 降级成顶层产品路径里的扁平 tool adapter
- ingestion/object-store/registry/retrieval 地基已落地
- 查询链路当前由 collection runtime profile 控制；当前 query-enabled surface 是 `regulations/student_handbook` 和 `curriculum/curriculum_plan`
- ingestion truth 统一为 `corpus + collection`：默认入口是 `regulations/student_handbook`；source 资产位于 `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...`，并在同一来源前缀下按 `capture/`、`provider/`、`source-truth/` 分层保存，清洗后的文档存放在 derived bucket 的 `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/...`
- `curriculum/curriculum_plan` 已进入 query-serving runtime profile 的受控 surface
- `campus_services/service_catalog` 与 `campus_services/contact_directory` 已作为离线 taxonomy 预留，当前保持 `offline_preparation`，不开放 retrieval 或默认 query-serving
- `rag-specialist`、`supervisor-core`、`supervisor-api`、`evals` 已形成可测试的当前主链路入口
- `uv run --all-packages python -m unittest discover -s tests -t .` 当前通过，作为仓库级基线验证命令
- Node / Worker app 当前统一使用 `pnpm`，不再维护 `package-lock.json`
- 运行态 buckets、live collection 重建证据、points count 与 benchmark 结果不在 README 维护；应以 `.planning/STATE.md`、`docs/runbooks/`、`docs/reference/` 和 `docs/policies/` 为准

## JS/TS Workspace

- Python workspace 继续以 `uv` 为准；不要把 `turbo` 当成 Python 主链路的替代
- JS/TS apps 现在通过 repo root `pnpm-workspace.yaml` 和 `turbo.json` 统一编排
- 当前纳入 workspace 的主要 Worker/web app 是 `apps/app-api`、`apps/public-chat-web` 与 `apps/protected-panel-web`
- repo root `package.json` 只提供 Turbo 代理脚本，不承载 app 级业务逻辑
- `pnpm web:test` 是 JS/TS 默认稳定 gate，不等于所有可能的 worker / integration lane 全部并入
- 显式 Worker runtime lane 使用 `pnpm web:test:worker`
- 显式 shared-db integration lane 使用 `pnpm web:test:integration`
- 日常全量验证使用 `pnpm web:typecheck`、`pnpm web:test`、`pnpm web:build`
- 面向 `develop` 的增量验证使用 `pnpm web:typecheck:affected`、`pnpm web:test:affected`、`pnpm web:build:affected` 或 `pnpm web:check:affected`
- 具体 lane 语义见 `docs/reference/testing-and-verification-lanes.md`

## 协作约定

- 提交标题默认使用 `Conventional Commit` 前缀加中文结果描述，例如：`feat: 完成 Phase 2A 工作流补全（resume/apply-choice + navigation_mode）`
- 详细工作协议与提交标题规则以根 `AGENTS.md` 为准

## 实现入口

- 历史地基实施基线：`docs/plans/agentic-rag-foundation.md`
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
pnpm install
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:test:integration
pnpm web:build
pnpm web:check:affected
pnpm --dir apps/app-api test
pnpm --dir apps/app-api test:all
pnpm --dir apps/app-api test:worker
pnpm --dir apps/app-api test:shared-db-integration
pnpm --dir apps/app-api typecheck
pnpm --dir apps/public-chat-web test
pnpm --dir apps/public-chat-web test:worker
pnpm --dir apps/public-chat-web typecheck
pnpm --dir apps/protected-panel-web test
pnpm --dir apps/protected-panel-web test:worker
pnpm --dir apps/protected-panel-web typecheck
```

当前 forward Worker topology 的 targeted smoke 命令与验证边界见 `docs/runbooks/forward-worker-surface-smoke-runbook.md`。
