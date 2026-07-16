---
doc_type: reference
owner_boundary: docs/reference
status: active
---
# 测试与验证通道

## 边界

本文说明仓库稳定验证命令的含义和选择规则，不复制 GitHub Actions job graph、runner 配置、
branch protection、部署 secret、镜像清单或环境状态。

- `.github/workflows/pr.yml` 拥有 PR trigger、changed-surface routing、job dependency 与 required
  aggregate；
- `.github/workflows/scheduled-health.yml` 拥有定期全量健康检查；
- root `package.json` 与 owner package script 拥有命令实现；
- app README 说明 owner-local 命令；
- runbook 说明 staging、release 和真实外部依赖验收。

文档中的命令必须能在当前仓库直接找到，不记录一次性运行结果或临时 CI 基础设施状态。

## 选择原则

1. 先运行能够证明改动 owner 的最小通道。
1. 跨 package 合同变更先校验合同，再校验全部消费者。
1. 只有变更触及外部依赖、浏览器流程、部署或发布时，才运行相应 integration、E2E、staging
   或 release 通道。
1. formatting、lint 与 static check 不证明 runtime 正确。
1. 测试报告必须列出实际执行和明确省略的通道，不能写“应该通过”。

## 仓库通道

| 命令 | 负责 | 不证明 |
| --- | --- | --- |
| `pre-commit` | staged file 基础格式、解析、冲突和 secret hygiene | typecheck、test、build 或 runtime |
| `pnpm ci:repo` | Biome、Markdownlint、EditorConfig、ADR identity 与新增中文叙述检查 | 架构正确性、业务行为或 E2E |
| `pnpm ci:config` | GitHub Actions 的 actionlint 与 zizmor 检查 | workflow 已成功运行或部署已完成 |
| `pnpm ci:deps` | pnpm、uv、Cargo 与 Go dependency graph 的 OSV 扫描 | application behavior 或 image 漏洞 |
| `pnpm ci:typescript` | 受影响 JS/TS owner 的 typecheck 与 unit test | 专用 ingestion/eval 通道和 Worker runtime |
| `pnpm ci:typescript:full` | 全量 JS/TS owner、Worker 与 Ops Web build | 外部 integration、staging 或 release |
| `pnpm ci:worker` | Worker runtime test 与声明的 Worker/app build | browser E2E 或 production deploy |
| `pnpm ci:contracts` | JSON Schema/OpenAPI 生成、同步与合同 invariant | consumer runtime 行为 |
| `pnpm ci:go` | execution-control Go static check 与 test | Temporal server 或已部署 runtime |
| `pnpm ci:rust` | Rust kernel format、Clippy 与 test | runtime bridge 或对象存储行为 |
| `pnpm ci:ingest` | ingestion-contracts、ingest-core、ingestion-control 与 source-collector | 在线 retrieval 或 release publication |
| `pnpm ci:eval` | eval-langfuse 与 Ragas adapter 的 typecheck/test | 真实数据集评分已完成 |
| `pnpm ci:app-api-migration` | disposable PostgreSQL 上的 baseline upgrade 与 clean install | staging database 已迁移 |

`pnpm web:build` 是完整 web build，不是所有 PR 的默认检查；owner build 需要的 docs manifest、
database 或其他外部输入必须先准备完毕。

## 变更面选择

| 变更面 | 至少运行 |
| --- | --- |
| 仅 Markdown、文档索引或贡献规范 | `pnpm ci:repo` |
| `packages/contracts`、OpenAPI、共享 schema | `pnpm ci:contracts`，再运行受影响 consumer 通道 |
| 一般 app/package/job TypeScript | `pnpm ci:typescript` |
| Worker route、binding、wrangler config 或 Worker shell | `pnpm ci:worker` 与 owner test |
| execution-control Go、Go module 或其 runtime config | `pnpm ci:go`；合同变化时加 `pnpm ci:contracts` |
| Rust kernel 或 Cargo workspace | `pnpm ci:rust` |
| ingestion app、package、source config 或 task registry | `pnpm ci:ingest`；合同变化时加 `pnpm ci:contracts` |
| eval package、Ragas adapter 或 eval contract | `pnpm ci:eval` |
| app-api migration | `pnpm ci:app-api-migration` 与 app-api owner test |
| `.github/**` | `pnpm ci:config` 与 `pnpm ci:repo` |
| dependency manifest 或 lockfile | `pnpm ci:deps` 与受影响 owner 通道 |
| K8s、Docker、Terraform 或 deployment script | 所属静态验证、build/render 检查与明确的环境验收 |

具体 changed-surface 分类以 `.github/workflows/pr.yml` 为准。README 文件是否触发 owner code
通道、哪些 image 需要 build/scan 等实现细节不得复制到本文。

## Owner 与集成测试

- app/package 的默认 `test`、`typecheck` 和 `build` 命令由其 `package.json` 与 README 拥有；
- `pnpm web:test:worker` 明确运行 Worker runtime test；
- `pnpm web:test:integration` 明确运行 app-api shared database integration；
- campus-web 浏览器测试使用其 `test:e2e` 或 `test:e2e:worker`；
- execution-control 的 Temporal server 测试使用 owner 提供的 explicit tag/command，不属于默认
  `pnpm ci:go`；
- 真实 provider、database、object store、Langfuse 或 cluster credential 不进入普通 PR test。

integration test 必须使用隔离资源，不能缓存成功结果，也不能把失败静默降级为 skipped。

## CI 与缓存

- Turbo 负责 JS/TS task selection 与 task-result cache；读取 package 外文件的 task 必须在
  `turbo.json` 中声明 input；
- cache miss 必须退化为正常执行，不能使公开贡献失败；
- 不缓存 vulnerability scan、integration test、staging check 或 release check 的成功结果；
- 不缓存或上传 `node_modules`；
- runner concurrency、persistent cache 和 remote cache credential 由 workflow 与 CI 环境拥有；
- 评估 CI 性能时分开记录 queue time、cold-cache time 与 hot-cache time；超过 30 秒的步骤需要
  说明其 owner 和必要性。

## 安全检查

- Gitleaks 负责 staged file 与 PR commit range 的 secret hygiene；
- `pnpm ci:deps` 负责 dependency advisory；例外只能写入 `osv-scanner.toml`，并包含 advisory、
  原因与到期条件；
- GitHub Action 必须固定完整 commit SHA，CI tool image 必须固定可复现 digest；
- CodeQL、Dependency Review、SBOM、provenance 与 artifact attestation 只在平台能力和真实
  artifact surface 已明确时接入，不伪装成已启用的 PR gate。

## 发布与 Staging

以下工作不属于普通 PR 验证：

- 真实浏览器、auth/session 与 provider E2E；
- Temporal、PostgreSQL、Qdrant、object store 或 Collector 的部署验收；
- image publication、GitOps promotion 与 Cloudflare traffic selection；
- RAG release、真实 Langfuse/Ragas scoring 与 release closeout。

这些工作按所属 runbook 执行。source repo 中的 K8s base、Terraform source 或 workflow 成功，
都不能单独证明环境已部署；环境事实由 GitOps revision、controller 状态、健康检查和明确验收
结果共同证明。

## 提交前报告

PR 或最终交接至少写明：

- 改动 owner 与影响范围；
- 实际执行的命令及结果；
- 未执行的 integration/E2E/staging/release 检查及原因；
- 需要其他环境继续完成的验证，不把它描述为代码缺陷或已完成事实。
