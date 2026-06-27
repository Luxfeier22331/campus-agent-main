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

browser -> campus-web Q&A -> app-api assistant-ui chat routes
-> execution-control -> Temporal -> workflow-worker / activity-worker-context /
activity-worker-agent / activity-worker-knowledge-plan /
activity-worker-knowledge-retrieval / activity-worker-knowledge-synthesis /
capability workers /
activity-worker-finalization
-> memory recall / OpenAI Agents SDK primary agent loop / typed capability
branch / Go RAG DTO/runtime
-> Qdrant / provider / structured read models -> sanitized projection

browser -> campus-web /docs/* -> Rspress-powered canonical reader

browser -> operator console surface -> app-api
-> request projection / operator read/write model
```

当前正式 docs surface 为 `campus-web /docs/*`；`/api/docs/*` 通过
campus-web same-origin Worker seam 进入 `app-api` docs control plane。

该仓库当前的核心约束包括：

- 当前 query-enabled surface 是 `regulations/student_rules`、
  `regulations/institutional_rules`、`curriculum/curriculum_plan` 与
  `official_web/stable_reference`
- `apps/app-api` 是唯一 product-layer auth / session / principal owner
- `apps/execution-control` 是 Go-owned internal execution engine，不是产品后端；
  Docker Compose 只保留 local / transitional runtime evidence，长期 production
  target substrate 是 K8s + KEDA
- 当前 online answer path 已硬切为 Go/Temporal durable envelope +
  OpenAI Agents SDK primary agent loop；ordinary chat 由 primary agent 在
  admitted tool catalog 内决定 direct/no-tool、notice、campus_services 或
  `knowledge_query`；knowledge 请求由 primary agent 选择 `knowledge_query`
  workflow signal 后进入 Go-owned RAG graph；旧 Python semantic worker
  已从 active workspace 删除，旧实现只可通过 git history 追溯
- online query path 与 offline data plane 持续分层
- `apps/campus-web` 是当前学生侧 product entry surface、账号浏览器
  shell 与 OAuth/OIDC browser-facing issuer origin owner；`apps/app-api`
  仍是 auth/session/identity/federation truth owner
- Operator Console 是长期受控运维后台概念；当前 implementation surface 是
  `operator-console-web`，仅承载请求与运行值班台和模型服务配置

## Status

当前项目处于验收收口与上线前硬化阶段。

项目级当前工作地图与 pending work signals 见：

- [.planning/PROJECT.md](./.planning/PROJECT.md)
- [.planning/WORKSTREAMS.md](./.planning/WORKSTREAMS.md)

当前接受的产品定位、merged truth 与长期架构分别见：

- [产品定位](./docs/architecture/product-positioning.md)
- [当前架构](./docs/architecture/current-architecture.md)
- [目标架构](./docs/architecture/target-architecture.md)

## Repository Layout

仓库按 runtime boundary 与 capability boundary 组织：

- [`apps/`](./apps/)
  - runtime shell 与 transport boundary，例如 `campus-web`、
    `operator-console-web`、`app-api`、`execution-control`、
    `ingestion-worker`
- [`packages/`](./packages/)
  - 稳定能力边界，例如
    `ingestion-core`、`contracts`、`regulation-semantics`、`campus-services-capability`
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
- [`apps/agent-runtime`](./apps/agent-runtime/)
- [`packages/ingestion-core`](./packages/ingestion-core/)

## Documentation

默认文档入口：

- [docs/documentation-architecture.md](./docs/documentation-architecture.md)
- [docs/README.md](./docs/README.md)
- [docs/architecture/README.md](./docs/architecture/README.md)
- [docs/architecture/system/README.md](./docs/architecture/system/README.md)
- [docs/architecture/domains/README.md](./docs/architecture/domains/README.md)
- [docs/contracts/README.md](./docs/contracts/README.md)
- [docs/data/README.md](./docs/data/README.md)

文档与 planning 的分工：

- `docs/`
  - 长期有效、应被反复引用的 source-of-truth 文档
- `docs/documentation-architecture.md`
  - 文档 truth class、冲突裁决顺序与入口路由规则
- `docs/architecture/current-architecture.md`
  - 当前 accepted merged truth
- `.planning/PROJECT.md`
  - compact project work map；不覆盖 architecture / contract / data truth
- `.planning/WORKSTREAMS.md`
  - compact active work map、owner areas、backlog signals 与恢复规则
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
pnpm repo:guard
pnpm repo:static
pnpm go:check
uv run --all-packages python -m unittest discover -s tests -t .
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:test:integration
pnpm web:build
pnpm ci:web-graph:full
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

旧 document-reader 发布、导入、构建和验收流程已退出 branch tip；需要追溯时通过
git history 恢复具体片段，再提升到当前 runbook 或 data contract。
不要提交 repo-root `var/`、`apps/campus-web/doc_build/`、`apps/campus-web/public/docs/`
或 `apps/campus-web/public/static/` 中的本地生成产物。

其中 `pnpm repo:static` 是仓库级 live-surface static gate：默认覆盖 tracked 的源码、tests、repo-owned
config、active docs、prompt markdown、repo dotfile config（`.editorconfig`、tracked
`.gitignore` / `.gitattributes`）、tracked `.env.example`、tracked
YAML/TOML、tracked shell scripts、Dockerfile surface，不进入 `.planning/`、archive/historical
文档、vendor、generated、未跟踪草稿与本地 runtime 产物。Dockerfile checker 已通过
`pnpm repo:static` 并入默认仓库静态 gate。

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
