# agent-runtime

TypeScript Temporal Worker 拥有 AgentWorkflow、模型 Activity 和工具 Activity。唯一生产入口是
`src/worker.ts`；旧 HTTP Runtime 已删除，不提供旧 history 支持。

## 所有权

`workflows.ts` 拥有 Solve、Execute、Replan、Synthesize 的持久顺序、取消与请求级预算。
`operation-rules.ts` 统一阶段结果与计划规则；Workflow 使用 Runtime 自己的持久阶段决定。
`activities.ts` 执行单次模型请求和单次本地工具调用，`domain-tools.ts` 直接调用 Campus Search
和 Memory API。模型托管 Web Search 属于模型调用，不伪装成本地函数工具。

`control-client.ts` 通过 typed API 读取冻结输入、保存 invocation receipt、载荷、事件与最终投影。
agent-control 保留这些状态的唯一写所有权；Runtime 不访问产品数据库或 Hindsight。
模型先读取 receipt：完成结果直接恢复，已开始但结果未知的调用不得再次发送。新调用返回后先保存
结果再推进投影；Activity 重试可修复投影，不重置绝对 deadline。

## 运行

```bash
pnpm --filter agent-runtime dev
pnpm --filter agent-runtime build
pnpm --filter agent-runtime typecheck
pnpm --filter agent-runtime test:unit
pnpm --filter agent-runtime test:temporal-integration
```

`dev` 与 `dev:worker` 均启动 Temporal Worker。构建输出 `dist/worker.js` 与独立 Workflow bundle；
模型 SDK 和外部 IO 仅加载在 Activity Worker。

必需配置为 `AGENT_RUNTIME_TEMPORAL_ADDRESS`、`AGENT_CONTROL_BASE_URL`、
`AGENT_CONTROL_RUNTIME_SHARED_SECRET`、`MODEL_CONFIG_URL`、`RETRIEVAL_BASE_URL`、
`RETRIEVAL_INTERNAL_TOKEN`、`MEMORY_SERVICE_BASE_URL` 和 `MEMORY_INTERNAL_SHARED_SECRET`。
`AGENT_RUNTIME_TEMPORAL_NAMESPACE` 默认 `default`；健康端口 `AGENT_WORKER_PORT` 默认 8000。
本地与部署的 Node 入口均将地址族连接尝试等待设为 2000ms，该值不改变 TLS 或整体请求截止时间。

同一进程注册 workflow、model 和 tool 三个队列，名称由 `temporal-contract.ts` 定义。
`/healthz` 表示进程存活，`/readyz` 要求三个 poller 全部运行。收到 SIGTERM/SIGINT 后撤销 readiness，
停止 poller，再关闭连接、来源解析器和遥测；模型与工具 Activity 分别有 5 分钟和 2 分钟退出宽限。
Kubernetes 的 390 秒终止宽限覆盖该过程。

## 模型与工具合同

`workflow-runtime.ts` 负责指令、模型上下文与 operation 输出解析；`agent-run-contract.ts` 定义中立合同。
`provider-config.ts` 按 Model Config 的 provider/transport 选择适配器，不按模型名猜测或自动切换。
OpenAI 路径使用 Agents SDK，Gemini 路径使用官方 `@google/genai`。

Solve 以根对象 `{ result: answer分支 | plan分支 }` 返回结果；Executor 返回 `summary` 与
`remainingFacts`；Replanner 使用 `continue` 或 `synthesize`；Synthesizer 生成最终正文。
Gemini 使用提示词约定 JSON，OpenAI 兼容协议使用 JSON object 模式；两者都不发送供应商输出 Schema，
返回后由 Runtime 严格校验完整合同。函数工具参数 Schema 保持不变。
Gemini 混合函数与托管搜索时保留 `includeServerSideToolInvocations` 和 `VALIDATED`。
格式失败保留已完成工具、证据和用量，不自动修复 JSON 或重试模型。

`function-tools.ts` 负责本地函数预算、实际调用记录和 Campus citation 编号。
Memory 返回有序 facts 与字符预算，`memory-context.ts` 按 Unicode codepoint 和完整行生成上下文。
模型自主决定是否召回，个人记忆不能代替机构事实。工具调用共享 tool Activity 队列。

Gemini continuation 保留完整模型 Content 与 thought signature，供应商载荷经 Control 保存为引用；
Web grounding 转换为中立 evidence，引用使用 Unicode codepoint 位置。来源解析器解析 Google redirect，
保留原 URL 身份、独立原站链接和页面标题；失败只禁用来源卡，不丢弃答案和编号。
Google 搜索建议 HTML 不进入产品消息，hosted search 不产生本地工具轨迹或校园检索事件。

Solve 直接返回合法答案即可最终化；返回计划时保留已获得材料供后续步骤使用。
失败且已有 evidence 时允许 recovery synthesis，不创建新计划、不重新检索、不重置 deadline。
流式草稿由最终恢复答案替换；取消、截止时间和引用校验仍优先。

## 输出与诊断

Activity 通过 Control API 发布临时回答增量、持久化校园检索状态与结果。产品终态仍由 Control 与 App API
按已有合同确认；会话记忆追加由 Control 可靠投递给 Memory，自此由 Memory Workflow 推进。

OTel/Langfuse 记录受控模型标识、用量、阶段结果和关联信息，不包含 prompt、工具原文或供应商凭据。
模型输出格式诊断只面向 Ops，不能进入用户答案或后续模型上下文。

## 相关文档

- [Agent 框架](../../docs/architecture/system/agent-framework.md)
- [持久运行时](../../docs/architecture/system/durable-runtime.md)
- [工具路由](../../docs/architecture/system/tool-routing.md)
- [Temporal 运维](../../docs/runbooks/runtime/temporal.md)

Runtime-Control 的 wire schema 与生成类型由 `campus-contracts/agent-runtime-control` 提供。
Activity 调用 Control 时携带真实执行身份和 retry attempt；`started_at` 在 Activity 函数进入时记录，
同一次 Activity 内保持不变。工具结果保存工具 Activity 元数据，阶段投影重试不改写已保存身份。

回答传输先确认持久 `answer/started`，再以独立 `answer_index` 发布临时正文。
临时投递最多等待一秒；网络或可重试服务故障停止本次模型调用的后续草稿发送，不改变最终结果。
取消、执行期限和合同错误仍按原语义处理；`answer/completed` 与最终结果继续可靠保存。
