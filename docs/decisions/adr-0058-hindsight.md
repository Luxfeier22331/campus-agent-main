---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0058
status: accepted
partially_supersedes: ADR-0015
---

# ADR-0058：Hindsight 自托管个人记忆

## 背景

个人记忆需要支持多用户、多会话 recall、完成轮次 append、用户显式管理、账号删除/RTBF 和
跨 thread recall。Qdrant-native 方案要求仓库自行维护 extraction prompt/schema、embedding、
dedupe/merge 和 collection 生命周期，这些不属于机构知识检索。

Hindsight 提供 retain、recall、reflect、observation、consolidation、Memory Defense 和 bank
生命周期。系统可以使用这些成熟能力，同时把产品设置、准入和受控投影留在自有边界。

## 决策

Hindsight 是唯一个人记忆 runtime：

- execution-control 通过官方 Go SDK/HTTP adapter 调用 Hindsight；
- Hindsight 拥有提取、图结构、retain、recall、reflect、observation、consolidation 和 bank
  生命周期；
- execution-control 拥有身份派生、bank policy、调用边界、Temporal activity 与有界结果；
- app-api 拥有用户设置、命令和产品投影，不直连 Hindsight；
- Agent runtime 只消费 execution-control 提供的有界记忆上下文，不持有 Hindsight 凭据；
- Hindsight 的数据库、模型与 embedding 配置属于其部署，不从 app-api 投影或
  execution-control 在线模型配置派生；
- Qdrant 只保存机构知识，不保存个人记忆。

用户管理、来源删除、generation fence 和 Temporal 命令语义由 ADR-0082 决定，当前行为由个人记忆
架构与接口合同维护。

## 后果

- 仓库不维护个人记忆 embedding、抽取 prompt、合并算法或第二套向量存储；
- 个人记忆不可用会降低或阻止相应记忆操作，但不会切换到另一套记忆实现；
- Hindsight 内部标识和原始 payload 不进入浏览器或模型可见工具；
- Hindsight MCP 和 Python tool 不直接暴露给 Primary Agent。

## 否决方案

- **使用 Qdrant 自建个人记忆**：仓库需要重建 Hindsight 已有的提取、图结构、合并和生命周期；
- **两套个人记忆同时写入**：产生两个事实来源和无法消除的一致性问题；
- **由供应商模型临时抽取记忆**：会形成不可观测、不可管理的第二条记忆路径；
- **直接暴露 Hindsight MCP 或 Python tool**：绕过 execution-control 准入、Temporal 生命周期、
  删除语义、凭据和多用户隔离。

## 相关文档

- `adr-0082-hindsight-lifecycle.md`
- `../architecture/system/memory-plane.md`
- `../contracts/app-api/memory.md`
