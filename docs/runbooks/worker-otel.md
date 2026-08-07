---
doc_type: runbook
owner_boundary: runtime-observability
status: active
---

# Worker 可观测性

## 边界

本文验证已部署 app-api 与 campus-web Worker 的两条链路：producer 清理后的 application console
logs 经 Cloudflare log destination 到 Axiom，以及 edge/browser SDK 到 Sentry。Worker 不使用
仓库手写 OTLP exporter，Cloudflare log destination 也不经过 Kubernetes Collector。

Cloudflare invocation logs 与 native traces 必须关闭，不能作为证据。后端请求 trace 通过 W3C
context 进入 execution-control，再由 Collector 写入 Axiom/Langfuse。环境 destination、Worker
version/traffic、Sentry DSN 和 CI source map credential 由环境仓与受保护 GitHub Environment
拥有。

## 部署前检查

```bash
pnpm ci:worker
```

各 Worker 的 staging preflight 直接校验 Wrangler Secret 和所属构建配置；Sentry source map
credential 只由实际执行上传的构建命令校验。另需确认 staging build 强制 source map upload。
源码 `wrangler.toml` 不声明 observability；发布使用 `wrangler versions upload`，非版本化的
destination、sampling、`persist=false`、`invocation_logs=false` 和
`observability.traces.enabled=false` 只由环境仓 `cloudflare_worker` resource 拥有。顶层配置、本地测试
或 version upload 通过都不证明环境设置已生效。Worker 版本上传不应重新取得这组设置的所有权，
误用无环境的远程 deploy 也不应产生无主 telemetry。

## 部署后检查

1. 确认 Cloudflare traffic 选中的 Worker version 带预期 release。
2. 从 campus-web browser 与 app-api 各触发一次受控成功请求和一次受控错误。
3. 在 Axiom log dataset 按时间、service 与关联标识查询 producer 允许的 Worker application log；
   在 trace dataset 查询同一请求由 execution-control 经 Collector 写入的 runtime trace。
4. 在 Sentry 分别确认 campus-web browser、campus-web edge 与 app-api error，release 正确且
   stack frame 能映射到上传 source map。
5. 确认 application log 的 `campus.request_id`/`campus.trace_id` 与 W3C context 传播后的
   Collector trace 关联；
   不要求或接受 Cloudflare native span 作为替代。
6. 用合成值覆盖 OAuth/reset query、request header、body、用户标识、prompt、answer、memory
   和 credential 位置，在 Axiom 与 Sentry 搜索所有哨兵。

## 通过标准

- Axiom 只收到 producer 允许的 Worker application logs，Cloudflare 本地持久化关闭；
- `invocation_logs=false`、native traces 关闭，Axiom 中没有对应 invocation log/native trace；
- application logs 与 Collector 输出中的 query/header/body/user/credential 哨兵为零匹配；
- Sentry 不包含 Cookie、header、query、body、用户、breadcrumb、GenAI 输入输出或 replay；
- browser、edge 与 app-api 使用 canonical Sentry project/DSN，release/environment 正确，source map 可解析；
- correlation 能通过 application log 和 Collector runtime trace 连接 Worker 与私有 runtime，但
  产品请求状态仍来自 PostgreSQL；
- Axiom、Sentry 或 Collector 故障没有改写请求终态。

## 失败处理

- Axiom 无 Worker application log：检查 producer 是否实际发出允许事件、Worker version、staging
  log destination reconciliation 和 token 权限，不从 Collector receiver 排查这条旁路。
- Sentry 无错误或 stack 未映射：检查 runtime DSN、release 一致性和 source map upload job。
- correlation 断裂：检查 application log 关联字段和 Worker 到 execution-control 的 W3C
  `traceparent`/`baggage` 传播。
- 任一禁止字段出现：立即关闭对应 log destination、producer 输出或 Sentry path；出现 invocation
  log/native trace 时先修复配置漂移，再执行完整哨兵检查。

验收结果记录在所属 release 或 incident 中，不提交外部平台导出正文。
