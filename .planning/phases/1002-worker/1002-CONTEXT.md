# Phase 1002: Worker 部署与发布硬化收口 - Context

**Gathered:** 2026-04-14
**Status:** Ready for research and planning
**Source:** Repo truth consolidation + deploy/runbook audit

<domain>
## Phase Boundary

本 phase 只处理当前 accepted Worker product surfaces 的 release-hardening closeout：

- `apps/app-api`
- `apps/public-chat-web`
- `apps/protected-panel-web`

目标是把 staging baseline、deploy-time release identity、config/secret gate、DB freshness gate、Access/operator admission、post-deploy observability evidence 收口成可执行的 release discipline。

本 phase 不处理：

- `authenticated_notice` live portal scheduling 或 control-plane rollout
- `official_web` collector live seam 的独立验收
- production hostname 切换
- `apps/supervisor-api` 的 repo-level runtime 冻结

</domain>

<decisions>
## Implementation Decisions

### Release hardening is a repo-level runtime concern

- `public-chat-web`、`protected-panel-web`、`app-api` 必须共享统一的 release-hardening contract，但继续保持独立 deploy unit。
- staging baseline 固定为 `campus-api-staging.ayafeed.com`、`campus-chat-staging.ayafeed.com`、`campus-panel-staging.ayafeed.com`；这不是临时 smoke 值，而是当前 repo-owned staging truth。

### Release identity must be deploy-time, not static config

- `SENTRY_RELEASE` 不得继续以历史静态值长期留在 repo config 中。
- release identity 必须在 deploy 时生成，并贯通 runtime env、observability 和 evidence artifact。
- 当前已知不对齐点是 `protected-panel-web` 已做 deploy-time release injection，而 `app-api` 与 `public-chat-web` 仍存在静态 release debt。

### Deploy gate must cover data freshness and operator admission

- `APP_API_DB` / `APP_API_DB_FRESH` 双 lane 继续保留；auth/read-after-write-sensitive path 必须走 fresh lane。
- shared Postgres drift reconciliation / migration 是 deploy gate，不是事故后排障动作。
- Access placeholder、operator allowlist miss、stale auth lookup 都属于 release-hardening miss。

### Closure requires post-deploy evidence

- `/readyz = 200` 不是 deploy closeout。
- release closeout 至少需要 `public-chat-web -> app-api` trace、`protected-panel-web -> app-api` trace、`app-api` runtime event evidence，以及按 release 收口的 artifact。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture / planning truth

- `docs/architecture/product-runtime-architecture.md` — 产品/runtime 主拓扑与 app ownership
- `docs/architecture/runtime-delivery-and-release-hardening-architecture.md` — 本 phase 对应的长期 supporting architecture
- `.planning/PROJECT.md` — 当前 active items 与 authenticated-notice / official-web 邻接边界
- `.planning/STATE.md` — 当前暂停/独立 worktree 状态
- `.planning/ROADMAP.md` — Phase 1002 phase record

### Runbooks / environment

- `docs/runbooks/staging-worker-deploy-runbook.md` — staging deploy truth、secret matrix、cross-app invariants
- `docs/runbooks/worker-observability-smoke-runbook.md` — pre/post deploy observability closure
- `docs/runbooks/dev-backed-supervisor-staging-smoke-runbook.md` — dev-backed supervisor staging seam
- `docs/environment/README.md` — env ownership 与 staging baseline

### Runtime files

- `apps/app-api/wrangler.toml`
- `apps/app-api/scripts/deploy-staging.mjs`
- `apps/public-chat-web/wrangler.toml`
- `apps/public-chat-web/package.json`
- `apps/protected-panel-web/wrangler.toml`
- `apps/protected-panel-web/scripts/deploy-staging.mjs`
- `scripts/check_worker_secret_presence.py`
- `scripts/verify-worker-deploy-config.mjs`

</canonical_refs>

<specifics>
## Specific Facts To Preserve

- 当前 repo 已经固定 staging hostname baseline，不再继续使用 `*.rag.ayafeed.com`。
- `protected-panel-web` deploy 脚本已经会 derive `SENTRY_RELEASE=protected-panel-web@staging-<sha>`。
- `app-api` 和 `public-chat-web` 当前仍保留静态 `SENTRY_RELEASE`，这是第一优先级 debt。
- `official_web` collector token 不是当前最小 chat/panel/app-api release hardening 的必填项。

### External best-practice directions to validate during research

- Cloudflare custom domains / subdomain posture
- Cloudflare Access protected application admission
- Sentry release/deployment identity and evidence linkage
- date-sensitive cache / fresh-read lane patterns for auth-sensitive product paths

</specifics>

<deferred>
## Deferred Ideas

- production release automation
- CI/CD provider-specific workflow design
- `official_web` live collector release with the same smoke lane
- `authenticated_notice` live control-plane rollout

</deferred>

---

*Phase: 1002-worker*
*Context gathered: 2026-04-14 via repo truth consolidation + deploy/runbook audit*
