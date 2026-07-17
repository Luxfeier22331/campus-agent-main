---
doc_type: architecture
owner_boundary: docs/architecture
status: active
---
# 架构流程图

本文只索引需要跨多个所有者理解的稳定流程。runtime、contract、schema、data 和 runbook
事实仍由所属文档维护，图只展示连接关系。

本地流程图应留在所属文档：runtime 位于 `docs/architecture/system/`，领域和来源位于
`docs/architecture/domains/`，wire shape 位于 `docs/contracts/`，数据所有权位于
`docs/data/`，操作步骤位于 `docs/runbooks/`。

## 所有者入口

| 流程 | 主要所有者文档 |
| --- | --- |
| 产品运行 | `docs/architecture/system/product-runtime.md`、`docs/contracts/app-api/request-lifecycle.md` |
| 在线回答 | `docs/architecture/system/durable-runtime.md`、`docs/architecture/system/agent-framework.md` |
| 采集数据面 | `docs/architecture/system/data-plane.md`、领域 source 文档、`docs/runbooks/ingestion.md` |
| Knowledge Agent 检索 | `docs/architecture/system/retrieval-serving.md`、`docs/architecture/system/agentic-retrieval.md` |
| 可观测性与评测 | `docs/architecture/system/ops-observability.md`、`docs/architecture/system/langfuse.md` |

## 产品运行

```mermaid
flowchart LR
  Browser["浏览器"]
  CampusWeb["campus-web\n学生界面"]
  OpsWeb["ops-web\n受保护运维界面"]
  AppAPI["app-api\n产品 API"]
  Exec["execution-control\n执行引擎"]
  Temporal["Temporal\n工作流与 activity queue"]
  Projection["脱敏投影"]

  Browser --> CampusWeb
  Browser --> OpsWeb
  CampusWeb --> AppAPI
  OpsWeb --> Projection["PostgreSQL / 固定 Secret / 窄运维接口"]
  AppAPI --> Exec
  Exec --> Temporal
  Temporal --> Projection
  Projection --> AppAPI
```

## 在线回答

```mermaid
flowchart LR
  Browser["浏览器请求"]
  AppAPI["app-api\n会话与请求接纳"]
  Exec["execution-control\n运行准入"]
  Temporal["Temporal workflow"]
  Memory["记忆召回 activity"]
  Agent["单个 Agent Activity\n完整 Agents SDK run"]
  Final["终结\n证据校验与来源生成"]
  Append["记忆追加 activity"]

  Browser --> AppAPI --> Exec --> Temporal --> Memory --> Agent
  Agent --> Exec
  Agent --> Final --> Append --> AppAPI
```

## 采集数据面

```mermaid
flowchart LR
  Input["带摘要固定的任务输入"]
  API["ingestion-control\n准入与注册表校验"]
  Temporal["Temporal workflow"]
  Collector["source-collector activity"]
  Kernel["Rust 内核 activity"]
  Storage["对象存储\n来源事实与结果"]
  Projection["PostgreSQL\n有界任务投影"]

  Input --> API --> Temporal
  Temporal --> Collector --> Storage
  Temporal --> Kernel --> Storage
  Temporal --> Projection
```

## Knowledge Agent 检索

```mermaid
flowchart LR
  Primary["Primary Agent"]
  Handoff["官方 handoff()"]
  Knowledge["Knowledge Agent"]
  Search["内部 knowledge_search"]
  Admission["execution-control\n知识目标与访问准入"]
  Retrieval["向量化 + Qdrant 稠密/稀疏 RRF"]
  Evidence["有界回答证据"]
  Final["终结\n校验引用并生成来源"]

  Primary --> Handoff --> Knowledge --> Search --> Admission --> Retrieval
  Retrieval --> Evidence --> Knowledge --> Final
```

## 可观测性与评测

```mermaid
flowchart LR
  Runtime["真实产品执行与投影"]
  OTel["OTel 管道"]
  Langfuse["Langfuse\ntrace、dataset、score"]
  Adapter["eval-langfuse 适配器"]
  Ragas["Ragas 运行器"]
  Operator["运维诊断"]

  Runtime --> OTel --> Langfuse
  Langfuse --> Adapter
  Adapter -->|dataset-run-item 关联| Langfuse
  Adapter --> Ragas --> Adapter
  Adapter --> Langfuse --> Operator
```

纯字段字典、所属模块内部流程和可从 Git 历史恢复的材料不进入中央流程图。
