# Agent Note: RAG payload index lifecycle

Status: implemented

## 背景

统一 Campus RAG collection 同时承载 Docs 和 Notices。检索 scope 使用 `source_kind`、`version_slug`、`is_current`、`corpus` 和入学年份范围进行 Qdrant payload 过滤；`document_id` 只用于结果返回和一致性校验。

collection 原先在首次写入 points 前同步创建全部 payload indexes。Qdrant 在空 collection 上首次写入时会集中构建这些索引，本地 11 个 fixture points 已复现 60 秒 `wait_timeout`。

## 决策

- payload index 合同只保留当前检索实际使用的六个字段；不为 `document_id` 建立 filter index。
- publisher 将创建 collection、写入 points、创建 payload indexes、验证和激活分为独立阶段。
- payload index 创建使用同步等待；未完成的 Qdrant operation 不进入验证或 current index 激活。
- Docs 与 Notices 继续共用 collection，以保持统一的 dense+sparse 混合检索和排序。
- TS publisher 与 Go query 通过共享 fixture 校验字段集合和类型，避免独立硬编码发生漂移。

## 未采用方案

- 不删除全部 payload indexes；六个字段都有当前检索 scope 的实际过滤消费者。
- 不继续在首次写入前创建全部 indexes；本地已复现该顺序触发 Qdrant 等待超时。
- 不把 Docs 和 Notices 拆成两个 collection；当前统一结果集需要共同执行 dense+sparse 融合和排序。
- 不只提高 Qdrant timeout；这会延长失败时间而保留错误的构建顺序。

## 后果

首次写入不再触发多个空索引的集中重建，候选 collection 可以在完整索引和校验完成后激活。索引定义变化会改变 collection identity，沿用候选 collection 发布和原子 pointer 激活流程，不原地修改已激活 collection。
