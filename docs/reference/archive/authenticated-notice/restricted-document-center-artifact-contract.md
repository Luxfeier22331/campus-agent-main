---
doc_type: reference
truth_scope: data
owner_boundary: domains/authenticated-notice
status: historical
created: 2026-04-15
updated: 2026-06-12
---
# Restricted Document Center Artifact Contract

## Historical Scope

本文不再是 active target contract。它记录的是曾经围绕 restricted document center /
attachment library 的 artifact 分层设计；当前 Campus Assistant 主问答产品不包含受限文档中心、内部文件下载站、
学生 / 教职工差异化文档权限或 approval-style 文档访问。

当前仍可复用的内容只限于 artifact 分层教训：

- `original`、`normalized_readable`、`semantic_document` 不能混成同一资源层。
- source-native original、readable projection 与 semantic-owner collection
  promotion 必须保留 provenance 与 identity 分离。
- `regulations/*` 不能被当作附件库、下载站或任意清洗文本的默认 query corpus。

本文不得再用于证明 restricted document center 是当前 planned product surface，也不得用于要求主问答链路实现
visibility / entitlement / owner_scope 文档权限投影。若未来重新提出文档中心，应另起 active
contract。

## 文档边界

本文仅历史记录“采集并清洗还原的受限文档，可同时服务附件库 / 文档站与 semantic
collection”这一旧设计。它不再冻结 active repo-tracked artifact contract。

它回答的是：

- `original`、`normalized_readable`、`semantic_document` 三类 artifact 分别是什么
- 它们在对象存储与 registry 中应如何分层
- 当前阶段 document center 推荐采用什么最小权限模型
- “副产物进入文档站”在 repo 里应如何收口成正式链路

它不负责：

- 当前是否已经实现完整 document center product surface
- 最终 UI、operator workflow 或搜索交互细节
- 某个具体 collection 何时开放 query-serving
- 具体 code path 已经实现到哪一步

## Contract 姿态

这份 contract 记录的是 historical target，而不是当前 approved target，也不是“当前 merged
truth 已全部实现”的状态板。

它的历史作用是：

- 记录 `original / normalized_readable / semantic_document` 的分层边界
- 说明为什么不能把清洗结果临时拼接成没有 owner 分层的附件库
- 为未来如重新提出 document center 时提供历史参考，而不是直接提供 active target

如果需要判断当前实现进度，应转到：

- `../architecture/current.md`
- `../architecture/product.md`
- `../architecture/system/identity-and-authorization-architecture.md`
- `../architecture/system/memory-plane-architecture.md`
- `../../.planning/PROJECT.md`
- `../../.planning/WORKSTREAMS.md`

## 历史核心结论

对曾经设计过的 restricted institutional document sources，历史 fan-out 形态拆为三类
artifact：

1. `original`
1. `normalized_readable`
1. `semantic_document`

三者可以共享 provenance，但不能混成同一资源层。

该旧设计中的 canonical chain 表达为：

`raw asset -> provider output -> source truth -> declared projections ->
canonical document artifacts -> document-units -> chunks -> index`

在旧 document center 语境下，解释为：

- `original` 属于 raw/source/provenance/download layer
- `normalized_readable` 属于 document-center readable projection
- `semantic_document` 属于 semantic-owner collection projection

## Artifact Families

### 1. `original`

`original` 表示 source-native 原件资源。

第一阶段至少包括：

- authenticated notice attachment source file
- `file_release` released original file

它的职责固定为：

- 持有原始 bytes
- 持有 source-native filename / mime / sha256 / object key
- 持有 source provenance
- 支撑 download / audit / replay

它不是：

- semantic regulation text
- 面向用户的最终阅读视图
- retrieval answer truth

固定 owner：

- raw asset registry + source-truth relation truth

### 2. `normalized_readable`

`normalized_readable` 表示从 `original` 或 source-truth 推导出的可读 projection。

典型输入包括：

- native Office text extraction
- PDF/cloud OCR + layout parsing
- repo-owned cleanup / normalization / structure repair

它的职责固定为：

- 提供文档站预览
- 提供 metadata search / text preview 的基础文本
- 提供比 original 更稳定的“人类可读”形态

它不是：

- original file truth
- semantic-owner canonical regulation truth
- release / alias publish 的默认 query corpus

固定要求：

- 必须显式指回 `original`
- 必须带 derivation policy / extraction policy version
- 可因 OCR policy、cleanup policy 变化而重建

### 3. `semantic_document`

`semantic_document` 表示从 owner text 恢复出的 canonical semantic document。

例如：

- `regulations/institutional_rules` 中的制度正文
- 后续可能存在的 handbook / procedure / scoped-rule semantic collection

它的职责固定为：

- 承载 semantic-owner text
- 承载 collection-specific document identity / version identity
- 承载后续 chunk / retrieval / release truth

它不是：

- 下载原件
- 附件库目录页
- 任何“只因可读就可被 promote”的附件文本

## Registry 分层

### Raw Asset Registry

`raw asset registry` 固定持有 `original` truth。

至少包括：

- source-native identity
- source-native object key
- sha256 / mime / byte_size
- source channel / source surface
- capture provenance

对 document center 来说，`raw asset registry` 继续是：

- original file access truth 的底层锚点

而不是：

- normalized readable 或 semantic document 的主 registry

### Document-Center Registry Scope

`normalized_readable` 应进入独立的 document-center registry scope。

这层是：

- document-center readable projection truth

它不是：

- raw asset registry
- semantic collection registry

当前 repo 级 contract 先冻结这个 scope 的语义，不强行提前冻结最终 collection 名。

固定要求：

- 与 semantic collections 分 scope 管理
- 与 raw asset registry 分 owner 语义
- 当前即使保持 `offline_preparation`，也应作为正式 projection 看待，而不是临时缓存目录

### Semantic Collection Registry Scope

`semantic_document` 继续进入各自的 semantic collection scope，例如：

- `regulations/institutional_rules`
- `regulations/scoped_rules`

固定要求：

- `semantic_document` 的 `document_id/version_id` 不得复用 `original` resource
  identity
- source notice / attachment / file_release provenance 继续显式保留

## Identity 规则

### `original` object-store layout

`original` 的稳定 identity 必须 anchored 在 source-native resource 上。

推荐输入：

- `source_channel`
- `source_surface`
- source-native relation key
- content `sha256`

第一阶段典型形态：

- attachment-backed
  - `attachment_ref_id + sha256`
- file-release-backed
  - `file_release_id + sha256`

固定禁止：

- 用 semantic `document_id` 充当 original identity
- 用 `notice_id` 单独充当 original identity

### `normalized_readable` object-store layout

`normalized_readable` 的资源身份固定与 `original` 对齐，但版本必须额外区分 derivation policy。

推荐输入：

- `original_resource_id`
- `original_content_sha256`
- `extraction_policy_version`
- `cleanup_policy_version`

直接含义：

- 同一原件在 OCR/cleanup policy 升级后，可以生成新的 readable version
- 但它仍然属于同一 original resource family

### `semantic_document` object-store layout

`semantic_document` 继续使用 collection-owned `document_id/version_id`。

固定规则：

- 共享 provenance
- 不共享 identity

## 对象存储组织

### `original`

`original` 继续保留在 source bucket / source-channel capture prefix。

例如：

- authenticated notice attachment
  - `authenticated_notice_portal/.../capture/<filename>`
- `file_release`
  - `authenticated_notice_portal/file-release-{id}/{year}/sha256-{digest}/captur
    e/<filename>`

固定规则：

- document center 不重复定义 original bytes 的 canonical object key
- 若后续需要 CDN / download token / preview proxy，那是访问层动作，不改写 original object
  identity

### `normalized_readable`

`normalized_readable` 的 approved target prefix 固定建议为：

`document_center/resources/<resource_family>/<stable_resource_key>/<revision_tra
ck>/<year>/`

第一阶段推荐 artifact 集合：

- `resource-manifest.json`
- `normalized-readable.md`
- `readable-units.jsonl`
- `preview.html`
- `layout-elements.jsonl`

其中：

- `resource-manifest.json` 持有 original back-link、policy version、authz
  projection、artifact refs
- `normalized-readable.md` 持有对用户展示的 markdown/text-readable body
- `readable-units.jsonl` 持有文档站内部结构单元，不直接等于 retrieval chunk
- `preview.html` 可选；用于更接近原版面的阅读视图
- `layout-elements.jsonl` 只在 OCR/layout lane 下出现；保留 provider-structure truth

固定禁止：

- 用 `canonical.md` 命名 document-center readable artifact，避免与 semantic document 混层
- 直接把 retrieval chunk 当 `normalized_readable`

### `semantic_document`

`semantic_document` 继续沿用各 semantic collection 的 object-store layout。

例如当前 regulation lane：

- `<corpus>/documents/<collection>/.../canonical.md`
- `<corpus>/documents/<collection>/.../document-units.jsonl`

## Manifest / Registry 最小字段

### `normalized_readable` manifest / registry

最小字段固定包括：

- `resource_id`
- `resource_version_id`
- `resource_family`
- `resource_kind`
- `source_channel`
- `source_surface`
- `source_notice_ids`
- `source_notice_document_ids`
- `source_attachment_ref_id`
- `source_attachment_sha256`
- `source_file_release_id`
- `original_bucket`
- `original_object_key`
- `normalized_readable_object_keys`
- `extraction_policy_version`
- `cleanup_policy_version`
- `readable_status`

其中 `readable_status` 第一版允许：

- `materialized`
- `reference_only`
- `pending_machine_processing`
- `no_adoption`
- `no_extractable_text`

### `semantic_document` provenance

如该资源后续被 promote 为 semantic document，必须继续保留：

- `semantic_owner_kind`
- `source_notice_ids`
- `source_attachment_ref_id`
- `source_attachment_sha256`
- `source_file_release_id`
- `original_resource_id`
- `normalized_readable_resource_id`

## 历史最小权限模型

以下内容是历史 document-center 设计的一部分，不再是当前 Campus Assistant 主问答产品目标。

该旧设计中的产品姿态曾固定为：

- institution-scoped

因此，对当前 document center / attachment library，权限模型固定先收口成最小形态：

- `visibility_level`
- `owner_scope`

其中：

- `visibility_level`
  - `public`
  - `restricted`
- `owner_scope`
  - 默认为 `null`
  - 只在 owner-bound 资源中启用，例如私有上传、草稿、审批中材料、operator 私有工作流资源

固定解释：

- 对当前阶段来说，绝大多数 document center 资源只需要 `public/restricted`
- `restricted` 当前语义固定为“已认证且通过 app-owned 校内授权的 principal 可见”
- canonical authz truth 继续由 `app-api` 拥有
- retrieval / metadata search / download path 只消费最小化投影，不自行解释最终授权

### `resource_family` 不是权限层

`resource_family` 仍然必须存在，但它只表达资源分层，不表达权限层级。

第一阶段至少包括：

- `original`
- `normalized_readable`
- `semantic_document`

它的用途是：

- 区分下载原件、阅读视图和语义文档
- 为后续 object-store / registry / UI rendering 提供稳定分层

它不是：

- 权限字段

### 当前不引入的权限字段

以下字段当前不作为 document center 的主推荐设计：

- `entitlement_groups`
- `visibility_scope`
- `tenant_scope`
- 额外抽象的 `access_policy`

原因：

- 当前产品仍是单机构 `institution-scoped`
- 当前还没有稳定、大量并存的学生专属 / 教师专属 / 部门专属文档站权限面
- 如果提前把这些字段做成一等主模型，只会制造空值和假复杂度

固定禁止：

- 把“适用对象”直接写成 visibility truth
- 因为系统已登录就默认开放全部 original/download
- 让 retrieval / document center 自行解释最终授权结论

### 未来扩展条件

只有在出现真实、稳定的权限需求时，才允许扩展：

- 若出现稳定的 `students` / `staff` / `faculty` 分流
  - 再补 `entitlement_groups`
- 若出现真实的校区 / 单位可见性边界
  - 再补 `visibility_scope`
- 若进入跨机构或 federation
  - 再补 `tenant_scope`

在这些需求出现之前，该旧 target 固定保持最小模型。当前主问答产品不继承这个
document-center permission model。

## 与现有链路的关系

对当前 authenticated notice / file release 链路，正式形态应理解为：

- `notice` / `file_release` 提供 source relation 与 provenance
- `original` 提供原件 bytes 与下载锚点
- `normalized_readable` 提供文档站阅读视图与 metadata search 文本
- `semantic_document` 只在 semantic owner 已恢复时进入 `regulations/*` 或其他 semantic
  collection

因此：

- 清洗还原结果可以成为附件库 / 文档站的正式副产物
- 但它必须作为独立 projection 落盘
- 不能直接把现有 regulation chunk / canonical markdown 临时挪作文档站正文

## 非目标

- 不在本文冻结最终 document-center UI 路由
- 不在本文宣称 current merged truth 已有可查询 document-center collection
- 不在本文把跨学校 federation / generic SaaS tenant 当作当前 requirement
- 不在本文要求所有 originals 都必须自动产生 readable projection

## Related Docs

- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization
  .md`
- `docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`
- `docs/decisions/adr-0041-authenticated-document-center-and-regulation-layer-sp
  lit.md`
- `docs/reference/authenticated-notice-file-release-export-contract.md`
