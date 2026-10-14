# Agent Note: 工作区脚本与验证入口治理

Status: implemented

## 背景

仓库已审计 30 个 manifest、189 个脚本。根目录、应用、作业和 tooling 的 `check`、`test`、`typecheck`、`build` 语义不一致：部分子包直接执行完整验证，部分入口绕过 Turbo 缓存，验证图通过包名硬编码去重，fixture build 名称也与生产 build 混淆。结果是默认命令难以预测，typecheck 资源和执行范围不透明，CI、hook、发布脚本和文档必须维护多套命令约定。

## 决策

- 根入口负责编排和缓存，子包脚本只执行具体任务；根 `check`、`test`、`typecheck` 默认覆盖全仓库，使用 Turbo 原生 `--filter` 或 `--affected` 选择范围。
- `pnpm test` 覆盖 tooling、Node/DOM、local Worker、Go 和 Inspect unit tests；`pnpm test:tooling` 保留现有七组 tooling 测试；新增 `pnpm check` 与现有 `verify --source` 覆盖一致，`verify --source` 删除。
- 通过现有 `scripts/ci/evidence.mts`、Turbo 图和资源限制实现聚合，不新增第二套 task registry；commandless aggregate 保留在图中，叶任务每次只执行一次。
- 将简单子包 `test` 改为 `test:unit`，Go 使用 `native:vet`，contracts 使用 `contracts:check`，Inspect 使用 `test:eval`，worker/fixture build 使用明确的 `build` 或 `build:fixture` 名称，并原子迁移 CI、hook、发布、Dockerfile、CLI 帮助和文档。
- tooling、notice classifier、internal portal collection 使用各自 owner 的脚本；只抽取真正复杂的多阶段 cleanup/environment 命令，保持 cwd、环境文件、参数和退出码。
- 保留现有 `^source` 传播、运行时 cache key、Go/tooling 串行和内存限制。Campus typecheck 使用 `tsc --noEmit --checkers 1`，收窄到实际导入的 TypeScript、测试、配置、JSON、fixture 和跨包依赖输入，不降低检查覆盖；不启用 TS incremental。

### 入口与迁移

| 原入口 | 当前入口与所有者 |
| --- | --- |
| 根 `test`（仅工具脚本） | 根 `test:tooling`；根 `test` 覆盖全仓单测 |
| 根 `verify --source` | 根 `check`，保留原源码检查覆盖，并纳入既有 notices 类型检查 |
| 根 `verify` | 先完整源码检查，再数据库集成、Infra、OTel 和 Bake 配置检查 |
| 显式 validation profile | `verify --profile=<name>`，可重复，只运行所选 profile |
| 子包可执行 `test` | 简单包 `test:unit`；App API/Campus/Ops 保留现有分组叶任务 |
| 子包聚合测试 | Turbo 无命令 `test`；contracts 的 unit/generators 各执行一次 |
| Ops `check` | 根 `check --filter=ops-web`，构建另用根 `build --filter=ops-web` |
| contracts `check` | contracts `contracts:check` |
| Go `native:typecheck` | Go `native:vet`，实际命令仍为 `go vet ./...` |
| App API/Status `build:worker` | 对应 package `build` |
| Campus `build:test`/`build:worker` | Campus `build:fixture`；PR 使用根 `build:check`，生产 `build`/staging 上传保留 |
| Campus `pretest:e2e:dev:chat` | 由 `test:e2e:dev:chat` 显式准备 fixture |
| 根 notice classify/eval/typecheck | tooling `notice:classify`、`notice:classify:eval`、`typecheck:notices` |
| 根 `notice:classify:job:local` | notice-classifier `classify:local`，Ops 调用方同步迁移 |
| 根 internal-portal 三个转发入口 | internal-portal-collection `auth:check`、`auth:pull`、`collect` |

根 `typecheck`、`test`、`build`、`build:check` 使用原生 filter/affected，不自动添加依赖选择。
`check` 的 filter 只筛包任务；静态、文档、tooling、contracts 和 Actions 保持全仓范围。
dry-run 只输出任务图，框架文件/名称参数交给具体叶任务。根 `test`、`check`、`verify` 在既有
Nix 全量工具链中计算缓存上下文；Node 复用 CPU/内存并发限制，Go 和 tooling 串行。

复杂 build cleanup、开发环境加载和 full E2E 流程移到所属 package 脚本；简单命令仍留 manifest。
通知 eval 命令继续从仓库根解析相对输出路径，Job 的环境文件仍由模块位置定位。

本篇部分取代[源码依赖与分组测试缓存](../testing/2026-09-19-source-and-test-cache-boundaries.md)
中本地可执行聚合 `test` 的决定，以及
[提交前验证与根测试缓存](./2026-09-16-pre-commit-validation.md)中的根命令命名。
两篇的源码依赖、隔离、运行时键、提交范围、缓存与资源边界仍然有效。

合并主线后，PR 与 pre-commit 的 tooling 分组仍由暂存或分支文件选择，执行入口迁移为
`test:tooling --groups=...`，不先运行全量 tooling 再重复所选组。PR 保留主线的类型检查去重与
镜像编译去重：只执行测试叶任务及未由镜像任务承担的 `build:check`；pre-commit 仍执行类型检查。
Campus 的 Docs 声明输入保留在改名后的 `build:fixture` 和 Node 测试中，`build:check` 只依赖
fixture，不回退到需要对象存储的正式构建。主线新增的两个通知 Worker 也使用 `test:unit` 叶任务。

## 未采用方案

- 只在根目录增加兼容别名：不能消除子包语义冲突和绕过缓存的执行路径。
- 在每个子包内再包一层 Turbo：会产生递归聚合和重复调度，破坏当前 executor 的缓存与资源控制。
- 长期保留旧命令兼容别名：会继续扩大接口表面，批准的调用方迁移后直接使用新合同。
- 新建第二套 scheduler/task registry：现有 Turbo、executor 和 evidence graph 已有 owner，重复注册会造成漂移。
- 通过减少 TS 文件、放宽 strict 或关闭测试来缓解资源：会改变既有覆盖合同；资源问题使用 checker 数量、输入边界和已有并发控制处理。

## 后果

实际 Turbo 图与迁移前的 manifest 保持测试叶任务等价且每个任务只出现一次；筛选 Campus
只执行它自己的 Node/DOM/Worker 测试。commandless aggregate 的解析、filtered check 的全仓
静态检查、fail-fast、staged/PR scope、发布 Worker/image 选择与 full E2E 单次构建均由行为检查覆盖。

Campus TypeScript 保留完整 include、strict 和测试覆盖，不启用 TS incremental；实际导入的
`config/*.ts`、JSON、fixture 和跨包源码进入缓存，静态地图资产不触发 typecheck。

Campus fixture、App API、Status、Ops 和三个索引 Job 的七个构建均通过；fixture build 保留本地
环境，生产 Campus build 保持 `cache:false` 并透传原有对象存储配置。Dockerfile 的原有 build
调用名称不变，抽出的 package 所属脚本在既有镜像源码范围内，不引入仓外运行依赖。

根检查覆盖 tooling、Node/TypeScript、Go、Inspect、构建、文档、链接和决策笔记；抽出的开发命令
另由行为测试检查 cwd、环境加载、参数传递和非零退出状态。浏览器套件继续按既定手动入口验证，
不把一次运行结果写成长期通过状态。

个人或外部自动化需要迁移旧命令；不保留兼容别名。重命名后首次 cache miss 属于预期。
