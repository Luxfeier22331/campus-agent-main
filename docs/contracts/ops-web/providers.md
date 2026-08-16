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

`kind` 只允许 `llm` 或 `embedding`。读取结果包含当前值、最后验证结果、更新时间、不透明 `etag`，
以及从 Campus Docs 当前索引绑定派生的可空 `embeddingRequirement`；不返回 API key、密文或
nonce。写入使用 `If-Match` 携带最近读取的 `etag`；配置已变化时返回 `409`，页面刷新后由操作者
重新保存，不静默覆盖。

LLM 可设置 provider、Base URL、API key、model 和 transport。transport 只允许 `responses`
或 `chat_completions`。Embedding 的 `embeddingSpaceId`、provider、model 和 dimensions 必须等于
`embeddingRequirement`，transport 固定为 `embeddings`；页面显示这些只读字段，保存请求显式提交
space ID，execution-control 再与当前索引绑定核对。页面只允许维护兼容 Base URL 和 API key。没有
当前索引时
`embeddingRequirement=null`，页面禁用 Embedding 编辑、保存和重新验证，Embedding PUT 返回
`409 campus_docs_index_unavailable`；LLM 设置仍可读取和修改。

模型发现只支持 LLM。浏览器提交 provider、Base URL 和可选 API key；首次配置必须提供 API key，
已有 LLM 配置时空值表示复用服务端已保存的密钥。execution-control 请求该供应商 Base URL 下的
`/models`，只返回去重、排序后的模型 ID 和采样时间，最多 500 条。供应商响应正文和 API key 不
返回浏览器，也不保存本次候选连接。

保存前 execution-control 对候选设置执行真实供应商调用；验证失败不会覆盖当前值。API key 为空表示
保留现有值，首次配置时必须提供。单独的 validate 接口只重新验证当前值并更新最后验证结果。供应商
验证时限属于 execution-control 代码合同，不是可由浏览器修改的连接设置。

## 通用规则

所有写请求必须来自配置的同源页面并通过人员准入。错误响应只包含稳定 Ops Web 错误码和脱敏信息；
不得透传供应商正文或凭据。读取失败必须保留失败状态，不能伪装成未配置。

页面将 Base URL、API key 和 LLM 模型作为核心字段；LLM provider 和 transport 放在高级设置。
Embedding 固定身份以 `embeddingRequirement` 的只读事实展示。API key 留空表示保留现值，页面只
展示是否配置和末四位。存在未保存修改时，切换页面必须由操作者确认。
