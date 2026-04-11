---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Contracts

`contracts/` 保存稳定的 HTTP 与 runtime seam。
它回答“边界上的输入输出长什么样”“状态如何流转”“哪些字段不能从下游倒推”。

## App API 核心 contract

- `app-api-http.md`
- `app-api-error-model.md`
- `app-api-request-lifecycle.md`
- `app-api-supervisor-execution.md`

## Operator / Official Web contract

- `app-api-operator-observability-http.md`
- `app-api-official-web-http.md`
- `app-api-official-web-run-lifecycle.md`

## Navigation contract

- `navigation-place-finding-contract.md`

## 使用规则

- contract 只写稳定 seam，不写执行历史
- request/response shape 的 current truth 以这里为准，不以 panel UI 或 sink payload 为准
