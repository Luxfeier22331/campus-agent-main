# 贡献指南

`campus-agent` 进入多人协作后，默认按“共享真相写入文档，执行现场留在 worktree”来工作。

## 开始前先读

- `AGENTS.md`
- `README.md`
- `docs/README.md`
- `docs/architecture/product.md`
- `docs/architecture/current.md`

## 分支与合流

- 默认流程：`feature/worktree -> PR -> main`
- `main` 是长期集成与稳定主干；production / release 状态通过 release tag
  和 GitHub Environment 控制
- 尚未合回 `main` 的实现只能描述为 worktree-local progress，不能冒充 merged truth
- 改动长期边界、contract 或 serving surface 时，同时更新对应
  `docs/architecture/`、`docs/decisions/`、`docs/contracts/`、`docs/data/`

staging、正式发布和紧急修复步骤见 `docs/runbooks/release.md`。

## 环境准备

```bash
uv sync --all-packages --dev
pnpm install
```

本地提交前 hygiene 统一使用 `pre-commit`，不使用 Husky / lint-staged / lefthook
双轨 hook。`pre-commit` 只承担轻量文件卫生检查，不替代 typecheck、test、build、
runtime smoke 或 release closeout validation。当前 hook 包含 Gitleaks staged secret scan。

```bash
pre-commit install
```

## 提交前最低验证

先跑与你改动直接相关的聚焦验证，再跑 repo 级最低门禁。

默认 public clone 最低门禁：

```bash
pnpm ci:repo
pnpm ci:rust
pnpm ci:contracts
pnpm ci:eval
pnpm ci:typescript
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
```

补充说明：

- `pnpm web:build` 是 full build lane；构建 campus-web docs surface 时需要已有 docs
  read-model sync manifest，或可访问 app-api operator database 的
  `APP_API_OPERATOR_DATABASE_URL` 等内部配置
- `pnpm ci:typescript` 是 PR 阻塞用的 JS/TS affected typecheck + test lane；
  不包含 `pnpm web:build`
- `pnpm web:test:integration` 只在触及 `app-api` shared DB / integration lane 时显式执行，并且需要
  shared DB / Hyperdrive local connection env
- `apps/app-api` 的 `test:shared-db-integration` 不是默认稳定 gate
- 局部 Python 验证继续优先使用 `uv run --all-packages python -m unittest ...`
- JS/TS surface 优先使用 repo root `pnpm` + `turbo` 命令，而不是在各 app 手动串行拼命令

## 公开来源与数据规则

这个仓库可以公开协作的默认面是代码、schema、validator、文档、synthetic examples 和明确自有的低频
seed。不要把真实学校 source-derived 内容放进 public PR。

提交 fixture、eval sample、source config 或 public asset 时：

- 使用 synthetic 或 self-authored 数据，或者在 owning 文档中写明再分发权利
- 不提交 raw notice、采集 HTML、OCR 输出、canonical docs artifact、真实 qrels / gold truth
- 不提交 secret、private URL、数据库连接串、对象存储 key 或内部运行日志
- 不把 current serving truth、release current pointer 或生产 projection 写进 git
- 触及这些路径时运行所属 package/app 测试，并确认 Gitleaks 与对应数据边界检查通过

长期分类与路径边界见 `docs/policies/public-source-data.md`。

## 文档分工

- 仓库自有的长期人类可读文档正文使用简体中文；GitHub Issue/PR 模板保持仓库既有英文
  格式。路径、命令、代码、字段、状态值和产品正式名称保持原值。详细规则见
  `docs/documentation-architecture.md`。

- 新增或重写文档时，先选成熟文档模式，再选 repo owner class：Diataxis 承接 tutorial /
  how-to / reference / explanation，MADR / Nygard 承接 ADR，OpenAPI / JSON Schema
  承接机器 contract，RFC 2119 / RFC 8174 承接规范性措辞。
- `docs/` 记录共享、可长期引用的真相
- 未合并的计划、待办和执行记录不作为默认分支的长期文档；其中形成的长期事实必须写入
  对应的产品、架构、合同、数据、决策或操作文档
- git history 只用于追溯已删除文档；当前仍需要的结论必须进入所属文档

如果你在改这些内容：

- 架构边界：更新 `docs/architecture/` 和必要的 ADR
- HTTP/runtime seam：更新 `docs/contracts/`
- schema/read-model ownership：更新 `docs/data/`
- 可重复操作步骤：更新 `docs/runbooks/`

## Pull Request 约束

- PR 描述必须明确：改了什么、为什么、影响哪些边界
- PR 标题和正文必须使用具体工程动作，不使用无法单独说明改动内容的抽象词或内部黑话；例如优先写
  “删除旧 handoff 链路”“迁移到 Crawlee”“统一 task contract”“接入 executor”，不要写
  “收口”“治理”“打通”“闭环”“升级能力”这类单独看不出改动内容的词
- 当前 private repo 如无法开启 branch protection / rulesets，合并纪律不变：合并到
  `main` 前必须人工确认 `pr / required` 为 success
- `pr / required` failed、cancelled、missing 或尚未运行时，不合并到
  `main`
- conditional CI job 为 skipped 是允许状态，但 PR 作者和 reviewer 必须确认
  changed-surface 分类与本次改动匹配
- Dependabot PR 按依赖生态运行 `.github/workflows/pr.yml` 选择的 owner lanes；本地至少运行
  `pnpm ci:deps` 与受影响的 Node、Python、Go 或 Rust owner 验证
- 常规 Dependabot 版本更新每月集中处理一次。GitHub Actions minor / patch 更新检查上游
  release、完整 commit SHA 和 owner lane 后 squash；major 更新必须使用人工独立 PR
- GitHub Actions 更新不自动合并，也不让 Dependabot 自动 rebase 反复触发 CI；发生冲突时在
  计划合并前重新创建 PR
- `pnpm ci:config` 直接运行 actionlint 与 zizmor；新增 GitHub Action 时优先使用
  官方维护的 action，将引用固定到完整 commit SHA，并按 zizmor 结果处理权限与引用风险
- PR 的 `static` job 使用固定 manifest digest 的 Gitleaks CLI 镜像扫描本次提交范围；
  不需要 `GITLEAKS_LICENSE`，也不替代 GitHub Secret Protection 或历史泄漏审计
- 当前 private repo 的可信 self-hosted runner 只运行受控分支和 PR。仓库开放 public PR
  前必须把 PR 与 scheduled checks 切换到 GitHub-hosted runner，不能在集群宿主机执行
  fork 提交的代码
- 可信 CI 的 Turbo remote cache 必须配置至少 32 字节的
  `TURBO_REMOTE_CACHE_SIGNATURE_KEY`；cache token 与签名 key 都不得暴露给 fork PR
- CodeQL、Dependency Review 和 artifact attestation 需要先确认 private repo 的 GitHub
  security / supply-chain 功能可用；未确认前，不把这些检查写成无条件 PR blocker
- release image、release bundle 或 deployment 产物类 PR 必须说明是否需要
  artifact attestation / SBOM / SLSA；没有真实发布产物时不生成 provenance 证明
- manual、staging、eval lane 不作为普通 PR 默认阻塞项；只有 release、外部依赖、
  eval、staging 或对应 runtime 变更需要时才在 PR 中列明并执行
- PR 模板中的文档更新确认按实际影响多选；“没有改变架构、接口或运行方式”只在无文档同步责任时勾选，
  且不能和其他文档更新项同时勾选
- 如果改动触及架构或 contract，PR 中要列出同步更新的文档
- 验证命令要写实际跑过的命令，不写“should pass”
- 如果存在 worktree-local 前置条件、未关闭 blocker 或暂未覆盖的 lane，要在 PR 中显式写出

## 许可证与第三方内容

向本仓库提交贡献，即表示你同意该贡献按 Apache License, Version 2.0 授权，除非明确标记为
“Not a Contribution”。

来源和许可证不明时，不得添加第三方源码、网站 capture、dataset、fixture、media、font、
map 或 generated artifact。测试或文档确实需要时，只保留最小内容，并在
`THIRD_PARTY_NOTICES.md` 或所属 data/source 文档中记录来源、许可证和再分发边界。
