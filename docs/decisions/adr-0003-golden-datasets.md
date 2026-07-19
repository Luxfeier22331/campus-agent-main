---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0003
status: accepted
---

# ADR-0003 评测数据集

## 背景

Langfuse 可以保存数据集、运行、评分和人工评审，但平台中的自动生成内容不能直接定义产品的
预期行为。运行 trace 和线上问题适合发现候选 case，不适合未经评审成为权威测试输入。

## 决策

经评审且版本化的 case 是仓库评测流程拥有的产品事实。Langfuse、Ragas 和其他评分器消费这些
case，但不能根据模型输出或平台状态静默改写它们。

每条 case 应按适用场景表达输入、预期结果、预期工具或搜索路径、参考答案或上下文，以及禁止
出现的证据或声明。精确 shape 由 `packages/eval-langfuse` 和
`docs/reference/eval-cases.md` 维护，本 ADR 不复制字段。

规则：

- 稳定 case ID 不能在不变更版本的情况下表示另一条事实；
- 从生成结果、trace、人工标注或线上问题得到的样本在评审前只是 candidate；
- score 和 annotation 可以提出修改，但不能自动改变已评审 case；
- 确定性运行时 fixture 留在所属运行时，不复制进中央数据集；
- 公开仓 case 只使用可公开数据，私有学校 case 通过获准私有来源进入同一评测合同。

数据集拆分、样本数量和执行频率属于评测操作策略，不是本 ADR 的架构约束。

## 后果

- `packages/eval-langfuse/assets` 保存公开的版本化 case；
- Langfuse 是协作和执行平台，不是预期行为的唯一来源；
- incident case 入库前需要完成脱敏、去重和来源核验；
- 更换评分器不改变 case 的身份与评审要求。

## 相关文档

- `../reference/eval-cases.md`
- `adr-0004-evaluation-metrics.md`
- `adr-0061-eval-runtime.md`
