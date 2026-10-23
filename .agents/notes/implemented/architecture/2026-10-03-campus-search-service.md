# Agent Note: Campus Search 独立服务与 Bot 适配边界

Status: implemented

## 背景

现有 `campus_search` 将检索 provider、当前索引读取和 Agent run/step/citation 校验集中在
`execution-control`。AstrBot 和后续其他 Bot 只需要消费校园资料检索，不应伪造 Agent run，也不应
直接访问 Qdrant、embedding 或 reranker。

## 当前适用范围

[Agent 编排与 Memory 独立服务](./2026-10-10-agent-orchestration-memory-services.md)部分取代本文的 Agent 消费方所有权：Runtime 直接调用 Search
并分配引用编号，Control 保留准入、collection 绑定和投影。独立 Search、公共/内部接口及 Bot MCP
边界继续有效；拆分初期的 execution-control adapter 不是当前调用入口。

## 决策

- Campus Search 作为独立 HTTP 服务运行；服务拥有当前索引读取、embedding、Qdrant 和 reranker 调用。
- `agent-runtime` 调用内部搜索接口并分配 citation 编号；`agent-control` 拥有 run admission、索引绑定和运行投影。
- Bot 通过独立 stdio MCP bridge 消费 `campus_search` 工具；Bot 不直接发送 HTTP Bearer。
- MCP bridge 不拥有检索逻辑，使用自己的上游客户端凭据调用公共 `/v1/search`；公共响应不包含
  `access_context`、`citation_index` 或 Agent `result_ref`。
- 公共服务验证 MCP client token；agent-runtime 与检索服务之间使用独立的 retrieval internal token。
- 服务不建立用户级校园权限。

## 未采用方案

- 不让 Agent 通过 MCP 调用自身的 Campus Search；这会把内部调用绑定到外部协议生命周期。
- 不把 Qdrant、embedding 或 reranker 暴露给 Bot；Bot 只看 Campus Search 结果。
- 不把个人记忆、通知采集或 Bot 写操作并入该服务。

## 后果

公共检索服务可以由多个 MCP 客户端共享，Agent 专用字段由 Runtime 消费并写入 Control 的受控投影。第一批实现曾暂时共享 execution-control Go module；该过渡边界已由[Campus Search 模块 owner 与一次切换](./2026-10-03-campus-search-module-owner.md)取代。
