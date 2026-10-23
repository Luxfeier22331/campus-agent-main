# Agent Note: 个人记忆命令结果不确定性

Status: implemented

## 背景

execution-control 的本地 receipt 可能长时间没有被 workflow 触碰，或者 Hindsight retain 请求在
提交后经历超时、冲突、限流或服务错误。此前 erase 会把 stale receipt 写成
`failed/memory_receipt_abandoned`，并据此允许旧 generation 排空；这只证明本地 workflow 没有
继续更新，不能证明远端 operation 没有接受写入。Temporal Activity 传输错误也曾被直接投影成
业务失败，导致相同风险。

## 决策

- stale receipt 继续保持非终态并阻塞 generation drain。app-api 复用原 payload、command ID 和
  workflow ID 重新准入；运行中的 workflow 继续使用同一 provider operation identity，已结束的
  workflow 重新查询或恢复，不创建第二次业务写入。
- provider retain 只有明确的客户端拒绝才映射为既有业务失败。超时、冲突、限流、服务错误和
  提交确认丢失都返回 `unknown`，由同一 command 继续恢复；不释放 lease，不删除 bank。
- Temporal command workflow 遇 provider Activity 的非终态错误时保留 `unknown` 并继续调用同一
  command。owner gate 等待超过既有上限仍可写入 `memory_command_wait_timeout`，因为该命令尚未
  触达 provider；输入合同错误仍是终态失败。
- 删除 `AbandonStaleGenerationReceipts` 及 `memory_receipt_abandoned` 持久化路径，避免把本地
  stale 判定扩展成远端终止协议。

## 未采用方案

- 将 stale receipt 直接标记失败并放行 erase：实现简单，但可能在 Hindsight 仍写入时删除 bank，
  破坏 generation 隔离。
- 对所有 HTTP 4xx 都判为明确拒绝：冲突、限流和请求超时仍可能对应已接受的异步 operation，
  不能作为安全失败证据。
- 为未知 operation 新建 retry command 或第二个 operation ID：会产生重复业务写入；稳定 operation
  identity 和现有 workflow 恢复已经覆盖该场景。

## 后果

本地状态不再伪造 provider 终态，清除在无法确认旧 operation 停止时继续受 drain 屏障保护；
app-api 的 stale reconcile 负责恢复同一命令。明确拒绝仍沿用现有失败码和用户重试语义。测试覆盖
了内存与 PostgreSQL receipt drain、Hindsight HTTP 分类、Temporal 同命令恢复和失败投影。

本决定取代[个人记忆协调器](./2026-09-24-agent-memory-coordinator.md)中“erase 排空放弃陈旧
receipt”的条目；其余 owner、generation、lease 和生命周期合同继续有效。
