---
doc_type: runbook
truth_scope: eval
owner_boundary: packages/evals
status: active
created: 2026-04-23
updated: 2026-04-27
---
# Eval Release Gate Automation

## Purpose

本 runbook 固定 repo-owned shared eval automation 入口：

- `python -m scripts.eval_gate doctor`
- `python -m scripts.eval_gate accept`
- `python -m scripts.eval_gate publish`

它不替代：

- per-corpus baseline 文档
- `packages/evals` 各自 CLI 的低层实现
- golden dataset governance

## Supported Profiles

- `campus-services-product-path`
- `multi-agent-runtime-contract`
- `public-chat-product-path`
- `public-chat-entry-e2e`
- `tool-family-denominator`
- `tool-routing-product-path`
- `document-quality`
- `authz-privacy`
- `agentic-retrieval-plan`
- `answer-quality-contract`
- `eval-operations-governance`
- `quality-calibration`

## Doctor

最小 doctor：

```bash
uv run --all-packages python -m scripts.eval_gate doctor --json
```

需要额外审计 worker secret presence 时：

```bash
uv run --all-packages python -m scripts.eval_gate doctor \
  --check-worker-secrets \
  --worker-env staging \
  --json
```

## Acceptance

通用 profile gate：

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile tool-family-denominator \
  --observations-path <observations.json> \
  --json
```

需要 runtime collection 的 profile 必须显式传入 observation / artifact；automation
不会启动旧 Python live runner，也不会从 Qdrant / app-api 隐式采样。

旧 corpus-specific 与 service-specific Python release profile 已从 active registry
移除。对应的 student rules、curriculum、official-web、service/contact 与
institutional rules 证据应由当前 TS/Go runtime owner 产出 sanitized release
acceptance / retrieval artifact，再交给 coverage snapshot 或 active profile 消费。

campus services product path opening gate：

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile campus-services-product-path \
  --json
```

`campus-services-product-path` 聚合：

- tool-family denominator 中的 service-guide / contact-directory cases
- Go structured runtime matrix tests
- `app-api` runtime tests + typecheck
- `public-chat-web` worker E2E + typecheck

artifact 默认写入：

- `campus-services-product-path-opening-gate.json`
- `summary.opened_tools[] / blocked_tools[]`
- `tool_verdicts[]`（按 tool 粒度的 `open|blocked`）

## Campus Services Rollout / Rollback

这是 `campus-services-product-path` gate 对应的固定运营契约：

- rollout flag（Go-owned）：
  - runtime profile `open_capabilities=["campus_services"]`
- opening 前必须同时满足：
  - gate artifact `summary.failed_checks=0`
  - `execution-control /readyz` 中 `capability_gates.campus_services.open=true`
  - `app-api` 与 `public-chat-web` `/readyz` 中
    `preflight.campusServicesProductPath.status=ready`
- rollback 条件（任一命中即回滚）：
  - opening gate 出现 failed checks
  - `/readyz preflight` 出现 `status=blocked` 或关键 check `not_ready`
  - public/chat 回答出现 source trace 泄漏（如 release id/projection internals/raw ref id）
- rollback 操作：
  - 从 runtime profile `open_capabilities` 移除 `campus_services` 后重新部署
  - 复核 `/readyz` 已回到 capability gate closed

source trace 观察点（browser-safe）：

- chat structured parts：`campus_service_trace_cards`
- app-api request projection：`selectedCapability`、`status`、`allowed_tool`、`payload_kind`
- preflight blocker：`preflight.campusServicesProductPath.blockers`

## Publish

automation 默认只做 publish dry-run：

```bash
uv run --all-packages python -m scripts.eval_gate publish \
  --case-results <run-XX-case-results.json> \
  --grade-source eval_release_gate \
  --grader-version grader@2026-04-23 \
  --json
```

如需显式真实 publish，必须手工添加：

```bash
--no-dry-run
```

## GitHub Actions

repo 级 manual workflow 使用：

- `.github/workflows/eval-release-gate.yml`

它只承担：

- manual dispatch
- env doctor
- shared acceptance
- optional publish dry-run
- artifact upload

它不是 PR 必过检查。
