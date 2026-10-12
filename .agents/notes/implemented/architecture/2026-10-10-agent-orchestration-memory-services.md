# Agent Note: Agent 编排与 Memory 独立服务

Status: implemented

## 背景

用户确认将完整 Agent 编排迁入 agent-runtime 的 TypeScript Temporal Workflow，并将 Memory
拆为独立 API、Worker、数据库与 Workflow。此前
[执行耦合治理](./2026-10-10-execution-coupling-governance.md)
选择的进程内 Memory 模块边界不能承载此次独立部署和恢复所有权；其领域合同与 generation fence
继续保留。

## 决策

- agent-runtime 拥有 Solve、Execute、Replan、Synthesize 决策，单次模型请求与单次外部工具调用分别是
  Activity。校园检索按确定顺序分配引用；provider continuation 留在持久化载荷中。
- agent-control 保留运行接收、取消、投影、载荷和结果投递的唯一写所有权。Runtime 通过 typed API
  写投影；Temporal history 仅携带引用和有界编排决定。
- Control 的结果提交只做边界校验与投影，不进入旧模型执行入口，也不创建 operation 级模型 receipt。
  完成载荷和完成时间先持久化，投影中断后的重试使用相同输入修复写入。
  Runtime 归一化模型结果并生成持久阶段决定，后续编排不读取 Control 返回的业务决定；
  被拒绝的重规划保留用量并沿用既有计划。
  失败投影载荷使用与数据库读取一致的 JSON 对象，避免重放时将字段顺序差异误判为陈旧写入。
  流式完成事件仍由实际启动流的 Runtime 写入，缓冲 Solve 的完成事件由 Control 写入。
- Control HTTP 保留应用错误的 code 与 retryable 分类，Runtime 在 Activity 边界将永久错误转换为
  Temporal 不重试失败，交给 Workflow 收尾；失败收尾携带实际步骤 ID，避免被 Control 拒绝。
  网络与存储暂时故障保留重试。
- Stage 保存非敏感模型标识，工具执行、结果归一化和收尾不再读取 Model Config。模型调用先回放已完成
  receipt，仅新调用解析凭据并检查 deadline；执行预算过期不阻止已获得结果的投影与终态收尾。
  单次 SDK model 调用显式提供禁用导出的 trace context，替代此前 Runner 提供的调用上下文。
- Control 按输入准备、模型调用 receipt、结果边界、运行投影和 finalization 拆分用例；HTTP action
  使用各自请求类型与端口，Temporal 客户端不再承载旧 Activity wire 或双向转换。
  Runtime-Control JSON Schema 归共享 contracts，Go 与 TypeScript 类型由同一来源生成。
- Activity 身份由 Runtime 显式传递，Control 验证已绑定的 Workflow/Run ID 并写入投影。
  请求上下文携带证据，不修改共享 writer；重放保留已保存的 attempt，工具记录实际工具 Activity。
  产品阶段标识使用 `agent.solve`、`agent.execute_step`、`agent.replan`、`agent.synthesize`、
  `memory.append` 和 `finalization.write`，不再冒充 Go Activity 注册名。
- Control 的临时 payload 在产品终态与 Workflow 关闭后由既有 reconciler 清理。产品终态先落库而
  Activity acknowledgement 尚未成功时仍需要重试读取输入，因此不能在 finalization 事务后立即删除。
  完成事件缺失时保留以供修复；清理失败不改变终态，沿用下一轮 reconcile，不增加持久清理队列。
- Memory API 在独立数据库中原子接收完整输入与派发意图，Memory Worker 启动和恢复操作。
  存储固定使用 `memory` schema，集成测试使用独立 owner；主库历史状态表通过新增迁移退役。
- Hindsight 继续拥有记忆内容，Memory 数据库拥有命令、generation fence、调用租约和恢复进度。
- Search 响应与引用合同位于 `packages/search-api-go`，Control 不依赖 Search 应用实现。
  检索、索引和内部观测保留在 Search，避免共享包再次变成运行时聚合。
- 剩余 execution-runtime 部署聚合拆为 Campus Search、Notice Pipeline、Model Config owner；
  Search 与 Notice 各自使用 ServiceAccount、网络策略和环境配置，Ops Web 使用自身 Temporal 配置。
  Source 先增加独立 base，GitOps 固定实际发布 SHA 并接管资源，最后删除旧聚合 base 和发布登记。
  `app_api` 角色及连接 Secret 归 GitOps data-postgres，Qdrant CA 继续归 foundation。
- 手工新增记忆在查询返回 HTTP 200 且 operation status 为 `not_found` 时，按与 HTTP 404 相同的
  提交分支处理，沿用稳定 operation ID；查询失败仍保留未知状态。判断放在 `memory_add` 中，
  保留公共查询接口的原始状态语义，避免改变会话追加恢复对 `not_found` 的处理。
- erase 不排在普通命令后等待，而是先推进 generation fence，再排空已启动的旧代操作，沿用已有
  排空超时。未启动的旧代命令直接失败并回调，不调用 Hindsight；旧代命令收尾不得覆盖新代 lifecycle。
- 产品终态确认后，由 control 持久投递最小 append 输入；Memory 接收后由它负责后续执行。
  终态输入清理必须晚于租约释放。Memory 不读取 execution run、step 或产品消息。
  投递装配不创建旧 `memory.append` 步骤，追加进度由 Memory 管理。
  关闭个人记忆时不准备外部投递，也不创建旧步骤。
- 新运行固定进入 TypeScript AgentWorkflow；旧 Go Worker、Workflow 和 HTTP 模型入口
  已删除，不承担旧 history 支持。Control 不再装配本地 Memory/Hindsight 或工具执行服务。
  应用身份统一为 agent-control；数据库 schema/role、Secret 对象与键、Temporal namespace/queue
  保持既有持久身份。
- 账户删除由 app-api 协调 Agent 排空、Memory erase 和 tombstone、execution 清理、产品清理。

## 未采用方案

将整轮 Runner 放进单个 Activity 实施较小，但进程故障会跨越多个模型和工具调用，无法让 Temporal
掌握实际推进点。保留 Go 编排并仅移动协议也较小，但不能形成用户确认的 Agent owner。

Memory 共用 execution 数据库可以少做迁移，但继续保留部署和状态清理耦合，不满足独立子系统要求。

Worker 到 Control/Memory 的通信与凭据边界由[集群私有入口](2026-10-11-cluster-private-ingress.md)
补充；本篇的编排和 Memory 所有权决定保持有效。

## 后果

TypeScript Workflow 拥有步骤与模型/工具调用推进；control 仍是产品运行投影唯一写入者。
模型 receipt 已完成时可恢复保存结果；调用已开始但结果未知时按既有不确定结果合同终止，
不承诺外部模型的 exactly-once 执行。工具当前均为读取，独立 Activity 保留既有工具预算与错误语义。

Memory API 接收后由独立数据库和 Worker 负责推进，终态输入清理晚于租约释放与命令回调。
数据库集成覆盖独立 schema、重复接收、命令顺序和 control 终态投递事务；
Temporal 集成覆盖直接回答、计划重规划合成和工具预算失败后的恢复合成。
真实 Activities 经 control HTTP 到 PostgreSQL 的回归覆盖结果投影、部分写入后的重试、过期收尾与
receipt 回放；Memory Activity 数据库回归覆盖 erase 越过未启动命令、排空已启动命令及排空超时。
手工新增的 HTTP 回归通过实际 Go SDK 覆盖 `200 + not_found`、提交、处理中与完成，防止仅模拟
“操作不存在”错误而遗漏实际响应合同；已有操作和查询失败不触发新的提交。
实际 Hindsight 与产品部署的端到端切换由环境发布步骤验收。

四个部署 owner 分别是 agent-control、agent-runtime、Memory 和 cluster-private-ingress。
Memory 已独立的数据及 Hindsight owner salt 保持原样，不重复复制或清空数据库。
源码与环境清单分别通过 Source 和 GitOps PR 交付。迁移完成后删除一次性状态复制命令及旧实现
归档，避免发布镜像和当前运维手册继续提供过期切换入口；历史实现由 Git 历史保存。
持久化 Hindsight 配置继续由 Memory 的发布升级任务维护，不属于一次性数据库迁移。

本轮结果合同变更要求 Control 与 Runtime 配对交付：Runtime 提交合成证据，Control 不再恢复材料。
旧 Control 拒绝新 Runtime 的合成证据，新 Control 也不会替旧 Runtime 补齐材料。因此两者版本
不混用来执行会话；在已确认无旧 Workflow 的窗口完成两者更新后再验收新会话。
Source 保留旧部署 base 供 GitOps 接管；候选规划登记独立 owner，发布 workflow 使用统一候选命名。
GitOps 新路径的 ref 需要选择包含目录的真实发布 SHA；本地渲染只证明资源合同，不证明部署完成。
