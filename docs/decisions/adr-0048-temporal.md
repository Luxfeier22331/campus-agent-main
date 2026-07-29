---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0048
status: accepted
---
# ADR-0048 Temporal 执行面

## 背景

在线回答必须能跨浏览器断线继续执行，支持取消和超时，并产生持久且产品安全的投影，不能让
PostgreSQL 记录或一次 HTTP 请求充当调度器。

模型运行时还需要一套一致的代理与工具循环。持久执行只能包裹该循环，不能复制语义路由。

## 决策

Temporal 是在线工作流引擎。PostgreSQL 只保存有界 run/event/step/result 投影以及投递命令和
幂等 receipt，不保存 workflow history 或队列状态副本。

持久工作流用少量稳定阶段包裹一次完整 Agents SDK run。Temporal 不把 SDK handoff、函数工具
调用或检索展开为额外 activity，也不承担语义工具选择。execution-control 负责运行准入、
Temporal 命令与查询、有界投影和确定性终态处理；Agents SDK 负责代理与工具循环和答案生成。
当前阶段、worker 池与终态校验见持久运行架构，不在 ADR 中重复。

创建 run 与启动命令必须在 execution-control 的同一事务提交，由 reconciler 幂等启动固定
Workflow ID；同步 HTTP 返回不是“Temporal 一定已启动”的证据。取消也先在 app-api 和
execution-control 各自提交持久命令，再由 reconciler 投递，不能依赖一次跨系统 HTTP 调用同时
改变两套状态。

原始执行输入由 app-api 以精确文本和 hash 拥有。Temporal 输入/history 与 execution-control
投影只保存 ref/hash 和有界标识，不能复制 prompt、会话或认证正文。

Primary Agent Activity 具有不可重复的外部模型副作用，因此禁用 Activity 自动重试，并以持久
invocation receipt 支持完整结果的只读恢复；已经开始却没有完整 receipt 的调用失败为不确定状态，
不重新执行。其他具备幂等边界的 activity 仍可按各自策略重试。

取消和超时必须从 Temporal 传播到 Agent Activity 和进行中的内部或供应商调用。取消后的终态
写入使用 disconnected workflow context，避免 cancellation 跳过持久 closeout。app-api 产品终态
和 fingerprint 裁决跨系统竞争；run 已终态后，较晚完成不得覆盖它。

## 后果

- 浏览器流式传输订阅持久的有界 event。
- API 接受只证明 run 与命令已持久化，不把命令投递伪装成 queue 状态。
- workflow、core activity 和 agent activity worker 可以独立扩缩容，不改变语义所有权。
- SDK `maxTurns` 是单次 run 内预算，不增加 workflow 阶段。
- SDK 工具调用可以投影为诊断轨迹，但不成为第二张 workflow graph。
- 缺少 Temporal、供应商、内部查询、知识目标或可信依据时失败关闭。
- 在线索引知识不提供实时公网搜索回退。

## 未采用方案

- **PostgreSQL queue**：会重复 workflow 重试、timer、heartbeat 和取消语义。
- **每个工具或 specialist 一个 activity**：会拆散 SDK 循环并产生多个语义所有者。
- **同步 HTTP 生命周期**：浏览器连接不能拥有回答运行。

## 相关文档

- `docs/architecture/system/durable-runtime.md`
- `docs/architecture/system/agent-framework.md`
- `docs/contracts/tool-execution.md`
