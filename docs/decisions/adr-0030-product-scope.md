---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0030
status: accepted
---
# ADR-0030 校级产品范围

## 背景

隐式网页搜索或通用模型知识回退会让用户和运维人员无法区分学校证据支持的答案与
开放域猜测。产品需要允许使用尚未采集的公开校园网页信息，但仍要保持校园范围和可见来源。

## 决策

Campus Agent 是面向中央民族大学这一单一学校信息范围的产品。学校特定事实使用已开放校园工具、已发布
证据，或由 Agents SDK 原生 `web_search` 返回的公开校园网页证据。`web_search` 只作为校园问题的证据
来源，不开放通用 open-domain factual tool 或任意主题的聊天搜索。

Agent Workflow 可以直接处理问候、产品问题和普通对话，但不得用模型记忆补齐缺失的校园事实。

工具定义声明事实范围。Solve/Executor 判断当前步骤所需来源；所需事实不在已采集文档范围内时，
Replanner 可以为公开校园信息生成 `web_search` 步骤；如果网页证据仍不足，则在正常助手正文中说明
资料边界。这不是执行策略拒绝。实体名称出现在改写、翻译等不需要机构事实的任务中，不单独触发工具
调用或拒绝。

`web_search` 不是 `campus_search` 失败后的自动回退：是否使用由 Agent Workflow 的 Solve/Replanner
根据问题和工具声明决定，不能由代码在失败后机械触发。未来开放域能力仍需要独立产品决策、可见工具、policy 和
evaluation，不能伪装成 retrieval tuning 或 best-effort recovery。

## 后果

- 校园答案可以使用本地 Campus Docs evidence 或公开网页 evidence；两者都由 Finalization 校验并派生
  统一编号的来源卡。Web Search 不写入本地 `tool_results` 或工具轨迹，也不保存供应商原始搜索结果。
- out-of-scope 行为可观测、可测试。
- 产品扩展默认新增校园领域，而不是扩大为通用助手。

## 相关文档

- `docs/architecture/product.md`
- `docs/architecture/system/prompt.md`
- `docs/decisions/adr-0084-agent-knowledge-tools.md`
