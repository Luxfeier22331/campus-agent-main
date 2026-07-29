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

`chat.turn_dispatches` 是产品请求、准入和终态的 app-api 提交点。接收事务为同一 request 冻结
两份用途不同的数据：

- `admission_input_json text` 与 `admission_input_sha256` 保存准入命令，供 dispatcher 幂等重放
  同一个 run 创建请求；
- `execution_input_json text` 与 `execution_input_sha256` 保存完整 `tool_execution_v5` 输入，供
  execution-control 按 `app-api://execution-inputs/{runId}` 读取。

两份内容都使用 PostgreSQL `text` 保存，hash 必须对保存的同一 UTF-8 字节计算。不得使用
`jsonb` 保存后再序列化校验，因为 key 规范化会改变字节序列。完整执行输入最多 1 MiB，只能由
execution-control 通过独立 `x-app-execution-auth` 读取；该 header 由
`APP_API_EXECUTION_INPUT_SHARED_SECRET` 提供，只授予读取/释放输入的方向性权限，不得复用
`APP_API_EXECUTION_SHARED_SECRET`。响应禁止缓存，不进入普通 app-api、Ops Web 或浏览器读取
路径。run 进入产品终态后，内部删除接口清空输入并记录释放时间；重复删除成功，非终态删除失败
关闭。释放时间只由 `execution_input_released_at` 表示，不能把空正文或空 hash 解释为另一种
生命周期。

准入状态按 `pending_admission -> dispatching -> admitted` 单调推进。接收事务直接冻结 admission
与 execution input，不存在事务外 `pending_input` fence。可确认的
暂态或未知投递结果从 `dispatching` 归还 `pending_admission`，由 dispatcher 使用同一份冻结输入
幂等重试；身份不一致等确定性失败不得归还 claim，而是进入 `admission_failed`。所有 claim、归还
和确认更新都必须同时以 `status=accepted` 为条件，避免候选读取后产品终态已提交仍发起 RPC。

`admission_failed` 只能由 ChatCommandService 的产品失败终结事务设置。该事务同时写入 assistant
error、`runtime.request_observability_fact`、稳定 `finalization_fingerprint`，并清空尚未交付给已准入
run 的冻结准入/执行输入。限流、取消和普通 execution failure 仍使用各自的产品终态，不得误标为
`admission_failed`。后台 finalizer 失败时保留 `dispatching`，等待 stale claim 后重试；若事务已提交
但响应丢失，终态 `status` 会把该记录排除在后续准入候选之外，不形成热重试。

dispatcher 通过上述持久 claim 避免多个实例同时发送同一命令。`request.accepted` 只证明产品请求
已提交并具有稳定 `run_id`，不把准入状态解释为 Temporal queue 状态。

显式取消先在同一产品记录写入原因、请求时间和取消发件箱状态，再由 reconciler 幂等调用
execution-control。投递尝试和低基数错误可记录在发件箱中；HTTP 失败不能撤销已提交的取消意图。
产品终态和 `finalization_fingerprint` 对完成、取消及较晚结果实施单调裁决，成功 closeout 后关闭
发件箱并释放执行输入。

## `runtime.request_observability_fact`

该表保存一次 browser request 的受控诊断摘要，用于 app-api 的质量分析和受控故障定位。
Ops Web 的主运行记录以 `chat.turn_dispatches` 和 execution-control 的 `runtime.agent_*`
为事实来源，不依赖此表重建请求旅途；该表只作为明确授权的次级关联数据。
它不是工作流状态机，也不承载原始日志、原始 prompt、模型完整输入输出、记忆正文或检索
正文。冻结输入与取消发件箱也不复制到该表。

主要字段分组：

- 关联：`request_id`、`trace_id`、`conversation_id`、`safety_identifier`；
- 请求：`surface` 和 principal 类型；
- 结果：`status`、`error_code`、`semantic_outcome`、`refusal_class`、ACL 结果；
- 时序：started/completed/measured/updated 时间、总耗时和 projection lag；
- 诊断：来源摘要、stage timing 和 workflow trace summary；
- 模型：provider、model、prompt id/version 和 template hash；

该表不保存 token 用量、caller 请求的 scope/version query、工具选择标签、answer eval fingerprint、
LLM I/O fingerprint、debug trace ref 或请求级观测配置。token 用量只由 execution-control 执行投影、
Langfuse 和现有遥测事件提供，不复制成 App API 产品数据。

app-api 在接收 turn 的同一事务中以 `accepted` 状态创建记录。事件读取器收到首个实际
`answer_delta` 时，只在记录仍为 `accepted` 且尚无该字段时写入
`stream.app_api_ttft_ms`；并发或重复读取保留首个值，产品终态之后不再接受迟到写入。
最终写入先读取这份 app-api 阶段时序，与 execution-control 返回的阶段时序合并，再在产品
终结事务中更新同一记录并关闭状态。允许的状态与 `chat.turn_dispatches` 保持一致。

## 索引

当前索引服务以下受控查询：

- 时间窗口；
- status + time；
- `surface`、principal type、model 和 safety identifier + time。

Ops Web 按 `request_id` 读取 `chat.turn_dispatches`、`chat.messages` 和
`runtime.agent_runs`，不会从此表或其他观测字段反推或改写请求状态。

当前只有 App API 在请求接纳、首段响应计时和终结事务中读写该表；用户产品读取模型不查询它，
Ops Web 也没有该表的列读取权限。它不能成为新的跨所有者接口；字段只随 App API 的实际消费
收敛，不能复制到执行库或观测平台。

## execution-control 投影

`runtime.agent_*` 由 `apps/execution-control` 的 schema installer 管理。`app_api` 角色不能读取
这些表，`ops_web` 仅获得合同列的读取权限。chat dispatch、agent run 和 observability fact
直接通过 `request_id`、`run_id` 与 `trace_id` 关联。

## 可执行来源

- `apps/app-api/src/db/schema/runtime.ts`
- `apps/app-api/src/db/schema/chat.ts`
- `apps/app-api/drizzle/0007_execution_runtime_ownership.sql`
- `apps/execution-control/internal/execution/run_projection_postgres_store.go`
- `apps/ops-web/ops/db/ops-web-database.ts`
