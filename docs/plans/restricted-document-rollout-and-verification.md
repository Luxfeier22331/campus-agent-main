---
doc_type: plan
status: deferred
created: 2026-04-02
updated: 2026-04-12
---

# Restricted Document Rollout And Verification

## 文档边界

本文只负责 restricted institutional documents 的 rollout contract、surface behavior 与验证闭环。

本文不负责：

- 重新定义 principal taxonomy
- 替代 `ADR-0022` 的长期授权决策
- 定义完整校园 IdP / directory 接入细节

## 当前状态

本文状态固定为 `deferred`。

原因：

- restricted document rollout 仍是 accepted product direction，但当前没有独立 active execution wave
- 当前 repo 中的 restricted collections 仍以 `offline_preparation` 为主，默认主线也不在 restricted query-surface opening
- 因此本文保留为后续 rollout / reopen 的执行合同，不再占用默认 active plan 入口

## 目标

确保“只对校内人士开放的通知、制度或说明”在实际产品 surface 上形成稳定、可验证、可回归的行为。

## 设计问题

这份文档只回答五个问题：

- restricted documents 应怎样标记和发布
- public chat / operator / service 请求应怎样响应
- 哪些信息可以暴露，哪些不能暴露
- collection 级隔离与 document/chunk 级过滤如何协同
- rollout 期间需要什么验证证据

## 发布策略

restricted documents 默认按以下顺序发布：

1. 优先放入独立 restricted collection
2. 若必须与 public docs 共存，再启用 document / chunk 级 visibility projection
3. rollout 期间每次 release 都要生成 restricted policy evidence

每个 restricted release 至少记录：

- affected corpus / collection
- visibility policy summary
- entitlement group summary
- points count / document count
- allow/deny smoke evidence

## Surface Contract

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

## 泄露防护规则

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

## 验证矩阵

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

## 推荐验证命令

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

## 当前不做

- 不在本轮为 restricted documents 新建通用 policy admin UI
- 不在本轮引入字段级内容打码
- 不在本轮做跨机构 federation rollout
