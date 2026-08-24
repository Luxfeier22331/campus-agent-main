---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0030
status: accepted
---
# ADR-0030 校级产品范围

## 背景

隐式网页搜索或通用模型知识回退会让用户和运维人员无法区分学校证据支持的答案与
开放域猜测。

## 决策

Campus Agent 是面向中央民族大学这一单一学校信息范围的产品。学校特定事实只能使用已开放校园工具
和已发布证据。当前 Agent 没有通用 web-search 或 open-domain factual tool。

primary agent 可以直接回答问候、产品问题和普通对话，但不得用模型记忆补齐缺失的校园
事实。

工具定义声明事实范围。所需事实完全不在当前工具范围内，或工具没有返回足够 evidence 时，Primary
Agent 在正常助手正文中说明资料边界；这不是执行策略拒绝。实体名称出现在改写、翻译等不需要机构
事实的任务中，不单独触发工具调用或拒绝。

校园搜索失败时不得自动触发开放网页搜索。未来开放域能力需要独立产品决策、可见工具、policy
和 evaluation，不能伪装成 retrieval tuning 或 best-effort recovery。

## 后果

- 校园答案只有一套证据承诺。
- out-of-scope 行为可观测、可测试。
- 产品扩展默认新增校园领域，而不是扩大为通用助手。

## 相关文档

- `docs/architecture/product.md`
- `docs/architecture/system/prompt.md`
- `docs/decisions/adr-0084-agent-knowledge-tools.md`
