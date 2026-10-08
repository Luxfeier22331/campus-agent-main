# Agent Note: API 与 Worker 部署边界

Status: implemented

## 背景

Issue #579 要求分别管理业务 HTTP 与后台执行的资源、副本和停机生命周期。原合并进程使扩 API
同时增加三类 poller，聚合 readiness 还会因 Worker 或 Agent 故障摘除状态查询入口。
此次不做容量测量，也不把拆分本身描述为吞吐提升或主机高可用。

## 决策

API 保留所有原路由、Service 地址与 reconciler，独立 Worker 只组装三类 poller 和健康 listener。
同一 Go module、领域合同、数据库角色与镜像 digest 保持共同发布；不保留第三个合并进程入口。
本地开发也使用两个真实二进制，分别接受信号并关闭自身依赖。

API 进程 readiness 与原聚合诊断分开，Worker readiness 只检查本地 poller 生命周期与必要数据库。
API 的 HTTP 排空、Worker 的有界 SDK Stop 独立执行，持久命令和 receipt 仍由现有 owner 收敛。

HTTP server 只保存线程安全的 draining 标志供两个 readiness 接口读取；`requestTracker` 负责拒绝
新 HTTP 请求和等待已有请求，资源释放由 API owner 负责。未接入生产请求的本地 admission limiter、
空执行 registry 及其配置、诊断输出和 server 空 Shutdown 接口删除。执行 admission snapshot 的能力与
预算校验、持久运行状态和取消继续由 application、投影与 reconciler 拥有。
聚合诊断要求执行数据库已配置且健康；缺少数据库不能以空配置的健康默认值通过检查。

PostgreSQL 租约、会话互斥与终态 CAS 支持多个 API，不新增 leader、分布式 limiter 或模型重试。
合成响应先校验没有回传证据，再从已准入输入补回证据供终态和 receipt 使用，避免把本地补回误判为模型输出。

首次切换通过默认关闭的 App API `EXECUTION_MAINTENANCE` 暂停新执行入口，保留已接受工作收尾。
环境仓投递变量与资源、选择不可变 Worker 版本；先排空、停止旧实例，再启动两个角色。
账户删除会产生记忆命令，因此新增删除也属于暂停范围，已接受删除继续完成。

本篇替换当前合并 HTTP 与 poller 的部署选择；[Temporal 执行面](./2026-06-06-temporal.md)
中的持久执行、数据库投影与模型调用 receipt 所有权保持有效。

## 未采用方案

- 保持合并进程可以省一份运行时和连接池，但无法满足角色独立部署与停机要求。
- 三类 poller 分成三个 Deployment 可进一步独立扩容，但当前需求只要求 API/Worker 分离。
- 继续用聚合探针能阻止新回答进入故障依赖，却同时移除查询与取消入口，因此保留它作为诊断。
- 在线混跑新旧组合可减少维护时间，但首次角色迁移采用已确认的排空切换，不引入跨版本兼容机制。
- 保留本地 limiter 和 registry 可以沿用原诊断结构，但生产请求从未获取 lease 或注册执行，输出不能
  描述真实容量或生命周期，因此删除；若未来有已确认的本地资源保护需求，应围绕实际请求边界设计。
- 将停机状态与 limiter 一起删除能减少一个字段，但会丢失现有 readiness draining 合同，因此保留
  独立布尔状态，不扩展为新的生命周期控制器。

容量策略及有界排空预算由[执行面自动扩缩容](./2026-10-09-runtime-autoscaling.md)补充；本篇部署边界继续有效。

## 后果

两个进程会多持有连接池和 Go 基础内存；资源由环境仓分配，此次保持 Staging 总额度。
维护开关写入不可变 App API 版本，开关变更必须重新发布并选择版本。
发布入口提供显式 App API 配置刷新，复用原候选与 GitOps 流量选择；源码游标未变化时也生成候选，
否则仅靠 accumulated diff 无法退出维护。Worker base 的滚动参数必须成对有效，环境仍拥有资源策略。
终态 recovery schema 必须覆盖既有 Campus Search 来源合同字段；notice 的 `released_at` 由该 owner 统一保留。
三类队列及默认 slots 不变；Worker 重新启动依靠已有 Temporal history 和 receipt，不重新调用结果不确定的模型。
当最后一个维护流程不再消费开关时，连同环境投影一起退役；目前它用于首次切换和同合同回退。

readiness 测试以配置完整的运行投影和应用服务作为就绪基线，覆盖缺失或故障数据库、健康依赖下的
停机撤销，以及 API 探针与聚合诊断的分离。HTTP 排空测试保留请求 deadline 和资源关闭顺序的合同；
删除的进程内状态不再作为实际运行数量或执行容量来源。
