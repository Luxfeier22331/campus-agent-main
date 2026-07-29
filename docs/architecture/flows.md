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
| Agent 知识读取 | `docs/architecture/system/retrieval-serving.md`、`docs/architecture/system/agentic-retrieval.md` |
| 可观测性与评测 | `docs/architecture/system/ops-observability.md`、`docs/architecture/system/langfuse.md` |

## 产品运行

```mermaid
flowchart LR
  Browser["浏览器"]
  CampusWeb["campus-web\n学生界面"]
  AppAPI["app-api\n产品 API"]
  Exec["execution-control\n执行引擎"]
  Temporal["Temporal\n工作流与 activity queue"]
  Projection["脱敏投影"]

  Browser --> CampusWeb
  CampusWeb --> AppAPI
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
  Agent["单个 Agent Activity\n完整 Agents SDK run"]
  Memory["execution-control\n个人记忆 handler"]
  Hindsight["Hindsight"]
  Final["终结\n证据校验与来源生成"]
  Append["记忆追加 activity"]

  Browser --> AppAPI --> Exec --> Temporal
  Temporal --> Agent --> Temporal
  Agent -. 获准调用 .-> Memory --> Hindsight --> Memory --> Agent
  Agent --> Exec
  Temporal --> Final --> Temporal
  Temporal --> Append --> Temporal
  Temporal --> AppAPI
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

## Agent 知识读取

```mermaid
flowchart LR
  Route["execution-control\n确定性 grounding 路由"]
  Admission["execution-control\n不可变范围与 release 准入"]
  Current["PostgreSQL\ncurrent_releases"]
  Retrieval["Qdrant\n并发候选召回"]
  RRF["Qdrant RRF 合并与裁剪"]
  Context["受保护\ngrounding_context.v2"]
  Primary["Primary Agent"]
  Final["终结\n校验引用并生成来源"]

  Route -->|single/multi scope| Admission
  Current --> Admission --> Retrieval --> RRF --> Context
  Route -->|none| Context
  Context --> Primary --> Final
```

## 可观测性与评测

```mermaid
flowchart LR
  Runtime["真实产品执行与投影"]
  Generic["通用 OTel 入口"]
  Trusted["受信任 OTel 入口"]
  Axiom["Axiom\n日志、调用链、指标"]
  Sentry["Sentry SDK\n错误与性能"]
  Langfuse["Langfuse\ntrace、dataset、score"]
  Adapter["eval-langfuse 适配器"]
  Ragas["Ragas 运行器"]
  Ops["Ops Web 固定查询"]

  Runtime --> Generic --> Axiom
  Runtime --> Trusted --> Langfuse
  Runtime --> Sentry
  Axiom --> Ops
  Sentry --> Ops
  Langfuse --> Adapter
  Adapter -->|dataset-run-item 关联| Langfuse
  Adapter --> Ragas --> Adapter
```

纯字段字典、所属模块内部流程和可从 Git 历史恢复的材料不进入中央流程图。
