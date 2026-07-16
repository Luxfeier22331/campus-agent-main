---
doc_type: architecture
owner_boundary: execution-control
status: active
---
# 持久 Agent 运行时

## 边界

本文拥有在线回答的持久生命周期。Temporal 拥有 workflow history、task queue、retry、timer
和 activity dispatch；execution-control 拥有 admission 和脱敏产品 projection；OpenAI
Agents SDK 拥有一个 Agent Activity 内的 agent/tool loop。

## 主要对象

- `Conversation`、`Turn`：app-api 产品事实；
- `Run`：产品可见持久执行对象；
- `ToolExecutionWorkflow`：一个 run 的 Temporal workflow；
- `RunEvent`、`RunStep`、`StepAttempt`、`StepResult`：脱敏 projection，不是 workflow
  history；
- `Finalization`：app-api 消费的已验证终态 projection。

PostgreSQL 保存产品读取、operator 和 eval 所需 projection，不是 execution queue 或 raw
Temporal history store。

## 四个阶段

1. **Memory Recall**：在 core activity queue 准备可选有界 personal-memory context。
2. **Agent Activity**：在 agent queue 只调用一次 `apps/agent-runtime`，完成 primary agent、
   function tool、Knowledge Agent handoff、internal search 和 structured terminal output。
3. **Finalization**：在 core queue 校验 terminal output/evidence、生成 source 并写最终
   projection。
4. **Memory Append**：在 core queue 提交有界 post-answer memory update。

SDK run 不按 tool call、handoff、retrieval、synthesis 或 grounding 拆成额外 Temporal
activity，也不存在 workflow replan state。

## Worker 池

- `workflow-worker`：workflow task queue；
- `activity-worker-core`：core activity queue；
- `activity-worker-agent`：agent activity queue。

不存在 knowledge/tool/retrieval/specialist worker。Temporal Worker Controller 管理版本，
KEDA/HPA 可以按 version 扩缩，但不拥有 workflow state 或产品 projection。

## Agent Activity

execution-control 提供 run identity、admitted visible tool、query-serving target、provider
config 和有界 memory context。agent-runtime 返回 structured terminal output、脱敏 SDK tool
summary、usage 和 trace correlation。

SDK `maxTurns` 只限制该 run 的 agent/tool turn，不是 retry count、replanning budget 或新
durable phase。internal SDK tool 在 Agent Activity 生命周期内调用带认证的 execution-control
query endpoint。

## Cancel、Timeout 与 Finalization

Temporal cancellation 和 activity deadline 必须传播到 agent-runtime 以及进行中的
provider/internal-query call。终态 projection 区分 cancellation、timeout、fail-close 和 late
completion；late success 不得覆盖已终态 run。

Finalization 执行确定性校验：

- 校验 terminal schema 和允许 outcome；
- 根据已开放 `knowledge_search` result 校验 evidence ref；
- 从受信任 evidence metadata 生成 browser-safe source；
- 拒绝缺失、伪造或 cross-target evidence；
- 写入 final answer、source、usage 和 terminal reason。

Finalization 不调用 LLM、不生成第二个答案、不改写 SDK answer；app-api 也不改写。

## Streaming 与容量

browser streaming 订阅脱敏 run event。HTTP connection lifetime 不拥有 execution lifetime；
reconnect 读取持久 event projection 和 current run state，不启动 fallback execution。

execution-control 根据 runtime readiness、policy 和 downstream budget 接纳新 run。process-local
limit 只是保护，Temporal task queue 和 worker autoscaling posture 定义部署容量。缺失
Temporal、projection、provider、internal query、target registry 或 evidence truth 时失败关闭。

## 禁止形态

- 每个 SDK tool/specialist 一个 Temporal activity 或 queue；
- 独立 Knowledge Agent worker；
- deterministic workflow code 选择 semantic tool；
- 固定 retrieval/synthesis/grounding activity graph；
- 从 SDK turn 派生 durable replanning state；
- app-api 或 finalization 改写答案；
- indexed knowledge 回退到 live public web search。

## 相关文档

- `agent-framework.md`
- `k8s-runtime.md`
- `../../contracts/durable-runtime.md`
- `../../data/durable-runtime.md`
