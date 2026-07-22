---
doc_type: reference
owner_boundary: docs/reference
status: active
---
# 测试与验证

## 边界

本文说明仓库稳定验证命令的含义和选择规则，不复制 GitHub Actions job graph、runner 配置、
branch protection、部署 secret、镜像清单或环境状态。

- Turbo package graph 与 task inputs 维护 JS/TS 受影响任务；
- `scripts/ci/change-plan.mjs` 维护数据库、浏览器、原生语言和发布等跨工具路由；
- `.github/workflows/pr.yml` 维护自动 PR 轻量静态门禁；
- `.github/workflows/execution-runtime-publish.yml` 维护 `main` 候选产物发布和 GitOps 推广；
- `.github/workflows/health.yml` 提供按单一技术域触发的手动健康检查，不设置定时任务；
- `.github/workflows/verify.yml` 提供按变更范围触发的重型验证，并使用签名 Remote Cache；
- root `package.json` 与所属 package script 维护命令实现；
- app README 说明模块本地命令；
- runbook 说明 staging、release 和真实外部依赖验收。

文档中的命令必须能在当前仓库直接找到，不记录一次性运行结果或临时 CI 基础设施状态。

## 选择原则

1. 先运行能够验证改动模块的最小检查。
1. 跨 package 合同变更先校验合同，再校验全部消费者。
1. 只有变更触及外部依赖、浏览器流程、部署或发布时，才运行相应 integration、E2E、staging
   或 release 检查。
1. formatting、lint 与 static check 不证明 runtime 正确。
1. 测试报告必须列出实际执行和明确省略的检查，不能写“应该通过”。

## 仓库检查

| 命令 | 负责 | 不证明 |
| --- | --- | --- |
| `pre-commit` | staged file 基础格式、解析、冲突和 secret hygiene | typecheck、test、build 或 runtime |
| `pnpm ci:repo` | Biome、Markdownlint、EditorConfig、ADR identity 与新增中文叙述检查 | 架构正确性、业务行为或 E2E |
| `pnpm ci:fast origin/main HEAD` | 变更文件静态检查、secret hygiene、planner/workflow 契约及按需合同、配置和依赖治理 | typecheck、unit test、build、数据库、浏览器或部署行为 |
| `pnpm ci:pr origin/main HEAD` | 自动 PR 使用的 `ci:fast` 别名；检查变更文件、secret、workflow/planner 合同及按需合同、配置和依赖治理 | typecheck、unit test、build、数据库、浏览器或部署行为 |
| `pnpm ci:affected origin/main HEAD` | 在本地按统一计划运行代码 profile，包括受影响的 Node、Worker、Go、Rust、OTel 与基础设施检查 | Docker、数据库、浏览器、staging 或 release 验收 |
| `pnpm ci:affected:docker origin/main HEAD` | 手动构建受影响镜像的最浅验证阶段 | 最终镜像发布、部署或运行时健康 |
| `pnpm ci:affected:database origin/main HEAD` | 手动运行受影响的隔离 PostgreSQL 套件 | staging 或 production 数据库状态 |
| `pnpm ci:affected:browser origin/main HEAD` | 手动运行受影响的 Campus Web browser smoke | 已部署环境、真实认证或完整浏览器回归 |
| `pnpm ci:config` | GitHub Actions 的 actionlint 与 zizmor 检查 | workflow 已成功运行或部署已完成 |
| `pnpm ci:deps` | pnpm、uv、Cargo 与 Go dependency graph 的 OSV 扫描 | application behavior 或 image 漏洞 |
| `pnpm ci:typescript` | 全部 JS/TS package 的通用 typecheck 与 unit test | Python Ragas、Worker runtime、外部 integration 或浏览器 |
| `pnpm ci:typescript:full` | 全量 JS/TS package、Worker 与 Ops Web build | 外部 integration、staging 或 release 检查 |
| `pnpm ci:worker` | Worker runtime test 与声明的 Worker/app build | browser E2E 或 production deploy |
| `pnpm ci:contracts` | JSON Schema/OpenAPI 生成、同步与合同 invariant | consumer runtime 行为 |
| `pnpm ci:go` | execution-control Go static check 与 test | Temporal server 或已部署 runtime |
| `pnpm ci:rust` | Rust kernel format、Clippy 与 test | runtime bridge 或对象存储行为 |
| `pnpm ci:ingest` | ingestion-contracts、ingest-core、ingestion-control 与 source-collector | 在线 retrieval 或 release publication |
| `pnpm ci:ingestion-control-postgres` | disposable PostgreSQL 上的 ingestion schema bootstrap、migration 与 role 权限 | staging 或 production 数据库状态 |
| `pnpm ci:eval` | eval-langfuse 与 Ragas adapter 的 typecheck/test | 真实数据集评分已完成 |
| `pnpm ci:otel` | 固定版本 Collector 的官方配置校验 | 真实 OTLP payload 行为或目标环境已收到信号 |
| `pnpm ci:app-api-migration` | disposable PostgreSQL 上的 baseline upgrade 与 clean install | staging database 已迁移 |
| `pnpm ci:dining-postgres` | disposable PostgreSQL 上的 Dining migration 幂等、数据保留和失败事务 | staging database 已迁移 |

`pnpm web:build` 是完整 web build，不是所有 PR 的默认检查；模块构建需要的 docs manifest、
database 或其他外部输入必须先准备完毕。

Campus Web 浏览器验证分为三个边界：

- `pnpm ci:affected:browser origin/main HEAD` 按变更计划运行带 `@smoke` 标签的关键 Vite 与
  Worker 用户旅途，由开发者在本地或手动流程明确触发，不是自动 PR 门禁；
- `pnpm --dir apps/campus-web test:e2e:full` 在本地运行全部 Vite 与 Worker 浏览器回归，适用于
  跨页面、导航、认证、文档阅读或领域体验重构；
- `manual-health` 的 `browser` profile 可显式运行 Campus Web 完整 Vite/Worker 回归和 Ops Web
  浏览器回归；仓库不设置定时浏览器检查；
- browser profile 使用独立端口且不复用已有开发服务器；并行本地检查通过
  `CAMPUS_WEB_E2E_PORT` 与 `CAMPUS_WEB_E2E_WORKER_PORT` 覆盖端口；
- 请求竞态、故障注入、动画细节等实现级回归由模块测试和完整浏览器回归承载，不进入
   PR smoke；
- 部署后真实认证、Service Binding 和正式数据验收属于 staging/release runbook，不由本地
  Playwright fixture 代替。

## 变更面选择

| 变更面 | 至少运行 |
| --- | --- |
| 仅 Markdown、文档索引或贡献规范 | `pnpm ci:repo` |
| `packages/contracts`、OpenAPI、共享 schema | `pnpm ci:contracts`，再运行受影响 consumer 检查 |
| 一般 app/package/job TypeScript | `pnpm ci:typescript` |
| Worker route、binding、wrangler config 或 Worker shell | `pnpm ci:worker` 与模块测试；涉及发布脚本时加运行时密钥审计和 Worker version self-test |
| Campus Web 用户可见运行时 | 模块 typecheck/test、`test:e2e:smoke`；跨页面重构本地加 `test:e2e:full` |
| execution-control Go、Go module 或部署参数 | `pnpm ci:go`；合同变化时加 `pnpm ci:contracts` |
| Rust kernel 或 Cargo workspace | `pnpm ci:rust` |
| ingestion app、package、source config 或 task registry | `pnpm ci:ingest`；合同变化时加 `pnpm ci:contracts` |
| eval package、Ragas adapter 或 eval contract | `pnpm ci:eval` |
| app-api migration | `pnpm ci:app-api-migration` 与 app-api 模块测试 |
| Dining migration | `pnpm ci:dining-postgres` 与 dining-sync 模块测试 |
| `.github/**` | `pnpm ci:config` 与 `pnpm ci:repo` |
| dependency manifest 或 lockfile | `pnpm ci:deps` 与受影响模块检查 |
| K8s、Docker、Terraform 或 deployment script | 所属静态验证、build/render 检查与明确的环境验收 |

JS/TS 任务选择以 Turbo package graph、task inputs 与其集成测试为准；数据库、浏览器、原生语言
和发布分类以 `scripts/ci/change-plan.mjs` 及其测试为准。两者都读取重命名前后路径和删除路径。
自动 PR 运行 `pnpm ci:pr origin/main HEAD`，不运行 package typecheck、unit test、build、数据库或
浏览器验证；开发者在本地运行受影响模块检查，并按风险显式选择 code、Docker、database 或
browser profile。README 是否触发模块代码检查、哪些 image 需要发布等实现细节不得复制到本文。

## 模块与集成测试

- app/package 的默认 `test`、`typecheck` 和 `build` 命令由其 `package.json` 与 README 维护；
- `pnpm web:test:worker` 明确运行 Worker runtime test；
- `pnpm web:test:integration` 明确运行 app-api shared database integration；
- campus-web 浏览器 smoke 不进入普通 PR workflow；本地 browser profile 按变更计划运行
  `test:e2e:smoke`，手动 `manual-health` browser profile 运行 `test:e2e:full`；底层 `test:e2e` 与
  `test:e2e:worker` 分别拥有 Vite 和 Worker 套件；
- execution-control 的 Temporal server 测试使用模块提供的明确 tag/command，不属于默认
  `pnpm ci:go` 检查；
- 真实 provider、database、object store、Langfuse 或 cluster credential 不进入普通 PR test。

integration test 必须使用隔离资源，不能缓存成功结果，也不能把失败静默降级为 skipped。

## CI 与缓存

- Turbo `--affected` 负责 JS/TS task selection 与 task-result cache；读取 package 外文件的 task 必须在
  `turbo.json` 中声明 input；
- Campus Web 文档 fixture 是声明输入和输出的 Turbo 任务；浏览器 job 先恢复或构建一次，Worker
  Playwright 初始化不得重复运行 Rspress 构建；
- cache miss 必须退化为正常执行，不能使公开贡献失败；
- 不缓存 vulnerability scan、integration test、staging check 或 release check 的成功结果；
- 不缓存或上传 `node_modules`；
- runner concurrency、persistent cache 和 remote cache credential 由 workflow 与 CI 环境拥有；
  正确性不得依赖自托管 Runner 上次运行留下的工作目录；
- 手动 `verify` 通过 `base_ref` 选择比较基线，`docker`、`database` 和 `browser` profile 复用
  变更计划；Remote Cache 配置完整时启用，缺失时正常执行；
- 单 Runner 保持单并发，优先减少重复安装、重复构建和无关验证面；
- `manual-health` 每次只接受一个明确 profile，且不设置 cron 或隐式 `all`；
- 评估 CI 性能时分开记录 queue time、cold-cache time 与 hot-cache time。

## 安全检查

- Gitleaks 负责 staged file 与 PR commit range 的 secret hygiene；
- `pnpm ci:deps` 负责 dependency advisory；例外只能写入 `osv-scanner.toml`，并包含 advisory、
  原因与到期条件；
- GitHub Action 必须固定完整 commit SHA，CI tool image 必须固定可复现 digest；
- CodeQL、Dependency Review、SBOM、provenance 与 artifact attestation 只在平台能力和真实
  产物范围已明确时接入，不伪装成已启用的 PR gate。

## 发布与 Staging

以下工作不属于普通 PR 验证：

- 已部署环境中的真实 auth/session、provider 与 browser E2E；
- Temporal、PostgreSQL、Qdrant、object store 或 Collector 的部署验收；
- 完整镜像构建、SBOM、镜像扫描、产物发布、GitOps promotion 与 Cloudflare traffic selection；
- RAG release、真实 Langfuse/Ragas scoring 与发布验收。

自动 PR 不运行 Testcontainers、Docker lint/build、浏览器、staging 或 release。migration/schema
变更的隔离数据库套件由开发者在本地运行，或通过手动 database profile 明确触发。需要镜像证据时，
开发者显式运行 Docker profile；`main` 发布链路才构建并发布受影响最终镜像。

这些工作按所属 runbook 执行。source repo 中的 K8s base、Terraform source 或 workflow 成功，
都不能单独证明环境已部署；环境事实由 GitOps revision、controller 状态、健康检查和明确验收
结果共同证明。

## 提交前报告

PR 或最终交接至少写明：

- 改动模块与影响范围；
- 实际执行的命令及结果；
- 未执行的 integration/E2E/staging/release 检查及原因；
- 需要其他环境继续完成的验证，不把它描述为代码缺陷或已完成事实。
