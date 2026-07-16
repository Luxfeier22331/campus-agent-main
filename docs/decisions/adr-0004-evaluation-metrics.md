---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0004
status: accepted
---
# ADR-0004 评测指标

## 背景

Agent 可能在路由、检索、答案生成或安全处理阶段失败。单一总分无法说明失败边界。旧
ADR 还把没有 scorer 或 dataset 的预想指标列成了必选项。

## 决策

评测分别观察：

- 执行 outcome 和 tool trajectory；
- 检索相关性和禁止证据；
- 答案质量和 grounding；
- 安全与失败关闭行为。

不得用单一总分替代这些维度。精确 outcome、工具名、稳定参数、context id 和禁止证据
优先使用确定性断言；只有需要语义判断时才使用模型指标。

一个指标只有同时具备以下内容，才能进入仓库认可的指标集合：

- observation 来源和适用 case；
- 可执行 scorer；
- 已注册的 score 名称、类型和所有者；
- missing 或不适用输入的明确处理方式。

`packages/eval-langfuse/assets/registries` 下的可执行 registry 是当前已认可 Langfuse
score 的清单。本 ADR 不复制该清单，也不承诺未实现指标。

threshold、merge gate 和 release gate 属于经评审的操作配置。Langfuse 中存在某个
score，不代表它自动成为发布 gate。

## 后果

- 新指标必须同时提供代码、registry 所有权和有代表性的 case。
- 缺失 observation 时对应评测失败，不得转成零分或静默排除。
- Ragas 指标与仓库确定性检查可以并存，任何框架都不独占指标分类。
- 指标用于定位决策边界，不用于增加 dashboard 数量。

## 相关文档

- `docs/decisions/adr-0003-golden-datasets.md`
- `docs/decisions/adr-0061-eval-runtime.md`
- `docs/decisions/adr-0062-ragas-langfuse.md`
