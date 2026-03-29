---
doc_type: architecture
status: active
created: 2026-03-26
updated: 2026-03-29
---

# Retrieval Query Strategy

## 文档边界

本文冻结 `campus-agent` 当前 retrieval runtime truth，重点描述 query 在进入 `retrieval-core` 之后的处理链路。

本文不负责：

- handbook 的 embedding / tokenizer / chunk budgeting 细节
- raw / processed / registry / object storage 的分层架构
- supervisor / specialist 的长期边界论证

对应 source of truth：

- embedding / chunking：`../policies/student-handbook-chunking-and-validation-policy.md`
- query path / data plane 边界：`phase1-ingestion-and-storage-architecture.md`
- retrieval-specific intent framing 与个性化边界：`rag-specialist-architecture.md`
- accepted retrieval baseline：`../decisions/adr-0007-phase1-retrieval-baseline-update.md`
- identity / memory / personalization 分层：`../decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- 长期版本化 serving / 历史查询目标：`versioned-document-serving-and-history-query.md`

## 当前 baseline

当前 phase-1 `student_handbook` retrieval baseline 为：

`query normalization -> dense retrieval + sparse retrieval -> RRF fusion -> registry-backed evidence shaping`

固定规则：

- dense 与 sparse 两路候选都必须先执行 metadata pre-filter
- candidate 不得绕过 registry 直接变成最终 source
- 最终对外只暴露 `EvidenceBundle`
- `rag-specialist` 可以选择策略，但不能吸收 retrieval backend 细节
- query-serving 默认只消费 collection runtime profile 定义的 current-serving documents，不把历史版本命中后再用 `latest_url` 事后修补当作主路径
- query-serving 消费的是逻辑 document/version，不是 source replica；相同内容的 `pdf_ocr` / `official_web` 不允许以两份 evidence 的形式同时进入候选集

## Contract 分层

当前 retrieval 相关 contract 必须拆成两层理解：

- embedding request contract
  属于 embedding provider / model runtime；当前固定请求字段是 `model=Qwen3-Embedding-4B` 与 `dimensions=2560`
- Qdrant collection schema contract
  属于 chunk/index store；当前关心的是 named dense/sparse vectors、payload metadata 与 hybrid query shape，例如 `document_id`、`chunk_id`、`corpus`、`collection`、serving metadata，以及 authorization filter projection metadata。phase-1 当前 carrier 仍包括 `acl_level`、`acl_groups`、`campus_scope`

两层不允许混写：

- `dimensions` 是 embedding 请求参数，不是 Qdrant payload 字段
- `document_id`、`chunk_id`、`acl_level`、`acl_groups`、`campus_scope` 与后续演进到的 `visibility_*` / `entitlement_*` 字段都属于 retrieval / index schema，不是 embedding model 的“支持字段”

## 查询阶段

### 1. Query normalization

当前 baseline 只做最小规范化：

- trim
- 空查询 fail-closed
- 保留原始 query text 进入 downstream trace / evidence context
- dense query path 会在 embedding 前附加英文 retrieval instruction，当前固定格式为：
  `Instruct: <instruction>\nQuery: <user query>`
- 这层 instruction 只作用于 dense query embedding，不改 document embedding，也不改 sparse query text

当前默认不做：

- `HyDE`
- multi-query decomposition
- 默认 query rewrite / expansion

这些能力只允许作为后续 gated enhancement 进入。

### 2. Dense retrieval

- 使用 phase-1 当前 embedding baseline：`Qwen3-Embedding-4B @ 2560`
- 当前项目通过 `gitee` 官方 OpenAI-compatible 接口请求 embeddings
- 当前项目运行契约要求 ingestion 与 retrieval query path 都显式发送 `dimensions=2560`
- `gitee` + `Qwen3-Embedding-4B @ 2560` 已在本项目中验证通过，不再把 `2560` 视为待确认假设
- dense query embedding 当前固定附加英文 instruction：
  `Given a campus policy or handbook question, retrieve relevant passages that answer the query.`
- dense query 向量在 retrieval time 生成
- dense candidate retrieval 的目标是覆盖语义近邻和表达变体

### 3. Sparse retrieval

- sparse candidate retrieval 的目标是覆盖术语、条款号、文号、固定措辞和标题关键词等 exact-match / sparse-match 信号
- `Qwen3-Embedding-4B` 只负责 dense embeddings；sparse vector 必须由独立 sparse path 生成
- phase-1 当前推荐 sparse baseline 固定为 `Qdrant native BM25`
- `qdrant/bm25` 在当前 Qdrant Cloud Inference 模型列表中标记为 `Cost: Free`
- handbook 中文语料的 sparse tokenization 起始配置固定为：`tokenizer=multilingual`、`language=none`
- live / remote 路径里，`tokenizer=multilingual` 由 Qdrant native `qdrant/bm25` sparse path 提供；仓库本地不会为它下载或缓存额外 tokenizer 文件
- 本地 `:memory:` / mock / unit-test 路径里，仓库只提供一个最小兼容的 `_tokenize_multilingual()` fallback 来生成测试用 sparse vectors；它不是 live sparse 服务真相源
- accepted target shape 是 Qdrant native sparse index，而不是 retrieval-core 内部本地算分
- 当前仓库主实现已切换到 native hybrid：ingestion / rebuild 会对同一 `chunk_id` 双写 named `dense` 与 named `sparse` vectors，retrieval 通过 Qdrant native `prefetch + RrfQuery(...)` 查询
- 当前剩余 gate 不再是实现缺口，而是 live rebuild、真实 collection 验收和 query-serving 运行态证据补齐

### 4. Fusion

- 当前默认 fusion 为 `RRF`
- 当前 runtime 参数由各 collection 的 `runtime-profile.json` 持有；当前 handbook/curriculum baseline 为：
  - dense prefetch limit = `20`
  - sparse prefetch limit = `20`
  - `RrfQuery(k=60, weights=[1.0, 1.0])`
- dense query instruction 也由 runtime profile 持有，而不是全局 `.env`
- 当前 `regulations/student_handbook` runtime profile 取回 `top_k=8` 个 retrieval candidates；`rag-specialist` 最终只保留最多 `3` 条支撑证据进入回答
- dense / sparse 两路候选必须进入统一 candidate shape 后再融合
- 不允许让 specialist 或 supervisor 理解底层 fusion 细节
- accepted target query shape 为 `prefetch(dense) + prefetch(sparse) + RrfQuery(k=60, weights=[1.0, 1.0])`

### 5. Evidence shaping

fusion 后的候选必须继续通过 `DocumentRegistry` 回链，补齐：

- `canonical_url`
- `latest_url`
- `is_current`
- `source_channel`
- `collection`
- `anchor`
- `latest_url` 只在 registry 中存在 current 版本时回链到 current source；若当前版本不存在，不再用 latest fallback 伪装 current，而是回落到命中文档自身 `source_uri`

最终输出固定为 `EvidenceBundle`。

## Serving Policy

当前 query-serving 对“只消费最新文档”的定义固定为：

- latest/current truth 只由 `DocumentRegistry` 表达，不由 object key、文件时间戳或 Qdrant score 推断
- collection runtime profile 可以定义：
  - `current_only`
  - `serving_revision_tracks`
- `student_handbook` 当前 runtime policy 为：
  - `current_only=true`
  - `serving_revision_tracks=["current-effective","source-faithful"]`
- 这表示 query path 只消费被标记为 current 的 serving revision_track；`source-faithful` 只作为过渡 fallback / 审计线保留，不再是“历史也可默认命中”的开放路径
- 新 current 版本写入时，ingestion 必须把同一 `document_id + revision_track` 的旧 current 版本降级为 `is_current=false`，并将其状态推进为 `superseded`
- 当多来源在同一 `document_id + revision_track` 下对应到相同 `version_id` 时，registry 负责记录 primary source 与 alternate source；retrieval 仍只消费这一个逻辑版本

当前额外边界：

- 当前 query path 只支持“默认服务当前有效版本”，尚不支持用户显式指定历史版本、按时间点查询历史版本或执行版本对比查询
- 因此“历史版本被保留”不等于“历史版本已经成为当前在线查询能力”
- 后续如果要开放历史查询，必须先引入显式 version-selection / version-resolution 边界，再改变 retrieval filter；不得让模型仅凭 query 文本自行猜测该查哪一版

## Filter Layers

长期上，retrieval query path 至少区分三层过滤 / 收窄语义，而不是把它们全部混成一组 ACL 条件。

### Serving Filter

serving filter 负责表达“当前在线查询面允许消费哪些 institutional knowledge version”。

当前必须至少覆盖：

- `corpus`
- `collection`
- `revision_track in serving_revision_tracks`
- `status=active`
- `is_current=true`（当 `current_only=true`）

### Authorization Filter

authorization filter 负责表达“在当前 request context 下，哪些 evidence 对该 principal 可见”。

长期规则如下：

- retrieval 必须消费上游授权层投影后的 authorization filter，而不是在 retrieval-core 内重建 canonical authz truth
- authorization filter 必须在 candidate retrieval 阶段完成，而不是在答案生成之后事后裁剪
- filter 缺失、冲突或不可安全判定时必须 fail-closed
- retrieval payload 长期只应保留稳定、可重建、可索引的 visibility / entitlement projection；不承载 memory、raw token claims 或 personalized profile fields

当前 phase-1 的 transitional filter carrier 仍包括：

- `acl_level`
- `acl_groups`
- `campus_scope`

但这些字段只表示当前实现采用的 filter projection，不应继续被描述为长期 canonical authorization model。

长期目标形态中，institutional document retrieval payload 应收敛到：

- `visibility_level`
- `visibility_scope`
- `entitlement_groups`
- `policy_projection_version`

如果未来 conversation / profile memory / user-private corpus 进入 retrieval index，则应新增 owner- or tenant-scoped projection，例如：

- `owner_scope`
- `tenant_scope`

而不是继续复用 institutional document 的 `acl_groups` / `campus_scope`。

### Applicability / Ranking Hints

以下输入长期允许参与 retrieval planning、ranking 或 clarification，但不属于 authorization truth：

- verified identity claims 中仅承担适用性含义的字段
- profile memory summary
- session-confirmed slots
- recent goal、terminology preference 与其他 personalization hint

这意味着：

- `visibility` 与 `applicability` 必须分层
- 当前被写进 `campus_scope` 的混合语义，长期上应拆成 `visibility_scope` 与 `applicability_scope`
- `major`、`cohort`、`program`、`recent_goal` 与长期记忆默认属于 applicability / personalization，不进入 authorization payload

## Personalization Boundary

长期上，retrieval path 可以消费 typed personalization hint，但这些 hint 只能作为 retrieval planning 的输入，而不是 authorization truth。

允许的 hint 语义包括：

- verified identity claims
- profile memory summary
- session-confirmed slots

这些 hint 可以影响：

- query rewrite / terminology choice
- multi-query decomposition
- ranking / disambiguation bias
- clarification 触发条件

这些 hint 不能影响：

- authorization filter projection，包括当前过渡期 `acl_level` / `acl_groups` / `campus_scope` 与后续 `visibility_*` / `entitlement_*` payload
- `current_only` / `serving_revision_tracks`
- runtime-profile-driven serving surface
- 未开放 collection 的准入

如果 personalization hint 过弱、过旧或与 evidence 冲突，允许的正确行为是澄清或保持 no-answer，而不是静默把 query 收窄成某一份文档。

## Native Sparse Index 目标形态

当前 phase-1 对 native sparse index 的目标形态固定为：

- collection schema 使用 named vectors：
  `dense`
  `sparse`
- ingestion / rebuild 对同一 `chunk_id` 双写 dense 与 sparse vectors
- retrieval query 对同一 filter 集合同时发起 dense prefetch 与 sparse prefetch
- dense / sparse 融合默认使用 Qdrant native `RRF`
- 当前 phase-1 handbook runtime 已显式冻结 prefetch / fusion baseline：
  - dense prefetch limit = `20`
  - sparse prefetch limit = `20`
  - `RrfQuery(k=60, weights=[1.0, 1.0])`
- registry back-link、`EvidenceBundle` 与 authorization filter projection contract 保持最小执行语义不变；phase-1 当前 ACL carrier 继续受控兼容
- serving 所需的 payload metadata 至少包括 `revision_track`、`status`、`is_current`

当前不冻结 sparse model 的具体品牌或 provider，但冻结以下边界：

- sparse vector 是独立于 `Qwen3-Embedding-4B` 的能力
- sparse generation 必须进入 replay / rebuild 主链路，不能只存在于在线 query 临时分支
- sparse path 必须支持 `student_handbook` 中文语料的 exact-match / fixed-phrase 场景验证

当前已接受的 phase-1 选型结论：

- sparse baseline 先采用 `Qdrant native BM25`
- handbook 中文语料的 sparse tokenizer 不替换 Qwen tokenizer；它只属于 sparse index 内部 analyzer 路径
- `multilingual + language=none` 是当前起始配置，不排除后续在 eval 证据支持下调整
- miniCOIL、SPLADE、BM42 都不作为当前默认 baseline

## 当前不冻结的增强能力

以下能力允许演进，但不是当前 baseline：

- rerank
- `HyDE`
- query rewrite / expansion
- multi-query decomposition
- corpus-specific retrieval strategy branching

如果后续引入，必须：

- 在文档里显式写明 default / gated 状态
- 有 eval 证据支持
- 不改变 `EvidenceBundle` contract
