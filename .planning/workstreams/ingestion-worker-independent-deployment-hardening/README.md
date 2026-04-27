---
doc_type: index
status: completed
created: 2026-04-27
updated: 2026-04-28
---

# Workstream: Ingestion Worker Independent Deployment Hardening

这是 `ingestion-worker-independent-deployment-hardening` 的 native workstream 入口。

它记录 `apps/ingestion-worker` 从本地按需 CLI 走向服务器侧独立部署前仍需补齐的
ops / deploy / resource-control 闭环。

## Current Status

- status: `completed`
- active implementation: no
- planning status: phases `0-7` completed
- current posture: 继续采用 timer / cron / operator shell 按需拉起 bounded CLI，执行后退出
- target artifact: Docker image, with local dev path kept as the first runnable lane
- target host: Windows SSH alias `ubuntu-43` (`VM-0-2-ubuntu`)
- execution summary:
  - local `help/static/live preflight` evidence completed
  - Docker `help/static preflight` evidence completed
  - server `--live preflight` + writable small batch (`internal-notice` / `official-web`) completed
  - systemd timer dry-run + real-run evidence completed
  - resource profile review completed (`within_budget`)
- artifact:
  - remote: `/home/ubuntu/campus-agent-ingestion-acceptance/artifacts/20260427T165723Z`
  - local mirror: `.tmp/phase7-ingestion-acceptance/server/20260427T165723Z`

## Completion Note

- `Phase 7` 已在非 WSL Linux host 完成。
- 验收期间启用了分钟级 timer override 用于 real-run 取证；完成后已关闭 timer 并清理 override。
- same-host (`supervisor-api` + ingestion worker) 资源画像已落盘到
  `resource-profile-summary.json`。

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
