# AGENTS.md

本文件补充根级 `AGENTS.md`，只描述 `apps/execution-control` 的局部规则。

## Role

这个 app 是 Go-owned deterministic runtime / control-plane。

- 负责 internal execution admission、Temporal command / query / cancel、deadline、
  drain、readiness 与 sanitized projection writeback
- 负责 runtime tool / query-serving scope admission、internal query、memory
  activity、evidence validation、source projection、finalization 与 runtime
  observability
- `apps/agent-runtime` 的 OpenAI Agents SDK 是唯一模型-facing agent/tool loop
  owner；primary agent 通过官方 `handoff()` 进入 Knowledge Agent，Knowledge Agent
  只可调用 internal `knowledge_search`
- 整个 SDK run 只对应一个 Temporal Agent Activity；本 app 保留 durable
  envelope、timeout/cancel、四阶段 workflow、sanitized projection 与 fail-closed
  policy ownership，不建立 knowledge worker、Go RAG graph 或第二套 tool loop
- finalization 只校验 agent terminal output 与已投影 evidence refs、生成 sources 并
  写入终态；不得调用 synthesis provider 或改写模型答案
- 不负责 product-layer auth/session/conversation、browser-facing tool policy、Qdrant
  collection lifecycle 或 ingestion data plane

## Module Rules

- `internal/httpapi/server.go` 只做 server assembly 和 route registration。
- HTTP handler 文件按行为域拆分；不要把新的 answer、stream、direct tool-read-model、readyz、
  metrics 或 cancel 逻辑堆回同一个 handler 文件。
- `internal/httpapi/server_test.go` 不再新增测试；新增测试必须按 admission、agent handoff、
  internal query、readyz、streaming、error envelope 等行为域分文件。
- execution request wire 由 generated contract 和
  `internal/contracts/tool_execution_contract.go` 约束；不要恢复第二套 request
  parser、alias loader 或 synthetic runtime decision projection。
- `internal/toolreadmodel/*` 的 deterministic planner / runtime helper 必须按
  tool domain 和职责拆分；transport schedule 新增逻辑优先放到 snapshot、
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
