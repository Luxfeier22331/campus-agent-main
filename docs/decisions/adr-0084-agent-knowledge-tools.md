---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0084
status: accepted
supersedes: ADR-0075
---

# ADR-0084 单一 Agent 与服务端 Campus Docs 检索

## 背景

早期方案把机构知识查询包装为 Primary Agent 到 Knowledge Agent 的 handoff，并继续按课程事实、
文档召回和章节读取拆分工具。这些层次没有形成独立的权限、数据、模型或扩缩容边界，却增加了
提示词、工具合同、终态和评测面。

检索控制流和证据存在性也曾被复制成多组运行时投影，使 workflow 已经表达的行为再次进入上下游
状态机。当前系统需要一个直接、可冻结且只消费当前公开文档的检索路径。

## 决策

### 单一在线回答路径

- 在线回答只运行一个 Primary Agent，不建立 Knowledge Agent、handoff 或外部 planner；
- Agent 负责一次最终答案循环，Finalization 只做确定性校验、证据派生和结果投影，不再次调用模型；
- 文档检索不作为模型可见工具，服务端在进入 Agent 前完成检索；
- 只有确实拥有独立运行边界的工具才保留，工具和终态合同由所属模块维护。

### Campus Docs 检索边界

- 当前 Campus Web 发布的 reader 是在线 Campus Docs 检索唯一输入；请求期间不采集、清理、分块、
  生成 embedding 或发布索引；
- 每个有效请求在进入 Agent 前执行一次服务端检索，检索结果以有界 evidence 传入 Agent；空
  evidence 是检索结果，不建立额外的 mode/status 状态机；
- 运行准入冻结本次请求使用的物理 Qdrant collection 及完整查询绑定，同一 run 不跟随 alias 或重新
 读取 current 指针；
- 当前文档索引不按 `institutional_rules`、`scoped_rules` 或 `student_rules` 拆分在线查询范围；
  公开站点的主题集合不等于物理检索 collection。

### 不可变索引边界

- Chunk、Embedding 和 Publisher 是三个独立的手动阶段，阶段之间通过内容寻址制品显式传递；
- Qdrant 使用不可变物理 collection，当前可服务 collection 由 PostgreSQL 单行指针确定；不使用
  alias 表示当前版本，也不提供在线历史 reader 查询；
- Publisher 只消费显式传入并已验证的 Chunk/Embedding 制品，不读取 reader、不调用 embedding
  provider，也不原地修改已激活 collection；
- 具体 schema、字段、命令和校验步骤由 executable contract、索引实现和 runbook 维护，本 ADR
  不复制动态清单。

### 本地与集群执行

- 本地 CLI 与集群 Job 复用同一阶段实现，只在存储和连接组装上适配入口，不维护第二套阶段语义；
- 每个进程只执行 Chunk、Embedding 或 Publisher 中的一个阶段并退出，下一阶段必须显式接收上一步
  的内容寻址制品；
- Kubernetes Job 只提供一次性执行载体，不自动串联三个阶段，也不把本地评测工具包装成在线能力。

## 结果

- Agent、检索和索引发布各自只有一条实际数据路径；
- 当前文档内容、检索 evidence 和索引版本不会因运行中切换而混用；
- 公开文档主题分类不会被误读成在线检索路由或独立向量 collection；
- Chunk、Embedding、Publisher 的具体变更可以分别验证，不需要维护额外的编排状态或兼容路径。

## 未采用方案

- **保留 Knowledge Agent 或 handoff 包装 RAG**：没有独立系统边界，却增加提示词和失败语义；
- **让模型先选择检索工具或知识目标**：增加模型往返，并暴露服务端准入参数；
- **为每个文档主题维护独立在线 collection**：与当前统一 Campus Docs 索引边界不符，增加发布和查询
  绑定；
- **在线请求触发采集或索引**：把离线制品生产与用户请求生命周期耦合；
- **通过 alias 或可变 current reader 读取历史版本**：同一 run 可能跨越索引版本；
- **把三个阶段合并为自动 Job**：失去阶段间的独立抽样和验证边界。

## 参考

- `../architecture/system/agent-framework.md`
- `../architecture/system/agentic-retrieval.md`
- `../architecture/system/retrieval-serving.md`
- `adr-0007-retrieval-strategy.md`
