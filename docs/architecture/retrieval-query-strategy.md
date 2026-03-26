---
doc_type: architecture
status: active
created: 2026-03-26
updated: 2026-03-26
---

# Retrieval Query Strategy

## 文档边界

本文冻结 `campus-agent` 当前 retrieval runtime truth，重点描述 query 在进入 `retrieval-core` 之后的处理链路。

本文不负责：

- handbook 的 embedding / tokenizer / chunk budgeting 细节
- raw / processed / registry / object storage 的分层架构
- supervisor / specialist 的长期边界论证

对应 source of truth：

- embedding / chunking：`student-handbook-chunking-and-validation-policy.md`
- query path / data plane 边界：`phase1-ingestion-and-storage-architecture.md`
- accepted retrieval baseline：`../decisions/adr-0007-phase1-retrieval-baseline-update.md`

## 当前 baseline

当前 phase-1 `student_handbook` retrieval baseline 为：

`query normalization -> dense retrieval + sparse retrieval -> RRF fusion -> registry-backed evidence shaping`

固定规则：

- dense 与 sparse 两路候选都必须先执行 metadata pre-filter
- candidate 不得绕过 registry 直接变成最终 source
- 最终对外只暴露 `EvidenceBundle`
- `rag-specialist` 可以选择策略，但不能吸收 retrieval backend 细节

## Contract 分层

当前 retrieval 相关 contract 必须拆成两层理解：

- embedding request contract
  属于 embedding provider / model runtime；当前固定请求字段是 `model=Qwen3-Embedding-4B` 与 `dimensions=2560`
- Qdrant collection schema contract
  属于 chunk/index store；当前关心的是 named dense/sparse vectors、payload metadata 与 hybrid query shape，例如 `document_id`、`chunk_id`、`corpus`、`collection`、ACL、`campus_scope`

两层不允许混写：

- `dimensions` 是 embedding 请求参数，不是 Qdrant payload 字段
- `document_id`、`chunk_id`、`acl_level`、`acl_groups`、`campus_scope` 是 retrieval / index schema 字段，不是 embedding model 的“支持字段”

## 查询阶段

### 1. Query normalization

当前 baseline 只做最小规范化：

- trim
- 空查询 fail-closed
- 保留原始 query text 进入 downstream trace / evidence context

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
- dense query 向量在 retrieval time 生成
- dense candidate retrieval 的目标是覆盖语义近邻和表达变体

### 3. Sparse retrieval

- sparse candidate retrieval 的目标是覆盖术语、条款号、文号、固定措辞和标题关键词等 exact-match / sparse-match 信号
- `Qwen3-Embedding-4B` 只负责 dense embeddings；sparse vector 必须由独立 sparse path 生成
- accepted target shape 是 Qdrant native sparse index，而不是 retrieval-core 内部本地算分
- 当前仓库实现仍处于 transition state：dense 已写入 Qdrant，sparse 仍通过 retrieval-core 内部过渡路径生成候选
- live rebuild 完成后，`student_handbook` collection 应升级为同一点同时保存 named `dense` 与 named `sparse` vectors

### 4. Fusion

- 当前默认 fusion 为 `RRF`
- dense / sparse 两路候选必须进入统一 candidate shape 后再融合
- 不允许让 specialist 或 supervisor 理解底层 fusion 细节
- accepted target query shape 为 `prefetch(dense) + prefetch(sparse) + FusionQuery(RRF)`

### 5. Evidence shaping

fusion 后的候选必须继续通过 `DocumentRegistry` 回链，补齐：

- `canonical_url`
- `latest_url`
- `is_current`
- `source_channel`
- `collection`
- `anchor`

最终输出固定为 `EvidenceBundle`。

## Filter 规则

当前 retrieval pre-filter 必须至少覆盖：

- `corpus`
- `collection`
- `acl_level` / `acl_groups`
- `campus_scope`

这些过滤必须在 retrieval candidate 阶段完成，而不是在答案生成之后事后裁剪。

## Native Sparse Index 目标形态

当前 phase-1 对 native sparse index 的目标形态固定为：

- collection schema 使用 named vectors：
  `dense`
  `sparse`
- ingestion / rebuild 对同一 `chunk_id` 双写 dense 与 sparse vectors
- retrieval query 对同一 filter 集合同时发起 dense prefetch 与 sparse prefetch
- dense / sparse 融合默认使用 Qdrant native `RRF`
- registry back-link、`EvidenceBundle`、ACL filter contract 保持不变

当前不冻结 sparse model 的具体品牌或 provider，但冻结以下边界：

- sparse vector 是独立于 `Qwen3-Embedding-4B` 的能力
- sparse generation 必须进入 replay / rebuild 主链路，不能只存在于在线 query 临时分支
- sparse path 必须支持 `student_handbook` 中文语料的 exact-match / fixed-phrase 场景验证

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
