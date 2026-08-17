---
doc_type: architecture
owner_boundary: docs/architecture
status: active
---

# 当前架构

## 边界

本文概述源码主干中的系统组成和当前所有权。字段、接口、开放工具和数据范围以代码、schema、注册表、
配置和所有者测试为准；实际部署状态以环境仓选择和运行状态为准。

跨系统连接关系见 [架构流程图](./flows.md)，模块内部行为由所属系统、合同和数据文档维护。

## 系统组成

| 组件 | 当前职责 |
| --- | --- |
| Campus Web | 学生问答、账号、文档、通知、地图、食堂和同好群界面 |
| Status Web | 独立的公共产品可用性快照与状态页 |
| App API | 浏览器认证、产品 HTTP、聊天接收、产品投影和执行回调 |
| Ops Web | 受保护的运行查看、模型配置、账号和内容运营界面 |
| execution-control | 执行准入、Temporal 业务流程、Campus Docs 检索、个人记忆命令和运行投影 |
| agent-runtime | 单次 Primary Agent SDK run 和获准函数工具调用 |
| ingestion-control 与 source-collector | 离线任务控制、来源读取和显式文件发布 |
| PostgreSQL、Temporal、Hindsight、Qdrant | 分别保存产品与运行投影、工作流历史、个人记忆和检索索引 |

## 在线产品

浏览器产品通过 App API 接收请求。App API 保存会话和产品状态，execution-control 与 Temporal 推进
持久执行，agent-runtime 在一次 SDK run 中生成结构化结果，App API 最终提交用户可见终态。

Campus Docs 检索、个人记忆和模型配置都经过服务端准入。浏览器和模型不能选择数据库、物理集合、
供应商凭据或内部环境。每次有效回答在 workflow 创建前冻结当前 Campus Docs 索引和 Embedding
设置；检索 Activity 生成本轮有界 evidence，再由 Primary Agent 引用并由终结步骤校验。

个人记忆不可用时不向模型开放记忆工具；可用时 Primary Agent 最多按需调用一次
`personal_memory_recall`，只把结果用于用户自身事实或偏好，不能替代 Campus Docs evidence。

源码中已实现的能力由可执行入口、配置、合同和运行测试共同证明；环境实际开放还要求相应数据或
配置已经激活并由环境选择。schema、fixture、Job 模板或页面占位不能证明能力已经开放。

## 产品与离线数据

文档站、通知、校园地图、Dining 和其他校园领域各自消费已经发布的所属数据。离线采集、清理、转换
和发布不进入在线回答请求；数据或索引存在也不会自动向模型开放。

Campus Web 文档以 `campus-docs/source.json` 和其引用的 `campus_docs_reader.v3` 为共享输入。静态
文档构建与 Campus Docs 索引发布是两个独立消费者；索引侧由人工触发的 Chunk、Embedding 和
Publisher 三个阶段产生内容寻址制品、单一不可变 Qdrant collection，并原子替换 PostgreSQL
`campus_docs_serving.current_index`。任务、schema、制品或 collection 存在仍不能证明某环境已激活
该索引。详细边界见 [检索服务](./system/retrieval-serving.md)。

来源、规范数据、派生产物和在线索引分别由数据面、领域发布器和检索服务拥有。完整边界见所属领域
架构、数据文档和发布合同。

## 运行与观测

PostgreSQL 保存产品和有界运行投影，Temporal 保存 workflow history，Hindsight 保存个人记忆，
Qdrant 是检索索引的目标存储。Axiom、Sentry 和 Langfuse 分别消费获准的日志、错误/性能和 Agent
trace；外部观测不能改写产品或 workflow 状态。

浏览器 Worker 与自托管服务由不同运行平台承载。源码仓只提供环境无关实现和不可变候选物；环境地址、
Secret、资源和实际版本选择由环境仓拥有。

## 所有者入口

- [跨系统流程](./flows.md)
- [产品运行时](./system/product-runtime.md)
- [持久执行](./system/durable-runtime.md)
- [Agent 框架](./system/agent-framework.md)
- [检索服务](./system/retrieval-serving.md)
- [采集数据面](./system/data-plane.md)
- [运行观测](./system/ops-observability.md)
- [代码组织](./system/code-organization.md)
