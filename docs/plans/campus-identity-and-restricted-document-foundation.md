---
doc_type: plan
status: active
created: 2026-04-02
updated: 2026-04-02
---

# Campus Identity And Restricted Document Foundation

## 文档边界

本文只负责把 `ADR-0022` 拆成可执行实施波次、代码落点与验收标准。

本文不负责：

- 重新定义长期授权模型
- 宣布当前仓库已经完成 campus identity 落地
- 冻结具体校园 IdP 产品、目录同步中间件或 Cloudflare Access 控制台配置细节

对应 source of truth：

- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `docs/plans/legacy-acl-carrier-compatibility-sunset.md`

## 目标

把“校内身份”和“restricted institutional document”从当前 phase-1 ACL 过渡态推进到可长期扩展的最小闭环。

这轮工作完成时，应至少做到：

1. `app-api` 能稳定区分未登录访问者与 `campus_member` 类 principal，并且前向不再保留独立 `public_user` principal。
2. `app-api` 可以稳定产出 restricted document 所需的 canonical entitlement projection。
3. document registry / chunk / Qdrant payload 以 `visibility_* + entitlement_*` 为主写入。
4. retrieval 对 restricted document 执行 fail-closed pre-filter。
5. public chat / panel / operator / service surface 对 restricted content 的 allow/deny 行为可验证。

## 当前状态

当前 merged truth 已经具备：

- `app-api` 是 canonical identity / authz owner 的架构方向
- `ContextProjection` / `AuthorizationProjection` shared seam
- retrieval 在 candidate retrieval 前执行 authz filter
- `visibility_*` / `entitlement_*` 词汇已经进入 shared contract、registry 和 Qdrant payload

当前尚未闭合的点包括：

- principal class 仍缺少“登录即 campus principal”的前向收口
- app-layer authz projection 仍大量由 actor `groups/campus_scope` 镜像得出
- registry / index payload 仍与 legacy `acl_* / campus_scope` 并存
- restricted institutional documents 还没有形成完整 allow/deny rollout 与测试矩阵

## 完成定义

这轮工作完成时，至少满足：

1. `apps/app-api` 已有 `campus_member` / `student` / `staff` / `faculty` 的最小 principal mapping 入口。
2. `apps/app-api` 对 restricted document 请求可生成 `entitlement_snapshot_id` 或等价的最小 entitlement version marker。
3. `ingestion-core` 新写入 restricted document 时，registry / chunk payload 的 primary authz 词汇为 `visibility_* + entitlement_*`。
4. live retrieval path 在 restricted document 请求上不再依赖 top-level actor `groups/campus_scope` 作为 canonical authz truth。
5. allow/deny matrix、泄露防护测试、回归测试与仓库级 baseline 同时通过。

## 波次拆分

### Wave 1: Principal Taxonomy And Projection Freeze

目标：

- 冻结 `anonymous`、`campus_member`、`student`、`staff`、`faculty`、`operator`、`service` 的最小 principal taxonomy
- 明确哪些 principal 可作为 restricted document entitlement truth

落点：

- `docs/architecture/product-runtime-architecture.md`
- `apps/app-api/src/modules/auth/principal.ts`
- `apps/app-api/src/campus_app_api/projection.py`
- `packages/contracts`

验收：

- 未登录访问者与 `campus_member` 的边界可测试
- execution projection 不把 raw auth input 直接暴露给 downstream

### Wave 2: Campus Identity Input And Entitlement Snapshot

目标：

- 为 app-layer 引入 campus identity input 与最小 entitlement snapshot

落点：

- `apps/app-api` auth / principal / projection 模块
- 必要时新增 app-local schema / projection storage

必须做到：

- campus identity source 与 Better Auth session 分离
- canonical entitlement summary 可版本化
- operator / service principal 继续与 end-user principal 分离

### Wave 3: Restricted Document Projection In Data Plane

目标：

- 让 restricted institutional documents 在 registry / chunk / index 里以新词汇作为 primary projection

落点：

- `packages/ingestion-core/src/campus_ingestion_core/models.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `packages/ingestion-core/src/campus_ingestion_core/process.py`
- split manifest / source projection / rebuild 相关模块

必须做到：

- 新写入路径以 `visibility_level`、`visibility_scope`、`entitlement_groups`、`policy_projection_version` 为 primary 字段
- legacy `acl_* / campus_scope` 只保留受控兼容期镜像
- restricted document collection / document policy 可回放、可重建

### Wave 4: Retrieval Fail-Closed Restricted Access

目标：

- 让 retrieval 对 restricted documents 的 allow/deny 语义可独立验证

落点：

- `packages/retrieval-core`
- `packages/rag-specialist`
- `packages/evals`

必须做到：

- 未授权 principal 不得在 retrieval 阶段命中 restricted evidence
- snippet / citation / source identifier 不发生未授权泄露
- personalization / profile memory 不得扩大 restricted access

### Wave 5: Surface Rollout And Verification

目标：

- 补齐 public chat、panel、operator、service 的受限内容响应策略与验证闭环

落点：

- `apps/app-api`
- `apps/public-chat-web`
- `apps/protected-panel-web`
- `packages/evals`
- `tests/`

必须做到：

- public chat 对 restricted content 的行为有明确 contract
- operator surface 允许显示最小 deny diagnostics，但不扩成通用泄露面
- service principal 行为有单独 allow/deny gate

### Wave 6: Compatibility Cleanup

目标：

- 关闭 current transitional ACL carrier

落点：

- `packages/contracts`
- `packages/retrieval-core`
- `packages/ingestion-core`
- `tests/`

必须做到：

- product path 不再把 `ActorContext.groups/campus_scope` 视为 canonical authz truth
- retrieval 不再依赖 `acl_level`、`acl_groups`、`campus_scope` fallback
- `EvidenceSource` / eval fixtures / benchmark fixtures 不再把 legacy ACL 词汇当默认 contract

兼容层下线的详细波次、验证门槛与回滚约束，统一见
`docs/plans/legacy-acl-carrier-compatibility-sunset.md`。

## 文件与模块建议

- `apps/app-api`
  principal mapping、entitlement snapshot、authorization projection
- `packages/contracts`
  typed projection seam 与后续兼容层收口
- `packages/ingestion-core`
  restricted document registry / chunk / index projection
- `packages/retrieval-core`
  pre-filter 与 fail-closed restricted retrieval
- `packages/evals`
  allow/deny matrix 与泄露防护 gate

## 验收建议

后续每一波至少应提供：

- focused unit tests
- 至少一组 restricted document allow/deny workflow case
- restricted snippet/citation leakage regression
- docs 与 implementation truth 同步更新

## 当前不做

本文当前不要求立即实现：

- 完整校园 IAM 平台选型
- 复杂 delegated admin / policy authoring UI
- 跨学校多租户 federation
- 细粒度字段级 masking 或 redaction 引擎

这些能力后续可以继续演进，但不能破坏本文固定的 owner split 与 projection boundary。
