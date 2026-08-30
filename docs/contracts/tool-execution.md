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
  `GET /api/internal/execution/requests/{requestId}/input` 读取冻结输入。

前一组接口使用 execution-control 的内部认证，后一组接口只接受
`x-app-execution-auth`，其值来自双方共享的 `APP_API_EXECUTION_SHARED_SECRET`。该 Secret 只用于
execution-control 与 app-api 之间的执行输入读取及产品回调通道，不能用于浏览器或其他内部
接口。输入响应必须带
`Cache-Control: no-store`。工具执行请求和成功响应严格使用 `snake_case`；app-api
错误响应复用标准错误信封，其中关联字段只使用 `requestId`。精确路径、状态码和响应结构
只由 OpenAPI 维护。

路径参数 `{requestId}` 与创建请求的 `request_id` 使用同一标识合同：必须匹配
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`。当前 GET 输入接口只声明 `200` 以及
`400/401/404/409/503`；所有错误状态复用同一个 app-api 错误响应并带
`Cache-Control: no-store`。这些集合的可执行事实仍以 OpenAPI 为准。

## 创建运行

运行信封携带不可变的 request、conversation、`owner_user_id` 和 `surface`。
当前载荷是 `tool_execution_v7`，响应合同是 `execution_finalization_response_v8`。运行 metadata
严格限制为以下内容：

```json
{
  "execution_contract_version": "tool_execution_v7",
  "execution_input_ref": "app-api://execution-inputs/req_01",
  "execution_input_sha256": "<64 位小写十六进制 SHA-256>"
}
```

`execution_input_ref` 必须精确绑定当前 request，格式为
`app-api://execution-inputs/{requestId}`。app-api 将准入命令和完整执行输入分别冻结为 PostgreSQL
`text` 中的原始 UTF-8 JSON 文本，并对同一文本字节计算 SHA-256；不能先解析为 `jsonb` 再重算
hash。execution-control 读取输入时必须校验 ref、request、hash 与 1 MiB 上限，不能把 metadata
扩展成输入副本。

`tenant_id` 属于冻结的完整输入，不进入 metadata。调用方不能指定工具；Primary Agent 只能从
准入快照提供的模型可见工具中选择。

调用方不得发送 document scope、version query、corpus、collection、top-k、provider、vector-store 或
task-queue 字段。

## 工具注册与开放

`configs/runtime/tools.v7.json` 与
`configs/runtime/tool-function-schemas.v4.json` 是运行时工具事实。当前登记的内部合同为：

- `campus_search`：按当前 Campus Docs 绑定检索中央民族大学 Campus Web 文档，返回供 Agent 选择的
  有界候选结果。
- `personal_memory_recall`：按当前 request 绑定的用户身份读取有界个人记忆。

两个工具的 exposure 都登记为 `model_visible`，但注册表本身不会自动向 Agent Runtime 开放工具。
execution-control 根据当前能力状态生成本轮工具集合：

- `visible_tool_names` 是名称唯一的集合，数组顺序没有路由语义；
- 个人记忆不可用时，`max_model_turns=3`、`max_tool_calls=2`，只开放 `campus_search`；
- 个人记忆可用时，`max_model_turns=4`、`max_tool_calls=3`，开放 `campus_search` 和
  `personal_memory_recall`。工具预算是本轮所有工具调用的总预算；同一工具可以重复调用，不从数组顺序
  推导调用顺序。

`personal_memory_recall_allowed` 是当前 v6 私有 wire 字段，表示由个人记忆生命周期和就绪状态派生、
随本轮冻结的内部可用性，不表示用户同意状态或逐次读取授权。浏览器和用户文案不得暴露该字段、
recall 工具或执行结果。matched personal memory 只支持用户自身事实或偏好，不推导机构事实。

`campus_search` 的模型参数只有 `search_query`，不接收 collection、索引版本、provider、top-k 或
vector-store 字段。handler 在调用
时读取当前 `campus_docs_serving.current_index` 和 embedding provider。handler 内部先取得最多 24 个
hybrid 候选，再调用同一 provider 的固定 `Qwen3-Reranker-4B` 排序并保留
`relevance_score >= 0.5` 的候选。成功结果只包含 `outcome` 与最多 5 条 `results`；过滤后无候选返回
`no_match`。阈值只判断文本相关性，不判断学校、人群或规则适用主体；reranker 失败不得回退到未排序
候选。

Primary Agent 的固定角色是中央民族大学校园问答助手，未明确指定机构的校内问题默认指中央民族
大学。工具定义声明各自能够提供的事实范围；Primary Agent 根据问题所需事实选择工具，不使用机构或
其他实体名称级路由特判。`results` 是可供 Agent 判断的候选，不表示已经用于回答。问题只有部分事实
被候选直接支持时，只回答有依据的部分；完全没有候选支持所需机构事实时，在正常助手正文中说明资料
边界。

同一次 SDK run 可以多次调用 `campus_search`。每次最多返回 5 条结果，本轮累计最多 10 条；每条结果
携带本轮全局 `citation_index` `1..10`。成功但没有结果的调用和失败调用不占用编号。只有正文实际
引用的结果才是 cited results；Finalization 从同一次 request 的成功工具结果中解析 `[n]` 并派生公开
来源卡片。失败工具结果和未被正文引用的候选不贡献来源；未知、零或超出 `1..10` 的引用使
Finalization 失败。

查询文本由 execution-control 确定性生成：`search_query` 与 `user_goal` 相同时只使用
`user_goal`，否则使用 `user_goal + "\n检索表达：" + search_query`。dense、sparse 和 rerank
消费同一查询文本。

Agents SDK 负责依据 `tool-function-schemas.v4.json` 验证模型生成的函数参数。Execution Control 只读取
同一文件参与工具合同指纹，不再递归实现第二份 schema 校验；handler 仍负责身份、业务前置条件和结果合同。
Agent Runtime 返回的每个 `tool_results` 项包含实际 `tool_name`、`arguments_json`、`status`、
`duration_ms`、有界 `result`、实际 `invocation_id` 和可选结构化 `failure`。`failure` 只包含
`code`、`operation`、可选 `detail`、`http_status` 与 `invocation_id`；它是一次工具或模型操作的
诊断事实，不替代运行终态的 `terminal_reason`。

## 工具合同指纹

Agent 准入使用 `tool_contract_fingerprint.v1` 绑定工具注册表与函数 schema 注册表。指纹只包含两份
规范化 JSON 的 SHA-256：

```json
{
  "schema_version": "tool_contract_fingerprint.v1",
  "tools_sha256": "sha256:<hex>",
  "function_schema_sha256": "sha256:<hex>"
}
```

execution-control 在调用 agent-runtime 前校验本地合同并发送准入指纹；agent-runtime 必须在 SDK 或
模型调用开始前拒绝不匹配请求。execution-control 在保存 Agent 结果前校验返回指纹，并在
Finalization 前同时核对准入、已保存结果和本地合同。任一阶段不匹配都以
`tool_contract_mismatch` 失败关闭；agent-runtime 的非流式 HTTP 接口返回 `409`，execution-control
对产品投影使用 `runtime_invariant_failed`。不匹配运行不能持久化成功 Agent 结果或发布成功产品终态。

`DEPLOYMENT_RELEASE` 不进入合同指纹。execution-control 和 agent-runtime 可以独立发布，只要两端工具
合同一致；各自 release 作为诊断事实分别保存和展示，不能用来判定兼容性。

## Agent 结果传递

StepResult 自身首写不可变，终态写入 fence 及 completed 后仅 `memory.append` 可写的例外由
`../data/durable-runtime.md` 定义。

`personal_memory_recall` 是 Primary Agent 同一次 SDK run 内的有界工具调用，不使用独立 memory ref
或独立 payload。它的完整结果只进入有界 Agent result；Primary Agent invocation receipt 约束整个 SDK
run 不得因 Activity 重投递而再次执行。已有 `started` 或 `completed` receipt 而没有可用 Activity result
时，必须以 `agent_attempt_uncertain` 失败关闭。

`campus_search` 也在同一次 SDK run 内执行，不创建独立 Temporal Activity。它的结果只在本次
Agent result 内有效，不能跨 request 或从模型输出中重新构造。

## Temporal 与终态处理

`ToolExecutionWorkflow` 的阶段、队列和 Agent Activity 边界由
`../architecture/system/durable-runtime.md` 定义。SDK 函数调用不创建额外 Temporal
Activity。

Workflow 输入只携带运行标识、输入 ref/hash 与有界策略版本，不携带冻结输入正文。Temporal history
携带有界 Agent Activity result；app-api 产品终态及其 `finalization_fingerprint` 是跨系统
重复完成、取消和较晚结果的最终裁决；execution-control 的终态投影必须与该结果一致，不能先向浏览器
发布相冲突的终态。

所有 source-side Temporal Activity 在处理业务输入前，必须从当前 Activity context 读取 Workflow ID
和精确 Temporal Run ID，并与持久 start intent 的 Workflow ID/root Run ID 绑定比较。绑定尚未确认是
可重试失败；任一 ID 不同，包括 Reset successor，都是非重试身份失败。start 已 `superseded` 时只有
cancellation finalizer 可使用已绑定 root，其他 Activity 不得继续执行或写投影。

app-api 为已经分配 `request_id` 的产品请求保留完整执行输入和 hash；业务终态不会删除或清空它。
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

`ExecutionFinalizationResponse` 包含状态、答案、模型用量、结果和错误；可选字段包括观测摘要和
阶段耗时。追问、资料不足和范围说明都是 `completed` 助手正文。它不返回路由标签、外部平台引用
或逐请求遥测控制项。

当前在线链路只有 `campus_search` 注册了机构知识结果 adapter。Finalization 按成功工具 adapter
校验引用并派生公开来源；没有 adapter、来自失败工具或不属于同一次运行的引用均被拒绝。新的来源能力
接入时，必须由对应可执行合同定义来源校验和公开字段。

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

`request.accepted` 只表示 app-api 已持久化产品请求并提供可管理的稳定 `requestId`，不证明 Temporal
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
