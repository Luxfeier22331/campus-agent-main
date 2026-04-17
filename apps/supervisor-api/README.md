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
- 拥有产品主链路 prompt runtime 的 assembly / provider binding seam
- 在 runtime 边界持久化 supervisor audit records
- 暴露最小健康检查与 readiness 边界

它不负责：

- supervisor routing / policy / response assembly
- specialist delegation
- package-owned prompt family truth
- retrieval / Qdrant / registry 访问
- ingestion / data-plane 逻辑

因此这里不是产品后端，也不是“未来再补的 bootstrap app”，而是稳定的 execution API shell；核心编排继续留在 `packages/supervisor-core`。

## Prompt Runtime Seam

当前 repo-default prompt stack 已明确拆成：

- repo-global developer invariants
- package-owned role prompt
- typed trusted task packet
- typed untrusted user/evidence packet
- strict structured output
- code-side finalization

其中：

- `packages/supervisor-core` 与 `packages/rag-specialist` 继续拥有长期 prompt assets / packet schema
- `apps/supervisor-api/src/campus_supervisor_api/prompt_stack.py` 拥有 product-path runtime assembly seam
- `apps/supervisor-api` 不拥有新的 monolithic mega system prompt

当前 `readyz` 也会显式暴露：

- `prompt_runtime.provider`
- `prompt_runtime.transport`
- `prompt_runtime.developer_invariants_id`
- `prompt_runtime.developer_invariants_version`
- `prompt_runtime.strict_structured_outputs`
- `prompt_runtime.supervisor_model`
- `prompt_runtime.specialist_model`
- `prompt_runtime.admitted`
- `prompt_runtime.admission_reason`

这条 seam 的约束是：

- user text 不得进入 developer instruction zone
- retrieved evidence 不得进入 developer instruction zone
- provider/runtime 以后只能在这条 seam 上接入 strict structured outputs，不能由 app-local ad hoc prompt 拼装替代

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
export API_DEFAULT_ACTOR_ROLES=student
```

`ApiSettings.from_env()` 本身只读取当前进程环境；`campus-supervisor-api-dev` 这个 repo-shipped 本地入口会先 bootstrap 当前 worktree `.env`，必要时回退根 worktree `.env`，然后再读取 `PROMPT_RUNTIME_MODEL`、`SUPERVISOR_PROMPT_MODEL`、`SPECIALIST_PROMPT_MODEL`、object store access 与 retrieval backend settings。

repo root `.env` / `.env.example` 只负责 shared runtime config，不承担 Worker / web app 的 app-local env ownership。相关模板索引见 `docs/environment/README.md`。

当前 prompt runtime 相关 env：

```bash
export PROMPT_RUNTIME_PROVIDER=openai-responses
export PROMPT_RUNTIME_TRANSPORT=responses
export PROMPT_RUNTIME_MODEL=gpt-5.4
export SUPERVISOR_PROMPT_MODEL=
export SPECIALIST_PROMPT_MODEL=
export PROMPT_STRICT_STRUCTURED_OUTPUTS=true
export PROMPT_RUNTIME_API_KEY=...
export PROMPT_RUNTIME_BASE_URL=https://api.openai.com/v1
export PROMPT_RUNTIME_REASONING_EFFORT=low
export PROMPT_RUNTIME_MAX_OUTPUT_TOKENS=512
```

`PROMPT_RUNTIME_MODEL` 是 shared default。
如果未显式提供 `SUPERVISOR_PROMPT_MODEL` / `SPECIALIST_PROMPT_MODEL`，两条角色链都会继承 `PROMPT_RUNTIME_MODEL`。

如果未显式提供 `PROMPT_RUNTIME_PROVIDER`，当前 readiness / runtime seam 会继承 `AGENT_RUNTIME_PROVIDER` 作为 product-path provider 标识。

如果未显式提供 `PROMPT_RUNTIME_API_KEY` / `PROMPT_RUNTIME_BASE_URL`，当前会分别回退到 `LLM_API_KEY` / `LLM_BASE_URL`。

只有当 provider、api key、supervisor/specialist model 与 `PROMPT_STRICT_STRUCTURED_OUTPUTS=true` 同时满足时，`prompt_runtime.admitted` 才会为 `true`。

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
