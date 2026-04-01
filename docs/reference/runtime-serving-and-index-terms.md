---
doc_type: reference
status: active
created: 2026-03-28
updated: 2026-03-31
---

# Runtime Serving And Index Terms

## 文档边界

这份文档只负责解释当前运行面里最容易被混用的 serving / indexing 术语。

- 不重复长期 package 边界：`docs/architecture/long-term-architecture.md`
- 不重复数据平面全景：`docs/architecture/phase1-ingestion-and-storage-architecture.md`
- 不重复对象存储 key 约束：`docs/decisions/adr-0002-local-minio-conventions.md`
- 不重复旧 physical collection retention 决策：`docs/decisions/adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- 不重复 Qdrant Cloud 备份 / 恢复策略：`docs/decisions/adr-0020-qdrant-cloud-backup-restore-and-object-store-transition.md`
- 不承担当前执行状态真相：`.planning/PROJECT.md`、`.planning/STATE.md`
- 早期 `phase-1` 文档只作为历史背景或约束来源，不再单独承担当前 phase truth

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

### Physical Collection Retention Role

定义：

- physical collection 在过期/清理策略里的保护角色

当前角色：

- `current`
  - alias 当前指向的 physical collection
- `previous`
  - 最新一次已发布 release 的热回滚位
- `migration_baseline`
  - 在 schema/model/policy/retrieval shape 迁移时额外保留的迁移前基线
- `archive_candidate`
  - 已脱离上述保护角色、可进入清理评估的旧 physical collection

说明：

- retention 采用 role-based policy，而不是 time-only deletion
- 删除门禁以 ADR-0019 和 operator runbook 为准

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

### Managed Backup

定义：

- `Qdrant Cloud Standard` 中由 dashboard 配置的 automatic backups

说明：

- managed backup 是 cluster-level 恢复覆盖，不是对象存储里的导出文件
- 在 `Standard` 环境里，它是旧 collection 清理与灾难恢复的默认 backup 主路径

### Snapshot Backup Bundle

定义：

- 当前 `Free` tier 过渡期在对象存储里保存的一组 Qdrant collection 备份材料

对象存储位置：

- `{corpus}/backups/{collection}/{release_id}/{backup_id}/backup-manifest.json`
- `{corpus}/backups/{collection}/{release_id}/{backup_id}/{physical_collection_name}.snapshot`
- `{corpus}/backups/{collection}/{release_id}/{backup_id}/restore-report.json`

说明：

- snapshot bundle 至少包含 snapshot 文件和 `backup-manifest.json`
- 因为 collection snapshot 不包含 aliases，`backup-manifest.json` 必须记录 `alias_bindings`
- snapshot bundle 是恢复材料，不是在线 chunk truth

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
- 旧 physical collection 默认先进入 `current / previous / migration_baseline / archive_candidate` 角色判断，再决定是否删除；不允许仅按年龄直接删除
- 对象存储保留 source/document artifact、release manifest，以及 `Free` tier 过渡期的 snapshot backup bundle
- Qdrant 承载 chunk 文本、向量与检索 payload

## 易错点

- 不要把 serving alias 和 physical collection 混为一谈
- 不要把“文档历史版本必须保留”误读成“所有历史 physical collection 必须永久留在 Qdrant Cloud”
- 不要把 release manifest 当成 chunk store
- 不要把 snapshot backup bundle 误读成新的在线 query store
- 不要把早期 phase 文档中的固定 collection 或 handbook-only 叙事继续当作当前 truth
