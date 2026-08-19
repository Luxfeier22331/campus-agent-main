---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 模型配置接口

## 边界

Ops Web 只管理 execution-control 当前使用的 `llm`、`embedding` 和 `notice_classifier` 设置。
Hindsight 的模型和存储配置由环境仓 Helm values/Secret 管理，不进入本接口。

接口不提供 connection、profile、role、revision、bundle、发布记录或回滚。浏览器不能指定数据库、
namespace、Secret、Deployment 或内部服务地址。

## 接口

- `GET /api/ops/model-settings/execution`
- `POST /api/ops/model-settings/execution/llm/models`
- `POST /api/ops/model-settings/execution/notice_classifier/models`
- `PUT /api/ops/model-settings/execution/:kind`

`kind` 只允许 `llm`、`embedding` 或 `notice_classifier`。读取结果包含当前值、最后验证结果和更新时间，
以及固定 Embedding 合同中的 provider、model、transport 和 dimensions；不返回 API key、密文、nonce、
当前索引、`embeddingSpaceId`、collection 或制品 ID。保存操作串行化并以请求中的设置覆盖该 kind 的当前
值，不使用 ETag/CAS。

LLM 和通知分类 PUT 请求体只接受 `apiKey`、`baseUrl`、`model`、`provider` 和 `transport`。Embedding
PUT 只接受 `apiKey` 和 `baseUrl`。`kind` 来自路径；Embedding 请求中的 `model`、`provider`、
`transport`、`embeddingSpaceId`、`dimensions`、已退役的 `timeoutMs` 及其他未知字段均返回 `400`，
不提供兼容解码。

LLM 和通知分类可分别设置 provider、Base URL、API key、model 和 transport；两个文本模型设置互不
复用当前值。transport 只允许 `responses` 或 `chat_completions`。Embedding 只设置 Base URL 和 API key；
provider 固定为 `openai-compatible`，model 固定为 `Qwen3-Embedding-4B`，transport 固定为
`embeddings`，dimensions 固定为 `2560`。保存和重新验证不依赖 Campus Docs 当前索引，因此首次索引
发布前也可以完成连接配置。

模型发现支持 LLM 和通知分类。浏览器提交目标 `kind`、provider、Base URL 和可选 API key；对应
`kind` 首次配置必须提供 API key，已有配置时空值表示复用该设置已保存的密钥。execution-control 请求
该供应商 Base URL 下的 `/models`，只返回去重、排序后的模型 ID 和采样时间，最多 500 条。供应商响应
正文和 API key 不返回浏览器，也不保存本次候选连接。

保存前 execution-control 对候选设置执行真实供应商调用；验证失败不会覆盖当前值。未提交 API key
表示保留现有值，首次配置时必须提供；显式空 API key 无效。没有独立的重新验证接口；需要重新验证时
再次保存同一设置。Embedding 验证调用 `/embeddings` 时固定提交 model 和 `dimensions=2560`，且只在
返回一个由 2560 个有限数值组成的向量时通过。`observedDimensions` 是验证证据，不是可编辑配置。
供应商验证时限属于
execution-control 代码合同，不是可由浏览器修改的连接设置。

## 通用规则

所有写请求必须来自配置的同源页面并通过人员准入。错误响应只包含稳定 Ops Web 错误码和脱敏信息；
不得透传供应商正文或凭据。读取失败必须保留失败状态，不能伪装成未配置。

LLM 和通知分类页面将 Base URL、API key 和模型作为核心字段，provider 和 transport 放在高级设置。
Embedding 页面只编辑 Base URL 和 API key，并只读展示固定 provider、model、transport 和 dimensions。
页面不展示或编辑 space ID、collection 或制品 ID，也不展示 API key 末四位；页面只显示凭据是否已配置。
API key 留空表示保留现值。存在真正未保存修改时，切换页面必须由
操作者确认。
