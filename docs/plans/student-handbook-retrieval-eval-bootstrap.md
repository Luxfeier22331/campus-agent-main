---
doc_type: plan
status: active
created: 2026-03-26
updated: 2026-03-26
---

# Student Handbook Retrieval Eval Bootstrap

**Goal:** 为 `regulations/student_handbook` 建立第一版可执行 retrieval eval 基线，在不冻结 chunk-level truth 和 release 阈值的前提下，把 phase-1 hybrid retrieval 的 doc-level 指标、fixture 形状和 scorer 交付出来。

**Architecture:** 本文不替代 `ADR-0003` / `ADR-0004`。它只把当前讨论收口成可执行方案：区分 live 验收样本与 retrieval qrels，先落 `doc-level truth first`，先交 deterministic retrieval metrics，再把 chunk-level truth 和正式门禁阈值留到 live rebuild 与 chunking 稳定之后。

## Migration note

这份计划保留其 doc-level qrels / eval bootstrap 价值，但其中涉及 live rebuild 状态的叙述可能随执行推进而过期。当前如需判断 live collection 是否已重建、当前 benchmark 是否已跑通、当前 release gate 卡在哪一步，应以 `.planning/STATE.md` 和 `docs/runbooks/`、`docs/reference/`、`docs/policies/` 下的最新文档为准，而不是以本文的 blocker 叙述为准。

**Tech Stack:** `packages/evals` deterministic scorer、repo-tracked JSON fixtures、`uv` test runner

---

## 计划基线结论

- retrieval baseline 已冻结为 `dense + sparse hybrid + RRF`
- sparse baseline 已冻结为 `qdrant/bm25`
- `student_handbook_hybrid_queries.json` 应继续作为 live query 验收样本保留
- retrieval 数值指标不应复用现有 hybrid queries fixture；需要单独的 qrels fixture
- phase-1 先做 `doc_id` 级 retrieval truth，不把大多数 case 立即锁到 `chunk_id`

## 范围

本轮负责：

- retrieval qrels fixture 形状
- deterministic retrieval metrics 的第一版实现
- `student_handbook` 第一批 doc-level truth 样本
- split 与 truth 粒度的 phase-1 落地规则

本轮不负责：

- 大规模 chunk-level 标注
- release gate 百分比阈值
- `ragas` 或 LLM judge 的正式接线
- live rebuild 之后的最终 benchmark 报告

## Fixture 分层

`packages/evals/fixtures/` 需要明确拆成两类资产：

- live 验收样本
  例如 `student_handbook_hybrid_queries.json`
  负责 rebuild 后的抽样 query 检查、类别覆盖和运行态人工核对
- retrieval qrels
  新增专用 fixture，例如 `student_handbook_retrieval_qrels.json`
  负责 `Hit@K` / `Recall@K` / `Precision@K` / `MRR@K` 等离线 deterministic 打分

这两类资产不得混写成同一个文件，因为：

- live 验收需要 query/category/checklist 语义
- qrels 需要 expected sources / forbidden sources / relevance grade 语义
- 两者更新频率和稳定性要求不同

## Qrels Schema Direction

每条 qrels case 至少包含：

- `case_id`
- `split`
- `query`
- `scope`
- `expected_sources`
- `forbidden_sources`
- `notes`

`expected_sources` 中每条 source 至少包含：

- `doc_id`
- `version_id`
- `chunk_id`
- `grade`
- `rationale`

phase-1 relevance grade 约定：

- `2`
  主相关 source；理想上应进入前列
- `1`
  可接受相关 source；命中可算正确，但不一定要求排首位

`forbidden_sources` 至少支持：

- `doc_id`
- 可选 `version_id`
- 可选 `chunk_id`

## Truth 粒度规则

phase-1 默认规则：

- `smoke`
  默认只锁 `doc_id`
- `regression_locked`
  默认锁 `doc_id + version_id`
- selected high-risk cases
  才锁 `doc_id + version_id + chunk_id`

推荐优先锁到 chunk-level 的 case：

- `fixed_phrase_sparse_win`
- 条款号 / 标题号 exact-match
- 已知高风险、历史回归频繁的 query

暂不锁 chunk-level 的 case：

- 泛语义问法
- 多段正文均可支撑的 broad topic query
- chunking 仍明显易抖动的文档

## 指标实现顺序

phase-1 第一批 deterministic retrieval metrics 推荐固定为：

- `Hit@1`
- `Hit@3`
- `Recall@5`
- `Precision@5`
- `MRR@5`

当前不在第一批强制实现：

- `nDCG@K`
- context precision / recall 的 LLM-based 版本
- release threshold / warning threshold / merge gate threshold

原因：

- `Hit@1` / `Hit@3` 最贴近 smoke 与用户可见效果
- `Recall@5` / `Precision@5` 足够表达“有没有漏召回”和“是否混入噪声”
- `MRR@5` 足够表达 rank-aware 信号，且不要求多级 relevance 设计过重
- `nDCG@K` 更适合在 relevance grade 和样本量更稳定后再补

## 实施步骤

### Step 1: 固定 fixture 边界

- 保留 `student_handbook_hybrid_queries.json` 为 live 验收样本
- 新增 retrieval qrels fixture 文件
- 在 `packages/evals/README.md` 中写清两者职责

### Step 2: 扩展 qrels schema

- 为 qrels case 增加 `expected_sources` / `forbidden_sources` / `grade`
- 约束 phase-1 默认按 doc-level truth 起步
- 保留未来升级到 chunk-level 的字段位，不要求一次性全填

### Step 3: 在 `packages/evals` 中实现 retrieval scorer

- 新增 retrieval benchmark 输入模型
- 新增 deterministic metric 计算函数
- 输出至少包含：
  - per-case metric
  - aggregate metric
  - split-level summary

### Step 4: 标注第一批 qrels

建议第一批最小样本规模：

- `article_number_exact_match`: 3 条
- `policy_title_exact_match`: 3 条
- `fixed_phrase_sparse_win`: 3 条
- `semantic_dense_win`: 3 条
- `acl_filter`: 2 条
- `campus_scope_filter`: 2 条
- `no_hit`: 2 条

标注流程：

1. 在 live collection 就绪后，对每条 query 抓取 top-10 检索结果
2. 人工审核候选 source
3. 标注 `grade=2` / `grade=1` / forbidden
4. 固定到 `doc_id` / `version_id` / 必要时 `chunk_id`
5. 回填 qrels fixture

### Step 5: 建立 repo 级验证命令

至少补一条可重复执行的 eval 命令，并用 `uv run --all-packages ...` 暴露出来。

## 可先行交付的工作

不需要等待 chunking 全部稳定：

- 新建 qrels fixture
- 固定 qrels schema
- 实现 `Hit@K` / `Recall@K` / `Precision@K` / `MRR@K`
- 先补 `doc_id` 级 truth
- 为 `no_hit` / `acl_filter` / `campus_scope_filter` 建立 deterministic case

## 需等待 live 证据的事项

以下工作依赖 live rebuild 或 chunking 更稳定后再做：

- 大规模 `chunk_id` 级 truth 冻结
- 最终 `release_gate` 阈值
- 混合检索对 dense-only 的正式 benchmark 对比结论
- 依赖真实 live collection 的最终 benchmark 报告

当前 block 原因：

- live collection 状态与 benchmark 证据以 `.planning/STATE.md`、`docs/runbooks/`、`docs/reference/` 和 `docs/policies/` 为准
- phase-1 chunking 仍处于“可验证、但不宜大规模锁 chunk truth”的阶段
- 现有 hybrid fixture 仍偏向人工验收，不是可直接算 IR 指标的 qrels

## 完成标准

本计划完成时，至少应满足：

- `packages/evals/fixtures/` 中已有独立 retrieval qrels fixture
- `packages/evals` 已能计算 `Hit@1` / `Hit@3` / `Recall@5` / `Precision@5` / `MRR@5`
- 第一批 `student_handbook` qrels 已按 doc-level truth 落盘
- 文档已明确区分 live hybrid 验收样本与 retrieval qrels
- chunk-level truth 与最终阈值仍保持 deferred，不被过早冻结
