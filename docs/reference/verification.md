---
doc_type: reference
owner_boundary: docs/reference
status: active
---
# 测试与验证

## 边界

本文说明稳定验证入口和执行边界，不复制 GitHub Actions job、runner、Secret、镜像清单或一次性
环境状态。

- package 的 `package.json` 拥有具体检查；Turbo 拥有 package task graph、仓库级 root task 输入和缓存；
- `scripts/ci/scope.mts` 唯一负责校验 revision、读取 Git diff 和解析 Turbo affected graph；
- `scripts/ci/validation.mts` 唯一负责静态面与重型 profile 选择；
- `scripts/ci/evidence.mts` 负责 PR 和候选发布共用的 profile 执行；
- `.github/workflows/pr.yml` 拥有 hosted 静态门禁和 self-hosted 受影响证据；
- `.github/workflows/execution-runtime-publish.yml` 拥有候选物发布和 GitOps 交接；
- `.github/workflows/dependencies.yml` 每周重新检查外部 vulnerability 数据；
- staging、release 和真实外部依赖验收由所属 runbook 说明。

`main` 发布候选以环境仓游标到当前 Source SHA 的累计差异为输入；PR 候选以该 PR 的 base/head 为
输入，不读取私有环境仓或环境凭据。两条路径使用同一 planner。Turbo 根据 package graph 和 task input
选择 package 候选；没有 `build` task 的 Go 与 schema 镜像，以及 `infra/k8s`，由其明确的制品所有权
补充选择。Docker 构建定义仍由 `docker-bake.hcl` 负责，不另建镜像实现清单。

`flake.lock` 固定 source 工具链的 nixpkgs revision，`ci-light` 覆盖 hosted 静态检查和依赖扫描，
`ci-full` 追加 Go、Rust、数据库、浏览器、镜像和基础设施检查所需 CLI。Nix 不接管 `pnpm-lock.yaml`、`uv.lock`、
`Cargo.lock` 或 Go module，也不提供 Docker daemon、PostgreSQL、Testcontainers 或 Playwright browser。

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

数据库子入口包括 `ci:app-api-migration`、`ci:app-api-product-db`、
`ci:execution-control-postgres`、`ci:ingestion-control-postgres` 与 `ci:ops-web-postgres`。Dining 七表和
内部门户凭据表、角色边界及版本条件写由 Ops Web 的数据库套件覆盖。需要缩小范围时直接运行对应
入口，不创建新的跨仓调度脚本。

## PR 门禁

自动 PR 保留一个稳定的 `repo-checks` 门禁，并按成本分为两段：

- GitHub-hosted `light` 始终运行 `pnpm ci:repo` 和 authored commit range 的 Gitleaks，并按统一 planner
  选择合同、GitHub Actions、Python、YAML、SQL 和 Shell 静态检查；
- `repo-checks` 始终返回明确结果；没有重型 profile 时直接结束，需要时才在现有 self-hosted runner
  一次 checkout、一次安装并串行执行受影响证据；
- PR checkout 使用 GitHub 生成的 merge revision，Gitleaks 仍扫描 PR 作者提交范围；
- 普通 PR 不发布镜像或 Worker，不访问 staging、provider state、集群或真实外部服务。

重型 profile 覆盖 affected 或显式 full Node/Worker、Go、Rust、Ragas、五个 disposable PostgreSQL
owner、基础设施、OTel、Campus Web smoke/full、Ops Web browser、dependency scan 和发布工具链。
planner 只按累计差异和明确制品消费者选择，各 profile 串行执行；不根据耗时或一次失败动态扩大范围。

## 变更面选择

| 变更面 | 至少运行 |
| --- | --- |
| 仅 Markdown、文档索引或贡献规范 | `pnpm ci:repo` |
| `packages/contracts`、OpenAPI、共享 schema | `pnpm ci:contracts`，再运行受影响 consumer 检查 |
| 一般 app/package/job TypeScript | 所属 package 的 `typecheck` 与 `test`，跨 package 时用 `pnpm ci:typescript` |
| Worker route、binding 或 wrangler config | `pnpm ci:worker` 与所属模块测试 |
| Campus Web 用户可见运行时 | 模块 typecheck/test、bundle 完整性检查与 `test:e2e:smoke`；跨页面重构加 `test:e2e:full` |
| execution-control Go | `pnpm ci:go`；合同变化时加 `pnpm ci:contracts` |
| Rust kernel 或 Cargo workspace | `pnpm ci:rust` |
| ingestion app、package 或 source config | `pnpm ci:ingest`；合同变化时加 `pnpm ci:contracts` |
| eval package、Ragas adapter 或 eval contract | `pnpm ci:eval` |
| migration 或数据库权限 | 对应 PostgreSQL 子入口与模块测试 |
| `.github/**` | `pnpm ci:config` 与 `pnpm ci:repo` |
| dependency manifest 或 lockfile | `pnpm ci:deps` 与受影响模块检查 |
| Dockerfile、Bake 或发布适配器 | `pnpm ci:release`、`docker buildx bake --print`；需要构建证据时手动运行 Docker profile |
| K8s 或 deployment source | 所属静态验证、render 检查与明确的环境验收 |

## 执行器与定时检查

格式、文档、合同、workflow 和轻量语言 lint 在 GitHub-hosted runner 执行；原生编译、数据库、浏览器、
OTel Docker 校验、制品发布和 promotion 保留在 `campus-agent-release` self-hosted runner。两类 runner
使用同一 flake，不维护第二套 CLI 安装 action。self-hosted runner 从标准多用户路径
`/nix/var/nix/profiles/default/bin/nix` 进入 `ci-full`；hosted runner 使用固定 commit 的安装 action 获取
Nix 2.35.1，不接入 Cachix 服务。

依赖 advisory 可以在没有代码变化时变化，因此每周一 `02:35 UTC` 在 hosted runner 运行一次
`pnpm ci:deps`；lockfile 变化仍在对应 PR profile 中运行同一入口。仓库不保存未被消费的扫描 JSON
artifact，也不把 dependency scan 的成功结果当作应用行为或镜像安全证据。

## 测试与缓存

- package 默认 `test`、`typecheck` 和 `build` 由所属 manifest 与 README 维护；
- Turbo task 必须声明 package 外行为输入；integration test 与有副作用任务禁用缓存；
- Remote Cache 缺失时正常执行，正确性不依赖自托管 Runner 的旧工作目录；
- 不缓存 vulnerability scan、staging check 或 release check 的成功结果，也不缓存 `node_modules`；
- browser profile 构建一次 fixture 后运行所选 smoke 或 full 回归，不复用已有开发服务器；
- execution-control 的 Temporal server 测试使用模块明确入口，不属于默认 `pnpm ci:go`；
- PR 数据库 profile 只使用 disposable PostgreSQL；真实 provider、staging database、object store、
  Langfuse 或 cluster credential 不进入 PR test。
- Campus Web bundle 大小超过 `500 KiB gzip` 只记录 warning；bundle graph、入口、静态文件或 vendor
  登记缺失仍是 artifact failure。PR 的 `build:worker` 使用确定性文档 fixture，不代表真实 staging
  对象存储内容已完成构建或发布。

评估 CI 性能时分别记录 queue、cold cache 与 hot cache；单 Runner 保持单并发，优先移除重复安装、
重复构建和无关检查面。

## 发布与环境

普通 PR 不发布最终镜像。`main` 发布链先把精确 Source SHA 的 `staging/candidate` 标为 `pending`，完成
所选 profile 后才标为 `success` 并开始发布。镜像使用 Docker Bake 构建单一 `linux/arm64` 索引、经
Trivy 扫描并记录 digest；同一源码提交已有合法不可变镜像时直接复用。

机器 promotion 必须携带 planner 读取的旧 `releases/staging.json` 游标；环境仓游标已经前进时拒绝
写入。promotion checkout GitOps 后通过 `nix develop ./gitops#ci-infra` 调用环境仓拥有的更新和渲染入口，
再创建或更新 `deploy/staging` PR。Agent
Runtime、App API schema 和 Ops Web 运维 Job 的容器入口均执行构建期生成的 JavaScript，不在部署
环境执行 TypeScript 源码。

候选物存在、源码仓 workflow 成功或 GitOps PR 创建，都不表示环境已经部署。GitOps 的
`staging/deployment` 状态只证明本次选择的 apply 与 controller 协调完成，不表示真实用户路径已经
通过。受影响用户路径由发布执行者按 E2E runbook 手动选择并验收；GitOps 链路不自动运行
`chat-staging` 或其他用户 smoke。

## 提交前报告

PR 或最终交接至少写明改动范围、实际执行的命令和结果、未运行的 integration/E2E/staging/release
检查及原因，以及需要由其他环境继续提供的证据。
