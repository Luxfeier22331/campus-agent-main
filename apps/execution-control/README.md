# execution-control

Go 实现的内部执行运行时，承载基于 Temporal 的在线回答链路。

本应用拥有执行准入、运行策略、Temporal 命令与查询、取消、记忆 activity、内部查询准入、
证据校验、来源投影、脱敏运行投影和内部可观测性。它不面向浏览器。

## 当前接口

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `POST /internal/execution/runs`
- `GET /internal/execution/runs/:runId`
- `GET /internal/execution/runs/:runId/events`
- `GET /internal/execution/runs/:runId/steps`
- `POST /internal/execution/runs/:runId/cancel`
- 由 `x-execution-query-auth` 保护的内部查询和工具读取模型接口

Temporal 拥有工作流与 activity 调度。当前在线路径为：

```text
app-api -> execution-control -> Temporal -> context.memory_recall
-> 一个运行完整 OpenAI Agents SDK 循环的 agent activity
-> finalization.write -> context.memory_append -> app-api 读取投影
```

Primary Agent 在同一次 SDK run 中选择已准入函数工具或 handoff。知识问题通过官方
`handoff()` 进入 Knowledge Agent，后者只能调用内部 `knowledge_search`。

execution-control 校验知识目标与访问请求，执行 embedding 和 Qdrant dense/sparse RRF
检索，投影有界证据，校验终态证据引用，生成来源并写入终结结果。它不运行第二条知识队列、
RAG 图、独立合成模型或重规划循环。

## 边界

- `app-api` 继续拥有浏览器提交、状态和事件接口；
- `agent-runtime` 拥有唯一面向模型的代理与工具循环；
- 完整 Primary/Knowledge Agent run 位于 `activity-worker-agent`；worker pool 只有 workflow、
  core 和 agent 三类；
- app-api 持久化并流式输出已终结答案，不改写答案正文；
- Python supervisor 与 handoff serving 已退役，不得恢复；
- 函数工具和 handoff 默认关闭，只有运行时注册表、严格 schema、产品与评测均准入后才能
  开放；
- Hindsight 拥有个人记忆存储、提取和召回，execution-control 只消费有界召回结果并写脱敏
  投影；
- execution-control 拥有在线 Provider Config 的不可变 connection/profile、验证、完整 bundle
  激活、reader/admin 数据库角色和版本化 keyring；Ops Web 只通过内部 admin API 操作。

## 相关文档

- `docs/architecture/current.md`
- `docs/architecture/system/durable-runtime.md`
- `docs/architecture/system/agent-framework.md`
- `docs/architecture/system/tool-runtime.md`
- `docs/architecture/system/tool-routing.md`
- `docs/architecture/system/memory-plane.md`
- `docs/runbooks/local-smoke.md`
- `docs/runbooks/execution.md`
- `docs/runbooks/temporal.md`

## 本地开发

要求 Go `1.26.x` 和 `golangci-lint v2.11.4`。

```bash
pnpm go:check
pnpm repo:static
```

运行变量、在线 Provider Config、Hindsight、Qdrant、Temporal 和运行投影存储由上述 runbook 维护。
不得在本文加入未启用的兼容设置或本地 Secret 值。
