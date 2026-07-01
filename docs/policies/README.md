---
doc_type: index
truth_scope: ops
owner_boundary: docs/policies
status: active
created: 2026-04-12
updated: 2026-04-12
---
# Policies

`policies/` 保存治理规则、质量门禁与 collection-specific 运行约束。

## 当前 policy 集合

- `official-web-crawl-policy.md`
- `official-web-cleaning-and-chunking-policy.md`
- `public-source-data.md`
- `student-handbook-chunking-and-validation-policy.md`
- `student-handbook-judge-gate-policy.md`

## 使用规则

- policy 写“必须/禁止/阈值”，不写执行历史
- 如果 policy 改变了长期边界，应同步补 ADR 或 architecture 文档
