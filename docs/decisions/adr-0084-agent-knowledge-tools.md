---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0084
status: accepted
supersedes: ADR-0075
---

# ADR-0084 单一 Agent 与服务端 Campus Docs 检索

## 背景

ADR-0075 把机构知识查询包装为 Primary Agent 到 Knowledge Agent 的 handoff。该分层没有形成独立
权限、模型、数据或扩缩容边界，却增加了第二套角色指令、handoff 终态和查询目标语义。

后续按课程事实、文档召回和章节读取继续拆工具，也把仍以正式文档存在的培养方案误写成独立事实
模型，并要求模型先选工具才能开始检索。对当前数据，这增加了模型往返、工具合同和评测面，却没有
提高来源真实性。

早期重构又引入 `grounding_plan`、`grounding_context`、mode/status 和“允许无依据回答”等投影。
这些字段重复表达 workflow 已经明确的控制流，没有独立消费者，还迫使上下游维护不存在、空结果和
非空结果的第二套状态机。

索引发布同时需要明确激活身份。运行时跟随 Qdrant alias 或在执行途中重新读取当前指针，会让同一
run 读取到不同发布版本。

## 决策

### 一个答案循环

- 在线回答只运行一个 Primary Agent，不建立 Knowledge Agent、handoff、外部 planner 或第二次答案
  合成；
- OpenAI Agents SDK 在一个 Agent Activity 内完成可选个人记忆函数调用和结构化答案；
- Finalization 只做确定性校验、来源派生和投影提交，不调用模型或改写答案。

### 统一 Campus Docs 检索

- 培养方案、学生规则、学校制度和其他 Campus Web 当前文档统一进入同一个索引；
- 每个有效请求都创建检索准入并执行一次 Campus Docs 检索，不再维护直接回答与检索回答两条
  workflow 分支；
- `RetrieveCampusDocsEvidenceActivity` 对冻结查询生成一次 dense 与 sparse query vector，查询唯一
  已准入 collection，再按 Qdrant 查询分数顺序去重 chunk，并在证据条数与字符预算内单次裁剪；
- workflow 把最小 `campus_docs_evidence` 传给 Agent Runtime，并把完整检索结果独立传给
  Finalization；Agent result 不回传 evidence 副本；
- Campus Docs 检索不注册为模型工具，不进入 SDK 工具轨迹。

Retrieval Activity 成功后只返回包含 evidence 数组的 `CampusDocsRetrievalResult`，workflow 取得该
结果后才进入 Agent，不维护检索 mode/status。空 evidence 表示检索成功但没有选出证据，非空
evidence 表示有可引用证据。普通任务不要求引用；机构事实缺少充分证据时返回
`unsupported_by_evidence`。

类型化工具只保留确实拥有独立运行能力的 `personal_memory_recall`。课程、文档召回和章节读取旧工具
合同直接删除，不保留兼容 route 或 fallback。

### 不可变发布消费边界

- 在线请求不采集、清理、分块、建索引或发布；
- Chunk Job 直接消费 Campus Web 已清洗的 `source.json` 和当前 reader，不建立第二套 canonical 文档；
- Chunk、Embedding 和 Publisher 是三个独立手动阶段，以内容寻址 manifest 和 NDJSON 传递显式输入；
- Qdrant 不可变物理 collection 保存在线检索正文、检索文本摘要和引用 metadata；
- collection 名由 index manifest 的规范 JSON SHA-256 形成；manifest 摘要同时是 collection 后缀，
  不再另建第二套运行时索引身份；
- PostgreSQL 只用 `campus_docs_serving.current_index` 单行保存当前 collection 及查询所需绑定，不保存
  索引历史、独立 index ID、fingerprint 或来源摘要实体；
- `campus_docs_serving.current_index` 是唯一激活来源，不使用 Qdrant alias；
- 当前在线检索只消费激活的当前索引，不提供历史 reader 查询。

Embedding Job 只从 execution-control 取得一次当前 provider 连接，并可从显式旧 embedding set 按
向量空间与检索文本摘要复用。Embedding Set 只保存 Chunk Set 引用、向量空间和内容寻址向量，不保存
provider、endpoint、model alias 或调用参数。Publisher 不读取 reader 或调用 provider；它只接收显式
Embedding Set，并从 manifest 解析 Chunk Set 后构建完整新 collection，验证后原子替换当前绑定。流程
不原地更新向量，也不在激活后立即删除旧 collection。

### 离线任务执行模型

- 本地 Chunk/Embedding CLI 与对应集群 Job 复用领域实现，只在组装层分别使用 worktree 文件 Store、
  derived S3 Store、本地显式 Provider 连接或 execution-control 一次性连接；不维护 `LOCAL_MODE`、存储
  模式配置或第二套阶段定义；
- 本地 Chunk CLI 只读对象存储来源，本地 Embedding CLI 直接调用显式 OpenAI-compatible endpoint，
  二者都写入 `var/` 且制品不上传或晋升；正式制品由集群 Job 使用同一有效输入重新生成；
- 每个进程只执行 Chunk、Embedding 或 Publisher 中的一个阶段并退出，下一阶段只接收操作者显式传入的
  内容寻址制品 ID；
- Kubernetes 只提供一次性 Job 执行载体，三个保持暂停的 CronJob 只保存各阶段 Pod 模板，不通过
  解除暂停执行，也不自动串联后续阶段；
- 集群镜像在构建期编译 TypeScript，运行时只执行 JavaScript 产物；本地 `eval-chunks` 和 dense-only
  `eval-embeddings` 不进入集群镜像；
- Job 环境只提供该阶段实际依赖的对象存储、PostgreSQL 或 Qdrant 连接。Embedding provider 连接继续
  来自 execution-control 的一次性快照，向量空间与分块定义继续由代码所有。

### 不可变运行准入

execution-control 在每个 run 准入时冻结 `llm` 设置、物理 Qdrant collection、完整查询绑定、本轮
查询 hash 和 `embedding` 设置 hash。整个 run 只消费该快照，不跟随后续发布或模型设置变化。

准入快照作为有界 workflow input 进入 Temporal，不携带文档正文或 Provider 凭据。完整有界检索结果
只作为 Activity result 进入 Temporal history；普通投影不保存正文。缺少当前索引、配置不兼容或
身份不一致时失败关闭。

### 模型上下文与评测

Agent Runtime 在真实 `AgentInputItem[]` 上计算字符预算，从最旧处裁剪完整会话片段，并返回实际
`context_usage`。execution-control 不预先构造另一份模型上下文投影。

`tool_trajectory.v3` 只保存同一个 Agent 实际执行的 SDK `tool_calls[]`。运行评测不复制检索准入、
collection 或候选/证据计数；RAGAS 从答案和已验证 sources 派生检索上下文，并由数据集中的 reference
contexts 决定样本是否进入 RAG 评测。服务端检索不伪造成工具调用。

## 结果

- 用户请求只支付一次最终答案模型循环，每个有效请求在其之前执行一次 Campus Docs 检索；
- 培养方案不再被假设成尚不存在的结构化课程事实库；
- workflow 控制流、数据存在性和 evidence 内容各自只表达一次，不再同步额外状态机；
- 同一 run 的候选、正文和依据不会因索引切换而混用版本；
- 本地开发和集群执行不会因不同入口形成两套制品语义或配置来源；
- 删除 Knowledge Agent、旧知识路由、旧工具及 `grounding` 上下游合同；
- 多 Agent 或迭代检索只有在出现独立边界和评测证据时才重新决策。

## 未采用方案

- **保留 Knowledge Agent 包装 RAG**：没有独立系统边界，却增加提示词、轨迹和失败语义；
- **模型先选知识工具**：增加模型往返，并把服务端准入参数暴露给工具循环；
- **保留 `none|campus_docs` 与 `not_required|empty|ready`**：重复表达字段和 evidence 的存在性；
- **为培养方案维护独立课程事实工具**：当前来源仍是文档，没有可靠的结构化生产链；
- **从 PostgreSQL 回读每个命中章节**：Qdrant 已保存经发布校验的 chunk 正文，会增加在线串行读取；
- **运行时跟随 alias 或在 Activity 内读取 current 指针**：同一 run 可能跨版本；
- **默认检索历史 reader**：会让过期规章与当前事实竞争；
- **把三个制品阶段合并为一个自动 Job**：无法在 Chunk 与 Embedding 之间进行人工抽样，也会隐藏显式
  制品边界；
- **为本地和集群维护不同实现或配置**：相同输入可能产生不同制品，且需要同步两套命令和默认值；
- **使用 Temporal、Argo 或数据库状态机编排当前流程**：当前只有人工分段执行需求，没有独立的持久
  编排状态需要维护。

## 参考

- [ReAct：推理与行动协同](https://openreview.net/forum?id=WE_vluYUL-X)
- [面向知识密集型任务的检索增强生成](https://proceedings.neurips.cc/paper/2020/hash/6b493230205f780e1bc26945df7481e5-Abstract.html)
- `../architecture/system/agent-framework.md`
- `../architecture/system/agentic-retrieval.md`
- `../architecture/system/retrieval-serving.md`
