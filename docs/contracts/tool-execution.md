---
doc_type: contract
owner_boundary: apps/agent-control
status: active
---
# 执行合同

## 边界

本文规定 `apps/app-api` 与 `apps/agent-control` 之间的私有命令和查询合同。可执行
来源是 `schemas/tool-execution.openapi.yaml`，生成的 TypeScript 与 Go 类型必须与其一致。

- app-api 拥有浏览器认证、会话事实和浏览器传输；
- agent-control 拥有准入、Temporal 生命周期、内部查询策略、终态处理和安全投影；
- agent-runtime 的 TypeScript AgentWorkflow 推进阶段；单次模型请求与本地工具调用分别是 Activity；
- Runtime-Control 的 typed API 由 `agent-runtime-control.v1.schema.json` 定义，旧 Runtime HTTP/SSE 执行入口已删除；
- 浏览器不得直接调用本合同。

## 接口与认证

运行投影接口使用当前的 `/internal/agent/runs/...` 路径；旧的
`/internal/execution/requests/...` 和 `/api/internal/execution/requests/...` 路径不再注册，也不提供兼容别名。

### 模型输出失败的内部结果

JSON 解码或输出 schema 校验失败使用 `model_output_invalid`，以 `status=failed` 的完整 operation
结果返回，保留已完成工具结果、evidence、source attempts、模型用量和阶段耗时。失败不是成功摘要，
不设置成功的 completed step；由 Workflow 根据真实失败建立步骤状态，并使用保留下来的材料继续
既有合成流程。通用 `run_failed`、证据合同错误与未知执行状态不因此变成可恢复失败。
Replan 的 decision/剩余计划语义由 agent-runtime 的 `operation-rules.ts` 与 Workflow 校验；被拒绝的模型决策保存
`model_output_invalid` 及用量，Workflow 保留原获准计划而不执行无效替换。模型解析诊断由 Runtime 生成，Control 保存有界诊断供 Ops 查看；其他结果合同错误保留有界校验原因。
模型 receipt 按单次模型调用保存结果，重放不重新调用供应商；其内部载荷与 Ops 专用的
`model_output_diagnostic` 投影分开，不能据此将原始输出加入公开事件或后续模型上下文。

### 调用认证

- app-api 调用 agent-control 的运行创建、状态、事件、步骤和取消接口；
- agent-control 调用 app-api 的
  `GET /api/internal/agent/runs/{requestId}/input` 读取冻结输入。

前一组接口使用 agent-control 的内部认证，后一组接口只接受
`x-app-execution-auth`，其值来自双方共享的 `APP_API_INTERNAL_SHARED_SECRET`。该 Secret 只用于
agent-control 与 app-api 之间的执行输入读取及产品回调通道，不能用于浏览器或其他内部
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
hash。agent-control 读取输入时必须校验 ref、request、hash 与 1 MiB 上限，不能把 metadata
扩展成输入副本。

`tenant_id` 属于冻结的完整输入，不进入 metadata。调用方不能指定工具；Solve、Executor 和
Replanner 只能在准入快照与当前步骤允许的来源中作出选择。

调用方不得发送 document scope、version query、corpus、collection、top-k、provider、vector-store 或
task-queue 字段。

## 工具注册与开放

`configs/runtime/tools.v8.json` 与
`configs/runtime/tool-function-schemas.v4.json` 是运行时工具事实。当前登记的内部合同为：

- `campus_search`：按当前 Campus RAG 绑定检索中央民族大学当前 Campus Web 文档和已发布校园通知，返回供 Agent 选择的
  有界候选结果。
- `personal_memory_recall`：按当前 request 绑定的用户身份读取有界个人记忆。

两个工具的 exposure 都登记为 `model_visible`，但注册表本身不会自动向 Agent Runtime 开放工具。
agent-control 根据当前能力状态生成本轮工具集合：

- `visible_function_tool_names` 是名称唯一的集合，数组顺序没有路由语义；
- `solve` 可使用本轮准入的工具直接检索并回答；`execute_step` 只开放当前步骤候选来源对应的工具；
  `replan` 和 `synthesize` 不执行本地 function tool；
- `max_model_turns` 与 `max_function_tool_calls` 是单个 operation 的预算，`max_plan_steps` 与
  `max_replans` 是外层 workflow 的请求级预算；同一工具可以重复调用，不从数组顺序推导调用顺序。

以上字段和预算只描述本地 function tools。`web_search` 在 Solve 已准入，或在当前 execute step 的候选来源中被显式
允许时，Agent Runtime 才附加供应商原生搜索（OpenAI Web Search / Gemini Google Search）；它不进入工具注册表、
`visible_function_tool_names`、本地 `max_function_tool_calls`、agent-control handler 或
`tool_results`。该能力要求 `primary_agent` Model Config 使用 OpenAI Responses 或 Google GenerateContent；不兼容的 Chat
Completions 配置以
`model_config_incompatible` 拒绝，不进行 fallback。

`personal_memory_recall_allowed` 是当前 v6 私有 wire 字段，表示由个人记忆生命周期和就绪状态派生、
随本轮冻结的内部可用性，不表示用户同意状态或逐次读取授权。浏览器和用户文案不得暴露该字段、
recall 工具或执行结果。matched personal memory 只支持用户自身事实或偏好，不推导机构事实。

`campus_search` 的模型参数为 `search_query` 与 `search_goal`，分别表达召回查询和本次待确认的事实，
字段要求以[函数 schema](../../configs/runtime/tool-function-schemas.v4.json)为准；不接收 collection、
索引版本、provider、top-k 或 vector-store 字段。agent-runtime 的工具 Activity 通过内部 HTTP client 调用 Campus Search service，
后者在调用时读取当前 `campus_docs_serving.current_index`、embedding provider 和 reranker provider。
索引绑定由 agent-control 维护，时序见[检索服务](../architecture/system/retrieval-serving.md#在线消费边界)。
Campus Search service 先取得最多 24 个 hybrid 候选，再调用 `campus_docs_reranker` 配置中的固定 `Qwen3-Reranker-4B` 排序并保留
`relevance_score >= 0.5` 的候选。成功结果只包含 `outcome` 与最多 5 条 `results`；过滤后无候选返回
`no_match`。阈值只判断文本相关性，不判断学校、人群或规则适用主体；reranker 失败不得回退到未排序
候选。

Agent Workflow 的固定角色是中央民族大学校园问答助手，未明确指定机构的校内问题默认指中央民族
大学。工具定义声明各自能够提供的事实范围；Solve、Executor 和 Replanner 根据目标、当前步骤与
证据选择来源，不使用机构或其他实体名称级路由特判。`results` 是可供 Agent 判断的候选，不表示已经
用于回答。问题只有部分事实
被候选直接支持时，只回答有依据的部分；完全没有候选支持所需机构事实时，正常助手正文使用简洁的
“暂未找到相关资料”或“目前无法确认”，不暴露内部资料范围。

需要补充或核验公开校园网页信息时，Solve/Executor 可以选择当前已开放的 `web_search`；Replanner
可以调整后续步骤的候选来源。`campus_search` 的 `no_match` 表示本次查询没有匹配候选，工具失败表示
本次检索未成功；二者不会由代码自动触发 Web Search，也不能直接判定事实不存在或整个回答资料不足。
runner 在模型响应处解析 OpenAI URL annotation 或
Gemini grounding support，提取 URL、标题与对应文本片段作为中立 `webEvidence`。供应商 UTF-8/Part
位置只留在 adapter；Solve 直接回答通过 `web_evidence` 传递最终答案的 codepoint `start_index` /
`end_index`、`excerpt`、`title`、`url`，Finalization 校验精确正文跨度并在末尾插入引用，保留正文及
同段多来源。流式 metadata 不以最后一块覆盖前文；支持项不能映射时单项丢弃、记录诊断，不否决答案。
Workflow 为计划内的有效材料分配 citationIndex，Synthesizer 只使用这些编号输出 `[n]`。
Finalization 按正文实际引用产生统一编号链接与 `kind=web_page` 来源卡；模型手写 URL 不作为来源。
未引用材料和失败工具结果不贡献来源。

Solve 与 Synthesize 共用 Goldmark（CommonMark + GFM）AST 裸编号扫描，支持 `[1]`、`[1,5]`、`[1, 5]`；分组逐项校验、按书写顺序去重，
只扫描原始文本片段；代码、HTML、图片、转义方括号和已解析 Markdown 链接不参与扫描。
相邻 `[1][2]` 在无定义时是两个引用，有匹配的参考链接定义时遵循 Markdown 链接语义。
替换保留原始 UTF-8 字节位置，不重新序列化整条回答。Solve 按首次出现合并编号，Synthesize 保留材料编号。
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

同一 operation 可以通过独立工具 Activity 多次调用 `campus_search`。每次最多返回 5 条结果；每条结果携带本轮全局递增的
`citation_index`。单次调用内 `result_ref` 唯一；后续调用会排除本轮已经返回的 `result_ref`，同时保留
同一通知的互补章节。各编号到来源的映射保留至 Finalization，不能因 evidence 去重丢弃仍可支持答案的材料。
成功但没有结果的调用和失败调用不占用编号。只有正文实际
引用的结果才是 cited results；Finalization 从同一次 request 的成功工具结果中解析 `[n]` 并派生公开
来源卡片。失败工具结果和未被正文引用的候选不贡献来源；除上述已验证 Web 支持段尾部的冗余编号外，
未知或零引用使 Finalization 失败。

检索时间、模型轮次或工具调用预算耗尽后，使用已有材料进入恢复合成；
失败不丢弃已完成工具结果、evidence、source attempts、用量或 provider response ID。
所有 synthesis 输入只携带目标、汇总 evidence、source attempts 和 remaining facts，不携带
plan 或 completed steps，也不再检索。普通计划合成为 `mode=planned`；Solve 已有材料但失败时使用
`mode=recovery`，另传 recovery reason。Runtime 保留并提交完整 evidence/source attempts；
Control 校验和保存提交结果，不替 Runtime 恢复或补齐材料。
恢复成功正常完成产品回答；无材料时保留具体技术错误，资料确实为空时为 `materials_insufficient`；
有材料但恢复生成失败为 `answer_synthesis_failed`。取消与请求绝对 deadline 不被恢复覆盖或延长。
若 Solve 已发出正文，恢复结果整体替换草稿；Runtime 通过 Control typed API 提交回答状态和结果。
无法完成时保留原始失败原因，临时增量不能作为成功终态。

agent-runtime 的工具 Activity 将 `search_query` 与 `search_goal` 传给 Campus Search；
服务分别用于 dense/sparse 召回与 rerank。检索诊断的生成与当前透传范围见
[Campus Search 服务合同](./campus-search.md#agent-内部接口)。

Runtime 的 `executeTool` Activity 使用工具的 JSON Schema 校验模型参数，再调用共享工具执行器；
OpenAI 与 Gemini 使用同一验证边界。agent-control 读取函数 schema 参与工具合同指纹，
并负责运行身份、collection 绑定与结果投影边界。
Agent Runtime 返回的每个 `tool_results` 项包含实际 `tool_name`、`arguments_json`、`status`、
`duration_ms`、有界 `result`、实际 `invocation_id` 和可选结构化 `failure`。实际执行过的工具调用
还可以携带 `started_at` 与 `completed_at`，二者是 RFC3339 UTC 时间；`duration_ms` 仍由 Runtime
使用 monotonic clock 测量，不由这两个 wall-clock 字段反推。预算、身份或合同校验在工具执行器启动
前失败时不伪造工具时间区间。`failure` 只包含 `code`、`operation`、可选 `detail`、`http_status` 与 `invocation_id`；
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

agent-control 冻结准入指纹，Runtime 在模型或工具执行前验证合同，Control 在提交结果及
Finalization 时核对结果边界。指纹不匹配不能发布成功产品终态；错误通过 typed API 和 Activity
失败合同传播，不使用已删除的 Runtime HTTP 执行端点。

`DEPLOYMENT_RELEASE` 不进入工具指纹，release 仅用于诊断。工具指纹相同不证明
Runtime-Control DTO 或 Workflow history 兼容；更新须满足当前两端合同和排空要求。

## Agent 结果传递

一个 operation 可以包含多个模型轮次与工具调用。`AgentWorkflow` 调度 `modelTurn`、
`executeTool`、`completeTurn` 与 `completeStage` 等 Activity；具体输入输出由
[Temporal 合同](../../apps/agent-runtime/src/temporal-contract.ts)定义。

Runtime 的 `operation-rules.ts` 归一化模型输出并形成阶段决定；Control 校验并保存提交结果，
不返回另一套编排决定。Execute 保留摘要、remaining facts、证据和来源尝试；Synthesize 消费目标、
证据、来源尝试与 remaining facts，不执行新检索。Runtime 负责将合成材料保留在提交结果中。

完整模型 continuation、工具结果和阶段输入保存在 Control 内部载荷中；Temporal history 只传引用、
计划与有界阶段决定。单次模型调用 receipt 保存已完成结果，Activity 重投递先读 receipt，
已完成则恢复结果并修复投影，已开始但结果未知则以 `workflow_attempt_uncertain` 收口。
不保留旧 operation 级 HTTP 请求/响应或整轮 SDK run 的 receipt 执行路径。

`campus_search` 和 `personal_memory_recall` 均由独立工具 Activity 直接调用各自服务。
工具结果绑定当前 request；校园引用按实际调用顺序编号，不能跨 request 复用或从模型输出重建。
载荷、投影与清理的不同边界见[持久执行数据](../data/durable-runtime.md)。

## Temporal 与终态处理

`AgentWorkflow` 的阶段、队列和模型／工具 Activity 边界由
[持久 Agent 运行时](../architecture/system/durable-runtime.md)定义。

Workflow 输入只携带运行标识、截止时间和冻结准入快照，不携带冻结输入正文；
Activity 通过 Control API 读取输入与载荷，Temporal history 只携带引用与有界决定。app-api 产品终态及其 `finalization_fingerprint` 是跨系统
重复完成、取消和较晚结果的最终裁决；agent-control 的终态投影必须与该结果一致，不能先向浏览器
发布相冲突的终态。成功 callback 后只有 `FinalizeRunProjection` 成功追加的 `run.completed` 才能成为
浏览器成功终态；内部 `finalization.completed` 不是产品终态。

成功 finalization 在产品 callback 前完成 recovery response 的确定性字段与大小校验。callback 成功后
event 或 projection 写入失败时允许重发相同 response、fingerprint 和 completed time；app-api 必须返回
幂等 replay，且只保留一次产品完成效果。完成时间或响应冲突不得覆盖产品结果。

本次 operation DTO 切换不保留旧 history/receipt 合同。上线须先停止新请求准入、排空旧 workflow，
再协调更新 agent-control 与 agent-runtime 后恢复准入；工具 fingerprint 一致本身不能证明
operation DTO 兼容。本地验证不执行该部署。

所有 source-side Temporal Activity 在处理业务输入前，必须从当前 Activity context 读取 Workflow ID
和精确 Temporal Run ID，并与持久 start intent 的 Workflow ID/root Run ID 绑定比较。绑定尚未确认是
可重试失败；任一 ID 不同，包括外部创建的其他 execution，都是非重试身份失败。start 已 `superseded` 时只有
cancellation finalizer 可使用已绑定 root，其他 Activity 不得继续执行或写投影。

app-api 为已经分配 `request_id` 的产品请求保留完整执行输入和 hash；业务终态不会删除或清空它。
agent-control 不维护输入清理发件箱，也不提供释放回调。输入随 app-api 所有的会话和用户数据
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
记忆 recall、Campus Search 网络、阶段超时和索引不可用错误是非阻断来源失败；Campus Search
阶段错误使用 `campus_search_<stage>_failed` 或 `campus_search_<stage>_timeout` 保存实际阶段；工具参数、结果、身份和准入
合同错误仍阻断。没有可用材料且模型 operation 自身失败时仍保留具体技术错误。
原生联网搜索缺少支持段时记录 `completed` 尝试及独立诊断，不推断 `no_match`。

失败合同分为三个字段，不能互相补值：

- step/attempt `failure.code` 保存实际失败操作的稳定代码，是执行根因证据；
- run `terminal_reason` 是粗粒度终态分类，只允许表达 provider 不可用、运行超时、worker 明确不可用、
  运行不变量失败或中性的 `execution_failed` 等终态；
- run `fail_close_reason` 只说明协调器为何执行收口。

只有明确的 `worker_unavailable` 才能产生同名终态；工具失败、通用 Agent Runtime 失败和未知合法错误
都归入 `execution_failed`，不能伪装成 worker 不可用。Agent Runtime 返回已登记错误码时保留该码；
返回未登记码时 agent-control 使用 `agent_runtime_response_invalid`，并把有界原始码放在该 step
的诊断 `detail`。Agent Runtime 模型／工具 Activity 错误不直接决定产品 `retryable`；agent-control 在写产品终态
时根据失败事实显式决定用户能否用相同输入新建请求，且该值与 Temporal 重试策略无关。

`agent_deadline_exceeded` 表示 Runtime 的执行预算到期；取消继续传递给 SDK 和工具。
Runtime 与 Control 保留实际失败代码、operation 和有界 detail，不根据耗时推断另一种错误。
正常完成须取得完整结果，取消或超时后的迟到结果不得覆盖终态。

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
agent-control 在 callback 前以 wall clock 确定，并由 callback、canonical Step/Result、completed
run 及 `run.completed` 共同复用；Activity retry 不得重新取时间。StepAttempt 仍保留本次 Temporal
Activity 的 schedule/start/end 与 worker evidence，不能用 attempt evidence 覆盖 canonical Step 的
产品完成时间。旧 run 没有 reservation 时，只能使用合法旧 internal `finalization.completed` 的时间，
或在已有 completed run 的明确成功证据下使用存储的 `run.CompletedAt`；不能猜测或回写历史事件。

app-api 按精确 `request_id` 读取 closeout 上下文，包括已终态请求的 replay；不比较请求创建时间与
agent-control 的完成时间。行锁、终态写入和 fingerprint 冲突裁决仍由产品持久化 owner 负责。

## 投影与严格性

Temporal 历史是执行事实。PostgreSQL 保存安全的 run、event、step、attempt 和 result
投影；app-api 将投影转换为 SSE 和产品响应，不重建执行状态。

HTTP `ExecutionRunStatus` 与 agent-control 内部运行状态保持一致，包含等待、准入、执行、
流式输出和终态。精确枚举、字段及响应结构只由 OpenAPI 维护；内部迁移规则见
[持久执行数据](../data/durable-runtime.md)。

面向 Campus Web 的 app-api 产品投影使用独立的事件名称和阶段合同：`execution.queued`、
`execution.running`、`execution.phase`、`answer.delta`、`request.completed`、
`request.failed`、`request.cancelled`。其中 `execution.phase` 只允许三个受控阶段，不能把
Temporal Activity、SDK tool、retry 或 worker 状态直接变成浏览器状态；回答过程由 app-api 从这些
产品事件派生一个调度事实和三个显示阶段，不返回 agent-control 的 attempt/result 轨迹，也不从
run 摘要或终态反推从未观察到的阶段。

事件查询同时返回浏览器安全的 `events` 和 `next_sequence`。`next_sequence` 表示
agent-control 已检查到的持久序列游标；app-api 后续必须将它作为 `after_sequence`，即使本次
只有被过滤的内部事件而 `events` 为空。不能以“最后一个返回事件”的 sequence 推进游标，否则会
反复读取内部事件或漏掉其后的公开事件。

`request.accepted` 只表示 app-api 已持久化产品请求并提供可管理的稳定 `requestId`，不证明 Temporal
已经收取 workflow task。app-api 不为尚未从持久事件观察到的状态合成
`execution.queued`。`run.canceled` 是浏览器可见终态事件；浏览器断线只停止本次订阅，不取消 run。

- 拒绝未知字段和 camelCase 私有消息字段；
- 生成的 TypeScript 与 Go 产物必须匹配 OpenAPI；
- schema 校验后，工具与目标准入仍由服务端拥有；
- 原始 prompt、transcript、认证材料、完整执行输入和供应商载荷不得进入 agent-control
  metadata、Temporal 输入/history、event、step、日志或 trace；
- 不提供备用 parser、别名加载器、旧合同双请求结构或读取回退。

## 验证

运行 `pnpm --dir packages/contracts contracts:check`、手动 `go` validation profile，以及
[测试与验证](../reference/verification.md) 列出的 app-api 类型检查和测试通道。

## Runtime 检索状态与回答传输

Runtime 从冻结配置读取 `model_answer_transport`，通过 Control typed API 提交 `answer/started`、
`answer/delta`、`answer/completed` 和检索状态。不存在 Runtime 到 Control 的 operation SSE。
Execute Step 的摘要只用于后续编排，不能作为用户答案增量；恢复合成的正文整体替换先前草稿。

检索状态只反映实际调度的 `campus_search`；Control 将其投影为 `run.retrieval_status`，
App API 转换为产品事件。临时回答增量与持久事件分别使用独立游标；产品终态与回放语义见
[Chat HTTP 合同](./app-api/chat.md)和[Control 回答增量](../../apps/agent-control/README.md#回答增量)。
搜索内部诊断不作为产品检索状态的存储或事实来源。
