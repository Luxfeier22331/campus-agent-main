---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---
# 工具读取模型合同

## 文档边界

本文规定 execution-control 为 OpenAI Agents SDK 函数工具提供的内部查询服务合同。它不
决定产品开放状态，不拥有 app-api 浏览器 HTTP 合同或来源事实 schema。

相关文档：

- `docs/contracts/tool-execution.md`
- `docs/architecture/system/tool-routing.md`
- `docs/domains/transport.md`
- `docs/data/internal-portal.md`

## 接口

Go `apps/execution-control` 拥有以下内部工具读取接口：

- `POST /internal/query/campus-services/transport-schedule`
- `POST /internal/query/knowledge/search`

这些接口属于 `domain tool -> thin adapter -> internal query service` 的内部服务边界，
不面向浏览器，也不是 `app-api` 的产品或控制接口。

合同规则：

- 仅允许仓库内部已认证的运行时调用；
- 请求头使用 `x-execution-query-auth`，由 execution-control 验证内部查询权限；
- JSON 命名保持 `snake_case`；
- 响应体必须匹配对应工具结果合同的安全类型化摘要；
- 运行时只读已配置投影或标准化事实，不得在查询时回扫原始来源包、通知 HTML 或通用检索
  分块。

## 读取来源

确定性工具从 PostgreSQL 当前发布指针及类型化读取模型读取：

- `transport_schedule_lookup`
  - 支持当前快照元数据、路线澄清、首班、下一班、末班、班次列表、服务时段、完整时刻表和
    临时停运摘要。

`knowledge_search` 依次执行访问与版本校验、向量化、Qdrant 稠密/稀疏查询和原生 RRF，只供
Knowledge Agent 内部使用。

当前没有通知读取模型工具接口。采集面可以物化通知来源和数据，但这不会自动开放查询工具。

## 开放边界

接口存在不会自动开放其他校园服务或通知工具。当前模型可见范围以 execution-control 工具
注册表为准，并且必须有对应领域的真实数据。

查询内核可执行不等于工具可用于生产。正常、失败关闭、取消、超时和迟到完成结果都必须
进入安全执行轨迹与运行时投影，才能判断工具已具备生产开放条件。
