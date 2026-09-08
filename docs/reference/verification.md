---
doc_type: reference
owner_boundary: docs/reference
status: active
---

# 测试与验证

## 边界

本文定义检查入口、能力边界和报告语义，不把检查记录、可追溯性或审计材料作为源码任务的默认交付物。具体 package task 由所属 manifest 维护，CI job、
runner、工具版本、缓存和发布实现由可执行配置维护；本文不复制这些动态细节。

## 检查能力

| 检查 | 回答的问题 | 不能证明 |
| --- | --- | --- |
| 配置检查 | 命令需要的输入是否存在且可解析 | 远端服务健康或环境已部署 |
| 单元、合同、依赖集成、Ragas 与本地浏览器 E2E | 所属实现和边界是否符合合同，受控本地路径是否可完成 | 制品已经发布或外部环境当前可用 |
| `/healthz` | 当前进程或 Worker 是否能响应 | 核心依赖或产品路径完整 |
| `/readyz` | 服务是否具备接受其职责范围请求的核心依赖 | 新版本已部署或完整用户旅途可用 |
| 制品检查 | 构建结果是否完整、可识别且满足发布合同 | 环境已经选择或运行该制品 |

配置、健康、就绪、构建和本地浏览器 E2E 不能相互替代。服务级 `/readyz` 条件由所属合同、配置解析器和
测试维护，不在仓库级文档复制。

## 选择原则

1. 先按用户目标、现有合同和已确认完成标准判断是否需要检查；已有同一提交或等价边界的上游、PR、CI 或运行结果时，直接复用其结论。
2. 只检查代码、合同、环境或具体失败发生变化，且该变化可能影响当前完成条件的边界。
3. 数据库、浏览器、镜像和真实外部依赖只在改动可能破坏对应边界时运行。
4. formatting、lint、配置解析和构建都不能证明运行时或部署环境健康。
5. 报告只列实际运行的关键检查；未执行的检查仅在会改变当前完成判断时说明。

同一语义规则在不同生命周期边界可以重复调用，但实现只保留一个 owner。纯规则重构只需运行受影响
package 的测试、类型或格式检查；只有合同、持久化、身份、权限或外部环境边界变化时，才增加对应的
消费者、并发或环境验证。生产命中率、日志截图和重复的多层证明不能替代直接行为测试。

实现和 PR 准备根据尚未被等价既有检查覆盖、且可能破坏当前完成条件的边界选择检查。本地源码、合同、
依赖集成、Ragas、本地浏览器 E2E 和制品检查可以支持完成判断；它们不是每个任务都必须新增的交付物。
相关 integration 或本地 E2E 不因任务尚未进入发布流程而自动省略，也不因流程名称出现而自动追加。

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
| PR `container-build` profile | Docker Bake target、变量和构建定义可解析 | 镜像源码、依赖闭包或运行时入口 |
| PR `image-build` profile | 受影响镜像可在 `linux/arm64` 以 `cacheonly` 完成 BuildKit 构建 | 推送、漏洞扫描或环境部署 |

`.pre-commit-config.yaml` 是 Biome、Markdownlint、EditorConfig、Ruff、SQLFluff、Yamllint、ShellCheck、
Go format 和基础解析检查的单一可执行 owner。`pre-commit` 只选择暂存文件，`pnpm lint` 选择全部
tracked 文件；两条入口都不改写文件。PR CI 通过 `pnpm check` 复用该配置，并另行扫描 PR authored
commit 历史。

package 默认 `test`、`typecheck` 和 `build` 由所属 manifest 与 README 维护。Turbo 只负责声明
任务图、输入和缓存边界；integration test 与有副作用任务不得依赖缓存，远端缓存是否命中不影响
正确性。

## 变更面

| 变更面 | 默认检查入口（未被等价检查覆盖时） |
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
| Dockerfile、Bake 或发布适配器 | 仓库脚本测试、Bake 解析；受影响镜像执行 build-only 构建 |
| Kubernetes 或 deployment source | `scripts/infra/validate.sh` |

## PR 镜像检查边界

`container-build` 是廉价的构建定义检查，执行 `docker buildx bake --print`。`image-build` 使用
`scripts/release/image-targets.mts` 与候选发布共用的受影响目标映射，逐个执行
`scripts/release/images.mts --mode build-only`：固定 `linux/arm64`，输出为 BuildKit `type=cacheonly`，
关闭发布阶段的 provenance/SBOM attestation，不 push、不 load、不读取 registry 现有镜像，也不运行 Trivy。
两个 profile 只证明当前 Dockerfile、
Turbo prune、依赖安装、编译和 runtime 入口能完成；它们不替代正式候选发布、镜像扫描或部署验收。

普通 PR 只验证源码和受影响边界，不访问私有环境；候选物存在不能解释为已经部署。

正式 staging 候选发布先构建并推送不可变镜像，再对其 digest 运行 `linux/arm64` Trivy 扫描，记录
`HIGH,CRITICAL`、`os,library` 且已有修复版本的漏洞反馈。漏洞结果或扫描器执行异常只写入发布日志和
step summary，不阻塞 staging 候选发布或 promotion；镜像构建、推送、registry inspect、digest 解析和
必要发布产物写入失败仍然阻塞发布。

## 报告

PR 或最终交接应写明改动范围和实际执行的关键检查及结果；只有未执行的检查会改变当前完成判断时才说明。
不重复枚举无关下游流程，也不得把未执行的检查描述为已经通过。
