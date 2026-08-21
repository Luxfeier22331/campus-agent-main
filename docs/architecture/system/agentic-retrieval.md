---
doc_type: architecture
owner_boundary: agent-retrieval
status: active
---

# Agent 的机构知识边界

本文定义当前在线 Agent 与机构知识数据之间的边界。旧的强制 Campus Docs 检索链路已删除，
不是当前运行时合同。

当前在线回答只执行准入、Primary Agent、Finalization 和必要的记忆追加。请求不会因为属于校园
事实、问候、改写或其他主题而自动触发 Campus Docs 查询；Agent Runtime 也不会接收固定的文档证据
上下文。当前没有向模型开放机构知识检索工具，终态不能伪造未接入能力的来源引用。

Campus Docs 的来源清洗、reader、Chunk、Embedding 和 Publisher 仍属于独立离线数据面，由
[检索服务](retrieval-serving.md) 维护。离线索引或当前指针存在，不表示在线 Agent 已经消费它。

未来如果接入 RAG，需要同时更新可执行工具/能力合同、模型输入、来源校验、评测和观测字段；本文件
不会为未来能力预先规定检索次数、查询链路或工具形态。

## 相关文档

- [Agent 框架](agent-framework.md)
- [工具路由](tool-routing.md)
- [检索服务](retrieval-serving.md)
- [执行合同](../../contracts/tool-execution.md)
