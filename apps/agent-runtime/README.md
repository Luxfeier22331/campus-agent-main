# agent-runtime

拥有校园回答编排与模型、工具 Activity 的 TypeScript Temporal Worker；双轨期间保留 HTTP operation 服务。

## Temporal 运行入口

`workflows.ts` 拥有 Solve、Execute、Replan、Synthesize 的步骤顺序和请求级预算；
`activities.ts` 将单次模型请求与外部工具调用分别执行并保存 continuation。
`domain-tools.ts` 直接调用 Campus Search 和 Memory API；`control-client.ts` 通过 typed API
读写 control 拥有的载荷、invocation receipt、事件与最终投影。
模型调用返回后先保存 receipt 再推进；结果未知的已开始调用保持不确定结果合同。

`pnpm --filter agent-runtime dev` 同时启动旧 HTTP 服务与 Temporal Worker；独立 Worker 可用
`dev:worker` 启动。Worker 需要 `AGENT_RUNTIME_TEMPORAL_ADDRESS`、`AGENT_RUNTIME_TEMPORAL_NAMESPACE`、
`AGENT_CONTROL_BASE_URL`、`EXECUTION_AGENT_RUNTIME_SHARED_SECRET`、`MODEL_CONFIG_URL`，以及
Search/Memory 服务地址和内部密钥。HTTP 健康端口由 `AGENT_WORKER_PORT` 设置。
本地与部署的 Worker 启动参数均将地址族连接尝试等待设为 2000ms，与 HTTP 服务一致；该参数不改变
TLS 握手或整体请求截止时间。模型 Activity 在 receipt 和内部日志保留分类后的状态码、原因与调用 ID，
产品终态仍使用原有公开错误消息。
构建生成独立 Workflow bundle；模型 SDK 与外部 IO 仅加载在 Activity Worker。

旧 HTTP 模式的 operation 循环在双轨期间保留，下面 HTTP/SSE 说明适用于该入口。

## 职责

- 执行 Solve、Executor、Replanner 和 Synthesizer；Solve 可以直接回答，也可以返回任务计划；
- 严格解析并做结构 schema 校验 Solve/Replanner 返回的 JSON 文本，以及步骤摘要和最终文本；结构化合同不依赖
  Provider 强制执行 JSON Schema；
- Solve 可在已准入来源范围内直接检索并回答；Executor 只接收当前步骤声明且本轮获准的函数工具，
  两者复用同一工具预算、证据和 citation 合同；可用时支持托管 `web_search`；
- 消费 execution-control 提供的预期 Model Target hash、上下文和 operation 预算，并从共同受信任的
  Model Config 读取仍匹配该 hash 的 `primary_agent` 配置；该名称是历史配置键，不是 Agent 层级；
- 把本地函数调用交回 execution-control，不直接访问产品数据库、Campus Docs 数据库或 Hindsight；
- 将个人记忆 HTTP 返回的有序事实和字符预算格式化为模型上下文；
- 返回 operation 结果、证据、source attempts、模型用量和调用链关联信息；
- 通过 OpenTelemetry 与 Langfuse 记录受控模型轨迹。

持久执行、计划顺序、重新规划次数、取消、工具准入和产品终态属于 execution-control 与 Temporal。
本应用不保存会话或运行状态。

Solve 的模型输出使用根对象 `{ result: answer分支 | plan分支 }`，由 runner 解包为 operation 合同；
`workflow-runtime.ts` 统一严格校验互斥分支及长度/数量约束。Gemini 原生协议对结构化操作使用
提示词约定 JSON，不发送 `responseMimeType`，OpenAI 兼容协议使用 JSON object 模式；两条路径都将完整输出
合同放入指令，不发送供应商输出 Schema。函数工具的参数 Schema 保持不变，返回文本先解析 JSON，
再由 workflow-runtime 严格校验。Gemini 混合工具保留 `includeServerSideToolInvocations` 和 `VALIDATED`。
Synthesizer 的组合编号 `[1, 2]` 在输出时统一为 `[1][2]`，由既有引用闭包处理。
检索或 Solve 失败但已保留 evidence 时使用 recovery synthesis，只基于已有材料生成回答，不伪造 task plan。
Synthesizer 只使用材料已有的 citationIndex，且区分检索失败
与检索成功但无匹配，最终引用校验仍然保留。

Executor 与 Solve/Replanner 一样向 runner 传递结构化输出 schema；Executor 输出仍为
`summary`、`remainingFacts`。Adapter 已解码的 `structuredOutput` 直接交给 Runtime 校验，不重复
JSON 解码。JSON 语法或输出 schema 错误返回 `model_output_invalid` 和完整失败结果，已完成的
工具结果、证据、来源尝试及用量不会随异常丢失；不自动修复 JSON 或重试模型。
`max_output_tokens=0` 表示未设置应用输出上限，runner 不发送供应商 token 上限参数。

## 编排语义

外层是带 Replanning 的自适应 Solve→Execute→Synthesize。Executor 内可以发生多轮模型—工具调用，因此局部
接近 ReAct，但本应用不实现显式 thought/action/observation 状态机。仓库没有独立 skill runtime；当前只有
workflow operation 实现，不暴露尚未有真实消费者的策略枚举。

Replanner 的 `task_replan.v3` 只使用 `continue` 和 `synthesize`。Runtime 只负责版本、字段、枚举、
长度和数组结构；计划预算、依赖、候选来源可用性以及 decision 与 `remainingSteps` 的语义组合由
execution-control 统一准入。Replan 决策不符合这些语义时同样保存 `model_output_invalid` 失败结果及
用量，由 Workflow 继续既有获准路径；不执行被拒绝的新计划。该错误由 execution-control 发现，
没有 Runtime 格式失败原文快照。`reason` 说明决策原因，不构成额外执行状态。

Executor 通过 `summary` 保留已确认内容，通过 `remainingFacts` 表达本步骤尚缺事实。候选材料不等于
答案充分性；Synthesizer 统一回答材料支持的部分，并简短说明具体缺项，不使用回答模式枚举。
有候选材料、成功来源尝试或明确的来源不可用结果即可综合。Solve 已返回合法答案时直接最终化，
不因缺少 evidence 否决答案；模型、合同、取消与截止时间错误仍保持原有失败语义。
Runtime 和 Finalization 不重复判断材料是否足够，最终引用有效性检查保留。
资料不足的回答不注入检索覆盖范围、内部步骤或防御性说明，也不能把未查到表述为事实不存在。

HTTP 与 SSE 的错误响应和日志复用同一次分类结果及 operation/deadline 上下文。内部 `failure.detail`
保留最多 1024 字符的原因摘要，调用栈仅进入服务日志、最多 8192 字符；不记录原始模型正文、请求响应
对象或凭据。未知异常仍为 `run_failed`，不凭异常名称推断 provider 故障，也不改变恢复或重试策略。

模型输出格式失败另通过内部响应的可选 `model_output_diagnostic` 返回 Ops 专用诊断：解析前可见
文本最多 64 KiB（UTF-8 边界截断），原字节数、截断标记、JSON/结构校验阶段、错误摘要、schema
名称和 finish reason。只采集失败输出，不采集 thinking、prompt 或原始 SDK 响应；普通日志和
外部 trace 仍不记录正文。诊断不进入用户答案、后续模型上下文、receipt 或 Temporal history。

operation 消费准入时持久化的绝对 `deadline_at`，切换步骤、重规划或恢复不能重置期限；Model Config
读取也计入预算。检索预留 30 秒供回答生成，最终生成预留 5 秒供终态写入。Runtime 到期立即结束 HTTP/SSE
响应等待并返回 `agent_deadline_exceeded`，同时取消 SDK 与工具；不等待 SDK 清理后才发送终态。
正常成功仍等待完整 SDK 结果，迟到结果不能覆盖已发送终态。客户端先断开时停止该计时，不能在稍后
将取消改报成超时。Execution 只有未收到明确结果且传输期限到达时才使用 `agent_runtime_timeout`。

`max_model_turns` 与 `max_function_tool_calls` 按单个 operation 计数；`max_plan_steps` 与
`max_replans` 由外层 workflow 作为请求级预算执行。

## 内部边界

- `agent-run-contract.ts` 拥有 operation 输入输出合同；
- `workflow-runtime.ts` 拥有四类 operation 的指令、上下文与结果校验；
- `http-run-contract.ts` 负责 HTTP 请求校验与运行输入投影，`http-response.ts` 负责普通响应和 SSE
  wire 投影；
- `sdk-runner.ts` 只负责 OpenAI Agents SDK 与工具循环，不决定持久步骤顺序；
- `gemini-runner.ts` 使用官方 `@google/genai` 执行 GenerateContent、原生 Google Search 和函数循环；
- `provider-config.ts` 按 Model Config 的 provider/transport 选择 runner，不按模型名猜测，也不自动切换；
- `function-tools.ts` 共享本地工具预算、调用记录与 Campus citation 编号；SDK 数据结构、错误转换留在 adapter；
- `tool-executor.ts` 在工具 HTTP 返回后调用 `memory-context.ts`，将 recall 的 `{facts, context_char_budget}`
  转成 `{outcome, memory_text}`，再交给两种 runner 和调用记录；格式化按 Unicode codepoint 和完整行预算
  保留事实顺序，空事实返回 no_match；
- Provider、工具执行和 SDK runner 依赖上述 leaf contract，不反向依赖 HTTP server。

`google` + `google.generate_content` 选择 Gemini，`openai` / `openai-compatible` 配合
`openai.responses` / `openai.chat_completions` 选择 OpenAI。配置中的 Gemini Base URL 应包含 API 版本路径，
如 `https://generativelanguage.googleapis.com/v1beta`；网关同样填写其原生 Gemini API 根路径。
Solve/Executor 可使用已准入工具，Synthesizer 不使用工具；三者均可使用内部 SSE。
Executor 只输出检索状态和终态结果，不输出 answer_delta；Replanner 对调用者返回完整结果。
Responses 模型请求始终使用流式接收，包括缓冲回答、Executor、Replanner 和恢复合成；
是否投影 answer_delta 由现有回答展示模式决定，无增量消费者时收集完整响应后再解析和校验。
Solve/Executor 通过 `model_answer_transport` 选择回答 buffered/stream 展示；内部 SSE 两种模式均
实时上报检索状态。buffered Solve 只返回 decision 和完整终态，正文由 Execution Control 单次投影。
内部 `retrieval_status` 的 schema 为 `workflow_runtime_retrieval_status.v1`，字段为 `source`、`status`、
`occurred_at`。Runtime 从实际 campus_search 函数调用产生产品检索状态，execution-control 持久化后
由 App API 发布。Campus Search 排队不等于检索开始，已校验返回数量区分命中与无匹配。
模型内部网页搜索不产生产品检索事件；grounding 仅作为来源证据。
工具 ID 只用于 operation 内并发归并，原始参数和供应商响应不进入产品事件。
若失败的 Solve 已发出回答片段，recovery synthesis 使用非流式生成，并通过最终回答替换草稿，
不把两次生成的片段拼接。恢复没有新的计划或检索，只有已有 evidence、source attempts 和失败原因；
`recovery` 是输入来源，不是答案充分性分类。无材料时保留具体技术失败，确无可用材料则返回
`materials_insufficient`；已有材料但恢复生成失败返回 `answer_synthesis_failed`。取消与绝对截止时间优先。
引用预算耗尽以 `retrieval_budget_exhausted` 立即停止模型循环，已完成工具结果、用量和 provider response ID
随失败结果保存。Solve 转为计划时，其材料与尝试记录继续供 Executor/Replanner 使用。
Gemini 函数结果回传时保留完整模型 Content
及 thought signature，不把这些供应商对象送入 Temporal。Web grounding 在 runner 中转换为
`webEvidence`。流式调用保留每次 grounding metadata；支持文本优先于 UTF-8 偏移，无法转换的支持项
单独丢弃并计数。Solve 解包后映射到最终答案的 Unicode codepoint 位置，Finalization 在支持段末尾
插入引用，不替换正文；计划合成仍消费既有 evidence 编号。
`web_search_diagnostic` 只保存计数、状态和固定丢弃原因，随既有阶段净化投影进入 Ops；不保存查询、
prompt 或完整 SDK 响应。缺少 supports 不等于搜索无匹配，也不代表答案具有可核验引用。
Google 搜索建议 HTML 不进入运行结果或产品消息；网页搜索由模型内部处理；产品检索状态只来自实际 campus_search 工具调用，grounding 引用仍保留。
Gemini grounding 的 Google redirect 由本服务在返回结果前解析为独立的 `sourceLink`：原始 `url` 保留
evidence 身份，成功时 `sourceLink.href` 和页面标题指向原站；解析失败不丢弃答案或编号，只禁用来源卡。
解析器支持 HTTP 重定向与独立脚本页的静态 `window.location.href` 字符串跳转，不执行 JavaScript。
两种跳转共用公开地址、DNS、跳转次数、响应大小、并发和截止时间限制，不修改共享模型网关，也不回填历史消息。

## 入口

```bash
pnpm --filter agent-runtime dev
pnpm --filter agent-runtime build
pnpm --filter agent-runtime typecheck
pnpm test --filter=agent-runtime
```

## 相关文档

- `docs/architecture/system/agent-framework.md`
- `docs/architecture/system/prompt.md`
- `docs/architecture/system/tool-routing.md`
- `docs/architecture/system/durable-runtime.md`
- `docs/reference/telemetry.md`

## 容量指标与停机

独立 metrics listener 提供 `GET /metrics`，默认端口 9091；Kubernetes 通过 `METRICS_PORT=9090`
与命名端口 `metrics` 对齐。`agent_runtime_active_requests` 是无业务标签的 gauge，统计通过认证和
输入校验后接受的执行请求，直到普通响应或完整流完成、失败或断连。空闲时明确输出零，不统计探针。
此值表示 HTTP 承载量，不证明 Provider 容量或业务成功。

SIGTERM/SIGINT 后进入 draining，readiness 返回 503，新执行请求（包含已有连接上的请求）被拒绝；
已接受请求沿用原 deadline 和取消语义完成。HTTP 排空最多 350 秒，包含共享资源清理的进程退出最多
365 秒。Pod 终止前等待 10 秒供端点摘除传播，总宽限为 390 秒。正常响应完成后关闭排空中的连接，
避免 keep-alive 阻塞退出。扩缩容参数与指标采集由环境仓拥有，源码不调用 Kubernetes API。
