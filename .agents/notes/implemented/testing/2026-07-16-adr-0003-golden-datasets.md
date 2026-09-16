# Agent Note: ADR-0003 评测数据集

Status: implemented

## 背景

评测平台可以保存运行和评分，但平台中的自动生成内容不能直接改写调用方的评测输入。运行 trace 和
线上问题可以帮助发现问题，但不会自动成为评测输入。此前把 Campus Docs 检索基准拆成多组独立
synthetic RAG dataset，也使 Agent 行为预期、当前文档证据和索引构建检查出现了重复来源。

## 决策

调用方显式提供的 case 是该次评测的输入。需要长期复用时可以将 case 放在仓库文件或私有对象存储中；
Langfuse、Ragas 和其他评分器消费这些输入，但不能根据模型输出或平台状态静默改写来源。

仓库不维护 Langfuse dataset manifest 或镜像同步。需要正文的离线 Ragas 样本由调用方或产品路径
适配器显式生成，不从普通 trace 或平台状态反查。

每条 Agent case 应按适用场景表达输入、预期结果、预期工具、参考答案或上下文，以及禁止出现的
证据或声明。精确 shape 由 `packages/eval-langfuse` 和 [评测用例](../../../../docs/reference/eval-cases.md) 维护，本 ADR
不复制字段。Campus Docs 的分块正确性由 `jobs/campus-docs-index-publisher` 在构建阶段校验，不作为
Agent case 或平台数据项。

规则：

- 如果输入使用稳定 case ID，同一 ID 不应在同一输入来源中静默表示另一条事实；
- 从生成结果、trace、人工标注或线上问题得到的样本不会自动进入评测输入，仓库不为其建立独立候选
  状态或存储区；
- score 可以用于比较结果，但不能自动改写调用方选择的输入来源；
- 确定性运行时 fixture 留在所属运行时，不复制进中央数据集；
- 输入的公开或私有边界由具体任务和部署环境决定。
- 仓库只保留调用方选择的 Agent case；独立 synthetic RAG asset 已退役。

数据集拆分、样本数量和执行频率属于评测操作策略，不是本 ADR 的架构约束。

## 未采用方案

- **把平台生成内容或 trace 自动转成评测输入**：减少人工整理，但会让模型输出与平台状态改写预期事实。
- **维护 Langfuse dataset 镜像及独立 synthetic RAG asset**：便于平台集中管理，却与调用方输入、
  Agent case 和构建校验形成重复来源。

## 后果

- `packages/eval-langfuse/assets` 保存当前仓库选择长期复用的公开 Agent case；
- Langfuse 是 trace 和可选 score 展示平台，不是预期行为的唯一来源；
- 线上问题是否转成 case，以及如何处理其内容和标识，由具体任务决定；
- 更换评分器不应自动改写输入来源；

## 相关文档

- [评测用例](../../../../docs/reference/eval-cases.md)
- [ADR-0004 评测指标](./2026-03-22-adr-0004-evaluation-metrics.md)
- [ADR-0090 评测数据与平台边界](./2026-08-21-adr-0090-eval-boundaries.md)
