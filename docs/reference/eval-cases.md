---
doc_type: reference
owner_boundary: packages/eval-langfuse
status: active
---

# 评测用例

## 边界

需要长期复用的用例可以由仓库文件或私有对象存储维护。当前仓库公开用例位于
`packages/eval-langfuse/assets/agent/routing/cases.v1.json`。runtime 本地合同仍由所属测试维护；
Langfuse trace、annotation、score 和其他平台状态不能自动改写来源。

`agent-eval` 读取调用方显式提供的 cases 文件，并通过真实 App API 产生一次产品执行。Ragas 输入必须由
适配器或调用方显式写成 `ragas_sample_batch.v2`，不能从普通 trace 或 Langfuse 反查 answer、retrieved
contexts 或其他正文。一次性执行也可以直接提供其他输入文件。

## Agent 用例

每个仓库用例必须包含：

- `case_id`、`query`、`expected_outcome`，以及评测需要的 `reference`；
- `reference_tool_calls[]`，表示当前真实工具 exposure 下的预期调用；
- `argument_mode`，未提供时默认为 `name_only`。

可选字段：

- `case_family` 和 `split`：用于筛选和版本比较；
- `setup_turns[]`：在评分 turn 前建立同一会话上下文；
- `forbidden_context_ids[]`：不得支持答案的上下文；
- `reference_context_ids[]`、`reference_contexts[]`：标记该用例需要检查本轮检索依据，并保存该输入
  选择的依据预期；当前适配器用它们是否非空决定 Ragas 是否适用，但不把这些字段送入 Ragas native
  sample，也不替代产品实际检索结果。

当前在线 Campus Docs 能力未接入，文档问题不派生额外工具调用，应使用
`reference_tool_calls=[]`。只有调用方显式提供 `reference_context_ids[]` 或 `reference_contexts[]` 时，
适配器才为该用例生成 Ragas 样本；这不表示在线运行会自动检索。实际上下文为空时仍生成失败样本。

## Agent 工具用例

工具用例使用 `query`、`expected_outcome`、`reference_tool_calls[]` 和 `argument_mode`：

- `name_only`：只评测 direct/function 选择；
- `eval_safe_args`：仅在当前真实工具具有稳定且可公开参数时使用。

当前在线 Agent 用例只标注已经开放的真实工具；机构知识未接入时，不为文档问题伪造工具或固定证据
上下文。只有 RAG 用例提供 `reference_context_ids[]` 或 `reference_contexts[]` 时，runner 才把离线
样本送入 Ragas；普通改写、翻译或问候不因主题相似而进入 RAG 评测。
`personal_memory_recall` 或未来实际开放的注册工具可以进入工具预期。不得从答案正文反推工具选择。

路由用例必须与 checked-in 工具注册表的当前 exposure 一致。知识回答不得恢复已退役的课程、文档召回或
章节读取工具名称。

## 编写规则

- reference 必须说明可支持的答案，不能只有文档标题；
- 含糊问题应成为澄清或无答案用例，或补足能形成唯一合理预期的上下文；
- 跟进问题通过 `setup_turns` 明确被指代对象；
- 缺失数据使用 `no_answer`，不能奖励模型记忆补全；
- 禁止上下文必须来自实际会竞争的 hard negative，不能填充无关标识。

## Ragas 样本边界

Ragas native sample 只允许以下字段：`case_id`、`user_input`、`response`、`retrieved_contexts`、
可选 `reference` 和标量 `metadata`。`trace_id`、`observation_id`、平台运行标识、context ID、
本地路径和凭据只在 TypeScript 适配层保留，用于把 score 关联回 Langfuse；它们不能进入 Python
runner 的 RAG 样本。

`retrieved_contexts: []` 是有效样本。空召回应由确定性检索 score 和 Ragas 结果共同反映，不能通过
跳过样本来提高批次成功率。

## 数据边界

生产失败样例不会自动进入评测输入；是否使用、如何处理以及放在公开还是私有边界，由具体任务决定。
仓库不再保存独立 synthetic RAG dataset，也不从生产 trace 自动生成用例。

Context ID 用于精确来源预期和检索审计，不表示 Ragas 提供 ID-based metric。文本型 context 指标
消费调用方显式生成且满足该指标输入要求的 native sample；Langfuse 只在需要时保存 score 和运行
关联。
