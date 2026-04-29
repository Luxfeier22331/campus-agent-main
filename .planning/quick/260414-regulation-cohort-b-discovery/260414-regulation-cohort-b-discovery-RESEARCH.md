# Quick Task 260414-regulation-cohort-b-discovery Research

## External References

### 1. Databricks medallion architecture

- Link: https://docs.databricks.com/gcp/en/lakehouse/medallion
- Why it matters:
  - 官方把数据层分成 raw / validated / enriched 的递进层，不建议把低置信、未澄清的 source-side 记录直接推进到 business-facing curated layer。

### 2. dbt staging best practices

- Link: https://docs.getdbt.com/best-practices/how-we-structure/2-staging
- Why it matters:
  - 这份文档把 staging 描述成 source-conformed / atomic building blocks，强调先保留来源语义，再做后续 business-facing 汇聚。

### 3. dbt marts best practices

- Link: https://docs.getdbt.com/best-practices/how-we-structure/4-marts
- Why it matters:
  - 官方把 marts 定位成 business-defined entities；也就是说，进入 marts 的对象必须已经具备明确业务身份，而不是“可能像”的 source record。

## Mapping To This Repo

这是基于上述来源的工程推断，不是这些文档直接规定本仓库必须这样实现。

- `campus_notices/internal_notice` 应继续承担 source / triage / validation 层角色。
- `regulations/institutional_regulations` 对应 curated business entity 层，只能接收真实制度正文 owner。
- 因此：
  - wrapper notice 里的正文引用不能直接定义 regulation identity
  - source body 的章节标题不能直接定义 regulation title
  - attachment/file-release backed owner body 缺失时，应停在 source/manual-review，而不是污染 regulation layer

## Decision

- 继续保留 notice / attachment / regulation 三层分离。
- 收紧 parent notice promotion：formal-regulation signal 只信任 title-level signal。
- Cohort B 的真实下一步转为 owner-body recovery，而不是继续放宽 direct parent-body promote。
