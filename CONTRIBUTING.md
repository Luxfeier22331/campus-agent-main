# Contributing

`campus-agent` 进入多人协作后，默认按“共享真相写入文档，执行现场留在 worktree”来工作。

## 开始前先读

- `AGENTS.md`
- `README.md`
- `docs/README.md`
- `docs/architecture/product.md`
- `docs/architecture/current.md`
- `.planning/PROJECT.md`

只有在需要判断当前 backlog signals 或并发 workstream 入口时，再读 `.planning/WORKSTREAMS.md`。
具体执行现场由 GSD SDK / Codex native session 承接，不从 tracked phase 目录恢复。

## 分支与合流

- 默认流程：`feature/worktree -> develop -> main`
- `develop` 是长期集成分支，`main` 是稳定发布分支
- 尚未合回 `develop` 的实现只能描述为 worktree-local progress，不能冒充 merged truth
- 改动长期边界、contract 或 serving surface 时，同时更新对应
  `docs/architecture/`、`docs/decisions/`、`docs/contracts/`、`docs/data/`

## Workstream Workflow

多人并发时，不再靠口头约定或把“谁在做什么”写回 tracked planning 文档。repo 当前使用
GSD SDK 管理 workstream registry / active workstream / progress，执行现场交给 Codex 原生会话。

常用查询和切换入口：

```bash
gsd-sdk query workstream.list --raw --cwd "$PWD"
gsd-sdk query workstream.status <workstream-slug> --raw --cwd "$PWD"
gsd-sdk query workstream.set <workstream-slug> --raw --cwd "$PWD"
gsd-sdk query workstream.progress --raw --cwd "$PWD"
```

创建或完成 workstream：

```bash
gsd-sdk query workstream.create "<name>" --raw --cwd "$PWD"
gsd-sdk query workstream.complete <workstream-slug> --raw --cwd "$PWD"
```

补充说明：

- plain `codex` 用于普通讨论、代码评审、架构辨析、问答和执行，不再进入 repo 自建
  terminal-result contract
- tracked planning truth 只保留 `.planning/PROJECT.md` 与 `.planning/WORKSTREAMS.md`
- 本地会话状态、执行记录和临时上下文不写回 tracked planning 文档
- 需要恢复某条线时，先用 GSD SDK 查询 workstream registry / status / progress，再回到
  对应 docs、ADR、contract、runbook 或 git history 提取 durable facts

完整命令与恢复流程见 `docs/runbooks/workstream-gsd-sdk-workflow.md`。

## 环境准备

```bash
uv sync --all-packages --dev
pnpm install
```

本地提交前 hygiene 统一使用 `pre-commit`，不使用 Husky / lint-staged / lefthook
双轨 hook。`pre-commit` 只承担轻量文件卫生检查，不替代 typecheck、test、build、
runtime smoke 或 release proof。当前 hook 包含 Gitleaks staged secret scan。

```bash
pre-commit install
```

## 提交前最低验证

先跑与你改动直接相关的聚焦验证，再跑 repo 级最低门禁。

默认 public clone 最低门禁：

```bash
uv run --all-packages python -m unittest discover -s tests -t .
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
```

补充说明：

- `pnpm web:build` 是 full build lane；构建 campus-web docs surface 时需要已有 docs
  read-model sync manifest，或可访问 app-api operator database 的
  `APP_API_OPERATOR_DATABASE_URL` 等内部配置
- `pnpm ci:web-graph:affected` 是 PR 阻塞用的 JS/TS affected typecheck + test lane；
  不包含 `pnpm web:build`
- `pnpm web:test:integration` 只在触及 `app-api` shared DB / integration lane 时显式执行，并且需要
  shared DB / Hyperdrive local connection env
- `apps/app-api` 的 `test:shared-db-integration` 不是默认稳定 gate
- 局部 Python 验证继续优先使用 `uv run --all-packages python -m unittest ...`
- JS/TS surface 优先使用 repo root `pnpm` + `turbo` 命令，而不是在各 app 手动串行拼命令

## Public Source / Data Rules

这个仓库可以公开协作的默认面是代码、schema、validator、文档、synthetic examples 和明确自有的低频
seed。不要把真实学校 source-derived 内容放进 public PR。

提交 fixture、eval sample、source config 或 public asset 时：

- 使用 synthetic 或 self-authored 数据，或者在 owning 文档中写明再分发权利
- 不提交 raw notice、采集 HTML、OCR 输出、canonical docs artifact、真实 qrels / gold truth
- 不提交 secret、private URL、数据库连接串、对象存储 key 或内部运行日志
- 不把 current serving truth、release current pointer 或生产 projection 写进 git
- 触及这些路径时运行 `pnpm repo:static`

长期策略见 `docs/policies/public-source-data.md`，当前 tracked data-like artifact 盘点见
`docs/reference/open-source-data.md`。

## 文档与规划分工

- `docs/` 记录共享、可长期引用的真相
- `.planning/PROJECT.md` 记录当前项目级范围与关键决策
- `.planning/WORKSTREAMS.md` 记录 repo 级 active / deferred / backlog workstream 总览
- GSD SDK / Codex native session 记录 live workstream/session state
- git history 只用于追溯已删除 planning archive；需要的结论必须提升到当前 owner 文档
- 不恢复 `.planning/workstreams`、`.planning/quick`、`.planning/milestones`、
  `docs/plans` 或 repo-owned terminal-result / heartbeat / hook harness

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
  `develop` 前必须人工确认 `pr-checks / required-checks` 为 success
- `pr-checks / required-checks` failed、cancelled、missing 或尚未运行时，不合并到
  `develop`
- conditional CI job 为 skipped 是允许状态，但 PR 作者和 reviewer 必须确认
  changed-surface 分类与本次改动匹配
- Dependabot PR 按依赖面跑对应验证：GitHub Actions 依赖运行 `pnpm ci:config:lint`，
  npm / pnpm workspace 依赖运行 `pnpm ci:web-graph:affected`，Go module 依赖运行
  `pnpm ci:go`；依赖风险较高或 lockfile 大幅变更时，额外运行 `pnpm ci:deps:vuln`
- `pnpm ci:config:lint` 包含 actionlint、repo-owned workflow contract check 和
  workflow action policy check；新增未信任 GitHub Action 时，优先 pin 到 full commit SHA，
  或在 policy 中加入 allowlist 并说明原因
- `pnpm ci:secrets` 是 PR 默认 secret scan；本地需要 `gitleaks` CLI，缺失时会输出固定版本安装命令；
  它不替代 GitHub Secret Protection 或历史泄漏审计
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

## License and Third-Party Content

By intentionally submitting a contribution to this repository, you agree that
your contribution is licensed under the Apache License, Version 2.0 unless you
explicitly mark it as "Not a Contribution".

Do not add third-party source code, website captures, datasets, fixtures, media,
fonts, maps or generated artifacts unless their source and license are known.
When such material is necessary for tests or documentation, keep it minimal and
update `THIRD_PARTY_NOTICES.md` or the owning data/source documentation with the
source, license and redistribution boundary.
