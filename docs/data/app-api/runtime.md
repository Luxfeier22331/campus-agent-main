---
doc_type: data
owner_boundary: apps/app-api
status: active
---

# App API 运行时数据

## 文档边界

本文定义 app-api 拥有的请求观测数据，以及 `chat.turn_dispatches` 中服务持久执行的协调数据。
会话和消息结构见 `chat.md`；execution-control 的运行投影由 execution-control 自己管理。

## 持久执行协调

`chat.turn_dispatches` 是产品请求、稳定运行身份和终态的 app-api 提交点。接收事务为同一 request
冻结完整的 `tool_execution_v5` 输入，并写入 `execution_input_json text`、
`execution_input_sha256` 和 `turn_id`，供 execution-control 按
`app-api://execution-inputs/{runId}` 读取。

两份内容都使用 PostgreSQL `text` 保存，hash 必须对保存的同一 UTF-8 字节计算。不得使用
`jsonb` 保存后再序列化校验，因为 key 规范化会改变字节序列。完整执行输入最多 1 MiB，只能由
execution-control 通过内部 `x-app-execution-auth` 读取；该 header 使用双方共享的
`APP_API_EXECUTION_SHARED_SECRET`，只授予 execution-control 与 app-api 之间的执行输入读取
方向性权限，不用于浏览器或其他内部接口。响应禁止缓存，不进入普通 app-api、Ops Web 或浏览器读取
路径。已经分配 `run_id` 的记录在产品终态后继续保留完整执行输入与 hash；输入随所属会话和用户数据
生命周期删除，不存在按 run 的释放接口或额外释放状态。

app-api 不维护执行 admission 状态机、dispatcher、cancellation outbox 或后台恢复队列。事务提交后
由当前请求使用同一 `Idempotency-Key` 继续 handoff；创建结果不确定时，app-api 从本行重读输入并
调用 execution-control 的幂等 run 创建接口。execution-control/Temporal 负责 run projection、
workflow start、重试、取消和恢复。

显式取消先校验产品归属，再直接调用 execution-control；取消意图和取消投递状态由 execution-control
拥有，app-api 不写本地取消状态。

## `runtime.request_observability_fact`

该表保存一次 browser request 的受控诊断摘要，用于 app-api 的质量分析和受控故障定位。
Ops Web 的主运行记录以 `chat.turn_dispatches` 和 execution-control 的 `execution_control.agent_*`
为事实来源，不依赖此表重建请求旅途；该表只作为明确授权的次级关联数据。
它不是工作流状态机，也不承载原始日志、原始 prompt、模型完整输入输出、记忆正文或检索
正文。冻结输入与取消状态也不复制到该表。

主要字段分组：

- 关联：`request_id`、`trace_id`、`conversation_id`、`safety_identifier`；
- 请求：`surface` 和 principal 类型；
- 结果：`status`、`error_code` 和 ACL 结果；
- 时序：started/completed/measured/updated 时间、总耗时和 projection lag；
- 诊断：来源摘要、stage timing 和 workflow trace summary；
- 模型：provider、model、prompt id/version 和 template hash；

该表不保存 token 用量、caller 请求的 scope/version query、工具选择标签、answer eval fingerprint、
LLM I/O fingerprint、debug trace ref 或请求级观测配置。token 用量只由 execution-control 执行投影
和 Langfuse 提供，不复制成 App API 产品数据。

app-api 在接收 turn 的同一事务中以 `accepted` 状态创建记录。事件读取器收到首个实际
`answer_delta` 时先把事件交给产品流，再异步写入 `stream.app_api_ttft_ms`，产品首段输出不等待
该数据库写入。TTFT 写入只要求字段尚不存在，因此可以与产品终态事务并发或在其后完成；并发或
重复读取仍只保留首个成功写入的值。终态写入合并已有的 app-api 阶段时序与
execution-control 返回的阶段时序，再在产品终结事务中更新同一记录并关闭状态。两条写入路径都
基于合并结果派生 `stream.orchestration_overhead_ms`。因此该表是请求阶段耗时的最终可查询投影；
如果 TTFT 晚于产品终态写入，最终记录仍会包含 TTFT 和可派生的 overhead。允许的状态与
`chat.turn_dispatches` 保持一致。

## 索引

当前索引服务以下受控查询：

- 时间窗口；
- status + time；
- `surface`、principal type、model 和 safety identifier + time。

Ops Web 按 `request_id` 读取 `chat.turn_dispatches`、`chat.messages` 和
`execution_control.agent_runs`，不会从此表或其他观测字段反推或改写请求状态。

当前只有 App API 在请求接纳、首段响应计时和终结事务中读写该表；用户产品读取模型不查询它，
Ops Web 也没有该表的列读取权限。它不能成为新的跨所有者接口；字段只随 App API 的实际消费
收敛，不能复制到执行库或观测平台。

## execution-control 投影

`execution_control.agent_*` 由 `apps/execution-control` 的 schema installer 管理。`app_api` 角色不能读取
这些表，`ops_web` 仅获得合同列的读取权限。chat dispatch、agent run 和 observability fact
直接通过 `request_id`、`run_id` 与 `trace_id` 关联。

## 可执行来源

- `apps/app-api/src/db/schema/runtime.ts`
- `apps/app-api/src/db/schema/chat.ts`
- `apps/app-api/drizzle/0007_execution_runtime_ownership.sql`
- `apps/execution-control/internal/execution/run_projection_postgres_store.go`
- `apps/ops-web/ops/db/ops-web-database.ts`
