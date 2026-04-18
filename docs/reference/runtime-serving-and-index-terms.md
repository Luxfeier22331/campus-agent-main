---
doc_type: reference
status: active
created: 2026-03-28
updated: 2026-04-10
---

# Runtime Serving And Index Terms

## 文档边界

这份文档只负责解释当前运行面里最容易被混用的 serving / indexing 术语。

- 不重复长期 package 边界：`docs/architecture/target-architecture.md`
- 不重复数据平面全景：`docs/architecture/data-plane-architecture.md`
- 不重复对象存储 key 约束：`docs/decisions/adr-0002-local-minio-conventions.md`
- 不重复旧 physical collection retention 决策：`docs/decisions/adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- 不重复 Qdrant Cloud 备份 / 恢复策略：`docs/decisions/adr-0020-qdrant-cloud-backup-restore-and-object-store-transition.md`
- 不承担当前执行状态真相：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`
- 早期 `phase-1` 文档只作为历史背景或约束来源，不再单独承担当前 phase truth

## 术语

### Corpus / Collection Scope

定义：

- retrieval/runtime 侧被显式命名和发布的 `corpus/collection` 边界

真相源：

- `configs/ingestion/<corpus>/<collection>/runtime-profile.json`
- `configs/ingestion/<corpus>/<collection>/README.md`
- `.planning/PROJECT.md`

说明：

- `source channel` 不等于 `corpus/collection`
- 同一个 source channel 可以 fan-out 到多个 `corpus/collection` scope
- `official_web` 作为 source channel，不表示它只能有一个 mixed collection
- `official_web` 未来应拆成独立 serving scope，例如 `official_web/stable_reference`、`official_web/fresh_news`、`official_web/news_archive`
- 正式规章与正式培养方案若已有更强语义 owner，应继续进入与 `official_web` 并列的 `regulations/*`、`curriculum/*`

### Source-Triage Collection / Semantic-Owner Collection

定义：

- `source-triage collection`
  - 主要承接某个 source channel 的 replay、wrapper document、attachment outcome、manual-review truth 与 provenance
- `semantic-owner collection`
  - 只承接某个知识域下可独立消费的 canonical 文档正文

说明：

- 这两个角色可以都存在于同一个 data plane，但它们不是同一层
- `campus_notices/internal_notice` 属于 source-triage collection
- `regulations/*`、`curriculum/*` 属于 semantic-owner collection
- 某条 notice 可以成为 semantic-owner collection 的 provenance，但 notice 包装文本本身不应因此自动成为 regulation member

### Query-Enabled Scope

定义：

- 当前允许进入 query-serving 主链路的 `corpus/collection` 范围

真相源：

- `configs/ingestion/<corpus>/<collection>/runtime-profile.json`
- `.planning/PROJECT.md`
- `.planning/legacy-flat/REQUIREMENTS.md`

说明：

- 当前 query-enabled scope 是 `regulations/student_handbook` 与 `curriculum/curriculum_plan`
- `campus_services/*` 当前仍是 `offline_preparation`
- 当前 `official_web/muc_public_pages` 也是 `offline_preparation` 的 mixed bridge，不应误读成长期最终 serving scope

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

### Chunk Preparation

定义：

- 某个 collection 在 document truth 之后、index release 之前执行的一次 `split -> cleanup -> chunk -> validation` 离线准备动作

说明：

- `chunk preparation` 不产生 embedding，不写 Qdrant，不发布 serving alias
- `chunk preparation` 产生的是 preparation truth，不是 release truth
- 某些 `offline_preparation` collection 可以把 verified chunk preparation 作为 release gate

### Chunk Preparation Manifest

定义：

- 一次 chunk preparation 的小型追溯产物

对象存储位置：

- `{corpus}/operations/registry-scope-chunk-preparation/{preparation_run_id}/{collection}/chunk-preparation.json`
- `{corpus}/operations/registry-scope-chunk-preparation/{preparation_run_id}/{collection}/validation-summary.json`
- `{corpus}/operations/registry-scope-chunk-preparation/{preparation_run_id}/{collection}/document-reports.jsonl`

说明：

- manifest 用于把 preparation 结果和 current registry scope 对齐
- manifest 是 release gate 的输入，不是最终在线索引的替代物

### Index Release

定义：

- 一次完整的 `embedding -> indexing -> alias publish` 发布动作；对 preparation-gated scope，它发生在 verified chunk preparation 之后

说明：

- 一个 index release 对应一个 `release_id`
- 一个 release 会生成新的 physical collection，并在校验通过后发布 serving alias
- `index release` 可以依赖既有 chunk truth，但不应隐式承担 collection-specific chunk preparation 的 operator 语义

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
- source channel、corpus、collection、serving surface 是不同层；命名相近不表示必须一一对应
- source-triage collection 与 semantic-owner collection 也是不同层；不得把 wrapper notice collection 冒充成 regulation corpus
- physical collection 由 index release 生成，不由 env 或手写固定 collection 名直接指定
- 已进入 release-managed lifecycle 的 collection 不论当前是 `query_serving` 还是 `offline_preparation`，都应使用稳定 alias + versioned physical collection
- preparation-gated scope 必须先拿到 verified chunk preparation，再进入 index release
- 旧 physical collection 默认先进入 `current / previous / migration_baseline / archive_candidate` 角色判断，再决定是否删除；不允许仅按年龄直接删除
- 对象存储保留 source/document artifact、release manifest，以及 `Free` tier 过渡期的 snapshot backup bundle
- chunk preparation artifacts 落在 operations prefix，不落在 release prefix
- Qdrant 承载 chunk 文本、向量与检索 payload

## 易错点

- 不要把 serving alias 和 physical collection 混为一谈
- 不要把 chunk preparation manifest 误读成 index release manifest
- 不要把“文档历史版本必须保留”误读成“所有历史 physical collection 必须永久留在 Qdrant Cloud”
- 不要把 release manifest 当成 chunk store
- 不要把 snapshot backup bundle 误读成新的在线 query store
- 不要把早期 phase 文档中的固定 collection 或 handbook-only 叙事继续当作当前 truth
