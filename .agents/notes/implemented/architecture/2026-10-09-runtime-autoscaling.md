# Agent Note: 执行面自动扩缩容

Status: implemented

## 背景

团队没有实时监控并手工调整副本的人力。此需求来自 #384，不以已发生容量故障为前提。API 与 Worker
已经分离；控制面请求量不能代表长时间模型请求或 Temporal 队列的执行压力。

## 决策

源码提供 SDK slots 与完整 HTTP 请求生命周期的最小指标，环境仓用 KEDA 和单副本 Prometheus
独立扩缩 execution-worker 与 agent-runtime。SDK 继续拥有 slots；小型 MetricsHandler 只适配它的
两个 gauge 和固定标签，不新增 activity registry。外部 tally 适配器会引入过时的 genproto 依赖冲突，
因此此出口直接实现 SDK 已有接口，不扩大 SDK 或依赖迁移范围。

业务 deadline、receipt、取消和终态合同不变。Worker 等待已领取 activity，Runtime 等待已接受请求和
流结束；等待预算覆盖最长 core activity，进程和 Pod 退出预算逐层留出清理时间。正常缩容不依赖
重试模型调用；队列为空和稳定窗口不能证明运行中任务已经完成。

指标消费者只有扩缩容策略。Worker gauge 使用 SDK 名称，标签限定 task_queue/worker_type；Runtime
活跃请求不含业务标签，Prometheus 增加有限的 Pod 发现身份。仅在集群内采集，10 秒全量抓取，保留
2 小时临时数据，不写入业务数据库、日志或 trace。数据缺失与零分离，部分抓取失败不产生较小总量。
环境 owner 持有阈值、资源、副本上限及 Argo replicas 所有权；应用不调用 Kubernetes API。

本篇部分替代手工副本管理选择；[API 与 Worker 部署边界](./2026-10-02-execution-api-worker.md)
中的进程划分、共同发布与持久运行所有权保持有效。

## 未采用方案

- 仅按 CPU 扩容部署简单，但远程模型调用等待时 CPU 无法代表 slots 和 HTTP 承载量。
- 仅读取 backlog 省去指标平台，但已领取任务从队列消失，不能支撑正确的缩容判断。
- 三类 poller 拆成独立 Deployment 能分别分配资源，但目前无需改变部署合同即可接入多个队列信号。
- 引入全局 limiter 或自研扩缩器可统一预算，但现有需求是自动管理副本，平台机制足够。
- 直接依赖 Temporal retry 可以缩短退出时间，但不确定的 Provider 调用与已发布流不能保证无损恢复。

## 后果

指标服务与平台组件增加固定资源开销，实际容量上限仍受节点、Provider、数据库和 Temporal 限制。
最小副本为 1；首版最大副本与并发目标是受限环境参数，需发布后受控负载验证，源码测试不证明集群效果。
排空 Pod 仍占资源，必须计入发布与扩缩容预算。若移除对应 ScaledObject，应同步退役无人消费的指标、
采集和专用 Prometheus；若出现队列资源明显不对称，再重新评估 Worker 部署划分。
