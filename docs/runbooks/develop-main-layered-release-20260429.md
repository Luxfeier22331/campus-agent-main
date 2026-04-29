---
doc_type: runbook
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Develop Main Layered Release Manifest 2026-04-29

## Boundary

This manifest records the release scope for the isolated branch
`release/main-20260429-layered`.

It answers:

- what has already been applied to the release branch
- why this release must be layered instead of a direct `develop -> main` merge
- how the `origin/develop` backlog is grouped
- which slices are candidates for the next cherry-pick waves

It does not replace [Develop Main Release Runbook](./develop-main-release-runbook.md).

## Current Branch Facts

- Base branch: `origin/main`
- Release branch: `origin/release/main-20260429-layered`
- Release branch current delta over `origin/main`: `3` commits
- Current release branch head: `a2f33226 fix: 收紧 protected panel 路径与外链安全`
- Current `origin/main...origin/develop` divergence: `10 / 796`

`origin/main` contains stable commits that are not in `origin/develop`, so this
release branch keeps `origin/main` as the base and cherry-picks selected
`origin/develop` slices forward.

## Already Applied

| Layer | Commit | Scope | Verification |
|---|---|---|---|
| `L0` | `763058d2` | public chat donor generated-file baseline | `pnpm web:check` passed |
| `L1` | `a2f33226` | protected panel path routing, external-link isolation, and access identity hardening | `pnpm --filter protected-panel-web typecheck`; `pnpm --filter protected-panel-web test`; `pnpm --filter protected-panel-web build`; `XDG_CONFIG_HOME=./.wrangler-home pnpm exec vitest run --config vitest.node.config.mts`; `pnpm web:check` passed |

`L0` resolves the `public-chat-web` donor diff gate by treating
`next-env.d.ts` as a generated Next.js typegen file, not as a required vendor
snapshot path.

`L1` was applied as a semantic backport rather than a raw cherry-pick because
the current `origin/main` protected panel still uses the older monolithic data
provider and worker shell files. The backport keeps the same release intent:
encode path identifiers before same-site calls, use explicit encoded show
routes, reject signed Access assertions without a stable operator identity,
clear poisoned identity-cache failures, remove cursor-table pseudo sorting, and
isolate validated external links from the opener browsing context.

## Why Not Direct Merge

The current `origin/develop` backlog is not a single releasable unit.

Facts from `origin/main..origin/develop`:

| Bucket | Commits Touching Bucket | Exclusive Commits | Files Touched |
|---|---:|---:|---:|
| docs / planning governance | 392 | 40 | 5174 |
| ingestion / notice / data plane | 354 | 79 | 4668 |
| supervisor / app-api | 253 | 43 | 4002 |
| CI / tooling / env | 200 | 15 | 3835 |
| evals | 166 | 17 | 3877 |
| campus services / navigation | 117 | 1 | 3513 |
| public chat | 111 | 11 | 2747 |
| official web | 86 | 2 | 2949 |
| protected panel | 67 | 16 | 1727 |
| public docs | 53 | 19 | 1079 |
| unclassified small commits | 30 | 30 | 60 |

Additional fact: `523 / 796` commits touch more than one bucket. That means a
blind merge would mix product runtime changes, ingestion closeout work, eval
governance, public docs automation, and planning migration into one release.

## Candidate Layers

### L1 Protected Panel Safety And Routing Fixes

Status: applied as `a2f33226`.

Applied scope note: the raw candidate commits were not cleanly cherry-pickable
onto `origin/main`; app-api operator-query expansion and later split-file panel
structure were left out of this layer. `L1` only carries the protected-panel
hardening semantics that fit the current stable `main` topology.

Reasoning:

- user-visible operator surface hardening
- mostly Worker web and app-api operator query boundary
- lower deployment blast radius than ingestion or eval runtime changes
- directly improves stable main without requiring data-plane replay

Candidate commits:

| Commit | Subject |
|---|---|
| `b659008c` | `feat: 收口 operator 面板查询与安全链接` |
| `8e8ac74e` | `fix: 隔离 protected panel 外链 opener 上下文` |
| `b645fcab` | `fix: 清理 protected panel 身份查询失败缓存` |
| `e0e9ce07` | `fix: 拒绝缺少稳定身份的 protected panel access 断言` |
| `f1b5920e` | `fix: 使用编码路由打开 protected panel 详情页` |
| `62177d58` | `fix: 移除 protected panel cursor 表头伪排序` |
| `14fc6e02` | `fix: 编码 protected panel 队列请求跳转路径` |
| `08a9f7ee` | `fix: 编码 protected panel 审计请求跳转路径` |
| `0642b431` | `test: 覆盖 protected panel 请求路由编码` |
| `addefac4` | `fix: 编码 protected panel 审计路径参数` |
| `ea5ecc38` | `fix: 编码 protected panel 详情路径参数` |
| `bee63550` | `test: 覆盖 protected panel 审计路径编码` |
| `94fa46d7` | `test: 覆盖 protected panel official web 路径编码` |
| `d9295267` | `test: 覆盖 protected panel 请求路径编码` |
| `9e013679` | `test: 补充 protected panel cursor 表头回归覆盖` |
| `a6394578` | `test: 覆盖 protected panel 空身份断言拒绝` |

Required verification:

- `pnpm --filter protected-panel-web typecheck`
- `pnpm --filter protected-panel-web test`
- `pnpm --filter protected-panel-web build`
- `pnpm --filter app-api test`
- `pnpm web:check`

Known risk:

- `b659008c` includes app-api operator query contract changes; if conflicts are
  high, split `L1` into `L1a app-api operator query` and `L1b panel routing`.
- `9e013679` also touches planning files from another workstream; cherry-pick
  must keep only the protected-panel regression hunk if needed.

### L2 Public Chat Answer Feedback Truth

Status: candidate after `L1`.

Reasoning:

- feature is product-facing and already discussed as close to done
- includes durable app-api feedback truth and public chat runtime support
- should not be mixed with ingestion/data-plane releases

Candidate commits:

| Commit | Subject |
|---|---|
| `e7d8c8cb` | `docs: 激活 public chat 反馈质量信号 workstream` |
| `2446c26b` | `fix: 收口 public chat 交互闭环` |
| `b9b58f64` | `feat: 添加 public chat 答案反馈写入真相` |
| `6fb30db8` | `fix: 补齐 chat feedback 测试支持` |
| `baa3b864` | `docs: 记录 app-api 答案反馈契约` |
| `ddbeacea` | `test: 简化 chat feedback service mock` |
| `6b8227ce` | `test: 覆盖 app-api feedback schema export` |
| `067a32cc` | `style: 格式化 app-api chat feedback 代码` |
| `37876901` | `docs: 完成 public chat 反馈 Phase 1 收口` |
| `fb5c7f4f` | `docs: 明确 public chat 反馈不接收自由评论` |
| `bf81cd33` | `feat: 添加 public chat 质量反馈与执行观测` |

Required verification:

- `pnpm --filter app-api test`
- `pnpm --filter public-chat-web typecheck`
- `pnpm --filter public-chat-web test`
- `pnpm --filter public-chat-web build`
- `pnpm --filter protected-panel-web test`
- `pnpm web:check`

Known risk:

- `bf81cd33` is broad: app-api migrations, operator query, protected panel,
  public chat, and observability docs. It may need to be split manually instead
  of accepted as one cherry-pick.
- app-api migration ordering must be checked before release.

### L3 Supervisor Execution Observability

Status: defer until `L1` and `L2` are stable.

Candidate commit:

| Commit | Subject |
|---|---|
| `311570a5` | `feat: 补全 supervisor 执行桥接观测` |

Reason to defer:

- touches Go supervisor-api, Python supervisor-agent-worker, contracts,
  campus-services-agent, navigation-agent, notice-agent, retrieval-core, and
  cross-package tests
- requires Python and Go verification lanes, not only Worker web gates

Required verification:

- `uv run --all-packages ruff check .`
- `uv run --all-packages ruff format . --check`
- `uv run --all-packages python -m unittest discover -s tests -t .`
- supervisor-api Go tests
- relevant app-api and web gates if contracts touch public surfaces

### L4 Evals Runtime And Governance

Status: defer.

Reason to defer:

- current develop workspace has additional uncommitted eval changes
- latest eval commits are still actively moving
- release should not mix eval governance with product runtime cherry-picks

Representative recent commits:

| Commit | Subject |
|---|---|
| `1e9bb709` | `feat: 补充 eval 质量校准与 trace 解码` |
| `73b0bdc7` | `feat: 扩展 workflow trace eval 维度` |
| `8d363b3f` | `feat: 扩展 eval 基准治理门禁` |
| `8a1cc1da` | `feat: 添加 eval runtime observation collectors` |
| `5f5bb19c` | `feat: 补齐 eval runtime metrics 字段` |
| `41282ca7` | `feat: 支持 eval collect-runtime profile 参数` |
| `d5fba614` | `feat: 补齐 eval runtime collector helpers` |
| `d592fbeb` | `feat: 支持 eval profile report 发布批次` |

### L5 Ingestion, Notice, Official Web, Public Docs

Status: defer.

Reason to defer:

- large data-plane blast radius
- current develop workspace still contains uncommitted ingestion/public-docs
  work
- some commits are operational evidence or batch replay closeout, not stable
  app runtime release material

Representative recent commits:

| Commit | Subject |
|---|---|
| `db76c5aa` | `feat: 补全 collected notice queue 消费链路` |
| `975ffa8d` | `feat: 完成认证通知 object-native 导入收口` |
| `6feac9da` | `feat: 完成校级官网采集本地收口` |
| `4dd8076a` | `feat: 添加 public docs 滚动发布校验` |
| `b2e7a0a5` | `docs: 规划 public docs 滚动发布 Phase 2` |

## Execution Rules

1. Keep release work in `.worktrees/release-main-20260429-layered`.
2. Cherry-pick one candidate layer at a time.
3. Do not cherry-pick from the dirty local `develop` worktree; use
   `origin/develop` commit ids.
4. After each layer, run the required targeted gates and `pnpm web:check`.
5. If a commit contains unrelated planning/evidence hunks, split the hunk rather
   than accepting unrelated work into `main`.
6. Push `release/main-20260429-layered` after each stable layer.
7. Open a PR to `main` only after the chosen release scope is stable.

## Current Recommendation

Proceed with `L1 Protected Panel Safety And Routing Fixes` first.

Do not start with ingestion, evals, public docs rolling publish, or supervisor
bridge observability. Those are valid workstreams, but they have larger runtime
and verification surfaces and should not define the first `main` release layer.
