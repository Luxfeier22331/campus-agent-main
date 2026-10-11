# Agent Note: 执行与记忆职责解耦

Status: implemented

## 背景

Hindsight 已作为独立服务拥有记忆内容及 provider operation，但 execution-control 的记忆命令、
访问屏障和回答后追加仍混在回答应用与 Temporal Activity 内。部署分离不等于应用职责已经清楚，
也不能据此证明还需要一个 memory-control 服务。用户确认以现有部署和持久合同完成模块解耦，
并将召回后的模型上下文格式化移入 agent-runtime。

前两步已经分离共享 Writer、输入读取、两类 callback，抽取 HTTP 用例并划分资源组装；对应理由见
[内部依赖整理](./2026-10-10-activity-dependencies.md)。本篇收口后续记忆应用与 Runtime 迁移，
保留[个人记忆协调器](./2026-09-24-agent-memory-coordinator.md)及
[记忆访问边界](./2026-09-24-memory-access-boundary.md)规定的生命周期和清除行为。

## 决策

### 记忆应用拥有自己的用例

`internal/memoryapplication` 拥有管理准入与查询、命令执行、receipt 终态、generation/fence、lease、
追加恢复与 workflow revival 端口；只依赖记忆领域、标准库及无基础设施耦合的辅助库，不导入
execution/executionapplication、HTTP、Temporal SDK、provider 或 persistence。原 executionapplication
记忆实现删除，不保留旧包别名。存储和 Hindsight adapter 按这些端口注入。

记忆 Temporal adapter 负责 Activity 身份、DTO 和错误映射及回调传输，不持有回答 Writer、InputReader
或完整配置。命令管理和画像读取无需回答 run。账号删除总协调仍在 App API；本地
OwnerDeletionService 保留执行排空、记忆 owner 标记、执行最终删除的既有顺序。

### 回答与追加通过明确桥接连接

`temporaladapter/answermemory` 校验回答与 finalization 已成功，加载冻结输入，生成只含本轮用户消息
的 typed append input，并通过 checkpoint 接口拥有 `memory.append` step/attempt/result 投影。
记忆应用负责提交与查询稳定 Hindsight operation；提交确认丢失、终态投影修复、lease 释放和
owner erase 等待仍沿用现有语义。必须先完成终态投影，再释放 lease；未知状态不能提前释放。异步追加的提交准入、每次查询的恢复检查及终态释放统一由追加服务
拥有；provider 包装器只保留召回的短调用屏障。装配显式传入异步执行和管理读取能力，
不再以类型断言发现能力。同一持久 lease 的跨 generation 恢复语义保持不变。

用户确认没有旧 workflow，因此删除同步追加实现、Activity 注册、DTO 和版本分支；回答完成后
统一启动独立 `MemoryAppendWorkflow`，保留异步追加的稳定身份和恢复语义。模块独立不意味着数据生命周期独立：恢复仍通过桥接读取回答 run、终态与输入；
本轮没有新增 append 输入副本、事件、outbox 或表，也不调整回答数据保留策略。

### Runtime 拥有模型上下文格式

运行内工具共享 `RunToolAuthorizer` 校验 run、attempt 和准入工具。`PersonalMemoryRecallToolService`
拥有冻结 admission 校验、输入加载及召回请求构造，消费仅含 Recall 的
窄端口，经现有访问 fence 调用 Hindsight。Hindsight adapter 保留数量限制和单条 1200 UTF-8 字节
截断，返回有序事实与现有配置的字符预算；不再拼接中文模型文本。

Runtime 的工具执行器在 runner 消费与工具记录之前将 `{facts, context_char_budget}` 转为原有
`{outcome, memory_text}`。两种 runner 共用格式化器；标题、事实顺序、Unicode codepoint 计数和
完整行准入沿用原行为，超长行放不下时仍尝试后面的短行。空事实为 no_match。保留旧实现对极小
预算的标题行为，本次不同时修改预算策略。模型自主调用 recall，不自动注入上下文。

内部 response schema 与工具 fingerprint 同批更新；模型结果 schema、产品结果、receipt/history
净化保持原合同，有界 evidence 仍可包含记忆摘录。旧 Go 格式化实现删除，不维护双实现或双解析。
API、Worker、Runtime 按[发布操作](../../../../docs/runbooks/release/release.md#个人记忆召回合同切换)
在维护窗口排空后协同切换，回退同样按兼容组合进行。

### 记忆操作的预算与未知状态

recall、画像和同步记忆访问由 memory application 创建一个共享 operation budget；provider 的连续 HTTP
请求和临时 call lease 从同一剩余时间派生。异步追加继续使用持久 lease，直到远端 operation 明确终态。

`memory_add` 使用 Hindsight async retain 和稳定 operation identity。提交确认丢失、查询超时或网络中断
只产生内部 `processing`/`unknown`，不重新提交同一业务写入；只有 provider 明确完成、失败或取消才写入
成功或失败 receipt。产品仍使用既有 `admitted` 状态，未知结果不提前清除 generation 或 bank。

画像懒创建、bank 不存在的空画像和 refresh 状态解释由 memory application profile service 拥有，
Hindsight adapter 只负责 bank/model SDK 访问与响应解析。memory application 通过 recall、profile、命令、
异步追加窄端口连接消费者；调用方分别注入命令执行、召回、画像读取、call lease、command receipt 和 owner lifecycle 能力，不再依赖聚合 executor/store 或兼容 fallback。

### 读取、工具用例与 Runtime 传输边界

`executionreadmodel.StoreReader` 只接收现有七方法 Reader，不通过聚合 RunStore 获得写能力。
HTTP 分别注入 Campus Search 和 Personal Memory Recall port；两者共享运行授权，搜索服务单独拥有
索引绑定、检索和诊断，召回服务单独依赖记忆召回端口，不保留聚合 AgentToolService 或委托兼容层。

`executionapplication` 定义内部 Runtime request、result、event 和 classified failure；
`agentruntimeprotocol` 只定义 wire 数据，`outboundadapter` 唯一拥有请求编码、JSON/SSE 解码、schema
校验及 HTTP 错误分类。应用继续拥有事件顺序、请求身份、operation 结果合同与投影，不依赖 wire
schema 或 HTTP 状态控制分支。HTTP 状态仅作为诊断证据保留。

Runtime client 的本地 `Prepare` 在 receipt 准入前验证编码与大小并计算逻辑请求指纹；Execute 使用
同一编码器。指纹沿用 canonical map JSON 并排除 activity attempt，保持重试复用 receipt 的语义，
不引入持久 prepared token。版本校验迁移到 adapter 不改变网络合同和安全错误文案。

## 未采用方案

- 新增 memory-control 服务能隔离部署，但不会自动解除追加对回答数据的依赖，还会增加网络与发布
  合同；当前所需收益来自用例和依赖收拢，保留现有 API/Worker 与 Hindsight 部署。
- Runtime 直连 Hindsight 可以少一次中转，却需要迁移运行身份、generation、lease 和账号清除协调；
  这些是持久应用职责，因此只迁移模型上下文格式，不迁移访问屏障与恢复状态。
- 保存独立 append 输入可以允许回答数据先删除，但当前没有独立保留周期需求；继续使用桥接，
  不为了宣称完全解耦新增持久副本、事件或事务边界。
- 为召回维护双传输可支持混合发布，但本轮选用现有维护与排空流程，避免长期兼容分支。

## 后果

记忆业务规则不再写在 Temporal adapter 或回答应用内，回答投影变化通过桥接吸收；中文上下文规则
由实际模型消费者 Runtime 唯一维护。依赖边界检查约束记忆核心不得反向导入回答和基础设施，记忆
adapter 不得直接取得回答 store、InputReader 或桥接实现。

验证复用访问 fence、清除排空、命令恢复、追加提交确认丢失及终态投影恢复测试；命令 operation 已覆盖稳定 ID 的重复调用不重复 retain，Temporal workflow 已覆盖 processing 后轮询；新增真实 Node/Go
召回 HTTP 合同、两种 runner 的工具消费/记录和 Unicode 预算测试，并保留 Temporal replay 验证。
这些覆盖源码边界；实际 Hindsight 服务运行与环境版本切换仍由环境发布流程确认。

后续独立部署方案见[Agent 编排与 Memory 独立服务](./2026-10-10-agent-orchestration-memory-services.md)；
该方案取代进程内 Memory 边界，保留本文的领域合同和 generation fence。
