# agent-control

Agent 控制面负责请求准入、启动与取消意图、运行投影、载荷、模型 receipt、产品终态和可靠结果投递。
它只提供内部 HTTP API，不运行 Workflow 或 Activity poller。

## 所有权

- agent-runtime 的 TypeScript Temporal Worker 拥有 AgentWorkflow、模型与工具 Activity；
  工具直接调用 Campus Search 和 Memory API。
- agent-control 是运行投影的唯一写入者。Runtime 通过 typed API 准备输入、保存 receipt、写事件和提交结果。
- Memory 独立拥有 API、Worker、数据库、命令和 generation fence，只有 Memory 消费 Hindsight。
- 产品终态确认与待投递 Memory append 输入在 Control 数据库中可靠记录；dispatcher 向 Memory API 幂等投递。
  Memory 接收后自行执行，Control 不写 Memory 数据库。
- cluster-private-ingress 接收 Worker 的产品请求；Runtime 的投影 API 和集群内部工具请求不经过入口。

## 运行

入口是 `cmd/agent-control`，镜像与 Kubernetes Deployment/Service 均名为 `agent-control`。
`pnpm dev` 通过 [开发脚本](./scripts/dev.sh) 启动该入口。配置解析在 `internal/config`；
PostgreSQL schema/role、既有 Secret 对象及键保持原身份，不随应用改名迁移数据。

新运行固定启动 `AgentWorkflow`，不再按比例分桶。readiness 检查投影存储、Temporal 和新队列 poller，
不探测已退役的 HTTP Runtime。旧 Go Workflow、Worker 入口和 HTTP 工具路由已退役；
非编译历史源码保存在 `archive/legacy-agent-workflow`，不提供旧 history 支持。

## 内部结构

`executionapplication` 拥有准入与投影用例，`operation` 保留当前 Runtime API 使用的输入准备和结果归一化，
`finalization` 拥有终态回调及恢复，`executionpersistence` 保存有界投影与投递事务。
`runtimeapi` 服务 Runtime typed API，`httpapi` 服务产品控制与查询，`temporalruntime` 是启动和查询客户端。
`runtimeassembly` 只装配 Control API、reconciler 和 Memory delivery dispatcher。

Memory append 的共享输入合同位于 `packages/memory-api-go`；Control 不导入 Memory 服务实现。

## 验证

`go test ./...` 运行本模块测试；`pnpm test:database-integration` 用真实 PostgreSQL
检查投影、receipt、运行并发和可靠投递。Memory 的状态及独立数据库测试由 Memory 模块拥有。
Agent 编排集成由 agent-runtime 的 `test:temporal-integration` 拥有。

架构与部署见[Agent 框架](../../docs/architecture/system/agent-framework.md)和
[Temporal 运维](../../docs/runbooks/runtime/temporal.md)。
