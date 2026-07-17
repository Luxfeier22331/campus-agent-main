---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0082
status: accepted
partially_supersedes: ADR-0058
---

# ADR-0082：Hindsight 生产记忆生命周期

## 背景

ADR-0058 选择了 Hindsight，但没有冻结产品交付、来源删除、erase fence 和 observation policy。
服务尚未上线，因此不存在旧 bank 迁移或兼容义务。系统应使用 Hindsight 原生 extraction、
observation、consolidation、Memory Defense 和 bank cascade，不在仓库内重建第二套 provider
operation scheduler。

## 决策

- `profile.memory_settings`、`profile.memory_items`、`profile.memory_commands` 和
  `profile.memory_command_sources` 是产品 consent、desired state 与 outbox 真相。
- `personal_memory_command.v2` 在准入时冻结 lifecycle、item、source snapshot 和 source
  timestamp；provider activity 不重读可变产品行。
- 浏览器只看到 `pending`、`failed`、`erasing` 和稳定产品标识，不看到 Hindsight 标识。
- chat 准入原子冻结 recall/append gate、owner generation 和 owner sequence；后续执行不得重读
  setting 并改变该 turn 的合同。
- bank 由 tenant、user 和 owner generation 派生。pause 保留 bank；erase 递增 generation、
  拒绝旧 generation、等待旧调用排空、删除 bank 并验证不存在。
- execution-control 只保存 owner fence、bounded call lease 和 idempotent command receipt。
- 同一 owner 的后一条命令不得越过尚未完成或仍可重试的前一条命令。

## 来源与删除

每条 accepted user message 对应一个确定性 source document：
`conversation:<conversation_hash>:message:<message_hash>`。retain 使用 `async=false`、
`update_mode=replace`，只发送当前用户消息；assistant output 不进入长期记忆。

conversation prune/delete 在删除产品行前捕获 user message ID，以 50 条为一批派生相同 document
ID 并同步删除。不存在的 document 视为幂等成功。

## Hindsight 能力边界

- 启用 observations、automatic consolidation 和 Memory Defense sensitive-data redaction。
- retain 使用 private observation scope；recall 优先 observations，并只消费有界的
  `experience`、`observation` 和 `world` 事实。
- 不设置 `observations_mission`，由 Hindsight 原生默认策略管理 consolidation。
- campus-agent 不接收 Hindsight webhook，不轮询 operation ledger，也不代理
  status/list/cancel/retry。
- Hindsight 的后台 operation、恢复和 provider 调用属于其部署内部实现。

## Temporal 与终态

- recall/append 的临时失败由 Temporal heartbeat/retry 管理；append 在 finalization 后执行，
  失败不回滚已完成回答。
- command workflow 分离 provider mutation、receipt finalization 和 app-api callback。
- destructive privacy command 与 finalizer 无限重试；普通 upsert/lifecycle provider mutation
  使用有界重试。
- recall、primary agent 或 finalization 重试耗尽时，由 core queue failure finalizer 先写产品
  callback，再原子提交 failed run、conversation lock release 和 browser `run.failed`。
- browser、model 和 Temporal Failure 只保存固定公开消息、有界 kind 和 SHA-256，不序列化
  provider cause、callback body、bank/document ID 或 raw payload。

## 结果

仓库拥有产品交付、确定性来源生命周期和并发 fencing；Hindsight 拥有记忆物化与内部后台工作。
不 provision webhook ingress、webhook secret 或 provider-operation reconciliation schedule。

“track anything notable” 不作为仓库 prompt。它会重复 Hindsight observation system、制造不稳定
记忆标准，并让仓库承担 provider 已经拥有的模型行为。可验证边界是发送权威用户来源、启用原生
能力，并验证 recall quality 和 source deletion。

## 参考

- <https://hindsight.vectorize.io/developer/api/retain>
- <https://hindsight.vectorize.io/developer/api/documents>
- <https://hindsight.vectorize.io/developer/api/operations>
- <https://hindsight.vectorize.io/developer/memory-defense>
- <https://docs.temporal.io/develop/go/activities>
