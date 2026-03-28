---
doc_type: architecture
status: active
created: 2026-03-28
updated: 2026-03-28
---

# Runtime Serving And Index Terms

## 文档边界

这份文档只负责冻结当前运行面里最容易被混用的 serving / indexing 术语。

- 不重复长期 package 边界：`docs/architecture/long-term-architecture.md`
- 不重复数据平面全景：`docs/architecture/phase1-ingestion-and-storage-architecture.md`
- 不重复对象存储 key 约束：`docs/decisions/adr-0002-local-minio-conventions.md`
- 不承担当前执行状态真相：`.planning/PROJECT.md`、`.planning/STATE.md`

## 术语

### Query-Enabled Scope

定义：

- 当前允许进入 query-serving 主链路的 `corpus/collection` 范围

真相源：

- `configs/ingestion/<corpus>/<collection>/runtime-profile.json`
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`

说明：

- 当前 query-enabled scope 是 `regulations/student_handbook` 与 `curriculum/curriculum_plan`
- `campus_services/*` 当前仍是 `offline_preparation`

### Serving Alias

定义：

- release-managed collection 在 Qdrant 中暴露的稳定 collection 别名

真相源：

- runtime profile 中的 `qdrant_alias_name`

说明：

- serving alias 是 runtime-facing 稳定句柄，不等于某次具体发布生成的 physical collection
- query-serving collection 必须通过 serving alias 暴露
- `offline_preparation` collection 只要已经纳入 release-managed lifecycle，也应提前通过 serving alias 暴露，避免后续上线时再做一次 collection rename / alias 迁移
- retrieval 默认只读取 serving alias，不直接绑定某次离线发布生成的 physical collection 名称

### Collection Prefix

定义：

- 某个 `corpus/collection` 在离线索引发布时用于生成 physical collection 名称的稳定前缀

真相源：

- runtime profile 中的 `qdrant_collection_prefix`

### Physical Collection

定义：

- 某次具体 index release 在 Qdrant 中实际写入的版本化 collection

命名：

- `<collection_prefix>__<release_id>`

说明：

- physical collection 是离线发布产物，不是运行时稳定接口
- serving alias 可以在多个 physical collection 之间切换

### Index Release

定义：

- 一次完整的 `chunking -> embedding -> indexing -> alias publish` 发布动作

说明：

- 一个 index release 对应一个 `release_id`
- 一个 release 会生成新的 physical collection，并在校验通过后发布 serving alias

### Release Manifest

定义：

- 一次 index release 的小型追溯产物

对象存储位置：

- `{corpus}/releases/{collection}/{release_id}/index-release.json`
- `{corpus}/releases/{collection}/{release_id}/validation-summary.json`

说明：

- release manifest 用于审计、回滚和追溯
- release manifest 不保存 chunk dump

### Source Truth

定义：

- provider 私有响应之后、document projection 之前的 canonical rebuild boundary

说明：

- source truth 是后续 document build、chunking 和 replay 的上游真相
- source truth 进入对象存储；chunk dump 不进入对象存储

## 当前约束

- runtime profile 声明 serving alias、collection prefix 和 vector binding
- physical collection 由 index release 生成，不由 env 或手写固定 collection 名直接指定
- 已进入 release-managed lifecycle 的 collection 不论当前是 `query_serving` 还是 `offline_preparation`，都应使用稳定 alias + versioned physical collection
- 对象存储只保留 source/document artifact 与 release manifest
- Qdrant 承载 chunk 文本、向量与检索 payload

## 易错点

- 不要把 serving alias 和 physical collection 混为一谈
- 不要把 release manifest 当成 chunk store
- 不要把早期 phase 文档中的固定 collection 或 handbook-only 叙事继续当作当前 truth
