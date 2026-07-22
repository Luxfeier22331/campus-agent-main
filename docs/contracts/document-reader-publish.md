---
doc_type: contract
owner_boundary: docs/contracts
status: active
---

# 文档阅读器发布合同

## 边界

本文定义 Campus Docs 阅读投影在发布任务、App API 和 Campus Web 之间必须保持的版本一致性。
来源数据、阅读模型、命令和环境部署分别由所属数据文档、模块 README 和环境仓维护。

## 可执行合同

发布格式由以下 schema 定义：

- `campus-docs-app-projection.v1.schema.json`：发布任务的已验收输入；
- `campus-docs-release-manifest.v1.schema.json`：静态构建与数据库物化共享的 manifest；
- `campus-docs-release-ref.v1.schema.json`：跨步骤传递的 release identity。

schema 和实现是字段、排序及校验规则的唯一来源。人类文档不维护这些字段的副本。

## 内容寻址

每次发布生成 canonical manifest，并用其精确字节的 SHA-256 作为 `releaseId`。manifest、投影和
阅读资产均按内容寻址保存，只允许创建或核对已有对象，不允许覆盖对象或维护 `latest` 指针。

同一 `releaseId` 必须在下列位置表示同一组内容：

1. 对象存储中的 release manifest 与引用资产；
2. App API 的 release-scoped 阅读投影；
3. Campus Web Worker 中构建的公开与受限静态资产。

对象缺失、摘要不一致或投影无法完整物化时，发布失败，不得猜测最新版本或静默回退。

## App API 请求

Campus Web Worker 对文档 API 请求注入 `x-campus-docs-release`，其值必须是本次 Worker 构建使用
的 `releaseId`。浏览器提供的同名 header 必须丢弃；App API 只读取该 release 的投影，缺少或
收到非法 release identity 时返回 `503 docs_release_unavailable`。

App API 不创建、发布或选择文档 release。浏览器、Campus Web 构建和发布任务不得把 App API
数据库反向当作规范文档来源。

## Worker 与文档版本

Campus Web 候选物必须同时记录完整源码提交、`docsReleaseId` 和由两者派生的构建标识，并把
`DOCS_RELEASE_ID` 固化为该不可变 Worker version 的绑定。环境仓只选择 Worker version；不得再维护
独立的文档 release 指针，否则两份环境选择可能漂移。

发布新候选物时，默认继承环境仓当前选择的 Worker version 中的 `DOCS_RELEASE_ID`；显式发布新的
文档 release 时可以指定新的内容寻址标识。回滚只需选择原 Worker version，其中已经包含匹配的
文档 release。历史 release 可以按保留策略并存，但清理前必须确认没有 Worker version 或有效回滚
记录仍在引用。

## 操作入口

- 发布、核对和物化命令：`jobs/docs-publish/README.md`；
- Campus Web 构建入口：`apps/campus-web/README.md`；
- 环境选择和发布步骤：`docs/runbooks/release.md`。

## 相关文档

- [文档站架构](../architecture/system/document-site.md)
- [App API 文档接口](./app-api/document-reader.md)
- [文档阅读器数据模型](../data/document-reader.md)
- [运行时发布](../architecture/system/runtime-release.md)
