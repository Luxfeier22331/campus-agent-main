# Agent Note: 评测数据与平台边界

Status: implemented

评测框架、旧分数与 Langfuse score 发布部分已由 [Inspect AI 接入](./2026-10-13-inspect-agent-evaluation.md)取代；
以下保留原取舍，输入来源、线上 trace 与生产模型配置的独立边界继续有效。当前入口见
[Inspect 评测](../../../../docs/runbooks/inspect.md)。

## 背景

仓库曾同时维护 synthetic RAG dataset、Langfuse dataset 反查、trace 选择命令、score registry、
本地 artifact 路径和报告机制。Ragas sample 又携带 trace、observation、dataset run 和 context ID，
使评分器依赖 Langfuse 的平台身份。一次性评测输入与平台镜像共用数据集语义时，难以判断谁拥有
评测预期、正文和结果。把 Campus Docs 检索基准拆成多组独立 synthetic RAG dataset，也使 Agent
行为预期、当前文档证据和索引构建检查出现了重复来源。

当前运行 trace 已按数据最小化原则排除 prompt、答案、对话和 retrieval 正文，因此不能把 Langfuse
当作 Ragas 正文来源，也不应为了评测恢复运行正文采集。

## 决策

### 评测输入

- 评测命令只消费调用方显式提供的输入；需要稳定复用的 case 可以放在仓库文件或私有对象存储中，
  一次性输入也可以只在本地提供；
- Langfuse 平台状态不作为评测输入来源，仓库不维护 dataset manifest、镜像同步或 reconciliation；
- 生产反馈、trace、score 和人工标注不会自动成为评测输入；是否使用由具体评测任务决定；
- 每条 Agent case 按适用场景表达输入、预期结果、预期工具、参考答案或上下文，以及禁止出现的
  证据或声明；精确 shape 由 `packages/eval-langfuse` 和
  [评测用例](../../../../docs/reference/eval-cases.md) 维护，本笔记不复制字段；
- 输入使用稳定 case ID 时，同一 ID 不在同一输入来源中静默表示另一条事实；
- 确定性运行时 fixture 留在所属运行时，不复制进中央数据集；
- 输入的公开或私有边界由具体任务和部署环境决定；
- Campus Docs 的分块正确性由 `jobs/campus-docs-index-publisher` 在构建阶段校验，不作为 Agent case
  或平台数据项。

### Ragas

- 离线 Ragas 直接消费调用方显式提供的本地 JSON，不连接 Langfuse，不选择 trace 或 dataset；
- RAG 输入使用 `ragas_sample_batch.v3`，只包含 `case_id`、`user_input`、`response`、
  `retrieved_contexts`、`cited_contexts`、可选 `reference` 和标量 `metadata`；`retrieved_contexts`
  是全部实际检索候选，`cited_contexts` 是答案实际采用的候选；
- RAG 输出使用 `ragas_score_batch.v3`，不携带 trace、observation、dataset run、context ID 或本地
  artifact 路径；
- 空 `retrieved_contexts` 是有效失败样本；缺少 reference 的 context 指标直接跳过；
- 原 Ragas runner 只包装 Ragas 官方能力，不拥有数据集、实验、发布或报告。

### Langfuse 适配

- `packages/eval-langfuse` 负责 Agent case 解析、手动产品路径评测、确定性断言和 score 适配；
- 产品路径评测先写出 `agent_product_eval_result.v3`，再生成临时 Ragas JSON；发布阶段在 TypeScript
  适配层用显式 case-to-trace 映射补回 score target；
- 普通 trace 和历史 dataset item 不能反查为 Ragas 正文输入；
- score 名称和类型由代码级 allowlist 校验，不再维护或同步第二份 registry；
- Langfuse score 是可选展示和运行关联，不是 Ragas 输出合同或发布门禁。

### 线上反馈

- 仓库不建立待审状态类型、候选区、候选 publisher 或候选数据库；
- 线上反馈、trace 和人工标注由调用方决定是否用于建立 issue、修复模块或评测输入；
- 需要把反馈或 trace 转成评测输入时，由具体任务决定所需的整理、标识和保存方式。

### 不新增的系统

当前不建设 Kubernetes eval Job、持久评测报告、评测数据库、自动发布门禁或通用自研评测框架。
Ragas 模型调用只读取 runner 本地配置文件，不把该输入注册成跨服务合同，也不重复声明 SDK 已经固定的
provider、transport 或配置 schema version。该本地文件可以包含独立的 `eval_ragas_reranker` profile
供显式检索实验使用，但它不自动接入在线 Model Config，也不改变 native Ragas 评分命令对最终
`retrieved_contexts` 的语义。

## 未采用方案

- **Langfuse 作为评测输入来源**：平台编辑和调用方输入会形成双重事实；
- **维护 Langfuse dataset 镜像及独立 synthetic RAG asset**：便于平台集中管理，却与调用方输入、
  Agent case 和构建校验形成重复来源；
- **从普通 trace 生成 Ragas 样本**：当前 trace 不含正文，恢复正文采集违反数据最小化边界；
- **让 Ragas 直接访问 Langfuse**：把评分器绑定到平台身份和凭据，妨碍独立离线评测；
- **为结果建立报告系统或数据库**：stdout、本地 JSON 和可选 Langfuse score 已满足当前消费；
- **自动把线上反馈写入评测输入**：线上反馈不会在没有调用方选择的情况下自动进入评测流程。

## 后果

- 输入来源、产品运行、Ragas 评分和 Langfuse 展示不会互相隐式改写；
- 独立 Ragas 可以在本地或受控任务中运行，而不需要 Langfuse 凭据；
- Langfuse 仍能展示在线 trace 和调用方按需发布的 score，但不能恢复运行正文采集或成为评测输入来源；
- 删除 trace/dataset 反查、跨包 provider projection、独立 score registry 和持久报告路径，不保留
  兼容入口；
- Agent 专属工具轨迹评分继续使用独立合同，不把平台字段重新放入 RAG native sample；
- 仓库只保留调用方选择的 Agent case；独立 synthetic RAG asset 已退役；
- `packages/inspect-eval/assets` 保存当前仓库选择长期复用的公开 Agent case；更换评分器不应
  自动改写输入来源。

## 相关文档

- [评测](../../../../docs/reference/eval.md)
- [评测用例](../../../../docs/reference/eval-cases.md)
- [Inspect 评测](../../../../docs/runbooks/inspect.md)
- [Langfuse 运行合同](../../../../docs/contracts/langfuse-runtime.md)
- 本篇承接已合并的“评测数据集”（原 ADR-0003）的输入所有权与 case 规则
- [评测指标](./2026-03-22-evaluation-metrics.md)
- [Langfuse 调用链数据](../architecture/2026-07-15-langfuse-trace-data.md)
