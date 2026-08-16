---
doc_type: reference
owner_boundary: packages/eval-langfuse
status: active
---

# 评测用例

## 边界

每个 Langfuse dataset 使用仓库维护的 `cases.v1.json` 保存 Agent 工具或 RAG 预期。runtime 本地
合同仍由所属测试维护；annotation 和 score 不能直接改写用例来源。

## RAG 用例

每个用例必须包含：

- 稳定的 `case_id`、`case_family` 和 `split`；
- 自然问题 `question`；
- 评审者编写的 `reference`；
- 有答案来源时的稳定 `reference_context_ids[]`；
- 有序 `expected_document_scopes[]`；
- `expected_outcome=answer|no_answer`；
- 非负整数 `minimum_relevant_context_count`。

有答案用例的最少相关上下文数量必须大于 0；无答案用例必须为 0。该字段表示本轮检索结果中
的相关上下文下限，不表示检索调用次数或工具调用次数。

可选字段：

- `setup_turns[]`：在评分 turn 前建立同一会话上下文；
- `forbidden_context_ids[]`：不得支持答案的上下文；
- `reference_contexts[]`：只供需要 reference text 的指标使用，不冒充产品检索结果。

RAG 用例的 `expected_document_scopes` 只标注期望来源类别，用于评审召回结果；它不是运行时路由、
collection 或准入字段。Campus Docs 检索不派生 `reference_tool_calls`；默认
`argument_mode=name_only`。

## Agent 工具用例

工具用例使用 `query`、`expected_outcome`、`reference_tool_calls[]` 和 `argument_mode`：

- `name_only`：只评测 direct/function 选择；
- `eval_safe_args`：仅在当前真实工具具有稳定且可公开参数时使用。

文档问题预期由模型直接消费 `campus_docs_evidence` 后回答，因此 `reference_tool_calls=[]`。只有
`personal_memory_recall` 或未来实际开放的注册工具可以进入工具预期。不得从答案正文反推工具选择。

所有有效在线请求都会执行一次 Campus Docs 检索，因此 Agent 用例不标注“是否检索”。只有用例提供
`reference_context_ids[]` 或 `reference_contexts[]` 时，runner 才把该次执行送入 RAGAS；普通改写、
翻译或问候即使偶然召回文档，也只评测对应 Agent/终态行为。

路由用例必须与 checked-in 工具注册表的当前 exposure 一致。知识回答不得恢复已退役的课程、文档召回或
章节读取工具名称。

## 编写规则

- reference 必须说明可支持的答案，不能只有文档标题；
- 含糊问题应成为澄清或无答案用例，或补足能形成唯一合理预期的上下文；
- 跨文档类别问题列出支持完整答案所需的全部来源类别；
- 跨类别问题只有部分内容有可靠依据时，如果各部分可分离，则使用 `expected_outcome=answer`、记录实际
  可支持部分的 reference context，并在 reference 中要求明确说明其余部分依据不足；
- 跟进问题通过 `setup_turns` 明确被指代对象；
- 标准在线用例只评测 `campus_docs_serving.current_index` 指向的当前索引，不编写历史版本期望；
- 缺失数据使用 `no_answer`，不能奖励模型记忆补全；
- 禁止上下文必须来自实际会竞争的 hard negative，不能填充无关标识。

## 数据边界

生产失败样例只有经过脱敏、去重、目标审查和来源核验后才能进入标准答案集。公开仓库只保存
synthetic 或 self-authored 用例；真实校级 gold data 放在私有数据边界或批准的 Langfuse dataset。

Context ID 用于精确来源预期和检索审计，不表示 Ragas 提供 ID-based metric。文本型 context 指标
必须消费真实运行产生、已脱敏且包含必要 reference 的 materialized sample。
