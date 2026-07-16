---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0037
status: accepted
---
# ADR-0037 范围规则

## 背景

年度周期和限时操作规则不是稳定校级规章，但把 canonical rule text 留在来源通知 collection
中，又会使它缺少 semantic owner。

## 决策

`regulations/scoped_rules` 保存以下 canonical 内容：

- annual 或 programme-cycle rule；
- time-bound operational rule。

它不保存 wrapper notice、attachment-processing outcome、稳定校级规章，或没有当前产品
用途的明确过期 source notice。

该 collection 不在 online query-target registry 中。serving profile 只描述 index
compatibility；当前 task registry 只能校验和 chunk caller 提供的 canonical document
unit。仓库没有 scoped rule 的 source promotion 或 materialization task。

开放 online target 需要独立决策和实现，定义 scope、effective-time handling、ambiguity、
filter 和 evaluation。这些未来 query rule 不是 import field，本 ADR 不提前冻结。

## 后果

- `institutional_rules` 保持稳定校级边界。
- `internal_notice` 保留 source wrapper 和 provenance。
- checked-in collection scaffold 不代表 scoped rule 可查询。
- 过期或 scope 不充分的 candidate 在 promotion 阶段失败关闭，不做 best-effort publication。

## 相关文档

- `docs/decisions/adr-0035-regulation-promotion.md`
- `configs/ingestion/regulations/scoped_rules/README.md`
- `configs/runtime/query-serving-targets.v1.json`
