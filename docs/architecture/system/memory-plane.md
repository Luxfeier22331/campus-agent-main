---
doc_type: architecture
owner_boundary: execution-control
status: active
---

# 个人记忆

## 边界

Hindsight 是当前唯一个人记忆 runtime。Qdrant 只保存机构知识；仓库不再维护个人记忆
collection、embedding、extraction prompt、dedupe/merge 或 provider-backed extraction eval。

个人记忆是 user-scoped advisory context，可用于跟进、偏好、常用地点/服务、别名消歧、query
framing 和措辞。它不能决定身份、授权、来源信任、tool opening 或 fail-close。

## 所有权

| 所有者 | 职责 |
| --- | --- |
| Hindsight | retain、recall、reflect、extraction、graph、dedupe/merge 和 bank lifecycle |
| execution-control | bank/ID 派生、SDK 调用、policy、边界裁剪、内部命令和投影 |
| Temporal | Memory Recall、Memory Append 和内部 memory activity 生命周期 |
| app-api | 用户可见 profile-memory API、开关和 PostgreSQL 产品投影 |
| agent-runtime | 只消费 core activity 产生的有界 context |

app-api 不直连 Hindsight；agent-runtime 不持有 Hindsight credential 或 direct tool。

## Runtime 配置

部署向 execution-control/core worker 提供：

```text
PERSONAL_MEMORY_BASE_URL
PERSONAL_MEMORY_API_SECRET
PERSONAL_MEMORY_OWNER_SALT
```

runtime、timeout、recall limit/token 和 context char budget 由 execution-control runtime config
管理。Hindsight 自身数据库、provider 和 worker 属于其部署内部实现。

Hindsight 的 LLM/embedding 配置由 Hindsight 部署所有者管理，不经过 app-api 或在线执行
Provider Config。仓库只向 execution-control 交付 Hindsight 服务地址、API secret 和稳定 salt。

## 用户隔离

- 产品默认 tenant 为显式 `tenant-main`；
- bank ID 从稳定 salt、tenant 和 user ID 派生；
- conversation document ID 从 salt、bank 和 conversation ID 派生；
- explicit profile document ID 为 `profile:<memory_id>`；
- 产品 user/conversation ID 不直接作为 Hindsight object ID；
- salt 在同一环境必须稳定，不跨环境共享。

每次 retain、recall、reflect 或 profile delete 前，execution-control 先创建/更新
scoped bank，并回读确认 Memory Defense `sensitive_data -> redact` 已启用。bootstrap 或校验
失败时不继续 memory operation。

## 在线召回

```text
ToolExecutionWorkflow
-> MemoryRecallActivity
-> bootstrap scoped bank
-> Hindsight recall(world/experience/observation)
-> execution-control limit + token/char budget
-> sanitized memory context
-> Agent Activity
```

recall 使用 accepted user message 时间作为 `query_timestamp`。返回 fact 即使缺少
`occurred_*` 或 `mentioned_at` 仍可进入有界 context，此时更新时间为空。

`context.memory.enabled=false` 时不调用 Hindsight，并投影 skipped `memory.recall`。

## 完成轮次写入

finalization 完成后，Memory Append 以用户消息及其发生时间提交同步 retain。默认不把 assistant
answer 作为 Hindsight extraction 输入。

- retain 使用确定性 document ID、`update_mode=replace` 和私有 observation scope；
- Hindsight 成功返回即完成本次 append，不建立 operation polling 或 webhook 消费面；
- append 失败不回滚已完成答案，但必须记录 failed step 和有界指标；
- memory 关闭时投影 skipped `memory.append`。

## 显式个人资料记忆

app-api 负责 profile item 的产品校验和 PostgreSQL 投影，再通过 execution-control internal
command upsert/disable Hindsight document。owner disable 删除该用户 scoped memory，不为删除目的
创建不存在的 bank。

浏览器 response 只包含 product memory ID、key/value 和允许的状态，不包含 episode UUID、
bank/document/operation ID 或 provider metadata。

## Reflect

`MemoryReflectActivity` 和内部 reflect endpoint 提供 memory-grounded reasoning，返回受控文本、
structured output 和 `based_on` fact；它不是默认 final-answer owner。

Hindsight 后台 operation 属于其部署内部实现。campus-agent 不接收 webhook，也不提供
status/list/cancel/retry 接口或 reconciliation schedule。

## 投影

execution-control internal 可以保存 bank/document identity 和 generation fence；
student run-step projection 必须删除：

- 原始 Hindsight bank 和 document 标识；
- document 运行时引用；
- 原始结果元数据和载荷引用；
- API credential 或 provider 配置。

允许保留公共 step status、count、hash、timing 和 failure kind。

## Temporal 与失败语义

- recall 和 append 位于 core activity queue；
- timeout、heartbeat、retry 和 non-retryable error 由明确 activity policy 管理；
- deterministic config、request、bank policy 和 projection error 不 retry；
- 暂时 Hindsight transport error 使用有界 retry；
- Temporal 不是 memory database，不保存 raw recall/retain payload；
- memory 不可用不能通过 PG profile 全量注入、Qdrant 或 provider extraction 静默 fallback。

## 数据边界

- Hindsight：个人记忆图和操作；
- PostgreSQL `profile.*`：用户可见设置/item 投影；
- Temporal：Activity 生命周期；
- 执行投影：有界 step 和 result；
- Qdrant：机构知识；
- Langfuse：受信任模型 trace，可以观察有界 memory context，但不得包含 secret。

## 禁止形态

- Hindsight MCP 或 direct tool 暴露给 Primary Agent；
- app-api/agent-runtime 直接调用 Hindsight；
- personal memory 重新写入 Qdrant；
- raw memory/bank/operation payload 进入浏览器或 model-visible tool；
- memory 影响 tool/target admission 或授权；
- Zep 或 provider extraction 作为 fallback。

## 相关文档

- `../../decisions/adr-0058-hindsight.md`
- `durable-runtime.md`
- `identity-authz.md`
- `../../contracts/app-api/memory.md`
