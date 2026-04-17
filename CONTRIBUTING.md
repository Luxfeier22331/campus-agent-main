# Contributing

`campus-agent` 采用 `develop -> main` 的双分支发布模型。

## Branch Model

- `develop` 是长期集成分支，所有前向实现先在这里收口
- `main` 是稳定分支，只接收已经在 `develop` 验证通过、准备发布的内容
- feature work 默认从 `develop` 派生，完成后先回 `develop`，再按发布节奏推进到 `main`

## Environment Bootstrap

先准备 Python workspace 与 JS/TS workspace：

```bash
uv sync --all-packages --dev
pnpm install
```

## Verification Baseline

提交前至少执行与改动面相符的验证：

```bash
uv run --all-packages python -m unittest discover -s tests -t .
pnpm web:typecheck
pnpm web:test
pnpm web:build
```

如果只验证受影响面，可以使用：

```bash
pnpm web:typecheck:affected
pnpm web:test:affected
pnpm web:build:affected
```

## Commit And Review

- 提交标题默认使用 `Conventional Commit` 前缀加中文结果描述
- 不要把临时文件、缓存、`.wrangler/`、`coverage/`、`playwright-report/` 一类本地产物混入提交
- 文档、行为变更、测试补充尽量按逻辑拆分为可审阅的独立提交

## Collaboration Notes

- 仓库入口约束、目录导航和工作协议以根 `AGENTS.md` 为准
- 架构 truth 先看 `README.md`、`docs/README.md`、`docs/architecture/` 与 `.planning/`
- 发布与分支流转步骤见 `docs/runbooks/develop-main-release-runbook.md`
