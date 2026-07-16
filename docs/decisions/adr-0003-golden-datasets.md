---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0003
status: accepted
---
# ADR-0003 黄金数据集

## 背景

Langfuse 可以保存 dataset、run、score 和 annotation，但平台状态不得静默改写产品的
预期行为。旧 ADR 还冻结了一套并未实现的 case schema 和 split 分类。

## 决策

经评审的 case 和 qrel 是仓库评测流程拥有的产品事实。Langfuse、Ragas 和其他 grader
消费这些事实，其默认格式和生成结果不能定义它们。

一条权威 case 需要足以表示输入、预期 outcome、预期工具或搜索路径、支持答案的参考，
以及适用时的禁止证据或声明。版本化 case shape 由 `packages/eval-langfuse` 和
`docs/reference/eval-cases.md` 维护，本 ADR 不复制字段。

规则：

- stable case id 不得静默改成另一条事实；
- 生成、trace 或 incident 派生的 case 在评审前只是 candidate；
- score 和 annotation 可以提出修改，但不得自动改变权威事实；
- 确定性运行时 fixture 留在所属运行时，不复制进中央黄金数据集；
- 公开仓 case 只使用可公开数据；私有学校 case 可以通过批准的私有 asset root 或
  Langfuse dataset 复用同一合同。

split 名称、样本数量和发布阈值属于操作策略，不是本 ADR 的架构约束。

## 后果

- `packages/eval-langfuse/assets` 保存公开 Langfuse dataset case。
- Langfuse 是协作和执行平台，不是改写预期行为的权威来源。
- Ragas 可以在 case 合同后替换。
- incident case 入库前必须完成脱敏、去重和来源核验。

## 相关文档

- `docs/reference/eval-cases.md`
- `docs/decisions/adr-0061-eval-runtime.md`
- `docs/decisions/adr-0062-ragas-langfuse.md`
