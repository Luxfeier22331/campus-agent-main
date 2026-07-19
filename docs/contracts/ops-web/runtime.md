---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 运行排查接口

## `GET /api/ops/overview`

### 时间窗口

| 参数 | 必填 | 允许值 | 默认值 |
| --- | --- | --- | --- |
| `window` | 否 | `15m`、`1h`、`6h`、`24h` | `1h` |

未知参数或无效值返回 `400 OPS_INVALID_QUERY`。

### 响应

- `window`：实际时间窗口。
- `generatedAt`：结果生成时间。
- `cache`：`status` 为 `FRESH` 或 `STALE`，`ageMs` 为缓存年龄。
- `health`：整体 `status`、`dataState` 和 `reasons[]`。
- `issues[]`：`code`、`title`、`detail`、`severity` 和 `source`。
- `requests`：请求总数、各状态数量、成功率、95% 请求耗时、状态、原因和更新时间。
- `trends[]`：时间桶开始时间、请求数、完成数、失败数和 95% 请求耗时。
- `services[]`：固定服务名、显示名、状态、数据状态、原因和更新时间。
- `temporal`：总积压、最老任务等待、工作进程数量、状态和 `queues[]`。
- `telemetry`：总体状态及日志、指标、调用链三类 `signals[]`。
- `externalLinks[]`：已配置系统的 `source`、`label`、`href` 和 `isAvailable`。

固定服务为 `campus-web`、`app-api`、`execution-control`、`agent-runtime` 和 `ops-web`。外部系统
类型为 `TEMPORAL`、`LANGFUSE`、`SENTRY` 和 `AXIOM`。

服务端缓存概览 15 秒。PostgreSQL 和运行信号都失败且最近一次成功结果不超过五分钟时返回
`STALE`；否则各失败来源标为 `UNAVAILABLE`，其他来源继续返回。

三类 telemetry signal 分别对固定 Axiom dataset 查询记录数和最新时间。单个查询失败只将该
signal 标为 `UNAVAILABLE`。日志或调用链为零条时返回 `NO_DATA` 且不自动判为故障，指标为零条
时返回 `NO_DATA` 与 `DEGRADED`。

## `GET /api/ops/requests`

### 列表筛选

| 参数 | 必填 | 约束 | 默认值 |
| --- | --- | --- | --- |
| `window` | 否 | `1h`、`6h`、`24h`、`7d` | `1h` |
| `status` | 否 | 请求状态值 | 无 |
| `requestId` | 否 | 1 至 128 字符 | 无 |
| `conversationId` | 否 | 1 至 128 字符 | 无 |
| `traceId` | 否 | 1 至 128 字符 | 无 |
| `q` | 否 | 1 至 256 字符 | 无 |
| `limit` | 否 | 1 至 100 的整数 | `50` |
| `cursor` | 否 | 服务端游标，最多 512 字符 | 无 |

未知参数、无效状态或无效游标返回 `400 OPS_INVALID_QUERY`。`q` 只作用于服务端固定的摘要
字段，不能成为 SQL 片段。

响应包含实际 `window`、状态 `summary`、请求摘要 `data[]` 和可为空的 `page.nextCursor`。每条
请求摘要包含关联标识、状态、错误、时间、耗时、主体类型、问题预览、诊断和可为空的工具选择。
接口不返回原始用户 ID。

## `GET /api/ops/requests/:requestId`

`requestId` 只允许字母、数字、点、下划线、冒号和连字符，最长 128 字符。无效 ID 返回
`400 OPS_INVALID_REQUEST_ID`，不存在返回 `404 OPS_REQUEST_NOT_FOUND`。

响应包含请求摘要、关联标识、模型、工具、结果、访问控制、来源、阶段耗时、工作流摘要、步骤
轨迹、trace 状态和服务端生成的外部入口。`workflowId` 只在 `runId` 存在时按
`campus-agent.chat.<runId>` 生成。

响应不返回 Temporal Run ID、任务队列、执行进程、token、费用、记忆摘要或检索候选统计。精确
字段由 `apps/ops-web/src/shared/ops-contract.ts` 维护。

## `GET /api/ops/requests/:requestId/observability`

该接口读取与已保存请求关联的 Axiom 脱敏记录。`kind` 是必填参数，只允许 `logs` 或 `trace`。

服务端完成统一人员准入后，从请求详情取得可信关联标识与时间，固定 dataset、查询条件、字段
投影和排序。查询窗口从请求开始前五分钟到完成后五分钟；未完成请求以当前时间为上限，实际窗口
最多 30 分钟。浏览器不能提供 APL、dataset、`traceId`、起止时间、字段投影或记录上限。

响应包含查询来源、类型、关联标识、实际窗口、查询时间、耗时、数据状态、记录、截断状态和
上限。日志上限为 200，调用链上限为 500。响应不包含任意 `body` 或 attributes。

Axiom 必须返回非 partial 的有效表格数据；部分响应、结构无效、字段重复、列长度错位、超时或
非成功 HTTP 都返回 `503 OPS_OBSERVABILITY_UNAVAILABLE`。

## `GET /api/ops/requests/:requestId/sentry-issues`

该接口返回与已保存请求关联的最多五条 Sentry Issue 摘要，不返回完整 event、stack、breadcrumb、
request 或用户上下文。

服务端使用可信请求标识、固定 environment、项目集合、排序和有界时间窗口调用官方 Issues
API。浏览器不能添加查询参数。响应包含关联标识、查询窗口、耗时、固定搜索条件、数据状态、
截断状态和 Issue 摘要；查询未配置、失败或响应无效时返回 `503 OPS_SENTRY_UNAVAILABLE`。

通用鉴权、错误和禁止行为见 [README.md](./README.md)。
