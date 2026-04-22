# campus-agent

`campus-agent` 是校园助理系统 v2 的入口 monorepo。

## Overview

当前产品方向不是通用聊天机器人，而是一个 `institution-scoped`、`chat-first`、`supervisor-led`
的校园助理系统：公开聊天面、公开文档站、受保护运营面、共享 `app-api`、内部 `supervisor-api`，以及按能力边界拆分的 agent /
retrieval / ingestion packages。

当前 merged truth 的主路径为：

```text
browser -> public-chat-web / protected-panel-web -> app-api -> supervisor-api
-> supervisor-core -> agent
```

当前正式 docs surface 为：

`browser -> public-docs`

该仓库当前的核心约束包括：

- 当前 query-enabled surface 是 `regulations/student_rules` 与
  `curriculum/curriculum_plan`
- `apps/app-api` 是唯一 product-layer auth / session / principal owner
- `apps/supervisor-api` 是 internal execution engine，不是产品后端
- online query path 与 offline data plane 持续分层

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
  - runtime shell 与 transport boundary，例如 `public-chat-web`、`public-docs`、`prote
    cted-panel-web`、`app-api`、`supervisor-api`、`ingestion-worker`
- [`packages/`](./packages/)
  - 稳定能力边界，例如
    `supervisor-core`、`rag-agent`、`retrieval-core`、`ingestion-core`、`contracts`
- [`configs/`](./configs/)
  - collection/runtime profile、ingestion 配置与 source config
- [`docs/`](./docs/)
  - 长期可引用的 architecture、decision、contract、data、runbook、policy 与 archived
    implementation snapshots
- [`.planning/`](./.planning/)
  - 当前项目级 planning truth、workstream registry、native workstream 状态，以及 shared
    quick/todo/research 资产
- [`tests/`](./tests/)
  - 仓库级 Python 回归；JS/TS surface 的测试在各 app 下配合 root `pnpm` 入口运行

主链路相关目录：

- [`apps/app-api`](./apps/app-api/)
- [`apps/public-docs`](./apps/public-docs/)
- [`apps/supervisor-api`](./apps/supervisor-api/)
- [`packages/supervisor-core`](./packages/supervisor-core/)
- [`packages/rag-agent`](./packages/rag-agent/)
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
  - 当前有哪些 active / deferred / backlog workstreams，以及各自对应的 native planning 目录
- `.planning/workstreams/<slug>/README.md`
  - 单条 native workstream 的人工入口；先看边界、状态，再进入 `STATE / ROADMAP / REQUIREMENTS`
- `.planning/workstreams/<slug>/STATE.md`
  - 单条 workstream 的 now / next / blockers / recent verification
- `docs/plans/archive/`
  - 已退出 live workstream 入口的 historical / superseded / completed plan snapshots

仓库协作规则见：

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [AGENTS.md](./AGENTS.md)
- [workstream-claim-workflow](./docs/runbooks/workstream-claim-workflow.md)

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

并发推进不同 workstream 时，repo 内部的认领与交接统一走 repo-owned claim workflow：

```bash
uv run --all-packages python -m scripts.workstream_claim operator set \
  <operator_id>
uv run --all-packages python -m scripts.workstream_harness codex shell \
  <workstream-slug>
uv run --all-packages python -m scripts.workstream_harness codex exec \
  <workstream-slug> -- "<task>"
```

底层 `workstream_claim session shell/start` 仍保留为恢复与非-Codex runtime 的 escape
hatch；tracked planning truth 继续写在 `.planning/WORKSTREAMS.md` 与
`.planning/workstreams/<slug>/`，运行时认领状态、operator 本地配置、 claim history 与 harness
run ledger 只写入 gitignored 的 `.planning/runtime/`。 详细流程见
[workstream-harness-workflow](./docs/runbooks/workstream-harness-workflow.md)、
[workstream-claim-workflow](./docs/runbooks/workstream-claim-workflow.md) 和
[CONTRIBUTING.md](./CONTRIBUTING.md)。
