---
doc_type: reference
status: active
created: 2026-04-20
updated: 2026-04-23
---
# Deploy And Eval Readiness

## 文档边界

本文只负责 deploy-side readiness gate 与 eval env contract。

它回答的是：

- 当前 repo 支持哪些 readiness surface
- staging deploy 应满足哪些 env / secret / hostname contract
- eval 何时复用 shared provider，何时使用独立 override

它不负责：

- provider / secret 获取方式
- 具体 deploy/runbook 步骤

相关文档：

- `README.md`
- `provider-and-secret-inventory.md`
- `../runbooks/staging-worker-deploy-runbook.md`
- `../runbooks/provider-secret-governance.md`

## Readiness Gates

### Shared doctor gate

```bash
uv run --all-packages python -m scripts.doctor_env <surface> --json
```

当前支持的 surface：

- `query`
- `ingestion`
- `evals`
- `supervisor-api`
- `worker-staging`
- `worker-staging-app-api`
- `worker-staging-public-chat-web`
- `worker-staging-protected-panel-web`

### Supervisor API runtime gate

`supervisor-api` doctor surface now checks execution runtime inputs separately
from Worker staging:

- shared LLM provider resolution
- supervisor / agent prompt model selection
- bridge base URL / shared secret
- prompt HTTP timeout and connection-pool tuning keys
- async audit queue capacity
- answer admission and worker-thread tuning keys

Conditional readiness:

- if `SUPERVISOR_API_EXECUTION_AUDIT_ENABLED=true`, doctor requires
  `SUPERVISOR_API_EXECUTION_AUDIT_URL` and
  `SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET`
- if `SUPERVISOR_API_OPEN_CAPABILITIES` opens `campus_services` or `notice`,
  doctor requires `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET` and
  `CAMPUS_SHARED_POSTGRES_URL`; notice-open additionally requires notice read-model/object-store
  runtime dependencies

Runtime `/readyz` is stricter than liveness:

- `200 ready` means prompt runtime admitted, prompt HTTP pool configured,
  audit writer healthy, and answer admission not currently saturated
- `503 degraded` means at least one execution runtime component is not ready
- `/readyz` is still not a full deploy closure; deploy readiness also depends
  on config truth, smoke, and evidence artifacts

### Cloudflare secret presence

```bash
uv run --all-packages python -m scripts.check_worker_secret_presence --env \
  staging --json
```

固定解释：

- `worker-staging` 不直接读取 Cloudflare secret store
- 发布前先过 `check_worker_secret_presence`
- publish 时再由各 app `wrangler.toml` 的 `secrets.required` 做 fail-fast

## Staging Deploy Contract

当前 staging hostname mapping 固定为：

- `apps/app-api` -> Worker `app-api-staging`，web surfaces 通过 `APP_API` Service
  Binding 调用
- `apps/app-api` optional machine / ops ingress -> `<https://campus-api-staging.ayafeed.com`>
- `apps/public-chat-web` -> `<https://campus-chat-staging.ayafeed.com`>
- `apps/public-docs` -> `<https://campus-docs-staging.ayafeed.com`>
- `apps/protected-panel-web` -> `<https://campus-panel-staging.ayafeed.com`>

固定要求：

- 不再把 `*.rag.ayafeed.com` 视为 staging deploy truth
- `ayafeed.com` 是共享 zone，generic 一级子域不能假定为本 repo 占用
- `apps/supervisor-api` 的 deploy substrate 已冻结为 Docker-first internal execution
  service
- `apps/supervisor-api` staging hostname 继续不冻结；`app-api` deploy 时必须显式注入
  `STAGING_SUPERVISOR_API_BASE_URL`
- public chat / docs / panel 的 app-api upstream invariant 是 `APP_API` Service
  Binding + `https://app-api.internal`
- deploy secret truth 继续留在 Cloudflare secret store，不写回 repo-tracked
  `.dev.vars.example`

## Staging Deploy Rules

- 三个 Worker 的 canonical `pnpm deploy:staging` 都先执行 `deploy:preflight:staging`
- `apps/public-chat-web` 与 `apps/protected-panel-web` 通过 `CLOUDFLARE_ENV=staging
  vite build` 选择 deploy env
- deploy-side `SENTRY_RELEASE` 属于 deploy-time concern，不写回 static vars
- `apps/protected-panel-web` staging deploy 必须显式注入：
  - `STAGING_ACCESS_TEAM_DOMAIN`
  - `STAGING_ACCESS_POLICY_AUD`

## Eval Env Contract

默认规则：

- eval 优先复用 shared provider：
  - `LLM_*`
  - `EMBEDDING_*`
- 只有在 eval 需要独立 provider、预算或限流时，才使用：
  - `EVAL_LLM_*`
  - `EVAL_EMBEDDING_*`

长期保留的 eval 链路键包括：

- `EVAL_RAGAS_MODEL`
- `EVAL_JUDGE_MODEL`
- `EVAL_LLM_TRANSPORT`
- `EVAL_RAGAS_LLM_TRANSPORT`
- `EVAL_JUDGE_LLM_TRANSPORT`

固定要求：

- eval transport 允许值固定为 `responses` 或 `chat_completions`
- 临时脚本 / REPL 不自动 bootstrap `.env`
- 需要确认 eval surface 实际可见性时，优先使用：

```bash
uv run --all-packages python -m scripts.doctor_env evals --json
```

- repo-owned shared automation doctor 入口：

```bash
uv run --all-packages python -m scripts.eval_gate doctor --json
```

## Related Runbooks

- `docs/runbooks/staging-worker-deploy-runbook.md`
- `docs/runbooks/provider-secret-governance.md`
- `docs/runbooks/worker-observability-smoke-runbook.md`
