---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0090
status: accepted
---

# ADR-0090 评测数据与平台边界

## 背景

仓库曾同时维护 synthetic RAG dataset、Langfuse dataset 反查、trace 选择命令、score registry、
本地 artifact 路径和报告机制。Ragas sample 又携带 trace、observation、dataset run 和 context ID，
使评分器依赖 Langfuse 的平台身份。一次性评测输入与平台镜像共用数据集语义时，难以判断谁拥有
评测预期、正文和结果。

当前运行 trace 已按数据最小化原则排除 prompt、答案、对话和 retrieval 正文，因此不能把 Langfuse
当作 Ragas 正文来源，也不应为了评测恢复运行正文采集。

## 决策

### 评测输入

- 评测命令只消费调用方显式提供的输入；需要稳定复用的 case 可以放在仓库文件或私有对象存储中，
  一次性输入也可以只在本地提供；
- Langfuse 平台状态不作为评测输入来源，仓库不维护 dataset manifest、镜像同步或 reconciliation；
- 生产反馈、trace、score 和人工标注不会自动成为评测输入；是否使用由具体评测任务决定。

### Ragas

- 离线 Ragas 直接消费调用方显式提供的本地 JSON，不连接 Langfuse，不选择 trace 或 dataset；
- RAG 输入使用 `ragas_sample_batch.v2`，只包含 `case_id`、`user_input`、`response`、
  `retrieved_contexts`、可选 `reference` 和标量 `metadata`；
- RAG 输出使用 `ragas_score_batch.v2`，不携带 trace、observation、dataset run、context ID 或本地
  artifact 路径；
- 空 `retrieved_contexts` 是有效失败样本；缺少 reference 的 context 指标直接跳过；
- `packages/ragas-runner` 只包装 Ragas 官方能力，不拥有数据集、实验、发布或报告。

### Langfuse 适配

- `packages/eval-langfuse` 负责 Agent case 解析、手动产品路径评测、确定性断言和 score 适配；
- 产品路径评测先写出 `agent_product_eval_result.v1`，再生成临时 Ragas JSON；发布阶段在 TypeScript
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
provider、transport 或配置 schema version。

## 后果

- 输入来源、产品运行、Ragas 评分和 Langfuse 展示不会互相隐式改写；
- 独立 Ragas 可以在本地或受控任务中运行，而不需要 Langfuse 凭据；
- Langfuse 仍能展示在线 trace 和调用方按需发布的 score，但不能恢复运行正文采集或成为评测输入来源；
- 删除 trace/dataset 反查、跨包 provider projection、独立 score registry 和持久报告路径，不保留
  兼容入口；
- Agent 专属工具轨迹评分继续使用独立合同，不把平台字段重新放入 RAG native sample。

## 未采用方案

- **Langfuse 作为评测输入来源**：平台编辑和调用方输入会形成双重事实；
- **从普通 trace 生成 Ragas 样本**：当前 trace 不含正文，恢复正文采集违反数据最小化边界；
- **让 Ragas 直接访问 Langfuse**：把评分器绑定到平台身份和凭据，妨碍独立离线评测；
- **为结果建立报告系统或数据库**：stdout、本地 JSON 和可选 Langfuse score 已满足当前消费；
- **自动把线上反馈写入评测输入**：线上反馈不会在没有调用方选择的情况下自动进入评测流程。

## 相关文档

- `../reference/eval.md`
- `../reference/eval-cases.md`
- `../runbooks/ragas.md`
- `../contracts/langfuse-runtime.md`
- `adr-0003-golden-datasets.md`
- `adr-0004-evaluation-metrics.md`
- `adr-0076-langfuse-trace-data.md`
