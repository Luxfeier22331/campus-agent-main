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
- Runtime 的结果提交只做合同归一化与投影，不进入旧模型执行入口，也不创建 operation 级模型 receipt。
  完成载荷和完成时间先持久化，投影中断后的重试使用相同输入修复写入。
  Runtime 的后续阶段和编排决定读取 Control 保存的归一化结果；被拒绝的重规划沿用既有计划。
  失败投影载荷使用与数据库读取一致的 JSON 对象，避免重放时将字段顺序差异误判为陈旧写入。
  流式完成事件仍由实际启动流的 Runtime 写入，缓冲 Solve 的完成事件由 Control 写入。
- Control HTTP 保留应用错误的 code 与 retryable 分类，Runtime 在 Activity 边界将永久错误转换为
  Temporal 不重试失败，交给 Workflow 收尾；失败收尾携带实际步骤 ID，避免被 Control 拒绝。
  网络与存储暂时故障保留重试。
- Stage 保存非敏感模型标识，工具执行、结果归一化和收尾不再读取 Model Config。模型调用先回放已完成
  receipt，仅新调用解析凭据并检查 deadline；执行预算过期不阻止已获得结果的投影与终态收尾。
  单次 SDK model 调用显式提供禁用导出的 trace context，替代此前 Runner 提供的调用上下文。
- Memory API 在独立数据库中原子接收完整输入与派发意图，Memory Worker 启动和恢复操作。
  Hindsight 继续拥有记忆内容，Memory 数据库拥有命令、generation fence、调用租约和恢复进度。
- 手工新增记忆在查询返回 HTTP 200 且 operation status 为 `not_found` 时，按与 HTTP 404 相同的
  提交分支处理，沿用稳定 operation ID；查询失败仍保留未知状态。判断放在 `memory_add` 中，
  保留公共查询接口的原始状态语义，避免改变会话追加恢复对 `not_found` 的处理。
- erase 不排在普通命令后等待，而是先推进 generation fence，再排空已启动的旧代操作，沿用已有
  排空超时。未启动的旧代命令直接失败并回调，不调用 Hindsight；旧代命令收尾不得覆盖新代 lifecycle。
- 产品终态确认后，由 control 持久投递最小 append 输入；Memory 接收后由它负责后续执行。
  终态输入清理必须晚于租约释放。Memory 不读取 execution run、step 或产品消息。
  外部投递装配不创建旧 `memory.append` 步骤，追加进度由 Memory 管理；本地模式仍保留该步骤。
  关闭个人记忆时不准备外部投递，也不创建旧步骤。
- Agent 双轨切换按 owner 稳定分桶，路由在接收时冻结。旧运行排空后删除旧 Go Workflow 与 HTTP
  模型操作入口。Memory 使用短维护窗口复制状态，保持 owner salt、bank identity 和 generation，
  单写切换，不双写。
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
数据库集成覆盖独立 schema、排空复制、重复接收、命令顺序和 control 终态投递事务；
Temporal 集成覆盖直接回答、计划重规划合成和工具预算失败后的恢复合成。
真实 Activities 经 control HTTP 到 PostgreSQL 的回归覆盖结果投影、部分写入后的重试、过期收尾与
receipt 回放；Memory Activity 数据库回归覆盖 erase 越过未启动命令、排空已启动命令及排空超时。
手工新增的 HTTP 回归通过实际 Go SDK 覆盖 `200 + not_found`、提交、处理中与完成，防止仅模拟
“操作不存在”错误而遗漏实际响应合同；已有操作和查询失败不触发新的提交。
实际 Hindsight 与产品部署的端到端切换由环境发布步骤验收。

双轨部署期间仍保留 Go Workflow、HTTP operation runner，以及 control 的本地 Memory 装配分支。
独立模式的部署不向 control 注入 Hindsight 配置；新的投影 API 复用提取后的 operation 结果归一化与投影逻辑。
路由按 owner 分桶，在 run 接收时冻结；100% 切换且旧运行排空后，才能删除旧执行路径和装配分支。
Memory 复制在旧写入停止后运行，不双写；新服务产生写入后，不能仅回退服务镜像恢复旧数据库。
源码实施不等于环境已经切流，部署与退役顺序由执行运维文档维护。
