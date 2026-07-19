---
doc_type: architecture
owner_boundary: execution-control
status: active
---

# 个人记忆

## 边界

Hindsight 是当前唯一个人记忆 runtime。Qdrant 只保存机构知识；仓库不维护个人记忆 collection、
embedding、extraction prompt、dedupe/merge 或 provider-backed extraction eval。

个人记忆是 user-scoped advisory context，可用于跨会话跟进、偏好、地点、服务、别名消歧、query
framing 和措辞。它不能决定身份、授权、来源信任、工具开放或失败拒绝。

## 所有权

| 所有者 | 职责 |
| --- | --- |
| Hindsight | retain、recall、reflect、extraction、graph、dedupe/merge 和 bank lifecycle |
| execution-control | ID 派生、bank policy、SDK 调用、边界裁剪、内部命令、generation fence 和 receipt |
| Temporal | recall、append、个人记忆命令和删除检查点的 durable execution |
| app-api | 用户可见接口、consent、desired state、outbox 和 PostgreSQL 产品投影 |
| agent-runtime | 只消费 core activity 产生的有界 memory context |

app-api 不直连 Hindsight；agent-runtime 不持有 Hindsight credential 或 direct tool。运行配置归属见
[Provider 与模型配置](../../environment/providers.md)，本文件不复制环境变量。

## Identity 与隔离

- 产品默认 tenant 为显式 `tenant-main`；
- bank ID 从稳定 salt、tenant、user ID 和用户代次派生；
- 每条 accepted user message 对应
  `conversation:<conversation_hash>:message:<message_hash>` document ID；
- explicit profile document ID 为 `profile:<memory_id>`；
- 产品 user、conversation 和 message ID 不直接作为 Hindsight object ID；
- salt 在同一环境必须稳定，不跨环境共享。

每次 retain、recall、reflect 或 profile mutation 前，execution-control 创建或更新 scoped bank，
并确认 Memory Defense `sensitive_data -> redact` 已启用。bootstrap 或校验失败时不继续本次 memory
operation。

## 在线执行

在持久回答开始时，execution-control 冻结 `recall_enabled`、`append_enabled` 和用户代次。
召回 activity 在 Agent 运行前调用 Hindsight 并裁剪上下文；追加 activity 在产品终态写入后，以
确定性文档标识同步保留已接受的用户消息。完整阶段和队列关系由
[持久 Agent 运行时](./durable-runtime.md) 维护。

recall 使用 accepted user message 时间作为 `query_timestamp`。返回 fact 即使缺少 `occurred_*` 或
`mentioned_at` 仍可进入有界 context，此时更新时间为空。

append 使用确定性 document ID、`update_mode=replace` 和 private observation scope。Hindsight
同步返回后本次 activity 才成功；仓库不代理其内部 operation。append 失败不回滚已经完成的回答，
但必须记录 failed step 和有界指标。

gate 在 chat 准入时冻结，后续 activity 不重读可变设置。关闭 recall 或 append 时分别投影 skipped
step，不调用 Hindsight，也不从 PostgreSQL、Qdrant 或供应商抽取记忆。

## 用户管理与删除

app-api 在 PostgreSQL 中维护 lifecycle、item desired state 和 command outbox。execution-control
按用户命令序列接收命令，完成 Hindsight 修改后写入幂等 receipt；app-api 根据 receipt
更新用户可见状态。

- pause 保留当前 generation 的 bank 和 item，后续 turn 的两个 gate 均关闭；
- resume 重新允许后续 turn 召回和追加，不创建新 generation；
- item upsert/delete 使用确定性 profile document ID，删除不存在的 document 视为幂等成功；
- 账号全量清除会递增代次、拒绝旧代次、等待在途调用排空并删除上一代 bank；
- 账号全量清除还要按产品用户身份和上一代 bank 身份删除并复核 Langfuse trace；
- 所有删除检查点完成后，产品 lifecycle 才能从 `erasing` 进入 `erased`。

conversation prune/delete 在删除产品 message 前捕获 message ID，并派生与 retain 相同的 document
ID。删除后需要等待 Hindsight consolidation 生效，再确认来源不再通过 recall 返回。

## Reflect

`MemoryReflectActivity` 和内部 reflect endpoint 提供 memory-grounded reasoning，返回受控文本、
structured output 和 `based_on` fact；它不负责生成默认最终回答。Hindsight 后台 operation 属于
其内部实现，campus-agent 不接收 webhook，也不提供 status/list/cancel/retry 接口。

## 投影与遥测

execution-control 可以保存 bank/document identity、generation fence 和 command receipt。浏览器、
student run-step 和通用 Axiom 信号不得保存原始 bank/document/operation ID、provider payload 或
memory 正文；允许保存公共状态、计数、hash、timing 和 failure kind。

Langfuse 是受信任模型 trace，可以观察有界 memory context 和 Hindsight 原生模型调用。它不得被
复制到 Axiom 或 Sentry；具体内容与认证字段清理边界见 [Langfuse](./langfuse.md)。

## Temporal 与失败语义

- recall 和 append 位于 core activity queue；
- timeout、heartbeat、retry 和 non-retryable error 由明确 activity policy 管理；
- deterministic config、request、bank policy 和 projection error 不 retry；
- 临时 Hindsight transport error 使用有界 retry；
- Temporal 不充当 memory database，也不保存 raw recall/retain payload；
- recall gate 开启但 recall 最终失败时，当前 workflow 以失败终结；
- append 是回答完成后的 side effect，失败不回滚回答。

## 数据边界

- Hindsight：个人记忆图、bank 和内部操作；
- PostgreSQL `profile.*`：consent、desired state、command outbox 和用户可见投影；
- Temporal：Activity、命令和删除检查点生命周期；
- 执行投影：有界 step 与结果；
- Qdrant：机构知识；
- Langfuse：受信任模型和记忆 trace。

## 禁止形态

- Hindsight MCP 或 direct tool 暴露给 Primary Agent；
- app-api 或 agent-runtime 直接调用 Hindsight；
- personal memory 写入 Qdrant；
- raw memory、bank 或 operation payload 进入浏览器或 model-visible tool；
- memory 影响 tool/target admission 或授权；
- 使用 Zep 或供应商抽取维护第二条个人记忆路径。

## 相关文档

- [ADR-0058](../../decisions/adr-0058-hindsight.md)
- [ADR-0082](../../decisions/adr-0082-hindsight-lifecycle.md)
- [个人记忆接口](../../contracts/app-api/memory.md)
- [Durable runtime](./durable-runtime.md)
- [身份与授权](./identity-authz.md)
