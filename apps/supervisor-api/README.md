# campus-supervisor-api

`apps/supervisor-api` 是 `campus-agent` 当前查询主链路的对外 serving boundary。

它负责：

- 外部请求的 transport / auth / runtime 集成
- 将入口请求映射为共享 contract
- 调用 `packages/supervisor-core` 并投影 HTTP 响应
- 暴露最小健康检查与 readiness 边界

它不负责：

- supervisor routing / policy / response assembly
- specialist delegation
- retrieval / Qdrant / registry 访问
- ingestion / data-plane 逻辑

因此这里不是“未来再补的 bootstrap app”，而是稳定的 API shell；核心编排继续留在 `packages/supervisor-core`。
