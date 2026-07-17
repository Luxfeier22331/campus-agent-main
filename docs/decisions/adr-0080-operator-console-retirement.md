---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0080
status: accepted
supersedes:
  - ADR-0011
  - ADR-0012
  - ADR-0016
  - ADR-0018
  - ADR-0049
  - ADR-0055
  - ADR-0064
partially_supersedes: ADR-0072
---

# ADR-0080：退役 Operator Console 并按 runtime owner 收口控制面

## 决策

`apps/operator-console-web` 完全退役。Ops Web 是唯一受 Cloudflare Access 保护的运维浏览器
面，继续直接读取受限诊断数据，并通过同源 BFF 调用 execution-control 的私有 Provider Config
admin API。

在线执行 Provider Config 只包含 `primary_agent`、`rag_query_embedding` 和可选
`rag_reranker`。execution-control 拥有不可变 connection revision、profile、validation、
activation bundle、active pointer、idempotency receipt 和 append-only audit。API key 使用挂载
的版本化 keyring 做 AES-256-GCM 加密；key ID 与 AAD 属于密文合同。

激活按完整 role bundle 原子切换并要求 `expectedRevision`。每次顶层 Agent Activity 或
knowledge search 在开始时解析一次 active bundle；在途调用保留快照，新调用读取新 revision。
缺少 required role、数据库不可用或 keyring 不可解密时 fail closed。

Ops Web 使用不同的 read/command credential。服务 principal 默认只读；写操作只允许命中独立
human allowlist 的操作者，并要求配置的 HTTPS origin、JSON content type 和幂等键。Provider
admin 后端不可用不阻断 Ops Web 的请求诊断 readiness。

WeChat collector lifecycle 由 ingestion-control 直接拥有。collector 使用独立 token 调用
start/heartbeat/finalize；finalize 必须提供 capture-release bucket、object key、SHA-256 和 size。
终态事务写唯一 outbox，dispatcher 以确定性 task ID admit 并启动 Temporal task。

## 不迁移

旧 app-api provider、operator 和 WeChat ledger 不迁移、不导出、不双写、不保留兼容读取。
Hindsight 与 eval provider 配置仍由各自 runtime owner 管理，`index_embedding` 不作为在线 role
迁移。

## 结果

- app-api 只保留 browser-facing 产品 API、身份、会话和 chat lifecycle。
- execution-control 是在线执行 Provider Config 的唯一 owner。
- ingestion-control 是 source-channel lifecycle 与可靠 dispatch 的 owner。
- Ops Web 是唯一运维浏览器面，不持有数据库 provider credential，也不直接写配置表。
