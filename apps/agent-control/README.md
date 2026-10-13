# agent-control

Agent 控制面负责请求准入、启动与取消意图、运行投影、载荷、模型 receipt、产品终态和可靠结果投递。
它只提供内部 HTTP API，不运行 Workflow 或 Activity poller。

## 所有权

- agent-runtime 的 TypeScript Temporal Worker 拥有 AgentWorkflow、模型与工具 Activity；
  工具直接调用 Campus Search 和 Memory API。
- agent-control 是运行投影的唯一写入者。Runtime 通过 typed API 准备输入、保存 receipt、写事件和提交结果。
  Control 不改写规划、重规划或业务失败分类，API codec 不包含旧 HTTP 模型客户端。
- Memory 独立拥有 API、Worker、数据库、命令和 generation fence，只有 Memory 消费 Hindsight。
- 产品终态确认与待投递 Memory append 输入在 Control 数据库中可靠记录；dispatcher 向 Memory API 幂等投递。
  Memory 接收后自行执行，Control 不写 Memory 数据库。
- cluster-private-ingress 接收 Worker 的产品请求；Runtime 的投影 API 和集群内部工具请求不经过入口。

## 运行

入口是 `cmd/agent-control`，镜像与 Kubernetes Deployment/Service 均名为 `agent-control`。
`pnpm dev` 通过 [开发脚本](./scripts/dev.sh) 启动该入口。配置解析在 `internal/config`；
PostgreSQL schema/role、既有 Secret 对象及键保持原身份，不随应用改名迁移数据。

新运行固定启动 `AgentWorkflow`，不再按比例分桶。readiness 检查投影存储、Temporal 和新队列 poller，
不探测已退役的 HTTP Runtime。旧 Go Workflow、Worker 入口和 HTTP 工具路由已删除，不提供旧 history 支持。

## 内部结构

`executionapplication` 拥有准入与投影用例。`RuntimeInputService` 准备输入，
`RuntimeInvocationService` 拥有模型调用 receipt，`RuntimeResultBoundary` 校验结果，
`RunProjectionService` 写阶段、工具与回答状态投影并发布临时正文增量，`FinalizationService` 提交产品终态。
`runtimeapi` 按 action 使用独立请求和 typed port；`temporalclient` 仅拥有启动、取消、查询与 readiness，
`runtimeprojection` 校验 Runtime 传来的执行身份并绑定请求上下文。
`runtimeassembly` 装配 Control API、reconciler 和 Memory delivery dispatcher。

Runtime-Control JSON Schema 位于 `packages/contracts/schemas/agent-runtime-control.v1.schema.json`，
Go/TypeScript wire 类型由它生成。Control 校验并记录 Activity 的 Workflow/Run ID、Activity ID/type、
attempt、queue 和调度/开始时间；阶段重放沿用已保存身份，工具投影使用实际工具 Activity 身份。

临时载荷由既有 reconciler 清理：产品终态持久化、完成事件存在且 Workflow 已关闭后才删除；
finalization 重试期间保留输入。删除失败在下一轮重试，不改写产品终态；receipt 保持原生命周期。

Memory append 的共享输入合同位于 `packages/memory-api-go`；Control 不导入 Memory 服务实现。

## 回答增量

Runtime 先调用 `answer/started` 持久化开始，再通过 `answer/delta` 发布临时正文，最后持久化
`answer/completed`。开始操作可幂等重试，delta 不再隐式推进状态。Runtime-Control 正文索引为
`answer_index`，浏览器为 `answerIndex`，均不推进持久事件的 `sequence`。

正文增量通过现有 PostgreSQL 连接的独立 `LISTEN/NOTIFY` channel 广播，不写事件表。
Runtime 按至多 512 个 Unicode codepoint 分片；Control 的 buffered 回答也遵循相同限制。
每个 Control 副本保留每 run 最近 100 段、最多 50 KiB 正文，5 分钟未更新后在下一次访问时清除，
总量最多 1024 个 run。达到上限淘汰最久未更新的缓冲；持久终态不受影响。

内部 `/internal/execution/requests/:id/events` 带 `after_answer_index` 时，在原事件页中追加
`answer_deltas`；`next_sequence` 仍只属于持久事件。状态或正文到达均唤醒等待。
临时读取失败仍返回成功读取的持久事件；监听故障不会使长轮询空转。
不带该参数的历史事件读取不包含临时正文。新副本只接收监听建立后的广播，不能恢复已错过的草稿。

## 验证

`go test ./...` 运行本模块测试；`pnpm test:database-integration` 用真实 PostgreSQL
检查投影、receipt、运行并发和可靠投递。Memory 的状态及独立数据库测试由 Memory 模块拥有。
Agent 编排集成由 agent-runtime 的 `test:temporal-integration` 拥有。
回答传输的双副本、浏览器断线和发布故障验收见[回答传输 runbook](../../docs/runbooks/runtime/answer-transport.md)。

架构与部署见[Agent 框架](../../docs/architecture/system/agent-framework.md)和
[Temporal 运维](../../docs/runbooks/runtime/temporal.md)。
