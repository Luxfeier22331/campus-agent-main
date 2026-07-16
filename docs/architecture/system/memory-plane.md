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
| Hindsight | retain、recall、reflect、extraction、graph、dedupe/merge、operation 和 bank lifecycle |
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

Hindsight LLM/embedding 通过 app-api provider-config 的 `hindsight_llm` 和
`hindsight_embedding` profile 投影到部署环境；app-api 不代理流量。

## 用户隔离

- 产品默认 tenant 为显式 `tenant-main`；
- bank ID 从稳定 salt、tenant 和 user ID 派生；
- conversation document ID 从 salt、bank 和 conversation ID 派生；
- explicit profile document ID 为 `profile:<memory_id>`；
- 产品 user/conversation ID 不直接作为 Hindsight object ID；
- salt 在同一环境必须稳定，不跨环境共享。

每次 retain、recall、reflect、operation 查询或 profile delete 前，execution-control 先创建/更新
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

finalization 完成后，Memory Append 以用户消息及其发生时间提交 async retain。默认不把 assistant
answer 作为 Hindsight extraction 输入。

- Hindsight 接受请求后只投影 `accepted`；
- operation ID 只作为内部 runtime metadata；
- graph materialization 由 operation status 或后续 recall/reflect 证明；
- append 失败不回滚已完成答案，但必须记录 failed step 和有界指标；
- memory 关闭时投影 skipped `memory.append`。

## 显式个人资料记忆

app-api 负责 profile item 的产品校验和 PostgreSQL 投影，再通过 execution-control internal
command upsert/disable Hindsight document。owner disable 删除该用户 scoped memory，不为删除目的
创建不存在的 bank。

浏览器 response 只包含 product memory ID、key/value 和允许的状态，不包含 episode UUID、
bank/document/operation ID 或 provider metadata。

## Reflect 与 Operation

`MemoryReflectActivity` 和内部 reflect endpoint 提供 memory-grounded reasoning，返回受控文本、
structured output 和 `based_on` fact；它不是默认 final-answer owner。

operation status/list/cancel/retry 只服务 execution-control 和受权 operator：

- status 查询固定 `include_payload=false`；
- 对外只返回仓库 operation ref、status、kind、count 和 hash/shape 摘要；
- raw bank ID、vendor payload 和 result metadata 不进入 student/model surface；
- cancel/retry 只对 Hindsight 允许的 operation 状态生效。

## 投影

execution-control internal 可以保存 bank/document/operation identity；operator 可以读取受控诊断；
student run-step projection 必须删除：

- 原始 Hindsight bank、document 和 operation 标识；
- operation 与 document 运行时引用；
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
- `../../data/identity-platform.md`
