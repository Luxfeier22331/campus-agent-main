---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 模型配置接口

## 边界

Ops Web 只管理两个固定服务域：

- 在线问答：execution-control 当前使用的 `llm` 和 `embedding` 设置；
- 个人记忆：Hindsight Pod 启动时读取的 LLM 和 embedding 设置，以及只读 RRF 状态。

接口不提供 connection、profile、role、revision、bundle、发布记录或回滚。浏览器不能指定数据库、
namespace、Secret、Deployment 或内部服务地址。

## 在线问答

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
验证使用服务端固定时限；在线推理和知识检索的时限分别由 Agent deadline 与 RAG 运行策略控制，不属于
模型连接设置。

## 个人记忆

- `GET /api/ops/model-settings/hindsight`
- `PUT /api/ops/model-settings/hindsight`
- `POST /api/ops/model-settings/hindsight/apply`

Hindsight 0.8.x 在进程启动时读取模型环境变量。PUT 只更新固定 Secret
`hindsight-model-config`，不会自动修改运行实例。apply 只在固定 Deployment `hindsight-api` 的 Pod
template 写入配置摘要和应用时间；有运行副本时由 Kubernetes 触发 rollout，零副本时只为下次启动
准备配置，不改变副本数。

读取结果包含不透明 `etag`；PUT 必须通过 `If-Match` 携带该值。Secret 已被其他操作更新时返回
`409`，页面保留当前草稿并要求操作者显式加载最新配置。该 ETag 只用于防止并发覆盖，不是产品
版本。写入只修改 Ops Web 拥有的模型键和更新时间注解，不替换 Secret 中的其他数据。

读取结果将配置、应用和运行状态分开，避免把零副本误报为可用：

- `configState` 为 `unconfigured | drifted | configured`，表示 Secret 是否完整并符合固定合同；
- `applyState` 为 `blocked | pending | applying | applied | failed`，表示目标摘要能否应用、是否已写入
  Pod template，以及运行实例的 rollout 是否完成；
- `runtimeState` 为 `running | scaled_down`，只表示 Deployment 是否要求运行副本。

如果 Hindsight Secret 的固定 provider、embedding model/provider 或 reranker provider 与服务合同不一致，
`configState` 为 `drifted` 且 `applyState` 为 `blocked`；保存配置会重新写入这些固定键。

运行副本的 Deployment 只有在目标摘要一致、最新 generation 已观测且期望副本均已更新和可用时，
`applyState` 才为 `applied`。零副本的目标摘要一致时为 `applied + scaled_down`，历史 rollout failure
不会显示为本次失败。`failed` 同时返回稳定的失败原因码和截断、脱敏后的 Kubernetes condition 摘要。
这些状态不表示 LLM 或 Embedding 供应商调用已经验证。

LLM 使用 OpenAI-compatible Base URL、API key 和 model。Embedding 固定为
`Qwen3-Embedding-4B` 和 2560 维，只维护兼容 endpoint 和 API key；rerank 固定只读为 RRF。
API key 为空表示保留已有值。LLM Base URL 改变时会移除旧的 provider-specific default headers，
但接口不提供通用 Header 编辑器。

Ops Web service account 只需要对上述 Secret 执行 `get,patch`，对上述 Deployment 执行
`get,patch`。该接口不经过 app-api、execution-control 数据库或 Temporal，也不创建自己的状态表、
历史记录、outbox 或重试任务。apply 使用 Deployment `resourceVersion` 作为 JSON Patch 前置条件，只
修改 Ops Web 拥有的两个 Pod template 注解；并发变化返回 `409`，不覆盖其他控制器写入的注解。

## 通用规则

所有写请求必须来自配置的同源页面并通过人员准入。错误响应只包含稳定 Ops Web 错误码和脱敏信息；
不得透传供应商正文、Kubernetes 响应正文或凭据。读取失败必须保留失败状态，不能伪装成未配置。

页面将 Base URL、模型和 API key 作为核心字段；provider 和 transport 放在高级设置。
固定模型、维度和接口以只读事实展示，不使用 disabled 控件伪装成可编辑字段。API key 留空表示
保留现值，页面只展示是否配置和末四位。存在未保存修改时，切换页面必须由操作者确认。

Hindsight 启动配置事实依据 v0.8.4 官方源码中的
[Configuration](https://github.com/vectorize-io/hindsight/blob/v0.8.4/hindsight-docs/versioned_docs/version-0.8/developer/configuration.md)；
bank 行为配置由
[Memory Banks API](https://github.com/vectorize-io/hindsight/blob/v0.8.4/hindsight-docs/versioned_docs/version-0.8/developer/api/memory-banks.mdx)
管理，不与本接口混用。
