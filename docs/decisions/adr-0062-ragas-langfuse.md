---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0062
status: accepted
---
# ADR-0062 Ragas 与 Langfuse

## 背景

ADR-0061 最初只允许 Ragas 从 offline repository artifact 获取输入，因此无法评测已经带有
相同 reviewed case identity 和有界评测字段的 Langfuse dataset run/trace。

## 决策

Ragas 可以评测：

- 版本化 offline `ragas_sample_batch.v1` artifact；
- 通过仓库 evaluation projection materialize 的 Langfuse dataset item 或 trace。

正常协作路径：

```text
reviewed case 或 selected trace
-> packages/eval-langfuse 构造 Ragas input
-> packages/ragas-runner 计算已开放指标
-> packages/eval-langfuse 发布 Langfuse score
```

evaluation projection 可以携带 case/trace identity、获准 user input、model answer、
retrieved/reference context 和 metric applicability，不得携带 credential、provider raw
response、unrestricted source body 或 backend dump。

`packages/eval-langfuse` 拥有 selection、projection 和 publication。
`packages/ragas-runner` 仍是仅负责计算的 Python process。Langfuse score 不替代 reviewed
case 或仓库 release policy。

## 与 ADR-0061 的关系

本决策只修订 ADR-0061 原有的 artifact-only Ragas input 假设。ADR-0061 的 runtime
ownership 和 Python island 边界继续有效，本 ADR 不替代它。

## 外部参考

- <https://langfuse.com/guides/cookbook/evaluation_of_rag_with_ragas>
- <https://docs.ragas.io/en/stable/howtos/integrations/_langfuse/>
