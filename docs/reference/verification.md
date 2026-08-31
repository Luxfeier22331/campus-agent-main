---
doc_type: reference
owner_boundary: docs/reference
status: active
---

# 测试与验证

## 边界

本文定义验证证据的选择、稳定入口和报告语义。具体 package task 由所属 manifest 维护，CI job、
runner、工具版本、缓存和发布实现由可执行配置维护；本文不复制这些动态细节。

## 证据层级

| 证据 | 回答的问题 | 不能证明 |
| --- | --- | --- |
| 配置检查 | 命令需要的输入是否存在且可解析 | 远端服务健康或环境已部署 |
| 单元、合同、依赖集成、Ragas 与本地浏览器 E2E | 所属实现和边界是否符合合同，受控本地路径是否可完成 | 制品已经发布或外部环境当前可用 |
| `/healthz` | 当前进程或 Worker 是否能响应 | 核心依赖或产品路径完整 |
| `/readyz` | 服务是否具备接受其职责范围请求的核心依赖 | 新版本已部署或完整用户旅途可用 |
| 制品检查 | 构建结果是否完整、可识别且满足发布合同 | 环境已经选择或运行该制品 |

配置、健康、就绪、构建和本地浏览器 E2E 不能相互替代。服务级 `/readyz` 条件由所属合同、配置解析器和
测试维护，不在仓库级文档复制。

## 选择原则

1. 先运行能够验证改动模块的最小检查。
2. 跨 package 合同变更先校验合同，再校验受影响消费者。
3. 数据库、浏览器、镜像和真实外部依赖只在改动可能破坏对应边界时运行。
4. formatting、lint、配置解析和构建都不能证明运行时或部署环境健康。
5. 报告只列实际运行的检查，以及与改动风险相关但未执行的检查。

实现和 PR 准备根据改动可能破坏的边界选择证据。本地源码、合同、依赖集成、Ragas、本地浏览器 E2E 和
制品检查可以成为完成条件；相关 integration 或本地 E2E 不因任务尚未进入发布流程而自动省略。

环境交接和运行结果由环境仓及其所有者判断，不是源码任务的完成条件。

## 稳定命令

| 命令 | 负责 | 不证明 |
| --- | --- | --- |
| `pre-commit` | 暂存文件的 check-only 跨语言静态检查和 Secret 扫描 | typecheck、test、build 或 runtime |
| `pre-push` | 受影响 Node 模块的 typecheck/test/worker test 与 Go 模块的 vet/test | build、integration、浏览器 E2E 或 runtime |
| `pnpm verify` | 对当前工作树的源码和配置执行全量 lint、合同、类型与测试检查 | 需显式选择的制品构建、浏览器 E2E、部署或运行时状态 |
| `pnpm check` | 仓库 lint、文档治理和仓库自动化测试 | package 行为或环境状态 |
| `pnpm lint` | 对所有 tracked 文件执行与 `pre-commit` 相同的静态检查，但跳过 staged Secret 扫描 | 文档链接、业务行为或类型正确性 |
| `pnpm docs:check` | frontmatter、ADR、链接和语言合同 | 代码或部署状态 |
| `pnpm test` | 仓库开发、验证和发布脚本测试 | package test、镜像构建或外部服务 |
| `pnpm --dir packages/contracts check` | JSON Schema/OpenAPI 同步和合同不变量 | consumer runtime 行为 |
| `scripts/dependencies/scan.sh` | 已锁定依赖的漏洞扫描 | 应用行为或镜像漏洞 |
| `scripts/infra/validate.sh` | Kustomize render 与基础设施 policy | 集群已应用或 workload 健康 |
| `scripts/otel/validate-config.sh` | Collector 配置校验 | 后端已经收到真实信号 |

`.pre-commit-config.yaml` 是 Biome、Markdownlint、EditorConfig、Ruff、SQLFluff、Yamllint、ShellCheck、
Go format 和基础解析检查的单一可执行 owner。`pre-commit` 只选择暂存文件，`pnpm lint` 选择全部
tracked 文件；两条入口都不改写文件。PR CI 通过 `pnpm check` 复用该配置，并另行扫描 PR authored
commit 历史。

package 默认 `test`、`typecheck` 和 `build` 由所属 manifest 与 README 维护。Turbo 只负责声明
任务图、输入和缓存边界；integration test 与有副作用任务不得依赖缓存，远端缓存是否命中不影响
正确性。

## 变更面

| 变更面 | 至少运行 |
| --- | --- |
| 仅 Markdown、文档索引或贡献规范 | `pnpm check` |
| `packages/contracts`、OpenAPI、共享 schema | contracts check，再运行受影响 consumer 检查 |
| 一般 TypeScript app/package/job | 所属 package 的 typecheck 与 test；跨 package 时使用明确 filter |
| Worker route、binding 或 Wrangler 配置 | 所属 Worker 的 worker test、build 和模块测试 |
| Campus Web 用户可见运行时 | 模块检查和制品完整性；按风险运行本地浏览器路径 |
| execution-control Go | 所属 native format、lint、typecheck 和 test |
| migration 或数据库权限 | 对应 migration、数据库集成和所有者测试 |
| eval package、Ragas adapter 或评测合同 | 所属 package test；跨语言时运行对应 adapter |
| GitHub Actions | `pnpm check`、Actionlint 与 Zizmor |
| dependency manifest 或 lockfile | frozen install、受影响模块检查，必要时运行漏洞扫描 |
| Dockerfile、Bake 或发布适配器 | 仓库脚本测试、Bake 解析；风险需要时构建目标制品 |
| Kubernetes 或 deployment source | `scripts/infra/validate.sh` |

普通 PR 只验证源码和受影响边界，不访问私有环境；候选物存在不能解释为已经部署。

## 报告

PR 或最终交接至少写明改动范围、实际执行的命令和结果，以及与本次风险相关但未执行的检查。完成状态
按本文件的证据边界判断，不重复枚举无关下游流程，也不得把未执行的检查描述为已经通过。
