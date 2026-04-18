---
doc_type: plan
status: deferred
created: 2026-04-02
updated: 2026-04-12
---

# Legacy ACL Carrier Compatibility Sunset

## 文档边界

本文只负责定义 `acl_level`、`acl_groups`、`campus_scope` 这组三个 transitional carrier 的下线方案。

本文不负责：

- 重新定义长期 identity / authorization architecture
- 重新打开 `app-api` canonical authz owner 的边界
- 把 personalization、memory 或 actor profile 升级成授权来源

对应 source of truth：

- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `docs/plans/campus-identity-and-restricted-document-foundation.md`

## 成文时收口进度

本文状态固定为 `deferred`。

原因：

- Phase 11 已把 runtime canonical vocabulary、restricted fail-close 与 shared seam 的主路径收口；legacy carrier 不再是主线 blocker
- 但 shared contract、persisted-row canonicalization、fixture/docs vocabulary 与少量兼容入口仍保留 legacy residue，因此本文不能标成 `completed`
- 当前没有专门 active wave 持续清空这部分技术债，所以它属于 accepted but not currently executing 的 follow-up

补充说明：

- 这里说的 legacy `campus_scope` 指 authz / ACL 过渡 carrier，不包括 navigation / place catalog 里作为地理语义存在的同名字段
- 后续若重开这条线，应先按本文 Wave 1-5 重新建立显式 execution lane，再做 repo-wide 删除

## 目标

把 legacy ACL carrier 从“产品路径上的兼容载体”收缩成“离线迁移入口适配”，最终从 shared contract、runtime query path、fixture vocabulary 与 data-plane payload 中退出。

下线完成时，repo 内对 restricted document 的 canonical 词汇固定为：

- `visibility_level`
- `visibility_scope`
- `entitlement_groups`
- `policy_projection_version`

## 当前状态

当前仓库当时已经完成的部分：

- `retrieval-core` 主查询路径已按 canonical `visibility_* + entitlement_*` 执行 pre-filter
- `RetrievalRequest` 顶层 legacy fallback 已退出主路径
- `app-api -> supervisor-api` 执行 seam 已切到 canonical retrieval filter vocabulary
- `AuthorizedRetrievalFilter` 稳定 contract 已不再暴露 `acl_groups/campus_scope`
- ingestion metadata projection 与 Qdrant payload schema 的新写入路径已不再双写 `acl_level/acl_groups/campus_scope`
- eval/benchmark 正在切换到 canonical restricted vocabulary
- `acl_* / campus_scope` 已被明确定义为 transitional carrier，而非 canonical truth

当前仍未收口的部分：

- shared contract 仍暴露 `ActorContext.groups/campus_scope`
- `EvidenceSource` 仍暴露 `acl_level`
- ingestion manifest / registry / chunk / rebuild 内部对象仍保留 legacy mirror 与 legacy 读取入口
- docs / runbooks / fixtures 仍广泛出现 legacy vocabulary

## 下线原则

1. canonical authz truth 只允许来自 `app-api` 的 `AuthorizationProjection`
2. runtime product path 不再读取 legacy ACL carrier
3. compatibility 只允许留在离线导入、重建或 fixture loader 入口
4. legacy 字段若短期保留，只能是 canonical 字段导出的 mirror，不能反向参与授权决策
5. deny path 继续 fail-close，且不增加标题、snippet、citation、anchor 泄漏面

## 目标形态

### 主体侧

- `app-api` 继续产出 `principal_type`、`projection_source`、`entitlement_snapshot_id`
- actor profile 中的 `groups/campus_scope` 不再被 downstream 当成 canonical authz truth

### 资源侧

- document registry / chunk / index payload 只以 `visibility_* + entitlement_*` 作为 primary projection
- `acl_level`、`acl_groups`、`campus_scope` 不再进入稳定 payload contract

### 执行侧

- `supervisor-api`、`supervisor-core`、`rag-specialist`、`retrieval-core` 只消费 canonical authz projection
- product HTTP seam 不再发送 legacy retrieval filter carrier

### 验证侧

- hybrid fixture、qrels、golden cases、runbook、docs 示例全部切到 canonical vocabulary
- 仅离线迁移 adapter 允许继续读取 legacy key，并必须显式标注 deprecation

## 执行波次

### Wave 1：公开 contract 先切 canonical vocabulary

目标：

- 从外部 HTTP seam 和 docs example 中移除 legacy retrieval filter 字段

落点：

- `apps/app-api/src/modules/integration/supervisor.ts`
- `apps/app-api/test/supervisor-adapter.test.ts`
- `apps/supervisor-api/src/campus_supervisor_api/api.py`
- `tests/api/test_supervisor_api.py`
- `docs/contracts/app-api-supervisor-execution.md`

完成定义：

- `app-api -> supervisor-api` 默认只发送 `entitlement_groups`、`visibility_level`、`visibility_scope`、`policy_projection_version`
- `supervisor-api` 不再把 legacy retrieval filter key 当成 canonical contract 示例

### Wave 2：shared contract 收窄

目标：

- 把 legacy 字段从 shared contract 的稳定默认入口中收出

落点：

- `packages/contracts/src/campus_contracts/models.py`
- `tests/contracts/test_models.py`

完成定义：

- `AuthorizedRetrievalFilter` 不再作为长期 contract 暴露 `acl_groups/campus_scope`
- `EvidenceSource` 不再把 `acl_level` 当稳定字段
- 如需过渡读取，只允许在 adapter 层做结构映射

### Wave 3：data-plane 停止双写

目标：

- registry / chunk / index payload 改成 canonical-only primary write

落点：

- `packages/ingestion-core/src/campus_ingestion_core/models.py`
- `packages/ingestion-core/src/campus_ingestion_core/process.py`
- `packages/ingestion-core/src/campus_ingestion_core/campusrag_ingestion_support.py`
- `packages/ingestion-core/src/campus_ingestion_core/split_manifest.py`

完成定义：

- 新写入与重建结果不再包含 legacy ACL payload key
- split manifest / import metadata 若仍兼容 legacy key，canonicalize 后内部对象不得继续保留 legacy 决策语义

### Wave 4：fixture 与评测 vocabulary 下线

目标：

- 把测试、benchmark、runbook 的 canonical vocabulary 全部切正

落点：

- `packages/evals/*`
- `tests/evals/*`
- `docs/runbooks/*`
- `docs/reference/testing-and-verification-lanes.md`

完成定义：

- `acl_filter`、`campus_scope_filter` 退出 canonical fixture vocabulary
- legacy alias 若暂存，只允许 loader 兼容，不允许新 fixture 再写入

### Wave 5：物理删除与回归封口

目标：

- 删除最后的 legacy carrier 字段、mirror 与 fallback resolver

落点：

- `packages/contracts`
- `packages/ingestion-core`
- `packages/retrieval-core`
- `tests/*`
- `docs/*`

完成定义：

- repo 主干不再存在面向产品路径的 `acl_level`、`acl_groups`、`campus_scope`
- 剩余出现仅允许在历史说明或一次性迁移脚本中

## 验证门槛

每一波都至少要补下面四类证据：

- focused unit tests
- restricted allow/deny matrix
- deny-path leakage regression
- `rg -n "acl_level|acl_groups|campus_scope"` 的剩余使用面清单

最终完成时，需要同时满足：

1. product runtime path 不再读取 legacy carrier
2. shared contract 不再把 legacy carrier 当稳定输出
3. data-plane 新写入与 rebuild 结果不再包含 legacy payload key
4. fixture / docs / runbook 不再使用 legacy vocabulary
5. telemetry / audit 只记录最小 authz summary，不落 raw legacy payload

## 风险与回滚

主要风险：

- 外部 caller 仍发送 legacy retrieval filter key
- rebuild / fixture 仍依赖旧 payload schema
- `campus_scope` 的 mixed 语义尚未彻底拆开

回滚原则：

- 只允许按波次回滚，不允许把 runtime query path 回滚成 legacy truth
- 数据问题优先回滚 alias / snapshot / rebuilt collection，不恢复 legacy decision path

## 当前建议的先手

如果后续重开这条线，先执行 Wave 1。

原因：

- 风险最小
- 直接收紧对外 contract
- 不会先把 ingestion / index 重建复杂度提前压到当前工作流
- 可以为后续 shared contract 和 data-plane 下线创造单向依赖条件
