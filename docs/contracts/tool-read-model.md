---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---

# 内部读取模型合同

## 文档边界

本文规定 execution-control 当前使用的内部只读数据边界。它不决定产品开放状态，不拥有 app-api
浏览器 HTTP 合同或来源 schema。

## 模型工具读取

Go execution-control 保留一个机构工具接口：

- `POST /internal/query/campus-services/transport-schedule`。

它对应 `transport_schedule_lookup`，从已发布班车读取模型返回类型化、安全、有界的时刻表摘要。
该工具在 `configs/runtime/tools.v6.json` 中为 `closed`，因此新运行不会把它提供给 Primary Agent。

接口只接受仓库内部认证调用，使用 `x-execution-query-auth`，JSON 字段保持 `snake_case`。查询时
不得扫描原始来源、通知 HTML、通用检索分块或现场网页。

## Grounding 读取

文档知识不通过工具接口读取。`PrepareGroundingContextActivity` 直接消费本轮冻结的文档范围：

1. 从 PostgreSQL `current_releases` 准入每个 scope 的 release 和不可变 Qdrant collection；
2. 使用冻结的 `embedding` 模型设置对当前问题执行一次向量化；
3. 并发查询选中的各物理 collection；
4. 校验 Qdrant chunk 的 scope、release、正文 hash、token 数和引用元数据；
5. 使用 Qdrant dense+sparse RRF 分数全局排序并形成 `grounding_context.v2`。

Qdrant chunk 是当前在线 grounding 的正文读取来源；PostgreSQL 拥有 release、激活指针和发布身份。
grounding 不调用已退役的课程、文档召回或章节读取 endpoint，也不回退到这些旧合同。

## 开放边界

`personal_memory_recall` 使用独立的个人记忆 handler 和 Hindsight，不属于机构读取模型。
`transport_schedule_lookup` 是否开放只以工具注册表和本轮准入为准；文档 grounding 是否可用则要求
全部 scope、current release、Provider Config 和 serving config 同时通过准入。

任一输入或依赖不完整都失败关闭，不能以空结果、旧 release、旧缓存或模型记忆伪装成功。

## 相关文档

- `tool-execution.md`
- `../architecture/system/tool-routing.md`
- `../architecture/system/retrieval-serving.md`
- `../domains/transport.md`
