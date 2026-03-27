# campus-supervisor-api

`apps/supervisor-api` 是 `campus-agent` 当前查询主链路的对外 serving boundary。

它负责：

- 外部请求的 transport / auth / runtime 集成
- 将入口请求映射为共享 contract
- 调用 `packages/supervisor-core` 并投影 HTTP 响应
- 在 runtime 边界持久化 supervisor audit records
- 暴露最小健康检查与 readiness 边界

它不负责：

- supervisor routing / policy / response assembly
- specialist delegation
- retrieval / Qdrant / registry 访问
- ingestion / data-plane 逻辑

因此这里不是“未来再补的 bootstrap app”，而是稳定的 API shell；核心编排继续留在 `packages/supervisor-core`。

## Current Auth And Audit Shape

- `bearer` 模式仍是 API shell 的显式 auth 入口，负责把认证后的请求映射为 `SupervisorRequest.actor`
- `bearer` 模式不再信任客户端提交的 `x-actor-*` header；它使用 runtime-owned 默认 actor 配置
- `trusted-worker` 模式在验证 `x-worker-origin-auth` 后，会从 worker 转发的 `cf-access-jwt-assertion` 里提取 caller identity claims；未命中时回退到 runtime-owned 默认 actor
- audit 持久化由 API shell 负责落盘，但 audit record 的 shape 仍由 `packages/supervisor-core` 投影

## Local Dev HTTP Entry

当前仓库也提供 repo-local 的 dev HTTP 入口，便于本地 live flow 不再依赖临时 `python -c` runner。

它通过 stdlib `ThreadingHTTPServer` 包装现有 `create_app().handle(...)` app，并仅暴露：

- `POST /api/v1/answer`
- `GET /healthz`
- `GET /readyz`

启动命令：

```bash
uv run --all-packages campus-supervisor-api-dev
```

## Minimum Env

至少需要：

```bash
export CAMPUS_AGENT_HTTP_HOST=127.0.0.1
export CAMPUS_AGENT_HTTP_PORT=8000
export API_AUTH_MODE=bearer
export API_BEARER_TOKEN=local-dev-token
```

推荐本地 bearer 默认值：

```bash
export API_DEFAULT_ACTOR_GROUPS=students
export API_DEFAULT_ACTOR_ROLES=student
export API_DEFAULT_CAMPUS_SCOPE=main
```

`ApiSettings.from_env()` 仍会从 repo `.env` 读取其余 runtime 配置，包括 `AGNO_SUPERVISOR_MODEL`、`AGNO_SPECIALIST_MODEL`、object store access 与 retrieval backend settings。

## Curl Smoke

Health:

```bash
curl -s http://127.0.0.1:8000/healthz
```

Ready:

```bash
curl -s http://127.0.0.1:8000/readyz
```

Answer smoke:

```bash
curl -s \
  -X POST http://127.0.0.1:8000/api/v1/answer \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer local-dev-token' \
  -H 'x-trace-id: local-smoke-trace-001' \
  -d '{
    "conversation_id": "local-smoke-conv",
    "request_id": "local-smoke-req",
    "user_goal": "图书馆开放到几点？",
    "requested_scope": {
      "corpus": "regulations",
      "collection": "student_handbook"
    }
  }'
```

## Known Preconditions

- 仍然需要有效 retrieval 环境；这个 dev HTTP 入口只替换临时 runner，不会 mock retrieval、Qdrant、MinIO 或 specialist 行为。
- Phase-1 默认知识范围仍然是 `regulations/student_handbook`。
- 如果启用 bearer auth 且 token 缺失或错误，`/api/v1/answer` 会返回 `401`。
- 这个 dev server 只是本地 runtime shell，不代表 Cloudflare Worker ingress、Phase 5 actor closure 或 runtime unification 已冻结。
