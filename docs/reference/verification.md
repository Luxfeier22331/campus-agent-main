---
doc_type: reference
owner_boundary: docs/reference
status: active
---
# 测试与验证

## 边界

本文说明稳定验证入口和执行边界，不复制 GitHub Actions job、runner、Secret、镜像清单或一次性
环境状态。

- package 的 `package.json` 拥有具体检查；Turbo 拥有 package task graph、输入和缓存；
- `.github/paths/pr.yml` 只选择 PR 中需要追加的静态检查；
- `.github/workflows/pr.yml` 拥有自动 PR 轻量门禁；
- `.github/workflows/health.yml` 提供一次只运行一个 profile 的手动重型检查；
- `.github/workflows/execution-runtime-publish.yml` 拥有候选物发布和 GitOps 交接；
- staging、release 和真实外部依赖验收由所属 runbook 说明。

发布候选不维护第二套 package graph。Turbo 根据环境仓游标、当前 Source SHA、package graph 和 task
input 选择受影响镜像与 Worker；`infra/k8s` 作为非 package 所有者独立判断。Docker 构建定义由
`docker-bake.hcl` 负责。

仓库级 workflow、安全、Go lint、镜像和基础设施工具版本由 `aqua.yaml` 统一声明。只有运行相应检查时
才需要先安装 Aqua 并执行 `aqua install`；普通 Node/Python 开发不以 Aqua 为前置条件。

## 选择原则

1. 先运行能够验证改动模块的最小检查。
1. 跨 package 合同变更先校验合同，再校验受影响消费者。
1. 数据库、浏览器、镜像和真实外部依赖只在改动可能破坏对应边界时运行。
1. formatting、lint、配置解析和构建都不能证明运行时或部署环境健康。
1. 测试报告只列实际运行及明确省略的检查。

## 稳定命令

| 命令 | 负责 | 不证明 |
| --- | --- | --- |
| `pre-commit` | staged file 基础格式、解析、冲突和 secret hygiene | typecheck、test、build 或 runtime |
| `pnpm ci:repo` | Biome、Markdownlint、EditorConfig 和文档治理检查 | 架构正确性、业务行为或 E2E |
| `pnpm ci:config` | actionlint 与 zizmor | workflow 已成功运行或环境已部署 |
| `pnpm ci:deps` | pnpm、uv、Cargo 与 Go lockfile 的 OSV 扫描 | 应用行为或镜像漏洞 |
| `pnpm ci:release` | 镜像发布适配器与 Ops Web 产物边界测试 | 镜像能够构建、推送或部署 |
| `pnpm ci:contracts` | JSON Schema/OpenAPI 生成、同步与合同 invariant | consumer runtime 行为 |
| `pnpm ci:typescript` | JS/TS package 的 typecheck 与 unit test | Python、Worker build、外部 integration 或浏览器 |
| `pnpm ci:typescript:full` | 全量 JS/TS、Worker 与 Ops Web build | 外部 integration、staging 或 release |
| `pnpm ci:worker` | Worker runtime test 与声明的 Worker/app build | browser E2E 或 deploy |
| `pnpm ci:go` | execution-control 的 format、lint、vet 与 unit test | Temporal server 或已部署 runtime |
| `pnpm ci:infra` | Kustomize render 与基础设施 Conftest policy | 集群已应用或工作负载健康 |
| `pnpm ci:rust` | Rust workspace 的 format、Clippy、check 与 test | runtime bridge 或对象存储行为 |
| `pnpm ci:ingest` | ingestion-contracts、ingest-core、ingestion-control 与 source-collector | 在线 retrieval 或发布 |
| `pnpm ci:eval` | eval-langfuse 与 Ragas adapter 的 typecheck/test | 真实数据集评分已完成 |
| `pnpm ci:otel` | 固定 Collector 的官方配置校验 | 真实 OTLP payload 或后端已收到信号 |
| `pnpm ci:postgres` | 所有 disposable PostgreSQL integration suite | staging 或 production 数据库状态 |

数据库子入口包括 `ci:app-api-migration`、`ci:app-api-product-db`、`ci:dining-postgres`、
`ci:execution-control-postgres`、`ci:ingestion-control-postgres` 与 `ci:ops-web-postgres`。需要缩小范围时
直接运行对应入口，不创建新的跨仓调度脚本。

## PR 门禁

自动 PR 只有一个 `repo-checks` job：

- 始终运行 `pnpm ci:repo` 和 PR commit range 的 Gitleaks；
- 按路径运行合同、GitHub Actions、Python、YAML、SQL、Shell、依赖和发布适配器检查；
- 不运行 package typecheck、unit test、build、Testcontainers、浏览器、镜像构建、staging 或 release。

开发者在提交 PR 前按改动范围运行模块检查。CI 路径过滤用于减少无关静态工具，不替代本地测试，也不
根据 elapsed time 动态扩大检查范围。

## 变更面选择

| 变更面 | 至少运行 |
| --- | --- |
| 仅 Markdown、文档索引或贡献规范 | `pnpm ci:repo` |
| `packages/contracts`、OpenAPI、共享 schema | `pnpm ci:contracts`，再运行受影响 consumer 检查 |
| 一般 app/package/job TypeScript | 所属 package 的 `typecheck` 与 `test`，跨 package 时用 `pnpm ci:typescript` |
| Worker route、binding 或 wrangler config | `pnpm ci:worker` 与所属模块测试 |
| Campus Web 用户可见运行时 | 模块 typecheck/test 与 `test:e2e:smoke`；跨页面重构加 `test:e2e:full` |
| execution-control Go | `pnpm ci:go`；合同变化时加 `pnpm ci:contracts` |
| Rust kernel 或 Cargo workspace | `pnpm ci:rust` |
| ingestion app、package 或 source config | `pnpm ci:ingest`；合同变化时加 `pnpm ci:contracts` |
| eval package、Ragas adapter 或 eval contract | `pnpm ci:eval` |
| migration 或数据库权限 | 对应 PostgreSQL 子入口与模块测试 |
| `.github/**` | `pnpm ci:config` 与 `pnpm ci:repo` |
| dependency manifest 或 lockfile | `pnpm ci:deps` 与受影响模块检查 |
| Dockerfile、Bake 或发布适配器 | `pnpm ci:release`、`docker buildx bake --print`；需要构建证据时手动运行 Docker profile |
| K8s 或 deployment source | 所属静态验证、render 检查与明确的环境验收 |

## 手动重型检查

`manual-health` 只通过 `workflow_dispatch` 运行，每次选择一个 profile：

- `node`：仓库、合同、完整 JS/TS、ingestion 与 eval；
- `go`、`rust`：对应 Turbo native task；
- `database`：全部隔离 PostgreSQL 套件；
- `browser`：Campus Web 与 Ops Web 完整浏览器回归；
- `dependencies`：全部 dependency ecosystem；
- `docker`：用户从 `docker-bake.hcl` 中明确选择一个 target 构建。

仓库不维护隐式 `all`、自动定时重测或根据 Git diff 推导重型 profile 的脚本。需要多个证据时分别运行
明确 profile，失败归属于实际工具或模块。

## 测试与缓存

- package 默认 `test`、`typecheck` 和 `build` 由所属 manifest 与 README 维护；
- Turbo task 必须声明 package 外行为输入；integration test 与有副作用任务禁用缓存；
- Remote Cache 缺失时正常执行，正确性不依赖自托管 Runner 的旧工作目录；
- 不缓存 vulnerability scan、staging check 或 release check 的成功结果，也不缓存 `node_modules`；
- browser profile 构建一次 fixture 后运行完整回归，不复用已有开发服务器；
- execution-control 的 Temporal server 测试使用模块明确入口，不属于默认 `pnpm ci:go`；
- 真实 provider、database、object store、Langfuse 或 cluster credential 不进入普通 PR test。

评估 CI 性能时分别记录 queue、cold cache 与 hot cache；单 Runner 保持单并发，优先移除重复安装、
重复构建和无关检查面。

## 发布与环境

普通 PR 不构建或发布最终镜像。`main` 发布链按 Turbo 影响面选择活跃候选，使用 Docker Bake 构建单一
`linux/arm64` 镜像索引、Trivy 扫描并记录 digest；同一源码提交已有合法不可变镜像时直接复用。

候选物存在、源码仓 workflow 成功或 GitOps PR 创建，都不表示环境已经部署。环境事实由 GitOps
revision、controller 状态、readiness 和受影响用户路径共同证明，具体流程见发布与 E2E runbook。

## 提交前报告

PR 或最终交接至少写明改动范围、实际执行的命令和结果、未运行的 integration/E2E/staging/release
检查及原因，以及需要由其他环境继续提供的证据。
