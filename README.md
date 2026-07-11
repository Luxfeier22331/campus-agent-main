# campus-agent

`campus-agent` 是校园助理系统 v2 的入口 monorepo。

## Overview

当前产品方向不是通用聊天机器人，而是一个 `institution-scoped`、
`campus-web first`、Execution Agent Layer-led 的校园助理系统。

根 README 只做仓库入口路由。当前 merged truth、长期目标约束和项目级
planning signals 分别见：

- [当前架构](./docs/architecture/current.md)
- [目标架构](./docs/architecture/target.md)
- [.planning/PROJECT.md](./.planning/PROJECT.md)
- [.planning/WORKSTREAMS.md](./.planning/WORKSTREAMS.md)

## Public Repository Boundary

This repository is intended to publish code, contracts, validators, public docs
and synthetic examples. It does not publish private deployment state, real
source-derived school corpora, raw notices, collected web pages, canonical docs
artifacts, object-store publication outputs, credentials or current serving
truth.

Local development and public CI use synthetic fixtures. Features that depend on
provider keys, object storage, operator databases or private content packs need
the corresponding internal runtime configuration and are not expected to run
from a public clone alone.

See:

- [public-source-data policy](./docs/policies/public-source-data.md)
- [open-source data inventory](./docs/reference/open-source-data.md)
- [SECURITY.md](./SECURITY.md)
- [SUPPORT.md](./SUPPORT.md)

## Repository Layout

仓库按 runtime boundary、job runtime boundary 与 tool boundary 组织：

- [`apps/`](./apps/)
  - 长驻 runtime shell 与 transport boundary，例如 `campus-web`、
    `operator-console-web`、`app-api`、`execution-control`、
    `ingestion-control`、`source-collector`
- [`jobs/`](./jobs/)
  - manual 或定时 deployable runtime，例如 `dining-sync`、
    `learning-loop-candidates`
- [`packages/`](./packages/)
  - 稳定边界，例如
    `ingest-core`、`ingestion-contracts`、`contracts`
- [`configs/`](./configs/)
  - collection serving config、ingestion 配置与 source config
- [`docs/`](./docs/)
  - 长期可引用的 architecture、decision、contract、data、runbook 与 policy truth
- [`.planning/`](./.planning/)
  - 当前项目级 planning signal surface；历史 phase/archive material 通过 git history
    恢复
具体 runtime、job 与 package ownership 以
[`docs/architecture/system/code-organization.md`](./docs/architecture/system/code-organization.md)
和各 area README 为准；根 README 只保留仓库入口路由。

## Documentation

默认文档入口：

- [docs/documentation-architecture.md](./docs/documentation-architecture.md)
- [docs/README.md](./docs/README.md)

文档与 planning 的分工：

- `docs/`
  - 长期有效、应被反复引用的 source-of-truth 文档
- `docs/documentation-architecture.md`
  - 文档 truth class、冲突裁决顺序与入口路由规则
- `docs/architecture/current.md`
  - 当前 accepted merged truth
- `.planning/PROJECT.md`
  - compact project planning signals；不覆盖 architecture / contract / data truth
- `.planning/WORKSTREAMS.md`
  - compact active planning signals、owner areas、backlog signals 与恢复规则
- git history
  - 已退出 live truth 的 historical / superseded / completed planning snapshots

仓库协作规则见：

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [AGENTS.md](./AGENTS.md)
- [workstream-gsd-sdk-workflow](./docs/runbooks/workstream-gsd-sdk-workflow.md)

## Development

环境准备：

```bash
uv sync --all-packages --dev
pnpm install
```

Public clone 默认验证入口：

```bash
pnpm repo:static
pnpm go:check
pnpm ci:rust
pnpm ci:contracts
pnpm ci:ingest
pnpm ci:eval
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
```

内部 / full lane 需要对应 runtime 配置：

```bash
pnpm web:test:integration
pnpm web:build
pnpm ci:web:full
```

- `pnpm web:test:integration` 需要 shared DB / Hyperdrive local connection env。
- `pnpm web:build` 与 `pnpm ci:web:full` 会构建文档站，需要已有
  docs read-model sync manifest，或可访问 app-api operator database 的
  `APP_API_OPERATOR_DATABASE_URL` 等内部配置。

## Docs Reader Data

文档站 seed 数据、reader asset 交付和 docs read-model 规则由 owner 文档维护：

- [document-site architecture](./docs/architecture/system/document-site.md)
- [document-reader data](./docs/data/document-reader.md)
- [document-reader publish contract](./docs/contracts/document-reader-publish.md)
- [forward-worker smoke runbook](./docs/runbooks/forward-worker-smoke.md)

根 README 不维护对象存储 manifest、构建产物或导入流程细节。本地生成产物仍不得提交到
repo-root `var/`、`apps/campus-web/doc_build/`、`apps/campus-web/public/docs/`
或 `apps/campus-web/public/static/`。

- `var/docs-read-model-manifest.json`
- sync manifest 指向的对象存储 reader assets
- 对应环境的 app-api operator database 与对象存储读取配置

旧 document-reader 发布、导入、构建和验收流程已退出 branch tip；需要追溯时通过
git history 恢复具体片段，再提升到当前 runbook 或 data contract。
不要提交 repo-root `var/`、`apps/campus-web/doc_build/`、`apps/campus-web/public/docs/`
或 `apps/campus-web/public/static/` 中的本地生成产物。

其中 `pnpm repo:static` 直接运行 Biome、Markdownlint 与 EditorConfig Checker，只负责通用格式和文本
卫生。Python、Worker、contract、ingestion、Go、K8s 与依赖安全约束由对应 owner lane 或原生工具承担；
`repo:static` 不判断架构目录、运行时能力或领域策略。

更细的验证 lane 与 smoke 路径见：

- [testing-and-verification-lanes](./docs/reference/testing-and-verification-lanes.md)
- [runtime-serving-and-index-terms](./docs/reference/runtime-serving-and-index-terms.md)
- [forward-worker-smoke](./docs/runbooks/forward-worker-smoke.md)

## Collaboration

默认协作流是：

`feature/worktree -> PR -> main`

`main` 是当前 merged truth。release tag 和 GitHub Environment 承接
production / release 状态，不再通过长期开发分支中转。

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
artifact。详细流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

Repo-owned source code, tests, configuration and documentation are licensed under
the [Apache License, Version 2.0](./LICENSE).

Third-party dependencies, source-derived fixtures, campus website/document
samples, OpenStreetMap-derived data and branding materials remain under their
respective upstream ownership and license terms. See [NOTICE](./NOTICE) and
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) before redistributing source
data, generated artifacts or release packages.
