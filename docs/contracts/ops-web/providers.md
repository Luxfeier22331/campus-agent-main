---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 模型配置接口

## 边界

Ops Web 只管理 execution-control 当前使用的 `llm` 和 `embedding` 设置。Hindsight 的模型和
存储配置由环境仓 Helm values/Secret 管理，不进入本接口。

接口不提供 connection、profile、role、revision、bundle、发布记录或回滚。浏览器不能指定数据库、
namespace、Secret、Deployment 或内部服务地址。

## 接口

- `GET /api/ops/model-settings/execution`
- `POST /api/ops/model-settings/execution/llm/models`
- `PUT /api/ops/model-settings/execution/:kind`
- `POST /api/ops/model-settings/execution/:kind/validate`

`kind` 只允许 `llm` 或 `embedding`。读取结果包含当前值、最后验证结果、更新时间和不透明 `etag`；
不返回 API key、密文或 nonce，也不返回当前索引、dimensions 或 `embeddingSpaceId`。写入使用
`If-Match` 携带最近读取的 `etag`；配置已变化时返回 `409`，页面刷新后由操作者
重新保存，不静默覆盖。

LLM PUT 请求体只接受 `apiKey`、`baseUrl`、`model`、`provider` 和 `transport`。Embedding PUT 只接受
`apiKey`、`baseUrl`、`model` 和 `provider`，服务端固定 `transport=embeddings`。`kind` 来自路径；
`embeddingSpaceId`、`dimensions`、Embedding 请求中的 `transport`、已退役的 `timeoutMs` 及其他未知
字段均返回 `400`，不提供兼容解码。

LLM 可设置 provider、Base URL、API key、model 和 transport。transport 只允许 `responses`
或 `chat_completions`。Embedding 可设置 provider、Base URL、API key 和 provider-specific model
alias；它是 provider 连接，不携带索引向量空间。保存和重新验证都不依赖 Campus Docs 当前索引，
因此首次索引发布前也可以完成配置。

模型发现只支持 LLM。浏览器提交 provider、Base URL 和可选 API key；首次配置必须提供 API key，
已有 LLM 配置时空值表示复用服务端已保存的密钥。execution-control 请求该供应商 Base URL 下的
`/models`，只返回去重、排序后的模型 ID 和采样时间，最多 500 条。供应商响应正文和 API key 不
返回浏览器，也不保存本次候选连接。

保存前 execution-control 对候选设置执行真实供应商调用；验证失败不会覆盖当前值。API key 为空表示
保留现有值，首次配置时必须提供。单独的 validate 接口只重新验证当前值并更新最后验证结果。已保存
Embedding 验证调用 `/embeddings` 时不提交 dimensions，并把响应向量长度记录为
`observedDimensions`；该观测值不是可编辑配置，也不参与当前索引准入。供应商验证时限属于
execution-control 代码合同，不是可由浏览器修改的连接设置。

## 通用规则

所有写请求必须来自配置的同源页面并通过人员准入。错误响应只包含稳定 Ops Web 错误码和脱敏信息；
不得透传供应商正文或凭据。读取失败必须保留失败状态，不能伪装成未配置。

页面将 Base URL、API key 和模型作为核心字段；Embedding provider 同样直接可编辑，LLM provider
和 transport 放在高级设置。页面不展示或编辑 index dimensions、space ID、collection 或制品 ID。
API key 留空表示保留现值，页面只展示是否配置和末四位。存在真正未保存修改时，切换页面必须由
操作者确认。
