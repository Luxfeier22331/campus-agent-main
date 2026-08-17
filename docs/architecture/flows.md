---
doc_type: architecture
owner_boundary: docs/architecture
status: active
---

# 架构流程图

本文只展示跨多个所有者理解所需的稳定连接关系。字段、状态、版本、Activity 和操作步骤继续由所属
架构、合同、数据文档和 runbook 维护。

## 产品请求

```mermaid
flowchart LR
  Browser[学生浏览器]
  Web[Campus Web]
  API[App API]
  Control[execution-control]
  Temporal[Temporal]
  Agent[agent-runtime]
  Projection[产品与运行投影]

  Browser --> Web --> API --> Control --> Temporal
  Temporal --> Control --> Agent
  Control --> Projection --> API
```

所有者入口：`system/product-runtime.md`、`system/durable-runtime.md`、
`../contracts/app-api/request-lifecycle.md`。

## 在线回答上下文

```mermaid
flowchart LR
  Admission[execution-control 准入]
  Current[PostgreSQL 当前 Campus Docs 索引]
  Retrieval[Qdrant dense+sparse 检索]
  Memory[个人记忆]
  Evidence[本轮 Campus Docs evidence]
  Agent[Primary Agent]
  Final[确定性终结]

  Current --> Admission --> Retrieval --> Evidence
  Admission --> Agent
  Evidence --> Agent
  Evidence --> Final
  Agent -. 可用时按需调用 .-> Memory --> Agent
  Agent --> Final
```

当前索引与模型设置在 workflow 前冻结；没有获准能力时不形成隐藏 fallback。所有者入口：
`system/memory-plane.md`、`system/retrieval-serving.md`、`system/agent-framework.md`。

## Campus Docs 发布

```mermaid
flowchart LR
  Source[对象存储 source.json 与 reader]
  Site[Campus Web 静态构建]
  Chunk[手动 Chunk Job]
  Embedding[手动 Embedding Job]
  Publisher[手动 Publisher Job]
  Qdrant[不可变 Qdrant collection]
  Current[PostgreSQL current_index]

  Source --> Site
  Source --> Chunk --> Embedding --> Publisher --> Qdrant
  Publisher --> Current
```

三个索引阶段显式传递内容寻址制品，不自动串联；静态站候选和检索索引也不互相充当发布状态。
所有者入口：`system/document-site.md`、`system/retrieval-serving.md`、`../runbooks/campus-docs.md`。

## 离线数据

```mermaid
flowchart LR
  Input[登记输入]
  Control[ingestion-control]
  Temporal[Temporal]
  Collector[source-collector]
  Kernel[转换内核]
  Storage[对象存储]
  Domain[领域发布器]
  Product[产品读取]

  Input --> Control --> Temporal
  Temporal --> Collector --> Storage
  Temporal --> Kernel --> Storage
  Storage --> Domain --> Product
```

采集成功不表示领域数据已经发布，也不表示在线模型能力已经开放。所有者入口：
`system/data-plane.md`、`../runbooks/ingestion.md` 和所属领域文档。

## 运行观测与评测

```mermaid
flowchart LR
  Runtime[产品执行]
  Logs[应用日志]
  Errors[错误与性能]
  Trace[Agent trace]
  Axiom[Axiom]
  Sentry[Sentry]
  Langfuse[Langfuse]
  Ops[Ops Web]
  Eval[评测适配器]

  Runtime --> Logs --> Axiom --> Ops
  Runtime --> Errors --> Sentry --> Ops
  Runtime --> Trace --> Langfuse
  Langfuse --> Eval
```

观测和评分不能改写产品终态。所有者入口：`system/ops-observability.md`、
`../contracts/langfuse-runtime.md`、`../reference/eval.md`。
