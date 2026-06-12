# campus-agent

`campus-agent` 是校园助理系统 v2 的入口 monorepo。

## Overview

当前产品方向不是通用聊天机器人，而是一个 `institution-scoped`、`campus-web first`、
Execution Agent Layer-led 的校园助理系统：`campus-web` 学生侧主体验、账号浏览器 shell 与文档阅读面、
受保护运营面、共享 `app-api`、内部 `execution-control`，以及按能力边界拆分的 capability /
retrieval / ingestion packages。

当前 merged truth 的主路径为：

```text
browser -> campus-web -> student experience / account shell

campus-web same-origin allowlisted /api/* -> app-api

browser -> public-chat-web -> app-api -> execution-control
-> Temporal -> workflow-worker / activity-worker-context /
activity-worker-knowledge / capability workers / activity-worker-finalization
-> memory recall / typed capability branch / Go RAG DTO/runtime
-> Qdrant / provider / structured read models -> sanitized projection

browser -> campus-web /docs/* -> Rspress-powered canonical reader

browser -> protected-panel-web -> app-api
-> request projection / operator read model
```

当前正式 docs surface 为 `campus-web /docs/*`；`/api/docs/*` 通过
campus-web same-origin Worker seam 进入 `app-api` docs control plane。

该仓库当前的核心约束包括：

- 当前 query-enabled surface 是 `regulations/student_rules`、
  `regulations/institutional_rules`、`curriculum/curriculum_plan` 与
  `official_web/stable_reference`
- `apps/app-api` 是唯一 product-layer auth / session / principal owner
- `apps/execution-control` 是 Docker-first internal execution engine，不是产品后端
- 当前 online answer path 已硬切为 Go-owned Temporal memory+RAG activity graph；Python
  `supervisor-agent-worker` 不参与 serving，只保留 offline / eval / tooling / historical
  bridge reference
- online query path 与 offline data plane 持续分层
- `apps/campus-web` 是当前学生侧 product entry surface、账号浏览器
  shell 与 OAuth/OIDC browser-facing issuer origin owner；`apps/app-api`
  仍是 auth/session/identity/federation truth owner

## Status

当前项目处于验收收口与上线前硬化阶段。

项目级当前真相与 pending work 见：

- [.planning/PROJECT.md](./.planning/PROJECT.md)
- [.planning/WORKSTREAMS.md](./.planning/WORKSTREAMS.md)

当前接受的产品定位、merged truth 与长期架构分别见：

- [产品定位](./docs/architecture/product-positioning.md)
- [当前架构](./docs/architecture/current-architecture.md)
- [目标架构](./docs/architecture/target-architecture.md)

## Repository Layout

仓库按 runtime boundary 与 capability boundary 组织：

- [`apps/`](./apps/)
  - runtime shell 与 transport boundary，例如 `campus-web`、`public-chat-web`、
    `protected-panel-web`、`app-api`、`execution-control`、`ingestion-worker`
- [`packages/`](./packages/)
  - 稳定能力边界，例如
    `knowledge-capability`、`retrieval-core`、`ingestion-core`、`contracts`
- [`configs/`](./configs/)
  - collection/runtime profile、ingestion 配置与 source config
- [`docs/`](./docs/)
  - 长期可引用的 architecture、decision、contract、data、runbook 与 policy truth
- [`.planning/`](./.planning/)
  - 当前项目级 planning truth 与 compact active work map；历史 phase/archive material 通过
    git history 恢复
- [`tests/`](./tests/)
  - 仓库级 Python 回归；JS/TS surface 的测试在各 app 下配合 root `pnpm` 入口运行

主链路相关目录：

- [`apps/campus-web`](./apps/campus-web/)
- [`apps/app-api`](./apps/app-api/)
- [`apps/execution-control`](./apps/execution-control/)
- [`apps/supervisor-agent-worker`](./apps/supervisor-agent-worker/)（offline /
  eval / historical bridge reference，不在 online serving path）
- [`packages/knowledge-capability`](./packages/knowledge-capability/)
- [`packages/prompt-runtime`](./packages/prompt-runtime/)
- [`packages/retrieval-core`](./packages/retrieval-core/)

## Documentation

默认文档入口：

- [docs/README.md](./docs/README.md)
- [docs/architecture/README.md](./docs/architecture/README.md)
- [docs/architecture/system/README.md](./docs/architecture/system/README.md)
- [docs/architecture/domains/README.md](./docs/architecture/domains/README.md)
- [docs/contracts/README.md](./docs/contracts/README.md)
- [docs/data/README.md](./docs/data/README.md)

文档与 planning 的分工：

- `docs/`
  - 长期有效、应被反复引用的共享真相
- `docs/architecture/current-architecture.md`
  - 当前 accepted merged truth
- `.planning/PROJECT.md`
  - 当前项目级范围、关键决策与 merged/worktree truth
- `.planning/WORKSTREAMS.md`
  - compact active work map、owner areas、backlog triggers 与恢复规则
- git history
  - 已退出 live truth 的 historical / superseded / completed planning snapshots

仓库协作规则见：

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [AGENTS.md](./AGENTS.md)
- [workstream-gsd-sdk-workflow](./docs/runbooks/workstream-gsd-sdk-workflow.md)

## Development

环境准备：

```bash
uv sync --all-packages --dev
pnpm install
```

常用验证入口：

```bash
pnpm lint
pnpm web:lint
pnpm docs:lint
pnpm editorconfig:lint
pnpm env:lint
pnpm yaml:lint
pnpm toml:lint
pnpm shell:lint
pnpm docker:lint
uv run --all-packages python -m unittest discover -s tests -t .
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:test:integration
pnpm web:build
```

## Seed Data Handoff

文档站 seed 数据不通过重新运行采集器交付。当前交付口径是：

```text
canonical artifacts / reader assets in object storage
-> docs-read-model manifest
-> app-api docs read model
-> campus-web Rspress docs source/build
-> campus-web /docs/* delivery
```

接手者需要拿到：

- `var/docs-read-model-manifest.json`
- sync manifest 指向的对象存储 reader assets
- 对应环境的 app-api operator database 与对象存储读取配置

完整发布、导入、构建和验收步骤见
[document-reader-publish-and-docs-deploy-runbook](./docs/runbooks/document-reader-publish-and-docs-deploy-runbook.md)。
不要提交 repo-root `var/`、`apps/campus-web/doc_build/`、`apps/campus-web/public/docs/`
或 `apps/campus-web/public/static/` 中的本地生成产物。

其中 `pnpm lint` 是仓库级 live-surface lint gate：默认覆盖 tracked 的源码、tests、repo-owned
config、active docs、prompt markdown、repo dotfile config（`.editorconfig`、tracked
`.gitignore` / `.gitattributes`）、tracked `.env.example`、tracked
YAML/TOML、tracked shell scripts，不进入 `.planning/`、archive/historical
文档、vendor、generated、未跟踪草稿与本地 runtime 产物。`pnpm docker:lint` 是独立 Dockerfile
lane，默认不并入 `pnpm lint`。

更细的验证 lane 与 smoke 路径见：

- [testing-and-verification-lanes](./docs/reference/testing-and-verification-lan
  es.md)
- [runtime-serving-and-index-terms](./docs/reference/runtime-serving-and-index-t
  erms.md)
- [forward-worker-surface-smoke-runbook](./docs/runbooks/forward-worker-surface-
  smoke-runbook.md)

## Collaboration

默认协作流是：

`feature/worktree -> develop -> main`

plain `codex` 继续用于讨论、评审、问答、方案分析与执行。
workstream 的创建、查询、切换与完成由 GSD SDK 管理；执行现场由 Codex 原生会话承接。

常用入口：

```bash
gsd-sdk query workstream.list --raw --cwd "$PWD"
gsd-sdk query workstream.status <workstream-slug> --raw --cwd "$PWD"
gsd-sdk query workstream.set <workstream-slug> --raw --cwd "$PWD"
gsd-sdk query workstream.progress --raw --cwd "$PWD"
```

tracked planning truth 只保留 `.planning/PROJECT.md` 与 `.planning/WORKSTREAMS.md`；
repo 不再维护 tracked phase tree、本地 lease、heartbeat、hook 注入或 terminal-result
artifact。详细流程见
[workstream-gsd-sdk-workflow](./docs/runbooks/workstream-gsd-sdk-workflow.md) 和
[CONTRIBUTING.md](./CONTRIBUTING.md)。
