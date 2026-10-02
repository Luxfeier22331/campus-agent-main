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

## 后果

两个进程会多持有连接池和 Go 基础内存；资源由环境仓分配，此次保持 Staging 总额度。
维护开关写入不可变 App API 版本，开关变更必须重新发布并选择版本。
发布入口提供显式 App API 配置刷新，复用原候选与 GitOps 流量选择；源码游标未变化时也生成候选，
否则仅靠 accumulated diff 无法退出维护。Worker base 的滚动参数必须成对有效，环境仍拥有资源策略。
三类队列及默认 slots 不变；Worker 重新启动依靠已有 Temporal history 和 receipt，不重新调用结果不确定的模型。
当最后一个维护流程不再消费开关时，连同环境投影一起退役；目前它用于首次切换和同合同回退。
