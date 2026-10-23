---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 模型配置接口

## 边界

Ops Web 只管理 Model Config 的 `primary_agent`、`campus_docs_embedding`、`campus_docs_reranker`、
`notice_classification_decision` 和 `notice_classification_llm` 当前配置，以及 `notice_classification` 别名的
后端选择。页面 API 对前三者使用 UI kind `llm`、`embedding` 和 `reranker`，通知分类使用后端名 `decision` 和
`llm`，均由 Ops Web 服务端映射到稳定 name。这些 kind 只组织表单和页面合同，不进入
Model Config wire 合同，也不表示模型类型或 agent-control ownership。
Hindsight 的模型和存储配置由环境仓 Helm values/Secret 管理，不进入本接口。

接口不提供 connection、profile、role、revision、bundle、发布记录或回滚。浏览器不能指定数据库、
namespace、Secret、Deployment 或内部服务地址。

## 接口

- `GET /api/ops/model-configs`
- `POST /api/ops/model-configs/llm/models`
- `POST /api/ops/model-configs/reranker/models`
- `PUT /api/ops/model-configs/:kind`
- `POST /api/ops/model-configs/:kind/validate`
- `PUT /api/ops/model-configs/notice_classification`
- `PUT /api/ops/model-configs/notice_classification/credentials/:backend`
- `POST /api/ops/model-configs/notice_classification/credentials/:backend/validate`
- `POST /api/ops/model-configs/notice_classification/credentials/:backend/models`

`kind` 只允许 `llm`、`embedding` 或 `reranker`；`backend` 只允许 `decision` 或 `llm`。读取结果包含当前值、最后验证结果和更新时间，
以及固定 Embedding 合同中的 provider、model、transport 和 dimensions；不返回 API key、密文、nonce、
当前索引、`embeddingSpaceId`、collection 或制品 ID。保存操作由 Model Config 验证后原子覆盖该 name 的当前
值，不使用 ETag/CAS。

LLM 和通知分类 LLM 凭据 PUT 请求体只接受 `apiKey`、`baseUrl`、`model`、`provider` 和 `transport`；
通知分类决策模型凭据只接受 `apiKey`、`baseUrl`、`model` 和 `provider`（`nace` 或 `typesafe`），接口固定为
`typesafe.systemone`。Reranker
PUT 请求体只接受 `apiKey`、`baseUrl`、`model` 和 `provider`，接口类型固定为 Cohere Rerank。Embedding
PUT 只接受 `apiKey` 和 `baseUrl`。`kind` 来自路径；Embedding 请求中的 `model`、`provider`、
`transport`、`embeddingSpaceId`、`dimensions`、已退役的 `timeoutMs` 及其他未知字段均返回 `400`，
不提供兼容解码。

LLM 和通知分类 LLM 凭据可分别设置 provider、Base URL、API key、model 和 transport；两个文本模型设置互不
复用当前值。transport 只允许 `responses` 或 `chat_completions`。Reranker 可设置 Cohere provider、
Base URL、API key 和 model，transport 固定为 `rerank`。Embedding 只设置 Base URL 和 API key；
provider 固定为 `openai-compatible`，model 固定为 `Qwen3-Embedding-4B`，transport 固定为
`embeddings`，dimensions 固定为 `2560`。保存和重新验证不依赖 Campus Docs 当前索引，因此首次索引
发布前也可以完成连接配置。

模型发现支持 LLM、Reranker 和通知分类两家凭据。浏览器提交目标 `kind`、provider、Base URL 和可选 API key；对应
`kind` 首次配置必须提供 API key，已有配置时空值表示复用该设置已保存的密钥。Model Config 请求
该供应商 Base URL 下的 `/models`，返回本次供应商响应中的完整模型目录，并进行去重、排序和模型 ID 校验；不
设置额外的模型数量上限。供应商响应正文和 API key 不返回浏览器，也不保存本次候选连接。

保存前 Model Config 对候选设置执行真实供应商调用，并按 `api_protocol` 校验响应结构；只有 HTTP
成功且响应符合对应协议时才通过。候选设置验证失败只返回本次诊断，不覆盖当前值，也不更新当前配置的验证记录。未提交 API key
表示保留现有值，首次配置时必须提供；显式空 API key 无效。已有配置可通过 `validate` 接口重新验证当前值；
该操作只更新验证状态、验证时间和验证操作者，不更新目标、密钥或配置 `updatedAt`。重新验证失败时页面刷新并
显示失败状态，同时保留 Model Config 返回的验证错误信息。Embedding 验证调用 `/embeddings` 时固定提交 model 和 `dimensions=2560`，且只在
返回一个由 2560 个有限数值组成的向量时通过。`observedDimensions` 是验证证据，不是可编辑配置。
供应商验证时限属于
Model Config 代码合同，不是可由浏览器修改的连接设置。

Ops Web 服务端通过 `MODEL_CONFIG_URL` 调用 Model Config 单一 listener 的
`/internal/admin/model-configs`。内部调用不使用独立 token；浏览器仍只能调用通过人员准入和同源校验的
Ops Web BFF，不能直接读取 Model Config 或获得 API Key。管理 API 使用 snake_case Model Config 合同，
Ops Web 服务端负责与现有 camelCase 页面合同互相映射。

## 通知分类

读取结果的 `noticeClassification` 包含 `backend`（`decision`、`llm`，未选择为 `null`）和
`credentials.{decision,llm}`（未保存为 `null`；字段同其他设置，决策模型的 transport 为 `systemone`）。

- `PUT /api/ops/model-configs/notice_classification` 接受 `{backend}` 切换当前后端，不调用供应商、不改凭据；
  只能选择验证通过的凭据，否则返回 422（`upstreamCode` 为 `selection_not_ready`）。没有清除选择的接口。
- `PUT .../credentials/:backend` 由 Model Config 对候选凭据真实分类一次（15 类加 status），通过才保存；
  未提交 `apiKey` 沿用该后端已存的 Key。
- `POST .../credentials/:backend/validate` 与 `.../models` 分别重新验证当前凭据和发现模型。

所有写操作返回更新后的完整状态。新选择只影响之后开始的分类任务。

## 通用规则

所有写请求必须来自配置的同源页面并通过人员准入。错误响应包含稳定 Ops Web 错误码；验证失败的业务消息
保留 Model Config 提供的诊断文本，但不返回 API key、密文或其他凭据。读取失败必须保留失败状态，不能伪装成未配置。

合法空配置集合或不存在的槽位表示未配置；缺失或非法的配置集合、未知协议和不完整验证记录属于读取失败，
通过既有 `503 OPS_PROVIDER_CONFIG_UNAVAILABLE` 返回。只有明确为空的验证记录及其时间、操作者才表示未验证。

LLM 和 Reranker 页面将 Base URL、API key 和模型作为核心字段，provider 和 transport 放在高级设置；通知分类
卡片上方切换后端，下方分别维护决策模型和 LLM 凭据，两者直接展示 provider，LLM 另展示 transport。
Reranker 的 transport 固定为 Cohere Rerank；Embedding 页面只编辑 Base URL 和 API key，并只读展示固定 provider、model、transport 和 dimensions。
页面不展示或编辑 space ID、collection 或制品 ID，也不展示 API key 末四位；页面只显示凭据是否已配置。
API key 留空表示保留现值。存在真正未保存修改时，切换页面必须由
操作者确认。
