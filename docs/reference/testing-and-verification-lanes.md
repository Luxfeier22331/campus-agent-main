---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-03-31
updated: 2026-04-26
---
# Testing And Verification Lanes

## 文档边界

这份文档只固定当前仓库的验证入口语义，不重复：

- 长期架构边界：`docs/architecture/target-architecture.md`
- `app-api` Worker 形态：`docs/architecture/system/product-runtime-architecture.md`
- 当前 phase 状态：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与对应 workstream
  `STATE.md`

## 仓库级 lane

### Repo Lint Lane

命令：

```bash
pnpm web:lint
pnpm docs:lint
pnpm public-docs:lint
pnpm coverage:lint
pnpm java:lint
pnpm editorconfig:lint
pnpm env:lint
pnpm html:lint
pnpm yaml:lint
pnpm toml:lint
pnpm shell:lint
pnpm xml:lint
pnpm jsonl:lint
pnpm sql:lint
pnpm docker:lint
pnpm lock:lint
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
```

语义：

- 这是仓库级静态规范检查入口，不替代 typecheck、test 或 build
- JS/TS 与 JSON/JSONC config 侧使用 Biome，默认检查当前 worktree live
  files：`apps/`、`packages/`、`configs/`、`scripts/`、`tests/` 下的 tracked +
  untracked 文件，以及 repo-owned root JSON/JSONC config（如
  `package.json`、`turbo.json`、`biome.jsonc`、`.markdownlint-cli2.jsonc`）；默认忽略
  unknown file types
- Markdown 侧通过 repo-owned runner 调用 `markdownlint-cli2`，覆盖当前 worktree 中的 root
  live docs、`.github/pull_request_template.md`、长期 `docs/**` source-of-truth
  文档，以及 `apps/` / `packages/` / `configs/` 的手写 live markdown；默认排除 archive /
  historical plan 文档、vendor、`node_modules`、scratch markdown，以及
  `apps/public-docs/docs/**` 生成文档
- public-docs generated 侧通过 repo-owned checker 覆盖
  `apps/public-docs/docs/**/*.md` 与 `apps/public-docs/docs/**/*.mdx`；该 lane 面向
  canonical / reader projection 产物，允许为表格保真使用 HTML table 与长行，但 fail-close
  检查空文档、frontmatter 结构、Git conflict marker、restricted collection marker 与内部
  locator 泄漏
- `coverage:lint` 继续是 tracked repo baseline 审计，用于确保 repo-owned text-like surface
  都被某个 lint lane 接管；它不扩到未跟踪文件
- Java 侧当前仅覆盖 `apps/legacy-office-conversion-service/src/**/*.java`，通过
  repo-owned Python wrapper 调用 Docker `lint` target，并在容器内执行 `mvn
  spotless:check`；默认检查当前 worktree 文件，不承担 Checkstyle / PMD / SpotBugs 这类更强规则治理
- EditorConfig 侧使用 `editorconfig-checker`，覆盖 repo dotfile
  config（`.editorconfig`、`.gitignore`、`.gitattributes`）；该 lane 通过 repo-owned
  wrapper 检查当前 worktree 中未被其他 lint 入口覆盖的 dotfile surface
- env example 侧使用 repo-owned Python checker，覆盖当前 worktree 的 `*.env.example` 与
  `*.dev.vars.example`，默认排除 `.planning/` 与 `vendor/`；当前要求 `KEY=VALUE` 结构、key
  命名合法且不重复，并禁止 comment / value 尾随空白或 value 前后空白；仍不做跨文件一致性治理
- HTML 侧使用 repo-owned Python checker，对当前 worktree 的 `*.html` 做 `html5lib`
  解析与最小文档结构校验；当前要求存在 `<!doctype html>`、单一 `html/head/body`，以及非空 `<title>`；默认排除
  `.planning/`、临时目录、vendor 与 `node_modules`
- YAML 侧通过 repo-owned runner 调用 `pre-commit` 的 `check-yaml` hook，检查当前 worktree
  YAML files，默认排除 `.planning/`
- TOML 侧使用 repo-owned Python checker，对当前 worktree `*.toml` 做 `tomllib` 结构校验
- shell 侧使用 repo-owned Python checker，对当前 worktree `*.sh` 做 `bash -n` 语法校验
- PowerShell 继续保留为 supplemental lane，不并入默认 `pnpm lint`
- XML 侧使用 repo-owned Python checker，对当前 worktree `*.xml` 做 well-formedness 结构校验
- JSONL 侧使用 repo-owned Python checker，对当前 worktree `*.jsonl` 做逐行 JSON object
  校验，并对 repo 当前已承诺的 sample 形状做最小 schema
  守卫：`provider-result*.jsonl`、`layout-elements*.jsonl`、`*.structured.jsonl`
  必须保留对应核心字段；当前仍不扩成通用 schema 平台
- SQL 侧使用 repo-owned Python wrapper 调用 `sqlfluff parse --dialect postgres`，对当前
  worktree `*.sql` 做可解析性校验；当前不承担 SQL 风格治理
- Dockerfile 侧使用 repo-owned Python wrapper 调用 `hadolint`，覆盖当前 worktree
  Dockerfile surface，并已并入默认 `pnpm lint`
- lock integrity 侧通过 repo-owned checker 校验所有 repo-owned lockfile 真相：
  - `pnpm-lock:lint` 校验 root workspace `pnpm-lock.yaml`，并对当前 worktree app-local
    `pnpm-lock.yaml` 执行隔离 `frozen-lockfile` 校验
  - `uv-lock:lint` 通过 `uv lock --check --offline` 校验 repo root `uv.lock` 是否仍与当前
    Python dependency truth 同步
- app-local `pnpm-lock.yaml` 当前视为 repo-owned truth；若对应 app 的 `package.json`
  变化，lockfile 必须同步刷新
- Python 侧使用 Ruff，同时承担 import 排序与格式检查；当前 repo 默认门禁包含 `W` 与 `B904`
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
- 该 lane 会显式检查 shared DB bootstrap / adoption 是否仍与 repo-owned snapshot 收敛；如果连接到的
  shared DB 已漂移，会 fail-close
- 当前 repo 的 repair 入口是 `pnpm --dir apps/app-api db:reconcile-shared-drift --
  --json`

### E2E QA Release Lane

入口：

```bash
docs/runbooks/e2e-qa-release-runbook.md
```

语义：

- 这是上线前真实 staging 验收 lane，不替代 unit、typecheck、build、lint 或 integration lane
- 它只在真实 staging deployment、真实 auth/session、真实 browser surface、真实 data plane 与真实
  observability sink 均存在时执行
- 当前默认目标环境是 `mucwiki-edge.link` staging；`hub.muc.wiki` production custom-hostname
  path 不属于当前 gate
- 它串联 repo preflight、execution runtime readiness、public surface health、chat E2E、
  docs gated smoke、protected panel Access smoke、browser QA、Sentry/Axiom sink verification
  与 data-plane sanity
- 证据必须落盘到 `var/staging-evidence/<timestamp>-e2e-qa-release/`
- 它不能使用 fallback、兜底、best-effort、silent recovery、`--expect-result-kind any` 或跳过
  Access / auth / readyz 的方式标绿
- Sentry closure 默认查询 Explore `spans`；issue-list endpoint 权限不足不是 staging
  observability blocker

对应 runbook：

- `docs/runbooks/e2e-qa-release-runbook.md`
- `docs/runbooks/templates/e2e-qa-release-artifact-template.md`

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

- `pnpm --dir apps/public-chat-web test` 等价于 `pnpm --dir apps/public-chat-web
  test:worker`
- `pnpm --dir apps/protected-panel-web test` 等价于 `pnpm --dir
  apps/protected-panel-web test:worker`

## 当前约束

- 不要把 Node、Worker、Python 合并成一套单 runtime 测试链路
- 不要把显式 integration lane 混入默认稳定 gate
- 仓库级 JS/TS 验证优先走 repo root `pnpm` + `turbo` 入口；app-local 命令只用于聚焦单 app
- Worker lane 在某些受限环境中可能需要允许本地监听端口
