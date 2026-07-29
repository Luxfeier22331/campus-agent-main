---
doc_type: architecture
owner_boundary: agent-retrieval
status: active
---

# Agent 知识读取（服务端 grounding）

## 边界

本文定义在线回答如何消费机构文档依据。培养方案、学生规则、学校制度和其他正式文档共用一个
文档 RAG，不再按课程事实、文档召回和章节读取拆成模型工具。一个请求仍由一个 Primary Agent
生成最终答案，不建立 Knowledge Agent 或第二次合成。

检索服务和准入实现见 `retrieval-serving.md`；grounding 结构由
`packages/contracts/schemas/grounding-context.v2.schema.json` 维护。

## 执行链

```text
冻结执行输入
-> execution-control 本地路由为 none、single_scope 或 multi_scope
-> 只为选中的范围冻结当前 release、物理 collection 和检索 Provider Config
-> 对冻结查询执行一次向量化
-> 并发查询选中的文档范围
-> 使用 Qdrant dense+sparse RRF 分数全局排序、去重和 token 裁剪
-> 写入受保护 grounding_context.v2
-> Primary Agent 消费 grounding 并生成一次最终答案
-> finalization 校验 evidence:// 引用并派生公开来源
```

`none` 路径跳过 `PrepareGroundingContextActivity`，由 Agent Activity 建立状态为 `not_required` 的
不可变 grounding 后直接生成。其余路径只执行一次 grounding Activity。grounding 不是 SDK tool
call；Temporal 和普通投影只保存有界身份、状态、计数和诊断字段。

当前实现只有一次 grounding 和一个 Primary Agent。本文中的“Agentic RAG”只表示按问题选择是否检索，
不表示存在 Knowledge Agent、query-level workflow、critic 或默认多轮 refinement。

## 查询边界

execution-control 使用确定性本地规则选择范围，不增加模型路由调用。普通请求只使用当前用户问题；
存在指代的追问会拼接最近一条用户消息，不拼接上一轮 Assistant 答案。查询和所选范围随 admission
snapshot 冻结，Activity 重放不能重新路由。

`single_scope` 查询一个范围，`multi_scope` 并发查询多个范围，`none` 不解析知识 release 或检索
Provider。候选使用 Qdrant dense+sparse RRF 分数统一排序；选择时先保证每个有合格候选的范围至少一条，再优先保留
不同 section，最后按全局排序补足预算。调用方不能指定 collection、物理
collection、Provider、top-k、release 或可见性策略。在线查询只消费 `current_releases` 对应的
不可变 release；截至日期、历史版本比较等问题不在当前在线检索能力内。

当前路由对未命中具体 scope 词、但命中制度性术语的请求使用有界的全 scope fallback，以优先保证
召回；该 fallback 不是模型路由，也不是无限扩张范围。真实语料评测需要单独衡量它的漏召回、误召回
和延迟，再决定是否收窄术语映射。

授权过滤必须在候选进入 Qdrant 查询前完成。`ready` 只代表每个选定范围有合格候选，不代表
证据足以回答；Primary Agent 仍可返回 `unsupported_by_evidence`。

培养方案仍以文档形式进入同一检索链。课程、学期和学分问题只有在相应培养方案文本能够提供证据
时才能回答；系统不维护第二套课程事实读取模型。

## 依据使用

- 完整 grounding 正文只保存在 execution-control 的受保护载荷；
- Agent 只能引用本次 run 的 grounding 中精确出现的 `evidence://`；
- 每个依据绑定 scope、release、chunk、section、文档、正文摘要和公开 URL；
- 个人记忆、上一轮依据和模型记忆不能成为本轮正式来源；
- `not_required` 表示本轮未执行文档检索，只允许无需机构依据的请求直接回答，答案不得附带
  `evidence_refs`；
- `empty` 不能生成机构事实答案，应返回 `unsupported_by_evidence`；
- `partial` 表示只覆盖部分所选范围，可以回答有本轮依据支持且与其他请求部分可分离的内容；用户请求
  中确有未获依据支持的部分时再明确说明；
- `ready` 只表示每个所选范围至少有一条合格依据，不保证这些依据足以回答；
- `partial` 或 `ready` 生成机构事实答案时必须至少引用一条本轮依据，实际依据不足时返回
  `unsupported_by_evidence`；
- finalization 只接受当前 grounding 中的引用，并从可信元数据派生 `result.sources`。

Primary Agent 不接收 Qdrant 响应、内部 collection 名、检索 Provider 响应或 PostgreSQL 行。来源
正文被当作不可信数据，不能覆盖 instruction。

## 完整度与评测

回答完整度按用户问题和实际支持证据评测，不按检索调用次数或工具调用数量评测。RAG 用例记录
预期文档范围、最少相关上下文数量、reference context 和禁止上下文；知识问答的工具序列为空。

评测需要覆盖路由模式、范围覆盖、上下文精确率、召回率、答案相关性、忠实度、引用合法性和无依据
问题。延迟观测包括 `grounding.prepare_ms` 以及 embedding、search、pack 子阶段；历史版本
能力未实现，因此标准用例只评测当前 release。

## 相关文档

- `agent-framework.md`
- `tool-routing.md`
- `retrieval-serving.md`
- `../../contracts/tool-read-model.md`
- `../../reference/eval-cases.md`
