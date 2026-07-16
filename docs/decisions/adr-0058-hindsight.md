---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0058
status: accepted
partially_supersedes: ADR-0015
---

# ADR-0058：Hindsight 自托管个人记忆

## 背景

个人记忆需要支持多用户、多会话 recall、完成轮次 append、用户显式管理、owner delete/RTBF 和
跨 thread recall。Qdrant-native 方案要求仓库自行维护 extraction prompt/schema、embedding、
dedupe/merge 和 collection 生命周期，这些不属于机构知识检索。

Hindsight 提供 retain、recall、reflect、异步 operation 和 memory bank 生命周期。系统需要采用
这些语义，同时把 policy、secret 和投影留在 execution-control。

## 决策

Hindsight 是唯一个人记忆 runtime：

- execution-control 通过官方 Go SDK/HTTP adapter 调用 Hindsight；
- Hindsight 拥有 extraction、graph、retain、recall、reflect、operation 和 bank lifecycle；
- Temporal 编排 Memory Recall 与 completed-turn Memory Append；
- app-api 的用户记忆接口调用 execution-control，不直连 Hindsight、pgvector 或 Qdrant；
- PostgreSQL `profile.memory_items` 只保存用户可见投影和内部 runtime ref，不是在线 recall 真相；
- Qdrant 只保留机构知识，不再保存个人记忆。

## Identity 与隔离

- 产品 tenant/user/conversation 只是派生输入，不直接成为 Hindsight object ID；
- 单校区默认 tenant 为 `tenant-main`，由产品合同显式传递；
- bank ID 由稳定 owner salt、tenant 和 user 通过 SHA-256 派生；
- conversation document ID 由 salt、bank 和 conversation 派生；
- explicit profile document ID 使用 `profile:<memory_id>`；
- browser 和 model-visible context 不暴露 bank/document/operation ID。

每次 retain、recall、reflect、operation 查询和 profile delete 前都必须 bootstrap bank，并确认
Memory Defense 的 `sensitive_data -> redact` 已生效；验证失败时关闭后续操作。

## 运行语义

- `context.memory.enabled` 同时控制 recall 和 append；关闭时投影 skipped step；
- recall 携带 accepted user message 的 `query_timestamp`；
- completed-turn retain 携带用户消息发生时间，profile retain 携带更新时间；
- completed-turn append 使用 async retain，Hindsight 接受请求后只能声明 `accepted`；
- graph materialization 必须由 operation status 或后续 recall/reflect 证明；
- 默认只把用户消息作为 completed-turn extraction 输入，assistant answer 不进入 graph extraction；
- operation status/list/cancel/retry 只作为 internal/operator 能力，返回受控 ref 和摘要；
- reflect 是内部 memory-grounded reasoning，不是默认用户答案所有者；
- append 失败属于 post-answer side effect，不回滚已完成答案，但必须写 failed step 和有界指标；
- memory timeout/retry 由 execution-control runtime config 和 Temporal activity policy 管理。

## 数据暴露

- execution-control internal 可以持有 bank/document/operation ID；
- operator 可以读取仓库 operation ref、status、kind、count 和 hash/shape 摘要；
- student API 必须删除 vendor ID、runtime ref、raw metadata 和 payload ref；
- model-visible tool/context 不得包含 Hindsight MCP、direct tool、raw ID 或 raw payload；
- operation status 必须使用 `include_payload=false`。

Hindsight 官方 Python tool/MCP 不直接暴露给 Primary Agent。TypeScript Agent SDK 只消费 core
activity 产生的有界 memory context。

## 配置后果

execution-control/core worker 需要：

```text
PERSONAL_MEMORY_BASE_URL
PERSONAL_MEMORY_API_SECRET
PERSONAL_MEMORY_OWNER_SALT
```

timeout、recall limit/token 和本地 context char budget 属于 execution-control runtime config。
agent activity worker 不需要 Hindsight credential。

Hindsight 自身 PostgreSQL/pgvector、LLM 和 embedding provider 是部署内部实现。provider profile
通过 app-api 所有的 `hindsight_llm`、`hindsight_embedding` role 投影给 Hindsight，app-api
不代理模型流量。

退役 Zep、personal-memory Qdrant collection、仓库 extraction provider/prompt 和相关 env。系统
不 dual-write，也不提供静默 fallback。

## 否决方案

- **保留 Qdrant 个人记忆**：仓库需要重建 Hindsight 已有的 graph/extraction/dedupe；
- **Qdrant 与 Hindsight 双写**：产生两份个人记忆真相和无法隐藏的一致性问题；
- **provider extraction fallback**：保留已退役合同并允许行为静默漂移；
- **直接暴露 Hindsight MCP/Python tools**：绕过 execution-control 准入、Temporal 生命周期、
  RTBF、secret 和多用户隔离。
