---
doc_type: index
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# Workstream: Ingestion Worker Independent Deployment Hardening

这是 `ingestion-worker-independent-deployment-hardening` 的 native backlog workstream
入口。

它记录 `apps/ingestion-worker` 从本地按需 CLI 走向服务器侧独立部署前仍需补齐的
ops / deploy / resource-control 闭环。

## Current Status

- status: `backlog`
- active implementation: no (paused after local/dev completion)
- planning status: phases 0-6 implemented in repo; phase 7 server acceptance parked in backlog
- current posture: 继续采用 timer / cron / operator shell 按需拉起 bounded CLI，执行后退出
- target artifact: Docker image, with local dev path kept as the first runnable lane
- reopen rule: 只有在准备把 `apps/ingestion-worker` 部署到服务器侧独立运行，或需要
  deploy artifact、env/secrets、lock、report、alert、smoke 闭环时恢复

## Backlog Note

- 2026-04-27：`Phase 7` 服务器实机验收暂不推进。
- WSL 环境可完成 preflight/live probe 与小批量 smoke 的大部分项，但无法提供 `systemd service/timer`
  的完整验收证据（当前环境非 systemd PID1）。
- 后续恢复时，优先在 Linux server/VM 上补齐：
  - timer dry-run / real-run evidence
  - same-host (`supervisor-api` + ingestion worker) 资源画像与阈值确认

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 本 workstream 只处理 ingestion worker 的独立部署硬化。
- 本 workstream 不改变 data-plane canonical chain；仍以
  `docs/architecture/system/data-plane-architecture.md` 为准。
- 本 workstream 不把 ingestion worker 变成 query-serving 服务。
- 当前每日十条级别 notice / handoff 规模下，默认不引入常驻 Python worker、队列消费器或
  Go/Rust rewrite。
- 当前 OCR 主路径使用外部 MinerU API；本 workstream 不以“禁用本机 OCR 模型”为目标。
- 当前真实资源风险来自 full-file bytes buffering、provider archive buffering、
  oversized PDF segment accumulation、无边界 cache 与 batch overlap，而不是本机模型加载。
- 如果后续出现高频队列、lease/backpressure、多 worker 并发或长期 CPU/memory 瓶颈，再另行
  admission runtime migration。
