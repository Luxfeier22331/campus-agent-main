---
doc_type: runbook
owner_boundary: runtime-observability
status: active
---

# Worker 可观测性

## 边界

本文验证已部署 app-api 与 campus-web Worker 的 Sentry 错误链路。Worker 不使用仓库手写 OTLP
exporter，也不维护 application-log destination。

Cloudflare invocation logs 与 native traces 必须关闭，不能作为证据。浏览器和 Sentry 的追踪上下文
只服务 App API 入站错误观测，到 durable execution 边界即终止。execution-control 只转发已有的可选
W3C `traceparent`，不从 `requestId` 派生 trace；若环境启用 Agent trace，Langfuse metadata 使用
`request_id` 关联。环境 destination、Worker version/traffic、Sentry DSN 和 CI source map credential
由环境仓与受保护 GitHub Environment 拥有。

## 部署前检查

```bash
pnpm --dir apps/app-api test:worker
pnpm --dir apps/app-api build:worker
pnpm --dir apps/campus-web test:worker
pnpm --dir apps/campus-web build:worker
```

各 Worker 的 staging preflight 直接校验 Wrangler Secret 和所属构建配置；Sentry source map
credential 只由实际执行上传的构建命令校验。另需确认 staging build 强制 source map upload。
源码 `wrangler.toml` 不声明 observability；发布使用 `wrangler versions upload`，非版本化的
sampling、`persist=false`、`invocation_logs=false` 和
`observability.traces.enabled=false` 只由环境仓 `cloudflare_worker` resource 拥有。顶层配置、本地测试
或 version upload 通过都不证明环境设置已生效。Worker 版本上传不应重新取得这组设置的所有权，
误用无环境的远程 deploy 也不应产生无主 telemetry。

## 部署后检查

1. 确认 Cloudflare traffic 选中的 Worker version 带预期 release。
2. 从 campus-web browser 与 app-api 各触发一次受控成功请求和一次受控错误。
3. 在 Ops Web 确认成功和错误请求的 PostgreSQL 产品状态与关联标识可见。
4. 在 Sentry 分别确认 campus-web browser、campus-web edge 与 app-api error，release 正确且
   stack frame 能映射到上传 source map。
5. 若环境启用了 Agent Langfuse trace，确认 trace metadata 中的 `request_id` 与产品请求一致；环境因
   配额停收时不要求 trace 存在，也不接受 Cloudflare native span 作为替代。
6. 用合成值覆盖 OAuth/reset query、request header、body、用户标识、prompt、answer、memory
   和 credential 位置，在 Sentry 搜索所有哨兵。

## 通过标准

- Worker 没有 application-log destination，Cloudflare 本地持久化关闭；
- `invocation_logs=false` 且 native traces 关闭；
- Sentry 不包含 Cookie、header、query、body、用户、breadcrumb、GenAI 输入输出或 replay；
- browser、edge 与 app-api 使用 canonical Sentry project/DSN，release/environment 正确，source map 可解析；
- 产品请求状态来自 PostgreSQL，跨服务业务关联只使用 `requestId`；
- Sentry 或可选 Agent trace 出口故障没有改写请求终态。

## 失败处理

- Sentry 无错误或 stack 未映射：检查 runtime DSN、release 一致性和 source map upload job。
- correlation 断裂：检查 PostgreSQL 产品投影、Sentry tag 和 Langfuse metadata 的 `requestId`；若
  本次调用本来携带 W3C `traceparent`，再检查 execution-control 是否原样传播。`baggage` 和
  `sentry-trace` 不得跨 durable execution 边界。
- 任一禁止字段出现：立即关闭对应 Sentry path；出现 invocation log/native trace 或新的 log
  destination 时先修复配置漂移，再执行完整哨兵检查。

验收结果记录在所属 release 或 incident 中，不提交外部平台导出正文。
