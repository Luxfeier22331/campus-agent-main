---
doc_type: reference
truth_scope: ops
owner_boundary: docs/environment
status: active
created: 2026-04-20
updated: 2026-06-28
---
# Readiness

## 文档边界

本文只负责 repo 环境层的 readiness 语义。

它回答的是：

- 当前 repo 支持哪些 environment / runtime readiness surface
- `healthz`、`readyz`、doctor gate 与 release closeout 的边界
- eval provider env 如何进入 readiness 检查

它不负责：

- provider / secret 获取方式
- 具体 deploy/runbook 步骤
- staging hostname、Worker route 或 release evidence

相关文档：

- `README.md`
- `providers.md`
- `../runbooks/execution-ops.md`
- `../architecture/system/runtime-release.md`
- `../reference/testing-and-verification-lanes.md`
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
- execution / agent prompt model selection
- execution-control base URL / shared secret
- prompt HTTP timeout and connection-pool tuning keys
- async audit queue capacity
- answer admission and worker-thread tuning keys

Conditional readiness:

- if runtime profile `execution_audit.enabled=true`, doctor requires
  `EXECUTION_CONTROL_EXECUTION_AUDIT_URL` and
  `EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET`
- if runtime profile `open_tools` opens concrete campus-services or notice tools,
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
  execution-control readiness probe with the configured shared secret
- `/readyz` is still not a full deploy closure; deploy readiness also depends
  on config truth, smoke, and evidence artifacts

### App API product readiness

`app-api /readyz` is the public product-side readiness aggregation point for
Worker staging. It may project execution-control readiness, but browser products
must still enter through `campus-web` / Operator Console surfaces.

Fixed interpretation:

- `/healthz` means the process or Worker surface is alive enough to answer.
- `/readyz` means required runtime dependencies for that surface are ready.
- `app-api /readyz` may expose sanitized dependency state such as
  `executionControl` and `executionRuntime`.
- `execution-control /readyz` is a trusted machine probe outside local profiles;
  it is not a public browser readiness endpoint.
- Docs reader readiness uses `GET /api/docs/readyz`; it does not imply chat,
  execution-control or operator surface readiness.

### Cloudflare secret presence

```bash
uv run --all-packages python -m scripts.check_worker_secret_presence --env \
  staging --json
```

固定解释：

- `worker-staging` 不直接读取 Cloudflare secret store
- 发布前先过 `check_worker_secret_presence`
- publish 时再由各 app `wrangler.toml` 的 `secrets.required` 做 fail-fast

## Release Boundary

Readiness is a necessary gate, not release completion.

固定规则：

- staging hostname、Worker route 与 release identity 由
  `docs/architecture/system/runtime-release.md` 冻结。
- executable release closeout 由 `docs/runbooks/e2e-qa-release.md` 承接。
- `readyz = 200` 不等于 deploy closeout；还必须有 config truth、smoke 和
  evidence artifact。
- 跳过 Access / auth / readyz 或用 fallback 把 readiness 标绿都无效。

## Eval Env Contract

默认规则：

- eval provider endpoint/key truth 来自本地
  `provider_config_projection.v1` artifact。
- artifact 由 app-api provider-config active profiles 显式同步生成；eval runtime
  不在热路径调用 app-api。
- 必需角色：`eval_ragas_llm`、`eval_ragas_embedding`、`eval_judge_llm`。
- `LLM_*`、`EMBEDDING_*`、`EVAL_LLM_*`、`EVAL_EMBEDDING_*` 不再是 eval
  provider fallback。

固定要求：

- `CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH` 指向 0600 的 provider projection artifact。
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

- `docs/runbooks/execution-ops.md`
- `docs/runbooks/e2e-qa-release.md`
- `docs/runbooks/provider-secret-governance.md`
- `docs/runbooks/worker-observability-smoke.md`
