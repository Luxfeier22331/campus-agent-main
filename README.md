# campus-agent v2

校园助理系统 v2 的入口 monorepo。

## 默认入口

先读这些文件：

- `AGENTS.md`
- `CONTRIBUTING.md`
- `docs/README.md`
- `docs/architecture/product-positioning.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `.planning/PROJECT.md`

如果你是在接手当前 worktree 的执行上下文，再补读：

- `.planning/STATE.md`

## 文档分工

- `docs/architecture/`、`docs/decisions/`
  - 当前接受架构、长期边界与 ADR 真相
- `docs/contracts/`、`docs/data/`、`docs/reference/`
  - 稳定 contract、schema、术语、指标与实现参考真相
- `docs/runbooks/`
  - 可重复操作步骤、部署与验收手册
- `docs/plans/`
  - 仍对前向实施有指导价值的计划文档，不承担当前 merged truth
- `.planning/`
  - 项目级 planning truth 与 worktree-local 执行上下文；其中 `.planning/STATE.md` 只代表当前 worktree

## 当前 merged truth

- 当前主链路是 `app-api -> supervisor-api -> supervisor-core -> specialist -> retrieval-core`
- 当前前向产品拓扑是 `public-chat-web -> app-api -> supervisor-api` 与 `protected-panel-web -> app-api -> request projection / operator read model`
- 当前 query-enabled surface 是 `regulations/student_handbook` 与 `curriculum/curriculum_plan`
- `apps/app-api` 是唯一 product-layer auth/session/principal owner；`apps/supervisor-api` 只做 internal execution admission
- `official_web` control plane 已收口在 shared `apps/app-api`
- 独立 worktree 中尚未回 `develop` 的进度，不得冒充 merged truth

## 仓库范围

- `apps/authenticated-notice-collector`
  - authenticated notice source bootstrap / collector runtime
- `apps/public-chat-web`
  - public-facing Worker web surface
- `apps/protected-panel-web`
  - protected Worker web surface
- `apps/app-api`
  - shared Worker-native product/control-plane backend
- `apps/supervisor-api`
  - execution engine boundary
- `apps/ingestion-worker`
  - ingestion runtime shell
- `apps/official-web-collector`
  - official web collector runtime
- `packages/availability-specialist`
  - allowlisted external reachability / availability specialist
- `packages/navigation-specialist`
  - campus place-finding / navigation specialist
- `packages/official-web-core`
  - official web domain helpers shared by collector/runtime paths
- `packages/supervisor-core`
  - top-level orchestration、routing、response finalization
- `packages/rag-specialist`
  - knowledge specialist entry
- `packages/retrieval-core`
  - retrieval abstraction 与 evidence shaping
- `packages/ingestion-core`
  - ingestion/data-plane consumption logic
- `packages/contracts`
  - supervisor/specialist shared typed seam
- `packages/evals`
  - regression、benchmark 与 smoke/eval entry
- `packages/shared`
  - 轻量共享常量与工具

## 多人协作入口

- 协作规则与分支模型：`CONTRIBUTING.md`
- 文档导航：`docs/README.md`
- develop/main 发布流程：`docs/runbooks/develop-main-release-runbook.md`

## 验证

默认验证入口：

```bash
uv sync --all-packages --dev
uv run --all-packages python -m unittest discover -s tests -t .
pnpm install
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:test:integration
pnpm web:build
```

更细的 lane、运行术语与 smoke 路径见：

- `docs/reference/testing-and-verification-lanes.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/runbooks/forward-worker-surface-smoke-runbook.md`
