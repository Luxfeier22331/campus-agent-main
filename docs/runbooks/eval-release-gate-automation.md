---
doc_type: runbook
status: active
created: 2026-04-23
updated: 2026-04-23
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
- `official-web-fresh-news`
- `service-guide-lookup`

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

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile official-web-fresh-news \
  --qdrant-collection-name <physical-collection> \
  --json
```

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
- supervisor-api Go 侧 service guide planning / runtime policy /
  structured query / answer text
- Python `campus-services-agent` tool adapter 与 HTTP query service contract

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
