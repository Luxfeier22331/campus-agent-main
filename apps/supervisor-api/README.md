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
