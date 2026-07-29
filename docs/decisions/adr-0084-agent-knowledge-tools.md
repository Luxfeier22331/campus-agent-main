---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0084
status: accepted
supersedes: ADR-0075
---

# ADR-0084 单一 Agent 与服务端 Grounding

## 背景

ADR-0075 把机构知识查询包装为 Primary Agent 到 Knowledge Agent 的 handoff。该分层没有形成独立
权限、模型、数据或扩缩容边界，却增加了第二套角色指令、handoff 终态和难以解释的 target 语义。

后续按课程事实、文档召回和章节读取继续拆工具，也把数据尚未结构化的培养方案误写成独立事实
模型，并要求模型先选工具才能开始检索。对当前以正式文档为主的数据，这增加一次模型往返、扩大
工具合同和评测面，却没有提高来源真实性。

知识发布还需要明确激活身份。运行时跟随 Qdrant alias 或在每次查询重新读取 current release，会
让同一 run 读取到不同发布版本。

## 决策

### 一个答案循环

- 在线回答只运行一个 Primary Agent，不建立 Knowledge Agent、handoff、外部 planner 或第二次
  答案合成；
- OpenAI Agents SDK 在一个 Agent Activity 内完成可选个人记忆函数调用和结构化答案；
- finalization 只做确定性校验、来源派生和投影提交，不调用模型或改写答案。

### 文档知识统一预取

- 培养方案、学生规则和学校制度统一作为文档 RAG 消费；
- execution-control 先确定性选择是否需要 grounding；检索路径在模型调用前执行
  `PrepareGroundingContextActivity`；
- 对冻结查询只做一次 embedding，并发查询选中的已准入 scope，再用 Qdrant dense+sparse RRF 分数全局
  排序、去重和裁剪；
- 完整 `grounding_context.v2` 只写入受保护载荷，Primary Agent 只能引用本轮 `evidence://`；
- 知识 grounding 不注册为模型工具，不进入 SDK 工具轨迹。

类型化工具只保留确实拥有独立读取模型的能力。当前 `transport_schedule_lookup` 已注册但关闭；
`personal_memory_recall` 按本轮授权可选开放。课程、文档召回和章节读取旧工具合同直接删除，不保留
兼容 route 或 fallback。

### 不可变发布消费边界

- 在线请求不采集、清理、分块、建索引或发布；
- Qdrant 不可变物理 collection 保存在线检索正文、token 数和引用 metadata；
- PostgreSQL `knowledge_serving` 保存不可变 release 与 `current_releases` 激活指针；
- `current_releases` 是唯一激活来源，不使用 Qdrant alias；
- 当前在线检索只消费激活的当前 release，不提供历史 release 查询。

本决策只约束在线消费形态，不指定离线生产者。当前没有正式索引生产者和发布数据，文档
grounding 不可用。

### 不可变运行准入

execution-control 在 run 准入时冻结每个 scope 的 `release_id`、物理 Qdrant collection、完整 serving
config，以及 `llm` 和（检索路径的）`embedding` 模型设置 hash。整个 run 只消费该快照，不跟随后续
发布或模型设置变化。

准入快照作为有界 workflow input 进入 Temporal；文档正文、Provider 凭据和完整 grounding 不进入
Temporal history。缺少 release、配置不兼容或身份不一致时失败关闭。

### 轨迹与评测

`tool_trajectory.v3` 只保存同一个 Agent 实际执行的 SDK `tool_calls[]`，当前词汇为个人记忆和关闭的
班车工具。RAG 评测单独使用 grounding 范围、上下文、答案和引用，不把知识预取伪造成工具调用。

标准数据集只评测当前 release；无答案用例的 `minimum_relevant_context_count` 为 0。产品终态不
暴露内部 collection、release 选择或路由标签。

## 结果

- 用户请求只支付一次最终答案模型往返，知识检索可在其之前确定性执行；
- 培养方案不再被假设成尚不存在的结构化课程事实库；
- 同一 run 的候选、正文和依据不会因发布切换而跨 release；
- 删除 Knowledge Agent、知识 target 和三个旧知识工具及其轨迹语义；
- 多 Agent 或迭代检索只有在出现独立权限、模型、生命周期边界和评测证据时才重新决策。

## 未采用方案

- **保留 Knowledge Agent 包装 RAG**：没有独立系统边界，却增加提示词、轨迹和失败语义；
- **模型先选知识工具**：增加模型往返，并把服务端准入参数暴露给工具循环；
- **为培养方案维护独立课程事实工具**：当前来源仍是文档，没有可靠的结构化生产链；
- **从 PostgreSQL 回读每个命中章节**：Qdrant 已保存经发布校验的 chunk 正文，会增加在线串行读取；
- **运行时跟随 alias 或 current 指针**：同一 run 可能跨版本；
- **默认检索历史 release**：会让过期规章与当前事实竞争。

## 参考

- [ReAct：推理与行动协同](https://openreview.net/forum?id=WE_vluYUL-X)
- [面向知识密集型任务的检索增强生成](https://proceedings.neurips.cc/paper/2020/hash/6b493230205f780e1bc26945df7481e5-Abstract.html)
- `../architecture/system/agent-framework.md`
- `../architecture/system/agentic-retrieval.md`
- `../architecture/system/retrieval-serving.md`
- `../contracts/tool-read-model.md`
