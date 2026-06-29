---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0002
status: accepted
created: 2026-03-22
updated: 2026-06-01
---
# ADR-0002 本地 MinIO 约束与迁移不变量

适用范围：`campus-agent` v2 第一阶段在暂时无法使用云对象存储时的本地替代实现

## 目标

在第一阶段使用本机部署的 `MinIO` 作为对象存储替代实现，同时确保上层 contract、bucket 语义和 object key
体系不依赖本机目录路径，避免未来迁移云对象存储时重写数据面规则。

## 决策

- 当前阶段对象存储实现为本机部署的 `MinIO`
- 上层始终按 `S3-compatible object storage` 接口接入
- 不把本机目录、挂载路径或 MinIO 内部实现细节写入 contracts
- MinIO 只是当前替代实现，不上升为长期架构绑定

## Bucket 约定

第一阶段固定至少两个 bucket：

- `campus-rag-source`
- `campus-rag-derived`

职责：

- `campus-rag-source` 保存原始 PDF、Word、Markdown、HTML 等源文件，以及与来源强绑定、只需生产一次的
  OCR/provider 响应与 source-truth 产物
- `campus-rag-derived` 保存按 collection 派生的 canonical 文档、结构化 metadata 和其他
  downstream 中间产物

第一阶段不新增第三个专门 chunk bucket；chunk 文本、向量与检索 payload 统一由 Qdrant 管理。对象存储只保留
source-truth / document artifact、小型 index release manifest 与 operations evidence；不把
chunking 后的全文 chunk dump 当作长期对象存储真相。

历史 `Free` tier 过渡期曾在 derived bucket 保存
`{corpus}/backups/{collection}/...` Qdrant snapshot bundle。ADR-0052 接受后，当前默认备份
路径改为 self-hosted Qdrant native snapshots，归档到
`/srv/backups/campus-agent/qdrant-snapshots/` 并复制到 off-host archive；staging R2 /
serving seed bucket 不保存 Qdrant `.snapshot`。

## Object Key 规范

第一阶段 object key 采用稳定层级，并把“来源资产处理阶段”和“逻辑文档产物”拆到两棵前缀树中：

- source bucket:
  - retained capture artifact: `{source_channel}/{source_asset_slug}/{year}/{raw
    _version_id}/capture/{artifact_filename}`
  - source-channel control-plane run artifact:
    `official_web/{site_id}/runs/{run_id}/{artifact_filename}`
- derived bucket:
  - document-oriented artifact: `{corpus}/documents/{collection}/{title_slug}--{
    docid8}/{revision_track}/{year}/{artifact_filename}`
  - release artifact:
    `{corpus}/releases/{collection}/{release_id}/{artifact_filename}`
  - historical qdrant backup bundle:
    `{corpus}/backups/{collection}/{release_id}/{backup_id}/{artifact_filename}`
  - operation artifact:
    `{corpus}/operations/{operation}/{run_id}/{artifact_filename}`
- source bucket 中的 source-oriented artifact:
  - provider artifact: `{source_channel}/{source_asset_slug}/{year}/{raw_version
    _id}/provider/{model_slug}/{artifact_filename}`
  - source-truth artifact: `{source_channel}/{source_asset_slug}/{year}/{raw_ver
    sion_id}/source-truth/{artifact_filename}`

在线 OCR 的 source / derived artifact 约定：

- `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/capture/{origina
  l_filename}`
- `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/provider/{model_
  slug}/provider-response.jsonl`
- `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/source-truth/lay
  out-elements.jsonl`
- `official_web/{site_id}/runs/{run_id}/crawl-run.json`
- `official_web/{site_id}/runs/{run_id}/source-truth-bundle.json`
- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year
  }/canonical.md`
- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year
  }/document-units.jsonl`
- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year
  }/reader-assets/reader.json`
- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year
  }/reader-assets/outline.json`
- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year
  }/reader-assets/meta.json`
- `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year
  }/reader-assets/asset-manifest.json`
- `{corpus}/releases/{collection}/{release_id}/validation-summary.json`
- `{corpus}/releases/{collection}/{release_id}/index-release.json`
- historical `{corpus}/backups/{collection}/{release_id}/{backup_id}/backup-manifest.json`
- historical `{corpus}/backups/{collection}/{release_id}/{backup_id}/{physical_
  collection_name}.snapshot`
- historical `{corpus}/backups/{collection}/{release_id}/{backup_id}/restore-report.json`
- `{corpus}/operations/{operation}/{run_id}/{artifact_filename}`

说明：

- raw/source layer 不按 `corpus` 组织，因为同一份 raw asset 可能服务多个 corpus；derived layer
  按长期知识域 `corpus` 组织，例如 `regulations`、`curriculum`
- source prefix 下的 source-owned artifacts 固定为
  `capture`、`provider`、`source-truth` 三类，而不是顶层 `pdf/`、`ocr/`、`source-truth/`
  三棵分裂前缀
- source prefix 下允许并保留 sibling `projection/<projection_name>/...`，用于持久化 declared
  projection artifacts；它不属于 source-truth schema 本体
- `capture/` 保存长期保留的来源快照；对于 PDF 是原始文件，对于 web 是 retained snapshot 而不是 raw HTML
- `official_web/{site_id}/runs/{run_id}/...` 保存 source-channel control-plane run
  artifacts；它们属于 source bucket truth，但不冒充 page-level canonical source-truth
- `provider-response.jsonl` 保存供应商返回的原始响应，供审计、重放和排障使用
- `layout-elements.jsonl` 保存 asset 级统一结构层，供 split、cleanup 和重放使用
- `canonical.md` 保存单篇文档的人类可读规范化表示，供展示、对照和验收使用
- `document-units.jsonl` 保存单篇文档的结构化清洗单元，供 registry、chunking 和去重使用
- `reader-assets/*` 保存单篇文档面向 reader delivery 的静态发布产物；它们属于 derived artifact，而不是
  repo tracked 前端源码
- `{corpus}/releases/{collection}/{release_id}/validation-summary.json` 保存一次
  index release 的结构性校验摘要
- `{corpus}/releases/{collection}/{release_id}/index-release.json` 保存 serving
  alias、physical collection、policy version 和文档哈希等发布元数据
- historical `{corpus}/backups/{collection}/{release_id}/{backup_id}/...` 只用于清理旧
  object-store snapshot bundle，不再是当前 backup 主路径
- 当前 self-hosted Qdrant native snapshot 的 manifest / checksum /
  restore command 固定随 filesystem bundle 一起保存，不进入 derived bucket 或 staging R2
- `provider-response.jsonl` 不得冒充 raw layer 真相源
- `title_slug--{docid8}` 负责人工定位；`version_id` 继续留在 registry / metadata
  中，不再强制单独占路径层级
- `{title_slug}` 是由文档标题归一化得到的人类可读路径段；当前 contract 允许保留
  CJK 字母数字字符，并用 `--{docid8}` 提供稳定 disambiguation。它不是 ASCII-only
  operator slug；如需未来改成 ASCII-only，必须作为 object-key migration 单独决策，
  不能把当前含中文 title 段的 regulation/student-handbook artifact 视为不合规残留。

不变量：

- source bucket 的第一层固定为 `source_channel`
- source bucket 的第二层固定为 `source_asset_slug`
- source bucket 的第三层固定为人类可读年份标签，例如 `2018`
- derived bucket 的第一层固定为长期 corpus 根名，例如 `regulations`
- source 级来源产物固定通过 source bucket 中单一 source prefix 下的 `capture/`、`provider/` 与
  `source-truth/` 保存
- 同一 source prefix 下如有持久化 projection artifact，固定放在
  `projection/{projection_name}/`
- `official_web` 的 run artifacts 固定放在 `official_web/{site_id}/runs/{run_id}/`
- derived 的逻辑文档对象固定放在 `documents/`
- release artifact 固定放在 `releases/`
- historical Qdrant snapshot backup bundle 固定放在 `backups/`
- operation artifact 固定放在 `operations/`
- 文档目录中的第三层固定为 `collection`
- 文档目录中的第四层固定为 `title_slug--{docid8}`
- 文档目录中的第五层固定为 `revision_track`
- source bucket 中 `capture` / `provider` / `source-truth` / `projection` 都位于同一份
  `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}` 来源前缀下
- 文档目录中的第六层固定为人类可读版本标签，例如 `2018`
- historical `backups/` 前缀中的第三层固定为 `collection`
- historical `backups/` 前缀中的第四层固定为 `release_id`
- historical `backups/` 前缀中的第五层固定为 `backup_id`
- `operations/` 前缀中的第三层固定为 `operation`
- `operations/` 前缀中的第四层固定为 `run_id`
- object key 中不直接编码短期来源名、兼容层术语或一次性版本层级，例如 `tracks/`、`editions/`、`v1/`
- raw / processed 层级语义由 bucket 表达，不在 key 内重复编码

禁止做法：

- 不以临时文件名作为 object key 主标识
- 不把主机路径写进 object key
- 不把 chunk 顺序直接当作 document identity
- 不把 raw 文件身份绑到 `document_id/version_id`
- 不允许同一份 raw PDF 因为多个逻辑文档而在 raw bucket 重复保存

## 元数据与 Registry 对齐

以下字段不依赖 object key 推断，必须在 document registry 中显式存在：

- `document_id`
- `revision_track`
- `version_id`
- `source_uri`
- `content_hash`
- `corpus`
- `collection`
- `visibility_level`
- `visibility_scope`
- `entitlement_groups`
- `policy_projection_version`
- `status`
- `ingestion_timestamp`
- `parser_version`
- `embedding_model`
- `source_channel`
- `published_year`
- `effective_year`
- `is_current`
- `raw_asset.raw_asset_id`
- `raw_asset.raw_version_id`
- `raw_asset.page_start`
- `raw_asset.page_end`

补充说明：

- 当前 document registry 显式保存 `visibility_level` / `visibility_scope` /
  `entitlement_groups` / `policy_projection_version`
- 这组字段的语义是 retrieval pre-filter projection carrier，不是长期 canonical authorization
  truth
- 长期授权词汇与 projection vocabulary 以 `ADR-0022` 和
  `docs/architecture/system/identity-authz.md` 为准

以下字段必须在 raw asset registry 中显式存在：

- `raw_asset_id`
- `raw_version_id`
- `raw_source_uri`
- `content_hash`
- `source_filename`
- `object_key`

换句话说：

- object storage 负责承载文件
- raw asset registry 负责承载 raw 文件级真相元数据
- document registry 负责承载逻辑文档级真相元数据
- 不允许把 MinIO bucket/object 命名当成 registry 的替代品

## 部署约束

第一阶段的 MinIO 约束如下：

- 只作为本机对象存储服务使用
- 不退化成直接写宿主机目录
- 通过标准 S3 endpoint、access key、secret key 接入
- bucket 创建和权限初始化由部署脚本或运维步骤完成，不由业务代码隐式创建

## 迁移不变量

未来从本机 MinIO 迁移到云对象存储时，以下内容必须保持不变：

- bucket 语义
- object key 结构
- `source_uri` 生成规则
- document registry 字段
- raw asset registry 字段
- ingestion / retrieval contract
- raw / processed 分层

允许变化的内容：

- endpoint
- credentials
- 生命周期策略
- 备份/容灾策略
- provider-specific IAM 配置

补充说明：

- `source_uri` 不要求等于外部官网 URL。
- 当正式来源只有 raw asset（例如一份 master PDF）时，`source_uri` 应表示 document registry
  可稳定回链的内部 canonical locator。
- `curriculum_plan` 的 split manifest 只提供 page range truth；其 `source_uri` 由
  ingestion 基于 `raw_asset_id`、`raw_version_id`、`page_start`、`page_end` 派生。

## 第一阶段明确不做

- 不支持直接从本机目录读取作为正式真相源
- 不支持绕过 MinIO 直接落 raw/processed 文件
- 不把 MinIO 管理控制台配置写进架构 contract
- 不为未来云厂商对象存储预留多套 key 规范
