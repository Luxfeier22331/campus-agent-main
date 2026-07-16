---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0061
status: accepted
---
# ADR-0061 评测运行时

## 背景

已退役评测栈把 case asset、scorer、gate 和 provider transport 分散在大型 Python package
中。Langfuse 已提供 dataset、experiment、score 和 annotation workflow，而大部分仓库
集成代码使用 TypeScript。

## 决策

TypeScript 与 Langfuse 是默认评测路径。

`packages/eval-langfuse` 拥有：

- tracked dataset manifest 和同步逻辑；
- Langfuse trace 与 dataset selection；
- 确定性 execution/tool-trajectory check；
- 安全 Ragas input 构造和 Langfuse score publication；
- score config 同步和 trace verification。

Langfuse 拥有协作平台界面：dataset、run、score、annotation 和 trace inspection。它不拥有
产品合同、来源事实或 release authority。

仓库拥有经评审的 case、qrel、metric admission 和 release verdict。Langfuse score 是
证据，不会自动成为 release gate。

`packages/ragas-runner` 是唯一 Python eval exception。它包装 upstream Ragas，接收
TypeScript 生成的有界 artifact 并返回 score；它不选择 trace、不拥有 case、不调用
Langfuse、不发布 score，也不定义 release policy。

不得恢复 `packages/evals` 和 `scripts.eval_gate`。运行时确定性 fixture 保留在所属运行时，
不集中成另一套 eval framework。

## 边界

- 新平台集成默认进入 `packages/eval-langfuse`。
- 新 Python eval code 必须对应 TypeScript 路径无法合理提供的 upstream capability，并保持
  隔离。
- eval input 只暴露 admitted scorer 需要的字段，不传递 credential、provider payload 或
  unrestricted source body。
- Langfuse automation 使用其支持的 API，不建设平行仓库评审系统。

## 与其他决策的关系

- ADR-0003 定义黄金数据集权威来源。
- ADR-0004 定义指标准入原则。
- ADR-0059 定义 Langfuse 平台所有权。
- ADR-0062 修订本 ADR 的 Ragas input 边界。

## 后果

- 公开 case asset 位于 `packages/eval-langfuse/assets`；私有 case 从获批私有来源提供。
- TypeScript CLI 可以同步 dataset/score config、运行已开放 Agent eval、调用隔离 Ragas
  process 并发布结果。
- 增加 scorer 不能作为恢复通用 eval framework 的理由。
