---
doc_type: reference
truth_scope: ops
owner_boundary: docs/environment
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
- `../runbooks/execution-control-staging-operations.md`
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
- `execution-control`
- `worker-staging`
- `worker-staging-app-api`
- `worker-staging-campus-web`
- `worker-staging-operator-console-web`

### Execution Control runtime gate

`execution-control` doctor surface now checks execution runtime inputs separately
from Worker staging:

- shared LLM provider resolution
- supervisor / agent prompt model selection
- bridge base URL / shared secret
- prompt HTTP timeout and connection-pool tuning keys
- async audit queue capacity
- answer admission and worker-thread tuning keys

Conditional readiness:

- if runtime profile `execution_audit.enabled=true`, doctor requires
  `EXECUTION_CONTROL_EXECUTION_AUDIT_URL` and
  `EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET`
- if runtime profile `open_capabilities` opens `campus_services` or `notice`,
  doctor requires `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET` and
  `CAMPUS_SHARED_POSTGRES_URL`; notice-open additionally requires notice
  read-model/object-store runtime dependencies

Runtime `/readyz` is stricter than liveness:

- `200 ready` means provider-config resolver admitted, audit writer healthy,
  and answer admission not currently saturated
- `503 degraded` means at least one execution runtime component is not ready
- outside the `local` runtime profile, execution-control full `/readyz` requires
  internal worker auth and must not be used as an unauthenticated public deploy
  probe; public staging closure should use `app-api /readyz`, which performs the
  supervisor readiness probe with the configured shared secret
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
- `apps/app-api` optional machine / ops ingress -> `<https://api-staging.mucwiki-edge.link`>
- `apps/campus-web` -> `<https://campus-staging.mucwiki-edge.link`>，承载 student
  Q&A、account、docs、map、dining 与 feedback
- `apps/operator-console-web` -> `<https://operator-console-staging.mucwiki-edge.link`>
- `apps/public-docs` 已删除；docs staging browser surface 由 `apps/campus-web`
  `/docs/*` 承担

固定要求：

- 不再把 `ayafeed.com` 或 `*.rag.ayafeed.com` 视为 campus-agent staging deploy truth
- `mucwiki-edge.link` 是当前 repo-owned staging zone
- `apps/execution-control` 的当前 staging deploy substrate 是 Docker-first internal
  execution service；production target deploy substrate 已由 ADR-0056 收口为
  Kubernetes + KEDA
- `apps/execution-control` staging hostname 继续不冻结；`app-api` deploy 时必须显式注入
  `STAGING_EXECUTION_CONTROL_BASE_URL`
- campus-web / Operator Console 的 app-api upstream invariant 是 `APP_API` Service
  Binding + `https://app-api.internal`
- deploy secret truth 继续留在 Cloudflare secret store，不写回 repo-tracked
  `.dev.vars.example`
- Qdrant staging data-plane 是 self-hosted authenticated private service；
  `QDRANT_API_KEY` / `QDRANT_READ_ONLY_API_KEY` 缺失必须 fail closed。canonical
  self-host runtime 由 lifecycle 投影内网 `http://qdrant:6333` 与 read-only
  `QDRANT_QUERY_API_KEY`；只有外接 / 非 canonical Qdrant endpoint 才要求 HTTPS URL 与
  `QDRANT_TLS_CA_CERT_PATH`。不能通过删除 API key 消除 data-plane hardening gap。

## Staging Deploy Rules

- 三个 Worker 的 canonical `pnpm deploy:staging` 都先执行 `deploy:preflight:staging`
- `apps/campus-web` 与 `apps/operator-console-web` 通过 `CLOUDFLARE_ENV=staging
  vite build` 选择 deploy env
- deploy-side `SENTRY_RELEASE` 属于 deploy-time concern，不写回 static vars
- `apps/operator-console-web` staging deploy 必须显式注入：
  - `STAGING_ACCESS_TEAM_DOMAIN`
  - `STAGING_ACCESS_POLICY_AUD`

## Eval Env Contract

默认规则：

- eval / local command 优先复用 env-defined shared provider：
  - `LLM_*`
  - `EMBEDDING_*`
- 只有在 eval 需要独立 provider、预算或限流时，才使用：
  - `EVAL_LLM_*`
  - `EVAL_EMBEDDING_*`

online answer serving 不再以 `LLM_*` / `EMBEDDING_*` env 为 provider/model/API
key truth；它消费 app-api provider-config active profiles。eval env contract 只描述
eval / local automation。

eval 链路长期只保留 provider endpoint/key env：

- `EVAL_LLM_BASE_URL`
- `EVAL_LLM_API_KEY`
- `EVAL_EMBEDDING_BASE_URL`
- `EVAL_EMBEDDING_API_KEY`

固定要求：

- eval model、transport、reasoning 与 token 配置由
  `packages/evals/fixtures/ops/eval_runtime_profiles.v1.json` 持有
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

- `docs/runbooks/execution-control-staging-operations.md`
- `docs/runbooks/provider-secret-governance.md`
- `docs/runbooks/worker-observability-smoke-runbook.md`
