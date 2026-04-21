---
doc_type: reference
status: active
created: 2026-03-31
updated: 2026-03-31
---

# Testing And Verification Lanes

## 文档边界

这份文档只固定当前仓库的验证入口语义，不重复：

- 长期架构边界：`docs/architecture/target-architecture.md`
- `app-api` Worker 形态：`docs/architecture/product-runtime-architecture.md`
- 当前 phase 状态：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`

## 仓库级 lane

### Repo Lint Lane

命令：

```bash
pnpm web:lint
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
```

语义：

- 这是仓库级静态规范检查入口，不替代 typecheck、test 或 build
- JS/TS 侧使用 Biome，统一从 repo root 扫描 `apps/`、`packages/`、`scripts/`、`tests/` 与 root config 文件
- Python 侧使用 Ruff，同时承担 import 排序与格式检查
- 生成物、vendor 和 planning/runtime 噪音目录不进入默认 lint 面

### Python Baseline

命令：

```bash
uv run --all-packages python -m unittest discover -s tests -t .
```

语义：

- 这是仓库级 Python 基线验证入口
- Python 侧继续独立运行在 `uv` / `unittest` 链路，不并入 `pnpm` / `vitest`

### JS/TS Stable Gate

命令：

```bash
pnpm web:typecheck
pnpm web:test
pnpm web:build
```

语义：

- 这是仓库级 JS/TS 默认稳定门禁
- `pnpm web:test` 表示各 app 的默认稳定测试 lane，不等于“所有可能的 JS/TS 测试”
- 当前它包含：
  - `apps/app-api` 的 `test:node`
  - `apps/public-chat-web` 的 `test:worker`
  - `apps/protected-panel-web` 的 `test:worker`

### JS/TS Worker Lane

命令：

```bash
pnpm web:test:worker
```

语义：

- 这是显式 Worker runtime lane
- 用于补跑 Worker shell、route admission、runtime readiness 与绑定契约
- 当前它覆盖：
  - `apps/app-api` 的 `test:worker`
  - `apps/public-chat-web` 的 `test:worker`
  - `apps/protected-panel-web` 的 `test:worker`

### JS/TS Integration Lane

命令：

```bash
pnpm web:test:integration
```

语义：

- 这是显式外部依赖 integration lane
- 当前仅映射到 `apps/app-api` 的 `test:shared-db-integration`
- 它不属于默认 `pnpm web:test` 门禁
- 该 lane 会显式检查 shared DB bootstrap / adoption 是否仍与 repo-owned snapshot 收敛；如果连接到的 shared DB 已漂移，会 fail-close
- 当前 repo 的 repair 入口是 `pnpm --dir apps/app-api db:reconcile-shared-drift -- --json`

## app-api lane 语义

`apps/app-api` 同时承载 Node 业务逻辑测试与 Worker runtime 测试，因此 lane 明确拆分：

- `pnpm --dir apps/app-api test`
  - 默认稳定 gate，等价于 `pnpm --dir apps/app-api test:node`
- `pnpm --dir apps/app-api test:all`
  - app-owned 聚合入口，统一运行本地非 DB Vitest projects（`node` + `worker`）
- `pnpm --dir apps/app-api test:worker`
  - 显式 Worker runtime lane
- `pnpm --dir apps/app-api test:shared-db-integration`
  - 显式 shared Postgres / Better Auth integration lane

对应配置文件：

- `apps/app-api/vitest.config.mts`
  - Vitest projects 编排入口
- `apps/app-api/vitest.node.config.mts`
  - Node 默认稳定 lane
- `apps/app-api/vitest.worker.config.mts`
  - Worker runtime lane
- `apps/app-api/vitest.shared-db.config.mts`
  - shared DB integration lane

## 单一 Worker app 语义

`apps/public-chat-web` 与 `apps/protected-panel-web` 当前都只有单一 Worker test lane，因此：

- `pnpm --dir apps/public-chat-web test` 等价于 `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/protected-panel-web test` 等价于 `pnpm --dir apps/protected-panel-web test:worker`

## 当前约束

- 不要把 Node、Worker、Python 合并成一套单 runtime 测试链路
- 不要把显式 integration lane 混入默认稳定 gate
- 仓库级 JS/TS 验证优先走 repo root `pnpm` + `turbo` 入口；app-local 命令只用于聚焦单 app
- Worker lane 在某些受限环境中可能需要允许本地监听端口
