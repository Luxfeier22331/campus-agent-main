---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0024
status: accepted
created: 2026-04-03
updated: 2026-04-03
---
# ADR-0024 Authenticated Notice Source Channel

适用范围：登录态、机构内部通知采集器的 source-channel 建模、bootstrap 接入、runtime ownership 与
restricted rollout 边界

## 背景

当前仓库已经冻结了以下长期边界：

- repo 级 canonical data plane 固定为 `raw asset -> provider output -> source truth
  -> declared projections -> document/chunk/index`
- `official_web` 是 public HTML source channel，不默认纳入登录态页面或应用壳
- restricted institutional documents 的 canonical authorization truth 由
  `apps/app-api` 拥有
- 对象存储长期语义始终是 `S3-compatible object storage`

但对于“需要登录才能访问的内部通知系统”，仓库还缺一条明确规则：

- 这种源是否属于 `official_web`
- collector runtime、bootstrap importer 与后续 control plane 分别由谁拥有
- collector 当前临时 SQLite / export artifacts 应怎样进入 repo
- source-truth 的稳定资源单位应是什么

如果这条边界不冻结，后续很容易退化为：

- 把登录态内部通知伪装成 `official_web`
- 直接把 collector SQLite / export JSON 当 repo 级 canonical truth
- 让本地文件路径替代对象存储语义
- 让 collector 直接写 document/chunk/index
- 让 restricted rollout 在没有独立 collection 的情况下先行公开 query

## 决策 1：登录态内部通知建模为新的一级 `source_channel`

结论：

- 登录态内部通知源固定建模为新的一级 `source_channel`
- 推荐名称固定为：
  - `authenticated_notice_portal`

它不是：

- `official_web` 的特例
- 某个 collection 私有脚本
- 仅供一次性迁移的导入文件格式

原因：

- 它的认证边界、资源身份、风险模型与 `official_web` 明显不同
- 将它并入 `official_web` 会污染既有 public crawl policy 与 source-truth contract

## 决策 2：source-truth 的稳定资源单位固定为 `notice`

结论：

- `authenticated_notice_portal` 的 canonical source unit 固定为稳定 `notice`
- `raw_asset_id` 应围绕 `site_id + notice_id` 建模
- `raw_version_id` 应围绕标题、正文、分类与附件关系的实质变化推进

原因：

- 对这类内部系统而言，稳定 identity 首先属于 notice 本身，而不是 crawl page 或 query URL
- 这能让 list/detail API、正文 HTML、链接和附件关系统一回到同一 source asset

## 决策 3：第一阶段接入走 bootstrap import seam，而不是先要求 `app-api` control plane

结论：

- 第一阶段允许通过 typed bootstrap artifacts 接入 repo
- bootstrap artifacts 可来自外部 collector 的 export bundle 与对象存储对象
- bootstrap seam 的 owner 固定为：
  - `packages/ingestion-core`
  - `apps/ingestion-worker`

原因：

- 当前最先需要收口的是 source-truth、document registry 与 restricted rollout
- 先行要求 control plane 会把工作重心错误地放到 admission / operator workflow，而不是 data-plane
  contract

## 决策 4：collector runtime 应作为独立 `apps/*` runtime shell 迁入 repo

结论：

- 登录态 notice collector 的长期 owner 固定为 repo 内独立 `apps/*` runtime shell
- 推荐落点固定为：
  - `apps/authenticated-notice-collector`

它负责：

- 认证复用
- list/detail 抓取
- notice-level normalize / enrich
- 附件对象上传
- typed artifact 输出

它不负责：

- document registry
- chunking / embedding / index release
- restricted entitlement 解释

原因：

- collector 是 source-specific runtime concern，不应污染 `packages/*`
- 这能保持 source runtime 与 shared data plane 分层清晰

## 决策 5：collector 当前 SQLite / export JSON 只是 bootstrap seam，不是长期 canonical truth

结论：

- collector 内部 SQLite 可以作为 app 内 cache / dedupe / runtime state
- export JSON 可以作为 bootstrap import seam
- 它们都不是 repo 级长期 canonical truth

直接要求：

- repo 内长期 truth 必须先重建为 `capture/ -> provider/ -> source-truth/`；如后续 materialize
  source-side persisted projection artifact，则继续落在同一 source prefix 下的
  `projection/<projection_name>/...`
- `local_path` 不得进入 canonical source-truth
- `object_key` 可以继续作为对象身份与存储定位语义

原因：

- 当前 export/DB 形态是 source-specific 运行产物，不是 repo 级稳定 contract
- 但对象键语义与对象存储方向一致，值得保留

## 决策 6：首个下游 collection 默认采用独立 restricted collection + `offline_preparation`

结论：

- 首个下游 collection 推荐固定为：
  - `campus_notices/internal_notice`
- 默认发布姿态固定为：
  - 独立 restricted collection
  - `serving_stage=offline_preparation`
  - document/chunk 使用 `visibility_* + entitlement_*` 主词汇

原因：

- 这类内容天然属于 restricted institutional documents
- 先独立 collection 能降低误标、漏标与泄露风险

## 决策 7：如后续需要 control plane，必须新增 dedicated domain，不复用 `official_web`

结论：

- 如果后续需要 run admission、heartbeat、operator query 与 ingestion handoff
- 必须新增 dedicated authenticated notice control-plane domain
- 不得复用 `official_web` command/query surfaces

原因：

- `official_web` 的 public crawl policy、schema 与 operator domain 已有自己明确边界
- 复用它会把 public / authenticated 两类 source channel 语义混在一起

## 结果

直接结果如下：

- 需要新增一份 authenticated notice source architecture 文档
- 需要新增一份 notice source-truth contract
- 需要在 `packages/ingestion-core` 实现 bootstrap importer 与 source-truth builder
- 需要在 `configs/ingestion/` 下为 `campus_notices/internal_notice` 新增
  runtime/canonical/chunk config
- 需要在 collector 迁入 repo 时把 SQLite 降级为 app 内 runtime state，而不是系统间 truth

明确不做：

- 不把这类源并进 `official_web`
- 不把 export JSON 直接当 query-serving collection
- 不把本地文件路径抬成长期对象真相
- 不在第一阶段要求 panel / operator control plane 同步上线

## Complements

这项决策 complements：

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice.md`
- `docs/architecture/system/data-plane.md`
- historical background:
  `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `git history restricted-document rollout workstream`
