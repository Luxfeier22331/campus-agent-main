---
doc_type: reference
owner_boundary: packages/eval-langfuse
status: active
---

# 评测用例

## 边界

每个 Langfuse dataset 使用一个仓库维护的 `cases.v1.json` 保存 Agent 路由或 RAG 预期行为。
runtime 本地合同仍由所属测试维护。候选审查、score 和 annotation 不能直接改写这两类来源。

## RAG 用例

每个用例必须包含：

- 稳定的 `case_id`、`case_family` 和 `split`；
- 自然问题 `question`；
- 评审者编写的 `reference`；
- 有答案来源时的稳定 `reference_context_ids[]`；
- 有序 `expected_targets[]`；
- `expected_outcome=answer|no_answer`；
- 正整数 `expected_search_count`。

可选字段：

- `setup_turns[]`：在评分 turn 前建立同一会话上下文；
- `include_history`：明确要求历史版本检索；
- `forbidden_context_ids[]`：不得支持答案的上下文；
- `reference_contexts[]`：只供需要 reference text 的指标使用，不冒充产品检索结果。

预期工具序列由这些字段派生：一次 public `knowledge_query`，随后按 target 顺序调用
`knowledge_search`。数据集不再重复保存第二份手写序列。

## 路由用例

Agent 路由用例使用 `query`、`expected_outcome`、`reference_tool_calls[]` 和
`argument_mode`：

- `name_only`：参数不稳定时只评测 direct/function/handoff 选择；
- `eval_safe_args`：只断言白名单稳定参数，目前为 knowledge target 和 history mode。

不得从答案正文反推工具选择。

## 编写规则

- reference 必须包含支持答案的事实，不能只有文档标题；
- 含糊问题应成为澄清/no-answer 用例，或补足能形成唯一合理预期的上下文；
- 跨 target 问题列出支持完整答案所需的全部 target；
- 跟进问题通过 `setup_turns` 明确被指代对象；
- 历史问题设置 `include_history=true`，当前问题不编码物理 version ID；
- 缺失数据使用 `no_answer`，不能奖励模型记忆补全；
- 部分答案用例必须明确支持字段，并把不可用字段加入禁止声明。

## 准入

生产失败样例只有经过脱敏、去重、目标审查和来源核验后才能进入标准答案集。Langfuse
annotation 可以提出候选，但接受后的仓库用例仍是版本化来源。

公开仓库只保存 synthetic 或 self-authored 用例。真实校级 gold data 使用相同 schema 放在
私有数据边界或批准的 Langfuse dataset，不发布来源正文。

## 上下文标识

Context ID 用于精确来源期望和检索审计，不表示 Ragas 提供 ID-based metric。文本型 context
指标必须消费真实运行产生、已脱敏且包含必要 reference 的 materialized sample。
