---
doc_type: decision
decision_id: ADR-0041
status: accepted
created: 2026-04-14
updated: 2026-04-14
---

# ADR-0041 Authenticated Document Center And Regulation Layer Split

## 状态

Accepted on 2026-04-14.

## 背景

`authenticated_notice_portal` 这条 source channel 目前已经冻结了几条关键边界：

- `notice`、`attachment`、`regulation` 不是同一层资源
- `campus_notices/internal_notice` 是 source-triage collection，不是 regulation owner
- `regulations/institutional_regulations` 只接可独立消费的 canonical regulation text
- `file_release` 可以成为 regulation owner body 的来源层，但不能伪装成 `notice`

但在实际样本里，还存在大量“有价值、但不应进入 regulation”的受限文档：

- 科研项目申报操作手册
- 科研项目中检操作手册
- 科研项目结项操作手册
- 中央民族大学网上报账系统使用手册
- 中央民族大学财务事项你问我答
- 各类申报表、汇总表、审批单、联系方式表
- 门户文件发布页中的 released originals

这些内容对已认证用户仍然有价值，但它们的价值主要是：

- 下载原件
- 查看元数据与来源关系
- 作为操作参考、填报参考、过程参考

而不是：

- 冒充学校 formal regulation corpus

如果不把这层边界冻结清楚，后续实现很容易继续混淆：

- 把原始附件库误当成 regulation collection
- 把 wrapper notice 的正文或附件目录页误当成 canonical semantic owner
- 让 document download/access truth 倒挂到 retrieval corpus
- 把“已认证用户可下载”偷换成“应该进入 regulation/RAG 语义层”

## 决策

### 决策 1：`regulations/*` 继续只承接 semantic-owner canonical text

`regulations/*` 的职责保持不变：

- 只承接可独立消费的制度正文
- 只承接已经恢复出 semantic owner 的 canonical text
- 继续显式保留 `source_notice_*`、`source_attachment_*`、`semantic_owner_*` provenance

固定不承接：

- wrapper notice
- 原始附件目录
- 申报表、汇总表、审批单
- 操作手册、流程手册、FAQ、联系方式表
- file-release 列表页或 released original 的 capture row

补充判断：

- 即使 attachment 标题中出现 `办法`、`实施办法`、`指导意见`
- 也只有在它确实是当前学校 semantic owner 的 canonical text 时，才允许进入 `regulations/*`
- 外部机构奖项申报办法、提名手册、项目操作手册，不因标题像制度就进入 `regulations/institutional_regulations`

### 决策 2：已认证用户的“附件库 / 文档站”应作为独立资源层存在

repo 级长期正确形态允许存在独立的 restricted product surface，用于承接：

- 原始附件对象
- `file_release` released originals
- 操作手册、模板、表格、FAQ、通知附件 PDF/Office 原件
- 与这些原件相关的下载链接、hash、来源 notice / file_release provenance 与最小元数据

这层资源的推荐语义名为：

- authenticated document center

它可以包含：

- attachment library
- released originals catalog
- restricted metadata search

它不是：

- `regulations/*` 的别名
- `campus_notices/internal_notice` 的 query-serving 替代品
- 原始附件直接暴露给 RAG 的捷径

### 决策 3：document center 持有 original-access truth，retrieval/regulation 只消费投影

这层的长期 owner 语义固定为：

- original file access / download truth
- source provenance truth
- resource-level metadata truth

而不是：

- regulation semantic truth
- retrieval answer truth

固定方向：

- `notice/file_release -> document center/originals`
- `notice/attachment/file_release -> semantic owner recovery -> regulations/*`
- `document center -> retrieval/regulation` 只通过显式 projection / metadata / owner recovery 消费

固定禁止：

- 让 `regulations/*` 反向充当 original file access truth
- 让 retrieval corpus 反向充当附件下载站
- 用 regulation collection 直接承载各类模板、表格、FAQ 原件

### 决策 4：document center 必须按受限资源 fail-close 开放

如果未来为已认证用户开放 document center，长期姿态固定为：

- restricted
- fail-close
- deny-by-default
- per-resource authorization projection

固定要求：

- 是否可见、是否可下载，仍由 app-owned authz truth 决定
- `app-api` 继续是 canonical auth / entitlement owner
- retrieval / metadata search 只能消费显式 authz projection，不自行解释最终授权

固定禁止：

- 只要“登录成功”就默认开放全部原件下载
- 用 prompt-only 约束代替受限资源授权
- 让 document center 绕开 `app-api` 直接自行解释终态授权

### 决策 5：document center 与 regulation 可以共享 provenance，但不能共享 collection identity

同一份资源可以同时参与两条链路：

- 作为 document center 中的 original/released file 被认证用户下载
- 作为 semantic owner 来源，被恢复成 `regulations/*` 中的一份 canonical regulation text

但它们必须继续表达为两类不同资源：

- original resource
- semantic-owner promoted document

因此固定要求：

- resource identity 不从 `notice_id` 或 regulation `document_id` 互相借用
- original 侧继续保留 source-native 文件标识、sha256、object key、capture provenance
- regulation 侧继续保留 `document_id/version_id` 与 semantic-owner metadata

### 决策 6：当前 research-notice 样本默认进入 document-center / follow-up，而不是 regulation

对当前已核对的 research-notice 样本，固定判断如下：

- `第十届教育部科学研究优秀成果奖（人文社会科学）实施办法`
- `第十届教育部科学研究优秀成果奖（人文社会科学）申报答疑`
- `2025年度北京市科学技术奖励提名手册`
- `科研项目申报操作手册`
- `科研项目中检操作手册`
- `科研项目结项操作手册`
- `中央民族大学网上报账系统使用手册`
- `中央民族大学财务事项你问我答`

这些内容当前都不进入 `regulations/institutional_regulations`。

它们的正确落点是：

- authenticated document center / attachment library
- 或后续独立 semantic-owner collection

而不是 regulation collection。

## 结果

直接结果如下：

- `regulations/*` 的边界继续保持“semantic-owner canonical text”
- repo 对“附件库 / 文档站”给出了正面设计答案，但它被明确冻结为独立受限资源层
- 已认证用户下载原件与 RAG/regulation 语义消费不再混层
- 后续扩大 authenticated notice / file release 采集时，不再需要把“是否对用户有价值”错误改写成“是否应进入 regulation”

## Supporting Rationale

- OWASP Authorization Cheat Sheet 明确要求 deny-by-default、least privilege，并把授权校验视为每个资源访问的硬要求：
  - https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- NIST SP 800-207 Zero Trust Architecture 强调每次资源访问都应显式认证和授权，而不是因网络位置或已有会话做宽放：
  - https://csrc.nist.gov/pubs/sp/800/207/final
- Microsoft SharePoint / Microsoft 365 官方文档把 content types、metadata search、ACL trimming 分开建模，这支持“originals catalog / metadata / authz projection”独立存在，而不是直接等同语义文档集合：
  - https://learn.microsoft.com/en-us/sharepoint/create-customize-content-type
  - https://learn.microsoft.com/en-us/microsoft-365/documentprocessing/metadata-search?view=o365-worldwide
  - https://learn.microsoft.com/en-us/azure/search/search-indexer-sharepoint-access-control-lists

基于这些官方资料的推断是：

- 对 repo 当前场景，更合理的形态不是“开放一个大而混的 regulation+附件下载库”
- 而是“document center 持有 originals 与 access truth，semantic collections 持有 canonical text 与 retrieval truth”

## Related Docs

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`
- `docs/reference/authenticated-notice-file-release-export-contract.md`
- `docs/reference/authenticated-notice-file-release-owner-recovery-readiness-contract.md`
