---
doc_type: index
status: backlog
created: 2026-04-23
updated: 2026-04-23
---

# Workstream: Supervisor Docker Runtime Language Split

这是 `supervisor-docker-runtime-language-split` 的 native backlog workstream 入口。
它记录 Docker 部署侧将 execution runtime 拆成 Go execution shell、Rust CPU kernels
与保留/逐步替换 Python orchestration 的后续评估与迁移线。

## Current Status

- status: `backlog`
- reopen rule: 只有在 Docker 侧性能预算、服务器成本或 profiling 结果显示 Python
  execution shell / CPU-heavy kernel 成为正式迁移瓶颈时恢复
- current posture: 已完成架构判断；未进入 active implementation

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- Worker 侧选型已冻结，不属于本 workstream
- `apps/supervisor-api` 已冻结为 Docker-first internal execution service，但不冻结为单一
  Python/HTTP framework
- 不默认 Rust 化所有 tool；thin tool adapter 继续保持 typed glue 职责
- 不让 Go / Rust / Python 运行时类型泄漏进 `packages/contracts`
- 不把产品层身份、会话、限流或 request projection 移入 `packages/supervisor-core`
