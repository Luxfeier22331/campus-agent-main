# Agent Note: execution-control 内部依赖整理

Status: implemented

## 背景

用户要求先整理 execution-control 内部依赖。执行、记忆和终态 adapter 此前都嵌入
`finalization/projection.Writer`，由它取得完整配置、输入读取和两类产品回调。消费者依赖
终态子目录并不代表它们属于终态处理；共享结构还让模型 operation 能访问不需要的产品回调。

HTTP handler 还直接编排记忆命令与账号删除，两者共用的资源容器平铺回答存储、输入、
记忆 provider 和状态存储。由此 HTTP 持有整套记忆状态操作，删除顺序也藏在传输层。

## 决策

步骤/事件投影规则由 `executionapplication/projection.Writer` 拥有，只接收投影所需的窄存储接口、
worker identity 与显式调用元数据。运行状态写入和终态 CAS 分别注入 operation 与 finalization 服务，
Writer 不暴露创建 run、删除 owner、派发或取消调度能力。Temporal 身份校验与 SDK 元数据提取由
`temporaladapter/executioncontext` 拥有，旧同步记忆追加通过薄投影 adapter 保留 replay 行为。

`executionapplication/operation.OperationService` 拥有准入、冻结输入、调用身份、receipt 重放、
流事件顺序和结果投影；`finalization.FinalizationService` 拥有成功保护、引用校验、产品回调、
失败/超时/取消收尾与投影修复。API reconciler 直接消费后者，Activity 仅完成身份、心跳、DTO
和错误映射。服务不读取 Temporal context，也不持有完整配置。

`executioncontract` 拥有中立 operation 类型和共享计划规则，Temporal 保留独立 DTO 与显式转换。
`outboundadapter` 拥有 Runtime HTTP、JSON/SSE 解码、响应关闭和传输错误；通过同步类型化事件
回调交付应用，消费者失败即停止读取。调用请求正文、receipt hash、wire/history 格式保持不变。

输入访问由 `executionapplication.InputReader` 提供；回答与记忆分别消费自己的回调端口。
回调传输错误留在 outbound adapter，通过行为接口分类，无须让记忆路径导入回答应用。
HTTP readiness 只依赖检查端口，不再聚合回答和记忆的工作流启动能力。共享 HTTP client 与
Temporal starter 实例继续由组合根分别注入实际消费者。

记忆命令准入、workflow identity、owner scope 和 receipt stale 判断进入
`memoryapplication.MemoryManagementService`，仅依赖命令 starter 和管理所需的状态接口。
`OwnerDeletionService` 通过既有 OwnerDeletionStore 与 MemoryOwnerDeleter 协调删除，
不直接依赖记忆存储。它保持 begin、执行排空、记忆 owner 标记、执行 finalize 的顺序；
已删除直接成功，执行未排空不访问记忆，记忆失败不进入最终删除。HTTP 保留认证、
输入校验、原状态码和错误体映射，不再持有 MemoryStore。画像读取继续使用既有窄 reader。

生产组合根分别构建 executionResources 与 memoryResources，保留共享 Temporal client
和原关闭生命周期；按实际消费者注入两类产品回调。记忆资源构造不依赖回答存储或输入，
追加 Activity 所需的回答连接仍在 worker 装配处显式提供。

本次只改变内部依赖；执行状态和终态 CAS 仍由原存储实现，workflow、队列、HTTP、Hindsight
访问和部署合同继续有效。后续记忆应用和 Runtime 迁移见[执行与记忆职责解耦](./2026-10-10-execution-coupling-governance.md)。

## 未采用方案

- 只移动 Writer 能修正目录层级，却仍向每个消费者提供全部依赖，因此同时分离输入与回调。
- 将全部字段改放 CommonRuntime 能减少构造参数，但会保留相同的跨职责依赖。
- 拆独立服务或迁移到 agent-runtime 可以重新分配部署责任，但不是消除当前进程内错误依赖的前提。

## 后果

执行和终态通过应用投影复用规则，记忆通过桥接连接回答数据，不再把 finalization 当公共基础设施。
测试组合器保留在 integration 内，显式连接各 owner；生产不引入合并 adapter。
记忆命令管理与账号删除用例可经窄端口测试，无需组装模型 operation、Hindsight 或 Temporal Server。
HTTP 组件测试覆盖命令准入、owner scope、stale 状态和删除顺序、短路及错误映射。
记忆追加仍按现有合同关联回答记录；后续由 answermemory 桥接承接连接，不能将模块解耦描述为
已完成记忆服务化或数据生命周期独立。
