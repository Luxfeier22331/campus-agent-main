---
doc_type: runbook
owner_boundary: retrieval-serving
status: active
---
# RAG 发布验收

## 边界

只有 retrieval 或 Knowledge Agent 变更准备发布时才使用本文。普通实现运行受影响的本地测试，
默认不执行外部 Langfuse/Ragas scoring。

## 必需证据

1. target 存在于 `query-serving-targets.v1.json`，且引用的 serving config 校验通过；
1. contract、execution-control 与 agent-runtime 测试通过；
1. 对应 Langfuse dataset 包含已审查的变更行为 case；
1. 真实产品 eval run 产生 answer、retrieved context、tool trajectory 与 trace identity；
1. 与上一个已接受 release/experiment 对比 Ragas RAG 和 agent/tool score；
1. hard negative、no-answer 与 cross-target case 没有新增 unsupported claim 或 evidence
   integrity failure。

## 步骤

1. 执行 `pnpm ci:contracts`、`pnpm go:check` 与 `pnpm ci:eval`；
1. 按 `ragas.md` build 并 dry-run dataset sync；
1. 对变更 dataset 经真实产品路径运行 `agent-eval --validate-only`，确认 project 与 sample 后再
   publish；该命令关联 product trace 与 dataset run，并计算适用 score；
1. 只有已经 materialize 的 dataset run 需要在不重跑产品请求的情况下重新评分时，才使用
   `ragas-score-dataset`；
1. 在 Langfuse 比较 score distribution 并审查失败 case，不生成仓库自有 gate report。

Ragas score 是 review evidence，不是自动发布结论。contract 或 evidence-integrity failure 仍由
所属 runtime test 作为 hard failure。
