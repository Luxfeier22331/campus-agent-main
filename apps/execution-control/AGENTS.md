# AGENTS.md

本文件补充仓库级指南，仅适用于 `apps/execution-control`。

## 所有权边界

- 本应用拥有 Go execution-control 服务、Temporal 生命周期、脱敏投影和运行时可观测性。
- 浏览器产品状态和认证属于 app-api；Agent 与工具循环属于 agent-runtime；采集、向量集合
  生命周期和来源发布不属于本应用。
- 生成的执行 wire contract 是请求和响应的权威来源，不得再增加第二套解析器、别名模型
  或兼容 envelope。

修改服务边界前，先阅读 `apps/execution-control/README.md` 以及相关运行时架构和合同文档。

## Go 代码组织

- `internal/httpapi/server.go` 只负责组装和路由注册。
- 行为测试放在所属领域或 handler 附近。
- 指标状态与记录逻辑应和 exposition 格式化分离。

## 验证

具体命令以仓库验证指南为准。本应用的 Go 改动运行手动 `go` validation profile。
