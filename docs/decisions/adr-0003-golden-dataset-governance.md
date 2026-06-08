---
doc_type: decision
decision_id: ADR-0003
status: accepted
created: 2026-03-22
updated: 2026-03-22
---
# ADR-0003 Golden Dataset 治理规则

适用范围：`campus-agent` v2 中由 `packages/evals` 维护的 golden dataset、baseline 与回归真值资产

## 目标

将 golden dataset 从长期架构文档中拆出，作为独立治理文档冻结其职责、真值模型、split 语义、来源治理与 scorer
边界，避免后续把评测框架选型、phase-1 落地细节或一次性样本策略误写成长期架构承诺。

## 非目标

本 ADR 不冻结以下内容：

- `student_rules` 第一批具体题目或样本数量
- 具体指标家族与 split 门禁指标组合
- 某次迭代的 CI 分数阈值或 release gate 数值
- 某个 scorer、评测服务或第三方框架的接入步骤
- 当前阶段的文件布局、runner 命令或样本生成流水线

这些内容应分别进入指标 ADR、实施计划或后续实现文档，而不是写入长期治理规则。

## 决策 1：Golden Dataset 的角色

- golden dataset 是 `packages/evals` 的 canonical truth asset
- 它服务回归、release gate、incident backfill 与长期质量校准
- 它不从属于 `ragas`、OpenAI graders 或其他第三方评测框架的数据格式
- 任何 scorer/runtime 都只能消费 golden dataset，而不能反向定义它的真值结构

## 决策 2：真值模型按分层行为定义

golden truth 不按“问题 + 唯一标准答案”建模，而至少按以下层次拆分：

- `status truth` 期望系统返回 `completed`、`needs_clarification`、`no_answer` 或 `error`
- `retrieval truth` 期望命中的 `doc_id`、`version_id`、`chunk_id`、source locator 与禁止命中的
  source
- `answer truth` 期望覆盖的事实点、禁止出现的断言，以及允许的回答形态
- `trace truth` 期望的 handoff、是否应发生 retrieval、是否应澄清、是否应 fail-closed

其中 retrieval 与 trace truth 属于 agentic RAG 系统的正式真值，不得被单一 reference answer 替代。

## 决策 3：Case Schema 保持仓库自有协议

每条 golden case 的最小协议至少应表达：

- `case_id`
- `split`
- `source_type`
- `user_goal`
- `actor`
- `corpora`
- `expected_status`
- `expected_sources`
- `forbidden_sources`
- `required_facts`
- `forbidden_claims`
- `trace_expectation`
- `grader_policy`

允许未来扩展字段，但不得省略上述层次中的核心语义。若后续实现为 JSON、YAML、Python dataclass
或其他内部格式，格式可以变化，协议语义不能变化。

## 决策 4：Split 是治理语义，不是实现细节

golden dataset 长期至少区分以下 split：

- `smoke` 小而稳的主链路验证集
- `regression_locked` 不允许静默重写的回归基线
- `exploratory` 用于扩边与试验的新样本集合
- `release_gate` 面向上线门禁的关键场景集合

split 的职责边界在长期上固定，但每个 split 的样本数、命中率目标和实际门禁策略属于阶段性实施问题，不在本 ADR 中冻结。

## 决策 5：来源与版本治理必须显式记录

每条 case 都应带明确 provenance，至少区分：

- `expert_authored`
- `historical_logs`
- `incident_backfill`
- `synthetic_expansion`

治理规则固定如下：

- 允许以 synthetic-heavy 的方式生成 candidate cases，但 canonical golden dataset
  仍必须经过人工或规则审核收口
- `regression_locked` case 默认不可静默重写
- 如果旧 case 的 truth 有误，应显式记录修正原因
- 如果系统行为发生合理演进，但旧 case 仍代表历史回归风险，应新增新 case，而不是覆盖旧 case
- 线上 incident、越权、误召回、误澄清、错误高置信度等问题，应优先回灌为 `incident_backfill`

## 决策 6：Generator、Grader 与 Scorer 保持可替换

长期评测遵循以下边界：

- 能用确定性规则验证的内容，优先用程序化断言
- retrieval truth 优先验证召回、ACL 过滤、source locator 和 evidence 回链
- agent workflow 除最终回答外，还必须支持 trace grading
- `ragas` testset generator 或其他自动生成器，只能用于生成 candidate cases、扩充 `exploratory`
  样本或辅助 synthetic expansion
- 自动生成器产物必须经过仓库自有 schema 补全与人工/规则校验后，才能进入 canonical golden dataset
- 不允许把自动生成器直接当作 `regression_locked` 或 release gate 的最终真值来源
- `ragas`、OpenAI graders、自定义 Python grader 或其他 scorer 都只能作为 `packages/evals`
  边界后的可替换实现
- 不允许让某个 generator/scorer 的默认输入输出格式决定仓库的 golden dataset 协议、split 语义或治理规则

## 决策 7：自动生成样本的治理边界

- 自动生成样本是候选资产，不是 canonical truth
- 长期允许采用 `synthetic-heavy but curated-final` 策略：自动生成负责提高覆盖面，人工/规则审核负责形成最终真值
- 如果使用 `ragas` 的 `testset generator`，其职责是提高 query 覆盖面、补充改写、补充检索候选，而不是自动生成完整的
  actor/ACL/trace truth
- 对 agentic RAG 系统而言，`expected_status`、`expected_sources`、`forbidden_sources`、`t
  race_expectation` 仍应由仓库协议和人工/规则审核收口
- 自动生成样本优先进入 `exploratory` 或 `synthetic_expansion` 流程；只有经审核后才可晋升到
  `smoke`、`regression_locked` 或 `release_gate`
- 如果后续真实日志、incident 数据逐步增多，应优先用它们校正 synthetic 分布，而不是让纯 synthetic 长期独占主导地位

## 决策 8：文档分层关系

- `docs/architecture/target-architecture.md` 只保留 `evals` 边界与可替换性原则
- 本 ADR 负责 golden dataset 的长期治理、不变量与边界
- `docs/decisions/adr-0004-evaluation-metrics.md` 负责指标家族、指标分层与 gate 语义
- `.planning/WORKSTREAMS.md` 与 `GSD SDK / Codex native session state`
  负责当前阶段的落地步骤、文件布局、首批样本和验收标准

换句话说，长期架构回答“为什么存在这个边界”，本 ADR 回答“这个边界长期遵守什么真值治理规则”，指标 ADR
回答“围绕这些真值评什么”，实施计划才回答“这轮具体怎么做”。
