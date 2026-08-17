---
doc_type: reference
owner_boundary: docs/reference
status: active
---

# Agent 编排研究参考

## 用途

本文维护 Agent 编排、检索和评测设计可能引用的外部研究。论文结果不证明仓库已实现某项能力，也不
构成产品性能承诺；当前行为由代码、合同和架构文档维护。

证据优先级为同行评议论文、框架官方工程材料和仓库自身评测。外部数据集收益不能替代 Campus Agent
的真实问题集、延迟分布和人工评审。

## 自适应检索与工具循环

| 来源 | 可参考结论 | 使用限制 |
| --- | --- | --- |
| [Adaptive-RAG](https://aclanthology.org/2024.naacl-long.389/) | 可按问题复杂度选择不同检索预算 | 不证明必须增加远程分类模型 |
| [ReAct](https://openreview.net/forum?id=WE_vluYUL-X) | 复杂任务可以交替推理与行动 | 工具循环会增加往返，必须有界 |
| [IRCoT](https://aclanthology.org/2023.acl-long.557/) | 多跳问题的后续检索可能依赖前一步结果 | 只适用于存在真实依赖的子问题 |
| [Self-RAG](https://openreview.net/forum?id=hSyW5go0v8) | 检索应按需发生并评价证据 | 特殊训练机制不能直接移植到闭源 Provider |
| [STORM](https://aclanthology.org/2024.naacl-long.347/) | 多视角资料整理可以改善长文覆盖 | 不用于证明普通回答需要多角色流水线 |

## 并行与延迟

| 来源 | 可参考结论 | 使用限制 |
| --- | --- | --- |
| [LLMCompiler](https://proceedings.mlr.press/v235/kim24y.html) | 无依赖工具节点可以并行执行 | 额外规划调用可能抵消收益 |
| [Divide-Then-Aggregate](https://aclanthology.org/2025.acl-long.1401/) | 独立子任务可以并行后聚合 | 论文训练方法不等于应用实现要求 |
| [Parrot](https://www.usenix.org/conference/osdi24/presentation/lin-chaofan) | 显式数据依赖有助于端到端调度 | 主要依赖推理服务能力 |

## 工具和评测

| 来源 | 可参考结论 | 使用限制 |
| --- | --- | --- |
| [SWE-agent](https://proceedings.neurips.cc/paper_files/paper/2024/hash/5a7c947568c1b1328ccc5230172e1e7c-Abstract-Conference.html) | 工具接口会显著影响 Agent 行为 | 应先改进工具合同，而不是增加包装 |
| [AgentBench](https://openreview.net/forum?id=zAdUB0aCTQ) | 长程决策和指令遵循仍是主要失败来源 | 轮次、期限和停止条件必须可验证 |
| [ALCE](https://aclanthology.org/2023.emnlp-main.398/) | 答案质量和引用支持需要分别评价 | 引用存在不表示所有主张获支持 |
| [ARES](https://aclanthology.org/2024.naacl-long.20/) | RAG 应分别评价上下文和答案 | 自动评审仍需人工标注校准 |
| [RAGChecker](https://papers.nips.cc/paper_files/paper/2024/hash/27245589131d17368cccdfa990cbf16e-Abstract-Datasets_and_Benchmarks_Track.html) | 应分别诊断召回与生成 | 指标必须通过正式适配器接入 |

## 上下文

| 来源 | 可参考结论 | 使用限制 |
| --- | --- | --- |
| [Sufficient Context](https://iclr.cc/virtual/2025/poster/30092) | 相关文本不等于信息足够 | 需要单独判断是否可回答 |
| [Lost in the Middle](https://doi.org/10.1162/tacl_a_00638) | 长上下文存在位置偏差 | 不能只靠扩大上下文解决遗漏 |
| [LongLLMLingua](https://aclanthology.org/2024.acl-long.91/) | 裁剪低价值上下文可以降低成本 | 不证明需要额外压缩模型 |

## 官方工程材料

- [Anthropic：Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [OpenAI Agents SDK 编排](https://developers.openai.com/api/docs/guides/agents/orchestration)
- [OpenAI Agents SDK 运行循环](https://developers.openai.com/api/docs/guides/agents/running-agents)

具体仓库决策应在对应 ADR 中引用真正支撑取舍的来源，不在本文维护当前实现或目标架构结论。

## 相关文档

- `../architecture/system/agent-framework.md`
- `../architecture/system/agentic-retrieval.md`
- `eval.md`
