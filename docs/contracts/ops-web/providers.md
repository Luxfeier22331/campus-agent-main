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
- `PUT /api/ops/model-settings/execution/:kind`
- `POST /api/ops/model-settings/execution/:kind/validate`

`kind` 只允许 `llm` 或 `embedding`。读取结果包含当前值、最后验证结果、更新时间和不透明 `etag`，
不返回 API key、密文或 nonce。写入使用 `If-Match` 携带最近读取的 `etag`；配置已变化时返回
`409`，页面刷新后由操作者重新保存，不静默覆盖。

LLM 可设置 provider、Base URL、API key、model 和 transport。transport 只允许 `responses`
或 `chat_completions`。Embedding 固定为 `Qwen3-Embedding-4B`、2560 维和 `embeddings`
transport，页面只允许维护兼容 endpoint 和 API key。

保存前 execution-control 对候选设置执行真实供应商调用；验证失败不会覆盖当前值。API key 为空表示
保留现有值，首次配置时必须提供。单独的 validate 接口只重新验证当前值并更新最后验证结果。供应商
验证时限属于 execution-control 代码合同，不是可由浏览器修改的连接设置。

## 通用规则

所有写请求必须来自配置的同源页面并通过人员准入。错误响应只包含稳定 Ops Web 错误码和脱敏信息；
不得透传供应商正文或凭据。读取失败必须保留失败状态，不能伪装成未配置。

页面将 Base URL、模型和 API key 作为核心字段；provider 和 transport 放在高级设置。固定模型、
维度和接口以只读事实展示。API key 留空表示保留现值，页面只展示是否配置和末四位。存在未保存
修改时，切换页面必须由操作者确认。
