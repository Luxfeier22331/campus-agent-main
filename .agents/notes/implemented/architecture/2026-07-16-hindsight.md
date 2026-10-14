# Agent Note: Hindsight 自托管个人记忆

Status: implemented

## 背景

个人记忆需要支持多用户、多会话 recall、完成轮次 append、用户显式管理、账号删除/RTBF 和
跨 thread recall。Qdrant-native 方案要求仓库自行维护 extraction prompt/schema、embedding、
dedupe/merge 和 collection 生命周期，这些不属于机构知识检索。

Hindsight 提供 retain、recall、observation、consolidation、Memory Defense 和 bank
生命周期。系统可以使用这些成熟能力，同时把产品设置、准入和受控投影留在自有边界。

## 当前适用范围

本文原先由 execution-control 承担的 Memory 所有权已被[Agent 编排与 Memory 独立服务](./2026-10-10-agent-orchestration-memory-services.md)
取代。当前 memory-service 独立拥有 Hindsight 适配、命令执行和恢复；本文的内容边界与生命周期理由
继续有效，现行接口以个人记忆架构和合同为准。

## 决策

Hindsight 是唯一个人记忆 runtime：

- memory-service 通过官方 Go SDK/HTTP adapter 调用 Hindsight；
- Hindsight 拥有提取、图结构、retain、recall、observation、consolidation 和 bank
  生命周期；
- campus-agent 不调用 Hindsight reflect；回答中的记忆推理由 Primary Agent 基于有界 recall
  工具结果完成；
- memory-service 拥有身份派生、bank policy、调用边界、记忆命令/追加 Workflow 与有界结果；
- agent-control 在产品终态事务中持久保存追加输入和投递意图，交付 Memory API 后由 Memory 推进；
- app-api 拥有用户设置、命令和产品投影，不直连 Hindsight；
- Agent runtime 只在本轮个人记忆可用时暴露仓库正式的 `personal_memory_recall`，通过
  Memory API 取得有界事实并格式化为模型上下文，不持有 Hindsight 凭据；
- Hindsight 的数据库、模型与 embedding 配置属于其部署，不经过产品 Model Config；
- Qdrant 只保存机构知识，不保存个人记忆。

用户管理、完整清除、generation fence 和来源删除退役的语义由 [Hindsight 记忆生命周期](./2026-07-17-hindsight-lifecycle.md) 决定，当前行为由个人记忆
架构与接口合同维护。

## 未采用方案

- **使用 Qdrant 自建个人记忆**：仓库需要重建 Hindsight 已有的提取、图结构、合并和生命周期；
- **两套个人记忆同时写入**：产生两个事实来源和无法消除的一致性问题；
- **由供应商模型临时抽取记忆**：会形成不可观测、不可管理的第二条记忆路径；
- **直接暴露 Hindsight MCP 或 Python tool**：绕过 Memory 访问准入、Temporal 生命周期、
  删除语义、凭据和多用户隔离。

## 后果

- 仓库不维护个人记忆 embedding、抽取 prompt、合并算法或第二套向量存储；
- 个人记忆不可用会降低或阻止相应记忆操作，但不会切换到另一套记忆实现；
- 用户管理现为整篇画像和自然语言纠正；早期原生 memory ID 与逐条管理接口已由
  [协调器合同](./2026-09-24-agent-memory-coordinator.md)取代，bank/tenant 标识及供应商原始 payload
  不进入浏览器或模型可见工具；
- Hindsight MCP、Python tool 和原始 API 不直接暴露给 Primary Agent。

## 相关文档

- [Hindsight 记忆生命周期](./2026-07-17-hindsight-lifecycle.md)
- [个人记忆](../../../../docs/architecture/system/memory-plane.md)
- [App API 个人记忆接口](../../../../docs/contracts/app-api/memory.md)
- 部分取代 [用户身份、记忆与个性化边界](2026-07-16-memory-boundaries.md)
