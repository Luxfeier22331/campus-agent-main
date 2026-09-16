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
| `pre-commit` | 暂存文件的静态检查与 Secret 扫描、根脚本测试，以及受影响 Node/Go 源码检查 | build、integration、浏览器 E2E 或 runtime |
| `pre-push` | 不再安装仓库重验证 hook | 源码或运行时验证 |
| `pnpm verify` | 全量源码检查、Ragas 单测、数据库集成、Infra、OTel 和 Bake 配置检查 | 制品构建、Temporal/stream/replay、浏览器 E2E 或部署状态 |
| `pnpm verify --source` | 仓库 lint、文档、脚本、合同、Actions lint、Node/Go 检查及 Ragas 单测，不启动数据库 | 制品构建、显式集成测试或部署状态 |
| `pnpm check` | 本地仓库 lint、文档治理和仓库自动化测试 | package 行为或环境状态 |
| `pnpm lint` | 对所有 tracked 文件执行与 `pre-commit` 相同的静态检查，但跳过 staged Secret 扫描与 validation group | 文档链接、业务行为或类型正确性 |
| `pnpm docs:check` | frontmatter、笔记树与格式、归档、入口预算、链接和语言合同 | 代码或部署状态 |
| `pnpm test` | 可复用 Turbo 缓存的仓库开发、验证和发布脚本测试 | package test、镜像构建或外部服务 |
| `pnpm --dir packages/contracts check` | JSON Schema/OpenAPI 同步和合同不变量 | consumer runtime 行为 |
| `scripts/dependencies/scan.sh` | 已锁定依赖的漏洞扫描 | 应用行为或镜像漏洞 |
| `scripts/infra/validate.sh` | Kustomize render 与基础设施 policy | 集群已应用或 workload 健康 |
| `scripts/otel/validate-config.sh` | Collector 配置校验 | 后端已经收到真实信号 |
| PR `container-build` profile | Docker Bake target、变量和构建定义可解析 | 镜像源码、依赖闭包或运行时入口 |
| PR `image-build` profile | 受影响镜像可在 `linux/arm64` 以 `cacheonly` 完成 BuildKit 构建 | 推送、漏洞扫描或环境部署 |

跨语言静态检查由 `.pre-commit-config.yaml` 拥有，包级任务由所属 manifest 拥有。
公共验证执行器统一 Node、Go、构建和数据库任务集合；全量与 affected 只改变选择范围。
Node 任务的 Turbo 并发以半核数（最少 2）为上限，native 任务串行，避免全量 affected 在共享
runner 上把任务内进程池与任务级并行相乘造成超时饥饿。
本地和 CI 使用仓库锁定的 Nix 工具链，Go 检查不依赖用户 PATH 中的全局 lint 版本。

pre-commit 先执行静态检查与 Secret 扫描，再执行根目录 `pnpm test` 和受影响模块检查；任一阶段
失败即停止。根测试仍在没有受影响模块时调用，但相同输入可以复用成功结果。模块任务继续复用统一
执行器中的 Node typecheck/test/worker test 与 Go format/lint/vet/test 集合，不增加构建或集成检查。

提交前任务选择使用 prek 隔离未暂存修改后的工作区，以 HEAD 为 Turbo affected 基准，不能用两个
相同提交的空差异代替暂存变更。没有暂存文件变化时跳过模块任务；首次提交没有 HEAD 时检查全量
Node/Go 源码任务，不依赖远端引用或自动 fetch。PR 继续按真实 base/head 检查完整分支差异。
`pnpm lint` 通过排除 validation group 保持静态检查语义，不因 hook 迁移而重复调用测试。

`pnpm test` 通过根任务 `//#test:scripts` 执行原有脚本测试，不依赖模块测试或递归调用自身。
该任务输入为仓库默认未忽略文件，覆盖脚本读取的应用源码、工作流、文档、配置和工具链文件；
还使用当前 Git 索引树及实际 Node、Git、pnpm 版本、OS 和架构作为专属缓存输入。索引树用于区分
测试读取的 Git 跟踪文件集合，提交 SHA、分支名和 worktree 绝对路径不进入缓存键。
Git 上下文在测试子进程启动前清理，避免临时仓库被 hook 的 Git 路径变量指向当前仓库。
缓存只复用成功结果；失败照常阻断。`pnpm check`、verify、提交 hook 和 PR 共用这个入口。

pre-push 不再执行重验证。`pnpm hooks:install` 在当前 worktree 卸载 prek 管理的旧 pre-push shim，
再安装 pre-commit；其他 worktree 和自定义 hook 不因此改变。迁移原因与取舍见
[提交前验证与根测试缓存](../../.agents/notes/implemented/process/2026-09-16-pre-commit-validation.md)。
仓库文档检查仍由 `pnpm check`、`pnpm verify` 和 PR 执行。

源码 affected 使用真实提交和 Turbo 配置。发布候选由 release 所有者保留现有配置过滤及显式镜像
选择规则，不让发布选择反向抑制源码校验。PR 复用生成的任务计划；选中但未成功执行的检查不能通过汇总。

完整验证保留现有数据库与配置检查，不扫描所有 `test:*` 命令。Temporal、stream、replay、浏览器
与制品构建按实际边界显式运行。GitHub 手动 validation profile 先确定工具环境和工作区依赖，再执行
固定检查，不需要 base/head。Go PostgreSQL 检查包含共享 schema Job 依赖；Temporal 检查包含
其实际调用的 Agent Runtime Node 依赖。

CI 保留现有命令输出、失败诊断和只读耗时报告。工具版本、缓存键、任务清单与 workflow 步骤以可执行
配置为准，不在本文复制。Go 任务的输入包含 workspace 和工具链；缓存目录只透传，不当作源码输入。
缓存服务不可用不改变任务正确性，检查成功也不等于所有缓存层均命中。

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
| execution-control / model-config Go | 所属 native format、lint、typecheck 和 test |
| migration 或数据库权限 | `pnpm --dir jobs/campus-agent-schema test:migration-integration`，以及受影响所有者的数据库集成测试 |
| eval package、Ragas adapter 或评测合同 | 所属 package test；跨语言时运行对应 adapter |
| GitHub Actions | `pnpm check`、Actionlint 与 Zizmor |
| dependency manifest 或 lockfile | frozen install、受影响模块检查，必要时运行漏洞扫描 |
| Dockerfile、Bake 或发布适配器 | 仓库脚本测试、Bake 解析；受影响镜像执行 build-only 构建 |
| Kubernetes 或 deployment source | `scripts/infra/validate.sh` |

## PR 镜像检查边界

统一 migration 的源码、SQL、测试、依赖声明或 workspace lockfile 变化时，PR 自动选择
`schema-migration`，使用真实 PostgreSQL 执行升级测试。该 profile 失败或被跳过时不能通过 required
check；App API 的业务数据库测试也使用同一 schema Job，不保留第二条测试用迁移链。

`container-build` 是廉价的构建定义检查，执行 `docker buildx bake --print`。`image-build` 使用
`scripts/release/image-targets.mts` 与候选发布共用的受影响目标映射，按 Bake 分组执行
`scripts/release/images.mts --mode build-only`：固定 `linux/arm64`，输出为 BuildKit `type=cacheonly`，
关闭发布阶段的 provenance/SBOM attestation，不 push、不 load、不复用 registry 现有发布镜像，也不运行 Trivy。
缓存导入缺失或不可读的诊断由 BuildKit 保留，不进行脚本级重试。
本地可通过 `--cache-import-registries '["127.0.0.1:<port>/cache"]'` 指定回环 registry 前缀，
实际引用为 `<prefix>/<image>:buildcache-arm64`；省略该参数不读取外部缓存。证据入口通过
`CI_IMAGE_CACHE_IMPORT_REGISTRIES` 传入 JSON 数组。需要导出时显式传入 `--cache-export-registry`。
build-only 复用正式发布的 BuildKit 分段日志和 summary，不推送运行镜像。
同仓非 Dependabot PR 的独立镜像 job 同时导入当前 PR 和主线缓存，仅将 `mode=max` 缓存导出至
`ghcr.io/<owner>/<repo>/pr-cache-<number>/<image>:buildcache-arm64`。fork、Dependabot 和登录失败时
不使用认证缓存。普通校验 job 不持有 package write 权限，最终 `repo-checks` 汇总所有选中任务。
两个 profile 只证明当前 Dockerfile、
Turbo prune、依赖安装、编译和 runtime 入口能完成；它们不替代正式候选发布、镜像扫描或部署验收。

普通 PR 只验证源码和受影响边界，不访问私有环境；候选物存在不能解释为已经部署。

正式 staging 候选发布先构建并推送不可变镜像，再对其 digest 运行 `linux/arm64` Trivy 扫描，记录
`HIGH,CRITICAL`、`os,library` 且已有修复版本的漏洞反馈。漏洞结果或扫描器执行异常只写入发布日志和
step summary，不阻塞 staging 候选发布或 promotion；镜像构建、推送、registry inspect、digest 解析和
必要发布产物写入失败仍然阻塞发布。

正式发布使用 BuildKit 原生 `rawjson` 进度，由 `scripts/release/buildkit-progress.mts` 流式解析并在
原有发布日志中显示操作开始、完成、缓存命中、命令输出和错误；忽略高频 layer 字节进度。原有 step
summary 按批次列出依赖安装、编译与部署包、SBOM、镜像导出、推送和缓存导出的操作耗时，不增加报告
job。失败和信号退出也保留已经观测到的阶段；未完成耗时标为 unknown，不推算结束时间。

build-only 和正式发布均按现有 Bake `heavy`、`standard` 分组与选中目标取交集，先 heavy 后 standard，
每个非空组调用一次 Bake。日志保留具名 target；共享操作不重复计入各镜像。批次失败时只将已观察到的
目标错误标记为 failed，同批未确认目标为 unfinished，后续组为 not-started。正式发布仍先检查不可变
tag，仅构建缺失镜像，全部 digest 有效后才写最终结果。主线只读写 canonical 缓存。

registry 缓存继续使用 `mode=max` 和 `ignore-error=true`。镜像发布结果与缓存导出结果分别显示：
导出失败会留下 warning，不能因为镜像推送成功就声称缓存成功。复用已有镜像时不执行构建或缓存导出。
同一操作的多段时间取区间并集；操作之间以及 exporter 父子步骤可能重叠，不能相加作为总耗时。

layer cache 命中表示整个命令没有执行；pnpm 的 reused/downloaded 则来自实际执行时的 Progress
输出，两者分别呈现。没有包进度时显示 unknown；同一命令的多次安装进度分开保留，不相加为总命中率。
编译和 deploy 同处一个 Dockerfile RUN 时只报告该 RUN 的总耗时，不从包进度推算独立编译耗时。

## 本地镜像诊断

`scripts/ci/measure-image.mts` 继续作为独立诊断入口，使用专用 Buildx builder、回环 registry
和隔离构建上下文；参数及输出由脚本维护。不清理日常 builder，不将本地模拟耗时解释为 CI 性能。
历史测量样本不作为修改验证脚本的前置条件。

## 报告

PR 或最终交接应写明改动范围和实际执行的关键检查及结果；只有未执行的检查会改变当前完成判断时才说明。
不重复枚举无关下游流程，也不得把未执行的检查描述为已经通过。
