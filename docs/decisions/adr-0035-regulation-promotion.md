---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0035
status: accepted
---
# ADR-0035 规章提升

## 背景

内部通知可以发布或附带规章，但通知 wrapper 不是规章本身。source-channel data 和 semantic
regulation data 需要不同 identity、quality gate 和 lifecycle owner。

## 决策

`campus_notices/internal_notice` 保留来源证据；
`regulations/institutional_rules` 是校级稳定规章正文的 semantic owner。

内容只能通过显式 offline promotion operation 在两者之间移动。promotion 必须：

- 选择可独立使用的规章正文，而不是发布 wrapper 或 attachment placeholder；
- 使用与 `notice_id` 无关的 regulation identity；
- 保留 source notice 和 attachment provenance；
- 合并同一规章版本的重复副本；
- 在 chunk 或 index publication 前校验 canonical document。

promotion 后原始 wrapper notice 仍留在 source channel。`policy_regulation` 等 notice-family
label 只是 candidate signal，不会发布规章。

当前仓库没有 promotion 或 source-materialization task。collection profile 和 query target
admission 只描述目标 shape，不能证明内部通知已被提升。完整 materializer 和 output
contract 存在前，不得增加 placeholder task。

## 后果

- source capture 成功不等于 regulation publication 成功。
- query-serving 只能消费独立发布的 canonical regulation data，不能消费 wrapper notice row。
- time-bound 或 unit-scoped rule 默认遵循 ADR-0037，不进入 `institutional_rules`。
- promotion 实现和验证属于未来 task owner，不属于 source collector。

## 相关文档

- `docs/decisions/adr-0037-scoped-rules.md`
- `docs/decisions/adr-0040-regulation-identity.md`
- `docs/data/internal-portal.md`
