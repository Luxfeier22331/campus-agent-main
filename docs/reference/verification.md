---
doc_type: reference
owner_boundary: docs/reference
status: active
---

# 测试与验证

## 术语边界

本文只描述如何选择和解释源码检查。产品文档中的“完成标准”描述用户可见行为；PR 和 CI 的“检查”描述
实际运行的命令及其结果；发布记录和 runbook 才描述制品部署后的环境观察、回滚和交接。三者不能互相替代，
也不因同一个词出现在不同文档中而自动扩大检查范围。

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
| `pnpm verify` | 全量源码检查、Ragas 单测、数据库集成、Infra 和 Bake 配置检查 | 制品构建、Temporal/stream/replay、浏览器 E2E 或部署状态 |
| `pnpm check` | 仓库 lint、文档、脚本、合同、Actions lint、Node/Go 检查及 Ragas 单测，不启动数据库 | 制品构建、显式集成测试或部署状态 |
| `pnpm lint` | 对所有 tracked 文件执行与 `pre-commit` 相同的静态检查，但跳过 staged Secret 扫描与 validation group | 文档链接、业务行为或类型正确性 |
| `pnpm docs:check` | frontmatter、笔记树与格式、归档、入口预算、链接和语言合同 | 代码或部署状态 |
| `pnpm typecheck` | 全仓声明的 TypeScript 检查，包括 tooling notices | Go vet、测试或构建 |
| `pnpm test` | tooling、Node/DOM、本地 Worker、Go 和 Ragas 单测 | 数据库集成、浏览器 E2E 或外部服务 |
| `pnpm test:tooling` | 七组仓库开发、验证和发布脚本测试 | package 行为或构建 |
| `pnpm build` | 选中包的生产构建，保留所需环境输入 | 部署状态 |
| `pnpm build:check` | 验证构建；Campus 使用本地合成内容 fixture | 生产文档内容或部署状态 |
| `pnpm verify --profile=go --profile=ragas` | 仅运行指定的现有 validation profiles，可重复指定 | 未选中的检查 |
| `pnpm --dir packages/contracts contracts:check` | JSON Schema/OpenAPI 同步和合同不变量 | consumer runtime 行为 |
| `scripts/dependencies/scan.sh` | 已锁定依赖的漏洞扫描 | 应用行为或镜像漏洞 |
| `scripts/infra/validate.sh` | Kustomize render 与基础设施 policy | 集群已应用或 workload 健康 |
| PR `container-build` profile | Docker Bake target、变量和构建定义可解析 | 镜像源码、依赖闭包或运行时入口 |
| PR `image-build` profile | 受影响镜像可在 `linux/arm64` 以 `cacheonly` 完成 BuildKit 构建 | 推送、漏洞扫描或环境部署 |

根 `check`、`test`、`typecheck` 默认全仓；子包脚本直接执行具体任务，Turbo 的 `test` 是无命令聚合。
根 `typecheck`、`test`、`build`、`build:check` 和 `check` 接受 `--filter=<selector>`、`--affected`、
`--dry-run=json`。filter 使用 Turbo 原生语义，不自动追加 `...`；依赖通过 `^source` 传播，
不强制运行依赖测试。`check` 的筛选只作用于包任务，lint、docs、tooling、contracts 和 Actions
始终保持仓库范围。dry-run 输出包任务图和缓存信息，不执行准备、检查或构建。

```bash
pnpm typecheck --filter=campus-web
pnpm test --filter=campus-web
pnpm build:check --filter=campus-web --dry-run=json
TURBO_SCM_BASE=main pnpm test --affected
pnpm --dir apps/campus-web test:dom:isolated test/campus-captcha.isolated.test.tsx
```

框架文件名和测试名称参数传给所属子包叶任务，不经根入口广播。affected 复用 Turbo 的 SCM 环境；
`check`、`verify` 和 `test` 使用仓库 Nix 全量工具链，运行时缓存键在该工具链中计算。
Campus TypeScript 使用单 checker，保持文件覆盖与 strict 配置；缓存仍由 Turbo 管理，不另开 TS incremental。
入口及迁移理由见[工作区脚本与验证入口治理](../../.agents/notes/implemented/process/2026-09-22-workspace-command-governance.md)。

跨语言静态检查由 `.pre-commit-config.yaml` 拥有，包级任务由所属 manifest 拥有。
公共验证执行器统一 Node、Go、构建和数据库任务集合；全量与 affected 只改变选择范围。
Node 任务的 Turbo 并发以半核数（最少 2）为 CPU 上限，再按进程内存额度每 2 GiB 一个任务
收紧，最低一个任务；native 任务串行，避免任务内进程池与任务级并行相乘。
本地和 CI 使用仓库锁定的 Nix 工具链，Go 检查不依赖用户 PATH 中的全局 lint 版本。

pre-commit 先执行静态检查与 Secret 扫描，再按暂存文件选择 repository checks、
`pnpm test:tooling --groups=...` 和受影响模块检查；任一阶段失败即停止。repository checks 与 CI
共用同一 registry、命令和 Nix 环境，只有文件选择范围不同：contracts 使用 `ci-go`，Actions 配置使用
`ci-light`。没有选中 tooling 组时不运行根测试；相同输入复用成功结果。模块任务继续复用统一执行器中的
Node typecheck/test/worker test 与 Go format/lint/vet/test 集合，不增加构建或集成检查。

Node typecheck 由 pre-commit 和手动 verify 执行，PR 不再重复执行；PR 保留受影响测试和构建。
仅 typecheck 受影响时不选择 PR Node 检查或安装对应 workspace。PR 不提供合并结果的独立
Node 类型检查；rebase 后需要复验时使用所属 package 的 typecheck。取舍见
[PR 类型检查去重](../../.agents/notes/implemented/testing/2026-09-21-pr-typecheck-deduplication.md)。

提交前任务选择使用 prek 隔离未暂存修改后的工作区，以 HEAD 为 Turbo affected 基准，不能用两个
相同提交的空差异代替暂存变更。没有暂存文件变化时跳过模块任务；首次提交没有 HEAD 时检查全量
Node/Go 源码任务，不依赖远端引用或自动 fetch。PR 继续按真实 base/head 检查完整分支差异。
`pnpm lint` 通过排除 validation group 保持全仓静态检查语义；动态 repository checks 由统一 evidence
executor 负责，不在 lint hook 中复制一套命令。

`pnpm test:tooling` 串行执行 `scripts` tooling workspace 的 CI、deploy、dev、docs、hooks、notices 和
release 测试组，各组独立缓存。脚本的业务依赖属于 tooling workspace，不进入根包的全局依赖 hash。
各组声明实际读取的源码、工作流、文档、配置和工具链；CI 组检查全仓合同，保留广泛输入。
读取 Git 文件清单的组额外使用对应范围的跟踪路径摘要，文件内容仍由 Turbo 输入负责；实际
Node、Git、pnpm 版本及 OS/架构进入缓存键，提交 SHA、分支名和 worktree 绝对路径不进入。
Git 上下文在测试子进程启动前清理，避免临时仓库被 hook 的 Git 路径变量指向当前仓库。
缓存只复用成功结果；失败照常阻断。`pnpm check`、verify、提交 hook 和 PR 共用这个入口。

pre-push 不再执行重验证。`pnpm hooks:install` 在当前 worktree 卸载 prek 管理的旧 pre-push shim，
再安装并检查 pre-commit 文件存在且可执行；其他 worktree 和自定义 hook 不因此改变。迁移原因与取舍见
[提交前验证与根测试缓存](../../.agents/notes/implemented/process/2026-09-16-pre-commit-validation.md)。
仓库文档检查仍由 `pnpm check`、`pnpm verify` 和 PR 执行。

源码 affected 使用真实提交和 Turbo 配置。发布候选由 release 所有者保留现有配置过滤及显式镜像
选择规则，不让发布选择反向抑制源码校验。PR 复用生成的任务计划；选中但未成功执行的检查不能通过汇总。

Node 的 test、typecheck 和 build 通过不执行命令的 `source` 节点跟踪依赖包源码，不要求执行依赖包
测试。前端按 Node/DOM 和是否需要模块隔离分为可缓存叶任务，CI 不重复执行聚合 `test`。跨包 fixture
由实际消费者显式声明；实际 Node 版本及运行平台在选定工具链内计算。取舍见
[源码依赖与分组测试缓存](../../.agents/notes/implemented/testing/2026-09-19-source-and-test-cache-boundaries.md)。
PR 基础检查失败后停止安装受影响依赖及重检查；选中的前置任务意外跳过也不能继续，最终汇总仍失败。

完整验证保留现有数据库与配置检查，不扫描所有 `test:*` 命令。Temporal、stream、replay、浏览器
与制品构建按实际边界显式运行。GitHub 手动 validation profile 先确定工具环境和工作区依赖，再执行
固定检查，不需要 base/head。Go PostgreSQL 检查包含共享 schema Job 依赖；Temporal 检查包含
其实际调用的 Agent Runtime Node 依赖。

CI 保留现有命令输出、失败诊断和只读耗时报告。工具版本、缓存键、任务清单与 workflow 步骤以可执行
配置为准，不在本文复制。Go 任务的输入包含 workspace 和工具链；缓存目录只透传，不当作源码输入。
缓存服务不可用不改变任务正确性，检查成功也不等于所有缓存层均命中。

package 的具体 `test:unit`、分组测试、`typecheck` 和 `build` 由所属 manifest 与 README 维护。Turbo 只负责声明
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
| execution-control / model-config Go | 所属 native format、lint、vet 和 test |
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

镜像选择独立于 Turbo 校验任务图：按生产 workspace 依赖、实际编译的开发依赖、Dockerfile 和
包外资源选择消费者，并同时读取比较前后两棵 Git 树的依赖声明。测试、README、Turbo 与测试配置
变化不选择镜像。根 Node 依赖清单和 lockfile 选择 Node 镜像，Go 模块各自选择对应镜像。
PR 优先与同一 PR 最近一次成功工作流中实际成功的镜像 job 比较，使用 reusable workflow 记录的
merge SHA 直接比较两棵树；失败、取消或没有运行镜像构建的工作流不能成为基线。没有可用历史时
按完整 PR diff 选择镜像。普通测试仍使用 PR base，summary 单独显示镜像比较基线与历史 run ID。

Docker context 排除测试、校验配置和本地产物，保留 SQL、schema 和运行时合同 fixture。
Node prune 保留冻结安装需要的全部 manifest，但只向编译层复制生产 workspace 源码；Go 分开复制
模块清单与 `cmd`、`internal`。基础镜像继续使用现有 tag，不锁 digest、不新增自动更新工作流。
选择与缓存的取舍见[镜像生产输入与 PR 增量构建](../../.agents/notes/implemented/testing/2026-09-19-image-production-inputs.md)。

缓存导入缺失或不可读的诊断由 BuildKit 保留，不进行脚本级重试。
本地可通过 `--cache-import-registries '["127.0.0.1:<port>/cache"]'` 指定回环 registry 前缀，
实际引用为 `<prefix>/<image>:buildcache-arm64`；省略该参数不读取外部缓存。证据入口通过
`CI_IMAGE_CACHE_IMPORT_REGISTRIES` 传入 JSON 数组。需要导出时显式传入 `--cache-export-registry`。
build-only 复用正式发布的 BuildKit 分段日志和 summary，不推送运行镜像。
同仓 PR 的独立镜像 job 默认只导入主线 canonical cache，不写入每个 PR 的 registry cache；这避免了
合并后 main 发布不会消费的 `mode=max` 导出。reusable workflow 只保留 `cache_read` 输入，不提供
PR cache 导出。fork、Dependabot 和登录失败时不使用认证缓存；trusted 同仓 PR 读取 canonical cache。
普通校验 job 不持有
package write 权限，最终 `repo-checks` 汇总所有选中任务。
缓存导出是加速反馈而不是发布制品：失败保留镜像构建结果，但会在日志和 step summary 中显示 warning。
两个 profile 只证明当前 Dockerfile、
Turbo prune、依赖安装、编译和 runtime 入口能完成；它们不替代正式候选发布、镜像扫描或部署状态检查。

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
