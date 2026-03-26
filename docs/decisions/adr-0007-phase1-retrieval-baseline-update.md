---
doc_type: decision
decision_id: ADR-0007
status: accepted
created: 2026-03-26
updated: 2026-03-26
---

# ADR-0007 第一阶段 Retrieval Baseline 更新

适用范围：`campus-agent` v2 第一阶段 retrieval / query-serving 基线

说明：

- 本文 supersede `ADR-0001` 中未显式冻结 retrieval strategy 的旧表述
- handbook embedding / chunking 的运行真相仍以 `docs/architecture/student-handbook-chunking-and-validation-policy.md` 为准
- retrieval runtime truth 以 `docs/architecture/retrieval-query-strategy.md` 为准

## 决策

第一阶段 `student_handbook` retrieval accepted baseline 更新为：

- embedding baseline 固定为 `Qwen3-Embedding-4B @ 2560`
- embedding provider baseline 固定为 `gitee` OpenAI-compatible embeddings 接口，并显式请求 `dimensions=2560`
- retrieval baseline 采用 `dense + sparse hybrid retrieval`
- dense / sparse 两路候选默认通过 `RRF` 融合
- accepted target shape 固定为 Qdrant native sparse index + native hybrid query，而不是 retrieval-core 内部 sparse 本地算分长期保留
- phase-1 sparse baseline 固定为 `Qdrant native BM25`，handbook 中文语料的起始 analyzer 配置为 `tokenizer=multilingual`、`language=none`
- metadata pre-filter（`corpus`、`collection`、ACL、`campus_scope`）仍为必做前置条件
- retrieval 输出仍然必须通过 `DocumentRegistry` 回链形成 `EvidenceBundle`

## 不作为当前默认主路径的能力

以下能力允许后续引入，但不属于当前默认 retrieval baseline：

- rerank
- `HyDE`
- multi-query decomposition
- 默认开启的 query rewrite / query expansion

只有当 eval 或线上证据证明 `hybrid + RRF` 仍不足时，才应把这些能力作为 gated enhancement 引入。

## 原因

- handbook / 规章类语料对术语、条款号、文号和固定措辞非常敏感，dense-only 不足以作为 accepted retrieval baseline
- sparse exact-match 与 semantic recall 都需要保留，`hybrid + RRF` 更符合当前主流实践，也更适合 handbook 问法
- `Qwen3-Embedding-4B` 同时支持多维输出，但当前项目 accepted runtime truth 已固定为 native `2560`；不能再容忍 provider 默认 `1024` 维漂移
- `Qwen3-Embedding-4B` 官方只承担 dense embedding / rerank 路线，不提供当前 phase-1 所需的 sparse encoder 基线，因此不应把 Qwen dense 路线扩写为 sparse 实现
- 先冻结 hybrid baseline，再评估 rerank / query transformation，能降低策略耦合和调试复杂度

## 边界

- `packages/rag-specialist`
  负责 retrieval strategy selection、clarification / no-answer / error 映射、answer / confidence 组装
- `packages/retrieval-core`
  负责 query preprocessing、candidate retrieval、fusion、evidence normalization
- `packages/contracts`
  继续只冻结 `EvidenceBundle` / `EvidenceSource` 等共享 contract，不泄漏 retrieval backend 类型

## 对旧表述的修正

以下表述不再代表当前 accepted baseline：

- 把第一版 retrieval 理解为 dense-only vector retrieval
- 把 phase-1 retrieval strategy 留空，只冻结 `LlamaIndex + Qdrant`
- 把 retrieval-core 内部 sparse 本地算分误认为长期 accepted shape

当前 retrieval baseline 应以本文和 `docs/architecture/retrieval-query-strategy.md` 为准。
