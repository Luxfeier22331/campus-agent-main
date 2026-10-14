# Agent Note: 退役历史执行路径

Status: implemented

## 背景

旧 `/internal/execution/requests/...` 路径源于已退役的 execution-control 架构，但仍被 agent-control、App API、cluster-private-ingress、agent-runtime 诊断和 OpenAPI 合同使用。继续暴露这些路径会让当前调用者误以为旧控制面仍然存在，也会让新的 Inspect 接入错误地依赖历史命名。

## 决策

运行投影和控制操作统一使用 `/internal/agent/runs/...`；App API 的执行输入和产品终态回调统一使用 `/api/internal/agent/runs/...`。agent-control 只注册新路径，cluster-private-ingress 只代理新路径，OpenAPI、调用方、测试和路由暴露清单同步更新。旧路径返回 404，不保留重定向或兼容别名。

这次只清理 HTTP 合同路径。数据库 schema、环境变量、内部 Go package 名称和稳定错误码仍由各自现有合同拥有，不因路径重命名扩大范围。

## 未采用方案

保留旧路径并转发到新路径可以降低短期迁移成本，但会继续暴露已经退役的架构名称，并使合同同时拥有两套可调用地址，因此不采用。

把数据库 schema、配置键和内部 package 一并重命名会扩大迁移面，且与本次清理 HTTP 合同路径无关，因此不纳入本次改动。

## 后果

App API、agent-control、agent-runtime、cluster-private-ingress 和 Inspect 未来 live ingress 必须使用新的 agent run 路径。依赖旧路径的未更新调用会明确失败，便于发现残留消费者；当前单元、路由、入口和合同检查覆盖了新路径与旧路径拒绝行为。

相关合同见[执行合同](../../../../docs/contracts/tool-execution.md)和[执行合同 OpenAPI](../../../../docs/contracts/schemas/tool-execution.openapi.yaml)。
