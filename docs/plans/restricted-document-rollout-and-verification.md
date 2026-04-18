---
doc_type: plan
status: deferred
created: 2026-04-02
updated: 2026-04-18
---

# Restricted Document Rollout And Verification

## 文档边界

本文固定 `restricted document rollout / verification` 这条单一 workstream 的前向范围：

- restricted collection / release posture 的真实 rollout
- public chat / protected operator / service principal 的 surface behavior
- allow/deny matrix、泄露防护与 rollout evidence
- planning closeout 与后续 restricted surface 真相更新

本文不负责：

- 重新定义 principal taxonomy、canonical authz ownership 或 `ADR-0022` 已冻结的长期决策
- 重开 identity / authorization foundation ownership 讨论
- 把 legacy ACL sunset、memory productization 或 operator observability expansion 混成同一条并发 workstream
- 定义完整校园 IdP / directory 接入细节

## 当前生命周期状态

- 当前状态是 `deferred`
- 当前只是明确入口，不表示 restricted query surface 已恢复执行
- 它可以与其他独立 workstreams 并行存在；但这条线内部仍保持固定顺序，不再拆并发 lane

- restricted document rollout 仍是 accepted product direction，但当前没有独立 active execution wave
- 当前 repo 中的 restricted collections 仍以 `offline_preparation` 为主，默认主线也不在 restricted query-surface opening
- 因此本文保留为后续 rollout / reopen 的单一入口，不占用默认 active plan 入口

## 直接结论

restricted rollout 不应拆成多条并发 workstream。

它必须作为一条 `restricted document rollout / verification` workstream 推进，固定顺序如下：

1. authorization / release posture truth
2. restricted collection and retrieval rollout
3. surface behavior rollout
4. verification and leakage-hardening evidence
5. planning closeout

原因固定为：

- canonical authz truth、restricted release posture、retrieval pre-filter 与 surface deny semantics 共享同一条 rollout truth
- 如果把 principal/entitlement、collection release、surface behavior、verification 拆成并发 lane，容易继续让 runtime 维持半开状态或引入泄露面
- restricted rollout 的验收重点不是“某个单点测试通过”，而是 end-to-end allow/deny 行为、evidence 暴露边界与 operator/service 口径同时收口

## 前置真相

接手这条线之前，先以以下文档为准：

- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/restricted-document-rollout-verification/STATE.md`

## 固定执行规则

- restricted rollout 只在 canonical authz truth 已归属 `apps/app-api` 的前提下推进，不重开 foundation ownership 讨论
- restricted document retrieval 必须继续 candidate-pre-filter + fail-close，不接受“先召回再回答层裁剪”
- public chat、operator、service 的 surface 行为都只属于同一条 workstream 的顺序子层，不再拆成并行 lane
- rollout 期间优先 collection 级隔离；只有必须混存时才启用 document/chunk 级 visibility projection
- 若发现 legacy ACL residue 阻塞 rollout，优先在这条线内按阻塞点修，不单独新开并发 workstream

## Phase A: Authorization And Release Posture Truth

目标：

- 明确本轮 restricted rollout 面向哪些 principal、哪些 collection、哪些 release posture
- 把 runtime 仍处于 `offline_preparation` 的 restricted collection 与拟开放 surface 区分清楚

退出条件：

- 参与 rollout 的 principal / entitlement / visibility 语义已明确
- 参与 rollout 的 restricted collection / release posture 已明确
- 不再把登录态、Cloudflare Access 放行或 operator protected access 误写成数据授权已完成

## Phase B: Restricted Collection And Retrieval Rollout

restricted documents 默认按以下顺序发布：

1. 优先放入独立 restricted collection
2. 若必须与 public docs 共存，再启用 document / chunk 级 visibility projection
3. rollout 期间每次 release 都要生成 restricted policy evidence

目标：

- 把 restricted release posture 从 `offline_preparation` 推进到可验证的 rollout 状态
- 保持 retrieval path 只消费显式 authz projection，而不是回退到 prompt-only 或兼容字段猜测

每个 restricted release 至少记录：

- affected corpus / collection
- visibility policy summary
- entitlement group summary
- points count / document count
- allow/deny smoke evidence

退出条件：

- restricted collection / projection 已可稳定支撑 allow/deny 行为
- retrieval pre-filter、deny path 与 release evidence 已对齐
- rollout 结果不依赖 legacy ACL carrier 作为 canonical truth

## Phase C: Surface Behavior Rollout

目标：

- 让 public chat、protected operator 与 service principal 在 restricted rollout 下形成稳定、可解释且不泄露的行为

这份 workstream 的 surface contract 固定如下：

### Public Chat

- 未授权 principal 命中 restricted content 时，默认不返回内容、snippet、citation、title
- 如产品允许显式提示，可返回受控文案，例如“该内容仅对校内身份开放”
- 如产品不允许暴露存在性，则返回 `no_answer`

### Protected Operator Surface

- operator 可查看最小 deny diagnostics
- diagnostics 只允许包含 policy code、projection version、request id、principal class summary
- 不允许把原 restricted snippet 当诊断信息暴露给无关 operator view

### Service Principal

- service principal 必须通过显式 service auth 进入
- service principal 的 allowed collections / actions 必须单独配置，不与 user principal 复用

退出条件：

- public chat、operator、service 三类 surface 的 allow/deny 口径已明确
- deny path 的暴露边界已在实现、测试与文档中对齐
- 不再存在 surface 间的双真相或一处允许、一处 fail-close 的未分类漂移

## Phase D: Verification And Leakage-Hardening Evidence

目标：

- 用明确的 allow/deny matrix、泄露防护回归与 rollout evidence 关闭 restricted rollout 的验收口

restricted rollout 期间必须确保以下信息不会向未授权 principal 泄露：

- source title
- snippet
- anchor
- citation URL
- evidence count
- “最接近答案”的旁证文本

允许保留的最小观测包括：

- denied / no_answer 状态
- request id / trace id
- 最小 policy code

至少覆盖以下 principal × document policy 组合：

- anonymous × public
- anonymous × restricted campus_member
- campus_member × restricted campus_member
- student × restricted students
- staff × restricted staff
- operator × operator-only diagnostics
- service × allowed service scope
- service × forbidden scope

每组至少验证：

- retrieval allow/deny
- answer payload
- snippet / citation leakage
- audit / trace fields

推荐验证命令：

Python baseline:

```bash
uv run --all-packages python -m unittest discover -s tests -t .
```

JS/TS baseline:

```bash
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:test:integration
pnpm web:build
```

退出条件：

- allow/deny matrix 已覆盖最小 principal × policy 组合
- snippet / citation / existence leakage regression 已有证据
- rollout evidence 足以说明为什么 restricted surface 可以开启，或为什么仍需继续 fail-close

## Phase E: Planning Closeout

目标：

- 把 restricted rollout 的当前真相、剩余 gap 与 reopen 规则写回 planning

退出条件：

- `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`、`.planning/workstreams/restricted-document-rollout-verification/STATE.md` 与相关 reference 文档已更新
- 已明确记录哪些 restricted surface 已 rollout，哪些 collection 仍保持 `offline_preparation`
- 不把这条 rollout workstream 与 future authz cleanup / memory / observability 混写

## 当前不做

- 不在本轮为 restricted documents 新建通用 policy admin UI
- 不在本轮引入字段级内容打码
- 不在本轮做跨机构 federation rollout

## 接手标准

其他会话接手这条线时，默认按以下顺序开始：

1. 先检查 `.planning/WORKSTREAMS.md` 与 `.planning/workstreams/restricted-document-rollout-verification/STATE.md`，确认这条线是否仍保持 `deferred`，还是已经被显式提升为 active
2. 接着先核对 restricted collection / release posture 与 principal / entitlement truth，不直接从前端 surface 开始补丁
3. 完成后再更新 `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`、`.planning/workstreams/restricted-document-rollout-verification/STATE.md` 与相关 evidence 文档
