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
| `pnpm check` | 本地仓库 lint、文档治理和仓库自动化测试 | package 行为或环境状态 |
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
tracked 文件；两条入口都不改写文件。PR CI 将 lint、文档检查和脚本测试按依赖顺序分步执行，保留每个
hook 的原生耗时；Biome 使用单批文件输入，避免多个进程重复加载项目。hook groups 仅用于本地诊断，
CI 仍执行一次全量 prek。Go format 使用 `ci-format`，自动 native evidence 使用 `ci-go`，完整工具集
保留在 `ci-full`，不让纯格式检查准备完整 Go、容器和集群环境。CI 另行扫描 PR authored commit
历史。完成后的运行会由只读 `ci-timing-report` workflow 汇总步骤、profile/command、hook 和可观察到的缓存信号；缺少旧日志中的
信号保持 unknown，不推断取消原因或缓存命中率。并行 lane 只有在至少 3–5 次已埋点运行取得真实
耗时数据后才评估。

CI 在静态检查准备步骤顺序执行 `nix print-dev-env`，将 `ci-light`、`ci-format` 环境写入 runner
临时目录；准备成功后通过 `CI_NIX_LIGHT_ENV`、`CI_NIX_FORMAT_ENV` 交给 hook。hook 加载环境后
直接执行工具，保留 prek 并发，避免每个 hook 重复求值 flake。普通本地 hook 未设置这两个变量时
仍使用原有 `nix develop` 入口；显式提供的环境文件不可用时检查失败。

SQLFluff hook 在传入文件前排除 `.sqlfluffignore` 中的历史 SQL，以及统一 schema Job 的
`0000_campus_agent_baseline.sql`。该文件是不可改写的 `pg_dump` 基线，由现有 PostgreSQL 集成
测试通过统一迁移入口实际执行；后续手写 migration 继续执行 SQL lint，不扩大文件大小限制。

报告 workflow 直接使用 `.node-version` 固定的 Node 与 runner 上的 gh，不安装 Nix 或 workspace
依赖；最近 20 次运行中展示 5 次已完成运行。计算总体 CI 成本时也应计入这个独立报告 job。

报告按日志中的 job/step 归属计算 shell 准备耗时，缺少归属时显示 unknown。同一次 hook 的 trace
耗时与 verbose 结果合并显示，重复执行仍分别记录。pnpm 安装按步骤、镜像和 BuildKit operation
保留每次安装的最后进度，不将 Docker 内安装覆盖到宿主机统计，也不合并为全局命中率。
宿主机安装仅从依赖安装步骤采集；Docker 安装和 BuildKit 缓存信号仅从镜像 evidence 步骤的活动
镜像构建中采集，脚本测试输出的模拟事件不参与统计。GitHub API 时间戳精确到秒，步骤、排队、
趋势和 shell 准备耗时展示为向下取整的约整数秒（不足一秒显示 `<1s`）；JSON 保留原始毫秒值。
hook 和 command 的直接测量耗时继续保留小数。

hosted PR runner 使用 `PNPM_CONFIG_STORE_DIR` 指向 runner 临时目录中的共享 store，在首次安装前
按前缀恢复、选中依赖全部安装成功后保存。缓存键使用 v2 命名空间，区分 OS、架构、Node/pnpm 版本、
lockfile/workspace 配置和实际安装 filters（排序去重）。优先恢复同一 lockfile 下的缓存，再尝试相同
工具版本的其他缓存；部分恢复由 frozen install 补齐缺失依赖。plan 生成后计算包含安装范围的保存键，
仅在实际恢复键与保存键相同时跳过保存，确保同一 PR 扩大安装范围后能保存新增依赖。缓存服务异常不阻塞正常安装，
安装失败或取消不保存。只缓存 store，不缓存 node_modules 或环境文件；self-hosted runner 保留自身
持久 store。该缓存用于同一 PR 后续运行，不增加主分支缓存预热 job。

选中 execution-control native 检查时，hosted runner 还恢复 Go modules、Go build 和 golangci-lint
缓存。目录由 native 步骤显式指定，与缓存 action 一致。键区分 OS、架构、锁定工具链、module 合同、lint
配置及源码提交；相同工具链/依赖的前缀可恢复上一提交，检查成功后保存新提交的分析结果。精确命中时仍
执行检查，但不重复保存；取消、检查失败或 self-hosted 不上传缓存。日志记录实际恢复键与精确命中标志，
golangci-lint verbose 保留内部耗时；action 命中不等于全部 lint 分析命中。

Nix 使用 lock 中的原生 Go 包，并校验其版本与 `go.work` 一致；版本不符直接失败，不通过源码覆盖升级。
手动更新 `nixpkgs` 后须同步工具版本合同，并确认 CI 目标架构的 Go 和 lint 在二进制缓存中可用。

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

## 本地镜像耗时对照

`scripts/ci/measure-image.mts` 是本地诊断入口，直接调用现有 Bake target，不进入 Actions 或候选发布
流程。需要已启动的独立 Buildx builder 和回环 registry；不复用日常 builder，不清理共享缓存。
例如先运行以下命令（名称和端口应选择未占用值）：

```bash
docker run -d --name ci-image-registry -p 127.0.0.1:15000:5000 registry:2
cat > /tmp/ci-image-buildkit.toml <<'EOF'
[registry."127.0.0.1:15000"]
  http = true
  insecure = true
EOF
docker buildx create --name ci-image-measure --driver docker-container \
  --driver-opt network=host --buildkitd-config /tmp/ci-image-buildkit.toml --bootstrap
node scripts/ci/measure-image.mts --builder ci-image-measure \
  --context /tmp/source-measure-context \
  --cache-ref 127.0.0.1:15000/cache:baseline \
  --image-ref 127.0.0.1:15000/ops:baseline \
  --output /tmp/image-baseline-cold
```

`--context` 指向从 tracked 工作树文件复制的独立目录，包含 `docker-bake.hcl`、`.dockerignore` 和源码。
基线与候选目录只保留被评估的 Dockerfile 差异。不要复制本地环境文件、node_modules 或构建输出。
默认 target 为 `ops-web`、平台为 `linux/arm64`，保留 Bake 的 SBOM 和 Dockerfile 内的制品检查；
镜像与 `mode=max` 缓存只允许导出到显式 `127.0.0.1:<port>` registry，不扫描或发布线上制品。
需要代理时，分别配置 Docker daemon、Buildx 客户端、builder 和构建容器可达的代理地址。

按同一顺序分别测基线与候选：独立 builder 首次构建、相同输入热构建三次、新 builder 加
`--import-cache` 导入 registry 缓存、修改无关应用源码、修改 Ops Web 实际依赖源码。每次使用新的
`--output` 目录；增量实验从相同原始上下文开始。每组串行运行，避免与 lint/test 等重任务争用 CPU。
使用热构建中位数，记录冷启动是否包括镜像拉取与依赖下载；共享已有工具缓存的运行不能称为冷启动。

验证依赖缓存边界时，在临时上下文同时修改实际依赖 manifest 与 lockfile，然后比较同一 builder
重建与新 builder 仅导入基线 registry 缓存的重建。先验证新 builder 的未变更输入能命中安装和编译层，
再检查依赖变更后实际执行的 pnpm reused/downloaded；不要将恢复安装层等同于恢复 cache mount 内的
pnpm store。各组使用独立输出目录，并在需要再次导入基线前避免覆盖其 cache tag。

本地 Ops Web 对照在临时 manifest 和 lockfile 中新增 `is-odd@3.0.1`：已有 builder 的应用依赖安装
观测到 reused=1099、downloaded=2；新 builder 仅导入基线 registry 缓存时为 reused=248、downloaded=853。
后者的 248 个复用包来自同次构建先执行的根依赖安装，该步骤本身 reused=0、downloaded=248。
未改依赖的新 builder 实测中，安装与编译 RUN 可以整体命中 layer cache。上述结果分别验证了层缓存
和同一 builder 的 pnpm store 收益，不表示 registry 导出保存了 cache mount，也不作为 CI 提速百分比。

输出包含 `buildkit.jsonl`、`metadata.json`、`report.json`。`report.json` 的 `buildkit` 字段复用正式
发布的解析结构，包含 operations、cacheExport、cacheWarnings 与 incomplete；保留各操作的时间区间、
状态及 pnpm 包进度。不能将重叠阶段相加作为总耗时。`cacheBytes` 是缓存 manifest 引用的压缩层总大小，
不是本次上传字节数；本地 registry 传输和 ARM 模拟运行也不能当作 GHCR、原生 ARM runner 的耗时。
只有制品通过、缓存体积下降且热构建和增量路径无退化时，才保留候选 Dockerfile 优化。

实验结束后只删除本次创建的 builder 与 registry：

```bash
docker buildx rm ci-image-measure
docker rm -f ci-image-registry
```

## 本地 CI 缓存测量

使用实际 `buildImages` 入口、独立 builder 和回环 registry 验证 build-only。Docker Desktop x86_64
模拟 ARM64 的 Ops Web 冷构建为 643.3 秒，包含依赖下载和制品检查。相同输入在全新 builder 上只读
导入 registry 缓存后为 86.2 秒，两段安装与编译 RUN 均为 cached；无缓存导出。种子缓存保持 mode=max，
manifest 引用约 667 MB 压缩层；本机准备该缓存的导出耗时约 758 秒，不属于 PR build-only 路径。
另一全新 builder 仅修改 Ops Web 实际源码后为 442.8 秒：两段安装继续 cached，编译与部署包 RUN
重新执行 163.0 秒并通过制品检查，未写回缓存。上述本地模拟和回环传输数值不能预测原生 ARM runner
与 GHCR 的实际耗时；尚未通过线上 PR 令牌验证私有 GHCR 拉取权限。

小型临时 Dockerfile 单独验证了缺失缓存仍可完成冷构建，以及命令退出 23 时 summary 保留失败原因和之前的操作；这些故障实验不作为
Ops Web 的性能样本。两条路径都没有镜像推送或缓存导出。

本地 pnpm 11.20.0 测量复用 PR #438 的 affected package 集合，在每轮新的源码目录（无 node_modules）
执行 root/contracts 与 affected 两段 frozen install；store 由 `PNPM_CONFIG_STORE_DIR` 指定。

| 场景 | root / affected（秒） | 解压 / 压缩（秒） | 合计（秒） |
| --- | --- | --- | ---: |
| 空 store | 6.4 / 226.2 | — / 77.6 | 310.3 |
| 原 store 热运行，三次 | 4.9 / 11.6；9.1 / 9.5；4.0 / 9.6 | — | 16.4；18.5；13.6 |
| 完整归档恢复到新 store，三次 | 28.4 / 32.5；7.7 / 18.6；27.6 / 28.6 | 220.1 / 20.1；12.5 / 2.4；171.9 / 37.5 | 301.2；41.2；265.5 |
| 仅根依赖归档恢复 | 23.0 / 157.0 | 61.4 / — | 241.4 |

完整归档约 276 MB；完整恢复后的两段安装分别 reused=249/850、downloaded=0/0。部分恢复后第二段
正常补下 850 个包。恢复样本的合计包含再次压缩；Actions 精确命中时跳过保存。测量期间本机出现很高
的磁盘 I/O 等待，解压样本波动明显；这些数值证明复用行为，不能作为 Actions 网络传输后的净收益。

已有 Nix store 上首次/随后三次 shell 进入耗时（秒）：ci-core 9.14/1.02/0.74/0.89，
ci-light 1.64/0.15/0.17/1.39，ci-release 0.81/0.11/0.10/0.68，ci-format 0.85/0.13/0.07/0.50。
未清理 Nix store，也未新增 Nix 或 uv 缓存；这些结果不表示新 runner 的环境下载成本。

## 报告

PR 或最终交接应写明改动范围和实际执行的关键检查及结果；只有未执行的检查会改变当前完成判断时才说明。
不重复枚举无关下游流程，也不得把未执行的检查描述为已经通过。
