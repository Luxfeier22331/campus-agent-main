# campus-agent

`campus-agent` 是校园助理系统 v2 的入口 monorepo。

## Overview

当前产品方向不是通用聊天机器人，而是一个 `institution-scoped`、`chat-first`、`supervisor-led` 的校园助理系统：公开聊天面、受保护运营面、共享 `app-api`、内部 `supervisor-api`，以及按能力边界拆分的 specialist / retrieval / ingestion packages。

当前 merged truth 的主路径为：

`browser -> public-chat-web / protected-panel-web -> app-api -> supervisor-api -> supervisor-core -> specialist`

该仓库当前的核心约束包括：

- 当前 query-enabled surface 是 `regulations/student_handbook` 与 `curriculum/curriculum_plan`
- `apps/app-api` 是唯一 product-layer auth / session / principal owner
- `apps/supervisor-api` 是 internal execution engine，不是产品后端
- online query path 与 offline data plane 持续分层

## Status

当前项目处于验收收口与上线前硬化阶段。

项目级当前真相与 pending work 见：

- [.planning/PROJECT.md](./.planning/PROJECT.md)
- [.planning/STATE.md](./.planning/STATE.md)

当前接受的产品定位、merged truth 与长期架构分别见：

- [产品定位](./docs/architecture/product-positioning.md)
- [当前架构](./docs/architecture/current-architecture.md)
- [目标架构](./docs/architecture/target-architecture.md)

## Repository Layout

仓库按 runtime boundary 与 capability boundary 组织：

- [`apps/`](./apps/)
  - runtime shell 与 transport boundary，例如 `public-chat-web`、`protected-panel-web`、`app-api`、`supervisor-api`、`ingestion-worker`
- [`packages/`](./packages/)
  - 稳定能力边界，例如 `supervisor-core`、`rag-specialist`、`retrieval-core`、`ingestion-core`、`contracts`
- [`configs/`](./configs/)
  - collection/runtime profile、ingestion 配置与 source config
- [`docs/`](./docs/)
  - 长期可引用的 architecture、decision、contract、data、runbook、policy 与 active plan 文档
- [`.planning/`](./.planning/)
  - 当前项目级 planning truth、worktree continuity、phase 计划和执行总结
- [`tests/`](./tests/)
  - 仓库级 Python 回归；JS/TS surface 的测试在各 app 下配合 root `pnpm` 入口运行

主链路相关目录：

- [`apps/app-api`](./apps/app-api/)
- [`apps/supervisor-api`](./apps/supervisor-api/)
- [`packages/supervisor-core`](./packages/supervisor-core/)
- [`packages/rag-specialist`](./packages/rag-specialist/)
- [`packages/retrieval-core`](./packages/retrieval-core/)

## Documentation

默认文档入口：

- [docs/README.md](./docs/README.md)
- [docs/architecture/README.md](./docs/architecture/README.md)
- [docs/contracts/README.md](./docs/contracts/README.md)
- [docs/data/README.md](./docs/data/README.md)

文档与 planning 的分工：

- `docs/`
  - 长期有效、应被反复引用的共享真相
- `docs/architecture/current-architecture.md`
  - 当前 accepted merged truth
- `.planning/PROJECT.md`
  - 当前项目级范围、active lane 与 pending work
- `.planning/STATE.md`
  - 当前 worktree 的 now / next / blockers / recent verification

仓库协作规则见：

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [AGENTS.md](./AGENTS.md)

## Development

环境准备：

```bash
uv sync --all-packages --dev
pnpm install
```

常用验证入口：

```bash
uv run --all-packages python -m unittest discover -s tests -t .
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:test:integration
pnpm web:build
```

更细的验证 lane 与 smoke 路径见：

- [testing-and-verification-lanes](./docs/reference/testing-and-verification-lanes.md)
- [runtime-serving-and-index-terms](./docs/reference/runtime-serving-and-index-terms.md)
- [forward-worker-surface-smoke-runbook](./docs/runbooks/forward-worker-surface-smoke-runbook.md)

## Collaboration

默认协作流是：

`feature/worktree -> develop -> main`

详细协作与提交流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
