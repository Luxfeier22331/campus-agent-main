# campus-supervisor-api

`apps/supervisor-api` 是 `campus-agent` 的 execution engine boundary。

在当前接受的产品拓扑里：

- browser-facing chat / panel API 不在这里
- shared `apps/app-api` 承接产品层 auth/session/conversation、chat ingress 与 operator query
- `apps/supervisor-api` 只接收受控执行请求并进入 `packages/supervisor-core`

它负责：

- execution-side transport / internal caller admission / runtime 集成
- 将受控执行入口映射为共享 contract
- 调用 `packages/supervisor-core` 并投影 HTTP 响应
- 在 runtime 边界持久化 supervisor audit records
- 暴露最小健康检查与 readiness 边界

它不负责：

- supervisor routing / policy / response assembly
- specialist delegation
- retrieval / Qdrant / registry 访问
- ingestion / data-plane 逻辑

因此这里不是产品后端，也不是“未来再补的 bootstrap app”，而是稳定的 execution API shell；核心编排继续留在 `packages/supervisor-core`。

## Current Admission And Audit Shape

- `bearer` 模式是当前 repo-local / compatibility ingress，用于在没有 `app-api` 的情况下提供 internal caller admission 与显式 actor 默认值
- `bearer` 模式不再信任客户端提交的 `x-actor-*` header；forward canonical path 应由 `app-api` 显式提供 `actor`
- `trusted-worker` 模式只负责 internal caller admission；在验证 `x-worker-origin-auth` 后，最终业务 actor 与 authorization 必须由请求体里的 `context` 显式提供
- audit 持久化由 API shell 负责落盘，但 audit record 的 shape 仍由 `packages/supervisor-core` 投影

forward canonical direction 已冻结为：

- `app-api` 拥有 product-layer auth/session/principal mapping
- `apps/supervisor-api` 只做 internal caller admission
- `context` 由 `app-api` 显式传入 execution contract，并包含最终 `actor` 与 `authorization`

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

## Compatibility Local Dev Env

至少需要：

```bash
export CAMPUS_AGENT_HTTP_HOST=127.0.0.1
export CAMPUS_AGENT_HTTP_PORT=8000
export API_AUTH_MODE=bearer
export API_BEARER_TOKEN=local-dev-token
export API_DEFAULT_ACTOR_ID=local-dev-bearer-user
```

推荐本地 bearer compatibility 默认值：

```bash
export API_DEFAULT_ACTOR_GROUPS=students
export API_DEFAULT_ACTOR_ROLES=student
export API_DEFAULT_CAMPUS_SCOPE=main
```

`ApiSettings.from_env()` 本身只读取当前进程环境；`campus-supervisor-api-dev` 这个 repo-shipped 本地入口会先 bootstrap 当前 worktree `.env`，必要时回退根 worktree `.env`，然后再读取 `AGNO_SUPERVISOR_MODEL`、`AGNO_SPECIALIST_MODEL`、object store access 与 retrieval backend settings。

repo root `.env` / `.env.example` 只负责 shared runtime config，不承担 Worker / web app 的 app-local env ownership。相关模板索引见 `docs/environment/README.md`。

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
- query-serving surface 由 collection runtime profile 控制；当前 query-enabled scope 为 `regulations/student_handbook` 与 `curriculum/curriculum_plan`。
- 如果启用 bearer compatibility ingress 且 token 缺失或错误，`/api/v1/answer` 会返回 `401`。
- 这个 dev server 只是本地 runtime shell，不代表 Cloudflare Worker ingress 或 Phase 5 actor closure 已冻结；当前冻结的是 shared `apps/app-api` runtime，而不是 execution engine runtime。
