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
- agent-runtime 在单个 operation Activity 内运行由 Model Config 选择的 OpenAI 或 Gemini runner；
- 浏览器不得直接调用本合同。

## 接口与认证

### 模型输出失败的内部结果

JSON 解码或输出 schema 校验失败使用 `model_output_invalid`，以 `status=failed` 的完整 operation
结果返回，保留已完成工具结果、evidence、source attempts、模型用量和阶段耗时。失败不是成功摘要，
不设置成功的 completed step；由 Workflow 根据真实失败建立步骤状态，并使用保留下来的材料继续
既有合成流程。通用 `run_failed`、证据合同错误与未知执行状态不因此变成可恢复失败。
Replan 的 decision/剩余计划语义仍由 execution-control 校验；被拒绝的模型决策保存
`model_output_invalid` 及用量，Workflow 保留原获准计划而不执行无效替换。该 owner 不拥有解析前
模型文本，因此不伪造原文诊断；其他结果合同错误保留有界校验原因供 Ops 查看。
失败 receipt 保存完整业务结果，重放不再次调用模型或检索。Ops 专用的 `model_output_diagnostic`
仅存在于 Runtime 内部传输与步骤诊断列，不进入业务 receipt、Activity 输出、事件或后续模型上下文。

### 调用认证

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
当前载荷是 `tool_execution_v7`，响应合同是 `execution_finalization_response_v9`。运行 metadata
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

`tenant_id` 属于冻结的完整输入，不进入 metadata。调用方不能指定工具；Solve、Executor 和
Replanner 只能在准入快照与当前步骤允许的来源中作出选择。

调用方不得发送 document scope、version query、corpus、collection、top-k、provider、vector-store 或
task-queue 字段。

## 工具注册与开放

`configs/runtime/tools.v7.json` 与
`configs/runtime/tool-function-schemas.v4.json` 是运行时工具事实。当前登记的内部合同为：

- `campus_search`：按当前 Campus RAG 绑定检索中央民族大学当前 Campus Web 文档和已发布校园通知，返回供 Agent 选择的
  有界候选结果。
- `personal_memory_recall`：按当前 request 绑定的用户身份读取有界个人记忆。

两个工具的 exposure 都登记为 `model_visible`，但注册表本身不会自动向 Agent Runtime 开放工具。
execution-control 根据当前能力状态生成本轮工具集合：

- `visible_function_tool_names` 是名称唯一的集合，数组顺序没有路由语义；
- `solve` 可使用本轮准入的工具直接检索并回答；`execute_step` 只开放当前步骤候选来源对应的工具；
  `replan` 和 `synthesize` 不执行本地 function tool；
- `max_model_turns` 与 `max_function_tool_calls` 是单个 operation 的预算，`max_plan_steps` 与
  `max_replans` 是外层 workflow 的请求级预算；同一工具可以重复调用，不从数组顺序推导调用顺序。

以上字段和预算只描述本地 function tools。`web_search` 在 Solve 已准入，或在当前 execute step 的候选来源中被显式
允许时，Agent Runtime 才附加供应商原生搜索（OpenAI Web Search / Gemini Google Search）；它不进入工具注册表、
`visible_function_tool_names`、本地 `max_function_tool_calls`、execution-control handler 或
`tool_results`。该能力要求 `primary_agent` Model Config 使用 OpenAI Responses 或 Google GenerateContent；不兼容的 Chat
Completions 配置以
`model_config_incompatible` 拒绝，不进行 fallback。

`personal_memory_recall_allowed` 是当前 v6 私有 wire 字段，表示由个人记忆生命周期和就绪状态派生、
随本轮冻结的内部可用性，不表示用户同意状态或逐次读取授权。浏览器和用户文案不得暴露该字段、
recall 工具或执行结果。matched personal memory 只支持用户自身事实或偏好，不推导机构事实。

`campus_search` 的模型参数只有 `search_query`，不接收 collection、索引版本、provider、top-k 或
vector-store 字段。handler 在调用
时读取当前 `campus_docs_serving.current_index`、embedding provider 和 reranker provider。handler 内部
先取得最多 24 个 hybrid 候选，再调用 `campus_docs_reranker` 配置中的固定 `Qwen3-Reranker-4B` 排序并保留
`relevance_score >= 0.5` 的候选。成功结果只包含 `outcome` 与最多 5 条 `results`；过滤后无候选返回
`no_match`。阈值只判断文本相关性，不判断学校、人群或规则适用主体；reranker 失败不得回退到未排序
候选。

Agent Workflow 的固定角色是中央民族大学校园问答助手，未明确指定机构的校内问题默认指中央民族
大学。工具定义声明各自能够提供的事实范围；Solve、Executor 和 Replanner 根据目标、当前步骤与
证据选择来源，不使用机构或其他实体名称级路由特判。`results` 是可供 Agent 判断的候选，不表示已经
用于回答。问题只有部分事实
被候选直接支持时，只回答有依据的部分；完全没有候选支持所需机构事实时，正常助手正文使用简洁的
“暂未找到相关资料”或“目前无法确认”，不暴露内部资料范围。

需要补充或核验尚未采集的公开校园网页信息时，Replanner 可以为后续步骤加入 `web_search`，Executor
再在该步骤内调用它。`campus_search` 返回 `no_match` 或失败表示当前已采集文档没有可用证据；这不会由
代码自动触发 Web Search，也不能直接判定资料不足。runner 在模型响应处解析 OpenAI URL annotation 或
Gemini grounding support，提取 URL、标题与对应文本片段作为中立 `webEvidence`。供应商 UTF-8/Part
位置只留在 adapter；Solve 直接回答通过 `web_evidence` 传递最终答案的 codepoint `start_index` /
`end_index`、`excerpt`、`title`、`url`，Finalization 校验精确正文跨度并在末尾插入引用，保留正文及
同段多来源。流式 metadata 不以最后一块覆盖前文；支持项不能映射时单项丢弃、记录诊断，不否决答案。
Workflow 为计划内的有效材料分配 citationIndex，Synthesizer 只使用这些编号输出 `[n]`。
Finalization 按正文实际引用产生统一编号链接与 `kind=web_page` 来源卡；模型手写 URL 不作为来源。
未引用材料和失败工具结果不贡献来源。

Solve 与 Synthesize 共用裸编号扫描，支持 `[1]`、`[1,5]`、`[1, 5]`；分组逐项校验、按书写顺序去重，
代码、转义方括号和已有 Markdown 链接不参与扫描。Solve 按首次出现合并编号，Synthesize 保留材料编号。
先校验 Web 支持段的原文、位置和来源；仅紧随有效支持段（中间只有空白且不跨段落）或位于支持段尾部的
未知编号可作为冗余装饰移除，不把原始编号猜配给 Web 来源。混合分组中的有效校内编号仍保留。
正文替换和支持段引用插入使用原始位置一次重写，支持段结束位置落在被替换编号内部时将插入移至编号末尾。

Runtime evidence 的 `url` 保留 grounding 原始地址作为证据身份；`source_link.href` 单独承载展示用直链。
Finalization 的产品来源 `url`、`citation_href` 与 `hostname` 使用解析后的地址，链接不可用时为 `null`，
并带 `unavailable_reason: source_unavailable`；最终化严格合同接受该字段。agent-runtime 只解析精确的 Google grounding redirect，
后续支持 HTTP 跳转和独立脚本页中的静态 `window.location.href` 字符串跳转，不执行 JavaScript；
对目标地址和 DNS 结果执行公开地址校验，两种跳转共用次数、响应大小、并发和超时限制。解析成功的新消息使用原站标题
和直链；解析失败仍保留正文与编号，来源卡不可点击并标记 `source_unavailable`。标题读取失败仍保留直链，
使用有意义的上游标题或“网页标题暂不可用”加主机名。旧消息不回填；统一模型网关不承担该项目专用解析。

执行合同不传递 Google 搜索建议 HTML。App API 读取历史消息时按未知结构化类型丢弃旧建议，
保留正文与来源卡。原生搜索能力和 grounding 引用不受影响。

同一次 SDK run 可以多次调用 `campus_search`。每次最多返回 5 条结果，本轮累计最多 10 条；每条结果
携带本轮全局 `citation_index` `1..10`。单次调用内 `result_ref` 唯一；不同调用允许重复召回相同
`result_ref`，各编号到来源的映射保留至 Finalization，不能因 evidence 去重丢弃后续编号。
成功但没有结果的调用和失败调用不占用编号。只有正文实际
引用的结果才是 cited results；Finalization 从同一次 request 的成功工具结果中解析 `[n]` 并派生公开
来源卡片。失败工具结果和未被正文引用的候选不贡献来源；除上述已验证 Web 支持段尾部的冗余编号外，
未知、零或超出 `1..10` 的引用使 Finalization 失败。

引用预算耗尽立即停止当前模型循环，并以 `retrieval_budget_exhausted` 返回失败 operation；
失败不丢弃已完成工具结果、evidence、source attempts、用量或 provider response ID。
所有 synthesis 输入只携带目标、汇总 evidence、source attempts 和 remaining facts，不携带
plan 或 completed steps，也不再检索。普通计划合成为 `mode=planned`；Solve 已有材料但失败时使用
`mode=recovery`，另传 recovery reason。Runtime 不回传输入材料，由 Execution Control 重新附加
已接纳的 evidence 和 source attempts，再保存 receipt 与传给 Workflow，失败结果也遵循这一规则。
恢复成功正常完成产品回答；无材料时保留具体技术错误，资料确实为空时为 `materials_insufficient`；
有材料但恢复生成失败为 `answer_synthesis_failed`。取消与请求绝对 deadline 不被恢复覆盖或延长。
若 Solve 已发出正文，恢复结果整体替换草稿，失败流不能发送 answer-completed。Runtime 在草稿之后
无法提供成功终态时先发送 `answer_invalidated`，再发送原始 `failed` 或 `error`；Execution Control
保留原始失败原因，不把失效事件当作终态，也不接受其后的成功终态。

查询由 execution-control 按用途拆分：dense 和 sparse 使用工具提供的 `search_query`，rerank 使用
当前 `user_goal`；分别去除首尾空白，不再把用户目标与扩展检索词拼接为同一查询。Ops 诊断记录实际
召回查询与排序目标，历史记录缺少排序目标时不回填推断值。

runner 负责依据 `tool-function-schemas.v4.json` 验证模型生成的函数参数：OpenAI 由 Agents SDK 验证，
Gemini adapter 使用同一 JSON Schema 验证后调用共享本地工具执行器。Execution Control 只读取
同一文件参与工具合同指纹，不再递归实现第二份 schema 校验；handler 仍负责身份、业务前置条件和结果合同。
Agent Runtime 返回的每个 `tool_results` 项包含实际 `tool_name`、`arguments_json`、`status`、
`duration_ms`、有界 `result`、实际 `invocation_id` 和可选结构化 `failure`。实际执行过的工具调用
还可以携带 `started_at` 与 `completed_at`，二者是 RFC3339 UTC 时间；`duration_ms` 仍由 Runtime
使用 monotonic clock 测量，不由这两个 wall-clock 字段反推。预算、身份或合同校验在工具执行器启动
前失败时不伪造工具时间区间；旧 Runtime 缺少时间字段时，execution-control 保留已有 Activity
时间回退。`failure` 只包含 `code`、`operation`、可选 `detail`、`http_status` 与 `invocation_id`；
它是一次工具或模型操作的诊断事实，不替代运行终态的 `terminal_reason`。

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

Operation HTTP 与 Activity 输出使用类型化 `plan` / `replan`，不再附带重复的
`structured_output`。Executor 返回摘要 `final_output`、`remaining_facts`、evidence 和 source attempts；
completed step 的步骤身份与执行序号由 workflow 构造，不接受 Runtime 回传副本。
Synthesize 只接收目标、answer mode、evidence、source attempts 和
`remaining_facts: [{ objective, facts }]`，不接收完整 plan 或 completed steps。Runtime 的 synthesis
响应不回传 evidence/source attempts；adapter 将已准入的请求材料附到完整恢复输出。

完整 Activity 输入、Runtime HTTP 请求/响应（SSE 为单个 completed JSON 对象）、Activity/receipt 输出和
finalization recovery response 的上限均为 1 MiB（1,048,576 字节）。每个边界按其实际 UTF-8 JSON
编码计量，包含 envelope、JSON 转义及所有数组；字符数限制不能代替字节预算。SSE framing 不占 JSON
预算，多行 data 的换行和空白计入预算。超限不得调度 Activity、提交 completed receipt 或发布成功回调。
失败仍通过既有 failure finalizer 收敛，不新增恢复存储。

StepResult 自身首写不可变，终态写入 fence 及 completed 后仅 `memory.append` 可写的例外由
[持久执行数据](../data/durable-runtime.md) 定义。

`personal_memory_recall` 是 Solve 或 Execute Step operation 同一次 SDK run 内的有界工具调用，不使用独立 memory
ref 或独立 payload。memory 正文仅保留在 evidence excerpt 中，最多 4000 个 Unicode codepoint；
Temporal 工具摘要只保留 `matched` / `no_match` outcome，不保存原始 arguments、debug 或 failure detail。
Runtime HTTP 中的 Campus 工具结果继续遵守完整 bounded search result 合同。execution-control 在
转换 Execute 输出时先校验完整结果，成功工具的 `result` 随后只保留 `matched` / `no_match` outcome；
正文和引用材料保留在 evidence 中。失败 Execute 中已成功的工具同样裁剪，失败工具的 result 仍为空。
工具身份、状态、耗时和既有失败摘要保留；已有工具投影继续使用完整 Runtime 结果，先于 receipt 写入。
Solve 输出保留完整 Campus 结果供直接回答的终态引用解析使用，Ops 查询诊断仍由已有专用投影拥有。
operation invocation receipt 约束整个 SDK run 不得因 Activity 重投递而再次执行。
已有 `started` receipt 时以 `workflow_attempt_uncertain` 阻断；明确成功或失败的 receipt 保存完整类型化
operation output，重投递时校验身份、修复投影并返回原结果，不重新调用供应商。
首次输出与 replay 使用同一字段和大小校验；replay 还校验已有输出 hash，
按恢复后的类型化输出编码计算，不能对 PostgreSQL JSONB 的文本空白和键顺序计算 hash。
Execute 校验同时接受当前 DTO 已保存的完整 Campus 结果与仅含 outcome 的新摘要。旧 receipt
按原形态校验 hash、修复投影并返回，不在恢复时裁剪或重写；新执行统一保存摘要。此规则不恢复更早
已淘汰的 operation DTO，也不放宽 Runtime HTTP 的完整工具结果校验。
结果无法解码或无法通过恢复校验时沿用既有失败路径。

`campus_search` 也在同一次 SDK run 内执行，不创建独立 Temporal Activity。它的结果只在本次
Agent result 内有效，不能跨 request 或从模型输出中重新构造。

## Temporal 与终态处理

`ToolExecutionWorkflow` 的阶段、队列和 operation Activity 边界由
[持久 Agent 运行时](../architecture/system/durable-runtime.md) 定义。SDK 函数调用不创建额外 Temporal
Activity。

Workflow 输入只携带运行标识、输入 ref/hash 与有界策略版本，不携带冻结输入正文。Temporal history
携带有界 operation result；app-api 产品终态及其 `finalization_fingerprint` 是跨系统
重复完成、取消和较晚结果的最终裁决；execution-control 的终态投影必须与该结果一致，不能先向浏览器
发布相冲突的终态。成功 callback 后只有 `FinalizeRunProjection` 成功追加的 `run.completed` 才能成为
浏览器成功终态；内部 `finalization.completed` 不是产品终态。

成功 finalization 在产品 callback 前完成 recovery response 的确定性字段与大小校验。callback 成功后
event 或 projection 写入失败时允许重发相同 response、fingerprint 和 completed time；app-api 必须返回
幂等 replay，且只保留一次产品完成效果。完成时间或响应冲突不得覆盖产品结果。

本次 operation DTO 切换不保留旧 history/receipt 合同。上线须先停止新请求准入、排空旧 workflow，
再协调更新 execution-control 与 agent-runtime 后恢复准入；工具 fingerprint 一致本身不能证明
operation DTO 兼容。本地验证不执行该部署。

所有 source-side Temporal Activity 在处理业务输入前，必须从当前 Activity context 读取 Workflow ID
和精确 Temporal Run ID，并与持久 start intent 的 Workflow ID/root Run ID 绑定比较。绑定尚未确认是
可重试失败；任一 ID 不同，包括外部创建的其他 execution，都是非重试身份失败。start 已 `superseded` 时只有
cancellation finalizer 可使用已绑定 root，其他 Activity 不得继续执行或写投影。

app-api 为已经分配 `request_id` 的产品请求保留完整执行输入和 hash；业务终态不会删除或清空它。
execution-control 不维护输入清理发件箱，也不提供释放回调。输入随 app-api 所有的会话和用户数据
生命周期删除，不能由 Temporal Activity、reconciler 或运行终态单独处置。

启动前的持久 `dispatch_attempted=false` fence 可证明本地失败或 supersede 没有跨过 RPC 边界；若
fence 已提交、start 已 `superseded` 且没有 Run ID，取消 reconciler 必须使用原 canonical input 和
一分钟 `StartDelay` 的 recovery starter 创建或取得 root。starter 完成首次 exact/latest 身份校验后
返回精确 Run ID；reconciler 不重复校验，持久绑定后读取当前状态并取消。

首次绑定仍校验 root、Memo、reset state 与 exact/latest 一致性。绑定后以持久 Workflow ID/Run ID
为归属依据，取消、投递失败后的复查和关闭状态收敛只读取该精确 execution；不再验证 Memo、
chain、reset state 或 latest。取消前的产品状态检查、绑定冲突与终态事务不变。

Temporal 的 `COMPLETED`、`FAILED`、`CANCELED`、`TERMINATED`、`CONTINUED_AS_NEW` 与
`TIMED_OUT` 都是 closed 状态，reconciler 不得让对应产品 run 继续保持 active。正常终态按产品投影
收敛；缺少产品终态的 closed execution 失败关闭，取消路径对已取消 root 沿用本地取消收口。
`CONTINUED_AS_NEW` 直接以不可重试的 `runtime_invariant_failed` 收口，不要求先找到 successor。
latest 改变不影响已绑定 root 按自身状态收敛；不得将其他 Run ID 写入 start binding 或向其发送取消。
Describe 不可用、NotFound 或缺少必要关闭时间时保持重试，已有产品终态仍优先。

`ExecutionFinalizationResponse` 包含状态、答案、模型用量、结果和错误；可选字段包括观测摘要和
阶段耗时。追问、资料不足和范围说明都是 `completed` 助手正文。它不返回路由标签、外部平台引用
或逐请求遥测控制项。`result.sources` 是完整来源集合，来源为 `campus_document`、`campus_notice` 或 `web_page`；
Campus 文档来源保留文档定位；校园通知来源保留 `notice_id`、section title 和 `/notices/<noticeId>` `citation_href`；Web 来源保留 `hostname`、`url` 和
`citation_href`。Solve 的来源编号由 Finalization 按正文首次出现顺序写入，相同 Campus `result_ref`
或重复 Web URL 复用编号和来源卡；不同 `result_ref` 不按文档 ID、通知 ID 或 URL 额外合并。
Synthesize 保留 Workflow 已分配的稳定 evidence 编号。

检索链路统一综合回答，不携带 `answer_mode`。Replanner 使用 `task_replan.v3`，决策只有 `continue`
和 `synthesize`。合法的 Solve answer 不因 evidence 为空而失败。计划合成接受材料、成功来源尝试
（`matched`、`no_match`、`completed`）或明确的来源不可用结果，模型据此回答当前能确认的部分。
记忆 recall、Campus Search 网络/超时/不可用错误是非阻断来源失败；工具参数、结果、身份和准入
合同错误仍阻断。没有可用材料且模型 operation 自身失败时仍保留具体技术错误。
原生联网搜索缺少支持段时记录 `completed` 尝试及独立诊断，不推断 `no_match`。

失败合同分为三个字段，不能互相补值：

- step/attempt `failure.code` 保存实际失败操作的稳定代码，是执行根因证据；
- run `terminal_reason` 是粗粒度终态分类，只允许表达 provider 不可用、运行超时、worker 明确不可用、
  运行不变量失败或中性的 `execution_failed` 等终态；
- run `fail_close_reason` 只说明协调器为何执行收口。

只有明确的 `worker_unavailable` 才能产生同名终态；工具失败、通用 Agent Runtime 失败和未知合法错误
都归入 `execution_failed`，不能伪装成 worker 不可用。Agent Runtime 返回已登记错误码时保留该码；
返回未登记码时 execution-control 使用 `agent_runtime_response_invalid`，并把有界原始码放在该 step
的诊断 `detail`。Agent Runtime HTTP/SSE 错误不决定产品 `retryable`；execution-control 在写产品终态
时根据失败事实显式决定用户能否用相同输入新建请求，且该值与 Temporal 重试策略无关。

`agent_deadline_exceeded` 表示 Runtime 在包含 Model Config 读取的 operation 预算到期后主动结束
响应；取消继续传递给 SDK 和工具，但终态发送不等待其清理完成。Execution 收到该 HTTP/SSE 终态时
保留代码、operation 和有界 detail；未收到明确结果而发生传输超时才使用 `agent_runtime_timeout`。
两者不能按名称互相替换。正常完成仍须取得完整结果，取消或超时后的迟到结果不得覆盖终态。

当前在线链路只有 `campus_search` 注册了机构知识结果 adapter。Finalization 按成功工具 adapter
校验引用并派生公开来源；没有 adapter、来自失败工具或不属于同一次运行的引用均被拒绝。新的来源能力
接入时，必须由对应可执行合同定义来源校验和公开字段。

Finalization Activity 必须通过一次 `FinalizeRunProjection` 提交 completed Step、Attempt、Result 与
run 四元组；不得拆成独立投影写入与 run completion。存储以单次 CAS 原子提交四元组、释放
conversation active-run lock，并让 completion 赢过已存在的 pending 或 leased cancellation，将其确认为
`completion_won`。completed replay 只核对 `CompletedAt`、`TerminalReason`、`FinalResponseRef`、
fingerprint 和已有 canonical 记录并返回原四元组，不得用较晚 candidate 补写或修改它。若 callback 已
成功而 canonical 记录冲突，只有同一 fingerprint/identity 的 replay 可以修复；歧义或不完整时
fail-closed，不能猜测完成或失败、重复 error callback 或发布 `run.failed`，并返回
`finalization_projection_conflict`。
Finalization callback 前必须先保存 internal `finalization.reserved`。其 completion 时间由
execution-control 在 callback 前以 wall clock 确定，并由 callback、canonical Step/Result、completed
run 及 `run.completed` 共同复用；Activity retry 不得重新取时间。StepAttempt 仍保留本次 Temporal
Activity 的 schedule/start/end 与 worker evidence，不能用 attempt evidence 覆盖 canonical Step 的
产品完成时间。旧 run 没有 reservation 时，只能使用合法旧 internal `finalization.completed` 的时间，
或在已有 completed run 的明确成功证据下使用存储的 `run.CompletedAt`；不能猜测或回写历史事件。

app-api 按精确 `request_id` 读取 closeout 上下文，包括已终态请求的 replay；不比较请求创建时间与
execution-control 的完成时间。行锁、终态写入和 fingerprint 冲突裁决仍由产品持久化 owner 负责。

## 投影与严格性

Temporal 历史是执行事实。PostgreSQL 保存安全的 run、event、step、attempt 和 result
投影；app-api 将投影转换为 SSE 和产品响应，不重建执行状态。

HTTP `ExecutionRunStatus` 与 execution-control 内部运行状态保持一致，包含等待、准入、执行、
流式输出和终态。精确枚举、字段及响应结构只由 OpenAPI 维护；内部迁移规则见
[持久执行数据](../data/durable-runtime.md)。

面向 Campus Web 的 app-api 产品投影使用独立的事件名称和阶段合同：`execution.queued`、
`execution.running`、`execution.phase`、`answer.delta`、`request.completed`、
`request.failed`、`request.cancelled`。其中 `execution.phase` 只允许三个受控阶段，不能把
Temporal Activity、SDK tool、retry 或 worker 状态直接变成浏览器状态；回答过程由 app-api 从这些
产品事件派生一个调度事实和三个显示阶段，不返回 execution-control 的 attempt/result 轨迹，也不从
run 摘要或终态反推从未观察到的阶段。

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
[测试与验证](../reference/verification.md) 列出的 app-api 类型检查和测试通道。

## Runtime 检索状态流

Solve、Execute Step 和 Synthesize 支持内部 operation SSE；Execute Step 的摘要只在终态结果返回，
不能成为 `answer_delta`。`retrieval_status` 仅允许 Solve 和 Execute Step 产生，且只记录我们实际调度的
`campus_search`，携带 `schema_version=workflow_runtime_retrieval_status.v1`、`source=campus`、
`status=started|completed|no_match|failed|canceled` 和 RFC 3339 `occurred_at`。
同类并行调用由 Runtime 归并，工具 ID 和查询参数不跨入产品事件。

execution-control 校验并持久化为 browser-visible `run.retrieval_status`，payload 只含 source 和
status，沿用现有事件 sequence 与读取权限。正常结束须有本次 operation 的开始；流中断关闭仍活动的
检索，请求终态不能被迟到状态重新激活。App API 的公开字段与回放语义见
[Chat HTTP 合同](./app-api/chat.md)。已有 Campus Search 诊断不作为产品检索状态的存储或事实来源。
