---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 运行记录接口

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
- `health`：由产品请求投影汇总的 `status` 和 `dataState`。
- `issues[]`：`code`、`title`、`detail`、`severity` 和 `source`。
- `requests`：请求总数、各状态数量、成功率、95% 请求耗时、状态、原因和数据更新时间。
- `trends`：`data[]` 包含时间桶开始时间、请求数、完成数、失败数和 95% 请求耗时；
  `dataState` 和 `reason` 说明趋势投影是否新鲜、缺失或不可用。
服务端缓存概览 15 秒。PostgreSQL 读取失败且最近一次成功结果不超过五分钟时返回 `STALE`；否则
请求与趋势标为 `UNAVAILABLE`。接口不查询服务 readiness、Temporal queue、供应商 logs/traces/metrics
或 Collector uptime，这些信号也不参与产品整体 `health`。

## `GET /api/ops/requests`

### 列表筛选

| 参数 | 必填 | 约束 | 默认值 |
| --- | --- | --- | --- |
| `window` | 否 | `15m`、`1h`、`6h`、`24h`、`7d` | `1h` |
| `view` | 否 | `recent`、`attention` | `recent` |
| `status` | 否 | 请求状态值 | 无 |
| `requestId` | 否 | 1 至 128 字符 | 无 |
| `q` | 否 | 1 至 256 字符 | 无 |
| `cursor` | 否 | 服务端游标，最多 512 字符 | 无 |

未知参数、无效状态或无效游标返回 `400 OPS_INVALID_QUERY`。`attention` 可以继续按任一产品状态
筛选，因为终态缺少会话结果时原产品状态保持不变。`q` 只作用于服务端固定的摘要字段，不能成为
SQL 片段。

响应固定每页最多 50 条，包含服务端生成时间 `generatedAt`、实际 `window`、状态计数 `statusCounts`、
请求摘要 `data[]` 和可为空的 `page.nextCursor`。`statusCounts` 保留除当前 `status` 与 `cursor` 外的
筛选，并受当前 `view` 约束，用于展示同一查询范围内可切换的状态计数。

- `recent` 按 `startedAt desc, requestId desc` 排序，展示全部符合筛选条件的运行；
- `attention` 展示终态缺少会话结果、`FAILED`、执行阶段失败的请求和 `ACTION_REQUIRED`，依次按数据完整性异常、
  产品失败或执行阶段失败、等待用户排序，再按 `startedAt desc, requestId desc` 排序。执行阶段失败不改写产品请求状态，
  已写入回答的完成请求仍保留 `COMPLETED` 与 `WRITTEN`。

两种视图使用 `v2` 游标；游标包含所属视图，不能跨视图复用。每条摘要只包含请求 ID、问题预览及
截断事实、产品状态和生命周期、开始完成时间、一次总耗时、产品结果状态、当前执行阶段、失败类型和
关注原因。接口不返回原始用户 ID、其他关联 ID、模型活动、token、完整步骤、执行尝试或技术错误明细。

`result` 的状态为：

- `PENDING`：产品尚未进入终态，助手消息可以尚未写入；
- `WRITTEN`：对应 `answer` 或 `error` 助手消息已经写入会话；
- `MISSING`：产品已进入终态，但没有满足 request、conversation 和 role 关联的助手消息。

`executionStage` 是当前请求最近保存步骤的 `kind` 和 `status`，没有步骤时为 `null`；
`failureKind` 只来自最近失败 step 的结构化 `failure.code`，不从产品 `errorCode`、run
`terminalReason` 或 `failCloseReason` 补值。执行阶段失败会让请求进入 `attention`，但不改写产品请求状态；
因此回答已经写入时仍为 `COMPLETED` 与 `WRITTEN`，并以 `EXECUTION_STAGE_FAILED` 标记需要关注。列表查询不读取
attempt 诊断。
活动请求的展示耗时由服务端 `generatedAt - startedAt` 计算；终态使用产品完成时间计算的持久耗时。
接口不伪造心跳或阶段开始时间。

## `GET /api/ops/requests/:requestId`

`requestId` 只允许字母、数字、点、下划线、冒号和连字符，最长 128 字符。无效 ID 返回
`400 OPS_INVALID_REQUEST_ID`，不存在返回 `404 OPS_REQUEST_NOT_FOUND`。

响应包含服务端生成时间、请求状态和时间、完整用户问题、产品结果及有界执行诊断。产品结果为
`WRITTEN`、`PENDING` 或 `MISSING` 联合类型；`WRITTEN` 返回 app-api 已净化并写入
会话的完整文本、`answer` 或 `error` 消息类型，以及完整 `source_items` 集合。每项来源包含与正文
对应的 `citationIndexes`，保持正文首次引用顺序，并以 `campus_document`、`campus_notice` 或 `web_page` 区分产品展示；
校园通知来源包含 `noticeId` 和 `/notices/<noticeId>` 站内链接，网页来源包含 hostname 和经过校验的 HTTP/HTTPS 外链。来源不返回内部 target kind、version ID、
locator 或 trace card。

`execution` 返回：

- `failure`：当前失败操作的结构化诊断事实，包括 `code`、`operation`、可选 `detail`、
  `httpStatus` 和 `invocationId`。存在多个失败阶段时，按阶段 `updatedAt`、`startedAt`、`stepId` 的降序确定当前失败阶段；
- `terminalReason`：execution-control 保存的粗粒度运行终态；
- `failCloseReason`：协调器执行失败收口的原因；
- `releases`：本次运行实际记录的 execution-control 与 agent-runtime release，二者只用于诊断；
- `model`：模型与 provider、模型请求数及汇总 token；
- `stages[]`：阶段类型、状态、起止时间、耗时和有界失败类型。

`failure`、`terminalReason` 与 `failCloseReason` 在页面中分区展示，任何一个字段都不能替代另一个。
历史运行没有某个诊断字段时返回 `null`，没有持久阶段时返回空数组，不从产品错误、终态、日志或外部
trace 推导根因。
Ops Web 只以 `requestId` 聚合 `chat.turn_dispatches`、产品消息以及 execution-control 的固定净化列；
不向浏览器暴露 workflow、Temporal run、step、attempt、result 或 provider response ID。

接口不返回完整模型输入输出、供应商原始响应、费用、Temporal history、完整 Langfuse trace、记忆正文
或检索候选正文。精确字段由 `apps/ops-web/src/shared/ops-contract.ts` 维护。

通用鉴权、错误和禁止行为见 [README.md](./README.md)。
