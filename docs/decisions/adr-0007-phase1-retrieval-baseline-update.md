---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0007
status: accepted
created: 2026-03-26
updated: 2026-06-15
---
# ADR-0007 Retrieval Baseline 更新（phase1 为历史命名）

适用范围：`campus-agent` v2 当前 accepted retrieval / query-serving baseline；文件名中的
`phase1` 仅保留决策来源时的历史命名

说明：

- 本文 supersede 早期 `phase-1` 文档中未显式冻结 retrieval strategy 的旧表述
- handbook embedding / chunking 的运行真相仍以
  `docs/policies/student-handbook-chunking-and-validation-policy.md` 为准
- retrieval runtime truth 以
  `docs/architecture/system/retrieval-serving.md` 为准
- 本文早期对 Python knowledge / retrieval package owner 的表述已由
  `docs/architecture/system/python-boundaries.md` 局部 supersede；当前 online
  retrieval runtime 收口为 Go-owned execution-control / repo-owned DTO + Qdrant native
  adapter seam
- serving alias / physical collection / index release 运行真相以
  `docs/reference/runtime-serving-and-index-terms.md` 和 operator runbook 为准
- 当前 phase 进度、执行顺序和 gate 状态以 `.planning/*` 为准，不由本文维护

## 决策

当前 `student_rules` retrieval accepted baseline 更新为：

- embedding baseline 固定为 `Qwen3-Embedding-4B @ 2560`
- embedding provider enum 固定为 `openai-compatible`，endpoint baseline 当前使用 Gitee
  OpenAI-compatible embeddings 接口，并显式请求 `dimensions=2560`
- retrieval baseline 采用 `dense + sparse hybrid retrieval`
- dense / sparse 两路候选默认通过 `RRF` 融合，当前 runtime 参数固定为：
  - dense prefetch limit = `20`
  - sparse prefetch limit = `20`
  - `RrfQuery(k=60, weights=[1.0, 1.0])`
- dense query embedding 默认附加英文 instruction： `Given a campus policy or handbook
  question, retrieve relevant passages that answer the query.`
- accepted target shape 固定为 Qdrant native sparse index + native hybrid query，而不是
  retrieval-core 内部 sparse 本地算分长期保留
- 当前 sparse baseline 固定为 `Qdrant native BM25`，handbook 中文语料的起始 analyzer 配置为
  `tokenizer=multilingual`、`language=none`
- metadata pre-filter（`corpus`、`collection`、serving metadata，以及 `visibility_*` /
  `entitlement_*` projection carrier）仍为必做前置条件
- retrieval 输出仍然必须通过 `DocumentRegistry` 回链形成 `EvidenceBundle`
- `student_rules` 当前 serving config 默认返回 `8` 个 retrieval candidates；最终回答最多引用
  `3` 条证据

## 不作为当前默认主路径的能力

以下能力允许后续引入，但不属于当前默认 retrieval baseline：

- rerank
- `HyDE`
- multi-query decomposition
- 默认开启的 query rewrite / query expansion

只有当 eval 或线上证据证明 `hybrid + RRF` 仍不足时，才应把这些能力作为 gated enhancement 引入。

## 原因

- handbook / 规章类语料对术语、条款号、文号和固定措辞非常敏感，dense-only 不足以作为 accepted retrieval
  baseline
- sparse exact-match 与 semantic recall 都需要保留，`hybrid + RRF` 更符合当前主流实践，也更适合
  handbook 问法
- `Qwen3-Embedding-4B` 同时支持多维输出，但当前项目 accepted runtime truth 已固定为 native
  `2560`；不能再容忍 provider 默认 `1024` 维漂移
- `Qwen3-Embedding-4B` 官方只承担 dense embedding / rerank 路线，不提供当前所需的 sparse encoder
  基线，因此不应把 Qwen dense 路线扩写为 sparse 实现
- 先冻结 hybrid baseline，再评估 rerank / query transformation，能降低策略耦合和调试复杂度

## 边界

- Go-owned `apps/execution-control` retrieval seam 负责 retrieval strategy selection、
  query framing、candidate retrieval、fusion、evidence normalization 与 answer-ready
  evidence projection
- RAG synthesis / clarification / no-answer / error 映射继续通过 execution-control 的
  Temporal-visible typed steps 与 repo-owned DTO 承接
- `packages/contracts` 继续只冻结 `EvidenceBundle` / `EvidenceSource` 等共享
  contract，不泄漏 retrieval backend 类型

## 对旧表述的修正

以下表述不再代表当前 accepted baseline：

- 把第一版 retrieval 理解为 dense-only vector retrieval
- 把 retrieval strategy 留空，只冻结 `LlamaIndex + Qdrant`
- 把 retrieval-core 内部 sparse 本地算分误认为长期 accepted shape

当前 retrieval baseline 应以本文和
`docs/architecture/system/retrieval-serving.md` 为准。
