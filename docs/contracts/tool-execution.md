---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---
# 执行合同

## 边界

本文规定 `apps/app-api` 与 `apps/execution-control` 之间的私有命令和查询合同。可执行
来源是 `schemas/tool-execution.openapi.yaml`，生成的 TypeScript 与 Go 类型必须与其一致。

- app-api 拥有浏览器认证、会话事实和浏览器传输；
- execution-control 拥有准入、Temporal 生命周期、内部查询策略、终态处理和安全投影；
- agent-runtime 在单个 Temporal Agent Activity 内运行完整 OpenAI Agents SDK 循环；
- 浏览器不得直接调用本合同。

## 接口与认证

- app-api 调用 execution-control 的运行创建、状态、事件、步骤和取消接口；
- execution-control 调用 app-api 的
  `GET /api/internal/execution/runs/{runId}/input` 读取冻结输入。

前一组接口使用 execution-control 的内部认证，后一组接口只接受
`x-app-execution-auth`，其值来自双方共享的 `APP_API_EXECUTION_SHARED_SECRET`。该 Secret 只用于
execution-control 与 app-api 之间的执行输入读取及产品回调通道，不能用于浏览器或其他内部
接口。输入响应必须带
`Cache-Control: no-store`。工具执行请求和成功响应严格使用 `snake_case`；app-api
错误响应复用标准错误信封，其中关联字段保持 `traceId` 和 `requestId`。精确路径、状态码和响应结构
只由 OpenAPI 维护。

路径参数 `{runId}` 与创建请求的 `run_id` 使用同一标识合同：必须匹配
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`。当前 GET 输入接口只声明 `200` 以及
`400/401/404/409/503`；所有错误状态复用同一个 app-api 错误响应并带
`Cache-Control: no-store`。这些集合的可执行事实仍以 OpenAPI 为准。

## 创建运行

运行信封携带不可变的 run、conversation、turn、request、`owner_user_id`、`surface` 和 trace 标识。
当前载荷是 `tool_execution_v5`，响应合同是 `execution_finalization_response_v6`。运行 metadata
严格限制为以下内容：

```json
{
  "execution_contract_version": "tool_execution_v5",
  "execution_input_ref": "app-api://execution-inputs/run_01",
  "execution_input_sha256": "<64 位小写十六进制 SHA-256>"
}
```

`execution_input_ref` 必须精确绑定当前 run，格式为
`app-api://execution-inputs/{runId}`。app-api 将准入命令和完整执行输入分别冻结为 PostgreSQL
`text` 中的原始 UTF-8 JSON 文本，并对同一文本字节计算 SHA-256；不能先解析为 `jsonb` 再重算
hash。execution-control 读取输入时必须校验 ref、run、hash 与 1 MiB 上限，不能把 metadata
扩展成输入副本。

`tenant_id` 属于冻结的完整输入，不进入 metadata。调用方不能指定工具；Primary Agent 只能从
准入快照提供的模型可见工具中选择。

调用方不得发送 document scope、version query、corpus、collection、top-k、provider、vector-store 或
task-queue 字段。

## 工具注册与开放

`configs/runtime/tools.v6.json` 与
`configs/runtime/tool-function-schemas.v3.json` 是运行时工具事实。当前登记的内部合同为：

- `personal_memory_recall`：按当前 run 绑定的用户身份读取有界个人记忆。

`personal_memory_recall` 的 exposure 登记为 `model_visible`，但注册表本身不会自动向 Agent Runtime
开放工具：

- `personal_memory_recall_allowed=false` 时使用 `memory_recall=disabled`、`max_model_turns=1`、
  `max_tool_calls=0` 和空 `visible_tool_names`；
- `personal_memory_recall_allowed=true` 时使用 `memory_recall=model_optional`、`max_model_turns=2`、
  `max_tool_calls=1`，并只开放 `personal_memory_recall`。

`personal_memory_recall_allowed` 是当前 v5 私有 wire 字段，表示由个人记忆生命周期和就绪状态派生、
随本轮冻结的内部可用性，不表示用户同意状态或逐次读取授权。浏览器和用户文案不得暴露该字段、
recall 工具或执行结果。matched personal memory 可以支持用户自身事实或偏好，但不能支持机构事实、
替代 Campus Docs evidence 或成为公开来源。

机构文档不作为工具开放。execution-control 为每个有效请求冻结 PostgreSQL 当前索引查询绑定、本轮
查询 hash 和 `embedding` 模型设置 hash，并由 `RetrieveCampusDocsEvidenceActivity` 在模型调用前
返回有界检索结果。app-api 不选择或校验索引，模型也不接收检索参数。

## 工具运行时指纹

Agent 准入使用 `tool_runtime_fingerprint.v2` 绑定工具注册表与函数 schema
注册表及实际运行发布。指纹包含两类产物的 schema/registry version 与规范化 JSON SHA-256、
`runtime_release` 和覆盖全部字段的 `combined_sha256`；`runtime_release` 来自同一部署选择的
`DEPLOYMENT_RELEASE`，不能用可变环境名称代替。

execution-control 在调用 agent-runtime 前校验本地指纹并把完整准入指纹发送给它；agent-runtime
必须在 SDK 或模型调用开始前拒绝不匹配请求。execution-control 在保存 Agent 结果前校验返回指纹，
并在 Finalization 前同时核对准入、已保存结果和本地指纹。任一阶段不匹配都以
`agent_runtime_fingerprint_mismatch` 失败关闭，不能调用模型、持久化成功结果或发布产品终态。

Campus Docs 检索使用同一运行的不可变准入快照；物理 collection、dense/embedding/sparse 查询
绑定、本轮查询 hash 和 `embedding` 模型设置 hash 的冻结与执行约束见
`../architecture/system/retrieval-serving.md`。

## 检索与结果传递

`CampusDocsRetrievalResult` 是 Retrieval Activity 的有界结果，绑定本轮准入和查询，只包含 evidence
数组，最多 8 条，正文合计最多 4000 个 Unicode 字符。workflow 把最小 `campus_docs_evidence` 数组传给 Primary Agent，并
把原检索结果和 Agent result 分别传给 Finalization；这些内容进入 Temporal history。普通 StepResult
投影只保存准入与查询 hash、collection、计数和阶段耗时。

Retrieval Activity 重试时重新执行只读 embedding/Qdrant 查询，不从 PostgreSQL 读取或重放 evidence
正文。每个有效请求都执行该 Activity；成功后产生唯一检索 result 并继续 Agent，失败则关闭 workflow。
空与非空 evidence 只表达是否选出可引用证据，不增加状态字段。StepResult 自身首写不可变，终态
写入 fence 及 completed 后仅 `memory.append` 可写的例外由 `../data/durable-runtime.md` 定义。

`personal_memory_recall` 是 Primary Agent 同一次 SDK run 内的有界工具调用，不使用独立 memory ref
或独立 payload。它的完整结果只进入有界 Agent result；Primary Agent invocation receipt 约束整个 SDK
run 不得因 Activity 重投递而再次执行。已有 `started` 或 `completed` receipt 而没有可用 Activity result
时，必须以 `agent_attempt_uncertain` 失败关闭。

## Temporal 与终态处理

`ToolExecutionWorkflow` 的阶段、队列和 Agent Activity 边界由
`../architecture/system/durable-runtime.md` 定义。SDK 函数调用不创建额外 Temporal
Activity。

Workflow 输入只携带运行标识、输入 ref/hash 与有界策略版本，不携带冻结输入正文。Temporal history
另携带有界 Campus Docs 检索结果与 Agent Activity result；app-api 产品终态及其 `finalization_fingerprint` 是跨系统
重复完成、取消和较晚结果的最终裁决；execution-control 的终态投影必须与该结果一致，不能先向浏览器
发布相冲突的终态。

所有 source-side Temporal Activity 在处理业务输入前，必须从当前 Activity context 读取 Workflow ID
和精确 Temporal Run ID，并与持久 start intent 的 Workflow ID/root Run ID 绑定比较。绑定尚未确认是
可重试失败；任一 ID 不同，包括 Reset successor，都是非重试身份失败。start 已 `superseded` 时只有
cancellation finalizer 可使用已绑定 root，其他 Activity 不得继续执行或写投影。

app-api 为已经分配 `run_id` 的产品请求保留完整执行输入和 hash；业务终态不会删除或清空它。
execution-control 不维护输入清理发件箱，也不提供释放回调。输入随 app-api 所有的会话和用户数据
生命周期删除，不能由 Temporal Activity、reconciler 或运行终态单独处置。

启动前的持久 `dispatch_attempted=false` fence 可证明本地失败或 supersede 没有跨过 RPC 边界；若
fence 已提交、start 已 `superseded` 且没有 Run ID，取消 reconciler 必须使用原 canonical input 和
一分钟 `StartDelay` 的 recovery starter 创建或取得 root，完成 exact/latest 校验并首写精确绑定后
才能取消。

Temporal 的 `COMPLETED`、`FAILED`、`CANCELED`、`TERMINATED`、`CONTINUED_AS_NEW` 与
`TIMED_OUT` 都是 closed 状态，reconciler 不得让对应产品 run 继续保持 active。正常终态按产品投影
收敛；缺少产品终态的 closed execution 失败关闭。`CONTINUED_AS_NEW`、Reset 或其他不同 latest Run
属于 unauthorized successor：只以 `workflow_successor_without_authorization` 失败关闭产品 root run，
不得将 successor Run ID 写入 start binding，也不得向 successor 发送取消。

`ExecutionFinalizationResponse` 包含状态、答案、追问、置信度、模型用量、结果、错误和
trace 标识；可选字段包括观测摘要、工作流调用链摘要和阶段耗时。它不返回路由标签、外部平台引用
或逐请求遥测控制项。

对于 Campus Docs 答案，execution-control 根据绑定本轮 run 的检索结果校验每个终态依据引用，并派生
`result.sources`；每条公开 source 只包含 `document_id`、`root_unit_ids`、`section_ref`、
`section_title`、`snippet`、`title`、`version_id`、`version_slug` 和 `version_label`。`section_ref`
必须指向该版本的公开 permalink。该阶段不调用模型，也不改写答案。

Finalization Activity 必须通过一次 `FinalizeRunProjection` 提交 completed Step、Attempt、Result 与
run 四元组；不得拆成独立投影写入与 run completion。存储以单次 CAS 原子提交四元组、释放
conversation active-run lock，并让 completion 赢过已存在的 pending 或 leased cancellation，将其确认为
`completion_won`。completed replay 只核对 `CompletedAt`、`TerminalReason`、`FinalResponseRef`、
fingerprint 和已有 canonical 记录并返回原四元组，不得用较晚 candidate 补写或修改它。

## 投影与严格性

Temporal 历史是执行事实。PostgreSQL 保存安全的 run、event、step、attempt 和 result
投影；app-api 将投影转换为 SSE 和产品响应，不重建执行状态。

HTTP `ExecutionRunStatus` 与 execution-control 内部运行状态保持一致，包含等待、准入、执行、
流式输出和终态。精确枚举、字段及响应结构只由 OpenAPI 维护；内部迁移规则见
`../data/durable-runtime.md`。

面向 Campus Web 的 app-api 产品投影使用独立的事件名称和阶段合同：`execution.queued`、
`execution.running`、`execution.phase`、`answer.delta`、`request.completed`、
`request.failed`、`request.cancelled`。其中 `execution.phase` 只允许四个受控阶段，不能把
Temporal Activity、SDK tool、retry 或 worker 状态直接变成浏览器状态；回答过程由 app-api 从这些
产品事件派生固定五阶段，不返回 execution-control 的 attempt/result 轨迹。

事件查询同时返回浏览器安全的 `events` 和 `next_sequence`。`next_sequence` 表示
execution-control 已检查到的持久序列游标；app-api 后续必须将它作为 `after_sequence`，即使本次
只有被过滤的内部事件而 `events` 为空。不能以“最后一个返回事件”的 sequence 推进游标，否则会
反复读取内部事件或漏掉其后的公开事件。

`request.accepted` 只表示 app-api 已持久化产品请求并提供可管理的稳定 `runId`，不证明 Temporal
已经收取 workflow task。app-api 不为尚未从持久事件观察到的状态合成
`execution.queued`。`run.canceled` 是浏览器可见终态事件；浏览器断线只停止本次订阅，不取消 run。

- 拒绝未知字段和 camelCase 私有消息字段；
- 生成的 TypeScript 与 Go 产物必须匹配 OpenAPI；
- schema 校验后，工具与目标准入仍由服务端拥有；
- 原始 prompt、transcript、认证材料、完整执行输入和供应商载荷不得进入 execution-control
  metadata、Temporal 输入/history、event、step、日志或 trace；
- 不提供备用 parser、别名加载器、旧合同双请求结构或读取回退。

## 验证

运行 `pnpm --dir packages/contracts check`、手动 `go` validation profile，以及
`../reference/verification.md` 列出的 app-api 类型检查和测试通道。
