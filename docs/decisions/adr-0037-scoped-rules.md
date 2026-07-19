---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0037
status: accepted
---
# ADR-0037 范围规则

## 背景

年度周期、特定人群和限时操作规则不是稳定校级规章，但仍需要规范正文、适用范围和有效时间，不能
长期停留在通知包装中。

## 决策

- `regulations/scoped_rules` 保存年度或项目周期规则，以及有明确时间范围的操作规则；
- 该集合不保存通知包装、附件处理结果、稳定校级规章或没有产品用途的过期通知；
- 规范记录必须明确适用对象、组织、时间和来源；范围不足或已经失效的候选不能发布；
- 是否开放在线查询需要单独定义时间判断、范围过滤、歧义处理和评测，集合配置存在不会自动开放
  查询能力。

## 结果

- `institutional_rules` 保持稳定校级制度边界；
- 通知领域继续保存来源包装和来源信息；
- 限时规则可以拥有独立规范身份，而不被误认为永久制度。

## 相关文档

- `../architecture/domains/regulations.md`
- `adr-0035-regulation-promotion.md`
- `../../configs/ingestion/regulations/scoped_rules/README.md`
