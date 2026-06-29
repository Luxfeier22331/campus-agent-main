---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-19
updated: 2026-06-28
---

# Langfuse Eval Platform PRD

## 1. 背景

Langfuse 在校园问答中承担 LLM observability / eval sink 角色。它可以展示 trace、
score、dataset、experiment 和 review 结果，但不能替代 repo-owned eval truth、
Temporal history、app-api projection、operator backend 或 contract truth。

本 PRD 定义 Langfuse eval 平台化的产品要求：让工程、Eval / QA 和 operator 能围绕
同一套 sanitized eval evidence 做 trace drill-down、score 对比、dataset run、review
和 release closeout 判断，同时保持 `packages/evals` 继续拥有 fixture、scorer、
threshold、artifact 和 verdict。

## 2. 目标

- Langfuse 可以按 request / run / workflow / eval identity 追踪在线回答质量。
- Langfuse 可以展示 repo-computed score，而不是重新定义 eval verdict。
- Langfuse 可以承载 dataset、experiment、annotation queue 和 review workflow。
- RAG 参数、answer quality、runtime capacity 和 release gate score 能统一发布。
- Operator 只消费 app-api sanitized projection 和 safe backlink，不直接查询 Langfuse。
- Langfuse-bound payload 必须遵守 forbidden-field policy。

## 3. 非目标

- 不用 Langfuse 替代 `packages/evals` 的 case schema、fixture、scorer 或 verdict。
- 不用 Langfuse 替代 Temporal workflow history。
- 不用 Langfuse 替代 app-api / operator projection。
- 不让线上回答路径依赖 Langfuse 可用性。
- 不把 Langfuse SDK、API 类型或 score schema 泄漏进 `packages/contracts`。
- 不把 raw prompt、raw answer、transcript、retrieved snippet、source body 或 provider
  raw response 发到 Langfuse。

## 4. 用户与场景

- 工程：从一次请求追踪 workflow、activity、RAG、finalization 和 provider-facing
  observation。
- Eval / QA：比较模型、prompt、retrieval 参数、release candidate 和 badcase 修复效果。
- Operator：查看低分 case、review queue、annotation 结果和 safe eval backlink。
- 产品 / 架构：查看质量趋势、回归、能力成熟度和 release risk。

## 5. 产品要求

### 5.1 Trace Closeout

- 能用真实 chat run 生成 Langfuse release evidence。
- 能校验 Langfuse trace 存在，并与 request / run / workflow / release identity 对齐。
- 能区分 repo-owned observation 与 SDK / infrastructure observation。
- repo-owned observation 必须经过 runtime contract 校验。
- 缺 trace、缺 observation、identity drift、contract drift 或 forbidden payload 必须
  fail closed。

### 5.2 Score Report

- 所有 Langfuse score publish 必须来自 repo-owned sanitized score report。
- Score report 必须声明 eval kind、run id、profile / surface / variant、environment、
  release、source git head、source artifact 和 publish denominator。
- `score_items` 只包含具备真实 Langfuse target identity 且准备发布的 score。
- `omitted_items` 记录不能发布的 source result 及原因，不允许静默丢弃。
- `source_result_denominator` 必须等于 `score_items + omitted_items`。
- `expected_publish_denominator` 必须等于 `score_items`。
- 要求完整 trace correlation 的 release profile 不允许存在 omitted item。

### 5.3 Score Naming Registry

- Score name 必须来自 repo-owned registry。
- 每个 score name 必须声明 owner、data type、value range / categories、适用 eval
  kind、release gate usage 和解释。
- Publisher 必须拒绝 registry 中不存在的 score name。
- 禁止临时拼接、case-specific 或 provider-specific score name。

### 5.4 RAG Parameter Eval

- RAG first-stage 参数 eval 必须产出 sanitized candidate result、aggregate metrics 和
  Langfuse score report。
- 覆盖面至少包括当前 query-enabled retrieval surface。
- 关键指标包括 doc hit、doc recall、forbidden hit、no-hit false positive、wrong version
  hit、p95 latency 和 pass verdict。
- 如果目标 evidence 不在 prefetch candidate 中，不能只靠增大 topK 解决；应回到 query
  framing、chunking、embedding、BM25 analyzer 或 collection profile。

### 5.5 Dataset And Experiment

- Repo fixture 是 dataset source of truth。
- Langfuse dataset item 必须带 source fixture path、case id、source git head 和 fixture
  hash。
- Dataset sync 必须支持 version pinning、dry-run、archive/tombstone plan 和 sync artifact。
- Experiment runner 必须生成 repo artifact，再把 score / dataset run item evidence 发布到
  Langfuse。
- CI / release gate 只信 repo artifact 的 deterministic verdict，不直接信 Langfuse UI
  状态。

### 5.6 Annotation And Review

- Low-score、failed、known-gap case 可以进入 Langfuse review queue。
- Reviewer 标注结果只能回流为 backlog / fixture candidate，不能直接覆盖 deterministic
  release verdict。
- Review export artifact 必须包含 queue id、score config id、case id、review summary
  和 repo candidate id。

### 5.7 Operator-safe Backlink

- Operator Console 不直接查询 Langfuse。
- app-api 只暴露 sanitized backlink summary。
- Backlink summary 可包含 trace id、eval run id、score name、score value、release、
  environment 和 Langfuse URL。
- Backlink 不得包含 raw prompt、raw answer、snippet、source body、provider response 或
  secret。
- 缺 backlink 不影响线上回答。

## 6. 数据边界

允许进入 Langfuse：

- request / trace / run / workflow / case identity
- surface、profile、eval kind、variant、release、environment、source git head
- counts、latency、pass/fail、categorical reason、threshold summary

禁止进入 Langfuse：

- raw prompt、raw answer、raw transcript
- retrieved snippet、source body、provider raw response
- JWT、cookie、authorization header
- API key、provider secret、database URL、object-store secret

## 7. 验收标准

- Trace closeout 能证明真实 Langfuse trace 与 repo request / run / workflow identity 对齐。
- Score report schema、validator、golden fixture 和 malformed fixture 覆盖 denominator、
  omitted item、data type、identity 和 forbidden payload。
- Score publisher 发布数量必须等于 expected publish denominator；失败或漏发必须 fail
  closed。
- Score registry 能阻止未知 score name publish。
- RAG parameter eval 能生成 candidate result artifact 和 Langfuse score report。
- Dataset sync dry-run 能报告 created / updated / archived / unchanged / failed。
- Experiment runner 能落盘 repo-owned artifact，并发布 item-level / aggregate score。
- Operator 只能看到 sanitized backlink，不直接查询 Langfuse。
- Langfuse 不可用不影响用户在线回答，但会阻断对应 release / eval closeout。

## 8. 相关文档

- [ADR-0059 Langfuse Observability And Eval Platform](../decisions/adr-0059-langfuse-observability-and-eval-platform.md)
- [Langfuse Architecture](../architecture/system/langfuse.md)
- [Langfuse Runtime Contract](../contracts/langfuse-runtime.md)
- [Eval Benchmark Artifact Contract](../contracts/eval-artifact.md)
- [Eval Release Gate Automation](../runbooks/eval-release-gate-automation.md)
