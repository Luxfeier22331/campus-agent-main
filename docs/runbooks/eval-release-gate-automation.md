---
doc_type: runbook
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

- `handbook`
- `curriculum`
- `official-web-stable-reference`
- `service-guide-lookup`
- `contact-directory-lookup`
- `campus-services-product-path`

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

handbook：

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile handbook \
  --verbose \
  --json
```

curriculum：

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile curriculum \
  --verbose \
  --json
```

official web：

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile official-web-stable-reference \
  --qdrant-collection-name <physical-collection> \
  --json
```

`official-web-fresh-news` is not a release-gate dispatch profile. Its current
repo truth is offline seed validation only; use the retrieval qrels fixture for
local seed checks until a separate news/runtime opening workstream admits it.

service guide lookup：

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile service-guide-lookup \
  --json
```

`service-guide-lookup` 是确定性 release gate，不调用 live app-api，不生成
formal benchmark case-results，也不支持 operator observability publish dry-run。它固定检查：

- `service_guide` source-truth projection 的默认 eval cases
- `service_guide_lookup` intent 子集，包括办理指南 lookup 与事务性代办 guardrail
- execution-control Go 侧 service guide planning / runtime policy /
  structured query / answer text
- Python `campus-services-agent` tool adapter 与 HTTP query service contract

contact directory lookup：

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile contact-directory-lookup \
  --json
```

`contact-directory-lookup` 也是确定性 release gate，不调用 live app-api，不生成
formal benchmark case-results，也不支持 operator observability publish dry-run。

campus services product path opening gate：

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile campus-services-product-path \
  --json
```

`campus-services-product-path` 聚合：

- `service-guide-lookup` deterministic gate
- `contact-directory-lookup` deterministic gate
- Go structured runtime matrix tests
- Python `tests.agent.test_campus_services_agent`
- `app-api` runtime tests + typecheck
- `public-chat-web` worker E2E + typecheck

artifact 默认写入：

- `campus-services-product-path-opening-gate.json`
- `summary.opened_tools[] / blocked_tools[]`
- `tool_verdicts[]`（按 tool 粒度的 `open|blocked`）

## Campus Services Rollout / Rollback

这是 `campus-services-product-path` gate 对应的固定运营契约：

- rollout flag（Go-owned）：
  - `EXECUTION_CONTROL_OPEN_CAPABILITIES=campus_services`
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
  - 从 `EXECUTION_CONTROL_OPEN_CAPABILITIES` 移除 `campus_services` 后重新部署
  - 复核 `/readyz` 已回到 capability gate closed

source trace 观察点（browser-safe）：

- chat structured parts：`campus_service_trace_cards`
- app-api request projection：`selectedTarget`、`status`、`allowed_tool`、`payload_kind`
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
