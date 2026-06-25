# AGENTS.md

本文件补充根级 `AGENTS.md`，只描述 `apps/execution-control` 的局部规则。

## Role

这个 app 是 Go-owned deterministic runtime / control-plane。

- 负责 internal execution admission、Temporal command / query / cancel、deadline、
  drain、readiness 与 sanitized projection writeback
- 负责 deterministic capability / policy gate、structured runtime planning、
  primary-agent activity bridge、typed tool activity、Go-owned RAG graph、Go
  finalization 与 runtime observability
- 普通 chat 的模型-facing semantic reasoning / tool loop 由
  `apps/agent-runtime` 承接；本 app 保留 durable envelope、visible tool
  allowlist、timeout/cancel、projection 与 fail-closed policy ownership
- knowledge/RAG 分支内的 retrieval planning、indexed lookup、synthesis provider execution、
  usage/cost projection 与 grounding verification 属于本 app 的 Go-owned Temporal graph
- 不负责 product-layer auth/session/conversation、browser-facing capability policy、Qdrant
  collection lifecycle 或 ingestion data plane

## Module Rules

- `internal/httpapi/server.go` 只做 server assembly 和 route registration。
- HTTP handler 文件按行为域拆分；不要把新的 answer、stream、direct structured、readyz、
  metrics 或 cancel 逻辑堆回同一个 handler 文件。
- `internal/httpapi/server_test.go` 不再新增测试；新增或迁移测试必须按 admission、bridge、
  structured direct、readyz、streaming、error envelope 等行为域分文件。
- `internal/execution/request.go` 是 request parsing facade；新增字段解析应放到
  request identity / context / JSON helper / runtime decision projection 等局部文件。
- `internal/structuredquery/*` 的 deterministic planner / runtime helper 必须按
  capability family 和职责拆分；transport schedule 新增逻辑优先放到 snapshot、
  route、departure 或 result helper 文件。
- `internal/observability/metrics.go` 保持 counter state 和 record API；Prometheus
  exposition 与 sorting / formatting helpers 放在独立文件。
- Go 文件纳入 repo decomposition guard；新增超过 800 行的 Go 文件必须先拆分，
  不能只提高 baseline。

## Verification

优先使用这些命令验证本目录相关变更：

```bash
pnpm go:check
pnpm repo:static
```
