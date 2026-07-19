---
doc_type: architecture
owner_boundary: retrieval-serving
status: active
---
# 检索服务

## 边界

本文定义服务端知识目标准入和索引依据检索，不负责顶层工具选择或答案生成。

## 目标注册表

`configs/runtime/query-serving-targets.v1.json` 是 Knowledge Agent target 到一个 `collection`、
一份 server-owned serving config 和一个 retrieval limit 的权威映射，不声明 `corpus`。

target 是语义查询目标，不是 corpus alias。registry 中的 `collection` 用于校验所引用 serving
config，不是模型可见的向量库控制参数。两个文件都通过验证且 collection 一致时 target 才可用。
当前目标清单只以 registry 为准。

## 搜索流程

```text
运行与访问校验
-> 解析知识目标
-> 校验查询配置
-> 查询向量化
-> Qdrant 稠密与稀疏预取
-> Qdrant 原生 RRF 融合
-> 当前或历史版本与可见性过滤
-> 形成有界回答证据
-> 有界搜索投影
```

该查询位于 SDK Agent Activity 内，不是 Temporal 工作流阶段。

`include_history=false` 要求 `is_current=true`；`include_history=true` 允许同 target 中已开放
历史 document version。evidence 可以包含 source `version_id` 供引用和比较。

## Serving 事实

target registry 引用的 serving config 拥有 offline `corpus` metadata、collection、Qdrant
alias、embedding provider/model/dimension、dense/sparse vector name、retrieval enablement、
revision track 和 visibility policy。execution-control 查询前校验完整 profile；这些字段只在
runtime 内部使用。

索引构建、schema 声明或阅读器发布都不会自动开放 target。目标未知、配置关闭、向量不兼容或
缺少访问投影时拒绝查询。

## Evidence 与观测

搜索返回有界依据和稳定引用。运行投影可以包含 target、历史模式、搜索序号、耗时、候选与依据
数量、文档标识和有界片段。原始查询向量、来源正文、凭据和后端响应保持内部。

## 相关文档

- `agentic-retrieval.md`
- `data-plane.md`
- `../../contracts/tool-read-model.md`
- `../../decisions/adr-0075-knowledge-search.md`
