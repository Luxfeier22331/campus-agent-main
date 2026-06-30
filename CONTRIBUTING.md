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

可选但推荐：

```bash
pre-commit install
```

## 提交前最低验证

先跑与你改动直接相关的聚焦验证，再跑 repo 级最低门禁。

默认最低门禁：

```bash
uv run --all-packages python -m unittest discover -s tests -t .
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:build
```

补充说明：

- `pnpm web:test:integration` 只在触及 `app-api` shared DB / integration lane 时显式执行
- `apps/app-api` 的 `test:shared-db-integration` 不是默认稳定 gate
- 局部 Python 验证继续优先使用 `uv run --all-packages python -m unittest ...`
- JS/TS surface 优先使用 repo root `pnpm` + `turbo` 命令，而不是在各 app 手动串行拼命令

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
- PR 模板中的文档更新确认按实际影响多选；“没有改变架构、接口或运行方式”只在无文档同步责任时勾选，
  且不能和其他文档更新项同时勾选
- 如果改动触及架构或 contract，PR 中要列出同步更新的文档
- 验证命令要写实际跑过的命令，不写“should pass”
- 如果存在 worktree-local 前置条件、未关闭 blocker 或暂未覆盖的 lane，要在 PR 中显式写出
