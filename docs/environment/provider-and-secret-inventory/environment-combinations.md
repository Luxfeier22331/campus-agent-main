---
doc_type: index
truth_scope: ops
owner_boundary: docs/environment
status: active
created: 2026-06-13
updated: 2026-06-13
---

# Provider And Secret Inventory Environment Combinations

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## 最小环境组合

## 仅跑 query / app-api / web 本地联调

至少准备：

- root `.env`
  - shared Postgres
- app-api provider-config active profiles
  - `primary_agent`
  - `rag_synthesis`
  - `rag_query_embedding`
- self-host local runtime lifecycle
  - Qdrant URL/key projection
- `apps/app-api/.env`
  - local Hyperdrive / management DSN
- `apps/app-api/.dev.vars`
  - `BETTER_AUTH_SECRET`
  - `APP_API_SAFETY_IDENTIFIER_HMAC_SECRET`
  - `AUTH_SHELL_ORIGIN`
  - `EXECUTION_CONTROL_*`
  - 如果 supervisor ingress 受 Cloudflare Access 保护，补充
    `EXECUTION_CONTROL_ACCESS_CLIENT_ID` 与 `EXECUTION_CONTROL_ACCESS_CLIENT_SECRET`
  - `APP_API_INTERNAL_SHARED_SECRET`
- `apps/campus-web/.dev.vars`
  - `APP_API_BASE_URL`
- `apps/operator-console-web/.dev.vars`
  - 只有调 panel 时才需要

不必准备：

- OCR
- object storage
- eval-only provider override

## 跑 ingestion / replay / rebuild

在上面的基础上再准备：

- collector app-local 或 ingestion command env 中的 object storage
- command/domain runtime 中的 OCR provider
- 需要时的 command-scoped env

## 跑 staging Worker deploy

在对应 app-local secret store 之外，还要准备：

- Cloudflare deploy access
- panel 的 Cloudflare Access application
- 对应运行面的 Sentry DSN
- `app-api` 的 Axiom dataset / token

## 当前不需要的 provider

以下不是当前 merged truth 的必填项：

- GitHub OAuth / Google OAuth / 其他 end-user social sign-in provider
- 独立 eval provider，除非你明确要把 eval 和 shared runtime 分账
- 额外的 OCR sidecar provider，除非你真的要跑 lane 级对照或 source-truth-only 双跑

## 相关仓库文档

- [README.md](./README.md)
- [../../.env.example](../../.env.example)
- [../../apps/app-api/.env.example](../../apps/app-api/.env.example)
- [../../apps/app-api/.dev.vars.example](../../apps/app-api/.dev.vars.example)
- [../../apps/campus-web/.dev.vars.example](../../apps/campus-web/.dev.vars.example)
- [../../apps/campus-web/.dev.vars.example](../../apps/campus-web/.dev
  .vars.example)
- [../../apps/operator-console-web/.dev.vars.example](../../apps/operator-console-
  web/.dev.vars.example)
- [../../apps/authenticated-notice-collector/.env.example](../../apps/authenticat
  ed-notice-collector/.env.example)
- [../../apps/official-web-collector/.env.example](../../apps/official-web-colle
  ctor/.env.example)
- [../../apps/wechat-official-account-collector/.env.example](../../apps/wechat-
  official-account-collector/.env.example)
- [../../runbooks/provider-secret-governance.md](../../runbooks/provider-secret-govern
  ance.md)
- historical [../../runbooks/archive/python-ingestion-worker/local-postgres-dev-recovery-runbook.md](../../runbooks/archive/python-ingestion-worker/local-postgres-dev-recovery-runbook.md)
