---
doc_type: reference
owner_boundary: docs/reference
status: active
---
# 测试与验证

## 边界

本文说明稳定验证入口和执行边界，不复制 GitHub Actions job、runner、Secret、镜像清单或一次性
环境状态。

- package 的 `package.json` 拥有具体检查；Turbo 拥有 package task graph、任务输入和缓存；
- `scripts/ci/scope.mts` 唯一负责校验 revision、读取 Git diff 和解析 Turbo affected graph；
- `scripts/ci/validation.mts` 唯一负责静态面与受影响 profile 选择；
- `scripts/ci/evidence.mts` 负责 PR 和手动入口共用的 profile 执行；
- `.github/workflows/pr.yml` 的静态门禁和受影响证据均在 GitHub-hosted runner；
- `.github/workflows/execution-runtime-publish.yml` 拥有候选物发布和 GitOps 交接；
- `.github/workflows/dependencies.yml` 每周重新检查外部 vulnerability 数据；
- staging、release 和真实外部依赖验收由所属 runbook 说明。

`main` 发布候选以环境仓游标到当前 Source SHA 的累计差异为输入；PR 验证以该 PR 的 base/head 为
输入，不读取私有环境仓或环境凭据。两条路径复用同一 affected scope，但分别选择验证 profile 和
候选制品。Turbo 根据 package graph 和 task input 选择 package；没有 `build` task 的 Go 与 schema
镜像，以及 `infra/k8s`，由其明确的制品所有权补充选择。Docker 构建定义仍由 `docker-bake.hcl`
负责，不另建镜像实现清单。

数据库和浏览器任务在所属 package 的 `turbo.json` 中声明边界输入。`turbo.json` 自身变化会使 Turbo
任务定义失效；累计差异包含这类提交时，`scripts/ci/scope.mts` 用 head 版本的任务图构造临时 SCM
比较基线，只解析一次真实源码差异，不把配置变化转换成全部业务 profile 或候选制品。同一差异中的
基础设施、数据库、用户界面和已注册候选 Dockerfile 仍按其明确所有权选择对应证据或制品。

`flake.lock` 固定 source 工具链的 nixpkgs revision，`ci-core` 提供普通 hosted 控制路径，`ci-light`
在其上增加静态 lint 和依赖扫描工具，`ci-release` 再增加 Docker client/Buildx/Trivy，`ci-full` 只
增加重型 profile 所需 CLI，并为 uv 安装的 Python 二进制 wheel 提供 C++ runtime 搜索路径；它们都
不是 validation profile，也不会自动触发全量检查。
Nix 不接管 `pnpm-lock.yaml`、`uv.lock`、
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
| `pnpm check` | 仓库 lint、文档治理和自动化脚本单元测试 | 架构正确性、package 行为或 E2E |
| `pnpm lint` | Biome、Markdownlint 与 EditorConfig | 文档链接、业务行为或类型正确性 |
| `pnpm docs:check` | 文档 frontmatter、ADR、链接和语言合同 | 代码或部署状态 |
| `pnpm test` | Source CI、开发和发布脚本的单元测试 | package test、镜像构建或外部服务 |
| `pnpm --dir packages/contracts check` | JSON Schema/OpenAPI 生成同步与合同 invariant | consumer runtime 行为 |
| `scripts/dependencies/scan.sh` | pnpm、uv、Cargo 与 Go lockfile 的 OSV 扫描 | 应用行为或镜像漏洞 |
| `scripts/infra/validate.sh` | Kustomize render 与基础设施 Conftest policy | 集群已应用或工作负载健康 |
| `scripts/otel/validate-config.sh` | 固定 Collector 镜像的官方配置校验 | 真实 OTLP payload 或后端已收到信号 |

根 `package.json` 只拥有仓库级人类工作流和本地开发生命周期。`ci`、`manual`、`hosted` 与 `local`
是调用 lane，不进入命令名；package task、Turbo task 或领域脚本已有真实入口时，不再增加根 wrapper。
数据库、浏览器、原生语言和评测证据通过所属 package task 或手动 validation profile 运行。

## PR 门禁

自动 PR 保留一个稳定的 `repo-checks` hosted 门禁；Draft PR 跳过 job，转为 ready 后运行。门禁始终运行 `pnpm check` 和 authored commit range
的 Gitleaks，并按 planner 选择合同、GitHub Actions、Python、YAML、SQL 和 Shell 静态检查；需要时在
同一个 job 一次 checkout，并在根工具链安装后串行执行 `affected-node`、
`dependencies` 或 `toolchain`。若选择 `affected-node`，再扩展安装受影响 workspace；没有受影响 Node
证据时不执行这次扩展安装，但始终返回明确结果。

PR checkout 使用 GitHub 生成的 merge revision，普通 PR 不发布镜像或 Worker，不访问 staging、provider
state、集群或真实外部服务。candidate 不自动运行数据库、浏览器、原生、OTel 或其他完整 profile；需要
专项重检查时，手动入口一次只选择一个明确的非浏览器 profile，浏览器业务 E2E 只在本地或发布执行者
终端验收。

## 变更面选择

| 变更面 | 至少运行 |
| --- | --- |
| 仅 Markdown、文档索引或贡献规范 | `pnpm check` |
| `packages/contracts`、OpenAPI、共享 schema | `pnpm --dir packages/contracts check`，再运行受影响 consumer 检查 |
| 一般 app/package/job TypeScript | 所属 package 的 `typecheck` 与 `test`；跨 package 时为 Turbo 指定明确 filter |
| Worker route、binding 或 wrangler config | 所属 Worker 的 `test:worker`、`build:worker` 与模块测试 |
| Campus Web 用户可见运行时 | 模块 typecheck/test、bundle 完整性检查；`test:e2e:smoke` 和 `test:e2e:full` 仅本地运行 |
| execution-control Go | 手动 `go` profile；合同变化时加 contracts check |
| Rust kernel 或 Cargo workspace | 手动 `rust` profile |
| ingestion app、package 或 source config | 所属 package 的 `typecheck` 与 `test`；合同变化时加 contracts check |
| eval package、Ragas adapter 或 eval contract | 所属 package test；跨语言适配器使用手动 `ragas` profile |
| migration 或数据库权限 | 对应 PostgreSQL 子入口与模块测试 |
| `.github/**` | `pnpm check`、`actionlint` 与 `zizmor --min-severity=medium .github` |
| dependency manifest 或 lockfile | `scripts/dependencies/scan.sh` 与受影响模块检查 |
| Dockerfile、Bake 或发布适配器 | `pnpm test`、`docker buildx bake --print`；需要构建证据时手动运行 Docker profile |
| K8s 或 deployment source | `scripts/infra/validate.sh` 与明确的环境验收 |

## 执行器与定时检查

格式、文档、合同、workflow、受影响 Node 证据、release planner、App API Worker 和 candidate status
在 GitHub-hosted runner 执行。过渡阶段的 ARM 镜像构建、Campus Web 正式文档构建和 GitOps promotion
使用 `campus-agent-release` self-hosted runner；稳定后迁回 hosted。两类 runner 使用同一 flake，不维护
第二套 CLI 安装 action；hosted runner 使用固定 commit 的安装 action 获取 Nix 2.35.1。

依赖 advisory 可以在没有代码变化时变化，因此每周一 `02:35 UTC` 在 hosted runner 运行一次
`scripts/dependencies/scan.sh`；lockfile 变化仍在对应 PR profile 中运行同一入口。仓库不保存未被消费的扫描 JSON
artifact，也不把 dependency scan 的成功结果当作应用行为或镜像安全证据。

## 测试与缓存

- package 默认 `test`、`typecheck` 和 `build` 由所属 manifest 与 README 维护；
- Turbo task 必须声明 package 外行为输入；integration test 与有副作用任务禁用缓存；
- Remote Cache 缺失时正常执行，正确性不依赖 runner 的旧工作目录；
- PR 和手动 profile 使用本地读写、远端读写的 Turbo Cache；缺少远端命中时仍正常执行。仓库不再
  使用 GitHub Actions pnpm store cache；candidate 不注入 Turbo 配置或 Turbo evidence。任何 lane
  都不把 Secret、对象存储内容或部署结果写入缓存；
- CI 不缓存 vulnerability scan、staging check 或 release check 的通过/失败结论，也不缓存
  `node_modules`；发布执行器允许 Trivy 通过 `--cache-dir` 复用其漏洞数据库和镜像分析缓存，数据库
  更新仍由 Trivy 的正常策略负责；
- 浏览器 E2E 不进入 GitHub Actions，不写入 Turbo Cache；本地入口使用应用现有的 smoke/full 命令；
- execution-control 的 Temporal server 测试使用模块明确入口，不属于默认 `go` profile；
- PR 数据库 profile 只使用 disposable PostgreSQL；真实 provider、staging database、object store、
  Langfuse 或 cluster credential 不进入 PR test。
- Campus Web bundle 大小超过 `500 KiB gzip` 只记录 warning；bundle graph、入口、静态文件或 vendor
  登记缺失仍是 artifact failure。PR 的 `build:worker` 使用确定性文档 fixture，不代表真实 staging
  对象存储内容已完成构建或发布。

评估 CI 性能时分别记录 queue、cold cache 与 hot cache，并优先移除重复安装、重复构建和无关检查面。

## 发布与环境

普通 PR 不发布最终镜像。`main` 发布链先把精确 Source SHA 的 `staging/candidate` 标为 `pending`，
被选 publisher 全部成功后才标为 `success`；该状态只证明所选制品已经完成构建、扫描和上传。镜像
使用 Docker Bake 构建单一 `linux/arm64` 索引、经 Trivy 扫描并记录 digest；同一源码提交已有合法
不可变镜像时直接复用。

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
