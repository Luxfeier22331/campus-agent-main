---
doc_type: index
truth_scope: ops
owner_boundary: docs/environment
status: active
created: 2026-03-29
updated: 2026-06-13
---
# Environment

本目录定义 `campus-agent` 当前环境配置的 ownership、provider inventory 与 readiness contract。

## Canonical Entry

- `provider-and-secret-inventory.md`
  - 当前需要哪些 provider / control plane、各自需要哪些 env keys、值应放在哪里、以及新环境如何获取这些值
  - `provider-and-secret-inventory/core-providers.md`
  - `provider-and-secret-inventory/app-and-edge-providers.md`
  - `provider-and-secret-inventory/environment-combinations.md`
- `env-ownership-and-overrides.md`
  - repo root / app-local / command-scoped env 的 ownership、override 规则与本地
    runtime 边界
- `deploy-and-eval-readiness.md`
  - readiness gate、staging deploy contract 与 eval env contract
- `../runbooks/provider-secret-governance.md`
  - deploy-side secret 治理、rotate / revoke 与环境隔离规则

## Env Surfaces

- active operator override examples live under `env/commands/*.env.example`
- historical Python ingestion command override examples are removed from the
  active branch tip with their executable command surfaces

## Usage Rule

- 需要判断 provider / secret 应去哪里申请、放在哪里，先读 `provider-and-secret-inventory.md`
- 需要判断某个 env key 属于谁、应放在 repo root 还是 app-local，读
  `env-ownership-and-overrides.md`
- 需要判断 staging / eval readiness gate 与 deploy-side contract，读
  `deploy-and-eval-readiness.md`
- 需要找命令级 env 模板时，先看 `env/commands/*.env.example`；旧 Python ingestion
  closeout / rebuild / release command env 不再作为 tracked fallback surface
- 需要具体 deploy、smoke、rotate 或 recovery 步骤，回到对应 runbook
