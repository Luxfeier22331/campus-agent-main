# Contributing

`campus-agent` 进入多人协作后，默认按“共享真相收口到文档，执行现场收口到 worktree”来工作。

## 开始前先读

- `AGENTS.md`
- `README.md`
- `docs/README.md`
- `docs/architecture/product-positioning.md`
- `docs/architecture/current-architecture.md`
- `.planning/PROJECT.md`

只有在你需要接手当前 worktree 的执行现场、恢复上一个协作者的上下文时，再读 `.planning/WORKSTREAMS.md` 和对应 `.planning/workstreams/<slug>/STATE.md`。

## 分支与合流

- 默认流程：`feature/worktree -> develop -> main`
- `develop` 是长期集成分支，`main` 是稳定发布分支
- 尚未合回 `develop` 的实现只能描述为 worktree-local progress，不能冒充 merged truth
- 改动长期边界、contract 或 serving surface 时，同时更新对应 `docs/architecture/`、`docs/decisions/`、`docs/contracts/`、`docs/data/`

## Workstream Claim Workflow

多人并发时，不再靠口头约定或把“谁在做什么”写回 tracked planning 文档；默认使用 repo-owned claim workflow。

开始前先在本机配置稳定 operator id：

```bash
uv run --all-packages python -m scripts.workstream_claim operator set <operator_id>
```

正常执行入口固定为 wrapper-managed session：

```bash
uv run --all-packages python -m scripts.workstream_claim session shell <workstream-slug>
uv run --all-packages python -m scripts.workstream_claim session start <workstream-slug> -- <cmd...>
```

补充说明：

- `session shell` / `session start` 会自动执行 `claim -> heartbeat -> child process -> release`
- 当前会话上下文可用 `uv run --all-packages python -m scripts.workstream_claim session current` 查看
- 交接、接受交接、强制接管与诊断分别使用 `claim handoff`、`claim accept`、`claim takeover`、`claim doctor`
- tracked planning truth 继续留在 `.planning/WORKSTREAMS.md` 与 `.planning/workstreams/<slug>/`
- 运行时 claim/operator/session 状态只落到 gitignored 的 `.planning/runtime/`

完整命令与恢复流程见 `docs/runbooks/workstream-claim-workflow.md`。

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
- `.planning/workstreams/<slug>/STATE.md` 记录单条 workstream 的 `now / next / blockers / continuity`
- `.planning/runtime/` 只保存 gitignored 的本地 operator 配置、claim lease、claim history 与 session pointer 辅助状态
- `docs/plans/` 记录仍有前向指导价值的计划，不承担 merged truth

如果你在改这些内容：

- 架构边界：更新 `docs/architecture/` 和必要的 ADR
- HTTP/runtime seam：更新 `docs/contracts/`
- schema/read-model ownership：更新 `docs/data/`
- 可重复操作步骤：更新 `docs/runbooks/`

## Pull Request 约束

- PR 描述必须明确：改了什么、为什么、影响哪些边界
- 如果改动触及架构或 contract，PR 中要列出同步更新的文档
- 验证命令要写实际跑过的命令，不写“should pass”
- 如果存在 worktree-local 前置条件、未关闭 blocker 或暂未覆盖的 lane，要在 PR 中显式写出
