---
doc_type: reference
owner_boundary: docs/reference
status: active
---

# Agent 编排研究依据

## 用途

本文维护 Agent 编排、检索和评测设计所依据的外部研究。它不证明仓库已经实现某项能力，也不把
论文实验结果直接当作本产品的性能承诺。当前能力以代码、可执行合同和
`../architecture/current.md` 为准，目标边界见所属架构文档。

证据按以下顺序使用：

1. 正式发表的同行评议论文，用于判断方法在什么问题上有效；
2. 产品或框架官方工程材料，用于理解公开接口和生产经验；
3. 仓库评测结果，用于决定方法是否适合 Campus Agent。

论文在公开数据集上的收益不能替代本仓库的真实问题集、延迟分布和人工评审。

## 当前实现与研究边界

本文中的“Agentic RAG”是检索策略的统称，不表示必须增加 Knowledge Agent、第二个答案 Agent
或默认多轮工具循环。当前源码实现是一个 `execution_strategy.v2` 的 `direct` Primary Agent：机构
文档在模型调用前由 execution-control 进行一次服务端 grounding，模型只消费受保护的
`grounding_context.v2`。准入快照还冻结是否允许无依据回答；该值只对简单社交、能力介绍和用户提供
完整正文的转换任务开放，不把未命中文档路由的事实问题当作普通直答。

“快速依据回答”和“审慎检索”是目标或实验策略，不是当前已开放的运行模式。任何新增路由、检索轮次、
specialist 或 Provider 调用，都必须先在 Campus Agent 的真实用例上证明质量收益超过延迟、成本和
维护成本。

## 自适应执行与检索

| 来源 | 可采用结论 | 适用边界 |
| --- | --- | --- |
| [Adaptive-RAG，NAACL 2024](https://aclanthology.org/2024.naacl-long.389/) | 根据问题复杂度在无检索、单步检索和迭代检索之间选择，可以兼顾效率与准确性 | 论文使用小模型分类器，不表示本产品必须新增一次远程模型调用；路由实现应由本地评测决定 |
| [ReAct，ICLR 2023](https://openreview.net/forum?id=WE_vluYUL-X) | 需要环境反馈的复杂任务可以交替推理与行动 | 工具循环会增加模型往返，不应成为简单请求的默认路径 |
| [IRCoT，ACL 2023](https://aclanthology.org/2023.acl-long.557/) | 多跳问题中，后续检索可能依赖前一步结果，因此不能全部压成一次检索 | 只对存在真实依赖的子问题迭代；相互独立的读取仍应并行 |
| [FLARE，EMNLP 2023](https://aclanthology.org/2023.emnlp-main.495/) | 长篇知识生成可能需要在生成过程中主动补充检索 | 适合明确的长篇研究请求，不适合普通校园事实问答 |
| [Self-RAG，ICLR 2024](https://openreview.net/forum?id=hSyW5go0v8) | 无差别固定检索可能引入无关上下文，检索应按需发生并评价证据 | 其训练和特殊 token 机制不能直接移植到闭源 Provider；本仓库只采用按需检索原则 |
| [STORM，NAACL 2024](https://aclanthology.org/2024.naacl-long.347/) | 多视角研究、资料整理和提纲可以改善长文的组织与覆盖 | 仅作为显式深度研究模式的参考，不为普通回答建立多角色流水线 |

## 并行执行与延迟

| 来源 | 可采用结论 | 适用边界 |
| --- | --- | --- |
| [LLMCompiler，ICML 2024](https://proceedings.mlr.press/v235/kim24y.html) | 将工具调用表示为依赖图后，可以并行执行无依赖节点，减少串行 ReAct 的延迟和成本 | 若为简单请求额外调用远程模型生成计划，可能反而增加延迟；只在复杂路径使用语义规划 |
| [Divide-Then-Aggregate，ACL 2025](https://aclanthology.org/2025.acl-long.1401/) | 可将独立工具子任务并行执行，再聚合结果用于后续决策 | 论文包含专门训练方法，本仓库采用依赖感知并行原则，不直接引入其模型 |
| [Parrot，OSDI 2024](https://www.usenix.org/conference/osdi24/presentation/lin-chaofan) | 暴露应用级数据依赖可以改善多次模型调用的端到端调度 | 主要需要推理服务配合；当前远程 Provider 不能直接获得其运行时收益 |
| [SGLang，NeurIPS 2024](https://papers.nips.cc/paper_files/paper/2024/hash/724be4472168f31ba1c9ac630f15dec8-Abstract-Conference.html) | KV 缓存复用和结构化程序执行可以提升自托管模型吞吐 | 属于推理服务优化，不用于证明应用层增加模型调用是低成本的 |

## 工具接口与评测

| 来源 | 可采用结论 | 适用边界 |
| --- | --- | --- |
| [SWE-agent，NeurIPS 2024](https://proceedings.neurips.cc/paper_files/paper/2024/hash/5a7c947568c1b1328ccc5230172e1e7c-Abstract-Conference.html) | Agent 面向工具的接口会显著影响行为与任务成功率 | 优先改进工具名称、参数、返回值和错误语义，不用增加 Agent 包装弥补含糊接口 |
| [AgentBench，ICLR 2024](https://openreview.net/forum?id=zAdUB0aCTQ) | 长程推理、决策和指令遵循仍是 Agent 的主要失败来源 | 工具轮次、期限和停止条件必须有界，并按完整任务评测 |
| [ALCE，EMNLP 2023](https://aclanthology.org/2023.emnlp-main.398/) | 流畅答案仍可能缺少完整引用支持，需分别评价答案和引用质量 | 引用存在不等于每个关键主张都被支持 |
| [ARES，NAACL 2024](https://aclanthology.org/2024.naacl-long.20/) | RAG 应分别评价上下文相关性、答案忠实度和答案相关性 | 自动评审需要少量人工标注校准，不能独立形成发布结论 |
| [RAGChecker，NeurIPS 2024](https://papers.nips.cc/paper_files/paper/2024/hash/27245589131d17368cccdfa990cbf16e-Abstract-Datasets_and_Benchmarks_Track.html) | 应分别诊断召回与生成，而不是只观察一个最终分数 | 具体指标需通过仓库正式适配器接入，不能在同名指标下实现私有算法 |
| [CRAG，NeurIPS 2024](https://proceedings.neurips.cc/paper_files/paper/2024/hash/1435d2d0fca85a84d83ddcb754f58c29-Abstract-Datasets_and_Benchmarks_Track.html) | 直接追加普通 RAG 仍不能可靠处理动态、长尾和复杂事实 | Campus Agent 必须使用已发布来源、版本和问题覆盖评测，不能把“进行了检索”当作正确性证明 |

高成本搜索方法只作为特定任务参考。[Language Agent Tree Search，ICML 2024](https://proceedings.mlr.press/v235/zhou24r.html)
把树搜索、模型价值判断和反思结合用于探索复杂决策；这种分支执行天然增加模型调用，只有在任务
具有可验证反馈且仓库评测证明收益时才考虑，不能作为在线问答默认编排。

## Prompt 与上下文装配

| 来源 | 可采用结论 | 适用边界 |
| --- | --- | --- |
| [Sufficient Context，ICLR 2025](https://iclr.cc/virtual/2025/poster/30092) | 检索到相关文本不等于已有足够信息回答，强模型在依据不足时仍可能猜测 | grounding 覆盖状态不能代替答案充分性判断；`ready` 仍允许明确无答案 |
| [Inference Scaling for Long-Context RAG，ICLR 2025 Oral](https://iclr.cc/virtual/2025/oral/31886) | 单纯增加文档数量没有稳定收益，应按问题难度分配检索和迭代预算 | 默认路径保持一次有界 grounding，不扩大文档数量或默认增加检索轮次 |
| [Q-RAG，ICLR 2026 Oral](https://iclr.cc/virtual/2026/oral/10009945) | 复杂问题可以从有界多步检索受益 | 只有本仓库多跳用例证明单步检索不足时才增加一次受限补充检索，不进入当前默认路径 |
| [Intrinsic Entropy of Context Length Scaling in LLMs，ICLR 2026](https://iclr.cc/virtual/2026/poster/10006782) | 模型存在任务相关的有效上下文长度，继续增加内容可能降低效果 | 只注入本轮依据、有意义会话状态和近期完整对话，不预载旧依据与工具结果 |
| [Lost in the Middle，TACL 2024](https://doi.org/10.1162/tacl_a_00638) | 长上下文存在位置偏差，中间信息更容易被忽略 | 当前问题和本轮 grounding 放在输入末端附近，历史内容从最旧处按完整片段裁剪 |
| [LongLLMLingua，ACL 2024](https://aclanthology.org/2024.acl-long.91/) | 裁剪低价值上下文可降低成本并改善长上下文使用 | 当前先删除空会话状态和最旧对话，不引入额外压缩模型或不可解释摘要 |
| [GEPA，ICLR 2026 Oral](https://iclr.cc/virtual/2026/oral/10009494) | Prompt 优化应消费执行轨迹和可解释失败反馈，而不是只靠人工扩写规则 | 复用现有 Agent/RAG 用例验证 Prompt 变更，不建立远程 Prompt 版本或在线自动优化器 |

## 官方工程材料

- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
  建议从最简单可行方案开始，只在评测证明有收益时增加路由、并行 worker 或自主循环，并为循环
  设置停止条件。
- [OpenAI Agents SDK 编排](https://developers.openai.com/api/docs/guides/agents/orchestration)
  建议优先使用单 Agent，只有不同分支确实需要独立指令、工具、策略或回答所有权时才拆分
  specialist。
- [OpenAI Agents SDK 运行循环](https://developers.openai.com/api/docs/guides/agents/running-agents)
  说明 SDK run 负责模型、工具、继续执行和停止；应用仍拥有工具实现、状态和运行边界。
- [Google AI Mode](https://blog.google/products/search/ai-mode-search/)
  公开说明使用并发 `query fan-out` 查询多个子主题和数据源后统一汇总，但没有公开完整内部实现。
- [xAI Web Search](https://docs.x.ai/developers/tools/web-search)
  只证明 Grok API 提供搜索、引用和流式工具事件，不足以推断其内部 Agent 拓扑。

## 仓库设计结论

Campus Agent 采用以下原则：

- 一个产品请求只有一个持久执行所有者和一个最终答案所有者；单 Agent 不等于所有请求走同一成本路径；
- 当前只开放 `direct` 执行策略和一次服务端 grounding；其他策略必须先完成独立评测和决策；
- 路由只选择成本和执行方式，不能扩大用户权限、文档范围、工具 exposure 或 Provider 能力；
- 当前 grounding 在模型调用前并行准备相互独立的已准入上下文，避免先调用模型才能开始检索；
- 只有真实多跳用例证明一次 grounding 不足时，才单独设计有界分解、工具循环和依赖查询；
- 所有路径只生成一份最终答案，不默认增加 critic、debate、树搜索或第二个答案改写模型；
- 完整度通过问题分面覆盖、证据覆盖、引用质量和无依据主张评测，不以回答长度或工具调用次数代替；
- 新增模型调用、specialist、检索轮次或推理服务优化前，必须在 Campus Agent 数据集上证明质量收益
  大于延迟、成本和维护代价。

## 相关文档

- `../architecture/system/tool-routing.md`
- `../architecture/system/agentic-retrieval.md`
- `../architecture/system/agent-framework.md`
- `../architecture/system/durable-runtime.md`
- `eval.md`
