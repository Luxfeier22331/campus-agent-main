# campus-agent v2

校园助理系统 v2 的入口 monorepo。

## 架构入口

这个仓库的默认阅读顺序是：

- 当前 merged truth：`docs/architecture/current-architecture.md`
- 目标架构：`docs/architecture/target-architecture.md`
- supporting architecture：`docs/architecture/product-runtime-architecture.md`、`docs/architecture/execution-and-specialists-architecture.md`、`docs/architecture/identity-and-authorization-architecture.md`、`docs/architecture/retrieval-serving-architecture.md`、`docs/architecture/data-plane-architecture.md`、`docs/architecture/official-web-architecture.md`
- 文档索引与标识规则：`docs/README.md`
- `app-api` 产品层 contract：`docs/contracts/app-api-http.md`
- `app-api -> supervisor-api` 执行契约：`docs/contracts/app-api-supervisor-execution.md`
- `app-api` 数据模型：`docs/data/app-api-schema.md`
- identity / memory / personalization 边界：`docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- request projection ownership：`docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- supervisor internal execution admission：`docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- 编排与安全边界：`docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- 当前 phase / pending work：`.planning/PROJECT.md`、`.planning/REQUIREMENTS.md`、`.planning/STATE.md`
- 历史 phase 排期与存档：`.planning/ROADMAP.md`、`.planning/phases/`

## 当前 merged truth

- 当前主执行链路是 `app-api -> supervisor-api -> supervisor-core -> specialist -> retrieval-core`
- 当前前向产品拓扑是 `public-chat-web -> app-api -> supervisor-api` 与 `protected-panel-web -> app-api -> request projection`
- 当前 query-enabled surface 是 `regulations/student_handbook` 与 `curriculum/curriculum_plan`
- `curriculum/course_facts` 已作为 specialist internal retrieval surface 落地，但不属于默认公开 query surface
- `campus_services/*` 当前保持 `offline_preparation`
- `apps/app-api` 是唯一 product-layer auth/session/principal owner；`apps/supervisor-api` 只做 internal execution admission
- shared seam 以 `ContextProjection` / `SupervisorResponse` 为准；后续改动不得回退到旧 `snapshot`

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
- `apps/official-web-collector`: official web collector runtime
- `apps/protected-internal-panel`: historical internal panel reference
- `packages/supervisor-core`: user goal 路由、委派和最终响应组装
- `packages/ingestion-core`: ingestion/data plane 逻辑消费层
- `packages/rag-specialist`: 知识域 specialist 入口
- `packages/retrieval-core`: retrieval 抽象和 evidence 获取引导层
- `packages/contracts`: 共享请求 / 响应与 delegation / handoff schema
- `packages/evals`: 评测辅助和 smoke 场景
- `packages/shared`: 轻量共享常量和工具

当前 merged-truth 架构快照以 `docs/architecture/current-architecture.md` 为准；目标方向与不变量以 `docs/architecture/target-architecture.md` 和对应 ADR 为准；执行进度、phase 排序和 pending work 以 `.planning/PROJECT.md`、`.planning/ROADMAP.md`、`.planning/STATE.md` 为准。

## 实施文档

- execution / supervisor：`docs/plans/supervisor-current-design-implementation.md`
- identity / memory / ACL：`docs/plans/intent-memory-acl-foundation.md`
- restricted documents：`docs/plans/campus-identity-and-restricted-document-foundation.md`、`docs/plans/restricted-document-rollout-and-verification.md`
- versioned query：`docs/plans/versioned-history-query-foundation.md`
- eval / dataset：`docs/plans/golden-dataset-execution-plan.md`
- env / provider governance：`docs/plans/env-bootstrap-and-provider-configuration-governance.md`

`docs/plans/` 只保留仍对前向实施有指导价值的计划文档；已完成的历史 bootstrap / baseline 不再作为默认入口，必要时请看 `.planning/` 或 git history。

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

当前 forward Worker topology 的 targeted smoke 命令与验证边界见 `docs/runbooks/forward-worker-surface-smoke-runbook.md`；当前 index / serving 术语见 `docs/reference/runtime-serving-and-index-terms.md`。
