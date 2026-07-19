---
doc_type: architecture
owner_boundary: execution-control
status: active
---
# 持久 Agent 运行时

## 边界

本文定义在线回答的持久生命周期。Temporal 维护 workflow history、task queue、retry、timer
和 activity dispatch；execution-control 负责执行准入和有界投影；OpenAI Agents SDK 负责一个
Agent Activity 内的代理与工具循环。

## 主要对象

- `Conversation`、`Turn`：app-api 产品事实；
- `Run`：产品可见持久执行对象；
- `ToolExecutionWorkflow`：一个 run 的 Temporal workflow；
- `RunEvent`、`RunStep`、`StepAttempt`、`StepResult`：有界投影，不是 workflow
  history；
- `Finalization`：app-api 消费的已验证终态投影。

PostgreSQL 保存产品读取、运维和评测所需的有界投影，不是执行队列或 Temporal history 副本。

## 四个阶段

1. **Memory Recall**：在 core activity queue 准备可选的有界个人记忆上下文。
2. **Agent Activity**：在 agent queue 只调用一次 `apps/agent-runtime`，完成 Primary Agent、
   函数工具、Knowledge Agent handoff、内部搜索和结构化终态输出。
3. **Finalization**：在 core queue 校验终态输出与依据、生成来源并写入最终投影。
4. **Memory Append**：在 core queue 提交有界的回答后记忆更新。

SDK run 不按 tool call、handoff、retrieval、synthesis 或 grounding 拆成额外 Temporal
activity，也不存在工作流重新规划状态。

## Worker 池

- `workflow-worker`：workflow task queue；
- `activity-worker-core`：core activity queue；
- `activity-worker-agent`：agent activity queue。

不存在 knowledge/tool/retrieval/specialist worker。Temporal Worker Controller 管理版本，
KEDA/HPA 可以按版本扩缩，但不拥有 workflow state 或产品投影。

## Agent Activity

execution-control 提供运行标识、已准入的模型可见工具、查询目标、供应商配置和有界记忆上下文。
agent-runtime 返回结构化终态、SDK 工具摘要、用量和 trace 关联。

SDK `maxTurns` 只限制该 run 的代理与工具轮次，不是重试次数、重新规划预算或新的 Temporal
阶段。内部 SDK 工具在 Agent Activity 生命周期内调用带认证的 execution-control 查询接口。

## 取消、超时与终态处理

Temporal cancellation 和 activity deadline 必须传播到 agent-runtime 以及进行中的
供应商或内部查询调用。终态投影区分取消、超时、失败关闭和较晚完成；较晚成功不得覆盖已进入
终态的 run。

Finalization 执行确定性校验：

- 校验终态 schema 和允许的结果；
- 根据已开放 `knowledge_search` result 校验依据引用；
- 从可信依据 metadata 生成浏览器可用来源；
- 拒绝缺失、伪造或跨目标依据；
- 写入最终答案、来源、用量和终态原因。

Finalization 不调用 LLM、不生成第二个答案、不改写 SDK 答案；app-api 也不改写。

## 流式传输与容量

浏览器流式传输订阅有界 run event。HTTP 连接生命周期不拥有执行生命周期；
重新连接读取持久事件投影和当前运行状态，不启动另一条执行路径。

execution-control 根据运行就绪状态、策略和下游预算接纳新 run。进程内 limit 只是单进程保护，
Temporal task queue 与 worker 扩缩容共同定义部署容量。缺少 Temporal、
投影、供应商、内部查询、目标注册表或可信依据时拒绝接收或终结运行。

## 禁止形态

- 每个 SDK tool/specialist 一个 Temporal activity 或 queue；
- 独立 Knowledge Agent worker；
- 确定性 workflow 代码选择语义工具；
- 固定 retrieval/synthesis/grounding activity graph；
- 从 SDK 轮次派生持久重新规划状态；
- app-api 或 finalization 改写答案；
- 已索引知识回退到实时公网搜索。

## 相关文档

- `agent-framework.md`
- `k8s-runtime.md`
- `memory-plane.md`
- `../../contracts/app-api/request-lifecycle.md`
- `../../contracts/tool-execution.md`
- `../../contracts/temporal-queues.md`
- `../../data/durable-runtime.md`
- `../../runbooks/execution.md`
- `../../runbooks/temporal.md`
