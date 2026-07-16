---
doc_type: architecture
owner_boundary: retrieval-serving
status: active
---
# 检索服务

## 边界

本文拥有 server-side target admission 和 indexed evidence retrieval，不拥有 top-level tool
selection 或 answer synthesis。

## 目标注册表

`configs/runtime/query-serving-targets.v1.json` 是 Knowledge Agent target 到一个 `collection`、
一份 server-owned serving config 和一个 retrieval limit 的权威映射，不声明 `corpus`。

target 是 semantic serving surface，不是 corpus alias。registry 中的 `collection` 用于校验
所引用 serving config，不是 model-visible vector-store control。两个文件都通过验证且
collection 一致时 target 才可用。当前 target 清单以 registry 为准；`official_web` 不在其中。

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
-> sanitized search projection
```

该查询位于 SDK Agent Activity 内，不是 Temporal graph。

`include_history=false` 要求 `is_current=true`；`include_history=true` 允许同 target 中已开放
历史 document version。evidence 可以包含 source `version_id` 供引用和比较。

## Serving 事实

target registry 引用的 serving config 拥有 offline `corpus` metadata、collection、Qdrant
alias、embedding provider/model/dimension、dense/sparse vector name、retrieval enablement、
revision track 和 visibility policy。execution-control 查询前校验完整 profile；这些字段只在
runtime 内部使用。

index build、schema declaration 或 reader publication 都不会自动开放 target。unknown
target、disabled config、vector mismatch 或缺失 access projection 时失败关闭。

## Evidence 与观测

search 返回有界 answer-bearing evidence 和 stable ref。脱敏 projection 可以包含 target、
history mode、search ordinal、latency、candidate/evidence count、document id 和 safe snippet。
raw query vector、source body、credential 和 backend payload 保持内部。

## 相关文档

- `agentic-retrieval.md`
- `data-plane.md`
- `../../contracts/tool-read-model.md`
- `../../decisions/adr-0075-knowledge-search.md`
