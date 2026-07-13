---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-07-12
---

# App API Operator Schema

## 文档边界

`operator.*` 只保存 source-processing 的受控读取投影。它不保存在线问答请求、Temporal
任务队列样本、自研 autoscaler 决策、通用指标或 trace 镜像。

## Official Web

当前表：

- `operator.official_web_run_projection`
- `operator.official_web_site_projection`
- `operator.official_web_release_task_projection`
- `operator.official_web_release_task_event_projection`

这些表提供站点、采集运行、ingestion dispatch/execution 和 release task 的状态、错误、
时间线和受控 artifact 摘要。原始页面、原始 artifact 和 ingestion owner truth 不复制进
operator schema。

## Authenticated Notice

当前表：

- `operator.authenticated_notice_processing_projection`
- `operator.authenticated_notice_processing_event_projection`
- `operator.authenticated_notice_run_processing_projection`
- `operator.authenticated_notice_run_processing_event_projection`

notice projection 以 notice 为查询入口；run projection 以 source run 为查询入口。两者只
保存生命周期、队列状态、下游摘要、错误、次数、时间线和版本字段，不保存原始通知正文、
认证材料或完整 workflow history。

## HTTP 读取面

app-api 当前只暴露：

- authenticated notice processing list/detail；
- authenticated notice run processing list/detail；
- official web release task list/detail；
- ingestion task list。

路由清单以 `apps/app-api/src/app/routes/operator.ts` 为准。存在数据库表不自动打开浏览器
接口。

## 已退役形态

以下表和读取面不属于当前 schema：

- `operator.request_projection`
- `operator.request_audit_projection`
- `operator.temporal_task_queue_current`
- `operator.temporal_task_queue_snapshot`
- `operator.worker_autoscaler_*`
- `operator.quality_grade_projection`
- `operator.trace_backlink_projection`

在线请求排查属于 self-hosted Ops Web。它直接关联 `chat.turn_dispatches`、
`chat.messages`、`runtime.agent_runs` 和 `runtime.request_observability_fact`；operator console
不再代理 request list/detail。

## 可执行来源

- `apps/app-api/src/db/schema/operator.ts`
- `apps/app-api/src/app/routes/operator.ts`
- `apps/app-api/src/app/route-exposure-operator-inventory.ts`
