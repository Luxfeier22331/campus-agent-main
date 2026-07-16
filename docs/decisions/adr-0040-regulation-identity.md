---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0040
status: accepted
---
# ADR-0040 规章标识

## 背景

如果 edition label 属于规章 root identity，每次修订都会变成不同文档，无法可靠表达版本
历史。

## 决策

规章 identity 将作品与版本分离：

- `regulation_work_title`：不含 edition label 的稳定规章名称；
- `regulation_edition_label`：版本或修订标签；
- `source_title_literal`：来源原始名称；
- `regulation_display_title`：派生的展示名称，不参与 identity。

`document_id` 使用 normalized work title、issuing organization 和 semantic scope 标识规章
作品。`version_id` 区分 semantic content、effective date 和 edition/revision signal。
source notice id 或 release time 是 provenance，不是 regulation identity 或 effective date。

`暂行`、`试行` 等 status qualifier 不自动成为 edition label，也不证明规则无效。cohort
year 和 document number 即使含数字，也不得自动解析为 edition。

canonical profile 记录此目标合同。仓库当前没有 regulation promotion materializer，profile
声明和示例 metadata 不能证明 target row 已重建。

## 后果

- 多个 edition 可以共享 work-level document id。
- display format 变化不改变 identity。
- duplicate source notice 可以在一个 regulation version 下聚合 provenance。
- 未来 materializer 必须测试 title parsing、identity stability 和 replay，才能宣称该模型
  已成为执行事实。

## 相关文档

- `docs/decisions/adr-0035-regulation-promotion.md`
- `configs/ingestion/regulations/institutional_rules/canonical-profile.json`
