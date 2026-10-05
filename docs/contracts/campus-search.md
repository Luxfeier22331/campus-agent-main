---
doc_type: contract
owner_boundary: campus-search-service
status: active
---
# Campus Search 服务合同

## 公共接口

`POST /v1/search` 由 MCP 适配器使用 `Authorization: Bearer <mcp-client-token>` 调用。Bot 通过 stdio
消费 MCP；该 HTTP Bearer token 通过 MCP 进程环境配置，由 MCP 向上游发送。

机器可执行的 HTTP 定义见[Campus Search OpenAPI 合同](./schemas/campus-search.openapi.yaml)。

请求只包含：

```json
{
  "query": "学籍规定",
  "search_goal": "确认本科生转专业条件"
}
```

响应包含 `outcome` 和有界 `results`。结果保留来源种类、标题、正文、来源链接、通知或文档身份、
章节标题和通知发布时间；不包含 Agent 的 `access_context`、`citation_index` 或 `result_ref`。
`citation_href` 对文档使用 `section_ref`，保留版本路径和章节锚点；对通知使用通知来源路径。

`no_match` 是成功的有界结果，不表示校园事实不存在。

请求使用严格 JSON schema；未知字段、缺少 `query`、`query` 超过 400 个字符或 `search_goal` 超过
800 个字符返回 `400`。无效 MCP client token 返回 `401`，调用方并发槽位耗尽返回 `429`，索引或 provider
不可用返回 `503`，搜索超时返回 `504`。

## Agent 内部接口

`POST /internal/v1/search` 只接受 execution-control 的 `RETRIEVAL_INTERNAL_TOKEN` Bearer token。它允许 Agent 传递已返回
结果排除列表，并返回当前 collection 与 Agent 所需的内部结果身份。Agent adapter 负责 run 校验、
索引绑定和 citation 编号，服务不接收用户身份或 workflow 字段。内部响应可以携带 `collection`、
`result_ref`、`citation_index` 和 `diagnostics`；这些字段不进入公共 `/v1/search` 响应。

内部 `query` 和 `search_goal` 分别最多 1000 和 2000 个字符，以容纳 Agent 在调用服务前把“今年”“去年”“前年”归一化为具体年份；公共接口仍分别限制为 400 和 800 个字符。

内部检索失败响应保留 `error.code`、`error.message`，并携带 `diagnostics` 中的 `failedStage`、
`failureDetail` 和失败前已采集的耗时、候选及 provider 元数据。execution-control 恢复错误阶段与
超时语义；公共错误响应不返回这些诊断。请求解析或鉴权失败不携带检索诊断。

内部成功及检索失败响应的 `diagnostics.phaseTimes` 记录服务内已完成阶段的 UTC 时间：
`index_loaded`、`embedded`、`retrieved`、`reranked`、`selected`。未完成或跳过的阶段不记录，
无候选时不产生 `reranked`。execution-control 收到响应后，将原始时间随终态写入现有
`phase_times_json`，供 Ops 显示阶段和统计；阶段信息不实时推送，也不进入公共响应。

内部结果与候选诊断使用调用内编号；execution-control 按 `result_ref` 将已返回候选映射到当前 run
的实际引用编号，同时更新诊断的 `citationStart`，未返回候选不分配引用编号。
