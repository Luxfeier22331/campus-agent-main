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
