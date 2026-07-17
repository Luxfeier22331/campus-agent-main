---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0049
status: superseded
superseded_by: ADR-0080
---

# ADR-0049：食堂发布

## 原决策

本决策建立了食堂 candidate-first 发布模型：来源观测先进入草稿，经不可变候选、校验与批准后
生成发布快照和 latest pointer。学生读取不得回退到草稿、来源观测或开发 seed。

## 取代与保留

ADR-0080 取代了 app-api/Operator Console 作为食堂操作控制面的部分。当前同步、审核和发布由
`jobs/dining-sync` 拥有，app-api 只提供学生公开读取接口。

候选优先、发布快照、审计和禁止回退语义仍由 dining 领域文档与 owner tests 维护，不再由本
历史 ADR 充当当前所有者。

当前边界见 `docs/architecture/domains/dining/architecture.md`、`docs/data/dining.md` 和
`docs/runbooks/dining.md`。
