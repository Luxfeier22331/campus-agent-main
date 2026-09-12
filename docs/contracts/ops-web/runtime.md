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
截断事实、产品状态和生命周期、开始完成时间、一次总耗时、产品结果状态、当前执行阶段、可用的工具名、
失败类型和关注原因。接口不返回原始用户 ID、其他关联 ID、模型活动、token、完整步骤、执行尝试或技术
错误明细。

`result` 的状态为：

- `PENDING`：产品尚未进入终态，助手消息可以尚未写入；
- `WRITTEN`：对应 `answer` 或 `error` 助手消息已经写入会话；
- `MISSING`：产品已进入终态，但没有满足 request、conversation 和 role 关联的助手消息。

`executionStage` 是当前请求最近保存步骤的 `kind`、`status` 和可用的 `toolName`，没有步骤时为 `null`；
`failureKind` 只来自最近失败 step 的结构化 `failure.code`，不从产品 `errorCode`、run
`terminalReason` 或 `failCloseReason` 补值。执行阶段失败会让请求进入 `attention`，但不改写产品请求状态；
因此回答已经写入时仍为 `COMPLETED` 与 `WRITTEN`，并以 `EXECUTION_STAGE_FAILED` 标记需要关注。列表查询不读取
attempt 诊断。
活动请求的展示耗时由服务端 `generatedAt - startedAt` 计算；终态使用产品完成时间计算的持久耗时。
接口不伪造心跳或阶段开始时间。

## `GET /api/ops/requests/:requestId`

`execution.stages[].modelOutputDiagnostic` 为可空的模型格式错误诊断。v1 包含 `schema_version`、
`text`、`original_utf8_bytes`、`truncated`、`validation_stage`（`json_parse`/`schema_validation`）、
`validation_message`、`output_schema` 和可空 `finish_reason`。读取当前阶段 attempt 对应的结果列；
列表不读取正文，诊断解码失败只显示未记录，不影响产品结果展示。
详情使用折叠的纯文本面板；空字符串显示“模型返回空文本”，null 显示“未记录”，不能互相替代。
截断必须明确标注。步骤格式失败但利用材料合成成功时，步骤保持失败、产品仍为 `COMPLETED`/`WRITTEN`。

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
- `stages[]`：阶段类型、状态、工具名和调用 ID（适用时）、起止时间、耗时和有界失败类型；耗时优先
  使用同一 `request_id`、`step_id`、`activity_attempt` 的 attempt 投影 `duration_ms`，缺失时才由阶段
  起止时间计算。
- `campusSearch`：Campus Search 专用诊断，包含 `diagnosticState`、`reason` 与 `calls[]`。每次调用展示
  invocation、workflow step、activity attempt、查询、最后观察阶段、阶段时间、排队和请求往返耗时、
  失败码与 HTTP 状态，以及服务端检索快照。这些 ID 只用于 Ops 关联，不授予操作运行的权限。

Campus Search 的 `diagnosticState` 为 `COMPLETE`、`PARTIAL`、`NO_DATA` 或 `UNAVAILABLE`；
页面分别显示诊断完整、部分可用、无数据、不可用。这是诊断完整性，不表示数据新鲜度、检索成功或
召回质量；不改变其他 Ops 接口缓存的 FRESH/STALE 语义。只消费 schema v2，不兼容旧快照。
成功调用完整性要求已执行阶段的时间和配置、选择快照，以及请求终态后的引用投影；零召回不要求
重排。失败调用以终态和明确失败阶段判断，不要求未执行阶段。无记录表示旧请求、
未调用工具或未收到观察，不能据此推断检索失败；终态请求中缺少工具终态的调用显示 `incomplete`。
诊断查询失败只使 `campusSearch` 不可用，不遮盖产品结果。活动请求约每两秒刷新，隐藏页面不后台
轮询；进入终态后再刷新一次以读取引用投影，随后停止定时刷新。

快照包含实际检索表达（最多 1024 字符）、dense / hybrid RRF 模式、embedding / retrieval / rerank /
selection 耗时、召回与去重后候选数、重排输入与保留数、通知分组后候选数及同通知排除数、
返回模型与排除数。只有对应阶段已观察完成时，
该阶段统计才有含义。最多 24 个候选记录来源、标题、章节、融合分数、重排分数、两次排序名次及
筛选原因（低于重排阈值、同通知已有代表块、返回数量限制、正文预算）。候选保存 noticeId 或
documentId；同一通知最多返回重排第一块，文档不受影响。返回项保存工具已返回的正文，总计最多 4000
字符；排除项只有最多 160 字符预览。候选的 `cited` 在 finalization 成功后为实际引用与否，未完成或
引用投影缺失时为 `null`。这里只反映本次工具的候选与选择，不提供没有标注集支持的 recall / precision。

`citedCount` 统计返回项中实际被引用的 Chunk，未判定为 null，不把返回数量当引用数量。
引用投影来自成功 Finalization 的最终 Campus 来源，不重新用原始正文编号匹配去重后的 evidence；
已完成请求修复使用已保存的最终来源。`cited` 按请求级稳定 `result_ref` 判断，同一来源在多次调用
出现时可在各调用中标为已引用，不表示能归因到模型采用的某一次调用，也不应将各调用的
`citedCount` 相加作为请求的唯一来源数。
Embedding 元数据来自实际配置，包含 provider、model、dimensions、instructionVersion 和只含
scheme/host 的 serviceOrigin，不返回 API key 或 URL path/query。缓存区分 hit/miss/wait/bypass，
wait 为同请求合并等待；estimatedSavedMs 是 hit 避免的历史加载耗时估算，不是整轮实测加速。
检索展示实际 collection、HTTP 往返、Qdrant 响应 time 换算的毫秒、解码和候选后处理；
重排展示实际 provider/model/inputCount/HTTP 往返。未测量用 null，已测得不足一毫秒保留 0。
Qdrant 服务端耗时包含于 HTTP 往返，不能相加或把差值直接称为网络延迟。
请求往返从 dispatching 至工具终态，不含 queued 至 dispatching 的排队；执行摘要中的工具
attempt 耗时还包含包装与观察上报。各层耗时不是可相加的独立段。
失败阶段由当前执行位置记录，不通过耗时是否为零推断。`snapshotTruncated` 明示有界快照截断。

`failure`、`terminalReason` 与 `failCloseReason` 在页面中分区展示，任何一个字段都不能替代另一个。
历史运行没有某个诊断字段时返回 `null`，没有持久阶段时返回空数组，不从产品错误、终态、日志或外部
trace 推导根因。
Ops Web 只以 `requestId` 聚合 `chat.turn_dispatches`、产品消息以及 execution-control 的固定净化列；
不向浏览器暴露 Temporal workflow/run 或 provider response ID；Campus Search 诊断专用的调用、步骤、
尝试编号和 result ref 仅在上述 Ops 字段返回。

接口不返回完整模型输入输出、供应商原始响应、费用、Temporal history、完整 Langfuse trace、记忆正文
或无界检索正文。上述有界 Campus Search 候选快照是明确例外。精确字段由
`apps/ops-web/src/shared/ops-contract.ts` 与 `campus-search-diagnostics.ts` 维护。

通用鉴权、错误和禁止行为见 [README.md](./README.md)。
