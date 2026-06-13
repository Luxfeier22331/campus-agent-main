---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0014
status: accepted
created: 2026-03-28
updated: 2026-04-20
---
# ADR-0014 Versioned Document Serving And History Query

## 状态

Accepted on 2026-03-28.

## 背景

当前 repo 已经具备以下能力：

- registry 保留历史 `version_id`
- ingestion 维护 `document_id + revision_track` 维度的 current truth
- query-serving 默认只消费当前有效版本
- 多来源等价内容归并到同一逻辑版本，而不是重复建索引点

但当前仍缺失一个明确边界：

- 用户如果明确要查旧版、按时间点查、比较新旧版本，系统应如何工作

如果这个边界不冻结，后续实现容易退化为：

- 误把“保留历史版本”当成“已经支持历史查询”
- 让模型仅凭 query 文本自行猜测该查哪一版
- 先查出历史内容，再在回答阶段补一句“最新链接在这里”
- 把同一逻辑版本的多来源继续当作多个独立 evidence

## 决策

后续长期规则固定如下：

1. 历史版本必须保留；默认服务最新版不等于删除历史版本。
1. 普通 query-serving 默认只消费当前有效版本。
1. 历史版本查询必须是显式能力，而不是隐式副作用。
1. 版本选择必须发生在 retrieval 前，而不是在回答层事后修补。
1. 多来源等价内容继续归并为一个逻辑版本，不得作为多个独立 evidence 同时进入候选集。
1. 当系统返回历史版本内容时，回答必须显式标注该内容不是现行规定。
1. 当用户请求版本对比时，系统必须把旧版、新版和变化点作为显式回答语义，而不是只返回单边条文。
1. 如果后续 retrieval 演进到 planner-first 形态，`historical`、`as_of`、`compare` 仍必须通过
   typed query-mode / retrieval-plan 边界进入，而不是回退成 prompt 内隐式推理。
1. `compare` 查询允许走 multi-step retrieval，但最终 answer-bearing evidence
   仍必须显式区分旧版、新版与变化点支持集。

## 约束

这项决策同时冻结以下约束：

- 当前“默认只服务当前有效版本”的运行现实继续成立，直到显式历史查询能力落地
- 不允许通过放宽默认 retrieval filter 的方式“顺便支持”历史查询
- 不允许让 LLM 在没有版本解析边界的情况下自行猜测用户历史意图
- 不允许为等价来源重复建索引并重复进入 evidence bundle
- 历史查询、按时间点查询、版本对比都必须通过显式 version-selection / version-resolution 边界进入检索
- 不允许把历史版本解析藏在 planner prompt 的自由文本里而没有 typed plan / mode truth

## 结果

直接结果如下：

- 需要一份单独 architecture 文档描述长期版本化 serving 与历史查询形态
- 需要一份单独实施 plan 描述请求协议、registry、retrieval、answer、eval 的后续工作拆解
- 当前 retrieval 与数据平面文档需要补充“现状仅支持默认 current-serving，不支持显式历史查询”的边界说明
- 如果后续推进 full agentic retrieval，version mode 需要成为 retrieval plan 的显式字段，而不是
  retrieval backend 的隐藏分支

## Complements

这项决策 complements：

- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
