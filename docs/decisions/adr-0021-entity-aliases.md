---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0021
status: accepted
---
# ADR-0021 实体别名

## 背景

校园名称和缩写具有学校与领域语义。全局字符串替换可能把歧义短语变成错误的权威实体，
也会让检索依赖不可见的改写。实体别名决策还不能替检索合同预先增加尚无运行时消费者的字段
或处理阶段。

## 决策

alias 属于权威实体所在领域。alias 记录必须明确 institution、domain 和 entity type，并
解析到稳定领域实体或 entity family，而不是任意替换文本或 retrieval backend id。

解析只有三类有效 outcome：

- 支持一个权威实体或 family；
- 输入存在歧义，需要澄清；
- alias 不受支持或被拒绝。

retrieval rank 不得把歧义变成权威事实。memory 可以提供会话上下文，但不能重新定义
alias。

仓库不提供全局 alias service 或共享 alias table。各领域拥有自己的数据和歧义规则。
checked-in alias 配置在有已开放运行时消费前只是 offline data；文件存在不代表能力已经
产品化。

本决策不为 `grounding_context.v2` 或文档范围准入增加 entity 字段。当前 grounding 只消费冻结的
用户问题和服务端文档范围。未来领域 resolver 如需新的运行参数，必须先引入可执行合同和评测，
不能以别名配置存在推断在线能力。

## 后果

- navigation、curriculum 等领域可以使用不同实体模型，不泄漏到共享检索合同。
- 高风险或 many-to-one alias 默认要求澄清，不使用 top-one retrieval 猜测。
- 学校名称、course family 和 alias list 属于领域数据和测试，不属于本 ADR。

## 相关文档

- `docs/decisions/adr-0084-agent-knowledge-tools.md`
- `docs/architecture/system/code-organization.md`
