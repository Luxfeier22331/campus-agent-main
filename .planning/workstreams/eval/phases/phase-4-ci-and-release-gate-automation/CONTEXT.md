---
doc_type: context
status: completed
created: 2026-04-24
updated: 2026-04-24
---

# Phase 4 Context

## Why This Phase Exists

shared eval runtime/publish 如果只能靠本地手动 accept，workstream 就仍然没有 repo-owned release evidence lane。

## Repo Facts

- shared artifact truth 与 publish seam 已完成
- admitted profile 集合已稳定
- repo 需要 manual release gate，而不是 PR hard gate

## Phase Output

本 phase 必须把 shared eval lane 封装成 repo-owned automation：

- doctor
- accept
- publish
- manual GitHub Actions workflow
- operator-facing runbook

