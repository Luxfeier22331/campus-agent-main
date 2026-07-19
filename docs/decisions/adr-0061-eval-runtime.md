---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0061
status: accepted
---

# ADR-0061 评测运行时

## 背景

仓库需要把真实产品执行、版本化 case、Ragas 官方指标和 Langfuse 的数据集及评分能力连接起来。
平台编排与仓库主要运行时使用 TypeScript，而 Ragas 的官方实现使用 Python。

## 决策

TypeScript 与 Langfuse 是默认评测路径，Ragas 通过隔离的 Python 适配器提供官方指标。

`packages/eval-langfuse` 负责：

- 版本化数据集 manifest 和同步；
- Langfuse trace、dataset item 和运行选择；
- 确定性执行结果与工具轨迹断言；
- 构造最小 Ragas 输入并校验输出；
- 同步 score config 并把结果发布到 Langfuse。

Langfuse 负责数据集、运行、评分、人工评审和 trace 检查。它不拥有产品合同、来源事实或发布
结论。

`packages/ragas-runner` 是唯一 Python 评测包。它只接收 TypeScript 生成的有界输入并调用 Ragas
官方指标，返回结构化 score。它不选择 trace、不拥有 case、不访问 Langfuse，也不定义评审或
发布策略。

Ragas 输入可以来自版本化离线 artifact，也可以来自 `packages/eval-langfuse` 对 Langfuse dataset
item 或 trace 的有界投影。两类输入使用同一 case 身份和指标适用规则，不把供应商原始响应、
credential、无限制来源正文或后端 dump 传给 Python 进程。

## 边界

- 新评测平台集成进入 `packages/eval-langfuse`，不建立第二套数据集、实验、评分或标注系统；
- 新 Python 代码只允许包装 TypeScript 无法合理提供的成熟上游评测能力，并保持进程隔离；
- Langfuse automation 使用官方支持的 API；已有真实产品 trace 时不创建第二条合成执行 trace；
- 运行时确定性 fixture 留在所属模块，中央评测只引用适合跨运行评审的 case；
- Langfuse score 是质量证据，不自动成为发布门禁。

## 后果

- 公开 case 位于 `packages/eval-langfuse/assets`，私有 case 从获准私有来源提供；
- TypeScript CLI 可以同步数据集和 score config、运行 Agent 评测、调用 Ragas 并发布结果；
- Ragas 可以升级或替换指标实现，而不改变 Langfuse 平台和 case 所有权；
- 增加 scorer 不构成建设通用自研评测框架的理由。

## 相关文档

- `adr-0003-golden-datasets.md`
- `adr-0004-evaluation-metrics.md`
- `adr-0059-langfuse.md`
- `../reference/eval.md`
- `../runbooks/ragas.md`
- <https://langfuse.com/guides/cookbook/evaluation_of_rag_with_ragas>
- <https://docs.ragas.io/en/stable/howtos/integrations/_langfuse/>
